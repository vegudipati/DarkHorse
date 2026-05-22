/**
 * CodeAgentGrounder — CPI-6 Sprint 3 pre-generation grounding pass.
 *
 * Where CleanCoreVerifier scans CODE that the LLM produced, this module
 * scans the TDS OBJECT METADATA *before* the LLM runs and queries the MCP
 * server for grounded SAP knowledge. The result is a structured
 * GroundingContext that ObjectCodeGenerator injects into the system prompt
 * so the LLM has access to:
 *
 *   - The released CDS view name for every SAP standard table mentioned
 *     in the TDS keyLogic / dependencies
 *   - The EML syntax template for every write operation the keyLogic
 *     implies (create / update / delete)
 *   - The canonical RAP pattern (BDEF/BBEH/SRVD/SRVB structure) when the
 *     target objectType is transactional
 *   - The SLG1 Application Log pattern when the keyLogic mentions logging
 *
 * Behavior when MCP is unreachable:
 *   - Returns a GroundingContext with grounding=[] and mcpUnavailable=true.
 *     Generation proceeds without grounding — the LLM falls back to its
 *     training data and the CleanCoreVerifier still runs post-generation.
 *
 * Cross-module rule: this file is the ONLY place that issues HTTP requests
 * to the MCP server pre-generation. Tools are picked deterministically from
 * AbapObject metadata — no LLM tool-use loop yet.
 */

'use strict';

import { resolveMcpPort }       from './CleanCoreVerifier';
import { SAP_STANDARD_TABLES }  from './sapTablesCatalog';
import { AbapObject }           from './PipelineStateManager';
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

export interface GroundingItem {
  /** Free-form heading shown in the system prompt block. */
  heading:  string;
  /** Tool that produced this item. */
  tool:     'get_cds_view' | 'get_eml_syntax' | 'get_rap_pattern' | 'get_application_log_pattern' | 'get_fiori_pattern' | 'get_form_pattern';
  /** Pre-rendered markdown-ish text to inject into the prompt. */
  body:     string;
}

export interface GroundingContext {
  obj:              { name: string; type: string };
  scannedAt:        string;
  mcpUnavailable:   boolean;
  /** Each grounding item is one MCP tool result, pre-rendered for prompt injection. */
  grounding:        GroundingItem[];
  /** Human-readable list of the SAP tables, ops, and patterns detected — for debugging. */
  detected: {
    sapTables:     string[];
    writeOps:      string[];   // 'CREATE' | 'UPDATE' | 'DELETE'
    rapScenario:   string | null;
    needsLogging:  boolean;
    fioriScenario: FioriScenarioGuess | null;
    formScenario:  FormScenarioGuess | null;
  };
}

// ---------------------------------------------------------------------------
// Detection — what the grounder looks at in the AbapObject
// ---------------------------------------------------------------------------

const RX_TABLE_TOKEN = /\b([A-Z][A-Z0-9_]{1,12})\b/g;

const WRITE_OP_KEYWORDS: Array<{ op: 'CREATE' | 'UPDATE' | 'DELETE'; words: RegExp }> = [
  { op: 'CREATE', words: /\b(create|insert|add|post|save\s+new|generate(?:\s+a\s+new)?)\b/i },
  { op: 'UPDATE', words: /\b(update|modify|change|amend|adjust|patch)\b/i },
  { op: 'DELETE', words: /\b(delete|remove|cancel|void)\b/i }
];

const LOGGING_RX = /\b(log|logging|application\s+log|slg1|audit\s+trail|error\s+capture)\b/i;

function corpusFor(obj: AbapObject): string {
  return [
    obj.description ?? '',
    ...(obj.keyLogic ?? []),
    ...(obj.dependencies ?? [])
  ].join('\n');
}

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

function detectWriteOps(corpus: string): string[] {
  const ops = new Set<string>();
  for (const entry of WRITE_OP_KEYWORDS) {
    if (entry.words.test(corpus)) ops.add(entry.op);
  }
  return Array.from(ops);
}

function detectRapScenario(obj: AbapObject, corpus: string): string | null {
  const type = (obj.objectType ?? '').toUpperCase();

  // The TDS object type itself is the strongest signal.
  if (type === 'BDEF' || type === 'BBEH' || /TP$/.test(obj.objectName ?? '')) {
    return /draft/i.test(corpus) ? 'DRAFT_ENABLED' : 'TRANSACTIONAL';
  }
  if (type === 'DDLS' || type === 'CDS') {
    return /analytical|report|kpi|aggregate/i.test(corpus) ? 'READ_ONLY_ANALYTICAL' : null;
  }
  if (type === 'CLAS' && /behavior|determination|validation/i.test(corpus)) {
    return 'TRANSACTIONAL';
  }
  // Heuristic: if the keyLogic talks about a transactional object explicitly
  if (/\b(rap|behavior\s+definition|managed\s+bo|custom\s+business\s+object)\b/i.test(corpus)) {
    return 'TRANSACTIONAL';
  }
  return null;
}

function detectLogging(corpus: string): boolean {
  return LOGGING_RX.test(corpus);
}

// ---------------------------------------------------------------------------
// HTTP helpers — same minimal POST as CleanCoreVerifier
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

export async function groundObjectForGeneration(
  obj: AbapObject,
  mcpPort: number = resolveMcpPort()
): Promise<GroundingContext> {

  const scannedAt = new Date().toISOString();
  const corpus    = corpusFor(obj);

  const detected = {
    sapTables:     detectSapTables(corpus),
    writeOps:      detectWriteOps(corpus),
    rapScenario:   detectRapScenario(obj, corpus),
    needsLogging:  detectLogging(corpus),
    fioriScenario: detectFioriScenario(corpus, obj.objectType),
    formScenario:  detectFormScenario(corpus)
  };

  const ctx: GroundingContext = {
    obj:             { name: obj.objectName, type: obj.objectType },
    scannedAt,
    mcpUnavailable:  false,
    grounding:       [],
    detected
  };

  // Nothing to ground -> skip MCP roundtrips entirely.
  const hasSomething =
    detected.sapTables.length > 0 ||
    detected.writeOps.length  > 0 ||
    detected.rapScenario      !== null ||
    detected.needsLogging ||
    detected.fioriScenario    !== null ||
    detected.formScenario     !== null;
  if (!hasSomething) return ctx;

  if (!(await isMcpUp(mcpPort))) {
    ctx.mcpUnavailable = true;
    return ctx;
  }

  // Build the call set in parallel. Each item independently swallows its own
  // error so one failing tool does not break the whole grounding pass.
  const calls: Promise<GroundingItem | null>[] = [];

  if (detected.rapScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-rap-pattern', { scenario: detected.rapScenario }, 5000)
        .then(res => renderRapPattern(detected.rapScenario!, res))
        .catch(() => null)
    );
  }

  for (const table of detected.sapTables) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-cds-view', { sap_table: table, use_case: obj.description }, 5000)
        .then(res => renderCdsView(table, res))
        .catch(() => null)
    );
  }

  // Write ops are emitted with a placeholder entity so the LLM substitutes
  // when it actually writes the EML.
  for (const op of detected.writeOps) {
    const entityHint = inferEntityHint(obj, detected.sapTables);
    calls.push(
      mcpPost(mcpPort, '/tools/get-eml-syntax', { operation: op, entity: entityHint }, 5000)
        .then(res => renderEml(op, entityHint, res))
        .catch(() => null)
    );
  }

  if (detected.needsLogging) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-application-log-pattern', { use_case: obj.description ?? 'GENERIC' }, 5000)
        .then(res => renderLog(res))
        .catch(() => null)
    );
  }

  if (detected.fioriScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-fiori-pattern', { scenario: detected.fioriScenario, entity_hint: obj.objectName }, 5000)
        .then(res => renderFioriPattern(detected.fioriScenario!, res))
        .catch(() => null)
    );
  }

  if (detected.formScenario) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-form-pattern', { scenario: detected.formScenario, form_name: obj.objectName }, 5000)
        .then(res => renderFormPattern(detected.formScenario!, res))
        .catch(() => null)
    );
  }

  const results = await Promise.all(calls);
  for (const r of results) {
    if (r) ctx.grounding.push(r);
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Renderers — turn tool responses into prompt-ready text blocks
// ---------------------------------------------------------------------------

function renderCdsView(table: string, res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (!d.found) {
    // Sprint 6 step (B): if MCP proposed a Z wrapper view, instruct the Code
    // Agent to SELECT from the proposed view. The TDS Agent grounding already
    // told the upstream pipeline to include the Z view as a separate DDLS
    // object — so by the time we reach code generation, that DDLS either is
    // being generated in the same deliverable (this object loop) or has
    // already been accepted.
    if (d.proposed && d.proposed.name) {
      return {
        heading: `Read access for ${table} -> ${d.proposed.name} (wrapper)`,
        tool:    'get_cds_view',
        body:
          `No released CDS view exists for ${table}. A wrapper Z CDS view ${d.proposed.name} ` +
          `is being created as a separate DDLS object in this deliverable. ` +
          `If your generated ABAP needs to read ${table}, SELECT FROM ${d.proposed.name} ` +
          `(Level ${d.proposed.level}) — NOT FROM ${table} directly.\n\n` +
          `If you are CURRENTLY generating the DDLS object ${d.proposed.name}, paste this template ` +
          `and populate the field list from the TDS inputOutputSpec:\n\n` +
          d.proposed.template
      };
    }
    return {
      heading: `Read access for ${table}`,
      tool:    'get_cds_view',
      body:
        `MCP reports NO released CDS view registered for ${table}. ` +
        `Do not generate a direct SELECT FROM ${table}. If a SAP API Hub I_* view exists for this table, ` +
        `use it. Otherwise, document the gap and propose a Level B alternative.`
    };
  }
  return {
    heading: `Read access for ${table} -> ${d.viewName}`,
    tool:    'get_cds_view',
    body:
      `Use released CDS view ${d.viewName} (Clean Core Level ${d.viewLevel}) in place of direct SELECT FROM ${table}.\n` +
      `Rationale: ${d.rationale}\n` +
      `Sample:\n${d.example}`
  };
}

function renderEml(op: string, entityHint: string, res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  return {
    heading: `EML ${op} pattern (entity hint: ${entityHint})`,
    tool:    'get_eml_syntax',
    body:
      `For ${op} operations on RAP-managed entities, use this Level A EML template ` +
      `(substitute the real BDEF/entity name when emitting code):\n${d.example}\n` +
      `Rationale: ${d.rationale}\n` +
      `Do NOT: ${d.doNotUse}`
  };
}

function renderRapPattern(scenario: string, res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}${o.notes ? ' — ' + o.notes : ''}`
  ).join('\n');
  return {
    heading: `RAP pattern: ${scenario}`,
    tool:    'get_rap_pattern',
    body:
      `${d.pattern}\n\nRequired objects (this drives the TDS object list, not classic PROG/FUGR):\n${objList}\n\n` +
      `Code skeleton:\n${d.codeTemplate}`
  };
}

function renderFioriPattern(scenario: string, res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}`
  ).join('\n');
  return {
    heading: `Fiori pattern: ${scenario}`,
    tool:    'get_fiori_pattern',
    body:
      `${d.pattern}\n\n` +
      `When to use: ${d.whenToUse}\n\n` +
      `Required objects (must appear in the deliverable, NOT classic CL_GUI_ALV_GRID / CALL SCREEN):\n${objList}\n\n` +
      `CDS @UI annotations:\n${d.cdsAnnotations}\n\n` +
      `manifest.json snippet:\n${d.manifestSnippet}`
  };
}

function renderFormPattern(scenario: string, res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}`
  ).join('\n');
  const warn = d.legacyWarning ? `\nLegacy warning: ${d.legacyWarning}` : '';
  return {
    heading: `Form pattern: ${scenario}`,
    tool:    'get_form_pattern',
    body:
      `${d.pattern}\n\n` +
      `When to use: ${d.whenToUse}\n\n` +
      `Required objects:\n${objList}\n\n` +
      `Driver template:\n${d.driverTemplate}\n\n` +
      `Do NOT: ${d.doNotUse}${warn}`
  };
}

function renderLog(res: any): GroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const p = res.data.pattern;
  if (!p) return null;
  return {
    heading: `SLG1 Application Log pattern (${p.patternId})`,
    tool:    'get_application_log_pattern',
    body:
      `Use SLG1 Application Log (object ${p.logObject}, subobject ${p.logSubobject}) for all logging. ` +
      `Required SAP FMs / classes: ${p.objectsNeeded.join(', ')}. Custom log tables are Level C and must NOT be generated.\n\n` +
      `Snippet:\n${p.example}`
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferEntityHint(obj: AbapObject, sapTables: string[]): string {
  // If the object IS the entity (BDEF/projection), use its own name.
  const type = (obj.objectType ?? '').toUpperCase();
  if (type === 'BDEF' || type === 'BBEH' || /TP$/.test(obj.objectName ?? '')) {
    return obj.objectName;
  }
  // If the keyLogic mentions a SAP table, infer the released RAP BDEF naming.
  if (sapTables.includes('VBAK') || sapTables.includes('VBAP')) return 'I_SalesOrderTP';
  if (sapTables.includes('EKKO') || sapTables.includes('EKPO')) return 'I_PurchaseOrderTP';
  if (sapTables.includes('BKPF') || sapTables.includes('BSEG')) return 'I_JournalEntryTP';
  // Fallback to a placeholder the LLM should replace
  return '<YourEntity>';
}

// ---------------------------------------------------------------------------
// Prompt rendering — what gets injected into the system prompt
// ---------------------------------------------------------------------------

export function renderGroundingForPrompt(ctx: GroundingContext): string {
  if (ctx.mcpUnavailable) {
    return [
      '## Grounded SAP knowledge (CPI-6 Sprint 3)',
      '',
      'The DarkHorse MCP server is currently unreachable. Generation is proceeding ',
      'WITHOUT grounded knowledge. Apply Clean Core rules carefully and rely on the ',
      'post-generation Clean Core verifier to catch defects.'
    ].join('\n');
  }
  if (ctx.grounding.length === 0) {
    return '';   // nothing relevant — no need to add empty section
  }

  const blocks = ctx.grounding.map(g =>
    `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
  ).join('\n\n');

  return [
    '## Grounded SAP knowledge (CPI-6 Sprint 3)',
    '',
    'The following SAP knowledge was retrieved from the DarkHorse MCP server BEFORE ',
    'generation. You MUST use these named objects and code templates instead of ',
    'inventing names or syntax. Failure to use these will be flagged as a Clean Core ',
    'violation by the post-generation verifier.',
    '',
    blocks
  ].join('\n');
}
