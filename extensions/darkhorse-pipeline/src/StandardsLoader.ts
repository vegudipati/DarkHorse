/**
 * StandardsLoader — CPI-6 item 3 — per-client development standards.
 *
 * Reads a client-specific Markdown file (settings: darkhorse.client.standardsFile,
 * with darkhorse.client.id as a human label) and exposes its content as a
 * grounding-style block that gets injected at the TOP of every LLM prompt
 * across the pipeline (SO / FDS / TDS / Code).
 *
 * Why a Markdown file:
 *   - Trivially editable by the client SAP lead — same skill as editing
 *     a wiki page.
 *   - Hot-reloads on save via vscode.workspace.createFileSystemWatcher —
 *     the developer doesn't need to restart VS Code when standards change.
 *   - Renders unchanged into the LLM prompt; no schema, no validation
 *     surprises.
 *
 * Why on top (not nested inside grounding):
 *   - Client standards override generic defaults. If the client says
 *     "all custom programs prefix ZC_" and our default prompt says "Z prefix",
 *     the client value must win. Highest-priority signals go FIRST in the
 *     prompt by convention.
 *
 * Standards file structure (recommended; not enforced):
 *   # Client Development Standards — <Client Name>
 *   ## Naming Conventions
 *   ## Authorization
 *   ## Logging
 *   ## Error Handling
 *   ## Transport
 *   ## Testing
 *   ## Performance
 *   ## Code Review
 *
 * The whole file is rendered into the prompt (no per-section selection
 * logic in v1). Future enhancement: pick only the sections relevant to
 * the current stage via simple keyword filtering.
 */

'use strict';

import * as fs     from 'fs';
import * as path   from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

interface CachedStandards {
  filePath:   string;
  clientId:   string;
  content:    string;
  loadedAt:   string;
}

let _cache: CachedStandards | null = null;
let _watcher: vscode.FileSystemWatcher | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the configured standards-file path. Returns the absolute path
 * or null when no path is configured. Does NOT read the file.
 */
export function resolveStandardsFilePath(): string | null {
  const fromSetting = vscode.workspace.getConfiguration()
    .get<string>('darkhorse.client.standardsFile', '');
  const trimmed = (fromSetting || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveClientId(): string {
  const fromSetting = vscode.workspace.getConfiguration()
    .get<string>('darkhorse.client.id', '');
  return (fromSetting || '').trim() || 'UNSPECIFIED';
}

/**
 * Returns the markdown content of the configured client standards file,
 * or null when no file is configured / the file is missing / unreadable.
 * Caches in memory; the file-watcher (set up by ensureWatcher) invalidates
 * the cache on save.
 */
export function loadStandards(): CachedStandards | null {
  const filePath = resolveStandardsFilePath();
  if (!filePath) {
    _cache = null;
    return null;
  }

  // Cache hit
  if (_cache && _cache.filePath === filePath) {
    return _cache;
  }

  ensureWatcher(filePath);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`[DarkHorse] Standards file not found at ${filePath}\n`);
    _cache = null;
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    _cache = {
      filePath,
      clientId: resolveClientId(),
      content,
      loadedAt: new Date().toISOString()
    };
    return _cache;
  } catch (err: any) {
    process.stderr.write(`[DarkHorse] Failed to read standards file: ${err?.message ?? err}\n`);
    _cache = null;
    return null;
  }
}

/**
 * Renders the client standards content as a high-priority prompt block.
 * Returns an empty string when no standards file is configured — call
 * sites can prepend the result unconditionally.
 */
export function renderStandardsForPrompt(): string {
  const standards = loadStandards();
  if (!standards) return '';

  // Trim trailing whitespace; preserve internal Markdown.
  const trimmed = standards.content.replace(/\s+$/, '');

  return [
    `## Client Development Standards (${standards.clientId})`,
    '',
    'The following Markdown is the AUTHORITATIVE client-specific development',
    'standards file. It OVERRIDES any default convention in this prompt or in',
    'any grounding section below. Where this file is silent, the default',
    'conventions apply. When in conflict, this section wins.',
    '',
    '<<<begin-standards>>>',
    trimmed,
    '<<<end-standards>>>'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// File watcher — hot-reload on save
// ---------------------------------------------------------------------------

function ensureWatcher(filePath: string): void {
  // Re-arm the watcher if the configured path changed.
  if (_watcher) {
    if (_cache?.filePath === filePath) return;   // already watching this path
    _watcher.dispose();
    _watcher = null;
  }

  const pattern = new vscode.RelativePattern(
    path.dirname(filePath),
    path.basename(filePath)
  );
  _watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const invalidate = () => { _cache = null; };
  _watcher.onDidChange(invalidate);
  _watcher.onDidCreate(invalidate);
  _watcher.onDidDelete(invalidate);
}

// ---------------------------------------------------------------------------
// Command — open or create the client standards file
// ---------------------------------------------------------------------------

const STARTER_TEMPLATE = `# Client Development Standards

> Edit this file with your team's actual conventions. DarkHorse injects this
> file into every LLM prompt (SO / FDS / TDS / Code) at the top, ABOVE any
> grounding section. Changes are picked up automatically — no restart needed.

## Naming Conventions
- Custom programs:        Z<MODULE>_<PURPOSE>
- CDS interface views:    ZI_<Entity>
- CDS projection views:   ZC_<Entity>
- Behavior pool classes:  ZBP_I_<Entity>
- Service definitions:    ZUI_<Entity>
- Service bindings:       ZUI_<Entity>_O4
- Custom Z-tables:        Z<MODULE>_<NAME>
- Message classes:        ZMSG_<MODULE>

## Authorization
- Always declare authorization objects in the TDS technicalApproach.
- For each AUTHORITY-CHECK, document the activity codes used (01 / 02 / 03 / 06).
- Standard auth objects: S_TCODE (transactions), V_VBAK_VKO (sales-org), etc.

## Logging
- Use SAP Application Log (SLG1) for ALL logging.
- Log object:    Z_<CLIENT_PREFIX>_LOG
- Subobject:     one per business scenario (e.g. Z_BACKORDER, Z_RAP).
- Severities:    use 'E' (Error), 'W' (Warning), 'I' (Info), 'S' (Success).

## Error Handling
- All RFC / FM failures must be wrapped in custom exceptions extending CX_STATIC_CHECK.
- Custom exception classes follow ZCX_<MODULE>_<PURPOSE>.
- Never silently swallow CX_ROOT — always re-raise or write to the application log.

## Transport
- All custom development goes into a single transport per BR, named ZCR-<BR-NUMBER>.
- Customizing changes go into a separate customizing transport.

## Testing
- Every new RAP behavior pool class must have at least one unit-test class (ZTC_*).
- Use ABAP Unit framework (CL_AUNIT_ASSERT).

## Performance
- Avoid SELECT-LOOP-SELECT patterns; use FOR ALL ENTRIES or CDS joins.
- All custom CDS views must have @AbapCatalog.preserveKey: true.
- Avoid SELECT * on any view with more than 30 fields.

## Code Review
- All AI-generated code requires senior-developer signoff before being moved into the dev system.
- The DarkHorse UID in each header (16-hex) is the audit-trail reference.
`;

export async function runOpenClientStandardsCommand(): Promise<void> {
  console.log('[DarkHorse] openClientStandards: command invoked');

  const configured = resolveStandardsFilePath();
  console.log('[DarkHorse] openClientStandards: configured path =', JSON.stringify(configured));

  if (!configured) {
    vscode.window.showInformationMessage(
      'DarkHorse: darkhorse.client.standardsFile is not set. Opening Settings — search for "darkhorse client".'
    );
    vscode.commands.executeCommand('workbench.action.openSettings', 'darkhorse.client');
    return;
  }

  // Expand ~ in case the user typed a tilde path on Windows
  const resolved = configured.replace(/^~(?=$|\/|\\)/, require('os').homedir());

  // If the configured file doesn't exist yet, create it directly from the
  // starter template. The developer has already configured the path — that's
  // the consent; no extra confirmation prompt (the previous toast was easy
  // to miss).
  if (!fs.existsSync(resolved)) {
    console.log('[DarkHorse] openClientStandards: file missing, creating from starter template');
    try {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, STARTER_TEMPLATE, 'utf-8');
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `DarkHorse: Could not create standards file at ${resolved} — ${err?.message ?? err}`
      );
      return;
    }
    vscode.window.showInformationMessage(
      `DarkHorse: Created starter standards file at ${resolved}. Edit it for your team's conventions; changes are hot-reloaded.`
    );
  }

  console.log('[DarkHorse] openClientStandards: opening', resolved);
  const uri = vscode.Uri.file(resolved);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}
