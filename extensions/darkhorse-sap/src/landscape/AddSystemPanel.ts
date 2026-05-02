import * as vscode from 'vscode';

export interface SystemFormData {
  id: string;
  name: string;
  host: string;
  client: string;
  username: string;
  password: string;
  language: string;
}

/**
 * Webview panel for adding a SAP system.
 * Shows a proper form — all fields visible at once.
 * User can copy/paste from other windows freely.
 */
export class AddSystemPanel {

  private static currentPanel: AddSystemPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private resolvePromise: ((data: SystemFormData | undefined) => void) | undefined;

  public static async show(): Promise<SystemFormData | undefined> {
    // If panel already open, bring it to front
    if (AddSystemPanel.currentPanel) {
      AddSystemPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'darkhorseAddSystem',
        'DarkHorse — Add SAP System',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      const instance = new AddSystemPanel(panel, resolve);
      AddSystemPanel.currentPanel = instance;
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    resolve: (data: SystemFormData | undefined) => void
  ) {
    this.panel = panel;
    this.resolvePromise = resolve;
    this.panel.webview.html = this.getHtml();

    // Handle messages from the webview form
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'submit') {
        this.resolvePromise?.(message.data);
        this.panel.dispose();
      } else if (message.command === 'cancel') {
        this.resolvePromise?.(undefined);
        this.panel.dispose();
      }
    });

    this.panel.onDidDispose(() => {
      AddSystemPanel.currentPanel = undefined;
      this.resolvePromise?.(undefined);
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Add SAP System</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 40px;
      max-width: 600px;
      margin: 0 auto;
    }
    h2 {
      color: #58a6ff;
      font-size: 22px;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #8b949e;
      font-size: 13px;
      margin-bottom: 32px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 13px;
      color: #8b949e;
      margin-bottom: 6px;
      font-weight: 500;
    }
    .required { color: #f85149; }
    input, select {
      width: 100%;
      padding: 10px 12px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus {
      border-color: #58a6ff;
    }
    input::placeholder { color: #484f58; }
    .hint {
      font-size: 11px;
      color: #484f58;
      margin-top: 4px;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .security-note {
      background: #1a2332;
      border: 1px solid #1f6feb;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 12px;
      color: #79c0ff;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .buttons {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 32px;
    }
    button {
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: #238636;
      color: #ffffff;
    }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary {
      background: #21262d;
      color: #e6edf3;
      border: 1px solid #30363d;
    }
    .btn-secondary:hover { background: #30363d; }
    .error {
      color: #f85149;
      font-size: 12px;
      margin-top: 4px;
      display: none;
    }
    .divider {
      border: none;
      border-top: 1px solid #21262d;
      margin: 28px 0;
    }
  </style>
</head>
<body>
  <h2>🐴 Add SAP System</h2>
  <p class="subtitle">Configure a new SAP S/4HANA connection for DarkHorse</p>

  <div class="security-note">
    🔒 Your password is stored in VS Code's encrypted secret storage (Windows Credential Manager). It is never written to disk in plaintext.
  </div>

  <div class="form-group">
    <label>System ID <span class="required">*</span></label>
    <input type="text" id="id" placeholder="e.g. S4D" maxlength="10" />
    <div class="hint">Short identifier for this system. Used internally by DarkHorse.</div>
    <div class="error" id="err-id">System ID is required</div>
  </div>

  <div class="form-group">
    <label>Display Name <span class="required">*</span></label>
    <input type="text" id="name" placeholder="e.g. S/4HANA DEV" />
    <div class="hint">Friendly name shown in the system picker.</div>
    <div class="error" id="err-name">Display name is required</div>
  </div>

  <hr class="divider" />

  <div class="form-group">
    <label>SAP Host <span class="required">*</span></label>
    <input type="text" id="host" placeholder="e.g. sap-dev.company.com or https://sap-dev.company.com:44300" />
    <div class="hint">Hostname, IP address, or full URL. Port is optional — defaults to 44300 for HTTPS.</div>
    <div class="error" id="err-host">SAP host is required</div>
  </div>

  <div class="row">
    <div class="form-group">
      <label>SAP Client <span class="required">*</span></label>
      <input type="text" id="client" placeholder="100" maxlength="3" value="100" />
      <div class="error" id="err-client">Client is required</div>
    </div>
    <div class="form-group">
      <label>Language</label>
      <select id="language">
        <option value="EN">EN — English</option>
        <option value="DE">DE — German</option>
        <option value="FR">FR — French</option>
        <option value="ES">ES — Spanish</option>
        <option value="PT">PT — Portuguese</option>
        <option value="ZH">ZH — Chinese</option>
        <option value="JA">JA — Japanese</option>
      </select>
    </div>
  </div>

  <hr class="divider" />

  <div class="form-group">
    <label>SAP Username <span class="required">*</span></label>
    <input type="text" id="username" placeholder="e.g. JSMITH" autocomplete="username" />
    <div class="error" id="err-username">Username is required</div>
  </div>

  <div class="form-group">
    <label>SAP Password <span class="required">*</span></label>
    <input type="password" id="password" placeholder="Your SAP password" autocomplete="current-password" />
    <div class="hint">Stored securely in Windows Credential Manager. Never logged or transmitted in plaintext.</div>
    <div class="error" id="err-password">Password is required</div>
  </div>

  <div class="buttons">
    <button class="btn-secondary" onclick="cancel()">Cancel</button>
    <button class="btn-primary" onclick="submit()">Add System</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function validate() {
      let valid = true;
      const fields = ['id', 'name', 'host', 'client', 'username', 'password'];
      fields.forEach(f => {
        const val = document.getElementById(f).value.trim();
        const err = document.getElementById('err-' + f);
        if (err) {
          if (!val) {
            err.style.display = 'block';
            valid = false;
          } else {
            err.style.display = 'none';
          }
        }
      });
      return valid;
    }

    function submit() {
      if (!validate()) { return; }
      vscode.postMessage({
        command: 'submit',
        data: {
          id:       document.getElementById('id').value.trim().toUpperCase(),
          name:     document.getElementById('name').value.trim(),
          host:     document.getElementById('host').value.trim(),
          client:   document.getElementById('client').value.trim(),
          username: document.getElementById('username').value.trim().toUpperCase(),
          password: document.getElementById('password').value,
          language: document.getElementById('language').value
        }
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    // Allow Enter key to submit
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) { submit(); }
    });

    // Focus first field on load
    document.getElementById('id').focus();
  </script>
</body>
</html>`;
  }
}