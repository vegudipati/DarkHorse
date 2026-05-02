import * as vscode from 'vscode';

export interface CreateTransportData {
  description: string;
  type: 'workbench' | 'customizing';
}

export class CreateTransportPanel {

  private static currentPanel: CreateTransportPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private resolvePromise: ((data: CreateTransportData | undefined) => void) | undefined;

  public static async show(): Promise<CreateTransportData | undefined> {
    if (CreateTransportPanel.currentPanel) {
      CreateTransportPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    return new Promise((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'darkhorseCreateTransport',
        'DarkHorse — Create Transport',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      CreateTransportPanel.currentPanel = new CreateTransportPanel(panel, resolve);
    });
  }

  private constructor(
    panel: vscode.WebviewPanel,
    resolve: (data: CreateTransportData | undefined) => void
  ) {
    this.panel = panel;
    this.resolvePromise = resolve;
    this.panel.webview.html = this.getHtml();

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
      CreateTransportPanel.currentPanel = undefined;
      this.resolvePromise?.(undefined);
    });
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Create Transport</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 40px;
      max-width: 500px;
      margin: 0 auto;
    }
    h2 { color: #58a6ff; font-size: 22px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 13px; margin-bottom: 32px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; font-size: 13px; color: #8b949e; margin-bottom: 6px; font-weight: 500; }
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
    }
    input:focus, select:focus { border-color: #58a6ff; }
    input::placeholder { color: #484f58; }
    .hint { font-size: 11px; color: #484f58; margin-top: 4px; }
    .type-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .type-card {
      background: #161b22;
      border: 2px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .type-card:hover { border-color: #58a6ff; }
    .type-card.selected { border-color: #238636; background: #1a2d1a; }
    .type-card h4 { font-size: 14px; margin-bottom: 6px; color: #e6edf3; }
    .type-card p { font-size: 12px; color: #8b949e; line-height: 1.4; }
    .warning {
      background: #2d1f00;
      border: 1px solid #d29922;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 12px;
      color: #e3b341;
      margin-bottom: 28px;
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
    .btn-primary { background: #238636; color: #fff; }
    .btn-primary:hover { background: #2ea043; }
    .btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
    .btn-secondary:hover { background: #30363d; }
    .error { color: #f85149; font-size: 12px; margin-top: 4px; display: none; }
  </style>
</head>
<body>
  <h2>📦 Create Transport Request</h2>
  <p class="subtitle">Create a new SAP Transport Request in the DEV system</p>

  <div class="warning">
    ⚠️ DarkHorse creates and assigns objects to transports only. 
    Transport <strong>release</strong> must be done in SAP STMS.
  </div>

  <div class="form-group">
    <label>Description <span class="required">*</span></label>
    <input type="text" id="description" placeholder="e.g. ZREPORT_SALES - Sales Report Enhancement" maxlength="60" />
    <div class="hint">Max 60 characters. Be descriptive — this appears in STMS.</div>
    <div class="error" id="err-desc">Description is required</div>
  </div>

  <div class="form-group">
    <label>Transport Type <span class="required">*</span></label>
    <div class="type-cards">
      <div class="type-card selected" id="card-workbench" onclick="selectType('workbench')">
        <h4>🔧 Workbench</h4>
        <p>For ABAP programs, classes, function modules, and repository objects</p>
      </div>
      <div class="type-card" id="card-customizing" onclick="selectType('customizing')">
        <h4>⚙️ Customizing</h4>
        <p>For configuration settings and table entries (IMG activities)</p>
      </div>
    </div>
  </div>

  <div class="buttons">
    <button class="btn-secondary" onclick="cancel()">Cancel</button>
    <button class="btn-primary" onclick="submit()">Create Transport</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let selectedType = 'workbench';

    function selectType(type) {
      selectedType = type;
      document.getElementById('card-workbench').classList.toggle('selected', type === 'workbench');
      document.getElementById('card-customizing').classList.toggle('selected', type === 'customizing');
    }

    function submit() {
      const desc = document.getElementById('description').value.trim();
      const err = document.getElementById('err-desc');
      if (!desc) {
        err.style.display = 'block';
        return;
      }
      err.style.display = 'none';
      vscode.postMessage({
        command: 'submit',
        data: { description: desc, type: selectedType }
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    document.getElementById('description').focus();
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { submit(); }
    });
  </script>
</body>
</html>`;
  }
}