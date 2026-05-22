/**
 * TemplateConfig — CPI-6 item 4 — per-client FDS/TDS template configuration.
 *
 * Loads a JSON file (settings: darkhorse.client.templatesConfig) that maps
 * the client's FDS/TDS Word templates to DarkHorse internal field names.
 * One file per client; covers all RICEFW types (Report / Enhancement /
 * Conversions / Forms / Interfaces) and both kinds (fds / tds).
 *
 * File watcher invalidates the cache on save — no extension restart needed.
 *
 * Schema:
 *   {
 *     "client": "UNFI",
 *     "templates": {
 *       "Report": {
 *         "fds": {
 *           "templatePath": "C:\\...\\RICEFWID_Description_FDS(Report).docx",
 *           "headings": {
 *             "Overview":          { "field": "businessBackground" },
 *             "Business Driver":   { "field": "businessDriver" },
 *             "Selection Screen":  { "table": "selectionScreenRows",
 *                                     "columns": ["section","field","mandatory"] }
 *           }
 *         },
 *         "tds": { ... }
 *       },
 *       "Enhancement": { ... },
 *       ...
 *     }
 *   }
 *
 * Phase A renders text fields. Phase B will render `table` mappings.
 */

'use strict';

import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TemplateKind = 'fds' | 'tds';

export interface HeadingMapping {
  /** Internal DarkHorse field whose generated text replaces the paragraph
   *  immediately after this heading. */
  field?:   string;
  /** Phase-B: signals this heading owns a table that needs row insertion.
   *  rowsField is the FdsDocument / TdsDocument field carrying the row data;
   *  columns lists the column order. Ignored in Phase A. */
  table?:   string;
  columns?: string[];
}

export interface TemplateEntry {
  templatePath: string;
  /** Heading text (exact match) -> mapping. */
  headings:     Record<string, HeadingMapping>;
}

export interface RicefwTemplates {
  fds?: TemplateEntry;
  tds?: TemplateEntry;
}

export interface TemplatesConfig {
  client:    string;
  templates: Record<string, RicefwTemplates>;     // RICEFW type -> entries
}

// ---------------------------------------------------------------------------
// Cache + watcher
// ---------------------------------------------------------------------------

let _cache: { configPath: string; config: TemplatesConfig | null } | null = null;
let _watcher: vscode.FileSystemWatcher | null = null;

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

export function resolveTemplatesConfigPath(): string | null {
  const fromSetting = vscode.workspace.getConfiguration()
    .get<string>('darkhorse.client.templatesConfig', '');
  const trimmed = (fromSetting || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadTemplatesConfig(): TemplatesConfig | null {
  const configPath = resolveTemplatesConfigPath();
  if (!configPath) {
    _cache = null;
    return null;
  }

  if (_cache && _cache.configPath === configPath && _cache.config) {
    return _cache.config;
  }

  ensureWatcher(configPath);

  if (!fs.existsSync(configPath)) {
    process.stderr.write(`[DarkHorse] Templates config not found at ${configPath}\n`);
    _cache = { configPath, config: null };
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as TemplatesConfig;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.templates !== 'object') {
      process.stderr.write(`[DarkHorse] Templates config at ${configPath} is malformed: missing 'templates' map\n`);
      _cache = { configPath, config: null };
      return null;
    }
    _cache = { configPath, config: parsed };
    return parsed;
  } catch (err: any) {
    process.stderr.write(`[DarkHorse] Failed to read templates config: ${err?.message ?? err}\n`);
    _cache = { configPath, config: null };
    return null;
  }
}

/**
 * Resolve the template entry for a given RICEFW type + kind (fds | tds).
 * Returns null when no config is set, the RICEFW type isn't mapped, or the
 * specific kind is missing. The renderer falls back to the generic DocxWriter
 * in that case — no error.
 */
export function resolveTemplate(
  ricefwType: string,
  kind: TemplateKind
): TemplateEntry | null {
  const config = loadTemplatesConfig();
  if (!config) return null;

  // Case-insensitive RICEFW match — keys are commonly "Report" / "Enhancement"
  // / etc., but the BR field can be "Reports" or "REPORT". Match the prefix.
  const ricefwKey = Object.keys(config.templates).find(k =>
    ricefwType.trim().toLowerCase().startsWith(k.trim().toLowerCase())
  );
  if (!ricefwKey) return null;

  const entry = config.templates[ricefwKey];
  if (!entry) return null;
  return entry[kind] ?? null;
}

// ---------------------------------------------------------------------------
// File watcher — hot reload
// ---------------------------------------------------------------------------

function ensureWatcher(configPath: string): void {
  if (_watcher && _cache?.configPath === configPath) return;
  if (_watcher) { _watcher.dispose(); _watcher = null; }

  const pattern = new vscode.RelativePattern(
    path.dirname(configPath),
    path.basename(configPath)
  );
  _watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const invalidate = () => { _cache = null; };
  _watcher.onDidChange(invalidate);
  _watcher.onDidCreate(invalidate);
  _watcher.onDidDelete(invalidate);
}

// ---------------------------------------------------------------------------
// Command — open the templates config (or create a starter from discovery)
// ---------------------------------------------------------------------------

export async function runOpenTemplatesConfigCommand(): Promise<void> {
  const configured = resolveTemplatesConfigPath();
  if (!configured) {
    vscode.window.showInformationMessage(
      'DarkHorse: darkhorse.client.templatesConfig is not set. Opening Settings — search for "darkhorse client".'
    );
    vscode.commands.executeCommand('workbench.action.openSettings', 'darkhorse.client.templatesConfig');
    return;
  }
  if (!fs.existsSync(configured)) {
    vscode.window.showInformationMessage(
      `DarkHorse: ${configured} does not exist. Run "DarkHorse: Discover Template Headings" against each client template — the discovery utility will create or merge into this file.`
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configured));
  await vscode.window.showTextDocument(doc, { preview: false });
}
