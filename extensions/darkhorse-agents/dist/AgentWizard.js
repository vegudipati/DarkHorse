/**
 * DarkHorse Agent Extension — Agent Wizard
 *
 * Webview-based questionnaire that collects agent configuration
 * from the developer before spawning an agent.
 *
 * Steps:
 *   1. Select agent type
 *   2. Describe the task
 *   3. Set scope (object name, package, or current file)
 *   4. Set permissions (read-only is default — write requires explicit opt-in)
 *   5. Set timeout
 *   6. Review and launch
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
exports.AgentWizard = void 0;
const vscode = __importStar(require("vscode"));
const AgentOrchestrator_1 = require("./AgentOrchestrator");
// Available agent types for MVP-7
const AGENT_TYPES = [
    {
        id: 'code_review',
        label: 'Code Review',
        description: 'Reviews ABAP code for correctness, performance, security, and standards',
        icon: '🔍',
        defaultTimeout: 60_000
    },
    {
        id: 'documentation',
        label: 'Documentation Generator',
        description: 'Generates inline comments and method documentation for ABAP code',
        icon: '📝',
        defaultTimeout: 90_000
    },
    {
        id: 'impact_analysis',
        label: 'Impact Analysis',
        description: 'Analyses where an ABAP object is used across the codebase',
        icon: '🔗',
        defaultTimeout: 120_000
    }
];
class AgentWizard {
    panel;
    proxyUrl;
    resolve;
    static VIEW_TYPE = 'darkhorse.agentWizard';
    // ---------------------------------------------------------------------------
    // Static factory
    // ---------------------------------------------------------------------------
    static async show(extensionUri, proxyUrl) {
        return new Promise((resolve) => {
            const panel = vscode.window.createWebviewPanel(AgentWizard.VIEW_TYPE, 'New DarkHorse Agent', vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            });
            const wizard = new AgentWizard(panel, proxyUrl, resolve);
            panel.webview.html = wizard.getHtml();
            panel.onDidDispose(() => {
                resolve({ config: {}, cancelled: true });
            });
        });
    }
    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------
    constructor(panel, proxyUrl, resolve) {
        this.panel = panel;
        this.proxyUrl = proxyUrl;
        this.resolve = resolve;
        this.panel.webview.onDidReceiveMessage((msg) => {
            this.handleMessage(msg);
        });
    }
    // ---------------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------------
    handleMessage(msg) {
        switch (msg.type) {
            case 'launch':
                this.handleLaunch(msg.formData);
                break;
            case 'cancel':
                this.panel.dispose();
                this.resolve({ config: {}, cancelled: true });
                break;
            case 'getActiveFile':
                this.sendActiveFileContext();
                break;
        }
    }
    handleLaunch(formData) {
        const permissions = ['read_sap', 'call_llm', 'read_files'];
        if (formData.allowWrite) {
            permissions.push('write_sap');
        }
        const config = {
            agentId: AgentOrchestrator_1.AgentOrchestrator.generateId(formData.agentType),
            agentType: formData.agentType,
            taskDescription: formData.taskDescription,
            scope: {
                objectName: formData.objectName || undefined,
                packageName: formData.packageName || undefined,
                objectType: formData.objectType || undefined
            },
            permissions,
            timeoutMs: formData.timeoutSeconds * 1000,
            proxyUrl: this.proxyUrl,
            sapContext: formData.objectSource
                ? { systemUrl: 'SAP_SYSTEM', objectSource: formData.objectSource }
                : undefined
        };
        this.panel.dispose();
        this.resolve({ config, cancelled: false });
    }
    sendActiveFileContext() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'abap') {
            this.panel.webview.postMessage({ type: 'activeFileContext', hasFile: false });
            return;
        }
        const uri = editor.document.uri;
        const parts = uri.path.split('/').filter(Boolean);
        let objectName = '', objectType = '';
        if (uri.scheme === 'abap' && parts.length >= 3) {
            const typeMap = {
                'programs': 'PROG', 'classes': 'CLAS', 'interfaces': 'INTF'
            };
            objectType = typeMap[parts[0]] || 'PROG';
            objectName = parts[2];
        }
        this.panel.webview.postMessage({
            type: 'activeFileContext',
            hasFile: true,
            objectName,
            objectType,
            objectSource: editor.document.getText().slice(0, 8000) // Cap at 8k chars
        });
    }
    // ---------------------------------------------------------------------------
    // Wizard HTML
    // ---------------------------------------------------------------------------
    getHtml() {
        const nonce = this.generateNonce();
        const agentTypesJson = JSON.stringify(AGENT_TYPES);
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>New Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color:       var(--vscode-foreground);
      background:  var(--vscode-editor-background);
      padding: 24px;
      max-width: 620px;
    }
    h1 { font-size: 16px; font-weight: 600; margin-bottom: 20px; }
    h2 { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: var(--vscode-foreground); }

    .section {
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .section:last-of-type { border-bottom: none; }

    label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
      margin-top: 10px;
    }
    label:first-child { margin-top: 0; }

    input[type="text"], textarea, select {
      width: 100%;
      background: var(--vscode-input-background);
      color:      var(--vscode-input-foreground);
      border:     1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 6px 8px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      outline: none;
    }
    input[type="text"]:focus, textarea:focus, select:focus {
      border-color: var(--vscode-focusBorder);
    }
    textarea { resize: vertical; min-height: 60px; }

    /* Agent type cards */
    .agent-types { display: flex; flex-direction: column; gap: 8px; }
    .agent-card {
      padding: 10px 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .agent-card:hover { border-color: var(--vscode-focusBorder); }
    .agent-card.selected {
      border-color: var(--vscode-activityBarBadge-background);
      background:   var(--vscode-editor-selectionBackground);
    }
    .agent-card input[type="radio"] { margin-top: 2px; flex-shrink: 0; }
    .agent-card-text .name  { font-size: 12px; font-weight: 600; }
    .agent-card-text .desc  { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .agent-icon { font-size: 18px; line-height: 1; }

    /* Scope */
    .scope-row { display: flex; gap: 10px; }
    .scope-row > div { flex: 1; }

    /* Permissions */
    .permission-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 12px;
    }
    .permission-row input { width: auto; }
    .permission-row .warn {
      font-size: 10px;
      color: var(--vscode-inputValidation-warningForeground);
    }

    /* Timeout slider */
    .timeout-row { display: flex; align-items: center; gap: 12px; }
    input[type="range"] { flex: 1; }
    .timeout-label { font-size: 12px; min-width: 60px; text-align: right; }

    /* Actions */
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }
    button {
      padding: 6px 16px;
      border-radius: 3px;
      font-size: 12px;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color:      var(--vscode-button-foreground);
    }
    .btn-primary:hover  { background: var(--vscode-button-hoverBackground); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color:      var(--vscode-button-secondaryForeground);
    }

    .use-active-file {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: underline;
      margin-top: 4px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <h1>⚡ New DarkHorse Agent</h1>

  <!-- Step 1: Agent Type -->
  <div class="section">
    <h2>1. Select Agent Type</h2>
    <div class="agent-types" id="agentTypes"></div>
  </div>

  <!-- Step 2: Task -->
  <div class="section">
    <h2>2. Describe the Task</h2>
    <label>What should the agent do?</label>
    <textarea id="taskDescription" placeholder="e.g. Review ZMYREPORT for performance issues and missing exception handling" rows="3"></textarea>
  </div>

  <!-- Step 3: Scope -->
  <div class="section">
    <h2>3. Set Scope</h2>
    <span class="use-active-file" id="useActiveFile">Use active ABAP file</span>
    <div class="scope-row" style="margin-top: 8px;">
      <div>
        <label>Object Name</label>
        <input type="text" id="objectName" placeholder="ZMYREPORT">
      </div>
      <div>
        <label>Object Type</label>
        <select id="objectType">
          <option value="">— Select —</option>
          <option value="PROG">PROG — Program/Report</option>
          <option value="CLAS">CLAS — Class</option>
          <option value="INTF">INTF — Interface</option>
          <option value="FUGR">FUGR — Function Group</option>
          <option value="INCL">INCL — Include</option>
        </select>
      </div>
    </div>
    <label>Package (optional)</label>
    <input type="text" id="packageName" placeholder="ZMYPACKAGE">
  </div>

  <!-- Step 4: Permissions -->
  <div class="section">
    <h2>4. Permissions</h2>
    <div class="permission-row">
      <input type="checkbox" id="permRead" checked disabled>
      <label style="margin: 0;">Read SAP objects (always enabled)</label>
    </div>
    <div class="permission-row">
      <input type="checkbox" id="permCallLlm" checked disabled>
      <label style="margin: 0;">Call AI (always enabled)</label>
    </div>
    <div class="permission-row">
      <input type="checkbox" id="permWrite" id="permWrite">
      <label style="margin: 0;">Write SAP objects</label>
      <span class="warn">⚠ Requires consent per action</span>
    </div>
  </div>

  <!-- Step 5: Timeout -->
  <div class="section">
    <h2>5. Timeout</h2>
    <div class="timeout-row">
      <input type="range" id="timeoutSlider" min="30" max="300" step="30" value="60">
      <span class="timeout-label" id="timeoutLabel">60 seconds</span>
    </div>
  </div>

  <!-- Actions -->
  <div class="actions">
    <button class="btn-secondary" id="cancelBtn">Cancel</button>
    <button class="btn-primary"   id="launchBtn" disabled>Launch Agent</button>
  </div>

  <script nonce="${nonce}">
    const vscode      = acquireVsCodeApi();
    const agentTypes  = ${agentTypesJson};

    let selectedType  = null;
    let activeFileCtx = null;

    // ---- Render agent type cards ----
    const container = document.getElementById('agentTypes');
    agentTypes.forEach(type => {
      const card = document.createElement('label');
      card.className = 'agent-card';
      card.innerHTML =
        '<input type="radio" name="agentType" value="' + type.id + '">' +
        '<span class="agent-icon">' + type.icon + '</span>' +
        '<div class="agent-card-text">' +
          '<div class="name">' + type.label + '</div>' +
          '<div class="desc">' + type.description + '</div>' +
        '</div>';
      card.querySelector('input').addEventListener('change', () => {
        document.querySelectorAll('.agent-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedType = type;
        document.getElementById('timeoutSlider').value = type.defaultTimeout / 1000;
        updateTimeoutLabel();
        validateForm();
      });
      container.appendChild(card);
    });

    // ---- Timeout slider ----
    const slider = document.getElementById('timeoutSlider');
    slider.addEventListener('input', updateTimeoutLabel);
    function updateTimeoutLabel() {
      const val = parseInt(slider.value);
      document.getElementById('timeoutLabel').textContent =
        val >= 60 ? (val / 60).toFixed(0) + ' minute' + (val >= 120 ? 's' : '') : val + ' seconds';
    }

    // ---- Use active file ----
    document.getElementById('useActiveFile').addEventListener('click', () => {
      vscode.postMessage({ type: 'getActiveFile' });
    });

    // ---- Validation ----
    ['taskDescription', 'objectName'].forEach(id => {
      document.getElementById(id).addEventListener('input', validateForm);
    });
    document.getElementById('objectType').addEventListener('change', validateForm);

    function validateForm() {
      const hasType = !!selectedType;
      const hasTask = document.getElementById('taskDescription').value.trim().length > 0;
      document.getElementById('launchBtn').disabled = !(hasType && hasTask);
    }

    // ---- Launch ----
    document.getElementById('launchBtn').addEventListener('click', () => {
      vscode.postMessage({
        type: 'launch',
        formData: {
          agentType:       selectedType.id,
          taskDescription: document.getElementById('taskDescription').value.trim(),
          objectName:      document.getElementById('objectName').value.trim(),
          objectType:      document.getElementById('objectType').value,
          packageName:     document.getElementById('packageName').value.trim(),
          allowWrite:      document.getElementById('permWrite').checked,
          timeoutSeconds:  parseInt(document.getElementById('timeoutSlider').value),
          objectSource:    activeFileCtx ? activeFileCtx.objectSource : undefined
        }
      });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    // ---- Messages from extension ----
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'activeFileContext' && msg.hasFile) {
        activeFileCtx = msg;
        document.getElementById('objectName').value = msg.objectName || '';
        document.getElementById('objectType').value = msg.objectType || '';
        validateForm();
      }
    });
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
}
exports.AgentWizard = AgentWizard;
//# sourceMappingURL=AgentWizard.js.map