/**
 * TemplateRenderer — CPI-6 item 4 Phase A.
 *
 * Opens an existing client FDS/TDS .docx template, walks the document XML,
 * and for every heading mentioned in the heading map, REPLACES the
 * immediately-following paragraph's text content with the generated value
 * from the FDS / TDS document. The template's cover page, table of contents,
 * heading styles, tables, footers, and branding all stay intact — only the
 * "Describe..." instruction paragraphs become real content.
 *
 * Phase A scope: TEXT sections only. Tables (Selection Screen / Report
 * Contents / Test Scenarios / Dependencies) are left untouched in Phase A;
 * row insertion lands in Phase B.
 *
 * Implementation:
 *   - pizzip reads/writes the docx ZIP.
 *   - @xmldom/xmldom parses + serializes word/document.xml.
 *   - We never construct new run-level formatting — we reuse the existing
 *     <w:r><w:rPr>...</w:rPr></w:r> wrapper from the paragraph we're
 *     replacing, so the typography of the template is preserved.
 *
 * Limitations (acceptable for Phase A):
 *   - Multi-paragraph LLM output collapses into a single paragraph today.
 *     Phase B can split on \n\n and create one paragraph per blob.
 *   - List / bullet content is rendered as plain text. Phase B can convert
 *     to bullet lists via numId resolution.
 */

'use strict';

import * as fs   from 'fs';
import * as path from 'path';

import { TemplateEntry, HeadingMapping } from './TemplateConfig';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderInput {
  template: TemplateEntry;
  /** Field-name -> content. Keys must match the `field` values in the
   *  template's headings map. Values are rendered as plain text (newlines
   *  preserved within the single replaced paragraph). */
  fields:   Record<string, string | string[] | undefined>;
}

export interface RenderResult {
  buffer:         Buffer;
  replacedCount:  number;
  unmappedFields: string[];
  missingHeadings: string[];
}

export function renderIntoTemplate(input: RenderInput): RenderResult {
  const PizZip      = require('pizzip');
  const xmldom      = require('@xmldom/xmldom');
  const DOMParser   = xmldom.DOMParser;
  const XMLSerializer = xmldom.XMLSerializer;

  const templateBuf = fs.readFileSync(input.template.templatePath);
  const zip = new PizZip(templateBuf);
  let docXml = zip.file('word/document.xml')?.asText();
  if (!docXml) {
    throw new Error(`Template ${input.template.templatePath} has no word/document.xml.`);
  }
  // Drop UTF-8 BOM + leading whitespace before <?xml ...?> — @xmldom/xmldom 0.9.x is strict.
  if (docXml.charCodeAt(0) === 0xFEFF) docXml = docXml.slice(1);
  docXml = docXml.replace(/^\s+/, '');

  const dom = new DOMParser({ onError: () => { /* swallow */ } })
    .parseFromString(docXml, 'application/xml');

  // Walk paragraphs sequentially. When we encounter a heading that maps to a
  // field, replace the *next* paragraph's text content.
  const body = dom.getElementsByTagName('w:body').item(0);
  if (!body) {
    throw new Error(`Template ${input.template.templatePath} has no <w:body>.`);
  }

  // Collect children — we iterate the body's direct child elements in order.
  const children: any[] = [];
  for (let i = 0; i < body.childNodes.length; i++) {
    const c = body.childNodes.item(i);
    if (c && (c as any).nodeType === 1 /* ELEMENT_NODE */) {
      children.push(c);
    }
  }

  const headingMap = input.template.headings;
  const replacedFields = new Set<string>();
  const missingHeadings: string[] = [];
  let replacedCount = 0;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (!isParagraph(node)) continue;
    if (!isHeading(node)) continue;

    const text = paragraphText(node).trim();
    if (text.length === 0) continue;

    const mapping: HeadingMapping | undefined = headingMap[text];
    if (!mapping || !mapping.field) continue;

    const value = input.fields[mapping.field];
    if (value === undefined) {
      missingHeadings.push(text);
      continue;
    }
    const rendered = normaliseValue(value);
    if (rendered.length === 0) {
      missingHeadings.push(text);
      continue;
    }

    // Find the next paragraph to replace
    const next = nextParagraph(children, i);
    if (!next) continue;
    setParagraphText(next, rendered, dom);
    replacedCount += 1;
    replacedFields.add(mapping.field);
  }

  const newXml = new XMLSerializer().serializeToString(dom);
  zip.file('word/document.xml', newXml);
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  const unmappedFields = Object.keys(input.fields).filter(f => !replacedFields.has(f));

  return {
    buffer:          out,
    replacedCount,
    unmappedFields,
    missingHeadings
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isParagraph(node: any): boolean {
  return node && node.tagName === 'w:p';
}

function isHeading(p: any): boolean {
  const styles = p.getElementsByTagName('w:pStyle');
  if (!styles || styles.length === 0) return false;
  const v = styles.item(0)?.getAttribute('w:val') ?? '';
  return /^Heading\d+$/.test(v);
}

function paragraphText(p: any): string {
  const tNodes = p.getElementsByTagName('w:t');
  let text = '';
  for (let i = 0; i < tNodes.length; i++) {
    text += tNodes.item(i)?.textContent ?? '';
  }
  return text;
}

function nextParagraph(children: any[], fromIndex: number): any | null {
  for (let i = fromIndex + 1; i < children.length; i++) {
    const n = children[i];
    if (isParagraph(n) && !isHeading(n)) return n;
    if (isParagraph(n) && isHeading(n)) return null;   // empty section
  }
  return null;
}

/**
 * Replace the paragraph's text content while preserving its first run's
 * formatting (rPr). All existing <w:r> elements are removed and a single
 * new run carrying the replacement text is appended.
 */
function setParagraphText(p: any, text: string, dom: any): void {
  // Capture the first run's rPr (formatting) if any — we want to keep the
  // template's font / size / bold-italic style on the replaced text.
  let preservedRpr: any = null;
  const firstRun = p.getElementsByTagName('w:r').item(0);
  if (firstRun) {
    const rprs = firstRun.getElementsByTagName('w:rPr');
    if (rprs.length > 0) {
      preservedRpr = rprs.item(0)!.cloneNode(true);
    }
  }

  // Remove all existing runs in this paragraph.
  // Collect first to avoid mutating-while-iterating issues.
  const runs: any[] = [];
  for (let i = 0; i < p.childNodes.length; i++) {
    const n = p.childNodes.item(i);
    if (n && (n as any).tagName === 'w:r') runs.push(n);
  }
  for (const r of runs) p.removeChild(r);

  // Build one new run with preserved formatting + the new text.
  const newRun = dom.createElement('w:r');
  if (preservedRpr) newRun.appendChild(preservedRpr);
  const t = dom.createElement('w:t');
  // Preserve internal whitespace — important for blocks that begin/end with newlines.
  t.setAttribute('xml:space', 'preserve');
  t.appendChild(dom.createTextNode(text));
  newRun.appendChild(t);
  p.appendChild(newRun);
}

function normaliseValue(value: string | string[] | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  return String(value).trim();
}

// ---------------------------------------------------------------------------
// Convenience writer — render + write file
// ---------------------------------------------------------------------------

export function renderIntoTemplateFile(
  template:   TemplateEntry,
  fields:     Record<string, string | string[] | undefined>,
  outputPath: string
): RenderResult {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const result = renderIntoTemplate({ template, fields });
  fs.writeFileSync(outputPath, result.buffer);
  return result;
}
