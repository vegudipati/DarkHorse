import * as vscode from 'vscode';
import { TdsDocument } from './DocxWriter';
import { PipelineStateManager } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';

export class TdsReviewPanel {

  private static currentPanel: TdsReviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private tdsDoc: TdsDocument;
  private stateManager: PipelineStateManager;
  private tracker: PipelineTracker;
  private context: vscode.ExtensionContext;
  private filePath: string;

  public static async show(
    context: vscode.ExtensionContext,
    tdsDoc: TdsDocument,
    filePath: string,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {
    if (TdsReviewPanel.currentPanel) {
      TdsReviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      TdsReviewPanel.currentPanel.update(tdsDoc, filePath);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseTdsReview',
      `TDS Review — ${tdsDoc.title}`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    TdsReviewPanel.currentPanel = new TdsReviewPanel(
      panel, context, tdsDoc, filePath, stateManager, tracker
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    tdsDoc: TdsDocument,
    filePath: string,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ) {
    this.panel = panel;
    this.context = context;
    this.tdsDoc = tdsDoc;
    this.filePath = filePath;
    this.stateManager = stateManager;
    this.tracker = tracker;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'approve':
          await this.handleApprove(message.objects);
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
      TdsReviewPanel.currentPanel = undefined;
    });
  }

  private update(tdsDoc: TdsDocument, filePath: string): void {
    this.tdsDoc = tdsDoc;
    this.filePath = filePath;
    this.panel.webview.html = this.getHtml();
  }

  private async handleApprove(updatedObjects?: any[]): Promise<void> {
    // Update object list if developer modified it
    if (updatedObjects && updatedObjects.length > 0) {
      const state = this.stateManager.getState();
      if (state) {
        state.abapObjects = updatedObjects.map((obj: any, idx: number) => ({
          sequence: idx + 1,
          objectType: obj.objectType,
          objectName: obj.objectName,
          description: obj.description,
          keyLogic: this.tdsDoc.sections.abapObjectList[idx]?.keyLogic ?? [],
          dependencies: this.tdsDoc.sections.abapObjectList[idx]?.dependencies ?? [],
          codeGenerated: false,
          codeAccepted: false
        }));
        await this.stateManager.setState(state);
      }
    }

    await this.stateManager.markTdsApproved();
    this.tracker.refresh();
    this.panel.dispose();

    vscode.window.showInformationMessage(
      'DarkHorse: TDS approved. Starting code generation...'
    );

    // Git commit runs in background — non-blocking
    setTimeout(async () => {
      try {
        const { PipelineGitHelper } = require('./PipelineGitHelper');
        await PipelineGitHelper.commitTds(this.stateManager);
      } catch {
        // Git commit is optional
      }
    }, 2000);

    try {
      const { ObjectCodeGenerator } = require('./ObjectCodeGenerator');
      await ObjectCodeGenerator.generate(this.context, this.stateManager, this.tracker);
    } catch {
      vscode.window.showInformationMessage(
        'DarkHorse: TDS approved. Code Generator coming in Phase 5.'
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
    await this.stateManager.updateStage('fds_approved');
    this.tracker.refresh();
    const { TdsGenerator } = require('./TdsGenerator');
    await TdsGenerator.generate(this.context, this.stateManager, this.tracker);
  }

  private getHtml(): string {
    const tds = this.tdsDoc;

    const objectRows = tds.sections.abapObjectList.map((obj, idx) =>
      `<tr>
        <td class="seq">${obj.sequence}</td>
        <td><span class="obj-type">${obj.objectType}</span></td>
        <td class="obj-name" contenteditable="true" data-idx="${idx}" data-field="objectName">${obj.objectName}</td>
        <td contenteditable="true" data-idx="${idx}" data-field="description">${obj.description}</td>
        <td class="logic-cell"><ul>${obj.keyLogic.map(l => `<li>${l}</li>`).join('')}</ul></td>
      </tr>`
    ).join('');

    const testRows = tds.sections.testScenarios.map(t =>
      `<tr>
        <td class="req-id">${t.id}</td>
        <td>${t.description}</td>
        <td>${t.expected}</td>
      </tr>`
    ).join('');

    const designDecisions = tds.sections.designDecisions
      .map(d => `<li>${d}</li>`).join('');
    const openItems = tds.sections.openItems
      .map(o => `<li>${o}</li>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TDS Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
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
    .content { padding: 32px; max-width: 1100px; margin: 0 auto; }
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
    .object-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .object-table th {
      background: #1a1a2e;
      color: #fff;
      padding: 10px 12px;
      text-align: left;
      border: 1px solid #30363d;
    }
    .object-table td {
      padding: 10px 12px;
      border: 1px solid #30363d;
      vertical-align: top;
    }
    .object-table tr:nth-child(even) td { background: #0d1117; }
    .object-table td[contenteditable="true"] {
      background: #1c2128;
      cursor: text;
    }
    .object-table td[contenteditable="true"]:focus {
      outline: 1px solid #58a6ff;
    }
    .seq { text-align: center; font-weight: 600; color: #58a6ff; width: 40px; }
    .obj-type {
      background: #1f3a5f;
      color: #79c0ff;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: nowrap;
    }
    .obj-name { font-family: monospace; color: #3fb950; font-weight: 600; }
    .logic-cell ul { padding-left: 16px; }
    .logic-cell li { font-size: 12px; color: #8b949e; line-height: 1.6; }
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
    .req-id { font-family: monospace; color: #58a6ff; font-weight: 600; }
    .edit-note {
      font-size: 11px;
      color: #8b949e;
      margin-top: 8px;
      font-style: italic;
    }
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
      <h2>⚙️ TDS Review — ${tds.title}</h2>
      <p>FDS Reference: ${tds.fdsReference} | v${tds.version} | ${tds.date}</p>
    </div>
    <div class="header-actions">
      <span class="status-badge">${tds.status}</span>
      <button class="btn-regen" onclick="regenerate()">↺ Regenerate</button>
      <button class="btn-word" onclick="openWord()">📝 Open in Word</button>
      <button class="btn-approve" onclick="approve()">✓ Approve TDS →</button>
    </div>
  </div>

  <div class="content">
    <table class="doc-header-table">
      <tr><td>Title</td><td>${tds.title}</td></tr>
      <tr><td>Author</td><td>${tds.author}</td></tr>
      <tr><td>Version</td><td>${tds.version}</td></tr>
      <tr><td>Date</td><td>${tds.date}</td></tr>
      <tr><td>FDS Reference</td><td>${tds.fdsReference}</td></tr>
    </table>

  ${tds.solutionOverview ? `
    <div class="section">
      <h3>0. Solution Overview Alignment</h3>
      <div style="background:#1a2d1a;border:1px solid #238636;border-radius:6px;padding:16px;margin-bottom:16px">
        <p style="font-size:13px;color:#3fb950;font-weight:600">
          ✅ Overall Clean Core Level: ${tds.solutionOverview.overallCleanCoreLevel}
        </p>
        <p style="font-size:13px;color:#c9d1d9;margin-top:8px">${tds.solutionOverview.summary}</p>
      </div>
      ${tds.solutionOverview.cleanCoreAlignment.length > 0 ? `
      <table class="req-table">
        <thead><tr><th>Component</th><th>Approach</th><th>Level</th><th>Reasoning</th></tr></thead>
        <tbody>
          ${tds.solutionOverview.cleanCoreAlignment.map((c: any) => `
          <tr>
            <td style="font-weight:600;color:#58a6ff">${c.component}</td>
            <td>${c.approach}</td>
            <td style="text-align:center;font-weight:700">${c.level}</td>
            <td style="color:#8b949e;font-size:12px">${c.reasoning}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${tds.solutionOverview.deviations.length > 0 ? `
      <div style="margin-top:12px;background:#3a2a00;border:1px solid #e3b341;border-radius:6px;padding:12px">
        <p style="color:#e3b341;font-weight:600;margin-bottom:8px">⚠️ Deviations</p>
        ${tds.solutionOverview.deviations.map((d: any) =>
          `<p style="font-size:13px;color:#c9d1d9">• ${d.component} [Level ${d.level}]: ${d.risk}</p>`
        ).join('')}
      </div>` : ''}
    </div>` : ''}    


    <div class="section">
      <h3>1. Technical Approach & Design Decisions</h3>
      <p>${tds.sections.technicalApproach}</p>
      <br/>
      <ul>${designDecisions}</ul>
    </div>

    <div class="section">
      <h3>2. ABAP Object List</h3>
      <p class="edit-note">✏️ Object names and descriptions are editable — click to modify before approving.</p>
      <br/>
      <table class="object-table" id="objectTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Object Name</th>
            <th>Description</th>
            <th>Key Logic</th>
          </tr>
        </thead>
        <tbody>${objectRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>3. Data Dictionary Objects</h3>
      <p>${tds.sections.dataDictionary}</p>
    </div>

    <div class="section">
      <h3>4. Program Logic</h3>
      <p>${tds.sections.programLogic}</p>
    </div>

    <div class="section">
      <h3>5. Interface / Integration Design</h3>
      <p>${tds.sections.interfaceDesign}</p>
    </div>

    <div class="section">
      <h3>6. Database Design & Performance</h3>
      <p>${tds.sections.dbDesign}</p>
    </div>

    <div class="section">
      <h3>7. Error Handling & Logging</h3>
      <p>${tds.sections.errorHandling}</p>
    </div>

    <div class="section">
      <h3>8. Transport Strategy</h3>
      <p>${tds.sections.transportStrategy}</p>
    </div>

    <div class="section">
      <h3>9. Unit Test Scenarios</h3>
      <table class="req-table">
        <thead>
          <tr><th>ID</th><th>Description</th><th>Expected Result</th></tr>
        </thead>
        <tbody>${testRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>10. Open Items / Assumptions / Dependencies</h3>
      <ul>${openItems}</ul>
    </div>

    <div class="approve-bar">
      <div>
        <p>Ready to approve this TDS and begin object-by-object code generation?</p>
        <small>
          ${tds.sections.abapObjectList.length} ABAP object(s) will be generated one at a time.
          Each object requires your approval before the next begins.
        </small>
      </div>
      <button class="btn-approve" onclick="approve()">
        ✓ Approve TDS → Generate Code (${tds.sections.abapObjectList.length} objects)
      </button>
    </div>

  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function getObjectList() {
      const rows = document.querySelectorAll('#objectTable tbody tr');
      return Array.from(rows).map((row, idx) => ({
        objectType: row.querySelector('.obj-type')?.textContent ?? '',
        objectName: row.querySelector('[data-field="objectName"]')?.textContent?.trim() ?? '',
        description: row.querySelector('[data-field="description"]')?.textContent?.trim() ?? ''
      }));
    }

    function approve() {
      const objects = getObjectList();
      vscode.postMessage({ command: 'approve', objects });
    }

    function openWord() {
      vscode.postMessage({ command: 'openInWord' });
    }

    function regenerate() {
      if (confirm('Regenerate the TDS? The current version will be replaced.')) {
        vscode.postMessage({ command: 'regenerate' });
      }
    }
  </script>
</body>
</html>`;
  }
}