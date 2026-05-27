'use strict';

/**
 * SolutionDiagramPanel — VS Code webview that renders a Mermaid call/dependency
 * diagram produced by TdsPostCodeAgent.
 *
 * Shows boxes for every ABAP object (class, CDS view, BDEF, table, BAdI) and
 * labelled arrows: calls / implements / reads / writes / projects / defines.
 * Custom Z objects are grouped separately from SAP standard objects.
 *
 * The diagram is rendered in the browser via the official mermaid.js CDN so
 * there are no additional npm dependencies.
 */

import * as vscode from 'vscode';

export class SolutionDiagramPanel {

  private static currentPanel: SolutionDiagramPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------

  public static show(mermaidSource: string, title: string): void {
    if (SolutionDiagramPanel.currentPanel) {
      SolutionDiagramPanel.currentPanel.update(mermaidSource, title);
      SolutionDiagramPanel.currentPanel.panel.reveal(vscode.ViewColumn.Two);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseSolutionDiagram',
      `Solution Diagram — ${title}`,
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    SolutionDiagramPanel.currentPanel = new SolutionDiagramPanel(panel, mermaidSource, title);
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  private constructor(
    panel: vscode.WebviewPanel,
    mermaidSource: string,
    title: string
  ) {
    this.panel = panel;
    this.panel.webview.html = buildHtml(mermaidSource, title);

    this.panel.onDidDispose(() => {
      SolutionDiagramPanel.currentPanel = undefined;
    });

    // Handle save-as-SVG message from the webview
    this.panel.webview.onDidReceiveMessage((msg: { command: string; svg?: string; filename?: string }) => {
      if (msg.command === 'saveSvg' && msg.svg) {
        vscode.window.showSaveDialog({
          defaultUri:  vscode.Uri.file((msg.filename ?? 'solution-diagram') + '.svg'),
          filters:     { 'SVG Image': ['svg'] }
        }).then(uri => {
          if (uri) {
            const { writeFileSync } = require('fs');
            writeFileSync(uri.fsPath, msg.svg!, 'utf-8');
            vscode.window.showInformationMessage(`Diagram saved: ${uri.fsPath}`);
          }
        });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Update an already-open panel
  // ---------------------------------------------------------------------------

  private update(mermaidSource: string, title: string): void {
    this.panel.title = `Solution Diagram — ${title}`;
    this.panel.webview.html = buildHtml(mermaidSource, title);
  }
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildHtml(mermaidSource: string, title: string): string {
  // JSON-encode the diagram source so it can be safely embedded in a JS string.
  const encoded = JSON.stringify(mermaidSource);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solution Diagram</title>
  <style>
    :root {
      --green:  #2d7a2d;
      --green2: #4aaa4a;
      --bg:     #1e1e1e;
      --card:   #252526;
      --border: #3c3c3c;
      --text:   #cccccc;
      --sub:    #888888;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    header h1 {
      font-size: 13px;
      font-weight: 600;
      color: var(--green2);
      flex: 1;
    }
    button {
      background: var(--green);
      border: none;
      color: #fff;
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--green2); }
    button.secondary {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--text);
    }
    button.secondary:hover { background: var(--border); }
    #diagram-wrap {
      flex: 1;
      overflow: auto;
      padding: 24px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }
    #diagram-container {
      background: #ffffff;
      border-radius: 8px;
      padding: 32px;
      min-width: 600px;
    }
    #diagram-container svg {
      max-width: 100%;
      height: auto;
    }
    #error-box {
      display: none;
      background: #3c1a1a;
      border: 1px solid #8b2020;
      border-radius: 6px;
      padding: 16px;
      margin: 24px;
    }
    #error-box pre {
      color: #f48c8c;
      white-space: pre-wrap;
      font-size: 12px;
      margin-top: 8px;
    }
    #source-section {
      display: none;
      background: var(--card);
      border-top: 1px solid var(--border);
      padding: 16px;
      max-height: 220px;
      overflow: auto;
      flex-shrink: 0;
    }
    #source-section pre {
      color: var(--green2);
      font-size: 12px;
      font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
      white-space: pre;
    }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 8px 16px;
      border-top: 1px solid var(--border);
      background: var(--card);
      flex-shrink: 0;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--sub); }
    .legend-arrow { color: var(--green2); font-weight: bold; }
  </style>
</head>
<body>
  <header>
    <h1>Solution Architecture — ${escapeHtml(title)}</h1>
    <button class="secondary" id="btn-source">Source</button>
    <button id="btn-svg">Export SVG</button>
  </header>

  <div id="diagram-wrap">
    <div id="diagram-container"><div id="mermaid-target"></div></div>
  </div>

  <div id="error-box">
    <strong>Diagram render error</strong>
    <pre id="error-msg"></pre>
    <p style="margin-top:8px;color:#aaa;font-size:12px">The Mermaid source is shown below. Fix it or copy to mermaid.live</p>
  </div>

  <div class="legend">
    <span class="legend-item"><span class="legend-arrow">──calls──▶</span> method invocation</span>
    <span class="legend-item"><span class="legend-arrow">──implements──▶</span> BAdI / interface impl</span>
    <span class="legend-item"><span class="legend-arrow">──reads──▶</span> SELECT / EML READ</span>
    <span class="legend-item"><span class="legend-arrow">──writes──▶</span> MODIFY / INSERT</span>
    <span class="legend-item"><span class="legend-arrow">──projects──▶</span> CDS projection view</span>
    <span class="legend-item"><span class="legend-arrow">──defines──▶</span> BDEF impl class</span>
  </div>

  <div id="source-section">
    <pre id="source-pre"></pre>
  </div>

  <script type="module">
    const vscode = acquireVsCodeApi();
    const raw    = ${encoded};

    // ---- Mermaid initialisation ----
    // Use the official mermaid CDN (works in webview with internet access)
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
    script.onload = () => renderDiagram();
    script.onerror = () => showError('Could not load mermaid.js. Check your internet connection.');
    document.head.appendChild(script);

    async function renderDiagram() {
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            primaryColor:       '#e8f5e9',
            primaryBorderColor: '#2d7a2d',
            primaryTextColor:   '#1a1a1a',
            lineColor:          '#2d7a2d',
            secondaryColor:     '#f1f8f1',
            tertiaryColor:      '#ffffff',
            clusterBkg:         '#f5faf5',
            clusterBorder:      '#4aaa4a',
            fontFamily:         'Segoe UI, sans-serif',
            fontSize:           '13px'
          },
          flowchart: { htmlLabels: true, curve: 'basis', padding: 20 }
        });

        const target = document.getElementById('mermaid-target');
        const { svg } = await window.mermaid.render('solution-svg', raw);
        target.innerHTML = svg;
      } catch (err) {
        showError(String(err));
        document.getElementById('source-section').style.display = 'block';
        document.getElementById('source-pre').textContent = raw;
      }
    }

    function showError(msg) {
      const box = document.getElementById('error-box');
      box.style.display = 'block';
      document.getElementById('error-msg').textContent = msg;
      document.getElementById('diagram-wrap').style.display = 'none';
    }

    // ---- Source toggle ----
    document.getElementById('btn-source').addEventListener('click', () => {
      const sec = document.getElementById('source-section');
      document.getElementById('source-pre').textContent = raw;
      sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
    });

    // ---- Export SVG ----
    document.getElementById('btn-svg').addEventListener('click', () => {
      const svg = document.querySelector('#mermaid-target svg');
      if (!svg) { alert('Diagram not yet rendered.'); return; }
      vscode.postMessage({
        command:  'saveSvg',
        svg:      svg.outerHTML,
        filename: 'solution-diagram'
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
