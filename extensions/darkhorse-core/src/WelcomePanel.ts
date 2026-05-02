import * as vscode from 'vscode';

export class WelcomePanel {

  private static currentPanel: WelcomePanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  public static show(context: vscode.ExtensionContext): void {
    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseWelcome',
      'Welcome to DarkHorse',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    WelcomePanel.currentPanel = new WelcomePanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => {
      WelcomePanel.currentPanel = undefined;
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to DarkHorse</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 40px 20px;
    }
    .logo {
      font-size: 64px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 42px;
      font-weight: 700;
      color: #58a6ff;
      letter-spacing: 4px;
      margin-bottom: 8px;
    }
    .tagline {
      font-size: 16px;
      color: #8b949e;
      margin-bottom: 48px;
      letter-spacing: 1px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      width: 100%;
      max-width: 900px;
      margin-bottom: 48px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 24px;
    }
    .card-icon { font-size: 28px; margin-bottom: 12px; }
    .card h3 { font-size: 15px; color: #58a6ff; margin-bottom: 8px; }
    .card p { font-size: 13px; color: #8b949e; line-height: 1.5; }
    .status {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 10px;
    }
    .status.ready { background: #1a4731; color: #3fb950; }
    .status.coming { background: #1c2128; color: #8b949e; }
    .version {
      font-size: 12px;
      color: #30363d;
      margin-top: 32px;
    }
    .security-badge {
      background: #1a1f26;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px 24px;
      font-size: 12px;
      color: #8b949e;
      margin-bottom: 32px;
      text-align: center;
    }
    .security-badge span { color: #3fb950; font-weight: 600; }
  </style>
</head>
<body>
  <div class="logo">🐴</div>
  <h1>DARKHORSE</h1>
  <p class="tagline">SAP S/4HANA ABAP Development IDE — Deloitte Internal</p>

  <div class="security-badge">
    <span>🔒 Security-First</span> &nbsp;|&nbsp;
    Telemetry: <span>OFF</span> &nbsp;|&nbsp;
    Credentials: <span>Windows Credential Manager</span> &nbsp;|&nbsp;
    LLM Calls: <span>Proxy Only</span>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-icon">🔌</div>
      <h3>SAP ADT Connector</h3>
      <p>Connect to SAP S/4HANA DEV. Browse objects, read and write ABAP source via ADT REST APIs.</p>
      <span class="status coming">MVP-2 — Coming Next</span>
    </div>
    <div class="card">
      <div class="card-icon">✏️</div>
      <h3>ABAP Language Support</h3>
      <p>Syntax highlighting, IntelliSense, snippets, and live syntax checking powered by ADT.</p>
      <span class="status coming">MVP-3 — Coming Soon</span>
    </div>
    <div class="card">
      <div class="card-icon">📦</div>
      <h3>Transport Manager</h3>
      <p>Create transports, assign objects, and manage your SAP CTS workflow without leaving the IDE.</p>
      <span class="status coming">MVP-4 — Coming Soon</span>
    </div>
    <div class="card">
      <div class="card-icon">🤖</div>
      <h3>AI Code Generation</h3>
      <p>Prompt Claude to generate ABAP code. All calls routed through secure local proxy with PII scrubbing.</p>
      <span class="status coming">MVP-5 — Coming Soon</span>
    </div>
    <div class="card">
      <div class="card-icon">🐙</div>
      <h3>Git Integration</h3>
      <p>Commit, push, pull, and branch ABAP source files directly to GitHub from the IDE.</p>
      <span class="status coming">MVP-6 — Coming Soon</span>
    </div>
    <div class="card">
      <div class="card-icon">⚡</div>
      <h3>Agent Orchestrator</h3>
      <p>Spin up AI agents for code review, analysis, and SAP tasks. Human-in-the-loop, always.</p>
      <span class="status coming">MVP-7 — Coming Soon</span>
    </div>
  </div>

  <p class="version">DarkHorse v0.1.0 | Built for Deloitte SAP Practice</p>
</body>
</html>`;
  }
}