import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineStateManager } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { StyleContext } from './ReferenceDocLoader';

export interface BrIntakeData {
  title: string;
  ricefwType: string;
  objectType: string;
  sapPackage: string;
  brText: string;
  outputFolder: string;
}

export class BrIntakePanel {

  private static currentPanel: BrIntakePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private stateManager: PipelineStateManager;
  private tracker: PipelineTracker;
  private context: vscode.ExtensionContext;

  public static async show(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {
    if (BrIntakePanel.currentPanel) {
      BrIntakePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseBrIntake',
      'DarkHorse — New Pipeline',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    BrIntakePanel.currentPanel = new BrIntakePanel(
      panel, context, stateManager, tracker
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ) {
    this.panel = panel;
    this.context = context;
    this.stateManager = stateManager;
    this.tracker = tracker;

    const config = vscode.workspace.getConfiguration();
    const defaultPackage = config.get<string>('darkhorse.pipeline.defaultPackage', '');
    const styleContext = stateManager.getStyleContext() as StyleContext | undefined;
    const refDocsLoaded = styleContext !== undefined && (styleContext.documentCount ?? 0) > 0;

    this.panel.webview.html = this.getHtml(defaultPackage, refDocsLoaded, styleContext);

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'submit':
          await this.handleSubmit(message.data);
          break;
        case 'cancel':
          this.panel.dispose();
          break;
        case 'pickOutputFolder':
          await this.pickOutputFolder();
          break;
        case 'loadReferenceDocs':
          await vscode.commands.executeCommand('darkhorse.pipeline.loadReferenceDocs');
          this.panel.dispose();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      BrIntakePanel.currentPanel = undefined;
    });
  }

  private async pickOutputFolder(): Promise<void> {
    const folderUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Output Folder',
      title: 'Select folder where FDS and TDS documents will be saved'
    });
    if (folderUri && folderUri.length > 0) {
      const folderPath = folderUri[0].fsPath;
      await vscode.workspace.getConfiguration().update(
        'darkhorse.pipeline.outputFolder',
        folderPath,
        vscode.ConfigurationTarget.Global
      );
      this.panel.webview.postMessage({
        command: 'outputFolderSelected',
        path: folderPath
      });
    }
  }

  private async handleSubmit(data: BrIntakeData): Promise<void> {
    // Validate output folder
    if (!data.outputFolder) {
      this.panel.webview.postMessage({
        command: 'error',
        field: 'outputFolder',
        message: 'Output folder is required'
      });
      return;
    }

    // Save output folder to settings
    await vscode.workspace.getConfiguration().update(
      'darkhorse.pipeline.outputFolder',
      data.outputFolder,
      vscode.ConfigurationTarget.Global
    );

    // Initialize pipeline state
    await this.stateManager.initPipeline(
      data.title,
      data.ricefwType,
      data.objectType,
      data.sapPackage,
      data.brText
    );

    this.tracker.refresh();
    this.panel.dispose();

    // Move to FDS generation
    vscode.window.showInformationMessage(
      `DarkHorse: Pipeline started for "${data.title}". Generating FDS...`
    );

    // Dynamically import FdsGenerator — built in Phase 3
// FdsGenerator added in Phase 3
    vscode.window.showInformationMessage(
      `DarkHorse: BR captured for "${data.title}". FDS Generator coming in Phase 3.`
    );
    this.tracker.refresh();
  }

  private getHtml(
    defaultPackage: string,
    refDocsLoaded: boolean,
    styleContext?: StyleContext
  ): string {
    const refDocsNote = refDocsLoaded
      ? `✅ Reference documents loaded (${styleContext?.documentCount} doc${styleContext?.documentCount !== 1 ? 's' : ''}): ${styleContext?.loadedFiles?.join(', ')}`
      : '⚠️ No reference documents loaded. Generation will use default style.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Pipeline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 40px;
      max-width: 750px;
      margin: 0 auto;
    }
    h2 { color: #58a6ff; font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 13px; margin-bottom: 32px; }
    .form-group { margin-bottom: 20px; }
    label {
      display: block;
      font-size: 13px;
      color: #8b949e;
      margin-bottom: 6px;
      font-weight: 500;
    }
    .required { color: #f85149; }
    input, select, textarea {
      width: 100%;
      padding: 10px 12px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      font-family: inherit;
    }
    input:focus, select:focus, textarea:focus { border-color: #58a6ff; }
    input::placeholder, textarea::placeholder { color: #484f58; }
    textarea { resize: vertical; min-height: 160px; line-height: 1.6; }
    .hint { font-size: 11px; color: #484f58; margin-top: 4px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .ref-docs-status {
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 24px;
      background: ${refDocsLoaded ? '#1a2d1a' : '#2d1f00'};
      border: 1px solid ${refDocsLoaded ? '#238636' : '#d29922'};
      color: ${refDocsLoaded ? '#3fb950' : '#e3b341'};
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .btn-link {
      background: none;
      border: 1px solid #30363d;
      color: #58a6ff;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .folder-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .folder-row input { flex: 1; }
    .btn-pick {
      padding: 10px 16px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #e6edf3;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
    }
    .btn-pick:hover { background: #30363d; }
    .divider { border: none; border-top: 1px solid #21262d; margin: 24px 0; }
    .pipeline-flow {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 28px;
      flex-wrap: wrap;
    }
    .flow-step {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 12px;
      color: #8b949e;
    }
    .flow-step.active { border-color: #58a6ff; color: #58a6ff; }
    .flow-arrow { color: #30363d; font-size: 16px; }
    .buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 32px;
    }
    button { padding: 10px 24px; border-radius: 6px; font-size: 14px;
      font-weight: 600; cursor: pointer; border: none; }
    .btn-primary { background: #238636; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
    .btn-secondary:hover { background: #30363d; }
    .error { color: #f85149; font-size: 12px; margin-top: 4px; display: none; }
    .char-count { font-size: 11px; color: #484f58; margin-top: 4px; text-align: right; }
  </style>
</head>
<body>
  <h2>🐴 New Pipeline</h2>
  <p class="subtitle">Paste your Business Requirement or User Story to begin the BR → FDS → TDS → Code pipeline</p>

  <div class="pipeline-flow">
    <div class="flow-step active">📋 BR Input</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">📄 FDS</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">⚙️ TDS</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">💻 Code</div>
  </div>

  <div class="ref-docs-status">
    <span>${refDocsNote}</span>
    ${!refDocsLoaded ? '<button class="btn-link" onclick="loadRefDocs()">Load Docs</button>' : ''}
  </div>

  <div class="form-group">
    <label>Pipeline Title <span class="required">*</span></label>
    <input type="text" id="title" placeholder="e.g. ZFIN_OPEN_ITEMS - Finance Open Items Report" />
    <div class="hint">A short name for this pipeline run. Used in document headers and Git commits.</div>
    <div class="error" id="err-title">Title is required</div>
  </div>

  <div class="row-3">
    <div class="form-group">
      <label>RICEFW Type <span class="required">*</span></label>
      <select id="ricefwType">
        <option value="Report">Report (R)</option>
        <option value="Interface">Interface (I)</option>
        <option value="Conversion">Conversion (C)</option>
        <option value="Enhancement">Enhancement (E)</option>
        <option value="Form">Form (F)</option>
        <option value="Workflow">Workflow (W)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Primary Object Type</label>
      <select id="objectType">
        <option value="PROG">Program (PROG)</option>
        <option value="CLAS">Class (CLAS)</option>
        <option value="FUGR">Function Group (FUGR)</option>
        <option value="ENHC">Enhancement (ENHC)</option>
        <option value="FORM">SmartForm (FORM)</option>
        <option value="WFLO">Workflow (WFLO)</option>
      </select>
    </div>
    <div class="form-group">
      <label>SAP Package</label>
      <input type="text" id="sapPackage" placeholder="e.g. ZFINANCE"
        value="${defaultPackage}" />
      <div class="hint">Z-package for generated objects</div>
    </div>
  </div>

  <hr class="divider" />

  <div class="form-group">
    <label>Business Requirement / User Story <span class="required">*</span></label>
    <textarea id="brText"
      placeholder="Paste your full Business Requirement or User Story here.

Example:
As a Finance user, I need a custom ABAP report (ZFIN_OPEN_ITEMS) that displays open customer line items from table KNA1 and BSID, filtered by company code and posting date range. The report should show: Customer number, Customer name, Document number, Posting date, Amount in local currency, and Due date. Output should be displayed using ALV Grid. The report needs authorization check for object F_BKPF_BUK."
      oninput="updateCharCount()"
    ></textarea>
    <div class="char-count" id="charCount">0 characters</div>
    <div class="error" id="err-br">Business Requirement is required</div>
  </div>

  <hr class="divider" />

  <div class="form-group">
    <label>Output Folder <span class="required">*</span></label>
    <div class="folder-row">
      <input type="text" id="outputFolder" placeholder="Select folder where FDS and TDS will be saved..." readonly />
      <button class="btn-pick" onclick="pickFolder()">Browse...</button>
    </div>
    <div class="hint">FDS and TDS .docx files will be saved here and committed to Git.</div>
    <div class="error" id="err-folder">Output folder is required</div>
  </div>

  <div class="buttons">
    <button class="btn-secondary" onclick="cancel()">Cancel</button>
    <button class="btn-primary" onclick="submit()">Start Pipeline →</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function updateCharCount() {
      const len = document.getElementById('brText').value.length;
      document.getElementById('charCount').textContent = len + ' characters';
    }

    function pickFolder() {
      vscode.postMessage({ command: 'pickOutputFolder' });
    }

    function loadRefDocs() {
      vscode.postMessage({ command: 'loadReferenceDocs' });
    }

    function validate() {
      let valid = true;
      const checks = [
        { id: 'title', errId: 'err-title', msg: 'Title is required' },
        { id: 'brText', errId: 'err-br', msg: 'Business Requirement is required' },
        { id: 'outputFolder', errId: 'err-folder', msg: 'Output folder is required' }
      ];
      checks.forEach(c => {
        const val = document.getElementById(c.id).value.trim();
        const err = document.getElementById(c.errId);
        if (!val) { err.style.display = 'block'; valid = false; }
        else { err.style.display = 'none'; }
      });
      return valid;
    }

    function submit() {
      if (!validate()) { return; }
      vscode.postMessage({
        command: 'submit',
        data: {
          title:       document.getElementById('title').value.trim(),
          ricefwType:  document.getElementById('ricefwType').value,
          objectType:  document.getElementById('objectType').value,
          sapPackage:  document.getElementById('sapPackage').value.trim(),
          brText:      document.getElementById('brText').value.trim(),
          outputFolder: document.getElementById('outputFolder').value.trim()
        }
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    // Handle messages from extension
    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.command === 'outputFolderSelected') {
        document.getElementById('outputFolder').value = msg.path;
        document.getElementById('err-folder').style.display = 'none';
      }
      if (msg.command === 'error') {
        const err = document.getElementById('err-' + msg.field);
        if (err) { err.textContent = msg.message; err.style.display = 'block'; }
      }
    });

    document.getElementById('title').focus();
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { submit(); }
    });
  </script>
</body>
</html>`;
  }
}