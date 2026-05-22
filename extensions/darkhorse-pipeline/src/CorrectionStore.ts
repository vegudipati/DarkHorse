/**
 * CorrectionStore — CPI-6 Sprint 6 Session 3 capture of developer edits.
 *
 * Concept:
 *   1. The developer Accepts AI-generated code; ObjectCodeGenerator saves the
 *      AI output onto state.abapObjects[i].generatedCode and writes the
 *      .abap file to outputFolder.
 *   2. The developer may EDIT the .abap file (in VS Code, in SAP ADT,
 *      anywhere) — fixing things the AI got wrong.
 *   3. When the developer runs the "Capture Corrections" command, this
 *      module reads each accepted file from disk, diffs it against the
 *      stored generatedCode, and writes a correction JSON per object to
 *      outputFolder/corrections/<object>.correction.json.
 *
 * The captured corrections sit on disk for now — they are NOT indexed into
 * the shared RAG. That keeps trust simple: developer code never leaves the
 * machine until you opt in to a separate "index corrections" step (future
 * session). A captured correction represents your team's ground truth for
 * "AI was wrong, here's the fix" — a future RAG ingestion will weight these
 * highly so the system learns from each correction.
 *
 * Diff strategy:
 *   - Line-by-line LCS via a simple two-pointer scan with index arrays.
 *   - Captures structural ops: equal / insert / delete / replace.
 *   - Stores the full original + current code alongside the diff so
 *     downstream consumers (RAG ingester, future session) have everything.
 */

'use strict';

import * as fs   from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PipelineStateManager, AbapObject } from './PipelineStateManager';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DiffOp = 'equal' | 'insert' | 'delete' | 'replace';

export interface DiffHunk {
  op:       DiffOp;
  /** Original-side line range (1-based, inclusive). null for pure insert. */
  origFrom: number | null;
  origTo:   number | null;
  /** Current-side line range. null for pure delete. */
  currFrom: number | null;
  currTo:   number | null;
  /** Lines from the original (empty for insert). */
  orig:     string[];
  /** Lines from the current file (empty for delete). */
  curr:     string[];
}

export interface CorrectionRecord {
  objectName:   string;
  objectType:   string;
  capturedAt:   string;
  filePath:     string;
  originalCode: string;
  currentCode:  string;
  /** Aggregate counts for at-a-glance review. */
  stats: {
    linesAdded:   number;
    linesRemoved: number;
    hunks:        number;
  };
  /** Only the non-equal hunks (the actual edits). */
  edits: DiffHunk[];
}

export interface CaptureResult {
  capturedAt:        string;
  outputFolder:      string;
  correctionsFolder: string;
  totalObjects:      number;
  withStoredCode:    number;
  edited:            CorrectionRecord[];
  unchanged:         Array<{ objectName: string; objectType: string }>;
  missingFiles:      Array<{ objectName: string; objectType: string; expectedPath: string }>;
  skipped:           Array<{ objectName: string; objectType: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function captureCorrections(
  stateManager: PipelineStateManager,
  outputFolder: string
): Promise<CaptureResult> {

  const capturedAt = new Date().toISOString();
  const correctionsFolder = path.join(outputFolder, 'corrections');

  const state = stateManager.getState();
  const result: CaptureResult = {
    capturedAt,
    outputFolder,
    correctionsFolder,
    totalObjects:   state?.abapObjects?.length ?? 0,
    withStoredCode: 0,
    edited:         [],
    unchanged:      [],
    missingFiles:   [],
    skipped:        []
  };
  if (!state || !state.abapObjects) return result;

  if (!fs.existsSync(correctionsFolder)) {
    fs.mkdirSync(correctionsFolder, { recursive: true });
  }

  for (const obj of state.abapObjects) {
    if (!obj.codeAccepted) {
      result.skipped.push({ objectName: obj.objectName, objectType: obj.objectType, reason: 'not accepted' });
      continue;
    }
    if (!obj.generatedCode) {
      result.skipped.push({ objectName: obj.objectName, objectType: obj.objectType, reason: 'no stored generatedCode (object was accepted before CPI-6 Sprint 6)' });
      continue;
    }
    result.withStoredCode += 1;

    const filePath = resolveAbapPath(outputFolder, obj);
    if (!fs.existsSync(filePath)) {
      result.missingFiles.push({ objectName: obj.objectName, objectType: obj.objectType, expectedPath: filePath });
      continue;
    }
    const currentCode = fs.readFileSync(filePath, 'utf-8');

    if (normalize(currentCode) === normalize(obj.generatedCode)) {
      result.unchanged.push({ objectName: obj.objectName, objectType: obj.objectType });
      continue;
    }

    const record = buildCorrectionRecord(obj, filePath, currentCode, capturedAt);
    const correctionPath = path.join(
      correctionsFolder,
      `${obj.objectType}_${obj.objectName}.correction.json`
    );
    fs.writeFileSync(correctionPath, JSON.stringify(record, null, 2), 'utf-8');
    result.edited.push(record);
  }

  return result;
}

// ---------------------------------------------------------------------------
// File-path resolution — match PipelineGitHelper.saveCodeToFile naming.
// ---------------------------------------------------------------------------

function resolveAbapPath(outputFolder: string, obj: AbapObject): string {
  // Existing convention from PipelineGitHelper: <OBJECT_TYPE>_<OBJECT_NAME>.abap
  // Falls back to the upper-cased object name + .abap if not matching exactly.
  const fileName = `${obj.objectType}_${obj.objectName}.abap`;
  return path.join(outputFolder, fileName);
}

// ---------------------------------------------------------------------------
// Diff — line-by-line LCS
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  // Normalise line endings + trim trailing whitespace per line so
  // CRLF/LF differences don't count as edits.
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .trimEnd();
}

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

function buildDiff(origLines: string[], currLines: string[]): DiffHunk[] {
  const dp = lcsTable(origLines, currLines);
  const hunks: DiffHunk[] = [];
  let i = origLines.length, j = currLines.length;

  // First produce a per-line op trace.
  type Step = { op: 'equal' | 'insert' | 'delete'; orig?: number; curr?: number };
  const steps: Step[] = [];
  while (i > 0 && j > 0) {
    if (origLines[i - 1] === currLines[j - 1]) {
      steps.push({ op: 'equal', orig: i - 1, curr: j - 1 });
      i--; j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      steps.push({ op: 'delete', orig: i - 1 });
      i--;
    } else {
      steps.push({ op: 'insert', curr: j - 1 });
      j--;
    }
  }
  while (i > 0) { steps.push({ op: 'delete', orig: i - 1 }); i--; }
  while (j > 0) { steps.push({ op: 'insert', curr: j - 1 }); j--; }
  steps.reverse();

  // Coalesce consecutive same-op steps into hunks, and merge adjacent
  // delete+insert pairs into "replace" for readability.
  let k = 0;
  while (k < steps.length) {
    const op = steps[k]!.op;
    let end = k;
    while (end + 1 < steps.length && steps[end + 1]!.op === op) end++;

    const segment = steps.slice(k, end + 1);

    if (op === 'equal') {
      // Skip equal segments in the output — we only persist edits.
      k = end + 1;
      continue;
    }

    // Look ahead for an insert immediately following a delete (or vice-versa)
    // to merge into a replace hunk.
    if (op === 'delete' && end + 1 < steps.length && steps[end + 1]!.op === 'insert') {
      const delSeg = segment;
      let insEnd = end + 1;
      while (insEnd + 1 < steps.length && steps[insEnd + 1]!.op === 'insert') insEnd++;
      const insSeg = steps.slice(end + 1, insEnd + 1);

      const orig = delSeg.map(s => origLines[s.orig!]!);
      const curr = insSeg.map(s => currLines[s.curr!]!);
      hunks.push({
        op:       'replace',
        origFrom: delSeg[0]!.orig! + 1,
        origTo:   delSeg[delSeg.length - 1]!.orig! + 1,
        currFrom: insSeg[0]!.curr! + 1,
        currTo:   insSeg[insSeg.length - 1]!.curr! + 1,
        orig,
        curr
      });
      k = insEnd + 1;
      continue;
    }
    if (op === 'insert' && end + 1 < steps.length && steps[end + 1]!.op === 'delete') {
      // Same idea, but symmetrical
      const insSeg = segment;
      let delEnd = end + 1;
      while (delEnd + 1 < steps.length && steps[delEnd + 1]!.op === 'delete') delEnd++;
      const delSeg = steps.slice(end + 1, delEnd + 1);

      const orig = delSeg.map(s => origLines[s.orig!]!);
      const curr = insSeg.map(s => currLines[s.curr!]!);
      hunks.push({
        op:       'replace',
        origFrom: delSeg[0]!.orig! + 1,
        origTo:   delSeg[delSeg.length - 1]!.orig! + 1,
        currFrom: insSeg[0]!.curr! + 1,
        currTo:   insSeg[insSeg.length - 1]!.curr! + 1,
        orig,
        curr
      });
      k = delEnd + 1;
      continue;
    }

    if (op === 'delete') {
      const orig = segment.map(s => origLines[s.orig!]!);
      hunks.push({
        op:       'delete',
        origFrom: segment[0]!.orig! + 1,
        origTo:   segment[segment.length - 1]!.orig! + 1,
        currFrom: null,
        currTo:   null,
        orig,
        curr: []
      });
    } else {
      const curr = segment.map(s => currLines[s.curr!]!);
      hunks.push({
        op:       'insert',
        origFrom: null,
        origTo:   null,
        currFrom: segment[0]!.curr! + 1,
        currTo:   segment[segment.length - 1]!.curr! + 1,
        orig:     [],
        curr
      });
    }
    k = end + 1;
  }

  return hunks;
}

function buildCorrectionRecord(
  obj: AbapObject,
  filePath: string,
  currentCode: string,
  capturedAt: string
): CorrectionRecord {
  const original    = normalize(obj.generatedCode!);
  const current     = normalize(currentCode);
  const origLines   = original.split('\n');
  const currLines   = current.split('\n');
  const edits       = buildDiff(origLines, currLines);

  let linesAdded = 0, linesRemoved = 0;
  for (const h of edits) {
    if (h.op === 'insert')      linesAdded   += h.curr.length;
    else if (h.op === 'delete') linesRemoved += h.orig.length;
    else if (h.op === 'replace') {
      linesRemoved += h.orig.length;
      linesAdded   += h.curr.length;
    }
  }

  return {
    objectName:   obj.objectName,
    objectType:   obj.objectType,
    capturedAt,
    filePath,
    originalCode: original,
    currentCode:  current,
    stats:        { linesAdded, linesRemoved, hunks: edits.length },
    edits
  };
}

// ---------------------------------------------------------------------------
// VS Code-friendly summary builder — used by the command handler to display
// a result toast and an output channel summary.
// ---------------------------------------------------------------------------

export function formatCaptureSummary(result: CaptureResult): string {
  const lines: string[] = [];
  lines.push(`Captured at: ${result.capturedAt}`);
  lines.push(`Output folder: ${result.outputFolder}`);
  lines.push(`Corrections folder: ${result.correctionsFolder}`);
  lines.push('');
  lines.push(`Total objects in pipeline: ${result.totalObjects}`);
  lines.push(`With stored AI code:       ${result.withStoredCode}`);
  lines.push(`Edited (correction saved): ${result.edited.length}`);
  lines.push(`Unchanged:                 ${result.unchanged.length}`);
  lines.push(`Missing files:             ${result.missingFiles.length}`);
  lines.push(`Skipped:                   ${result.skipped.length}`);

  if (result.edited.length > 0) {
    lines.push('');
    lines.push('--- Edited ---');
    for (const e of result.edited) {
      lines.push(`  ${e.objectType} ${e.objectName} — +${e.stats.linesAdded}/-${e.stats.linesRemoved} across ${e.stats.hunks} hunks`);
    }
  }
  if (result.missingFiles.length > 0) {
    lines.push('');
    lines.push('--- Missing files ---');
    for (const m of result.missingFiles) {
      lines.push(`  ${m.objectType} ${m.objectName} — expected at ${m.expectedPath}`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('--- Skipped ---');
    for (const s of result.skipped) {
      lines.push(`  ${s.objectType} ${s.objectName} — ${s.reason}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Convenience top-level entry that the extension command wires up.
// Resolves the output folder from settings, runs capture, surfaces a summary.
// ---------------------------------------------------------------------------

export async function runCaptureCorrectionsCommand(
  stateManager: PipelineStateManager
): Promise<void> {

  const outputFolder = vscode.workspace.getConfiguration()
    .get<string>('darkhorse.pipeline.outputFolder', '');
  if (!outputFolder) {
    vscode.window.showErrorMessage(
      'DarkHorse: Output folder not configured. Set darkhorse.pipeline.outputFolder first.'
    );
    return;
  }

  const result = await captureCorrections(stateManager, outputFolder);
  const summary = formatCaptureSummary(result);

  const channel = vscode.window.createOutputChannel('DarkHorse Corrections');
  channel.clear();
  channel.appendLine(summary);
  channel.show(true);

  if (result.edited.length === 0) {
    vscode.window.showInformationMessage(
      `DarkHorse: No corrections detected. ${result.unchanged.length} object(s) unchanged, ${result.skipped.length} skipped.`
    );
  } else {
    vscode.window.showInformationMessage(
      `DarkHorse: Captured ${result.edited.length} correction(s) to ${result.correctionsFolder}. See "DarkHorse Corrections" output channel.`
    );
  }
}
