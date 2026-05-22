/**
 * CleanCoreVerifier — CPI-6 Sprint 1 post-generation Clean Core pass.
 *
 * After ObjectCodeGenerator emits ABAP source, this module scans the code for
 * SAP references that fail the Clean Core contract and POSTs them to the
 * DarkHorse MCP server (services/darkhorse-mcp) for adjudication. The output
 * is a structured CleanCoreReport that the preview panel renders so the
 * developer sees compliance findings BEFORE accepting the code.
 *
 * Scope (Sprint 1):
 *   1. USEREXIT_* references          → POST /tools/verify-exit
 *   2. SELECT ... FROM <SAP table>    → POST /tools/check-clean-core-level (TABL)
 *   3. CALL FUNCTION 'BAPI_*'         → POST /tools/check-clean-core-level (BAPI)
 *
 * Not in Sprint-1 scope (deferred to later sprints):
 *   - BAdI-name discovery (names are unstructured — needs catalog scan)
 *   - Implicit-enhancement detection
 *   - Custom log-table detection
 *
 * Behavior when MCP is unreachable:
 *   - Verifier returns a CleanCoreReport with verdict='skipped' and a
 *     `mcpUnavailable: true` flag. The pipeline NEVER fails closed on a
 *     missing MCP server — generation still proceeds, the developer just
 *     loses the compliance hint for that run.
 */

'use strict';

import { SAP_STANDARD_TABLES } from './sapTablesCatalog';

const http = require('http');

// ---------------------------------------------------------------------------
// MCP port resolution — hardcoded default with env override (matches the
// MCP server's own DARKHORSE_MCP_PORT convention).
// ---------------------------------------------------------------------------

export function resolveMcpPort(): number {
  const raw = process.env.DARKHORSE_MCP_PORT;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 1024 && parsed <= 65535
    ? parsed
    : 47292;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';
export type Verdict        = 'pass' | 'warn' | 'fail' | 'skipped';

export interface CleanCoreFinding {
  category:     'exit' | 'table' | 'bapi' | 'ui';
  reference:    string;          // raw token found in the source
  exists:       boolean | null;  // null if the tool doesn't return existence
  level:        CleanCoreLevel | null;
  description:  string;
  alternative:  string | null;
  occurrences:  number;          // how many times the reference appears
  /** True when the developer has acknowledged this reference as valid in a
   *  prior regeneration. Acknowledged findings are excluded from the verdict
   *  count and rendered with an ACK badge instead of an Acknowledge checkbox. */
  acknowledged: boolean;
}

export interface CleanCoreReport {
  verdict:         Verdict;
  scannedAt:       string;
  totalFindings:   number;
  countsByLevel:   Record<CleanCoreLevel, number>;
  findings:        CleanCoreFinding[];
  mcpUnavailable:  boolean;
  notes:           string[];     // human-readable scanner notes
}

// ---------------------------------------------------------------------------
// Reference extraction — Sprint-1 regex set
// ---------------------------------------------------------------------------

const RX_USEREXIT = /\bUSEREXIT_[A-Z0-9_]+\b/gi;
const RX_BAPI     = /CALL\s+FUNCTION\s+['"]\s*(BAPI_[A-Z0-9_]+)\s*['"]/gi;

// Classic UI / form patterns — flagged Level B with a Fiori / Adobe Forms
// alternative. These are not blockers (Level D blocks Accept), just advisory
// guidance that a modern UI/forms path exists.
const UI_FINDINGS: Array<{ rx: RegExp; reference: string; alternative: string; description: string }> = [
  {
    rx:          /\bCL_GUI_ALV_GRID\b/g,
    reference:   'CL_GUI_ALV_GRID',
    alternative: 'Fiori Elements List Report or Analytical List Page (Level A)',
    description: 'Classic GUI ALV grid. For new development, replace with a Fiori Elements app over an OData V4 service exposed via SRVD + SRVB.'
  },
  {
    rx:          /\bCL_SALV_TABLE\b/g,
    reference:   'CL_SALV_TABLE',
    alternative: 'Fiori Elements List Report or Analytical List Page (Level A)',
    description: 'Newer-classic ALV (still GUI-bound, Level B). For Fiori-capable backends prefer a Fiori Elements app.'
  },
  {
    rx:          /\bCALL\s+SCREEN\s+\d+/gi,
    reference:   'CALL SCREEN',
    alternative: 'Fiori Elements Object Page (Level A)',
    description: 'Classic DYNPRO screen call. Replace with a Fiori Elements Object Page for any new edit/detail UI.'
  },
  {
    rx:          /\bOPEN_FORM\b|\bWRITE_FORM\b|\bCLOSE_FORM\b/gi,
    reference:   'SAPscript',
    alternative: 'SAP Adobe Forms (FP_FUNCTION_MODULE_NAME, Level A)',
    description: 'SAPscript is deprecated. New print/interactive output MUST use SAP Adobe Forms.'
  },
  {
    rx:          /\bSSF_FUNCTION_MODULE_NAME\b/g,
    reference:   'Smart Forms',
    alternative: 'SAP Adobe Forms (Level A)',
    description: 'Smart Forms are a legacy pattern. New output requirements should use SAP Adobe Forms; retain Smart Forms only for parity with an existing legacy output stack.'
  }
];

// Match `FROM <TABLE>` and `FROM <TABLE> INTO/UP TO/WHERE/JOIN/CLIENT/AS/...`
const RX_FROM_TABLE = /\bFROM\s+([A-Z][A-Z0-9_]+)\b/gi;

interface ExtractedReferences {
  exits:  Map<string, number>;
  tables: Map<string, number>;
  bapis:  Map<string, number>;
  uis:    Map<string, number>;  // key = the canonical reference name from UI_FINDINGS
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function extractReferences(code: string): ExtractedReferences {
  const out: ExtractedReferences = {
    exits:  new Map<string, number>(),
    tables: new Map<string, number>(),
    bapis:  new Map<string, number>(),
    uis:    new Map<string, number>()
  };

  for (const m of code.matchAll(RX_USEREXIT)) {
    tally(out.exits, m[0].toUpperCase());
  }

  for (const m of code.matchAll(RX_BAPI)) {
    tally(out.bapis, (m[1] ?? '').toUpperCase());
  }

  // FROM-clause table extraction: skip anything that isn't a known SAP
  // standard table to avoid false positives on custom Z*/Y* tables and
  // CDS view names (those have their own classification path).
  for (const m of code.matchAll(RX_FROM_TABLE)) {
    const candidate = (m[1] ?? '').toUpperCase();
    if (SAP_STANDARD_TABLES.has(candidate)) {
      tally(out.tables, candidate);
    }
  }

  // Classic UI / form scans — each UI_FINDINGS entry has its own regex; we
  // count occurrences against the reference name (CL_GUI_ALV_GRID, etc.).
  for (const entry of UI_FINDINGS) {
    for (const _m of code.matchAll(entry.rx)) {
      tally(out.uis, entry.reference);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// HTTP helpers — talk to the MCP server over loopback HTTP
// ---------------------------------------------------------------------------

function mcpGet(port: number, path: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (err) { reject(err); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('mcp timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function mcpPost(port: number, path: string, body: object, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (err) { reject(err); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('mcp timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Persist a developer acknowledgement to the MCP server's seed catalog.
 * Fails-soft (returns false) so a write hiccup never blocks the regenerate
 * flow — the in-memory acknowledgement still applies for the current pass.
 */
export async function acknowledgeCatalogEntry(
  name: string,
  category: 'exit' | 'badi',
  mcpPort: number = resolveMcpPort()
): Promise<boolean> {
  try {
    const res = await mcpPost(
      mcpPort,
      '/catalog/acknowledge',
      { category, name, note: 'Developer-acknowledged via Clean Core preview panel.' },
      5000
    );
    return Boolean(res?.ok);
  } catch (err) {
    return false;
  }
}

async function isMcpUp(port: number): Promise<boolean> {
  try {
    const health = await mcpGet(port, '/health', 1500);
    return health && health.status === 'ok';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function verifyGeneratedCode(
  code: string,
  mcpPort: number = resolveMcpPort(),
  acknowledgements: readonly string[] = []
): Promise<CleanCoreReport> {

  const scannedAt = new Date().toISOString();
  const emptyCounts = (): Record<CleanCoreLevel, number> => ({ A: 0, B: 0, C: 0, D: 0 });
  const ackSet = new Set(acknowledgements.map(a => a.trim().toUpperCase()));

  if (!code || code.trim().length === 0) {
    return {
      verdict:        'pass',
      scannedAt,
      totalFindings:  0,
      countsByLevel:  emptyCounts(),
      findings:       [],
      mcpUnavailable: false,
      notes:          ['No generated code to scan.']
    };
  }

  // Cheap up-front extraction — if there's nothing to verify we can skip the
  // MCP roundtrips entirely (still useful for tiny snippets and unit tests).
  const refs = extractReferences(code);
  const nothingFound =
    refs.exits.size === 0 &&
    refs.tables.size === 0 &&
    refs.bapis.size === 0 &&
    refs.uis.size === 0;

  if (nothingFound) {
    return {
      verdict:        'pass',
      scannedAt,
      totalFindings:  0,
      countsByLevel:  emptyCounts(),
      findings:       [],
      mcpUnavailable: false,
      notes:          ['No SAP references requiring Clean Core verification were found.']
    };
  }

  // MCP availability gate — fail-open, never block the pipeline if the
  // server is down. The developer still sees their code, just without
  // compliance findings for this run.
  const up = await isMcpUp(mcpPort);
  if (!up) {
    return {
      verdict:        'skipped',
      scannedAt,
      totalFindings:  refs.exits.size + refs.tables.size + refs.bapis.size + refs.uis.size,
      countsByLevel:  emptyCounts(),
      findings:       [],
      mcpUnavailable: true,
      notes:          [
        `DarkHorse MCP server not reachable on 127.0.0.1:${mcpPort}.`,
        'Start it with: cd services/darkhorse-mcp && npm run build && node dist/index.js'
      ]
    };
  }

  const findings: CleanCoreFinding[] = [];
  const ackFor = (name: string) => ackSet.has(name.trim().toUpperCase());

  // ---- Exits ---------------------------------------------------------------
  const exitTasks = Array.from(refs.exits.entries()).map(async ([name, count]) => {
    try {
      const res = await mcpPost(mcpPort, '/tools/verify-exit', { exit_name: name }, 5000);
      if (res?.ok && res.data) {
        findings.push({
          category:    'exit',
          reference:   name,
          exists:      Boolean(res.data.exists),
          level:       res.data.level ?? null,
          description: res.data.description ?? '',
          alternative: res.data.alternative ?? null,
          occurrences: count,
          acknowledged: ackFor(name)
        });
      }
    } catch {
      // single-tool failure — note but don't abort the whole verification
      findings.push({
        category:    'exit',
        reference:   name,
        exists:      null,
        level:       null,
        description: 'MCP verify_exit call failed for this reference.',
        alternative: null,
        occurrences: count,
        acknowledged: ackFor(name)
      });
    }
  });

  // ---- Tables --------------------------------------------------------------
  const tableTasks = Array.from(refs.tables.entries()).map(async ([name, count]) => {
    try {
      const res = await mcpPost(mcpPort, '/tools/check-clean-core-level',
        { object_name: name, object_type: 'TABL' }, 5000);
      if (res?.ok && res.data) {
        findings.push({
          category:    'table',
          reference:   name,
          exists:      true,    // SAP standard tables — existence isn't the question
          level:       res.data.level ?? null,
          description: res.data.reasoning ?? '',
          alternative: (res.data.alternatives && res.data.alternatives[0])
                         ? `${res.data.alternatives[0].name} (${res.data.alternatives[0].type}, Level ${res.data.alternatives[0].level})`
                         : null,
          occurrences: count,
          acknowledged: ackFor(name)
        });
      }
    } catch {
      findings.push({
        category:    'table',
        reference:   name,
        exists:      true,
        level:       null,
        description: 'MCP check_clean_core_level call failed for this table.',
        alternative: null,
        occurrences: count,
        acknowledged: ackFor(name)
      });
    }
  });

  // ---- BAPIs ---------------------------------------------------------------
  const bapiTasks = Array.from(refs.bapis.entries()).map(async ([name, count]) => {
    try {
      const res = await mcpPost(mcpPort, '/tools/check-clean-core-level',
        { object_name: name, object_type: 'BAPI' }, 5000);
      if (res?.ok && res.data) {
        findings.push({
          category:    'bapi',
          reference:   name,
          exists:      true,
          level:       res.data.level ?? null,
          description: res.data.reasoning ?? '',
          alternative: (res.data.alternatives && res.data.alternatives[0])
                         ? `${res.data.alternatives[0].name} (${res.data.alternatives[0].type}, Level ${res.data.alternatives[0].level})`
                         : null,
          occurrences: count,
          acknowledged: ackFor(name)
        });
      }
    } catch {
      findings.push({
        category:    'bapi',
        reference:   name,
        exists:      true,
        level:       null,
        description: 'MCP check_clean_core_level call failed for this BAPI.',
        alternative: null,
        occurrences: count,
        acknowledged: ackFor(name)
      });
    }
  });

  await Promise.all([...exitTasks, ...tableTasks, ...bapiTasks]);

  // ---- Classic UI / form patterns ----------------------------------------
  // Deterministic — no MCP roundtrip. Pushed straight in as Level B with
  // the Fiori / Adobe Forms alternative named in the description.
  for (const [reference, count] of refs.uis.entries()) {
    const entry = UI_FINDINGS.find(u => u.reference === reference);
    if (!entry) continue;
    findings.push({
      category:     'ui',
      reference:    entry.reference,
      exists:       true,
      level:        'B',
      description:  entry.description,
      alternative:  entry.alternative,
      occurrences:  count,
      acknowledged: ackFor(reference)
    });
  }

  // Aggregate counts and verdict — acknowledged findings are excluded so a
  // fully-acknowledged report verdicts as pass.
  const countsByLevel = emptyCounts();
  for (const f of findings) {
    if (f.acknowledged) continue;
    if (f.level) {
      countsByLevel[f.level] += 1;
    }
  }

  const verdict: Verdict =
    countsByLevel.D > 0 ? 'fail'
    : countsByLevel.C > 0 ? 'warn'
    : 'pass';

  // Stable ordering for the preview UI: unacknowledged worst-first (D, C, B, A),
  // then acknowledged at the bottom (worst-first within their group), then
  // alphabetical for ties.
  const levelRank: Record<string, number> = { D: 0, C: 1, B: 2, A: 3 };
  findings.sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    const ar = levelRank[a.level ?? 'A'] ?? 4;
    const br = levelRank[b.level ?? 'A'] ?? 4;
    if (ar !== br) return ar - br;
    return a.reference.localeCompare(b.reference);
  });

  return {
    verdict,
    scannedAt,
    totalFindings: findings.length,
    countsByLevel,
    findings,
    mcpUnavailable: false,
    notes: []
  };
}
