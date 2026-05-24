/**
 * FdsAnchorExtractor — CPI-6 A9 FDS-fidelity grounding helper.
 *
 * When the LLM generates an Enhancement (or any business-logic-heavy object),
 * it tends to hallucinate generic field names instead of using the specific
 * ones the FDS / BR identified. This module pulls verbatim anchors out of
 * the FDS corpus that the code agent injects into its prompt as "MUST appear
 * unchanged" requirements. Reduces hallucination on identifier names.
 *
 * Anchor categories:
 *   1. Quoted SAP identifiers       — 'XD01', 'KNA1', 'CUSTOMER_ADD_DATA_CS'
 *   2. Standard SAP tables          — KNA1, KNVV, MARA, VBAK, ... (catalog match)
 *   3. SAP transaction codes        — XD01, VD03, SE80, ... (4-char pattern)
 *   4. BAdI / Enhancement spots     — UPPERCASE identifiers with _CS, _PRE, _POST suffixes
 *   5. Capitalized field-label phrases — "Sales Channel", "Chain Code", etc.
 *
 * Output is bounded — at most ~40 anchors total to keep the prompt budget
 * reasonable. Duplicates collapsed, generic noise filtered.
 */

'use strict';

import { SAP_STANDARD_TABLES } from './sapTablesCatalog';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Single- or double-quoted SAP-style identifier (uppercase, digits, _, /). */
const RX_QUOTED_ID = /['"]([A-Z][A-Z0-9_/]{1,40})['"]/g;

/** SAP transaction code — exactly 2-4 uppercase letters followed by 1-3 digits. */
const RX_TX_CODE = /\b([A-Z]{2,4}\d{1,3})\b/g;

/** Standalone uppercase-token (heuristic for tables / BAdI names). */
const RX_UPPER_TOKEN = /\b([A-Z][A-Z0-9_]{3,40})\b/g;

/** Title-cased multi-word phrase — typical field labels like "Sales Channel",
 *  "Chain Code", "Master Chain", "SRP Type", "BP Role", "EDI Indicator",
 *  "OData Service". Each word may be either Title-case (Sales, Channel) or
 *  an all-caps acronym 2-5 letters (SRP, BP, EDI, OData uses uppercase-O
 *  followed by lowercase rest so it matches the Title-case branch). 2-4
 *  words total. */
const RX_TITLE_WORD   = '(?:[A-Z][a-z]+|[A-Z]{2,5})';
const RX_TITLE_PHRASE = new RegExp(`\\b((?:${RX_TITLE_WORD}\\s+){1,3}${RX_TITLE_WORD})\\b`, 'g');

/** BAdI / Enhancement spot naming conventions — usually end in _CS / _PRE /
 *  _POST / _BADI / contain ADD_DATA. */
const RX_BADI_SUFFIX = /(_CS|_PRE|_POST|_BADI|ADD_DATA|FIELD_HANDLER|HEADER_DATA|ITEM_DATA)$/;

// Tokens too generic to be useful anchors. Filtered out before emission.
const GENERIC_TOKENS = new Set<string>([
  'SAP', 'ABAP', 'TODO', 'FIXME', 'XXX', 'NULL', 'NONE', 'TRUE', 'FALSE',
  'YES', 'NO', 'OK', 'CANCEL', 'DELETE', 'UPDATE', 'CREATE', 'INSERT',
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IF', 'THEN', 'ELSE',
  'PROG', 'CLAS', 'INTF', 'DDLS', 'BDEF', 'SRVD', 'SRVB', 'DCLS', 'ENHC',
  'ENHO', 'TABL', 'FUGR', 'FUNC', 'DTEL',
  'BR', 'FDS', 'TDS', 'API', 'OData', 'URL', 'HTTP', 'JSON', 'XML',
  'RICEFW', 'CDS', 'BADI', 'RAP', 'EML', 'BTP', 'HANA', 'S4HANA',
  'FIORI', 'UI5', 'UNFI'
]);

// Title-cased phrases that are common boilerplate, filtered out. The
// relaxed regex (acronym + Title) lets through new combinations that the
// previous regex missed — add them here as they appear in real FDS corpora.
const GENERIC_TITLE_PHRASES = new Set<string>([
  'Business Requirement', 'User Story', 'Acceptance Criteria',
  'Functional Design', 'Technical Design', 'Clean Core',
  'Sales User', 'Sales Order', 'Customer Master',  // these creep in if too common
  'Order Type', 'Order Types',
  // Generic descriptor combos the relaxed regex catches:
  'TODO Item', 'FIXME Note', 'NOTE That',
  'BR Text', 'FDS Text', 'TDS Text', 'API Call', 'SAP System',
  'SAP Standard', 'SAP Note', 'ABAP Code', 'ABAP Class',
  // Pipeline-pattern boilerplate:
  'BR FDS', 'FDS TDS', 'TDS Code', 'Pipeline Run'
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FdsAnchors {
  /** Quoted SAP identifiers from the FDS — exact strings the LLM must use. */
  quotedIds:     string[];
  /** SAP standard tables identified in the FDS corpus. */
  sapTables:     string[];
  /** Transaction codes (e.g. XD01, VD03). */
  transactions:  string[];
  /** BAdI / Enhancement spot names. */
  badis:         string[];
  /** Title-cased field-label phrases — e.g. "Sales Channel", "Chain Code". */
  fieldLabels:   string[];
  /** True when at least one anchor was extracted. */
  hasAnchors:    boolean;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export function extractFdsAnchors(corpus: string): FdsAnchors {
  const text = corpus ?? '';

  // ---- Quoted identifiers ------------------------------------------------
  const quoted = new Set<string>();
  for (const m of text.matchAll(RX_QUOTED_ID)) {
    const t = (m[1] ?? '').trim();
    if (t.length >= 2 && !GENERIC_TOKENS.has(t)) quoted.add(t);
  }

  // ---- Transaction codes -------------------------------------------------
  const txns = new Set<string>();
  for (const m of text.matchAll(RX_TX_CODE)) {
    const t = (m[1] ?? '').trim();
    if (t.length >= 3) txns.add(t);
  }

  // ---- SAP tables (catalog match) + BAdI candidates ----------------------
  const tables = new Set<string>();
  const badis  = new Set<string>();
  for (const m of text.matchAll(RX_UPPER_TOKEN)) {
    const t = (m[1] ?? '').trim();
    if (GENERIC_TOKENS.has(t)) continue;
    if (SAP_STANDARD_TABLES.has(t)) {
      tables.add(t);
      continue;
    }
    if (RX_BADI_SUFFIX.test(t) || t.includes('ADD_DATA')) {
      badis.add(t);
    }
  }
  // Quoted SAP tables / BAdIs also count.
  for (const q of quoted) {
    if (SAP_STANDARD_TABLES.has(q)) tables.add(q);
    if (RX_BADI_SUFFIX.test(q))     badis.add(q);
  }

  // ---- Field-label phrases ----------------------------------------------
  const labels = new Set<string>();
  for (const m of text.matchAll(RX_TITLE_PHRASE)) {
    const phrase = (m[1] ?? '').trim();
    if (phrase.length < 6) continue;
    if (GENERIC_TITLE_PHRASES.has(phrase)) continue;
    // Heuristic: phrases shorter than 4 words are more likely real field labels.
    const wordCount = phrase.split(/\s+/).length;
    if (wordCount > 4) continue;
    labels.add(phrase);
  }

  // ---- Bound the size so the prompt budget stays sane -------------------
  const cap = <T>(s: Set<T>, n: number): T[] => Array.from(s).slice(0, n);

  const anchors: FdsAnchors = {
    quotedIds:    cap(quoted, 20),
    sapTables:    cap(tables, 10),
    transactions: cap(txns, 10),
    badis:        cap(badis, 10),
    fieldLabels:  cap(labels, 20),
    hasAnchors:   false
  };
  anchors.hasAnchors =
    anchors.quotedIds.length > 0 ||
    anchors.sapTables.length > 0 ||
    anchors.transactions.length > 0 ||
    anchors.badis.length > 0 ||
    anchors.fieldLabels.length > 0;
  return anchors;
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderFdsAnchorsForPrompt(anchors: FdsAnchors): string {
  if (!anchors.hasAnchors) return '';
  const sections: string[] = [];
  if (anchors.quotedIds.length > 0) {
    sections.push(`Quoted SAP identifiers (use exactly these strings):\n  ${anchors.quotedIds.map(q => `'${q}'`).join(', ')}`);
  }
  if (anchors.transactions.length > 0) {
    sections.push(`Transaction codes referenced:\n  ${anchors.transactions.join(', ')}`);
  }
  if (anchors.sapTables.length > 0) {
    sections.push(`Standard SAP tables referenced:\n  ${anchors.sapTables.join(', ')}`);
  }
  if (anchors.badis.length > 0) {
    sections.push(`BAdI / Enhancement spot names referenced:\n  ${anchors.badis.join(', ')}`);
  }
  if (anchors.fieldLabels.length > 0) {
    sections.push(`Field-label phrases / business terms (use these verbatim where the BR/FDS calls for them):\n  ${anchors.fieldLabels.map(l => `"${l}"`).join(', ')}`);
  }
  return sections.join('\n\n');
}
