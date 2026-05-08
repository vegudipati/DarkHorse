import * as vscode from 'vscode';
import * as path from 'path';
import { FdsDocument } from './FdsGenerator';
import { PipelineStateManager } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';

export class FdsReviewPanel {

  private static currentPanel: FdsReviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private fdsDoc: FdsDocument;
  private stateManager: PipelineStateManager;
  private tracker: PipelineTracker;
  private context: vscode.ExtensionContext;
  private filePath: string;

  public static async show(
    context: vscode.ExtensionContext,
    fdsDoc: FdsDocument,
    filePath: string,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {
    if (FdsReviewPanel.currentPanel) {
      FdsReviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      FdsReviewPanel.currentPanel.update(fdsDoc, filePath);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseFdsReview',
      `FDS Review — ${fdsDoc.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    FdsReviewPanel.currentPanel = new FdsReviewPanel(
      panel, context, fdsDoc, filePath, stateManager, tracker
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    fdsDoc: FdsDocument,
    filePath: string,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ) {
    this.panel = panel;
    this.context = context;
    this.fdsDoc = fdsDoc;
    this.filePath = filePath;
    this.stateManager = stateManager;
    this.tracker = tracker;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'approve':
          await this.handleApprove();
          break;
        case 'openInWord':
          await this.openInWord();
          break;
        case 'regenerate':
          await this.handleRegenerate();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      FdsReviewPanel.currentPanel = undefined;
    });
  }

  private update(fdsDoc: FdsDocument, filePath: string): void {
    this.fdsDoc = fdsDoc;
    this.filePath = filePath;
    this.panel.webview.html = this.getHtml();
  }

 private async handleApprove(): Promise<void> {
    await this.stateManager.markFdsApproved();
    this.tracker.refresh();
    this.panel.dispose();

    // Start TDS generation immediately — don't wait for Git
    vscode.window.showInformationMessage(
      'DarkHorse: FDS approved. Generating Technical Design Specification...'
    );

    // Git commit runs in background — non-blocking
    setTimeout(async () => {
      try {
        const { PipelineGitHelper } = require('./PipelineGitHelper');
        await PipelineGitHelper.commitFds(this.stateManager);
      } catch {
        // Git commit is optional
      }
    }, 2000);

    // Move to TDS generation
    try {
      const { TdsGenerator } = require('./TdsGenerator');
      await TdsGenerator.generate(this.context, this.stateManager, this.tracker);
    } catch {
      vscode.window.showInformationMessage(
        'DarkHorse: FDS approved. TDS Generator coming in Phase 4.'
      );
    }
  }

  private async openInWord(): Promise<void> {
    try {
      const uri = vscode.Uri.file(this.filePath);
      await vscode.env.openExternal(uri);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Could not open file: ${err.message}`);
    }
  }

  private async handleRegenerate(): Promise<void> {
    this.panel.dispose();
    await this.stateManager.updateStage('br_captured');
    this.tracker.refresh();
    const { FdsGenerator } = require('./FdsGenerator');
    await FdsGenerator.generate(this.context, this.stateManager, this.tracker);
  }

  private getHtml(): string {
    const fds = this.fdsDoc;
    const frRows = fds.sections.functionalRequirements.map(fr =>
      `<tr>
        <td class="req-id">${fr.id}</td>
        <td>${fr.description}</td>
        <td class="priority priority-${fr.priority.toLowerCase()}">${fr.priority}</td>
      </tr>`
    ).join('');

    const inScopeItems = fds.sections.scope.inScope
      .map(i => `<li>${i}</li>`).join('');
    const outScopeItems = fds.sections.scope.outOfScope
      .map(i => `<li>${i}</li>`).join('');
    const businessRules = fds.sections.businessRules
      .map(r => `<li>${r}</li>`).join('');
    const errorHandling = fds.sections.errorHandling
      .map(e => `<li>${e}</li>`).join('');
    const openItems = fds.sections.openItems
      .map(o => `<li>${o}</li>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FDS Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 0;
    }
    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 20px 32px;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left h2 { color: #58a6ff; font-size: 18px; }
    .header-left p { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .header-actions { display: flex; gap: 10px; align-items: center; }
    .status-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      background: #1f3a1f;
      color: #3fb950;
      border: 1px solid #238636;
    }
    button {
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
    }
    .btn-approve { background: #238636; color: #fff; }
    .btn-approve:hover { background: #2ea043; }
    .btn-word { background: #1f6feb; color: #fff; }
    .btn-word:hover { background: #388bfd; }
    .btn-regen { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
    .btn-regen:hover { background: #30363d; }
    .content { padding: 32px; max-width: 960px; margin: 0 auto; }
    .doc-header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 32px;
      font-size: 13px;
    }
    .doc-header-table td {
      padding: 8px 12px;
      border: 1px solid #30363d;
    }
    .doc-header-table td:first-child {
      font-weight: 600;
      color: #8b949e;
      width: 180px;
      background: #161b22;
    }
    .section { margin-bottom: 32px; }
    .section h3 {
      font-size: 16px;
      color: #58a6ff;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #21262d;
    }
    .section p { font-size: 14px; line-height: 1.7; color: #c9d1d9; }
    .section ul { padding-left: 20px; }
    .section ul li { font-size: 14px; line-height: 1.8; color: #c9d1d9; }
    .scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .scope-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 16px;
    }
    .scope-box h4 { font-size: 13px; color: #8b949e; margin-bottom: 10px; }
    .req-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .req-table th {
      background: #1a1a2e;
      color: #fff;
      padding: 10px 12px;
      text-align: left;
      border: 1px solid #30363d;
    }
    .req-table td {
      padding: 10px 12px;
      border: 1px solid #30363d;
      vertical-align: top;
    }
    .req-table tr:nth-child(even) td { background: #161b22; }
    .req-id { font-family: monospace; color: #58a6ff; font-weight: 600; white-space: nowrap; }
    .priority { font-weight: 600; text-align: center; white-space: nowrap; }
    .priority-high { color: #f85149; }
    .priority-medium { color: #e3b341; }
    .priority-low { color: #3fb950; }
    .approve-bar {
      background: #1a2d1a;
      border: 1px solid #238636;
      border-radius: 8px;
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 40px;
      margin-bottom: 40px;
    }
    .approve-bar p { font-size: 14px; color: #3fb950; }
    .approve-bar small { font-size: 12px; color: #8b949e; display: block; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h2>📄 FDS Review — ${fds.title}</h2>
      <p>${fds.ricefwType} | v${fds.version} | ${fds.date}</p>
    </div>
    <div class="header-actions">
      <span class="status-badge">${fds.status}</span>
      <button class="btn-regen" onclick="regenerate()">↺ Regenerate</button>
      <button class="btn-word" onclick="openWord()">📝 Open in Word</button>
      <button class="btn-approve" onclick="approve()">✓ Approve FDS →</button>
    </div>
  </div>

  <div class="content">

    <table class="doc-header-table">
      <tr><td>Title</td><td>${fds.title}</td></tr>
      <tr><td>Author</td><td>${fds.author}</td></tr>
      <tr><td>Version</td><td>${fds.version}</td></tr>
      <tr><td>Date</td><td>${fds.date}</td></tr>
      <tr><td>RICEFW Type</td><td>${fds.ricefwType}</td></tr>
      <tr><td>BR Reference</td><td>${fds.brReference}</td></tr>
    </table>

    <div class="section">
      <h3>1. Business Background & Objectives</h3>
      <p>${fds.sections.businessBackground}</p>
    </div>

    <div class="section">
      <h3>2. Scope</h3>
      <div class="scope-grid">
        <div class="scope-box">
          <h4>✅ In Scope</h4>
          <ul>${inScopeItems}</ul>
        </div>
        <div class="scope-box">
          <h4>❌ Out of Scope</h4>
          <ul>${outScopeItems}</ul>
        </div>
      </div>
    </div>

    <div class="section">
      <h3>3. Business Process Overview</h3>
      <p>${fds.sections.processOverview}</p>
    </div>

    <div class="section">
      <h3>4. Functional Requirements</h3>
      <table class="req-table">
        <thead>
          <tr><th>ID</th><th>Description</th><th>Priority</th></tr>
        </thead>
        <tbody>${frRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>5. User Interface / Screen Design</h3>
      <p>${fds.sections.uiDesign}</p>
    </div>

    <div class="section">
      <h3>6. Input / Output Specifications</h3>
      <p>${fds.sections.inputOutputSpec}</p>
    </div>

    <div class="section">
      <h3>7. Business Rules & Validations</h3>
      <ul>${businessRules}</ul>
    </div>

    <div class="section">
      <h3>8. Error Handling & Messages</h3>
      <ul>${errorHandling}</ul>
    </div>

    <div class="section">
      <h3>9. Authorization & Security</h3>
      <p>${fds.sections.authorization}</p>
    </div>

    <div class="section">
      <h3>10. Reporting Requirements</h3>
      <p>${fds.sections.reportingRequirements}</p>
    </div>

    <div class="section">
      <h3>11. Open Items / Assumptions / Dependencies</h3>
      <ul>${openItems}</ul>
    </div>

    <div class="approve-bar">
      <div>
        <p>Ready to approve this FDS and proceed to Technical Design Specification?</p>
        <small>Approving will save the FDS to Git and begin TDS generation.</small>
      </div>
      <button class="btn-approve" onclick="approve()">✓ Approve FDS → Generate TDS</button>
    </div>

  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function approve() { vscode.postMessage({ command: 'approve' }); }
    function openWord() { vscode.postMessage({ command: 'openInWord' }); }
    function regenerate() {
      if (confirm('Regenerate the FDS? The current version will be replaced.')) {
        vscode.postMessage({ command: 'regenerate' });
      }
    }
  </script>
</body>
</html>`;
  }
}