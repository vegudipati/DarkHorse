/**
 * CleanCoreAutoFix — deterministic post-verify rewrite of direct SAP-table
 * SELECTs into their released CDS interface views.
 *
 * The CodeAgentGrounder injects the released CDS view name into the LLM
 * prompt BEFORE generation. When the LLM follows the grounding the code is
 * already Level A. When the LLM ignores the grounding and writes a direct
 * SELECT anyway, the CleanCoreVerifier flags it as Level C with the CDS
 * alternative attached to the finding.
 *
 * This module is the safety net for that "LLM ignored grounding" case. It
 * walks the verifier findings, extracts the CDS view from each Level C
 * 'table' alternative, and regex-substitutes FROM <table> -> FROM <view>
 * in the generated code. The substitution is conservative:
 *
 *   - anchored to the FROM keyword so JOINs and aliases (vbak~vbeln) are
 *     untouched
 *   - case-insensitive on the table name (ABAP is case-insensitive)
 *   - preserves the original case of the FROM keyword
 *   - per-finding, with an occurrences counter for the banner
 *
 * The rewrite changes the FROM clause only. If the LLM also referenced
 * legacy field names (vbak-vbeln, vbak~vbeln, alias~vbeln), those field
 * references may need to be updated to the CDS field names. The preview
 * banner makes this explicit so the developer reviews the SELECT body
 * before accepting.
 */

'use strict';

import { CleanCoreReport, CleanCoreFinding } from './CleanCoreVerifier';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AppliedFix {
  table:        string;     // canonical (upper-case) SAP table name
  cdsView:      string;     // released CDS view substituted in
  occurrences:  number;     // how many FROM clauses were rewritten
}

export interface AutoFixSummary {
  fixes:        AppliedFix[];
  /** Total findings the autofixer considered (Level C 'table' findings). */
  considered:   number;
}

export interface AutoFixResult {
  fixedCode:    string;
  summary:      AutoFixSummary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applyCdsAutoFix(code: string, report: CleanCoreReport | undefined): AutoFixResult {
  const summary: AutoFixSummary = { fixes: [], considered: 0 };
  if (!code || !report) {
    return { fixedCode: code ?? '', summary };
  }

  let working = code;
  const seenTables = new Set<string>();

  for (const f of report.findings) {
    if (!isAutoFixable(f)) continue;
    summary.considered += 1;

    const tableName = f.reference.trim().toUpperCase();
    if (seenTables.has(tableName)) continue;     // already handled in this pass
    seenTables.add(tableName);

    const cdsView = extractCdsViewName(f.alternative);
    if (!cdsView) continue;

    const { rewritten, occurrences } = rewriteFromClause(working, tableName, cdsView);
    if (occurrences === 0) continue;

    working = rewritten;
    summary.fixes.push({ table: tableName, cdsView, occurrences });
  }

  return { fixedCode: working, summary };
}

// ---------------------------------------------------------------------------
// Eligibility — a finding is auto-fixable when:
//   - it is a 'table' category finding
//   - it has Level C (direct SELECT is the issue)
//   - it has not already been acknowledged by the developer
//   - it has an `alternative` value that starts with a parseable CDS name
// ---------------------------------------------------------------------------

function isAutoFixable(f: CleanCoreFinding): boolean {
  return f.category    === 'table'
      && f.level       === 'C'
      && !f.acknowledged
      && typeof f.alternative === 'string'
      && f.alternative.length > 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCdsViewName(alternative: string | null): string | null {
  if (!alternative) return null;
  // alternative is formatted as "I_SalesDocument (CDS, Level A)" by the
  // CleanCoreVerifier. We just want the leading identifier.
  const m = alternative.trim().match(/^([A-Za-z_][A-Za-z0-9_]+)/);
  return m ? m[1]! : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteFromClause(
  code: string,
  tableUpper: string,
  cdsView: string
): { rewritten: string; occurrences: number } {

  // Match FROM <table> with a leading word boundary on FROM (case-insensitive
  // on both the keyword and the table). The trailing \b on the table name
  // prevents accidental matches like FROM vbak_z123.
  const rx = new RegExp(`\\b(FROM)\\s+(${escapeRegex(tableUpper)})\\b`, 'gi');
  let occurrences = 0;

  const rewritten = code.replace(rx, (_match, fromKw: string) => {
    occurrences += 1;
    return `${fromKw} ${cdsView}`;
  });

  return { rewritten, occurrences };
}
