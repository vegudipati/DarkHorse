/**
 * TemplateDiscovery — CPI-6 item 4 Phase A — heading-map discovery utility.
 *
 * Opens an existing FDS or TDS .docx template, walks the document, extracts
 * every heading (paragraphs with pStyle = Heading[1-9]), and emits a starter
 * JSON heading-map. Auto-suggests internal-field mappings via fuzzy match
 * against the known FdsDocument / TdsDocument fields.
 *
 * Workflow:
 *   1. Developer runs "DarkHorse: Discover Template Headings"
 *   2. Picks a docx (e.g. RICEFWID_Description_FDS(Report).docx)
 *   3. Picks ricefwType (Report / Enhancement / Conversions / Forms / Interfaces)
 *   4. Picks kind (fds / tds)
 *   5. DarkHorse writes / updates the templatesConfig JSON with the new
 *      heading map, suggesting auto-mappings the developer reviews + edits.
 *
 * Phase A scope: heading discovery only — table-row column auto-discovery
 * is deferred to Phase B.
 */

'use strict';

import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';

import {
  TemplatesConfig,
  TemplateEntry,
  HeadingMapping,
  TemplateKind,
  resolveTemplatesConfigPath
} from './TemplateConfig';

// ---------------------------------------------------------------------------
// Field-name catalog for auto-suggestion
// ---------------------------------------------------------------------------

const FDS_FIELDS: Record<string, string[]> = {
  businessBackground:    ['overview', 'business background', 'executive summary', 'introduction'],
  businessDriver:        ['business driver', 'business case', 'why', 'rationale'],
  asIsProcess:           ['as-is process', 'as is process', 'current process', 'current state'],
  toBeProcess:           ['to-be process', 'to be process', 'future process', 'future state'],
  businessRisks:         ['business risks', 'risks', 'risk and issues', 'business risks/issues'],
  assumptions:           ['assumptions'],
  processOverview:       ['process description', 'process flow', 'process overview'],
  scope:                 ['scope', 'in scope', 'out of scope'],
  functionalRequirements:['functional requirements', 'requirements', 'functional design considerations'],
  uiDesign:              ['ui design', 'selection screen', 'output of report', 'layout'],
  inputOutputSpec:       ['input output', 'input/output', 'report contents', 'i/o spec', 'data fields'],
  businessRules:         ['business rules', 'rules', 'logic'],
  errorHandling:         ['error handling', 'error', 'exception handling', 'correction and recovery'],
  authorization:         ['authorization', 'security requirements', 'security'],
  reportingRequirements: ['reporting requirements', 'reports', 'report layout'],
  openItems:             ['open items', 'todo', 'tbd'],
  testScenarios:         ['test scenarios', 'unit test', 'functional unit test'],
  performance:           ['performance', 'performance requirements'],
  dependencies:          ['dependencies', 'configuration dependencies', 'development dependencies'],
  frequencyAndSchedule:  ['frequency', 'schedule', 'frequency and schedule']
};

const TDS_FIELDS: Record<string, string[]> = {
  technicalApproach:     ['technical approach', 'architecture', 'design approach'],
  designDecisions:       ['design decisions', 'decisions', 'design considerations'],
  abapObjectList:        ['abap object list', 'object list', 'objects', 'development objects'],
  dataDictionary:        ['data dictionary', 'data model', 'tables and views'],
  programLogic:          ['program logic', 'pseudocode', 'logic', 'algorithm'],
  interfaceDesign:       ['interface design', 'integration design'],
  dbDesign:              ['database design', 'db design', 'data design'],
  errorHandling:         ['error handling', 'exception handling'],
  transportStrategy:     ['transport strategy', 'transport', 'release plan'],
  testScenarios:         ['test scenarios', 'unit test scenarios'],
  openItems:             ['open items', 'todo', 'tbd']
};

function suggestField(heading: string, kind: TemplateKind): string | null {
  const catalog = kind === 'fds' ? FDS_FIELDS : TDS_FIELDS;
  const norm = heading.trim().toLowerCase();
  // Score each field by overlap with the heading text. Highest score wins.
  let best: { field: string; score: number } | null = null;
  for (const [field, synonyms] of Object.entries(catalog)) {
    for (const syn of synonyms) {
      if (norm === syn) {
        return field;
      }
      if (norm.includes(syn) || syn.includes(norm)) {
        const score = Math.min(norm.length, syn.length);
        if (!best || score > best.score) best = { field, score };
      }
    }
  }
  return best ? best.field : null;
}

// ---------------------------------------------------------------------------
// Docx heading extraction (Phase A — text-only)
// ---------------------------------------------------------------------------

interface DiscoveredHeading {
  level:    number;     // 1..9 from Heading[N]
  text:     string;
  order:    number;     // doc-order
}

export function extractHeadings(docxPath: string): DiscoveredHeading[] {
  const PizZip = require('pizzip');
  const buf    = fs.readFileSync(docxPath);
  const zip    = new PizZip(buf);
  let docXml   = zip.file('word/document.xml')?.asText();
  if (!docXml) {
    throw new Error(`Template ${docxPath} has no word/document.xml — not a valid docx.`);
  }
  // @xmldom/xmldom 0.9.x is strict: any byte before the <?xml ...?> declaration
  // throws. Word writes a UTF-8 BOM and occasionally leading whitespace.
  docXml = stripXmlPrologueNoise(docXml);

  const { DOMParser } = require('@xmldom/xmldom');
  const dom = new DOMParser({ onError: () => { /* swallow */ } })
    .parseFromString(docXml, 'application/xml');

  const paragraphs = dom.getElementsByTagName('w:p');
  const results: DiscoveredHeading[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs.item(i);
    if (!p) continue;
    const styles = (p as any).getElementsByTagName('w:pStyle');
    if (!styles || styles.length === 0) continue;
    const styleNode = styles.item(0);
    const styleVal  = styleNode?.getAttribute('w:val') ?? '';
    const headingMatch = /^Heading(\d+)$/.exec(styleVal);
    if (!headingMatch) continue;

    const level = parseInt(headingMatch[1]!, 10);
    // Collect <w:t> text across all runs in this paragraph.
    const tNodes = (p as any).getElementsByTagName('w:t');
    let text = '';
    for (let j = 0; j < tNodes.length; j++) {
      text += tNodes.item(j)?.textContent ?? '';
    }
    text = text.trim();
    if (text.length === 0) continue;
    results.push({ level, text, order: i });
  }
  return results;
}

function stripXmlPrologueNoise(xml: string): string {
  // Drop UTF-8 BOM if present.
  if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
  // Drop any leading whitespace before the XML declaration.
  return xml.replace(/^\s+/, '');
}

// ---------------------------------------------------------------------------
// Build a starter heading map JSON entry
// ---------------------------------------------------------------------------

export function buildEntryFromHeadings(
  docxPath: string,
  headings: DiscoveredHeading[],
  kind:     TemplateKind
): TemplateEntry {
  const mapped: Record<string, HeadingMapping> = {};
  for (const h of headings) {
    if (mapped[h.text]) continue;     // first occurrence wins
    const field = suggestField(h.text, kind);
    if (field) {
      mapped[h.text] = { field };
    } else {
      // Leave the entry in the file so the developer can manually map it.
      mapped[h.text] = {};
    }
  }
  return { templatePath: docxPath, headings: mapped };
}

// ---------------------------------------------------------------------------
// Merge a freshly discovered entry into an existing TemplatesConfig
// ---------------------------------------------------------------------------

function mergeIntoConfig(
  configPath: string,
  client:     string,
  ricefw:     string,
  kind:       TemplateKind,
  entry:      TemplateEntry
): TemplatesConfig {
  let config: TemplatesConfig;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as TemplatesConfig;
    } catch {
      config = { client, templates: {} };
    }
  } else {
    config = { client, templates: {} };
  }
  if (!config.templates) config.templates = {};
  if (!config.templates[ricefw]) config.templates[ricefw] = {};
  config.templates[ricefw]![kind] = entry;
  return config;
}

// ---------------------------------------------------------------------------
// Command handler — "DarkHorse: Discover Template Headings"
// ---------------------------------------------------------------------------

export async function runDiscoverTemplateHeadingsCommand(): Promise<void> {
  const docxUri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters:       { 'Word documents': ['docx'] },
    openLabel:     'Pick FDS/TDS template'
  });
  if (!docxUri || docxUri.length === 0) return;
  const docxPath = docxUri[0]!.fsPath;

  const ricefw = await vscode.window.showQuickPick(
    ['Report', 'Enhancement', 'Conversions', 'Forms', 'Interfaces'],
    { placeHolder: 'RICEFW type for this template' }
  );
  if (!ricefw) return;

  const kind = await vscode.window.showQuickPick(
    ['fds', 'tds'],
    { placeHolder: 'Template kind' }
  ) as TemplateKind | undefined;
  if (!kind) return;

  // Where to write the templates-config JSON
  const configured = resolveTemplatesConfigPath();
  let configPath = configured;
  if (!configPath) {
    const clientId = vscode.workspace.getConfiguration().get<string>('darkhorse.client.id', '') || 'CLIENT';
    const defaultPath = path.join(path.dirname(docxPath), `${clientId}-templates.json`);
    const picked = await vscode.window.showInputBox({
      prompt:    'Path to write the templates-config JSON (set darkhorse.client.templatesConfig to point here)',
      value:     defaultPath,
      ignoreFocusOut: true
    });
    if (!picked) return;
    configPath = picked;
  }

  // Read headings + build entry
  let headings: DiscoveredHeading[];
  try {
    headings = extractHeadings(docxPath);
  } catch (err: any) {
    vscode.window.showErrorMessage(`DarkHorse: ${err?.message ?? err}`);
    return;
  }
  if (headings.length === 0) {
    vscode.window.showWarningMessage(
      'DarkHorse: No Heading[1-9] paragraphs found in this template. Confirm the file uses Word heading styles.'
    );
    return;
  }
  const entry = buildEntryFromHeadings(docxPath, headings, kind);

  const clientId = vscode.workspace.getConfiguration().get<string>('darkhorse.client.id', '') || 'CLIENT';
  const merged = mergeIntoConfig(configPath, clientId, ricefw, kind, entry);

  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err: any) {
    vscode.window.showErrorMessage(`DarkHorse: Could not write ${configPath} — ${err?.message ?? err}`);
    return;
  }

  const mappedCount   = Object.values(entry.headings).filter(h => Boolean(h.field)).length;
  const unmappedCount = Object.keys(entry.headings).length - mappedCount;
  vscode.window.showInformationMessage(
    `DarkHorse: Discovered ${headings.length} headings (${mappedCount} auto-mapped, ${unmappedCount} need manual review). Wrote ${configPath}.`
  );

  // Open the JSON for review
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}
