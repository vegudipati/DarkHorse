/**
 * FdsAgentGrounder — CPI-6 Sprint 5 pre-generation grounding for the
 * Functional Design Spec Agent.
 *
 * The FDS Agent enriches the BR with concrete SAP references — tables,
 * BAdIs, transaction codes, authorization objects. Without grounding it
 * tends to invent BAdI / exit names (USEREXIT_ATP_QUANTITY) and use
 * direct table references where released CDS views exist.
 *
 * What this grounder pulls:
 *   - From BR text + SO solutionSummary + SO solutionDetails:
 *     SAP standard tables       -> get_cds_view per table
 *     transactional verbs       -> get_rap_pattern (scenario)
 *     custom-data signals       -> get_cbo_pattern
 *     logging signals           -> get_application_log_pattern
 *   - From SO cleanCoreAlignment component names that look like BAdIs
 *     (BADI_*, *_BADI, *_BAdI, USEREXIT_*):
 *     verify_badi / verify_exit pre-check the named object
 *
 * The verification calls pre-empt the LLM's hallucination tendency by
 * naming the verified objects in the grounding block.
 */

'use strict';

import { resolveMcpPort }       from './CleanCoreVerifier';
import { SAP_STANDARD_TABLES }  from './sapTablesCatalog';
import {
  detectFioriScenario,
  detectFormScenario,
  FioriScenarioGuess,
  FormScenarioGuess
} from './uiIntentDetect';

const http = require('http');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FdsGroundingItem {
  heading: string;
  tool:
    | 'get_cds_view'
    | 'get_rap_pattern'
    | 'get_cbo_pattern'
    | 'get_application_log_pattern'
    | 'get_fiori_pattern'
    | 'get_form_pattern'
    | 'verify_badi'
    | 'verify_exit';
  body:    string;
}

export interface FdsGroundingContext {
  ricefwType:      string;
  scannedAt:       string;
  mcpUnavailable:  boolean;
  grounding:       FdsGroundingItem[];
  detected: {
    sapTables:        string[];
    rapScenario:      string | null;
    isTransactional:  boolean;
    isAnalytical:     boolean;
    needsCbo:         boolean;
    needsLogging:     boolean;
    cboScenario:      string | null;
    candidateBadis:   string[];
    candidateExits:   string[];
    fioriScenario:    FioriScenarioGuess | null;
    formScenario:     FormScenarioGuess | null;
  };
}

// ---------------------------------------------------------------------------
// Loose SO shape — kept structural to avoid imports.
// ---------------------------------------------------------------------------

interface SoLike {
  solutionSummary?:     string;
  solutionDetails?:     string;
  cleanCoreAlignment?:  Array<{ component?: string; approach?: string; reasoning?: string }>;
  deviations?:          Array<{ component?: string; risk?: string }>;
  affectedModules?:     string[];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const RX_TABLE_TOKEN   = /\b([A-Z][A-Z0-9_]{1,12})\b/g;
const RX_TRANSACTIONAL = /\b(create|insert|add|post|save|update|modify|change|delete|cancel|maintain|process|approve|reject)\b/i;
const RX_ANALYTICAL    = /\b(report|analytical|dashboard|kpi|aggregate|drill[-\s]?down|hierarchy|trend)\b/i;
const RX_DRAFT         = /\b(draft|autosave|in[-\s]?progress\s+edit|work\s+in\s+progress)\b/i;
const RX_CBO_HINT      = /\b(custom\s+(?:table|object|business\s+object)|persistent\s+custom|store\s+custom|approval\s+(?:status|workflow)|audit\s+trail|ledger)\b/i;
const RX_LOGGING       = /\b(log|logging|application\s+log|slg1|audit\s+trail|error\s+capture)\b/i;
const RX_BADI_NAME     = /\b(?:BADI_[A-Z0-9_]+|[A-Z][A-Z0-9_]{2,}_BADI)\b/g;
const RX_EXIT_NAME     = /\bUSEREXIT_[A-Z0-9_]+\b/gi;

function corpusFor(brText: string, so?: SoLike): string {
  const parts: string[] = [brText ?? ''];
  if (so) {
    if (so.solutionSummary) parts.push(so.solutionSummary);
    if (so.solutionDetails) parts.push(so.solutionDetails);
    for (const e of so.cleanCoreAlignment ?? []) {
      if (e.component)  parts.push(e.component);
      if (e.approach)   parts.push(e.approach);
      if (e.reasoning)  parts.push(e.reasoning);
    }
    for (const d of so.deviations ?? []) {
      if (d.component) parts.push(d.component);
      if (d.risk)      parts.push(d.risk);
    }
  }
  return parts.join('\n');
}

function uniqueUpper(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const u = (v ?? '').trim().toUpperCase();
    if (u.length > 0) set.add(u);
  }
  return Array.from(set);
}

function detectSapTables(corpus: string): string[] {
  const found = new Set<string>();
  for (const m of corpus.matchAll(RX_TABLE_TOKEN)) {
    const candidate = (m[1] ?? '').toUpperCase();
    if (SAP_STANDARD_TABLES.has(candidate)) found.add(candidate);
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

function detectCandidateBadis(corpus: string): string[] {
  return uniqueUpper(Array.from(corpus.matchAll(RX_BADI_NAME)).map(m => m[0]));
}

function detectCandidateExits(corpus: string): string[] {
  return uniqueUpper(Array.from(corpus.matchAll(RX_EXIT_NAME)).map(m => m[0]));
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

export async function groundBrAndSoForFds(
  brText: string,
  so: SoLike | undefined,
  ricefwType: string,
  mcpPort: number = resolveMcpPort()
): Promise<FdsGroundingContext> {

  const scannedAt = new Date().toISOString();
  const corpus    = corpusFor(brText, so);

  const scenarioInfo = detectScenario(corpus, ricefwType);
  const cboInfo      = detectCbo(corpus);
  const candBadis    = detectCandidateBadis(corpus);
  const candExits    = detectCandidateExits(corpus);

  const detected = {
    sapTables:       detectSapTables(corpus),
    rapScenario:     scenarioInfo.rapScenario,
    isTransactional: scenarioInfo.isTransactional,
    isAnalytical:    scenarioInfo.isAnalytical,
    needsCbo:        cboInfo.needsCbo,
    needsLogging:    RX_LOGGING.test(corpus),
    cboScenario:     cboInfo.scenario,
    candidateBadis:  candBadis,
    candidateExits:  candExits,
    fioriScenario:   detectFioriScenario(corpus, ricefwType),
    formScenario:    detectFormScenario(corpus)
  };

  const ctx: FdsGroundingContext = {
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
    detected.needsLogging ||
    detected.candidateBadis.length > 0 ||
    detected.candidateExits.length > 0 ||
    detected.fioriScenario !== null ||
    detected.formScenario !== null;
  if (!hasSomething) return ctx;

  if (!(await isMcpUp(mcpPort))) {
    ctx.mcpUnavailable = true;
    return ctx;
  }

  const calls: Promise<FdsGroundingItem | null>[] = [];

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
  for (const name of detected.candidateBadis) {
    calls.push(
      mcpPost(mcpPort, '/tools/verify-badi', { badi_name: name }, 5000)
        .then(res => renderVerifiedBadi(name, res))
        .catch(() => null)
    );
  }
  for (const name of detected.candidateExits) {
    calls.push(
      mcpPost(mcpPort, '/tools/verify-exit', { exit_name: name }, 5000)
        .then(res => renderVerifiedExit(name, res))
        .catch(() => null)
    );
  }
  if (detected.fioriScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-fiori-pattern', { scenario: detected.fioriScenario }, 5000)
        .then(res => renderFioriPattern(detected.fioriScenario!, res))
        .catch(() => null)
    );
  }
  if (detected.formScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-form-pattern', { scenario: detected.formScenario }, 5000)
        .then(res => renderFormPattern(detected.formScenario!, res))
        .catch(() => null)
    );
  }

  const results = await Promise.all(calls);
  for (const r of results) if (r) ctx.grounding.push(r);
  return ctx;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderRapPattern(scenario: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `RAP scenario: ${scenario}`,
    tool:    'get_rap_pattern',
    body:
      `${d.pattern}\n` +
      `In the FDS, describe the technical approach as a RAP-managed business object. ` +
      `Reference the released BDEF + projection structure in inputOutputSpec.`
  };
}

function renderCboPattern(scenario: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `Custom Business Object pattern for: ${scenario}`,
    tool:    'get_cbo_pattern',
    body:    `${d.pattern}\nIn the FDS, describe new persistent data as a CBO — not a Z-table with custom INSERTs.`
  };
}

function renderCdsView(table: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (!d.found) {
    return {
      heading: `Read access for ${table}`,
      tool:    'get_cds_view',
      body:    `MCP reports NO released CDS view registered for ${table}. Document the gap in openItems. Do NOT propose a direct SELECT in functionalRequirements.`
    };
  }
  return {
    heading: `Read access for ${table} -> ${d.viewName}`,
    tool:    'get_cds_view',
    body:    `Use released CDS view ${d.viewName} (Level ${d.viewLevel}) for any read of ${table}. Reference ${d.viewName} in inputOutputSpec and businessRules — not the underlying table.`
  };
}

function renderLog(res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const p = res.data.pattern;
  if (!p) return null;
  return {
    heading: `SLG1 logging (${p.patternId})`,
    tool:    'get_application_log_pattern',
    body:    `Logging via SAP Application Log (SLG1), object ${p.logObject}, subobject ${p.logSubobject}. Reflect this in errorHandling.`
  };
}

function renderVerifiedBadi(name: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (d.exists === false || d.level === 'D') {
    return {
      heading: `BAdI ${name} — NOT VALID`,
      tool:    'verify_badi',
      body:
        `${name} is not a valid released BAdI per the DarkHorse catalog. ` +
        (d.alternative ? `Use ${d.alternative} instead.` : `Remove this reference from the FDS.`) +
        `\nReason: ${d.description ?? 'flagged by MCP verification'}`
    };
  }
  return {
    heading: `BAdI ${name} — verified (Level ${d.level ?? '?'})`,
    tool:    'verify_badi',
    body:    `${name} is a valid released BAdI (Level ${d.level ?? '?'}, module ${d.module ?? '?'}). It is safe to reference in the FDS. ${d.description ?? ''}`
  };
}

function renderFioriPattern(scenario: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `Fiori pattern: ${scenario}`,
    tool:    'get_fiori_pattern',
    body:
      `${d.pattern}\n\n` +
      `When to use: ${d.whenToUse}\n` +
      `Describe the UI in uiDesign as a Fiori Elements ${scenario} app (not "selection screen" / "ALV grid"). ` +
      `List the @UI annotations and required SRVD/SRVB service in inputOutputSpec.`
  };
}

function renderFormPattern(scenario: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const warn = d.legacyWarning ? `\nLegacy warning: ${d.legacyWarning}` : '';
  return {
    heading: `Form pattern: ${scenario}`,
    tool:    'get_form_pattern',
    body:
      `${d.pattern}\nDescribe the form in the FDS as an Adobe Forms output ` +
      `(not SAPscript / Smart Forms unless explicitly required). Document the form interface ` +
      `parameters in inputOutputSpec. Do NOT: ${d.doNotUse}${warn}`
  };
}

function renderVerifiedExit(name: string, res: any): FdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (d.exists === false || d.level === 'D') {
    return {
      heading: `Exit ${name} — NOT VALID`,
      tool:    'verify_exit',
      body:
        `${name} is not a valid SAP exit per the DarkHorse catalog. ` +
        (d.alternative ? `Use ${d.alternative} instead.` : `Remove this reference.`) +
        `\nReason: ${d.description ?? 'flagged by MCP verification'}`
    };
  }
  return {
    heading: `Exit ${name} — verified (Level ${d.level ?? '?'})`,
    tool:    'verify_exit',
    body:    `${name} is a real SAP exit (Level ${d.level ?? '?'}). ${d.description ?? ''}. A released BAdI may be preferable: ${d.alternative ?? 'check SAP API Hub'}.`
  };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderFdsGroundingForPrompt(ctx: FdsGroundingContext): string {
  if (ctx.mcpUnavailable) {
    return [
      '## Grounded SAP context for FDS',
      '',
      'The DarkHorse MCP server is currently unreachable. Generation is proceeding ',
      'WITHOUT grounded knowledge. Reference SAP objects (CDS views, BAdIs, exits) ',
      'only when you are confident they exist; favor I_*-prefixed CDS views and ',
      'avoid USEREXIT_* unless you can name a specific include.'
    ].join('\n');
  }
  if (ctx.grounding.length === 0) {
    return '';
  }
  const blocks = ctx.grounding.map(g =>
    `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
  ).join('\n\n');

  return [
    '## Grounded SAP context for FDS (CPI-6 Sprint 5)',
    '',
    'The following SAP knowledge was retrieved from the DarkHorse MCP server BEFORE ',
    'FDS generation. The FDS you produce MUST:',
    '- Reference the released CDS view names below in inputOutputSpec and businessRules ',
    '  for any read of the matching SAP standard table.',
    '- Reference verified BAdI / exit names ONLY when their grounding item says ',
    '  "verified"; if any name is flagged "NOT VALID", REMOVE it from the FDS and ',
    '  substitute the alternative the grounding provides.',
    '- Describe the technical approach using the RAP / CBO patterns when applicable.',
    '- Place logging in errorHandling as SLG1 Application Log — never custom Z log tables.',
    '',
    blocks
  ].join('\n');
}
