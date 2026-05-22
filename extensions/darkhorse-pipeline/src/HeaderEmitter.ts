/**
 * HeaderEmitter — produces the standardized DarkHorse header comment block
 * that prepends every AI-generated object.
 *
 * Compliance backdrop: every AI-generated SAP object must be traceable. The
 * header carries a 16-hex DarkHorse UID (issued by UidLogger), the model,
 * timestamp, business-requirement reference, and pipeline ID — so any code
 * in production can be cross-referenced to the audit log without inspecting
 * git history or the LLM-proxy logs.
 *
 * Behavior:
 *   - The header syntax matches the object type. ABAP-syntax objects
 *     (PROG / CLAS / FUGR / INCL) use `*` at column 1. CDS-syntax objects
 *     (DDLS / BDEF / SRVD / SRVB) use `//`. TABL is handled as ABAP-style
 *     since it's typically defined via SE11 declarative form but pasted as
 *     DDIC source.
 *   - If the LLM emitted its own header (despite the system prompt telling
 *     it not to), stripExistingHeader() detects and removes the LLM block
 *     before our canonical header is prepended. No double-header risk.
 */

'use strict';

import { AbapObject } from './PipelineStateManager';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CommentStyle = 'abap' | 'cds';

export interface HeaderInput {
  obj:           AbapObject;
  uid:           string;
  timestamp:     string;        // ISO 8601 UTC from UidLogger
  model:         string;
  pipelineTitle: string;
  brRef:         string;
  version?:      string;        // default '1.0'
  functionName?: string;        // top-level method/function inside the object
}

// ---------------------------------------------------------------------------
// Object-type -> comment-style classification
// ---------------------------------------------------------------------------

const CDS_STYLE_TYPES = new Set<string>([
  'DDLS', 'BDEF', 'SRVD', 'SRVB', 'DCLS', 'DDLX', 'STOB'
]);

function commentStyleFor(objectType: string): CommentStyle {
  return CDS_STYLE_TYPES.has(objectType.trim().toUpperCase()) ? 'cds' : 'abap';
}

// ---------------------------------------------------------------------------
// Header rendering
// ---------------------------------------------------------------------------

interface HeaderField {
  label: string;
  value: string;
}

function buildFields(input: HeaderInput): HeaderField[] {
  const purpose = (input.obj.description || 'Not specified').replace(/\r?\n/g, ' ').trim();
  return [
    { label: 'Object Name',     value: input.obj.objectName },
    { label: 'Function/Method', value: input.functionName ?? '(see body)' },
    { label: 'Business Purpose',value: purpose },
    { label: 'Requirements',    value: input.brRef || input.pipelineTitle },
    { label: 'AI Generated',    value: 'Yes' },
    { label: 'Model',           value: input.model },
    { label: 'Generated On',    value: formatTimestamp(input.timestamp) },
    { label: 'Version',         value: input.version ?? '1.0' },
    { label: 'DarkHorse UID',   value: input.uid }
  ];
}

function formatTimestamp(iso: string): string {
  // Render as "2026-05-22 14:32:18 UTC" — readable + audit-friendly
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
       + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function renderAbapHeader(input: HeaderInput): string {
  const fields = buildFields(input);
  const labelWidth = Math.max(...fields.map(f => f.label.length));
  const ruleLine   = '*' + '-'.repeat(72) + '*';

  const lines: string[] = [ruleLine];
  for (const f of fields) {
    const paddedLabel = f.label.padEnd(labelWidth);
    lines.push(`*  ${paddedLabel} : ${f.value}`);
  }
  lines.push(ruleLine);
  return lines.join('\n') + '\n';
}

function renderCdsHeader(input: HeaderInput): string {
  const fields = buildFields(input);
  const labelWidth = Math.max(...fields.map(f => f.label.length));
  const ruleLine   = '//' + '-'.repeat(72);

  const lines: string[] = [ruleLine];
  for (const f of fields) {
    const paddedLabel = f.label.padEnd(labelWidth);
    lines.push(`//  ${paddedLabel} : ${f.value}`);
  }
  lines.push(ruleLine);
  return lines.join('\n') + '\n';
}

export function renderHeader(input: HeaderInput): string {
  return commentStyleFor(input.obj.objectType) === 'cds'
    ? renderCdsHeader(input)
    : renderAbapHeader(input);
}

// ---------------------------------------------------------------------------
// Strip any LLM-emitted header so we don't double up
// ---------------------------------------------------------------------------

/**
 * Detects the most common LLM header shapes and removes them. We are
 * conservative — only strip blocks at the very top of the file that look
 * like an LLM-emitted DarkHorse-style header. Real ABAP business comments
 * further down in the body are left alone.
 *
 * Detection rules (any match removes the leading block):
 *   - First non-empty line starts with `*---` or `*--+` (ABAP rule line)
 *   - First non-empty line starts with `//---` (CDS rule line)
 *   - First non-empty line is a single-asterisk banner `*&----` followed by
 *     more `*&` lines (older SE38 style)
 */
export function stripExistingHeader(code: string): string {
  const lines = code.split(/\r?\n/);
  // Find the first non-empty line
  let firstIdx = 0;
  while (firstIdx < lines.length && lines[firstIdx]!.trim() === '') firstIdx++;
  if (firstIdx === lines.length) return code;

  const first = lines[firstIdx]!.trimStart();

  const isAbapRule = /^\*[-+]{3,}/.test(first) || /^\*&[-+]{3,}/.test(first);
  const isCdsRule  = /^\/\/[-+]{3,}/.test(first);
  if (!isAbapRule && !isCdsRule) return code;

  // Walk forward until we find a line that's NOT in the comment style.
  // For ABAP-style we accept lines starting with `*` (any column 1 comment).
  // For CDS-style we accept lines starting with `//`.
  const isCommentLine = isCdsRule
    ? (l: string) => l.trimStart().startsWith('//')
    : (l: string) => l.trimStart().startsWith('*');

  let endIdx = firstIdx;
  while (endIdx < lines.length && (isCommentLine(lines[endIdx]!) || lines[endIdx]!.trim() === '')) {
    endIdx++;
  }

  // Drop the header block and any single blank line directly after it.
  let cutEnd = endIdx;
  if (cutEnd < lines.length && lines[cutEnd]!.trim() === '') cutEnd++;
  return lines.slice(cutEnd).join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point — strip existing header, prepend canonical one
// ---------------------------------------------------------------------------

export function applyHeader(code: string, input: HeaderInput): string {
  const stripped = stripExistingHeader(code);
  return renderHeader(input) + stripped;
}
