/**
 * UidLogger — tamper-evident audit log of every AI-generated object.
 *
 * Compliance backdrop: AI-generated code in production SAP systems needs a
 * traceable audit record. For each generated ABAP object DarkHorse:
 *   1. Mints a 16-hex-character UID (8 random bytes hex-encoded, upper case).
 *      ~64 bits of entropy — collision-free for any realistic volume.
 *   2. Appends a JSONL entry to ~/.darkhorse/ai-generation-log.jsonl with
 *      object metadata, model, timestamp, and a hash of the previous line.
 *      Each entry's `prevHash` chains backwards so any edit to a past line
 *      breaks the chain — an audit script can detect tampering.
 *   3. Writes the same UID into the code's header comment block, so the
 *      log entry and the on-disk code are cross-referenceable forever.
 *
 * Tamper-evidence approach:
 *   - Append-only writes via fs.appendFileSync (no read-modify-write).
 *   - SHA-256 hash chain (each entry includes the SHA-256 of the previous
 *     line's text). Editing any past entry invalidates every subsequent
 *     line's prevHash.
 *   - verifyChain() walks the file and reports breaks.
 *
 * Storage location:
 *   - Default: <userHome>/.darkhorse/ai-generation-log.jsonl
 *   - Overridable via darkhorse.uid.logPath setting OR
 *     DARKHORSE_UID_LOG env var (env wins).
 *   - File is created with mode 0o644 on first append; directory created
 *     with 0o755 if missing.
 */

'use strict';

import * as fs     from 'fs';
import * as path   from 'path';
import * as os     from 'os';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RecordGenerationInput {
  /** Object the AI produced (e.g. ZSALES_REPORT). */
  objectName:   string;
  /** SAP object type (PROG / CLAS / DDLS / BDEF / SRVD / SRVB / TABL / ...). */
  objectType:   string;
  /** Model the LLM proxy used, as reported by the proxy response. */
  model:        string;
  /** Optional pipeline / business-requirement correlation fields. */
  pipelineId?:  string;
  brRef?:       string;
  /** SHA-256 of the LLM prompt (audit correlation without storing the
   *  prompt body itself). */
  promptHash?:  string;
}

export interface RecordGenerationResult {
  uid:           string;
  timestamp:     string;     // ISO 8601 UTC
  logPath:       string;
}

export interface ChainEntry {
  uid:           string;
  timestamp:     string;
  objectName:    string;
  objectType:    string;
  model:         string;
  pipelineId?:   string;
  brRef?:        string;
  promptHash?:   string;
  prevHash:      string;     // SHA-256 hex of the previous line's text ('GENESIS' for the first)
}

export interface VerifyResult {
  logPath:       string;
  totalEntries:  number;
  okEntries:     number;
  breaks:        Array<{ lineNumber: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DARKHORSE_DIR = path.join(os.homedir(), '.darkhorse');
const DEFAULT_LOG_FILENAME  = 'ai-generation-log.jsonl';
const GENESIS_PREV_HASH     = 'GENESIS';

export function resolveLogPath(): string {
  const fromEnv = process.env.DARKHORSE_UID_LOG;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  const fromSetting = vscode.workspace.getConfiguration()
    .get<string>('darkhorse.uid.logPath', '');
  if (fromSetting && fromSetting.trim().length > 0) {
    return fromSetting.trim();
  }
  return path.join(DEFAULT_DARKHORSE_DIR, DEFAULT_LOG_FILENAME);
}

// ---------------------------------------------------------------------------
// UID generation — 16 hex chars (8 random bytes)
// ---------------------------------------------------------------------------

export function mintUid(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Append-only logging
// ---------------------------------------------------------------------------

function ensureLogFile(logPath: string): void {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
  if (!fs.existsSync(logPath)) {
    // touch with the right mode
    const fd = fs.openSync(logPath, 'a', 0o644);
    fs.closeSync(fd);
  }
}

function readLastLine(logPath: string): string | null {
  if (!fs.existsSync(logPath)) return null;
  const stats = fs.statSync(logPath);
  if (stats.size === 0) return null;

  // Tail the file efficiently — read the last 8 KB, find the last newline.
  const tailSize = Math.min(8192, stats.size);
  const buf = Buffer.alloc(tailSize);
  const fd = fs.openSync(logPath, 'r');
  try {
    fs.readSync(fd, buf, 0, tailSize, stats.size - tailSize);
  } finally {
    fs.closeSync(fd);
  }
  const tail = buf.toString('utf8');
  const lines = tail.split('\n').filter(l => l.length > 0);
  return lines.length > 0 ? lines[lines.length - 1]! : null;
}

/**
 * Mints a UID, builds a chain entry, appends it to the log file, returns the UID.
 * Single fs.appendFileSync — guarantees the entry hits disk before we return.
 */
export function recordGeneration(input: RecordGenerationInput): RecordGenerationResult {
  const logPath = resolveLogPath();
  ensureLogFile(logPath);

  const lastLine = readLastLine(logPath);
  const prevHash = lastLine ? sha256Hex(lastLine) : GENESIS_PREV_HASH;

  const uid       = mintUid();
  const timestamp = new Date().toISOString();

  const entry: ChainEntry = {
    uid,
    timestamp,
    objectName: input.objectName,
    objectType: input.objectType,
    model:      input.model,
    prevHash
  };
  if (input.pipelineId) entry.pipelineId = input.pipelineId;
  if (input.brRef)      entry.brRef      = input.brRef;
  if (input.promptHash) entry.promptHash = input.promptHash;

  // Stable key order for deterministic hashing.
  const line = JSON.stringify(entry);
  fs.appendFileSync(logPath, line + '\n', { encoding: 'utf8', mode: 0o644 });

  return { uid, timestamp, logPath };
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

export function verifyChain(logPath: string = resolveLogPath()): VerifyResult {
  const result: VerifyResult = { logPath, totalEntries: 0, okEntries: 0, breaks: [] };

  if (!fs.existsSync(logPath)) {
    result.breaks.push({ lineNumber: 0, reason: `Log file does not exist at ${logPath}` });
    return result;
  }

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.length > 0);

  let expectedPrevHash = GENESIS_PREV_HASH;
  let previousLine     = '';

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line       = lines[i]!;
    result.totalEntries += 1;

    let entry: ChainEntry;
    try {
      entry = JSON.parse(line) as ChainEntry;
    } catch {
      result.breaks.push({ lineNumber, reason: 'Line is not valid JSON.' });
      previousLine     = line;
      expectedPrevHash = sha256Hex(line);
      continue;
    }

    if (typeof entry.prevHash !== 'string') {
      result.breaks.push({ lineNumber, reason: 'Missing prevHash field.' });
    } else if (entry.prevHash !== expectedPrevHash) {
      result.breaks.push({
        lineNumber,
        reason: `prevHash mismatch — expected ${expectedPrevHash.slice(0, 12)}..., got ${entry.prevHash.slice(0, 12)}...`
      });
    } else {
      result.okEntries += 1;
    }

    previousLine     = line;
    expectedPrevHash = sha256Hex(line);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Command handler — DarkHorse: Verify AI Log Chain
// ---------------------------------------------------------------------------

export async function runVerifyAiLogCommand(): Promise<void> {
  const logPath = resolveLogPath();
  const result  = verifyChain(logPath);

  const channel = vscode.window.createOutputChannel('DarkHorse Audit');
  channel.clear();
  channel.appendLine(`Log file: ${result.logPath}`);
  channel.appendLine(`Total entries: ${result.totalEntries}`);
  channel.appendLine(`Intact entries: ${result.okEntries}`);
  channel.appendLine(`Chain breaks: ${result.breaks.length}`);

  if (result.breaks.length > 0) {
    channel.appendLine('');
    channel.appendLine('--- Breaks ---');
    for (const b of result.breaks) {
      channel.appendLine(`  line ${b.lineNumber}: ${b.reason}`);
    }
  }
  channel.show(true);

  if (result.breaks.length === 0) {
    vscode.window.showInformationMessage(
      `DarkHorse: AI log chain is intact (${result.okEntries} of ${result.totalEntries} entries verified).`
    );
  } else {
    vscode.window.showErrorMessage(
      `DarkHorse: AI log chain has ${result.breaks.length} break(s). See "DarkHorse Audit" output channel.`
    );
  }
}
