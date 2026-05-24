/**
 * TdsAgentGrounder — CPI-6 Sprint 4 pre-generation grounding for the TDS Agent.
 *
 * Same shape as CodeAgentGrounder but applied to the FDS instead of an
 * AbapObject. The TDS Agent's biggest failure mode is picking the WRONG
 * object types (defaulting to classic PROG/FUGR/CLAS instead of RAP
 * DDLS/BDEF/SRVD). Grounding it BEFORE the LLM call gives it the canonical
 * RAP object list to use for the abapObjectList.
 *
 * What gets detected from the FDS:
 *   - SAP standard tables in any field text  -> get_cds_view per table
 *   - Transactional verbs (create/update/...) -> get_rap_pattern TRANSACTIONAL
 *   - Report / analytical signals             -> get_rap_pattern READ_ONLY_ANALYTICAL
 *   - Custom-data signals                     -> get_cbo_pattern
 *   - Logging signals                         -> get_application_log_pattern
 *
 * The RICEFW type from state biases the detection: 'Report' tips toward
 * READ_ONLY_ANALYTICAL even if a few transactional verbs appear.
 *
 * Fails-open: MCP unreachable -> returns empty grounding, generation proceeds
 * with the LLM's own knowledge (and the new RAP-leaning system prompt).
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

export interface TdsGroundingItem {
  heading: string;
  tool:
    | 'get_cds_view'
    | 'get_rap_pattern'
    | 'get_cbo_pattern'
    | 'get_application_log_pattern'
    | 'get_fiori_pattern'
    | 'get_form_pattern'
    | 'enhancement_pattern';   // CPI-6 A8 — deterministic, no MCP
  body:    string;
}

/** CPI-6 A8 — Enhancement scenario classification. */
export type EnhancementScenarioGuess =
  | 'FIELD_LABEL_OVERRIDE'      // change field labels on standard transactions
  | 'CUSTOM_FIELD_ADDITION'     // add a new field to standard master/transactional data
  | 'SCREEN_BEHAVIOR'           // dynamic field visibility / mandatory / read-only
  | 'TRANSACTION_VALIDATION'    // validation on save / before posting
  | 'DETERMINATION_DEFAULT'     // auto-populate values from business rules
  | 'PROCESS_EXTENSION';        // hook business logic into a standard process

export interface TdsGroundingContext {
  ricefwType:      string;
  scannedAt:       string;
  mcpUnavailable:  boolean;
  grounding:       TdsGroundingItem[];
  detected: {
    sapTables:           string[];
    isTransactional:     boolean;
    isAnalytical:        boolean;
    needsCbo:            boolean;
    needsLogging:        boolean;
    rapScenario:         string | null;
    cboScenario:         string | null;
    fioriScenario:       FioriScenarioGuess | null;
    formScenario:        FormScenarioGuess | null;
    enhancementScenario: EnhancementScenarioGuess | null;   // CPI-6 A8
  };
}

// ---------------------------------------------------------------------------
// Shape we accept — same as FdsDocument but kept structurally typed so this
// module does not import the FDS type and avoid cycles.
// ---------------------------------------------------------------------------

interface FdsLike {
  title?: string;
  sections?: {
    businessBackground?:     string;
    processOverview?:        string;
    functionalRequirements?: Array<{ description?: string }>;
    inputOutputSpec?:        string;
    businessRules?:          string[];
    errorHandling?:          string[];
    authorization?:          string;
    reportingRequirements?:  string;
    uiDesign?:               string;
  };
}

// ---------------------------------------------------------------------------
// Detection — heuristics over the FDS corpus
// ---------------------------------------------------------------------------

const RX_TABLE_TOKEN = /\b([A-Z][A-Z0-9_]{1,12})\b/g;
const RX_TRANSACTIONAL = /\b(create|insert|add|post|save\s+new|update|modify|change|delete|cancel|maintain|process)\b/i;
const RX_ANALYTICAL    = /\b(report|alv|analytical|dashboard|kpi|aggregate|drill[-\s]?down|hierarchy)\b/i;
const RX_DRAFT         = /\b(draft|autosave|in[-\s]?progress\s+edit|work\s+in\s+progress)\b/i;
const RX_CBO_HINT      = /\b(custom\s+table|persistent\s+custom|store\s+custom|approval\s+status|audit\s+trail|ledger|business\s+object\s+for\s+(?:custom|new))\b/i;
const RX_LOGGING       = /\b(log|logging|application\s+log|slg1|audit\s+trail|error\s+capture)\b/i;

// CPI-6 A8 — Enhancement scenario detection. Runs only when the RICEFW
// type is "Enhancement" (we don't want to mis-categorise a Report or
// Interface as an Enhancement). Matches the FDS corpus against the
// well-known patterns the Clean Core extensibility framework distinguishes.
const ENH_PATTERNS: Array<{
  scenario: EnhancementScenarioGuess;
  rx:       RegExp;
}> = [
  // Field-label overrides on standard transactions / master data
  {
    scenario: 'FIELD_LABEL_OVERRIDE',
    rx:       /\b(field\s+label|label\s+change|rename\s+field|relabel|short\s+text|column\s+heading|field\s+description)\b/i
  },
  // New custom field on standard objects (Customer / Material / Vendor / Sales Order / etc.)
  {
    scenario: 'CUSTOM_FIELD_ADDITION',
    rx:       /\b(custom\s+field|new\s+field|additional\s+field|extension\s+field|z[-_]?field|append\s+structure|add\s+(?:a\s+)?field\s+to)\b/i
  },
  // Dynamic screen behavior (visible / hidden / mandatory / read-only)
  {
    scenario: 'SCREEN_BEHAVIOR',
    rx:       /\b(hide\s+field|show\s+field|mandatory\s+field|required\s+field|read[-\s]?only|field\s+visibility|grey(ed)?\s+out|field\s+control)\b/i
  },
  // Validation hooks fired on save / before posting
  {
    scenario: 'TRANSACTION_VALIDATION',
    rx:       /\b(validation|validate\s+(?:input|data|user)|check\s+(?:before|on)\s+save|prevent\s+save|reject\s+(?:save|post|create))\b/i
  },
  // Determinations / defaulting / auto-populate
  {
    scenario: 'DETERMINATION_DEFAULT',
    rx:       /\b(auto[-\s]?populate|default\s+value|derive(?:d)?\s+from|determination|pre[-\s]?fill|auto[-\s]?fill|set\s+(?:the\s+)?(?:default|value))\b/i
  },
  // Generic hook into a standard business process
  {
    scenario: 'PROCESS_EXTENSION',
    rx:       /\b(extend\s+(?:the\s+)?(?:standard|sap)|hook\s+into|append\s+logic|after\s+save|before\s+save|process\s+extension|side[-\s]?effect)\b/i
  }
];

function detectEnhancementScenario(
  corpus: string,
  ricefwType: string
): EnhancementScenarioGuess | null {
  if ((ricefwType ?? '').trim().toLowerCase() !== 'enhancement') return null;
  for (const p of ENH_PATTERNS) {
    if (p.rx.test(corpus)) return p.scenario;
  }
  // Even a vague Enhancement BR should get the Clean Core steering. Default
  // to PROCESS_EXTENSION so the developer sees the Key User Extensibility
  // recommendation rather than a generic user-exit hallucination.
  return 'PROCESS_EXTENSION';
}

function renderEnhancementPattern(scenario: EnhancementScenarioGuess): TdsGroundingItem {
  const heading: Record<EnhancementScenarioGuess, string> = {
    FIELD_LABEL_OVERRIDE:    'Enhancement scenario: Field-label override',
    CUSTOM_FIELD_ADDITION:   'Enhancement scenario: Custom-field addition',
    SCREEN_BEHAVIOR:         'Enhancement scenario: Dynamic screen behavior',
    TRANSACTION_VALIDATION:  'Enhancement scenario: Transaction validation',
    DETERMINATION_DEFAULT:   'Enhancement scenario: Determination / defaulting',
    PROCESS_EXTENSION:       'Enhancement scenario: Standard-process extension'
  };
  const recommended: Record<EnhancementScenarioGuess, string[]> = {
    FIELD_LABEL_OVERRIDE: [
      'Clean Core first choice (Level A): SAP standard text customization in SPRO — for most field labels there is a customizing table you can adjust without any ABAP.',
      'Second choice (Level A): SAP S/4HANA Fiori app "Manage Customer/Material/etc. — Field Labels" or the per-object "Configure UI" admin tool.',
      'Third choice (Level B, only if the above does not cover the field): Key User Extensibility → Custom Fields and Logic (UI label override via the published BAdI for the field).',
      'NEVER: classic user exit (USEREXIT_*), screen-modification module pool, or DDIC modification of standard data elements. Those break Clean Core, do not survive upgrades, and the post-generation verifier will flag them.'
    ],
    CUSTOM_FIELD_ADDITION: [
      'Clean Core first choice (Level A): Key User Extensibility → Custom Fields and Logic (Fiori app). Creates an append structure and exposes the field through the released business contexts (CDS extensions, UI, OData, search, value help) automatically.',
      'Second choice (Level A/B): Custom Business Object via Key User Extensibility when the field belongs to a new entity rather than an extension of standard.',
      'Allowed only with explicit Level B justification: append structure + classic BAdI implementation, when the released business context does not yet cover the target table.',
      'NEVER: direct DDIC modification of standard tables / structures. NEVER classic user exit screen mods to display the new field.'
    ],
    SCREEN_BEHAVIOR: [
      'Clean Core first choice (Level A): SAP S/4HANA Fiori app field-control / "UI Adaptation at runtime" (drag-and-drop hide/show/mandatory).',
      'Second choice (Level A): Custom Fields and Logic → Field Behavior BAdI for declarative rules.',
      'Third choice (Level B): released BAdI implementation that returns the desired field-control state. Use the BAdI catalog to find the right released spot for the object you are extending.',
      'NEVER: classic LOOP AT SCREEN / MODIFY SCREEN inside a user exit on a GUI dynpro. Those run on SAP GUI screens that no longer exist in the Fiori-first runtime.'
    ],
    TRANSACTION_VALIDATION: [
      'Clean Core first choice (Level A): Key User Extensibility → Custom Fields and Logic, Business Add-In "Pre-Save" or "Validation" exit point.',
      'Second choice (Level A): RAP behavior validation (define validation in BDEF) when the object is a custom business object or has a RAP-managed behavior pool.',
      'Third choice (Level B): released BAdI implementation. Always use the BAdI catalog to confirm the spot is released.',
      'NEVER: classic USEREXIT_SAVE_DOCUMENT_PREPARE / FORM-based exit. They are not part of the released ABAP-for-Cloud-Development scope.'
    ],
    DETERMINATION_DEFAULT: [
      'Clean Core first choice (Level A): RAP determination (define determination on $update / $create) for custom business objects.',
      'Second choice (Level A): Key User Extensibility → Custom Fields and Logic, "Default Value" exit.',
      'Third choice (Level B): released BAdI implementation.',
      'NEVER: classic ABAP user exit USEREXIT_MOVE_FIELD_TO_VBAK / FORM-based default routines. Those modify standard transaction state outside the released contract.'
    ],
    PROCESS_EXTENSION: [
      'Clean Core first choice (Level A): RAP action / business event subscription if a released event exists for the trigger point.',
      'Second choice (Level A): Key User Extensibility → Custom Fields and Logic, "Post-Save" or "Side-Effect" exit point.',
      'Third choice (Level B): released BAdI implementation. The BAdI catalog (MCP) confirms whether the spot is released and what its interface looks like.',
      'NEVER: classic SUBMIT / CALL TRANSACTION chain off a user exit. Those are forbidden in ABAP Cloud and create brittle inter-transaction dependencies.'
    ]
  };
  const body =
    `The BR/FDS for this Enhancement matches the "${scenario}" pattern. ` +
    `Apply the Clean Core extensibility hierarchy in order — pick the FIRST ` +
    `option that fits the requirement, and only fall back to the next when ` +
    `the previous truly does not cover it:\n\n` +
    recommended[scenario].map(s => `- ${s}`).join('\n') +
    `\n\nThe abapObjectList you produce should reflect this choice. Examples:\n` +
    `  - Configuration only:        no abapObjectList entries; emit a CONFIG row with the SPRO path.\n` +
    `  - Key User Extensibility:    abapObjectList of object type DCLS / DDLX (annotation override) or a CFL_RULE descriptor row; NO PROG / CLAS / ENHC.\n` +
    `  - BAdI implementation:       one ENHO (Enhancement Implementation) entry per BAdI, plus a CLAS for the implementing class. The BAdI name MUST be a released spot — confirm via the MCP BAdI catalog.\n` +
    `  - RAP behavior:              BDEF + ZBP_I_<Entity> CLAS, only if the entity is custom (or the released BDEF exposes the right extension point).\n\n` +
    `DO NOT produce classic user-exit programs (ZCUSTOMER_LABEL_EXIT-style PROG with FORM-based routines), MODULE statements on standard dynpros, or DDIC modifications. The post-generation Clean Core verifier flags those as Level B with this same recommendation block.`;
  return {
    heading: heading[scenario],
    tool:    'enhancement_pattern',
    body
  };
}

function corpusFor(fds: FdsLike): string {
  const s = fds.sections ?? {};
  return [
    fds.title ?? '',
    s.businessBackground ?? '',
    s.processOverview ?? '',
    ...(s.functionalRequirements ?? []).map(r => r.description ?? ''),
    s.inputOutputSpec ?? '',
    ...(s.businessRules ?? []),
    ...(s.errorHandling ?? []),
    s.authorization ?? '',
    s.reportingRequirements ?? '',
    s.uiDesign ?? ''
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

function detectScenario(
  corpus: string,
  ricefwType: string
): { rapScenario: string | null; isTransactional: boolean; isAnalytical: boolean } {

  const isTransactional = RX_TRANSACTIONAL.test(corpus);
  const isAnalytical    = RX_ANALYTICAL.test(corpus);
  const ricefwIsReport  = /^report\b/i.test(ricefwType);

  // RICEFW type biases the call: a Report RICEFW always goes analytical even
  // if a few transactional verbs appear in the body.
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
  // Try to extract a short scenario hint — the surrounding sentence.
  const m = corpus.match(/[^.\n]*\b(custom\s+table|persistent\s+custom|store\s+custom|approval\s+status|audit\s+trail|ledger)\b[^.\n]*/i);
  return {
    needsCbo: true,
    scenario: (m?.[0] ?? '').trim().slice(0, 80) || 'custom business object'
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers — minimal POST/GET, same as CleanCoreVerifier
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

export async function groundFdsForTds(
  fds: FdsLike,
  ricefwType: string,
  mcpPort: number = resolveMcpPort()
): Promise<TdsGroundingContext> {

  const scannedAt = new Date().toISOString();
  const corpus    = corpusFor(fds);

  const scenarioInfo = detectScenario(corpus, ricefwType);
  const cboInfo      = detectCbo(corpus);

  const detected = {
    sapTables:           detectSapTables(corpus),
    isTransactional:     scenarioInfo.isTransactional,
    isAnalytical:        scenarioInfo.isAnalytical,
    needsCbo:            cboInfo.needsCbo,
    needsLogging:        RX_LOGGING.test(corpus),
    rapScenario:         scenarioInfo.rapScenario,
    cboScenario:         cboInfo.scenario,
    fioriScenario:       detectFioriScenario(corpus, ricefwType),
    formScenario:        detectFormScenario(corpus),
    enhancementScenario: detectEnhancementScenario(corpus, ricefwType)
  };

  const ctx: TdsGroundingContext = {
    ricefwType,
    scannedAt,
    mcpUnavailable: false,
    grounding:      [],
    detected
  };

  // CPI-6 A8 — Enhancement-scenario grounding is deterministic, no MCP
  // round-trip required. Push it first so it lands at the top of the
  // prompt block where it has the most influence on the LLM's plan.
  if (detected.enhancementScenario) {
    ctx.grounding.push(renderEnhancementPattern(detected.enhancementScenario));
  }

  const hasSomething =
    detected.sapTables.length > 0 ||
    detected.rapScenario !== null ||
    detected.needsCbo ||
    detected.needsLogging ||
    detected.fioriScenario !== null ||
    detected.formScenario !== null ||
    detected.enhancementScenario !== null;
  if (!hasSomething) return ctx;

  if (!(await isMcpUp(mcpPort))) {
    ctx.mcpUnavailable = true;
    return ctx;
  }

  const calls: Promise<TdsGroundingItem | null>[] = [];

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

  if (detected.needsLogging) {
    calls.push(
      mcpPost(mcpPort, '/tools/get-application-log-pattern', { use_case: ricefwType }, 5000)
        .then(res => renderLog(res))
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
// Renderers
// ---------------------------------------------------------------------------

function renderRapPattern(scenario: string, res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}${o.notes ? ' — ' + o.notes : ''}`
  ).join('\n');
  return {
    heading: `RAP pattern: ${scenario}`,
    tool:    'get_rap_pattern',
    body:
      `${d.pattern}\n\nRequired objects — these are the SAP object TYPES the TDS abapObjectList MUST contain (not PROG / FUGR / classic CLAS):\n${objList}`
  };
}

function renderCboPattern(scenario: string, res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}${o.notes ? ' — ' + o.notes : ''}`
  ).join('\n');
  return {
    heading: `CBO pattern for: ${scenario}`,
    tool:    'get_cbo_pattern',
    body:
      `${d.pattern}\n\nRequired CBO objects — include these in the TDS abapObjectList instead of a single Z-table:\n${objList}\n\nRationale: ${d.rationale}`
  };
}

function renderCdsView(table: string, res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  if (!d.found) {
    // Sprint 6 step (B): when a released view is missing but MCP proposed a
    // wrapper, instruct the TDS Agent to add the proposal as a separate DDLS
    // object in the abapObjectList.
    if (d.proposed && d.proposed.name) {
      return {
        heading: `Read access for ${table} -> propose ${d.proposed.name} (wrapper DDLS)`,
        tool:    'get_cds_view',
        body:
          `No released CDS view exists for ${table}. ` +
          `INCLUDE a new DDLS object named ${d.proposed.name} in the abapObjectList ` +
          `(separate sequence, BEFORE the program that consumes it). The TDS pseudocode ` +
          `for any "read ${table}" step MUST reference ${d.proposed.name}, not ${table} directly.\n\n` +
          `DDL template for the new view (Level ${d.proposed.level}):\n\n` +
          d.proposed.template +
          `\n\nField list is a placeholder — populate it from the FDS inputOutputSpec.`
      };
    }
    return {
      heading: `Read access for ${table}`,
      tool:    'get_cds_view',
      body:    `MCP reports NO released CDS view registered for ${table}. Document the gap in openItems; do not direct-SELECT in the TDS pseudocode.`
    };
  }
  return {
    heading: `Read access for ${table} -> ${d.viewName}`,
    tool:    'get_cds_view',
    body:    `Use released CDS view ${d.viewName} (Level ${d.viewLevel}) in place of direct SELECT FROM ${table}. The TDS pseudocode for any "read ${table}" step should reference ${d.viewName}.`
  };
}

function renderFioriPattern(scenario: string, res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}${o.notes ? ' — ' + o.notes : ''}`
  ).join('\n');
  return {
    heading: `Fiori pattern: ${scenario}`,
    tool:    'get_fiori_pattern',
    body:
      `${d.pattern}\n\n` +
      `When to use: ${d.whenToUse}\n\n` +
      `Required objects — these MUST appear in the TDS abapObjectList for any UI-bearing ` +
      `object (CDS + SRVD + SRVB + UI5 app):\n${objList}\n\n` +
      `CDS @UI annotations to paste into the projection CDS:\n${d.cdsAnnotations}`
  };
}

function renderFormPattern(scenario: string, res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const d = res.data;
  const objList = (d.requiredObjects ?? []).map((o: any) =>
    `  - ${o.role}: type=${o.type}, naming=${o.namingHint}${o.notes ? ' — ' + o.notes : ''}`
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

function renderLog(res: any): TdsGroundingItem | null {
  if (!res?.ok || !res.data) return null;
  const p = res.data.pattern;
  if (!p) return null;
  return {
    heading: `SLG1 Application Log pattern (${p.patternId})`,
    tool:    'get_application_log_pattern',
    body:    `Use SLG1 Application Log (object ${p.logObject}, subobject ${p.logSubobject}) for all logging. Required SAP FMs: ${p.objectsNeeded.join(', ')}. Do NOT propose a custom log table in the TDS.`
  };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderTdsGroundingForPrompt(ctx: TdsGroundingContext): string {
  // Deterministic items (enhancement_pattern) ship regardless of MCP
  // availability — they don't need retrieval. CPI-6 A8.
  const deterministicTools = new Set(['enhancement_pattern']);
  const deterministicItems = ctx.grounding.filter(g => deterministicTools.has(g.tool));

  if (ctx.mcpUnavailable) {
    const banner = [
      '## Grounded SAP knowledge for TDS object planning',
      '',
      'The DarkHorse MCP server is currently unreachable. Retrieved-knowledge ',
      'blocks (CDS view names, RAP / CBO / Fiori / Form patterns, SLG1) are ',
      'omitted for this run. Apply Clean Core rules carefully — favor RAP ',
      '(BDEF / DDLS / SRVD) over classic PROG / FUGR for transactional objects, ',
      'and CBO pattern over Z-table + INSERT for custom persistent data.'
    ].join('\n');
    if (deterministicItems.length === 0) return banner;
    const blocks = deterministicItems.map(g =>
      `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
    ).join('\n\n');
    return `${banner}\n\nThe following deterministic Clean Core rules still apply:\n\n${blocks}`;
  }
  if (ctx.grounding.length === 0) {
    return '';
  }
  const blocks = ctx.grounding.map(g =>
    `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
  ).join('\n\n');

  return [
    '## Grounded SAP knowledge for TDS object planning (CPI-6 Sprint 4)',
    '',
    'The following SAP knowledge was retrieved from the DarkHorse MCP server BEFORE ',
    'TDS generation. The abapObjectList you produce MUST be aligned with these ',
    'patterns. Specifically:',
    '- When a RAP pattern is provided, the abapObjectList objectType values MUST ',
    '  come from the pattern\'s `type` column (DDLS, BDEF, CLAS, SRVD, SRVB) — NOT ',
    '  generic PROG or FUGR.',
    '- When a CBO pattern is provided, the abapObjectList MUST include each of the ',
    '  CBO required objects with their canonical types and naming hints.',
    '- When a CDS view is recommended for an SAP standard table, every TDS keyLogic ',
    '  step that reads that table MUST reference the CDS view name, not the table.',
    '',
    blocks,
    '',
    '## Clean Core three-layer completeness (CPI-6 A1)',
    '',
    'Service exposure is a DELIBERATE choice, not the default for every entity ',
    'mentioned in the FDS. Identify the entity (or entities) the FDS explicitly ',
    'nominates for service exposure — typically the one the end user navigates ',
    'to in the Fiori app, or that an external consumer calls via OData. For ',
    'THAT entity (and only that one), the abapObjectList MUST include the full ',
    'layer set:',
    '  1. DDLS ZI_<Entity>            — Interface CDS view (pure projection)',
    '  2. DDLS ZC_<Entity>            — Consumption CDS view (carries @UI / @Search)',
    '  3. SRVD ZUI_<Entity>           — Service definition (exposes ZC_<Entity>)',
    '  4. SRVB ZUI_<Entity>_O4        — OData V4 service binding',
    '  5. DCLS ZI_<Entity>            — DCL access role (protects ZI_<Entity>)',
    'And IF the service-exposed entity is transactional (create / update / ',
    'delete in the FDS), add ALL of these as well:',
    '  6. BDEF ZI_<Entity>            — Behavior definition',
    '  7. CLAS ZBP_I_<Entity>         — Behavior projection class',
    '  8. CLAS ZCL_TEST_<Entity>      — ABAP Unit test class',
    '',
    'For BUILDING-BLOCK entities — ones the service-exposed view consumes by ',
    'association or join (header + items, customer master, configuration views, ',
    'lookup views) — keep them as a SINGLE interface view ZI_<BuildingBlock>. ',
    'Do NOT generate ZC_/SRVD/SRVB/DCL/BDEF/ZBP/test for these. They are ',
    'reusable projections, not standalone services.',
    '',
    'Example pattern (one top entity + three building blocks):',
    '  - Top entity (service-exposed):',
    '      ZI_ROUTING_DETAIL, ZC_ROUTING_DETAIL, ZUI_ROUTING_DETAIL, ',
    '      ZUI_ROUTING_DETAIL_O4, ZI_ROUTING_DETAIL (DCL),',
    '      ZI_ROUTING_DETAIL (BDEF), ZBP_I_ROUTING_DETAIL, ZCL_TEST_ROUTING_DETAIL',
    '  - Building blocks (consumed by ZI_ROUTING_DETAIL via association):',
    '      ZI_DELIVERY_HEADER, ZI_DELIVERY_ITEM, ZI_CUSTOMER_SALES',
    '  - Total: 8 + 3 = 11 objects (NOT 4 × 8 = 32).',
    '',
    'Heuristic: ask "would an end user open this entity in Fiori or call its ',
    'OData endpoint?" If yes -> full stack. If no -> single ZI_ only.'
  ].join('\n');
}
