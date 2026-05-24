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
  category:     'exit' | 'table' | 'bapi' | 'ui' | 'auth' | 'perf' | 'test' | 'btp' | 'enhancement' | 'completeness' | 'fidelity';
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

// CPI-6 A3 — AUTHORITY-CHECK OBJECT '<obj>' calls. Captures the auth object
// name (a 1-10 char SAP identifier such as S_TCODE, S_DEVELOP, F_BKPF_GSB).
// Classic AUTHORITY-CHECK is Level B in Clean Core: still permitted, but for
// CDS-bearing entities the recommended path is a DCL role with `aspect
// pfcg_auth` mapping to the same PFCG object.
const RX_AUTHORITY_CHECK = /\bAUTHORITY-CHECK\s+OBJECT\s+['"]\s*([A-Z][A-Z0-9_]{1,9})\s*['"]/gi;

// CPI-6 A4 — open-cursor SELECT loops. Any `ENDSELECT` keyword presupposes a
// loop-style SELECT (SELECT ... ENDSELECT processes rows one-at-a-time
// instead of pulling them in a single round trip). Push-down replacement is
// SELECT ... INTO TABLE.
const RX_ENDSELECT = /\bENDSELECT\b/gi;

// SELECT * — pulls every column from the wide row. Push-down advice is to
// project only the columns the program actually consumes. We tolerate
// SELECT * FROM <internal-table-or-itab-var> by requiring "FROM <SAP-style
// upper identifier>" so SELECT * FROM lt_data doesn't false-positive.
const RX_SELECT_STAR = /\bSELECT\s+\*\s+FROM\s+[A-Z][A-Z0-9_]+/gi;

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

// CPI-6 B5 — `expose ZI_<name>` inside a `define service` block. The Clean
// Core three-layer rule requires service definitions to expose CONSUMPTION
// views (ZC_*), not interface views (ZI_*). The capture group is the full
// ZI_* name (without the ZI_ prefix kept intact so we can derive the ZC_
// suggestion). Comments and whitespace before `expose` are tolerated.
const RX_SERVICE_EXPOSE_ZI = /\bexpose\s+(ZI_[A-Z][A-Z0-9_]*)\b/gi;

// We only count expose-ZI hits when the surrounding code is actually a
// service definition. A simple presence check for `define service` is
// sufficient because non-SRVD objects don't use the `expose` keyword.
const RX_DEFINE_SERVICE = /\bdefine\s+service\b/i;

// CPI-6 A2 — `define view (entity) ZI_<name>` identifies the file as an
// INTERFACE view. The capture group is the entity stem so we can suggest
// the corresponding ZC_<stem> consumption view in the finding alternative.
const RX_DEFINE_INTERFACE_VIEW = /\bdefine\s+view\s+(?:entity\s+)?ZI_([A-Z][A-Z0-9_]*)\b/i;

// CPI-6 A2 — consumption-layer annotations that must NOT appear on a ZI_*
// interface view. These annotations belong on the ZC_* projection layer
// so the interface view stays a pure data projection and the projection
// layer owns UI / search / object-model metadata.
//
// Excluded by design (allowed on interface views):
//   - @ObjectModel.dataCategory     — table classification (header / dimension / etc.)
//   - @ObjectModel.representativeKey — released-view modeling primitive
//   - @ObjectModel.usageType        — released-view contract metadata
//   - @AccessControl.authorizationCheck — required on ALL ZI_* and ZC_* views
//   - @EndUserText.label            — descriptive only, no layering concern
const FORBIDDEN_INTERFACE_ANNOTATIONS: Array<{
  /** Substring match (lowercased) for the annotation prefix. */
  prefix:   string;
  /** Display label used in the finding. */
  label:    string;
  /** Why this annotation belongs on the consumption view. */
  reason:   string;
}> = [
  {
    prefix: '@ui.',
    label:  '@UI.*',
    reason: 'Fiori Elements floorplan metadata (headerInfo / lineItem / identification / selectionField) is part of the consumption-layer contract.'
  },
  {
    prefix: '@search.searchable',
    label:  '@Search.searchable',
    reason: 'Search exposure is a consumption-layer concern — it changes the OData service shape, not the underlying data projection.'
  },
  {
    prefix: '@search.defaultsearchelement',
    label:  '@Search.defaultSearchElement',
    reason: 'Default search element targets the consumption layer (drives the Fiori value-help and search dialog).'
  },
  {
    prefix: '@objectmodel.semantickey',
    label:  '@ObjectModel.semanticKey',
    reason: 'Semantic key wiring is a consumption-layer projection concern; the interface view exposes the technical key only.'
  },
  {
    prefix: '@consumption.',
    label:  '@Consumption.*',
    reason: '@Consumption annotations (filter / valueHelpDefault / labelElement) are by definition consumption-layer.'
  }
];

// Match any `@<token>` annotation occurrence (the full annotation up to the
// first whitespace or `:` so we can classify it deterministically).
const RX_ANY_ANNOTATION = /@[A-Za-z][A-Za-z0-9_.]*/g;

/** CPI-6 A4 perf-finding identifiers. */
type PerfFindingKey =
  | 'OPEN_CURSOR'         // SELECT ... ENDSELECT
  | 'SELECT_STAR'         // SELECT * FROM <table>
  | 'NESTED_SELECT_LOOP'; // SELECT inside a LOOP AT block

interface ExtractedReferences {
  exits:    Map<string, number>;
  tables:   Map<string, number>;
  bapis:    Map<string, number>;
  uis:      Map<string, number>;  // key = the canonical reference name from UI_FINDINGS
  exposeZi: Map<string, number>;  // key = the ZI_* view exposed by a service def
  /** Consumption-layer annotations found inside an interface view. Key is the
   *  display label (e.g. "@UI.*"); value is the occurrence count. The stem of
   *  the ZI_* view is stored separately so the finding alternative can name
   *  the corresponding ZC_<stem>. CPI-6 A2. */
  interfaceAnn: Map<string, number>;
  interfaceStem: string | null;
  /** AUTHORITY-CHECK references grouped by PFCG auth object name. CPI-6 A3. */
  authChecks: Map<string, number>;
  /** True when the generated code is a behavior-projection class (ZBP_I_*).
   *  Behavior impls should rely on DCL roles attached to the entity, not on
   *  classic AUTHORITY-CHECK, so the finding is escalated in that context. */
  isBehaviorImpl: boolean;
  /** CPI-6 A4 HANA push-down findings. Key is a stable identifier; value is
   *  the occurrence count in the scanned code. */
  perf: Map<PerfFindingKey, number>;
  /** CPI-6 A5 — true when the code is an ABAP class with 2+ method bodies but
   *  no FOR TESTING block. The single boolean (not a map) is enough because
   *  one missing-tests finding per file is plenty. */
  missingTests: boolean;
  /** Count of method bodies surfaced in the finding description so the
   *  developer sees the impact size at a glance. */
  methodCount: number;
  /** CPI-6 A6 — ABAP Cloud / BTP forbidden statements. Key is the finding's
   *  stable identifier (matches BTP_FINDINGS[].key). */
  btp: Map<string, number>;
  /** CPI-6 A8 — classic-enhancement antipatterns (FORM USEREXIT, MODIFY
   *  SCREEN, CALL CUSTOMER-FUNCTION, implicit ENHANCEMENT-POINT). */
  enhancement: Map<string, number>;
  /** CPI-6 A10 — completeness antipatterns (empty METHOD bodies, TODO/
   *  FIXME markers, DarkHorse auto-detect stubs, placeholder comments). */
  completeness: Map<string, number>;
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// Recognises ABAP class declarations for behavior-projection classes
// (ZBP_I_<stem> DEFINITION) so the A3 finding can escalate when the auth
// check sits inside what should be DCL-protected code.
const RX_BEHAVIOR_IMPL = /\bCLASS\s+ZBP_I_[A-Z][A-Z0-9_]*\s+(?:DEFINITION|IMPLEMENTATION)\b/i;

// CPI-6 A5 — recognise an ABAP class file that contains real method
// implementations but no FOR TESTING class. Such a file ships without unit
// coverage and is flagged as a 'test' Level B finding.
const RX_CLASS_DEFINITION  = /\bCLASS\s+[A-Z_][A-Z0-9_]*\s+DEFINITION\b/gi;
const RX_METHOD_BODY       = /\bMETHOD\s+[A-Z_][A-Z0-9_~]*\s*\.[\s\S]*?\bENDMETHOD\b/gi;
const RX_FOR_TESTING_BLOCK = /\bCLASS\s+[A-Z_][A-Z0-9_]*\s+DEFINITION\s+(?:[^.]*\b)?FOR\s+TESTING\b/i;

// CPI-6 A10 — completeness antipatterns. The LLM sometimes ships code that
// LOOKS like a real implementation but contains empty method bodies, TODO/
// FIXME markers, or DarkHorse's own "could not auto-detect" stubs. These
// don't fail the build but they will fail at runtime / on activation. The
// verifier flags them so the developer doesn't accept a stub by accident.
const COMPLETENESS_FINDINGS: Array<{
  key:         string;
  rx:          RegExp;
  description: string;
  alternative: string;
}> = [
  {
    key:         'Empty METHOD body',
    /** METHOD <name>. ... ENDMETHOD. with only whitespace / comments inside.
     *  We anchor on METHOD <name>. followed by optional comment lines and
     *  immediate ENDMETHOD. Conservative regex — only matches truly empty. */
    rx:          /\bMETHOD\s+[A-Z_][A-Z0-9_~]*\s*\.\s*(?:\*[^\n]*\n|"[^\n]*\n|\s)*ENDMETHOD\b/gi,
    description: 'Method declared with empty body. This compiles but will silently no-op at runtime — the BAdI / interface contract is unmet.',
    alternative: 'Implement the method body. If the method legitimately has no work to do, add a single-line comment "* intentionally empty: <why>" so the verifier knows the omission is deliberate.'
  },
  {
    key:         'TODO / FIXME marker',
    rx:          /\b(?:TODO|FIXME|XXX|HACK)\b/g,
    description: 'TODO / FIXME / XXX / HACK marker in shipped code. These markers indicate the implementation is incomplete; reviewers and the SAP system have no way to distinguish "left intentionally" from "forgotten".',
    alternative: 'Either complete the work the marker describes, or convert the marker into a documented design decision in the TDS rather than a runtime comment.'
  },
  {
    key:         'DarkHorse auto-detect stub',
    /** Marker that the ZWrapperGenerator (or any DarkHorse component) gives
     *  up and leaves a placeholder. Should never reach production. */
    rx:          /\bDarkHorse\s+could\s+not\s+auto[-\s]?detect\b/gi,
    description: 'DarkHorse stub marker present. A code generator gave up and left a placeholder — typically a CDS field list it couldn\'t infer from the consuming program.',
    alternative: 'Replace the stub with the actual content. For CDS field lists, list the fields the consuming program reads. For BAdI implementations, complete the method bodies.'
  },
  {
    key:         'Placeholder comment',
    /** Catches "<implement>", "<replace>", "add logic here", "implement me". */
    rx:          /<\s*(?:implement|replace|fill\s+in|add\s+logic)\s*>|implement\s+me\b|add\s+(?:logic|code)\s+here\b/gi,
    description: 'Placeholder comment / angle-bracket marker indicating an unimplemented section.',
    alternative: 'Replace with the actual implementation or remove the placeholder if the section is no longer needed.'
  }
];

// CPI-6 A8 — classic-enhancement antipatterns. These are patterns generated
// by an LLM that misread the Enhancement requirement as a license to drop
// into 1990s ABAP. Each is Level B with a Key User Extensibility / BAdI
// alternative named. The alternatives mirror the TDS-side enhancement
// scenario grounding so the messaging is consistent across stages.
const ENHANCEMENT_FINDINGS: Array<{
  key:         string;
  rx:          RegExp;
  description: string;
  alternative: string;
}> = [
  {
    key:         'FORM USEREXIT_*',
    // FORM <name>. ... ENDFORM. where the form name starts with userexit_
    rx:          /\bFORM\s+(?:USEREXIT_|user_exit_)[A-Z0-9_]+/gi,
    description: 'FORM-based user exit (USEREXIT_<name>). This is the legacy enhancement pattern pre-S/4HANA. Not part of ABAP-for-Cloud-Development scope. Upgrade-fragile and not Clean Core.',
    alternative: 'Replace with an implementation of a released Business Add-In (ENHO) or Key User Extensibility → Custom Fields and Logic. Use the MCP BAdI catalog to find the matching released spot.'
  },
  {
    key:         'PERFORM USEREXIT_*',
    rx:          /\bPERFORM\s+(?:USEREXIT_|user_exit_)[A-Z0-9_]+/gi,
    description: 'PERFORM call into a USEREXIT_* form. This drags the legacy enhancement framework into the codebase even when the called form sits in standard include.',
    alternative: 'Drop the PERFORM. The replacement is a BAdI implementation that the SAP standard already calls at the right point in the process.'
  },
  {
    key:         'MODIFY SCREEN',
    rx:          /\bMODIFY\s+SCREEN\b/gi,
    description: 'Classic LOOP AT SCREEN / MODIFY SCREEN dynamic field control. Runs only on SAP GUI dynpros, not on Fiori / Web Dynpro. Forbidden in ABAP-for-Cloud-Development.',
    alternative: 'Use Key User Extensibility → Field Behavior BAdI (declarative visibility / mandatory / read-only rules), or a released field-control BAdI when the entity has one.'
  },
  {
    key:         'CALL CUSTOMER-FUNCTION',
    rx:          /\bCALL\s+CUSTOMER-FUNCTION\b/gi,
    description: 'Classic customer-function exit call (SAP\'s pre-BAdI enhancement primitive). Not released for cloud development and obsolete on S/4HANA.',
    alternative: 'Replace with a Business Add-In implementation via Enhancement Implementation (ENHO).'
  },
  {
    key:         'ENHANCEMENT-POINT (implicit)',
    // Match implicit enhancement points: `ENHANCEMENT-POINT <id> SPOTS <spot> STATIC.`
    // Implicit spots are particularly fragile across upgrades.
    rx:          /\bENHANCEMENT-POINT\s+[A-Z0-9_]+\s+SPOTS\s+[A-Z0-9_]+\s+STATIC\b/gi,
    description: 'Implicit ENHANCEMENT-POINT (STATIC). Not part of the released enhancement contract — upgrade-fragile and routinely deprecated by SAP.',
    alternative: 'Find the released explicit Enhancement Spot for the same business need (MCP BAdI catalog), or move the requirement to Custom Fields and Logic.'
  }
];

// CPI-6 A6 — ABAP Cloud / BTP forbidden statements. Each pattern flags a
// statement that is not part of the released ABAP-for-Cloud-Development
// language scope. Many of these still work on classic ABAP stacks, but if
// the code is meant to deploy to ABAP Environment on BTP, S/4HANA Cloud
// Public Edition, or any code unit marked "ABAP for Cloud Development",
// they will not pass the syntax/release check.
const BTP_FINDINGS: Array<{
  /** Stable identifier used as both the finding key and ack token. */
  key:         string;
  rx:          RegExp;
  description: string;
  alternative: string;
}> = [
  {
    key:         'CALL TRANSACTION',
    rx:          /\bCALL\s+TRANSACTION\s+['"]/gi,
    description: 'CALL TRANSACTION is not released for ABAP Cloud / ABAP for Cloud Development. It hops out of the OData/RAP service contract and the destination transaction may not even exist on the cloud stack.',
    alternative: 'Expose the equivalent function as a RAP action / function on a behavior definition, or call the released OData service of the target app.'
  },
  {
    key:         'LEAVE TO TRANSACTION',
    rx:          /\bLEAVE\s+TO\s+TRANSACTION\b/gi,
    description: 'LEAVE TO TRANSACTION is forbidden in ABAP Cloud. Same reasoning as CALL TRANSACTION — there is no SAP GUI session to leave to.',
    alternative: 'Trigger the next step via a RAP action that returns a navigation target, or via an outbound OData service call.'
  },
  {
    key:         'SUBMIT REPORT',
    rx:          /\bSUBMIT\s+(?!\(\s*l)\w+/gi,
    description: 'SUBMIT <report> targets a classic ABAP report; reports are not part of ABAP Cloud development. The submitted program may not even be released.',
    alternative: 'Move the logic into a class method (or RAP action) and invoke it directly. If you really need batch execution, schedule a class via cl_bgmc / Business-Process-As-a-Service.'
  },
  {
    key:         'OPEN DATASET',
    rx:          /\bOPEN\s+DATASET\b/gi,
    description: 'OPEN DATASET addresses the application-server filesystem, which is not exposed in ABAP Cloud. Files in the cloud are accessed through document services or attachments.',
    alternative: 'Use Application-Job / Document-Service / Attachment-Service APIs (cl_dms_*, cl_bdef_attachment) or pull/push the file via SFTP through a Communication Arrangement.'
  },
  {
    key:         'WAIT UP TO',
    rx:          /\bWAIT\s+UP\s+TO\b/gi,
    description: 'WAIT UP TO ... SECONDS is forbidden in ABAP Cloud — it blocks the work process, which the cloud runtime will not tolerate.',
    alternative: 'If you need polling, restructure as an asynchronous workflow: emit a business event, let the consumer subscribe. If you need throttling, use the workload-management framework.'
  },
  {
    key:         'CALL FUNCTION DESTINATION literal',
    /** Matches CALL FUNCTION '...' DESTINATION '<literal-rfc-dest>'. We
     *  only flag DESTINATION '<single-quoted-literal>' to avoid false-
     *  positives on DESTINATION lv_dest where the destination is sourced
     *  from a properly resolved Communication Arrangement. */
    rx:          /\bCALL\s+FUNCTION\s+['"][^'"]+['"][\s\S]{0,80}?\bDESTINATION\s+['"][^'"]+['"]/gi,
    description: 'Hard-coded RFC destination literals are not portable to ABAP Cloud. Cloud RFC calls must be brokered through a Communication Arrangement so the destination name is resolved from customizing.',
    alternative: "Look up the destination via cl_com_arrangement_factory=>create_arrangement_factory( )->get_arrangement( comm_scenario = 'Z_<SCN>' ... ) and pass the resolved destination to CALL FUNCTION."
  }
];

function extractReferences(code: string): ExtractedReferences {
  const out: ExtractedReferences = {
    exits:          new Map<string, number>(),
    tables:         new Map<string, number>(),
    bapis:          new Map<string, number>(),
    uis:            new Map<string, number>(),
    exposeZi:       new Map<string, number>(),
    interfaceAnn:   new Map<string, number>(),
    interfaceStem:  null,
    authChecks:     new Map<string, number>(),
    isBehaviorImpl: RX_BEHAVIOR_IMPL.test(code),
    perf:           new Map<PerfFindingKey, number>(),
    missingTests:   false,
    methodCount:    0,
    btp:            new Map<string, number>(),
    enhancement:    new Map<string, number>(),
    completeness:   new Map<string, number>()
  };

  for (const m of code.matchAll(RX_USEREXIT)) {
    tally(out.exits, m[0].toUpperCase());
  }

  for (const m of code.matchAll(RX_BAPI)) {
    tally(out.bapis, (m[1] ?? '').toUpperCase());
  }

  for (const m of code.matchAll(RX_AUTHORITY_CHECK)) {
    tally(out.authChecks, (m[1] ?? '').toUpperCase());
  }

  // CPI-6 A4 — open-cursor + SELECT * are direct regex counts.
  const endselectCount = (code.match(RX_ENDSELECT) ?? []).length;
  if (endselectCount > 0) out.perf.set('OPEN_CURSOR', endselectCount);

  const selectStarCount = (code.match(RX_SELECT_STAR) ?? []).length;
  if (selectStarCount > 0) out.perf.set('SELECT_STAR', selectStarCount);

  // Nested-SELECT-inside-LOOP: scan line by line, maintain a loop-depth
  // counter, count any SELECT that occurs while depth > 0. Comments stripped
  // first so commented-out blocks don't false-positive.
  const lines = code.split('\n').map(line => {
    if (/^\s*\*/.test(line)) return '';
    const quoteIdx = line.indexOf('"');
    return quoteIdx >= 0 ? line.slice(0, quoteIdx) : line;
  });
  let loopDepth = 0;
  let nestedCount = 0;
  for (const ln of lines) {
    const upper = ln.toUpperCase();
    if (/\bLOOP\s+AT\b/.test(upper)) loopDepth += 1;
    if (/\bENDLOOP\b/.test(upper))   loopDepth = Math.max(0, loopDepth - 1);
    if (loopDepth > 0 && /\bSELECT\b/.test(upper)) {
      // ignore SELECT-OPTIONS declarations and SELECTION-SCREEN tokens —
      // those aren't database reads
      if (!/\bSELECT-OPTIONS\b/.test(upper) && !/\bSELECTION[-_]SCREEN\b/.test(upper)) {
        nestedCount += 1;
      }
    }
  }
  if (nestedCount > 0) out.perf.set('NESTED_SELECT_LOOP', nestedCount);

  // CPI-6 A5 — missing-test detection. The rule fires only when the file
  // actually defines a non-test class (RX_CLASS_DEFINITION matches at least
  // once for a non-test class) and contains 2+ ENDMETHOD bodies but zero
  // FOR TESTING declarations. The 2+ threshold avoids flagging trivial
  // adapter classes with a single passthrough method.
  const classDefMatches = code.match(RX_CLASS_DEFINITION) ?? [];
  const methodBodyCount = (code.match(RX_METHOD_BODY) ?? []).length;
  const hasForTesting   = RX_FOR_TESTING_BLOCK.test(code);
  if (classDefMatches.length > 0 && methodBodyCount >= 2 && !hasForTesting) {
    out.missingTests = true;
    out.methodCount  = methodBodyCount;
  }

  // CPI-6 A6 — ABAP Cloud / BTP forbidden statements. Each pattern counts
  // independently so we can show occurrence counts in the finding card.
  for (const entry of BTP_FINDINGS) {
    const count = (code.match(entry.rx) ?? []).length;
    if (count > 0) {
      out.btp.set(entry.key, count);
    }
  }

  // CPI-6 A8 — classic-enhancement antipatterns (FORM USEREXIT, MODIFY SCREEN,
  // CALL CUSTOMER-FUNCTION, implicit ENHANCEMENT-POINT). Each counted
  // separately so the finding card shows where the impact concentrates.
  for (const entry of ENHANCEMENT_FINDINGS) {
    const count = (code.match(entry.rx) ?? []).length;
    if (count > 0) {
      out.enhancement.set(entry.key, count);
    }
  }

  // CPI-6 A10 — completeness antipatterns (empty methods, TODOs, stubs).
  for (const entry of COMPLETENESS_FINDINGS) {
    const count = (code.match(entry.rx) ?? []).length;
    if (count > 0) {
      out.completeness.set(entry.key, count);
    }
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

  // CPI-6 B5 — service definitions that expose interface views (ZI_*) instead
  // of consumption views (ZC_*). Only scanned when the code actually contains
  // a `define service` statement to avoid false positives on other DDLS.
  if (RX_DEFINE_SERVICE.test(code)) {
    for (const m of code.matchAll(RX_SERVICE_EXPOSE_ZI)) {
      tally(out.exposeZi, (m[1] ?? '').toUpperCase());
    }
  }

  // CPI-6 A2 — consumption-layer annotations leaking into a ZI_* interface
  // view. Only scanned when the code defines a ZI_* view; we strip ABAP-style
  // line comments first (lines starting with `*` or text after `//`) so
  // commented-out @UI examples don't false-positive.
  const ifaceMatch = RX_DEFINE_INTERFACE_VIEW.exec(code);
  if (ifaceMatch) {
    out.interfaceStem = (ifaceMatch[1] ?? '').toUpperCase();
    const stripped = stripCdsComments(code);
    for (const m of stripped.matchAll(RX_ANY_ANNOTATION)) {
      const ann = (m[0] ?? '').toLowerCase();
      for (const forbidden of FORBIDDEN_INTERFACE_ANNOTATIONS) {
        if (ann.startsWith(forbidden.prefix)) {
          tally(out.interfaceAnn, forbidden.label);
          break;
        }
      }
    }
  }

  return out;
}

/** Strip CDS / ABAP comments so commented-out annotations don't false-positive
 *  the consumption-leakage scan. CDS uses both `//` line comments and
 *  `/* ... *​/` block comments; ABAP-style `*` is at column 0. */
function stripCdsComments(code: string): string {
  return code
    .split('\n')
    .map(line => {
      if (/^\s*\*/.test(line)) return '';
      const slash = line.indexOf('//');
      return slash >= 0 ? line.slice(0, slash) : line;
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
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
  acknowledgements: readonly string[] = [],
  /** CPI-6 A11 — anchors extracted from the FDS for this pipeline. When
   *  provided, the verifier substring-checks each anchor against the
   *  generated code and emits a 'fidelity' Level B finding when coverage
   *  is poor. Pass undefined / null to skip the check. Applies to every
   *  RICEFW type and every object type. */
  expectedAnchors?: {
    quotedIds:    string[];
    sapTables:    string[];
    transactions: string[];
    badis:        string[];
    fieldLabels:  string[];
    hasAnchors:   boolean;
  }
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
    refs.uis.size === 0 &&
    refs.exposeZi.size === 0 &&
    refs.interfaceAnn.size === 0 &&
    refs.authChecks.size === 0 &&
    refs.perf.size === 0 &&
    !refs.missingTests &&
    refs.btp.size === 0 &&
    refs.enhancement.size === 0 &&
    refs.completeness.size === 0;

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
      totalFindings:  refs.exits.size + refs.tables.size + refs.bapis.size + refs.uis.size + refs.exposeZi.size + refs.interfaceAnn.size + refs.authChecks.size + refs.perf.size + (refs.missingTests ? 1 : 0) + refs.btp.size + refs.enhancement.size + refs.completeness.size,
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

  // ---- CPI-6 B5: service definition exposing ZI_* interface view ----------
  // Clean Core three-layer rule: SRVD must expose ZC_* consumption views,
  // not ZI_* interface views. Interface views bypass projection-layer
  // metadata (UI/value-help/auth) and create a brittle service contract.
  for (const [zi, count] of refs.exposeZi.entries()) {
    const zc = 'ZC_' + zi.replace(/^ZI_/, '');
    findings.push({
      category:     'ui',
      reference:    zi,
      exists:       true,
      level:        'B',
      description:
        `Service definition exposes ${zi}, an interface (ZI_*) view. Clean Core ` +
        `three-layer pattern (interface → consumption → service) requires the ` +
        `service to expose the consumption (ZC_*) projection so UI annotations, ` +
        `value helps, and field-level auth all live in the projection layer.`,
      alternative:  `expose ${zc} (consumption view) instead of ${zi}`,
      occurrences:  count,
      acknowledged: ackFor(zi)
    });
  }

  // ---- CPI-6 A3: AUTHORITY-CHECK references --------------------------------
  // Classic AUTHORITY-CHECK is Level B — still permitted. For behavior
  // projection classes (ZBP_I_*) the recommended path is a DCL role attached
  // to the interface view with `aspect pfcg_auth` mapping to the same PFCG
  // object, so we tag those findings with sharper alternative text.
  for (const [authObj, count] of refs.authChecks.entries()) {
    const inBehaviorImpl = refs.isBehaviorImpl;
    const description = inBehaviorImpl
      ? `AUTHORITY-CHECK OBJECT '${authObj}' inside a behavior-projection class. ` +
        `For RAP-managed entities the projection layer should rely on DCL role ` +
        `enforcement on the underlying CDS view; classic AUTHORITY-CHECK in ZBP_I_* ` +
        `bypasses the DCL contract.`
      : `AUTHORITY-CHECK OBJECT '${authObj}'. Permitted in classic programs, but ` +
        `if this object protects a CDS-exposed entity the recommended path is a ` +
        `DCL role with aspect pfcg_auth mapping to PFCG object '${authObj}'.`;
    findings.push({
      category:     'auth',
      reference:    `AUTHORITY-CHECK ${authObj}`,
      exists:       true,
      level:        'B',
      description,
      alternative:
        `define role ZI_<Entity> { grant select on ZI_<Entity> where ... ; ` +
        `aspect pfcg_auth '${authObj}' ... ; }`,
      occurrences:  count,
      acknowledged: ackFor(`AUTHORITY-CHECK ${authObj}`)
    });
  }

  // ---- CPI-6 A11: FDS-anchor coverage --------------------------------------
  // The LLM was given verbatim anchors (quoted IDs, transactions, tables,
  // BAdIs, field labels) extracted from the FDS. Substring-check the code
  // for each anchor. When coverage is poor (less than 50% present AND at
  // least 3 anchors are missing), emit a fidelity Level B finding listing
  // what the FDS specified but the LLM omitted. Threshold guards against
  // false positives on small-N (a tiny CDS view legitimately won't
  // mention every FDS string).
  if (expectedAnchors && expectedAnchors.hasAnchors) {
    const all = [
      ...expectedAnchors.quotedIds,
      ...expectedAnchors.sapTables,
      ...expectedAnchors.transactions,
      ...expectedAnchors.badis,
      ...expectedAnchors.fieldLabels
    ];
    if (all.length >= 3) {
      const lower = code.toLowerCase();
      const missing: string[] = [];
      let found = 0;
      for (const a of all) {
        if (lower.includes(a.toLowerCase())) found += 1;
        else missing.push(a);
      }
      const coverage = found / all.length;
      // Hard rule when 0 anchors present and at least 3 were expected — the
      // LLM clearly ignored the FDS anchors block.
      // Soft rule when coverage is below 50%.
      if (coverage < 0.5 && missing.length >= 3) {
        const previewMissing = missing.slice(0, 12).map(s => `"${s}"`).join(', ');
        const more = missing.length > 12 ? ` (+${missing.length - 12} more)` : '';
        findings.push({
          category:     'fidelity',
          reference:    `FDS anchor coverage (${found}/${all.length})`,
          exists:       true,
          level:        'B',
          description:
            `The FDS specifies ${all.length} concrete identifier(s) / label(s) for this ` +
            `deliverable, but only ${found} appear in the generated code. The code ` +
            `is using its own naming instead of the FDS naming. Missing: ` +
            `${previewMissing}${more}.`,
          alternative:
            `Re-generate this object after acknowledging the missing anchors, or edit ` +
            `the code to use the FDS strings verbatim. Pre-LLM grounding already lists ` +
            `these — the LLM substituted equivalents anyway.`,
          occurrences:  missing.length,
          acknowledged: ackFor(`FDS anchor coverage (${found}/${all.length})`)
        });
      }
    }
  }

  // ---- CPI-6 A10: completeness antipatterns -------------------------------
  // Empty methods, TODOs, stubs, placeholder markers. Each Level B so the
  // developer sees them in the panel before accepting.
  for (const [key, count] of refs.completeness.entries()) {
    const entry = COMPLETENESS_FINDINGS.find(e => e.key === key);
    if (!entry) continue;
    findings.push({
      category:     'completeness',
      reference:    key,
      exists:       true,
      level:        'B',
      description:  entry.description,
      alternative:  entry.alternative,
      occurrences:  count,
      acknowledged: ackFor(key)
    });
  }

  // ---- CPI-6 A8: classic-enhancement antipatterns --------------------------
  // Each match becomes a Level B finding pointing at the Clean Core
  // replacement (released BAdI implementation, Key User Extensibility,
  // declarative field control). These are the patterns the LLM tends to
  // fall back to when given a vague "Enhancement" requirement.
  for (const [key, count] of refs.enhancement.entries()) {
    const entry = ENHANCEMENT_FINDINGS.find(e => e.key === key);
    if (!entry) continue;
    findings.push({
      category:     'enhancement',
      reference:    key,
      exists:       true,
      level:        'B',
      description:  entry.description,
      alternative:  entry.alternative,
      occurrences:  count,
      acknowledged: ackFor(key)
    });
  }

  // ---- CPI-6 A6: ABAP Cloud / BTP forbidden statements ---------------------
  for (const [key, count] of refs.btp.entries()) {
    const entry = BTP_FINDINGS.find(e => e.key === key);
    if (!entry) continue;
    findings.push({
      category:     'btp',
      reference:    key,
      exists:       true,
      level:        'B',
      description:  entry.description,
      alternative:  entry.alternative,
      occurrences:  count,
      acknowledged: ackFor(key)
    });
  }

  // ---- CPI-6 A5: ABAP class without FOR TESTING ----------------------------
  // Fires once per scan when the code is a class with substantive method
  // bodies but no FOR TESTING block. Acknowledging this finding signals the
  // developer is shipping tests in a separate transport / object.
  if (refs.missingTests) {
    findings.push({
      category:     'test',
      reference:    'CLAS without FOR TESTING',
      exists:       true,
      level:        'B',
      description:
        `This class implements ${refs.methodCount} method bodies but contains ` +
        `no CLASS ... DEFINITION ... FOR TESTING block. Clean Core expects ` +
        `every behavior class (especially ZBP_I_* and any class with business ` +
        `logic) to ship with ABAP Unit coverage. Local FOR TESTING classes ` +
        `inside the same include are the cheapest path and travel in the ` +
        `same transport.`,
      alternative:
        `Append a local test class: CLASS ltcl_<name> DEFINITION FOR TESTING ` +
        `RISK LEVEL HARMLESS DURATION SHORT. Use cl_cds_test_environment for ` +
        `CDS doubles and cl_abap_unit_assert for assertions. At minimum one ` +
        `test per validation, one per determination, one happy-path EML round-trip.`,
      occurrences:  1,
      acknowledged: ackFor('CLAS without FOR TESTING')
    });
  }

  // ---- CPI-6 A4: HANA push-down --------------------------------------------
  // Each perf finding is Level B. The categories are distinct enough that
  // separate findings (rather than one composite) give the developer a clear
  // signal for each antipattern.
  const perfDetails: Record<PerfFindingKey, { reference: string; description: string; alternative: string }> = {
    OPEN_CURSOR: {
      reference:   'SELECT ... ENDSELECT (open cursor)',
      description: 'Row-by-row SELECT/ENDSELECT keeps a database cursor open and prevents HANA from streaming or parallelising the read. The database does work per iteration that a single SELECT INTO TABLE would do once.',
      alternative: 'SELECT <fields> FROM <source> INTO TABLE @DATA(lt_data) [FOR ALL ENTRIES OF @lt_keys] WHERE ... — then process the internal table in ABAP.'
    },
    SELECT_STAR: {
      reference:   'SELECT *',
      description: 'SELECT * pulls every column from the source, even columns the program never reads. On wide HANA tables and CDS views this materially hurts read throughput and inflates memory.',
      alternative: 'SELECT <only-the-fields-you-consume> FROM <source> ... — explicit field lists are also a prerequisite for HANA column-store pruning.'
    },
    NESTED_SELECT_LOOP: {
      reference:   'SELECT inside LOOP (N+1)',
      description: 'A SELECT inside a LOOP issues one DB roundtrip per row of the outer loop (the classic N+1 antipattern). HANA-side joins and FOR ALL ENTRIES OF do the same work in a single batched read.',
      alternative: 'Use a CDS association traversal, a JOIN inside the outer SELECT, or SELECT ... FOR ALL ENTRIES OF @<outer_table> to batch the reads.'
    }
  };
  for (const [key, count] of refs.perf.entries()) {
    const d = perfDetails[key];
    findings.push({
      category:     'perf',
      reference:    d.reference,
      exists:       true,
      level:        'B',
      description:  d.description,
      alternative:  d.alternative,
      occurrences:  count,
      acknowledged: ackFor(d.reference)
    });
  }

  // ---- CPI-6 A2: consumption-layer annotations on a ZI_* interface view ---
  // The interface layer must stay a pure projection. @UI / @Search /
  // @ObjectModel.semanticKey / @Consumption belong on the ZC_* projection.
  if (refs.interfaceStem) {
    const zc = `ZC_${refs.interfaceStem}`;
    const zi = `ZI_${refs.interfaceStem}`;
    for (const [label, count] of refs.interfaceAnn.entries()) {
      const reason =
        FORBIDDEN_INTERFACE_ANNOTATIONS.find(f => f.label === label)?.reason ?? '';
      findings.push({
        category:     'ui',
        reference:    `${zi}: ${label}`,
        exists:       true,
        level:        'B',
        description:
          `Interface view ${zi} carries ${label} annotation(s) — these belong on ` +
          `the consumption layer. ${reason}`,
        alternative:  `Move ${label} annotations from ${zi} to ${zc} (consumption view)`,
        occurrences:  count,
        acknowledged: ackFor(`${zi}: ${label}`)
      });
    }
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
