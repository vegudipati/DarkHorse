/**
 * DarkHorse Agent Extension — Report Viewer
 *
 * Renders an agent report in a VS Code webview panel.
 * Provides Accept / Reject buttons for any suggested code patches.
 * Accepting a patch routes through ConsentGate before applying.
 */
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportViewer = void 0;
const vscode = __importStar(require("vscode"));
class ReportViewer {
    consentGate;
    panel = null;
    disposables = [];
    constructor(consentGate) {
        this.consentGate = consentGate;
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    async show(report) {
        if (this.panel) {
            this.panel.dispose();
        }
        this.panel = vscode.window.createWebviewPanel('darkhorse.reportViewer', `Agent Report — ${report.agentId}`, vscode.ViewColumn.Beside, { enableScripts: true });
        this.panel.webview.html = this.getReportHtml(report);
        this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg, report), null, this.disposables);
        this.panel.onDidDispose(() => {
            this.panel = null;
        }, null, this.disposables);
    }
    // ---------------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------------
    async handleMessage(msg, report) {
        switch (msg.type) {
            case 'applyPatch':
                if (msg.patchIndex !== undefined && report.patches) {
                    await this.applyPatch(report, report.patches[msg.patchIndex]);
                }
                break;
            case 'dismiss':
                this.panel?.dispose();
                break;
        }
    }
    async applyPatch(report, patch) {
        // Route through ConsentGate — developer must confirm
        const approved = await this.consentGate.requestConsent(report.agentId, {
            actionId: `patch_${report.agentId}_${Date.now()}`,
            description: `Apply fix: ${patch.description}`,
            objectName: patch.objectName,
            objectType: patch.objectType,
            proposedCode: patch.proposedCode
        });
        if (!approved) {
            vscode.window.showInformationMessage('DarkHorse Agent: Patch rejected — no changes made.');
            return;
        }
        // Open a diff preview showing the proposed change
        await this.showPatchDiff(patch);
    }
    async showPatchDiff(patch) {
        // Create virtual documents for the diff
        const scheme = 'darkhorse-agent-diff';
        const provider = new SingleUseContentProvider();
        const origUri = vscode.Uri.parse(`${scheme}://original/${patch.objectName}`);
        const proposedUri = vscode.Uri.parse(`${scheme}://proposed/${patch.objectName}`);
        provider.set(origUri.toString(), patch.originalCode);
        provider.set(proposedUri.toString(), patch.proposedCode);
        const reg = vscode.workspace.registerTextDocumentContentProvider(scheme, provider);
        await vscode.commands.executeCommand('vscode.diff', origUri, proposedUri, `Agent Fix — ${patch.objectName}: ${patch.description}`, { preview: true });
        const choice = await vscode.window.showInformationMessage(`Apply agent fix to ${patch.objectName}?`, { modal: false }, 'Apply', 'Discard');
        reg.dispose();
        if (choice === 'Apply') {
            vscode.window.showInformationMessage(`DarkHorse Agent: Fix applied to ${patch.objectName}. Save and sync to SAP when ready.`);
        }
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    // ---------------------------------------------------------------------------
    // Report HTML
    // ---------------------------------------------------------------------------
    getReportHtml(report) {
        const nonce = this.generateNonce();
        const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
        const sortedFindings = [...report.findings].sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));
        const findingsHtml = sortedFindings.length === 0
            ? '<p style="color:var(--vscode-descriptionForeground);font-size:12px;">No issues found — code looks clean.</p>'
            : sortedFindings.map((f, i) => this.findingHtml(f, i)).join('');
        const patchesHtml = report.patches && report.patches.length > 0
            ? report.patches.map((p, i) => this.patchHtml(p, i)).join('')
            : '';
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Agent Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color:       var(--vscode-foreground);
      background:  var(--vscode-editor-background);
      padding: 20px;
      max-width: 720px;
    }
    h1 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    h2 { font-size: 13px; font-weight: 600; margin: 20px 0 10px; }
    .summary-box {
      padding: 10px 12px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .finding {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .finding-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 5px;
    }
    .severity-badge {
      font-size: 10px;
      padding: 1px 7px;
      border-radius: 8px;
      color: #fff;
      font-weight: 700;
      text-transform: uppercase;
    }
    .finding-line { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .finding-msg  { font-size: 12px; margin-bottom: 4px; }
    .finding-sug  { font-size: 11px; color: var(--vscode-textLink-foreground); font-style: italic; }
    .patch {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .patch-desc { font-size: 12px; }
    .btn {
      font-size: 11px;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      border: none;
    }
    .btn-apply {
      background: var(--vscode-button-background);
      color:      var(--vscode-button-foreground);
    }
    .btn-apply:hover { background: var(--vscode-button-hoverBackground); }
    .btn-dismiss {
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color:  var(--vscode-foreground);
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <h1>🔍 Code Review Report</h1>
  <div class="meta">
    Agent: ${this.escHtml(report.agentId)} &nbsp;·&nbsp;
    Completed: ${new Date(report.completedAt).toLocaleString()}
  </div>

  <div class="summary-box">${this.escHtml(report.summary)}</div>

  <h2>Findings (${report.findings.length})</h2>
  ${findingsHtml}

  ${patchesHtml ? `<h2>Suggested Fixes</h2>${patchesHtml}` : ''}

  <br>
  <button class="btn btn-dismiss" onclick="dismiss()">Dismiss Report</button>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function applyPatch(index) {
      vscode.postMessage({ type: 'applyPatch', patchIndex: index });
    }
    function dismiss() {
      vscode.postMessage({ type: 'dismiss' });
    }
  </script>
</body>
</html>`;
    }
    findingHtml(f, _index) {
        const colors = {
            critical: '#f44336', high: '#ff9800',
            medium: '#ffc107', low: '#4caf50', info: '#2196f3'
        };
        const color = colors[f.severity] || '#888';
        return `<div class="finding">
  <div class="finding-header">
    <span class="severity-badge" style="background:${color}">${this.escHtml(f.severity)}</span>
    <span style="font-size:11px;color:var(--vscode-descriptionForeground)">${this.escHtml(f.category)}</span>
    ${f.line ? `<span class="finding-line">Line ${f.line}</span>` : ''}
  </div>
  <div class="finding-msg">${this.escHtml(f.message)}</div>
  ${f.suggestion ? `<div class="finding-sug">💡 ${this.escHtml(f.suggestion)}</div>` : ''}
</div>`;
    }
    patchHtml(p, index) {
        return `<div class="patch">
  <div class="patch-desc">${this.escHtml(p.description)}</div>
  <button class="btn btn-apply" onclick="applyPatch(${index})">Apply Fix</button>
</div>`;
    }
    escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    generateNonce() {
        let text = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return text;
    }
    dispose() {
        this.panel?.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}
exports.ReportViewer = ReportViewer;
// Single-use content provider for diff views
class SingleUseContentProvider {
    store = new Map();
    set(uri, content) { this.store.set(uri, content); }
    provideTextDocumentContent(uri) {
        return this.store.get(uri.toString()) || '';
    }
}
//# sourceMappingURL=ReportViewer.js.map