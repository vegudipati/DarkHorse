/**
 * DarkHorse Agent Extension — Agent Dashboard
 *
 * Webview panel showing all active and completed agents,
 * their status, progress messages, and report summaries.
 *
 * Auto-refreshes every 3 seconds while agents are running.
 * Shows "View Report" button when an agent completes.
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
exports.AgentDashboard = void 0;
const vscode = __importStar(require("vscode"));
class AgentDashboard {
    orchestrator;
    static VIEW_TYPE = 'darkhorse.agentDashboard';
    static instance;
    panel;
    disposables = [];
    refreshTimer = null;
    // ---------------------------------------------------------------------------
    // Static factory
    // ---------------------------------------------------------------------------
    static show(extensionUri, orchestrator) {
        if (AgentDashboard.instance) {
            AgentDashboard.instance.panel.reveal(vscode.ViewColumn.Two);
            return AgentDashboard.instance;
        }
        const panel = vscode.window.createWebviewPanel(AgentDashboard.VIEW_TYPE, 'DarkHorse Agents', vscode.ViewColumn.Two, { enableScripts: true, localResourceRoots: [extensionUri] });
        AgentDashboard.instance = new AgentDashboard(panel, orchestrator);
        return AgentDashboard.instance;
    }
    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------
    constructor(panel, orchestrator) {
        this.orchestrator = orchestrator;
        this.panel = panel;
        // Listen for agent events and push updates to the webview
        orchestrator.on('agentStatusChanged', () => this.pushUpdate());
        orchestrator.on('agentProgress', () => this.pushUpdate());
        orchestrator.on('agentReport', () => this.pushUpdate());
        // Handle messages from webview
        panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
        panel.onDidDispose(() => this.dispose(), null, this.disposables);
        // Initial render
        panel.webview.html = this.getHtml();
        this.pushUpdate();
        // Auto-refresh while panel is visible
        this.refreshTimer = setInterval(() => {
            if (this.hasRunningAgents()) {
                this.pushUpdate();
            }
        }, 3000);
    }
    // ---------------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------------
    handleMessage(msg) {
        switch (msg.type) {
            case 'terminate':
                if (msg.agentId) {
                    this.orchestrator.terminate(msg.agentId);
                }
                break;
            case 'clearCompleted':
                this.orchestrator.clearCompleted();
                this.pushUpdate();
                break;
            case 'viewLog':
                if (msg.agentId) {
                    this.openAgentLog(msg.agentId);
                }
                break;
        }
    }
    async openAgentLog(agentId) {
        const logPath = this.orchestrator.getAgentLogPath(agentId);
        try {
            const doc = await vscode.workspace.openTextDocument(logPath);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        }
        catch {
            vscode.window.showWarningMessage('No log file found for this agent.');
        }
    }
    // ---------------------------------------------------------------------------
    // Push data to webview
    // ---------------------------------------------------------------------------
    pushUpdate() {
        const agents = this.orchestrator.getAllAgents();
        this.panel.webview.postMessage({ type: 'update', agents });
    }
    hasRunningAgents() {
        return this.orchestrator.getAllAgents().some(a => a.status === 'running');
    }
    // ---------------------------------------------------------------------------
    // HTML shell — data is pushed via postMessage, not baked into HTML
    // ---------------------------------------------------------------------------
    getHtml() {
        const nonce = this.generateNonce();
        const statusColors = {
            created: '#888',
            running: '#4ec9b0',
            completed: '#4caf50',
            failed: '#f44336',
            timed_out: '#ff9800',
            cancelled: '#888'
        };
        const statusColorsJson = JSON.stringify(statusColors);
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>DarkHorse Agents</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color:       var(--vscode-foreground);
      background:  var(--vscode-editor-background);
      padding: 16px;
    }
    #header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    h1 { font-size: 14px; font-weight: 600; }
    .btn-small {
      font-size: 11px;
      padding: 3px 10px;
      border: 1px solid var(--vscode-panel-border);
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 3px;
      cursor: pointer;
    }
    .btn-small:hover { background: var(--vscode-list-hoverBackground); }

    #empty {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      margin-top: 48px;
      font-size: 12px;
    }
    #empty .hint { margin-top: 8px; font-size: 11px; opacity: 0.7; }

    .agent-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .agent-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6px;
    }
    .agent-name  { font-size: 12px; font-weight: 600; }
    .agent-type  { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .status-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
    }
    .agent-task {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .agent-progress {
      font-size: 11px;
      font-style: italic;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    .agent-summary {
      font-size: 11px;
      padding: 6px 8px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 3px;
      margin-bottom: 8px;
    }
    .findings-count {
      font-size: 11px;
      margin-bottom: 8px;
    }
    .severity-pill {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      margin-right: 4px;
      color: #fff;
      font-weight: 600;
    }
    .agent-actions { display: flex; gap: 6px; margin-top: 8px; }
    .spinner {
      display: inline-block;
      width: 10px; height: 10px;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: #4ec9b0;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 6px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="header">
    <h1>⚡ DarkHorse Agents</h1>
    <button class="btn-small" id="clearBtn">Clear Completed</button>
  </div>
  <div id="agentList">
    <div id="empty">
      <div>No agents running.</div>
      <div class="hint">Use "DarkHorse: New Agent" to launch one.</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode        = acquireVsCodeApi();
    const statusColors  = ${statusColorsJson};
    const severityColors = {
      critical: '#f44336', high: '#ff9800',
      medium: '#ffeb3b', low: '#4caf50', info: '#2196f3'
    };

    document.getElementById('clearBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearCompleted' });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') { renderAgents(msg.agents); }
    });

    function renderAgents(agents) {
      const list = document.getElementById('agentList');
      if (!agents || agents.length === 0) {
        list.innerHTML = '<div id="empty"><div>No agents running.</div><div class="hint">Use "DarkHorse: New Agent" to launch one.</div></div>';
        return;
      }

      list.innerHTML = agents.map(agent => {
        const color = statusColors[agent.status] || '#888';
        const isRunning   = agent.status === 'running';
        const isCompleted = agent.status === 'completed';
        const isFailed    = agent.status === 'failed' || agent.status === 'timed_out';

        let progressHtml = '';
        if (isRunning) {
          progressHtml = '<div class="agent-progress"><span class="spinner"></span>Working…</div>';
        }

        let reportHtml = '';
        if (isCompleted && agent.report) {
          const r = agent.report;
          const findingCounts = r.findings.reduce((acc, f) => {
            acc[f.severity] = (acc[f.severity] || 0) + 1;
            return acc;
          }, {});

          const pills = Object.entries(findingCounts)
            .map(([sev, count]) =>
              '<span class="severity-pill" style="background:' + (severityColors[sev] || '#888') + '">' +
              count + ' ' + sev + '</span>'
            ).join('');

          reportHtml =
            '<div class="agent-summary">' + escHtml(r.summary) + '</div>' +
            (pills ? '<div class="findings-count">' + pills + '</div>' : '');
        }

        let errorHtml = '';
        if (isFailed && agent.errorMessage) {
          errorHtml = '<div class="agent-summary" style="color:var(--vscode-inputValidation-errorForeground)">' +
            escHtml(agent.errorMessage) + '</div>';
        }

        const actions = [];
        if (isRunning) {
          actions.push('<button class="btn-small" onclick="terminate(\'' + agent.config.agentId + '\')">Cancel</button>');
        }
        if (isCompleted && agent.report) {
          actions.push('<button class="btn-small" onclick="viewReport(\'' + agent.config.agentId + '\')">View Report</button>');
        }
        actions.push('<button class="btn-small" onclick="viewLog(\'' + agent.config.agentId + '\')">View Log</button>');

        return '<div class="agent-card">' +
          '<div class="agent-header">' +
            '<div>' +
              '<div class="agent-name">' + escHtml(agent.config.scope.objectName || agent.config.agentType) + '</div>' +
              '<div class="agent-type">' + escHtml(agent.config.agentType.replace(/_/g, ' ')) + '</div>' +
            '</div>' +
            '<span class="status-badge" style="background:' + color + '">' + agent.status + '</span>' +
          '</div>' +
          '<div class="agent-task">' + escHtml(agent.config.taskDescription) + '</div>' +
          progressHtml + reportHtml + errorHtml +
          '<div class="agent-actions">' + actions.join('') + '</div>' +
        '</div>';
      }).join('');
    }

    function terminate(agentId) {
      vscode.postMessage({ type: 'terminate', agentId });
    }
    function viewLog(agentId) {
      vscode.postMessage({ type: 'viewLog', agentId });
    }
    function viewReport(agentId) {
      vscode.postMessage({ type: 'viewReport', agentId });
    }
    function escHtml(s) {
      return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  </script>
</body>
</html>`;
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
        AgentDashboard.instance = undefined;
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        this.panel.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}
exports.AgentDashboard = AgentDashboard;
//# sourceMappingURL=AgentDashboard.js.map