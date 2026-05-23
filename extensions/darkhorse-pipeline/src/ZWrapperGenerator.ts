/**
 * ZWrapperGenerator — one-click "Generate Z Wrapper" action.
 *
 * When the Clean Core verifier flags a Level C 'table' finding (direct SELECT
 * on a SAP standard table) and no released CDS view exists, the developer
 * can click "Generate Z Wrapper" on the finding. This module:
 *
 *   1. Calls MCP get_cds_view(table) -> gets the proposed Z DDL skeleton.
 *   2. Extracts the field list from the existing SELECT statement(s) in the
 *      generated code (multiple SELECT shapes supported).
 *   3. Substitutes the real field list into the template.
 *   4. Prepends the canonical DarkHorse header (with a fresh UID minted via
 *      UidLogger — the Z view is itself an AI-generated object).
 *   5. Writes the Z view as DDLS_ZI_<TABLE>.abap to the output folder.
 *   6. Rewrites FROM <table> -> FROM ZI_<TABLE> in the calling code.
 *   7. Returns the new code + summary of what was created.
 *
 * Deterministic — no LLM in the loop. Same input -> same Z view + rewrite.
 */

'use strict';

import * as fs   from 'fs';
import * as path from 'path';

import { AbapObject }                  from './PipelineStateManager';
import { recordGeneration }            from './UidLogger';
import { applyHeader }                 from './HeaderEmitter';

const http = require('http');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ZWrapperInput {
  tableName:      string;
  code:           string;
  obj:            AbapObject;       // the object whose code we're rewriting
  outputFolder:   string;
  pipelineTitle:  string;
  mcpPort:        number;
  model:          string;           // model name to record in the audit log
}

export interface ZWrapperResult {
  zViewName:     string;            // e.g. "ZI_LIKP"
  zViewPath:     string;            // absolute path of the saved DDLS .abap
  rewrittenCode: string;            // calling-code with FROM <table> swapped
  rewriteCount:  number;            // FROM occurrences rewritten
  fieldsUsed:    string[];          // fields the Z view exposes
  uid:           string;            // DarkHorse UID of the Z view
}

// ---------------------------------------------------------------------------
// HTTP — talk to MCP /tools/get-cds-view
// ---------------------------------------------------------------------------

function mcpPost(port: number, route: string, body: object, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: route, method: 'POST',
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res: any) => {
        let data = '';
        res.on('data', (c: any) => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('MCP timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Field extraction — scan SELECT statements against the target table
// ---------------------------------------------------------------------------

/**
 * Returns the unique field list referenced in the code's SELECT(s) against
 * `tableName`. Recognises three common ABAP SQL shapes:
 *   SELECT f1, f2, f3 FROM table ...
 *   SELECT f1 f2 f3 FROM table ...        (classic, comma-less)
 *   SELECT FROM table FIELDS f1, f2, f3 INTO ...
 * If only "SELECT * FROM table" appears, returns the special value [].
 * Caller treats [] as "expose * in the CDS — but Z CDS views can't use *,
 * so we'll emit a TODO with all-fields placeholder."
 */
export function extractSelectedFields(code: string, tableName: string): string[] {
  const lower = code.toLowerCase();
  const table = tableName.toLowerCase();
  const fields = new Set<string>();

  // Pattern 1: SELECT FROM <table> FIELDS f1, f2 ... (newer ABAP SQL)
  const fieldsClauseRx = new RegExp(
    `select\\s+(?:single\\s+)?(?:from\\s+${escapeRegex(table)}\\b[^]*?\\bfields\\s+([^]*?)\\b(?:into|where|up\\s+to|order\\s+by|group\\s+by|;|.\\s|$))`,
    'gi'
  );
  // Pattern 2: SELECT f1, f2, ... FROM <table>
  const classicRx = new RegExp(
    `select\\s+(?:single\\s+)?(?!from\\b)([^]*?)\\s+from\\s+${escapeRegex(table)}\\b`,
    'gi'
  );

  for (const rx of [fieldsClauseRx, classicRx]) {
    for (const m of lower.matchAll(rx)) {
      const list = (m[1] ?? '').trim();
      if (!list) continue;
      if (list === '*') return [];   // signal "all fields"
      // Split on whitespace OR comma; strip aliases like t~field
      for (const tok of list.split(/[\s,]+/)) {
        const cleaned = tok.replace(/.*~/, '').replace(/[^a-z0-9_]/gi, '');
        if (cleaned.length > 0 && !ABAP_KEYWORDS.has(cleaned.toLowerCase())) {
          fields.add(cleaned.toLowerCase());
        }
      }
    }
  }
  return Array.from(fields);
}

const ABAP_KEYWORDS = new Set([
  'distinct', 'single', 'as', 'on', 'inner', 'left', 'right', 'outer',
  'join', 'where', 'into', 'table', 'data', 'and', 'or', 'not', 'in',
  'between', 'like', 'group', 'by', 'order', 'having', 'up', 'to', 'rows',
  'with', 'fields', 'count', 'min', 'max', 'avg', 'sum'
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// DDL composition
// ---------------------------------------------------------------------------

function composeZViewDdl(
  baseTemplate: string,
  table: string,
  fields: string[]
): { ddl: string; fieldsUsed: string[] } {

  // The MCP template includes a TODO field block. Replace it with real fields.
  // We rebuild the field block deterministically — first field becomes `key`.
  const tableUpper = table.toUpperCase();
  const viewName   = `ZI_${tableUpper}`;
  const sqlViewName = `ZIV_${tableUpper}`.slice(0, 16);

  let fieldBlock: string;
  let usedFields: string[];

  if (fields.length === 0) {
    fieldBlock = [
      `  // TODO — DarkHorse could not auto-detect the field list (SELECT * or no SELECT found).`,
      `  // Replace with the fields the consuming program actually needs.`,
      `  key mandt,`,
      `  // key <key_field>,`,
      `  // <non_key_field_1>,`,
      `  // <non_key_field_2>`
    ].join('\n');
    usedFields = [];
  } else {
    // Prepend client key if not present; mandt is the SAP client key.
    const hasClient = fields.some(f => f.toLowerCase() === 'mandt');
    const lines: string[] = [];
    if (!hasClient) lines.push(`  key mandt,`);
    // First non-client field becomes key — conservative; developer can adjust.
    let assignedKey = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      if (!assignedKey && f.toLowerCase() !== 'mandt') {
        lines.push(`  key ${f},`);
        assignedKey = true;
      } else {
        lines.push(`  ${f},`);
      }
    }
    // strip trailing comma on the last line
    const last = lines[lines.length - 1];
    if (last && last.endsWith(',')) {
      lines[lines.length - 1] = last.slice(0, -1);
    }
    fieldBlock = lines.join('\n');
    usedFields = Array.from(new Set(fields));
  }

  // Rebuild the DDL from scratch (more reliable than regex-replacing the
  // template body — the proposed template field list is several lines of
  // TODO comments).
  const ddl = [
    `@AbapCatalog.sqlViewName: '${sqlViewName}'`,
    `@AbapCatalog.compiler.compareFilter: true`,
    `@AbapCatalog.preserveKey: true`,
    `@AccessControl.authorizationCheck: #CHECK`,
    `@EndUserText.label: 'DarkHorse wrapper view over ${tableUpper}'`,
    `@ClientHandling.algorithm: #SESSION_VARIABLE`,
    `define view ${viewName} as select from ${table.toLowerCase()} {`,
    fieldBlock,
    `}`
  ].join('\n');

  return { ddl, fieldsUsed: usedFields };
}

// ---------------------------------------------------------------------------
// FROM rewrite in the calling code
// ---------------------------------------------------------------------------

function rewriteFromClauses(code: string, table: string, viewName: string): { code: string; count: number } {
  const rx = new RegExp(`\\b(FROM)\\s+(${escapeRegex(table)})\\b`, 'gi');
  let count = 0;
  const rewritten = code.replace(rx, (_m, kw: string) => {
    count += 1;
    return `${kw} ${viewName}`;
  });
  return { code: rewritten, count };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateZWrapper(input: ZWrapperInput): Promise<ZWrapperResult> {
  const tableUpper = input.tableName.trim().toUpperCase();
  const viewName   = `ZI_${tableUpper}`;

  // 1. Fetch the MCP-proposed template (we'll use the annotations + form, not
  //    the placeholder field block, since we build our own field block from
  //    the actual SELECT).
  const proposalResp = await mcpPost(
    input.mcpPort,
    '/tools/get-cds-view',
    { sap_table: tableUpper }
  );
  if (!proposalResp?.ok) {
    throw new Error(`get_cds_view(${tableUpper}) returned not-ok from MCP.`);
  }
  // We don't strictly need the template content — composeZViewDdl rebuilds the
  // canonical shape — but we want MCP to know we're using this proposal in
  // case future telemetry counts wrapper generations.

  // 2. Extract fields from the existing SELECT statements
  const fields = extractSelectedFields(input.code, tableUpper);

  // 3. Compose the DDL
  const { ddl, fieldsUsed } = composeZViewDdl('', tableUpper, fields);

  // 4. Mint a fresh UID and audit-log entry for the Z view itself
  const promptHash = ''; // deterministic, no prompt
  const audit = recordGeneration({
    objectName: viewName,
    objectType: 'DDLS',
    model:      'darkhorse-zwrapper-deterministic',  // not an LLM call
    pipelineId: input.pipelineTitle,
    brRef:      input.pipelineTitle,
    promptHash
  });

  // 5. Apply the canonical header (CDS-style // comments for DDLS)
  const zObj: AbapObject = {
    sequence:      0,
    objectType:    'DDLS',
    objectName:    viewName,
    description:   `Wrapper CDS view over SAP standard table ${tableUpper} — generated as a Level B Clean Core fix for direct SELECT on ${tableUpper}.`,
    keyLogic:      [],
    dependencies:  [`Table: ${tableUpper} (wrapped by this view to avoid direct SELECT)`],
    codeGenerated: true,
    codeAccepted:  false
  };
  const zSource = applyHeader(ddl, {
    obj:           zObj,
    uid:           audit.uid,
    timestamp:     audit.timestamp,
    model:         'darkhorse-zwrapper-deterministic',
    pipelineTitle: input.pipelineTitle,
    brRef:         input.pipelineTitle,
    version:       '1.0'
  });

  // 6. Write the Z view file
  if (!fs.existsSync(input.outputFolder)) {
    fs.mkdirSync(input.outputFolder, { recursive: true });
  }
  const zViewPath = path.join(input.outputFolder, `DDLS_${viewName}.abap`);
  fs.writeFileSync(zViewPath, zSource, 'utf-8');

  // 7. Rewrite FROM <table> in the calling code
  const { code: rewrittenCode, count: rewriteCount } =
    rewriteFromClauses(input.code, tableUpper, viewName);

  return {
    zViewName:   viewName,
    zViewPath,
    rewrittenCode,
    rewriteCount,
    fieldsUsed,
    uid:         audit.uid
  };
}
