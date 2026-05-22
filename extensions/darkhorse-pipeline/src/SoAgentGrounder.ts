/**
 * SoAgentGrounder — CPI-6 Sprint 5 pre-generation grounding for the
 * Solution Overview Agent.
 *
 * Same pattern as TdsAgentGrounder, but the corpus is the raw Business
 * Requirement text. The SO Agent picks the Clean Core level of each
 * proposed component; grounding it BEFORE generation gives it real
 * references (released CDS views for tables, canonical RAP patterns
 * for transactional scenarios) so its level assignments are anchored
 * in MCP knowledge instead of stochastic LLM guesses.
 *
 * Detection from BR text:
 *   - SAP standard table mentions      -> get_cds_view per table
 *   - Transactional / analytical verbs -> get_rap_pattern (scenario)
 *   - Custom-data signals              -> get_cbo_pattern
 *   - Logging signals                  -> get_application_log_pattern
 *
 * RICEFW-type bias is applied: a 'Report' RICEFW always tilts toward the
 * READ_ONLY_ANALYTICAL scenario even when transactional verbs appear.
 *
 * Fails-open: MCP unreachable -> returns empty grounding, generation
 * continues with the LLM's own knowledge.
 */

'use strict';

import { resolveMcpPort }       from './CleanCoreVerifier';
import { SAP_STANDARD_TABLES }  from './sapTablesCatalog';

const http = require('http');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SoGroundingItem {
  heading: string;
  tool:
    | 'get_cds_view'
    | 'get_rap_pattern'
    | 'get_cbo_pattern'
    | 'get_application_log_pattern';
  body:    string;
}

export interface SoGroundingContext {
  ricefwType:      string;
  scannedAt:       string;
  mcpUnavailable:  boolean;
  grounding:       SoGroundingItem[];
  detected: {
    sapTables:       string[];
    rapScenario:     string | null;
    isTransactional: boolean;
    isAnalytical:    boolean;
    needsCbo:        boolean;
    needsLogging:    boolean;
    cboScenario:     string | null;
  };
}

// ---------------------------------------------------------------------------
// Detection — heuristics over the BR text
// ---------------------------------------------------------------------------

const RX_TABLE_TOKEN   = /\b([A-Z][A-Z0-9_]{1,12})\b/g;
const RX_TRANSACTIONAL = /\b(create|insert|add|post|save|update|modify|change|delete|cancel|maintain|process|approve|reject)\b/i;
const RX_ANALYTICAL    = /\b(report|analytical|dashboard|kpi|aggregate|drill[-\s]?down|hierarchy|trend|fiscal\s+year|by\s+(?:plant|company|customer|vendor))\b/i;
const RX_DRAFT         = /\b(draft|autosave|in[-\s]?progress\s+edit|work\s+in\s+progress)\b/i;
const RX_CBO_HINT      = /\b(custom\s+(?:table|object|business\s+object)|persistent\s+custom|store\s+custom|approval\s+(?:status|workflow)|audit\s+trail|ledger)\b/i;
const RX_LOGGING       = /\b(log|logging|application\s+log|slg1|audit\s+trail|error\s+capture)\b/i;

function detectSapTables(corpus: string): string[] {
  const found = new Set<string>();
  for (const m of corpus.matchAll(RX_TABLE_TOKEN)) {
    const candidate = (m[1] ?? '').toUpperCase();
    if (SAP_STANDARD_TABLES.has(candidate)) {
      found.add(candidate);
    }
  }
  return Array.from(found);
}

function detectScenario(
  corpus: string,
  ricefwType: string
): { rapScenario: string | null; isTransactional: boolean; isAnalytical: boolean } {

  const isTransactional = RX_TRANSACTIONAL.test(corpus);
  const isAnalytical    = RX_ANALYTICAL.test(corpus);
  const ricefwIsReport  = /^report\b/i.test(ricefwType);

  if (ricefwIsReport && isAnalytical) {
    return { rapScenario: 'READ_ONLY_ANALYTICAL', isTransactional: false, isAnalytical: true };
  }
  if (isTransactional) {
    const isDraft = RX_DRAFT.test(corpus);
    return {
      rapScenario:     isDraft ? 'DRAFT_ENABLED' : 'TRANSACTIONAL',
      isTransactional: true,
      isAnalytical:    false
    };
  }
  if (isAnalytical) {
    return { rapScenario: 'READ_ONLY_ANALYTICAL', isTransactional: false, isAnalytical: true };
  }
  return { rapScenario: null, isTransactional: false, isAnalytical: false };
}

function detectCbo(corpus: string): { needsCbo: boolean; scenario: string | null } {
  if (!RX_CBO_HINT.test(corpus)) return { needsCbo: false, scenario: null };
  const m = corpus.match(/[^.\n]*\b(custom\s+(?:table|object|business\s+object)|persistent\s+custom|store\s+custom|approval\s+(?:status|workflow)|audit\s+trail|ledger)\b[^.\n]*/i);
  return {
    needsCbo: true,
    scenario: (m?.[0] ?? '').trim().slice(0, 80) || 'custom business object'
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function mcpGet(port: number, path: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
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
        hostname: '127.0.0.1', port, path, method: 'POST', timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('mcp timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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

export async function groundBrForSo(
  brText: string,
  ricefwType: string,
  mcpPort: number = resolveMcpPort()
): Promise<SoGroundingContext> {

  const scannedAt = new Date().toISOString();
  const corpus    = brText ?? '';

  const scenarioInfo = detectScenario(corpus, ricefwType);
  const cboInfo      = detectCbo(corpus);

  const detected = {
    sapTables:       detectSapTables(corpus),
    rapScenario:     scenarioInfo.rapScenario,
    isTransactional: scenarioInfo.isTransactional,
    isAnalytical:    scenarioInfo.isAnalytical,
    needsCbo:        cboInfo.needsCbo,
    needsLogging:    RX_LOGGING.test(corpus),
    cboScenario:     cboInfo.scenario
  };

  const ctx: SoGroundingContext = {
    ricefwType,
    scannedAt,
    mcpUnavailable: false,
    grounding:      [],
    detected
  };

  const hasSomething =
    detected.sapTables.length > 0 ||
    detected.rapScenario !== null ||
    detected.needsCbo ||
    detected.needsLogging;
  if (!hasSomething) return ctx;

  if (!(await isMcpUp(mcpPort))) {
    ctx.mcpUnavailable = true;
    return ctx;
  }

  const calls: Promise<SoGroundingItem | null>[] = [];

  if (detected.rapScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-rap-pattern', { scenario: detected.rapScenario }, 5000)
        .then(res => renderRapPattern(detected.rapScenario!, res))
        .catch(() => null)
    );
  }
  if (detected.needsCbo && detected.cboScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-cbo-pattern', { scenario: detected.cboScenario }, 5000)
        .then(res => renderCboPattern(detected.cboScenario!, res))
        .catch(() => null)
    );
  }
  for (const table of detected.sapTables) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-cds-view', { sap_table: table }, 5000)
        .then(res => renderCdsView(table, res))
        .catch(() => null)
    );
  }
  if (detected.needsLogging) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-application-log-pattern', { use_case: ricefwType }, 5000)
        .then(res => renderLog(res))
        .catch(() => null)
    );
  }

  const results = await Promise.all(calls);
  for (const r of results) if (r) ctx.grounding.push(r);
  return ctx;
}

// ---------------------------------------------------------------------------
// Renderers — concise (the SO prompt has less budget than the TDS)
// ---------------------------------------------------------------------------

function renderRapPattern(scenario: string, res: any): SoGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `Recommended RAP scenario: ${scenario}`,
    tool:    'get_rap_pattern',
    body:
      `${d.pattern}\n` +
      `This is the Level A target architecture. Reflect it in solutionDetails ` +
      `and in cleanCoreAlignment as a Level A component.`
  };
}

function renderCboPattern(scenario: string, res: any): SoGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `Custom Business Object pattern for: ${scenario}`,
    tool:    'get_cbo_pattern',
    body:
      `${d.pattern}\n` +
      `Propose this as a Level A "Custom Business Object" component in the ` +
      `Solution Overview rather than a Z-table.`
  };
}

function renderCdsView(table: string, res: any): SoGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (!d.found) {
    return {
      heading: `Read access for ${table}`,
      tool:    'get_cds_view',
      body:    `MCP reports NO released CDS view registered for ${table}. Note this in the openItems or deviations.`
    };
  }
  return {
    heading: `Read access for ${table} -> ${d.viewName}`,
    tool:    'get_cds_view',
    body:    `Released CDS view ${d.viewName} (Level ${d.viewLevel}) is the cloud-ready read path for ${table}. Reflect this in the SO as a Level A component.`
  };
}

function renderLog(res: any): SoGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const p = res.data.pattern;
  if (!p) return null;
  return {
    heading: `SLG1 logging (${p.patternId})`,
    tool:    'get_application_log_pattern',
    body:    `Logging goes through SAP Application Log (SLG1), object ${p.logObject}. Mark the logging component as Level A.`
  };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderSoGroundingForPrompt(ctx: SoGroundingContext): string {
  if (ctx.mcpUnavailable) {
    return [
      '## Grounded SAP context for Solution Overview',
      '',
      'The DarkHorse MCP server is currently unreachable. Generation is proceeding ',
      'WITHOUT grounded knowledge. Apply Clean Core rules carefully — favor released ',
      'CDS views / RAP / SLG1 / CBO over classic ABAP patterns when assigning levels.'
    ].join('\n');
  }
  if (ctx.grounding.length === 0) {
    return '';
  }
  const blocks = ctx.grounding.map(g =>
    `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
  ).join('\n\n');

  return [
    '## Grounded SAP context for Solution Overview (CPI-6 Sprint 5)',
    '',
    'The following SAP knowledge was retrieved from the DarkHorse MCP server BEFORE ',
    'generation. When the BR maps onto any of these patterns, your cleanCoreAlignment ',
    'array MUST reflect them as Level A components, and the solutionDetails MUST name ',
    'the released CDS view / RAP pattern / CBO / SLG1 object — not a generic "custom ',
    'program" or "Z-table".',
    '',
    blocks
  ].join('\n');
}
