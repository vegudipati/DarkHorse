/**
 * DarkHorse AI Extension — AI Panel
 *
 * VS Code Webview panel providing a chat-style interface for ABAP code generation.
 *
 * Flow:
 *   1. Developer opens panel via command palette or sidebar button
 *   2. ContextCollector gathers active file info (object type, name, selection)
 *   3. Developer types a prompt and submits
 *   4. AiPanel POSTs to the local proxy /generate endpoint
 *   5. Response is passed to DiffPreview for developer review
 *   6. Developer accepts or rejects — code is never auto-inserted
 *
 * Security:
 *   - All LLM calls go through ProxyManager.getProxyUrl() — never direct
 *   - No API key in this file — proxy handles authentication
 *   - Webview has no internet access (localResourceRoots restricted)
 *   - Content Security Policy set on every webview render
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
exports.AiPanel = void 0;
const vscode = __importStar(require("vscode"));
const ContextCollector_1 = require("./ContextCollector");
const DiffPreview_1 = require("./DiffPreview");
class AiPanel {
    static VIEW_TYPE = 'darkhorse.aiPanel';
    static instance;
    panel;
    disposables = [];
    proxyManager;
    contextCollector;
    diffPreview;
    currentSessionId;
    // ---------------------------------------------------------------------------
    // Static factory — enforce single panel instance
    // ---------------------------------------------------------------------------
    static show(extensionUri, proxyManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;
        // Reveal existing panel if already open
        if (AiPanel.instance) {
            AiPanel.instance.panel.reveal(column);
            return AiPanel.instance;
        }
        const panel = vscode.window.createWebviewPanel(AiPanel.VIEW_TYPE, 'DarkHorse AI', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            // Restrict webview to only load resources from the extension directory
            localResourceRoots: [extensionUri]
        });
        AiPanel.instance = new AiPanel(panel, proxyManager);
        return AiPanel.instance;
    }
    // ---------------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------------
    constructor(panel, proxyManager) {
        this.panel = panel;
        this.proxyManager = proxyManager;
        this.contextCollector = new ContextCollector_1.ContextCollector();
        this.diffPreview = new DiffPreview_1.DiffPreview();
        this.panel.webview.html = this.getWebviewHtml();
        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message), null, this.disposables);
        // When the active editor changes, push updated context to the webview
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.pushContextToWebview()));
        // Clean up when panel is closed
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }
    // ---------------------------------------------------------------------------
    // Message handling
    // ---------------------------------------------------------------------------
    async handleWebviewMessage(message) {
        switch (message.type) {
            case 'ready':
                // Webview finished loading — send current context
                await this.pushContextToWebview();
                break;
            case 'generate':
                if (message.prompt) {
                    await this.handleGenerate(message.prompt, message.sessionId);
                }
                break;
            case 'cancel':
                // Future: abort in-flight request. No-op in MVP-5.
                break;
        }
    }
    async handleGenerate(prompt, sessionId) {
        this.currentSessionId = sessionId || this.generateSessionId();
        // Tell the webview to show the loading state
        this.postMessage({ type: 'loading' });
        // Collect context from the active editor
        const context = this.contextCollector.collect();
        // Call the proxy
        let result;
        try {
            const proxyUrl = this.proxyManager.getProxyUrl();
            const response = await fetch(`${proxyUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    context: context.sourceCode,
                    objectType: context.objectType,
                    objectName: context.objectName,
                    sessionId: this.currentSessionId
                })
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || `Proxy returned HTTP ${response.status}`);
            }
            result = await response.json();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ type: 'error', errorMessage: message });
            return;
        }
        // Send the result back to the webview for display
        this.postMessage({
            type: 'response',
            code: result.code,
            explanation: result.explanation,
            model: result.model,
            tokensUsed: result.tokensUsed
        });
        // Open the diff preview — developer must explicitly accept before code is inserted
        if (result.code && result.code.trim().length > 0) {
            await this.diffPreview.show(result.code, context);
        }
    }
    async pushContextToWebview() {
        const context = this.contextCollector.collect();
        this.postMessage({
            type: 'context',
            context: {
                objectName: context.objectName,
                objectType: context.objectType,
                hasSelection: !!context.selectedText
            }
        });
    }
    postMessage(message) {
        this.panel.webview.postMessage(message);
    }
    // ---------------------------------------------------------------------------
    // Webview HTML
    // ---------------------------------------------------------------------------
    getWebviewHtml() {
        // Nonce for Content Security Policy — new nonce on every render
        const nonce = this.generateNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}';
             style-src 'unsafe-inline';
             connect-src http://127.0.0.1:47291;">
  <title>DarkHorse AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size:   var(--vscode-font-size);
      color:       var(--vscode-foreground);
      background:  var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ---- Header ---- */
    #header {
      padding: 10px 14px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    #header h2 {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-foreground);
      letter-spacing: 0.04em;
    }
    #context-bar {
      margin-top: 5px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      min-height: 16px;
    }
    #context-bar .badge {
      display: inline-block;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 3px;
      padding: 1px 5px;
      margin-right: 4px;
      font-size: 10px;
    }

    /* ---- Messages area ---- */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .message {
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.5;
      max-width: 100%;
      word-break: break-word;
    }
    .message.user {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      align-self: flex-end;
      max-width: 90%;
    }
    .message.assistant {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 2px solid var(--vscode-activityBarBadge-background);
    }
    .message.error {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .message.info {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      font-size: 11px;
    }

    .message .meta {
      margin-top: 5px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }

    /* ---- Loading spinner ---- */
    #loading {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    #loading.visible { display: flex; }
    .spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-activityBarBadge-background);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---- Input area ---- */
    #input-area {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 10px 14px;
      flex-shrink: 0;
    }
    #prompt-input {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 7px 9px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      resize: vertical;
      min-height: 56px;
      max-height: 160px;
      outline: none;
    }
    #prompt-input:focus {
      border-color: var(--vscode-focusBorder);
    }
    #prompt-input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    #input-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-top: 6px;
      gap: 8px;
    }
    #char-count {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    #char-count.warn { color: var(--vscode-inputValidation-warningForeground); }
    #send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      padding: 5px 14px;
      font-size: 12px;
      cursor: pointer;
    }
    #send-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    #send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ---- Empty state ---- */
    #empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      text-align: center;
      padding: 20px;
    }
    #empty-state .dh-logo {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.1em;
      color: var(--vscode-foreground);
      opacity: 0.15;
    }
    .hint {
      margin-top: 4px;
      font-size: 11px;
      opacity: 0.7;
    }
  </style>
</head>
<body>

  <div id="header">
    <h2>⚡ DarkHorse AI</h2>
    <div id="context-bar">No active ABAP file</div>
  </div>

  <div id="messages">
    <div id="empty-state">
      <div class="dh-logo">DH</div>
      <div>Ask DarkHorse to generate, review, or explain ABAP code.</div>
      <div class="hint">Open an ABAP file first for best results.</div>
      <div class="hint">Generated code appears as a diff — you review before it's inserted.</div>
    </div>
  </div>

  <div id="loading">
    <div class="spinner"></div>
    <span>Generating ABAP code…</span>
  </div>

  <div id="input-area">
    <textarea
      id="prompt-input"
      placeholder="Describe what you want to build… e.g. 'Write a SELECT statement to read all open sales orders from VBAK'"
      maxlength="8000"
    ></textarea>
    <div id="input-actions">
      <span id="char-count">0 / 8000</span>
      <button id="send-btn" disabled>Generate</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // ---- DOM refs ----
    const messagesEl   = document.getElementById('messages');
    const emptyState   = document.getElementById('empty-state');
    const promptInput  = document.getElementById('prompt-input');
    const sendBtn      = document.getElementById('send-btn');
    const loadingEl    = document.getElementById('loading');
    const contextBar   = document.getElementById('context-bar');
    const charCount    = document.getElementById('char-count');

    let isLoading = false;

    // ---- Input handling ----
    promptInput.addEventListener('input', () => {
      const len = promptInput.value.length;
      charCount.textContent = len + ' / 8000';
      charCount.classList.toggle('warn', len > 7000);
      sendBtn.disabled = len === 0 || isLoading;
    });

    promptInput.addEventListener('keydown', (e) => {
      // Ctrl+Enter or Cmd+Enter to submit
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!sendBtn.disabled) { submitPrompt(); }
      }
    });

    sendBtn.addEventListener('click', submitPrompt);

    function submitPrompt() {
      const prompt = promptInput.value.trim();
      if (!prompt || isLoading) { return; }

      // Show the user's message in the chat
      appendMessage('user', prompt);
      promptInput.value = '';
      charCount.textContent = '0 / 8000';
      sendBtn.disabled = true;

      vscode.postMessage({
        type: 'generate',
        prompt,
        sessionId: 'sess_' + Date.now()
      });
    }

    // ---- Message rendering ----
    function appendMessage(role, text, meta) {
      // Remove empty state on first message
      if (emptyState && emptyState.parentNode) {
        emptyState.remove();
      }

      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = text;

      if (meta) {
        const metaEl = document.createElement('div');
        metaEl.className = 'meta';
        metaEl.textContent = meta;
        div.appendChild(metaEl);
      }

      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function setLoading(active) {
      isLoading = active;
      loadingEl.classList.toggle('visible', active);
      sendBtn.disabled = active || promptInput.value.trim().length === 0;
    }

    // ---- Messages from extension host ----
    window.addEventListener('message', (event) => {
      const msg = event.data;

      switch (msg.type) {

        case 'loading':
          setLoading(true);
          break;

        case 'response':
          setLoading(false);
          appendMessage(
            'assistant',
            'Code generated. Review the diff preview to accept or reject.',
            msg.model + ' · ' + msg.tokensUsed + ' tokens'
          );
          if (msg.explanation) {
            appendMessage('info', msg.explanation);
          }
          break;

        case 'error':
          setLoading(false);
          appendMessage('error', '⚠ ' + (msg.errorMessage || 'An error occurred.'));
          sendBtn.disabled = promptInput.value.trim().length === 0;
          break;

        case 'context':
          updateContextBar(msg.context);
          break;
      }
    });

    function updateContextBar(ctx) {
      if (!ctx) {
        contextBar.textContent = 'No active ABAP file';
        return;
      }
      contextBar.innerHTML = '';
      if (ctx.objectType) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = ctx.objectType;
        contextBar.appendChild(badge);
      }
      if (ctx.objectName) {
        const name = document.createElement('span');
        name.textContent = ctx.objectName;
        contextBar.appendChild(name);
      }
      if (ctx.hasSelection) {
        const sel = document.createElement('span');
        sel.className = 'badge';
        sel.textContent = 'selection';
        contextBar.appendChild(sel);
      }
      if (!ctx.objectType && !ctx.objectName) {
        contextBar.textContent = 'No active ABAP file';
      }
    }

    // Signal to extension host that the webview is ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------
    generateSessionId() {
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
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
        AiPanel.instance = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }
}
exports.AiPanel = AiPanel;
//# sourceMappingURL=AiPanel.js.map