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
  tool:     'get_cds_view' | 'get_eml_syntax' | 'get_rap_pattern' | 'get_application_log_pattern' | 'get_fiori_pattern' | 'get_form_pattern' | 'sibling_wrapper' | 'layer_role' | 'hana_pushdown' | 'cloud_readiness';
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
// Cloud-readiness grounding — CPI-6 A6
// ---------------------------------------------------------------------------

/**
 * Emit ABAP Cloud / BTP cloud-readiness rules. Deterministic — no MCP, no
 * retrieval. Fires for the same object types as the HANA push-down block
 * (PROG / CLAS / FUNC), since DDLS / BDEF / SRVD / SRVB / DCLS are by
 * construction cloud-compatible artefacts.
 */
function detectCloudReadinessGrounding(obj: AbapObject): GroundingItem | null {
  const type = (obj.objectType ?? '').trim().toUpperCase();
  if (type !== 'PROG' && type !== 'CLAS' && type !== 'FUNC') return null;
  return {
    heading: 'ABAP Cloud / BTP readiness',
    tool:    'cloud_readiness',
    body:
      `Treat this code as ABAP-for-Cloud-Development (ABAP Environment on BTP, ` +
      `S/4HANA Cloud Public Edition, or any cloud-flagged code unit). The ` +
      `following statements are NOT released and MUST NOT appear in your ` +
      `output — every one will fail the cloud syntax check:\n\n` +
      `  - CALL TRANSACTION '<txn>' / LEAVE TO TRANSACTION — no SAP GUI ` +
      `at runtime. Expose the action through a RAP action on the behavior ` +
      `definition instead, or invoke the target's released OData service.\n` +
      `  - SUBMIT <report> — classic reports are not part of cloud scope. ` +
      `Lift the logic into a class method and call it directly, or ` +
      `schedule a class via cl_bgmc (Background Processing as a Service).\n` +
      `  - CALL SCREEN <n> / dynpro — no classic screens in the cloud.\n` +
      `  - OPEN DATASET — no application-server filesystem access. Use ` +
      `document services, attachments, or pull/push the payload via an ` +
      `SFTP Communication Arrangement.\n` +
      `  - WAIT UP TO ... SECONDS — blocks the work process. Restructure ` +
      `as an asynchronous workflow (business event + subscriber).\n` +
      `  - CALL FUNCTION '<rfc>' DESTINATION '<literal>' — no hard-coded ` +
      `destinations. Resolve the destination via Communication Arrangement: ` +
      `cl_com_arrangement_factory=>create_arrangement_factory( ) and pass ` +
      `the resolved cl_dest_* object to CALL FUNCTION.\n\n` +
      `Released alternative reference: only APIs marked "released for Cloud ` +
      `Development" in the SAP API Hub or shipped under sap.* / cl_ released ` +
      `namespaces may be used. When in doubt, prefer RAP actions, business ` +
      `events, application log (SLG1), and OData consumption over any ` +
      `classic ABAP communication primitive.`
  };
}

// ---------------------------------------------------------------------------
// HANA push-down grounding — CPI-6 A4
// ---------------------------------------------------------------------------

/**
 * Emit a HANA push-down rule block tuned to the object type. Deterministic
 * — no MCP, no retrieval — so it ships regardless of MCP availability.
 *
 *   - DDLS: CDS push-down patterns (associations over joins, aggregation in
 *     CDS, $projection, performance-relevant annotations).
 *   - PROG / CLAS / FUNC: forbid ENDSELECT loops, SELECT *, nested SELECT
 *     in LOOP. Steer toward SELECT INTO TABLE + FOR ALL ENTRIES OF or CDS
 *     association traversal.
 *
 * Returns null when the object type is not one of the above (e.g. SRVB,
 * DCLS, BDEF) — those have their own layer-role rules already.
 */
function detectHanaPushdownGrounding(obj: AbapObject): GroundingItem | null {
  const type = (obj.objectType ?? '').trim().toUpperCase();
  if (type === 'DDLS') {
    return {
      heading: 'HANA push-down (CDS)',
      tool:    'hana_pushdown',
      body:
        `This CDS view will run on HANA. Apply these push-down rules:\n\n` +
        `  - Prefer ASSOCIATIONS over JOIN for navigation. Define ` +
        `\`association [0..*] to <Target> as _<role> on $projection.<key> = _<role>.<key>\` ` +
        `and let consumers traverse \`_<role>.<field>\`. HANA prunes ` +
        `un-traversed associations at runtime; static joins do not prune.\n` +
        `  - Aggregate in CDS, not in ABAP. Use \`@DefaultAggregation: #SUM\` ` +
        `(or #MIN / #MAX / #AVG / #COUNT) on the measure fields. The ` +
        `aggregation runs in the HANA engine; ABAP-side SUMs round-trip ` +
        `every row.\n` +
        `  - Project explicitly with \`$projection.<field>\` rather than ` +
        `re-selecting from the source. This keeps the optimiser informed ` +
        `about which fields are actually consumed.\n` +
        `  - Avoid CASE expressions that block column pruning. When a ` +
        `derived column has a single source field, expose it directly.`
    };
  }
  if (type === 'PROG' || type === 'CLAS' || type === 'FUNC') {
    return {
      heading: 'HANA push-down (ABAP)',
      tool:    'hana_pushdown',
      body:
        `Apply these HANA push-down rules to all database reads in this object:\n\n` +
        `  - Do NOT use SELECT ... ENDSELECT. Open-cursor loops issue a ` +
        `roundtrip per row. Use \`SELECT <fields> FROM <source> INTO TABLE ` +
        `@DATA(lt_data) WHERE ... .\` and iterate the internal table.\n` +
        `  - Do NOT use SELECT *. Project only the fields the program ` +
        `actually consumes. Column-store pruning depends on it.\n` +
        `  - Do NOT issue a SELECT inside a LOOP. Either:\n` +
        `      (a) Use a CDS view that joins / associates the entities and ` +
        `select once from that view; OR\n` +
        `      (b) Pull the outer set into an internal table, then \`SELECT ` +
        `<fields> FROM <inner> FOR ALL ENTRIES OF @lt_outer WHERE key = ` +
        `@lt_outer-key INTO TABLE @DATA(lt_inner).\`\n` +
        `  - Prefer CDS view consumption (SELECT FROM ZI_/ZC_/I_ views) over ` +
        `raw table SELECTs — the view encodes the push-down friendly shape.`
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer role detection — CPI-6 A1
// ---------------------------------------------------------------------------

/**
 * Identify which Clean Core three-layer role the current object plays and
 * return prompt-ready instructions specific to that role. Returns null when
 * the object doesn't fit a recognized layer pattern — most non-CDS objects
 * fall through here and the grounder skips the layer-role block.
 */
function detectLayerRoleGrounding(obj: AbapObject): GroundingItem | null {
  const name = (obj.objectName ?? '').trim().toUpperCase();
  const type = (obj.objectType ?? '').trim().toUpperCase();

  // Order matters: SRVB binding (_O4) before SRVD service.
  if (type === 'SRVB' && /^ZUI_[A-Z][A-Z0-9_]*_O4$/.test(name)) {
    const stem = name.replace(/^ZUI_/, '').replace(/_O4$/, '');
    return {
      heading: 'Clean Core layer role: Service Binding (SRVB, OData v4)',
      tool:    'layer_role',
      body:
        `You are generating the service binding ${name}. Required shape:\n\n` +
        `  - Binding type: OData V4\n` +
        `  - Binding scope: ODATA\n` +
        `  - Service definition referenced: ZUI_${stem}\n\n` +
        `Do NOT redeclare entities here. Service bindings only point at a ` +
        `service definition; the entity set is taken from the SRVD's exposed view.`
    };
  }

  if (type === 'SRVD' && /^ZUI_[A-Z][A-Z0-9_]*$/.test(name)) {
    const stem = name.replace(/^ZUI_/, '');
    return {
      heading: 'Clean Core layer role: Service Definition (SRVD)',
      tool:    'layer_role',
      body:
        `You are generating the service definition ${name}. STRICT rules:\n\n` +
        `  - The body must read: define service ${name} { expose ZC_${stem}; }\n` +
        `  - You MUST expose the consumption view ZC_${stem}.\n` +
        `  - You MUST NOT expose the interface view ZI_${stem} directly. ` +
        `Interface views skip the projection layer (UI annotations, value ` +
        `helps, field-level authorization) and produce a brittle service ` +
        `contract — the Clean Core verifier flags this as a violation.\n` +
        `  - Add a @AccessControl.authorizationCheck: #CHECK annotation.`
    };
  }

  if (type === 'DDLS' && /^ZI_[A-Z][A-Z0-9_]*$/.test(name)) {
    const stem = name.replace(/^ZI_/, '');
    return {
      heading: 'Clean Core layer role: Interface CDS View (ZI_*)',
      tool:    'layer_role',
      body:
        `You are generating the interface view ${name}. STRICT rules:\n\n` +
        `  - Interface views are PURE projections of source data. Project ` +
        `every business-meaningful field from the source table or composite ` +
        `view; rename only when SAP naming conventions demand it.\n` +
        `  - DO NOT emit any of these annotations on this view: ` +
        `@UI.*, @Search.searchable, @ObjectModel.*, @ObjectModel.semanticKey, ` +
        `@Consumption.*. They belong on the consumption view ZC_${stem}.\n` +
        `  - Required header annotations: @AccessControl.authorizationCheck: #CHECK ` +
        `and @EndUserText.label: '<short description>'.\n` +
        `  - Allowed: associations to other ZI_* views and to SAP I_* released views.`
    };
  }

  if (type === 'DDLS' && /^ZC_[A-Z][A-Z0-9_]*$/.test(name)) {
    const stem = name.replace(/^ZC_/, '');
    return {
      heading: 'Clean Core layer role: Consumption CDS View (ZC_*)',
      tool:    'layer_role',
      body:
        `You are generating the consumption view ${name}. STRICT rules:\n\n` +
        `  - This view MUST project from the interface view ZI_${stem} ` +
        `(define view entity ${name} as projection on ZI_${stem}). Do not ` +
        `SELECT FROM raw tables here.\n` +
        `  - @UI annotations live HERE, not on the interface view. Add ` +
        `@UI.headerInfo, @UI.lineItem, @UI.identification, @UI.selectionField ` +
        `as appropriate for the Fiori Elements floorplan.\n` +
        `  - Add @Search.searchable: true on the entity and @Search.defaultSearchElement: ` +
        `true on text-bearing fields.\n` +
        `  - Add @ObjectModel.semanticKey: [ '...' ] reflecting the key.\n` +
        `  - Required header annotations: @AccessControl.authorizationCheck: #CHECK ` +
        `and @EndUserText.label: '<short description>'.`
    };
  }

  if (type === 'BDEF' && /^ZI_[A-Z][A-Z0-9_]*$/.test(name)) {
    return {
      heading: 'Clean Core layer role: Behavior Definition (BDEF)',
      tool:    'layer_role',
      body:
        `You are generating the behavior definition for ${name}. Required shape:\n\n` +
        `  - First line: managed implementation in class ZBP_${name} unique;\n` +
        `  - Define behavior for ${name} alias <Entity>\n` +
        `  - Declare CREATE / UPDATE / DELETE only for operations the TDS ` +
        `key logic explicitly calls for. Read-only entities omit this.\n` +
        `  - Persistent table reference uses the underlying Z table when one ` +
        `exists in this deliverable; otherwise the LLM must NOT invent a ` +
        `persistent-table name.\n` +
        `  - Authorization: declare authorization master ( instance ) on the ` +
        `entity. Do NOT inline AUTHORITY-CHECK in the BDEF — that lives in ` +
        `the DCL role for ${name} and (for behaviors) in the projection class.`
    };
  }

  if (type === 'CLAS' && /^ZBP_I_[A-Z][A-Z0-9_]*$/.test(name)) {
    const stem = name.replace(/^ZBP_I_/, '');
    return {
      heading: 'Clean Core layer role: Behavior Projection Class (ZBP_I_*)',
      tool:    'layer_role',
      body:
        `You are generating the behavior projection class ${name} for ` +
        `entity ZI_${stem}. STRICT rules:\n\n` +
        `  - CLASS ${name} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ZI_${stem}.\n` +
        `  - Implement only determinations, validations, and actions the ` +
        `BDEF declares. Do not invent behaviors not in the BDEF.\n` +
        `  - Use EML (MODIFY ENTITIES OF ${name}) for any side-effect writes.\n` +
        `  - Authorization: rely on the DCL role attached to ZI_${stem}. Do ` +
        `NOT emit classic AUTHORITY-CHECK statements here — they bypass the ` +
        `DCL contract and the post-generation Clean Core verifier will flag ` +
        `them as a layering violation.\n` +
        `  - Tests: append a LOCAL test class ltcl_${stem.toLowerCase()} ` +
        `DEFINITION FOR TESTING after the main implementation. Skeleton:\n\n` +
        `      class ltcl_${stem.toLowerCase()} definition deferred.\n` +
        `      class ${name} definition local friends ltcl_${stem.toLowerCase()}.\n\n` +
        `      class ltcl_${stem.toLowerCase()} definition\n` +
        `        for testing risk level harmless duration short final.\n` +
        `        private section.\n` +
        `          class-data: env type ref to if_cds_test_environment.\n` +
        `          class-methods: class_setup, class_teardown.\n` +
        `          methods: setup, teardown,\n` +
        `                   validate_<rule>      for testing raising cx_static_check,\n` +
        `                   determine_<field>    for testing raising cx_static_check.\n` +
        `      endclass.\n\n` +
        `    Implement at least one test per declared validation and one ` +
        `per declared determination, asserting with cl_abap_unit_assert.`
    };
  }

  if (type === 'CLAS' && /^(?:ZCL_TEST_|ZTCL_)[A-Z][A-Z0-9_]*$/.test(name)) {
    // Strip whichever convention prefix is present.
    const stem = name.replace(/^ZCL_TEST_/, '').replace(/^ZTCL_/, '');
    return {
      heading: 'Clean Core layer role: ABAP Unit Test Class',
      tool:    'layer_role',
      body:
        `You are generating the global ABAP Unit test class ${name} for ` +
        `entity ZI_${stem}. Required shape:\n\n` +
        `  - CLASS ${name} DEFINITION PUBLIC FINAL\n` +
        `    FOR TESTING RISK LEVEL HARMLESS DURATION SHORT\n` +
        `    CREATE PUBLIC.\n` +
        `  - Use cl_cds_test_environment=>create( i_for_entity = 'ZI_${stem}' ) ` +
        `in CLASS_SETUP to spin up CDS doubles and tear down in CLASS_TEARDOWN.\n` +
        `  - Use cl_abap_unit_assert=>assert_equals / =>assert_initial / ` +
        `=>assert_bound / =>fail for assertions.\n` +
        `  - Cover the behaviors declared in the BDEF: at minimum one test per ` +
        `validation, one per determination, and one happy-path EML round-trip.\n` +
        `  - Test method shape: METHODS <name> FOR TESTING RAISING cx_static_check.\n` +
        `  - Do NOT make HTTP calls or call live SAP RFCs in tests — use the ` +
        `CDS test double environment exclusively.`
    };
  }

  if (type === 'DCLS' && /^ZI_[A-Z][A-Z0-9_]*$/.test(name)) {
    const stem = name.replace(/^ZI_/, '');
    return {
      heading: 'Clean Core layer role: Data Control Language Role (DCLS)',
      tool:    'layer_role',
      body:
        `You are generating the DCL access role ${name} that protects the ` +
        `interface view ZI_${stem}. STRICT rules:\n\n` +
        `  - Skeleton:\n` +
        `      @MappingRole: true\n` +
        `      define role ${name} {\n` +
        `        grant select on ZI_${stem}\n` +
        `          where (<filter expression bound to the entity's key>)\n` +
        `          = aspect pfcg_auth ( <PFCG_OBJECT>,\n` +
        `              <PFCG_FIELD_1> = <field_1>,\n` +
        `              ACTVT = '03' );\n` +
        `      }\n\n` +
        `  - The role name MUST match the protected interface view name ` +
        `(${name} protects ZI_${stem}) — this is the SAP convention DCL ` +
        `inference relies on.\n` +
        `  - Use aspect pfcg_auth to bind PFCG authorization objects. Do not ` +
        `attempt to express auth via raw WHERE clauses unless the rule has ` +
        `no PFCG equivalent.\n` +
        `  - Read-only access uses ACTVT = '03'. Map other write activities ` +
        `from the BDEF allowed-actions list.`
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Sibling wrapper detection — CPI-6 B4
// ---------------------------------------------------------------------------

/**
 * Returns a map of standard-table -> sibling-wrapper-name for any DDLS sibling
 * whose name follows the ZI_<TABLE> convention and where <TABLE> matches a
 * known SAP standard table. The current object is excluded.
 */
/** Minimal shape used by the sibling-wrapper detector. Kept structural so the
 *  caller can pass either AbapObject or the raw TDS `abapObjectList` entry. */
type SiblingRef = { objectType: string; objectName: string };

function detectSiblingWrappers(
  current: AbapObject,
  siblings: ReadonlyArray<SiblingRef>
): Map<string, SiblingRef> {
  const map = new Map<string, SiblingRef>();
  for (const s of siblings) {
    if (s === current) continue;
    if (s.objectName === current.objectName) continue;
    if (s.objectType !== 'DDLS') continue;
    const m = /^ZI_([A-Z][A-Z0-9_]+)$/.exec(s.objectName.trim().toUpperCase());
    if (!m) continue;
    const table = m[1]!;
    if (SAP_STANDARD_TABLES.has(table)) {
      map.set(table, s);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function groundObjectForGeneration(
  obj: AbapObject,
  mcpPort: number = resolveMcpPort(),
  /** Sibling objects in the same TDS deliverable. When provided, the grounder
   *  identifies wrapper views (ZI_<TABLE> DDLS) and emits a grounding item
   *  steering the LLM toward those wrappers instead of direct table access.
   *  Structurally compatible with AbapObject AND the raw TDS sections entry. */
  siblings: ReadonlyArray<SiblingRef> = []
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

  // CPI-6 A1 — layer-role grounding. Deterministic, no MCP. When the current
  // object plays a recognized Clean Core three-layer role, inject strict
  // per-role rules so the LLM places annotations / projections / exposes
  // correctly. This is the single biggest lever for layering correctness —
  // pre-LLM grounding is far more reliable than post-LLM rewriting.
  const layerItem = detectLayerRoleGrounding(obj);
  if (layerItem) {
    ctx.grounding.push(layerItem);
  }

  // CPI-6 A4 — HANA push-down grounding. Deterministic, no MCP. Tuned to
  // object type: CDS views vs ABAP programs/classes/function modules.
  const pushdownItem = detectHanaPushdownGrounding(obj);
  if (pushdownItem) {
    ctx.grounding.push(pushdownItem);
  }

  // CPI-6 A6 — ABAP Cloud / BTP cloud-readiness grounding. Deterministic, no
  // MCP. Fires for PROG/CLAS/FUNC to enumerate the forbidden statement set.
  const cloudItem = detectCloudReadinessGrounding(obj);
  if (cloudItem) {
    ctx.grounding.push(cloudItem);
  }

  // CPI-6 B4 — sibling wrapper grounding runs deterministically before MCP.
  // It tells the LLM that a Z wrapper view for an SAP standard table is
  // being generated in this same deliverable, so any read access on that
  // table inside the current object must go through the sibling wrapper.
  const wrappers = detectSiblingWrappers(obj, siblings);
  // A wrapper view is allowed to SELECT FROM its own underlying table, so
  // when the current object is itself a wrapper view we skip the steering.
  const isCurrentItselfWrapper =
    obj.objectType === 'DDLS' &&
    /^ZI_([A-Z][A-Z0-9_]+)$/.test(obj.objectName.trim().toUpperCase()) &&
    SAP_STANDARD_TABLES.has(obj.objectName.trim().toUpperCase().replace(/^ZI_/, ''));
  if (wrappers.size > 0 && !isCurrentItselfWrapper) {
    const upperCorpus = corpus.toUpperCase();
    const lines: string[] = [];
    for (const [table, sib] of wrappers) {
      const tableMentioned = new RegExp(`\\b${table}\\b`).test(upperCorpus);
      if (!tableMentioned) continue;
      lines.push(
        `  - When reading ${table}, SELECT FROM ${sib.objectName} (the sibling Z interface view ` +
        `being generated in this same deliverable). Do NOT SELECT FROM ${table} directly.`
      );
    }
    if (lines.length > 0) {
      ctx.grounding.push({
        heading: 'Sibling wrapper views (this deliverable)',
        tool:    'sibling_wrapper',
        body:
          `The TDS object list for this deliverable INCLUDES the following Z interface ` +
          `views that wrap SAP standard tables. They will be generated and transported ` +
          `alongside the current object, so they MUST be referenced — not the underlying tables:\n` +
          lines.join('\n') +
          `\n\nThis rule applies to every object in the deliverable EXCEPT the wrapper ` +
          `view itself (a wrapper view is allowed to SELECT FROM its own underlying table).`
      });
    }
  }

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
  // Deterministic items (layer_role, sibling_wrapper) ship regardless of MCP
  // availability — they're computed from TDS metadata, not retrieved.
  const deterministicTools = new Set(['layer_role', 'sibling_wrapper', 'hana_pushdown', 'cloud_readiness']);
  const deterministicItems = ctx.grounding.filter(g => deterministicTools.has(g.tool));
  const retrievedItems     = ctx.grounding.filter(g => !deterministicTools.has(g.tool));

  if (ctx.mcpUnavailable) {
    // When MCP is down we still emit deterministic blocks so layer-role rules
    // reach the LLM. A short banner explains the partial degradation.
    if (deterministicItems.length === 0) {
      return [
        '## Grounded SAP knowledge (CPI-6 Sprint 3)',
        '',
        'The DarkHorse MCP server is currently unreachable. Generation is proceeding ',
        'WITHOUT grounded knowledge. Apply Clean Core rules carefully and rely on the ',
        'post-generation Clean Core verifier to catch defects.'
      ].join('\n');
    }
    const blocks = deterministicItems.map(g =>
      `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
    ).join('\n\n');
    return [
      '## Grounded SAP knowledge (CPI-6 Sprint 3)',
      '',
      'The DarkHorse MCP server is currently unreachable. The retrieved-knowledge ',
      'blocks (CDS view names, EML templates, RAP patterns) are omitted for this ',
      'run. The following deterministic Clean Core rules still apply:',
      '',
      blocks
    ].join('\n');
  }
  if (ctx.grounding.length === 0) {
    return '';   // nothing relevant — no need to add empty section
  }

  const blocks = ctx.grounding.map(g =>
    `### ${g.heading}\nSource: ${g.tool}\n\n${g.body}`
  ).join('\n\n');
  // Suppress unused-variable warning when only one branch is active.
  void retrievedItems;

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
