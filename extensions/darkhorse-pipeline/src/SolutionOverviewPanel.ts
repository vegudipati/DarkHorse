import * as vscode from 'vscode';
import { SolutionOverview, CleanCoreLevel, PipelineStateManager } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';

export class SolutionOverviewPanel {

  private static currentPanel: SolutionOverviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private overview: SolutionOverview;
  private stateManager: PipelineStateManager;
  private tracker: PipelineTracker;
  private context: vscode.ExtensionContext;

  public static async show(
    context: vscode.ExtensionContext,
    overview: SolutionOverview,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {
    if (SolutionOverviewPanel.currentPanel) {
      SolutionOverviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      SolutionOverviewPanel.currentPanel.update(overview);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'darkhorseSolutionOverview',
      `Solution Overview — ${overview.solutionSummary.substring(0, 40)}...`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    SolutionOverviewPanel.currentPanel = new SolutionOverviewPanel(
      panel, context, overview, stateManager, tracker
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    overview: SolutionOverview,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ) {
    this.panel = panel;
    this.context = context;
    this.overview = overview;
    this.stateManager = stateManager;
    this.tracker = tracker;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'approve':
          await this.handleApprove(message.justification);
          break;
        case 'blockLevelD':
          await this.handleLevelD();
          break;
        case 'refineBr':
          await this.handleRefineBr(message.newBrText);
          break;
        case 'regenerate':
          await this.handleRegenerate();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      SolutionOverviewPanel.currentPanel = undefined;
    });
  }

  private update(overview: SolutionOverview): void {
    this.overview = overview;
    this.panel.webview.html = this.getHtml();
  }

  private async handleApprove(justification?: string): Promise<void> {
    await this.stateManager.markSolutionOverviewApproved(justification);
    this.tracker.refresh();
    this.panel.dispose();

    vscode.window.showInformationMessage(
      'DarkHorse: Solution Overview approved. Generating Functional Design Specification...'
    );

    try {
      const { FdsGenerator } = require('./FdsGenerator');
      await FdsGenerator.generate(this.context, this.stateManager, this.tracker);
    } catch {
      vscode.window.showInformationMessage(
        'DarkHorse: Solution Overview approved. FDS generation will begin shortly.'
      );
    }
  }

  private async handleLevelD(): Promise<void> {
    await this.stateManager.blockForLevelD();
    this.tracker.refresh();
    this.panel.dispose();
    vscode.window.showErrorMessage(
      '🚫 DarkHorse: Pipeline BLOCKED — Level D violation detected. ' +
      'Refine your Business Requirement using "DarkHorse: Resume Pipeline" and restart.'
    );
  }

  private async handleRefineBr(newBrText: string): Promise<void> {
    if (!newBrText || newBrText.trim().length < 20) {
      this.panel.webview.postMessage({
        command: 'error',
        message: 'Please provide a more detailed refined requirement (minimum 20 characters).'
      });
      return;
    }
    await this.stateManager.refineBrForLevelD(newBrText);
    this.tracker.refresh();
    this.panel.dispose();

    vscode.window.showInformationMessage(
      'DarkHorse: BR refined. Regenerating Solution Overview...'
    );

    const { SolutionOverviewGenerator } = require('./SolutionOverviewGenerator');
    await SolutionOverviewGenerator.generate(this.context, this.stateManager, this.tracker);
  }

  private async handleRegenerate(): Promise<void> {
    this.panel.dispose();
    await this.stateManager.updateStage('br_captured');
    this.tracker.refresh();
    const { SolutionOverviewGenerator } = require('./SolutionOverviewGenerator');
    await SolutionOverviewGenerator.generate(this.context, this.stateManager, this.tracker);
  }

  private getLevelColor(level: CleanCoreLevel): string {
    switch (level) {
      case 'A': return '#3fb950';
      case 'B': return '#58a6ff';
      case 'C': return '#e3b341';
      case 'D': return '#f85149';
      default:  return '#8b949e';
    }
  }

  private getLevelBg(level: CleanCoreLevel): string {
    switch (level) {
      case 'A': return '#1a3a1a';
      case 'B': return '#1a2d4a';
      case 'C': return '#3a2a00';
      case 'D': return '#3a0a0a';
      default:  return '#21262d';
    }
  }

  private buildLevel2Svg(): string {
    const arch = this.overview.level2Architecture;
    const systems = arch.systems;
    const flows = arch.flows;

    if (systems.length === 0) {
      return `<div class="arch-placeholder">No architecture data available</div>`;
    }

    const boxW = 160;
    const boxH = 70;
    const gap = 120;
    const totalW = systems.length * boxW + (systems.length - 1) * gap + 80;
    const svgH = 240;

    const colors = ['#1f6feb', '#238636', '#8b5cf6', '#db6d28'];

    let boxes = '';
    let arrows = '';
    let labels = '';

    const positions: { x: number; y: number }[] = [];
    systems.forEach((sys, i) => {
      const x = 40 + i * (boxW + gap);
      const y = 85;
      positions.push({ x, y });

      boxes += `
        <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8"
          fill="${colors[i % colors.length]}22" stroke="${colors[i % colors.length]}" stroke-width="2"/>
        <text x="${x + boxW / 2}" y="${y + 28}" text-anchor="middle" 
          fill="#e6edf3" font-size="13" font-weight="600" font-family="Segoe UI,Arial">${sys.name}</text>
        <text x="${x + boxW / 2}" y="${y + 50}" text-anchor="middle"
          fill="#8b949e" font-size="10" font-family="Segoe UI,Arial">${sys.role.substring(0, 30)}</text>
      `;
    });

    flows.forEach((flow, i) => {
      const fromIdx = systems.findIndex(s =>
        s.name.toLowerCase().includes(flow.from.toLowerCase().split(' ')[0]) ||
        flow.from.toLowerCase().includes(s.name.toLowerCase().split(' ')[0])
      );
      const toIdx = systems.findIndex(s =>
        s.name.toLowerCase().includes(flow.to.toLowerCase().split(' ')[0]) ||
        flow.to.toLowerCase().includes(s.name.toLowerCase().split(' ')[0])
      );

      const fIdx = fromIdx >= 0 ? fromIdx : 0;
      const tIdx = toIdx >= 0 ? toIdx : Math.min(fIdx + 1, systems.length - 1);

      if (fIdx === tIdx) { return; }

      const fromX = positions[fIdx].x + boxW;
      const toX = positions[tIdx].x;
      const midY = positions[fIdx].y + boxH / 2;
      const midX = (fromX + toX) / 2;

      arrows += `
        <line x1="${fromX}" y1="${midY}" x2="${toX}" y2="${midY}"
          stroke="#58a6ff" stroke-width="2" marker-end="url(#arrow)"/>
        <rect x="${midX - 45}" y="${midY - 24}" width="90" height="20" rx="4"
          fill="#0d1117" stroke="#30363d" stroke-width="1"/>
        <text x="${midX}" y="${midY - 10}" text-anchor="middle"
          fill="#79c0ff" font-size="10" font-family="Segoe UI,Arial">${flow.protocol}</text>
      `;

      labels += `
        <text x="${midX}" y="${midY + 18}" text-anchor="middle"
          fill="#8b949e" font-size="9" font-family="Segoe UI,Arial">${flow.description.substring(0, 35)}</text>
      `;
    });

    // Trigger label
    const triggerLabel = arch.triggerPoint
      ? `<text x="${totalW / 2}" y="200" text-anchor="middle" fill="#e3b341" font-size="11" font-family="Segoe UI,Arial">⚡ Trigger: ${arch.triggerPoint.substring(0, 60)}</text>`
      : '';

    return `
      <svg viewBox="0 0 ${totalW} ${svgH}" xmlns="http://www.w3.org/2000/svg"
        style="width:100%;max-width:${totalW}px;background:#0d1117;border-radius:8px;border:1px solid #30363d">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#58a6ff"/>
          </marker>
        </defs>
        ${boxes}
        ${arrows}
        ${labels}
        ${triggerLabel}
      </svg>`;
  }

  private buildLevel3Svg(): string {
    const arch = this.overview.level3Architecture;
    const components = arch.components;

    if (components.length === 0) {
      return `<div class="arch-placeholder">No component data available</div>`;
    }

    const rowH = 80;
    const svgH = components.length * rowH + 60;
    const svgW = 800;

    const typeColors: Record<string, string> = {
      'ABAP Program': '#1f6feb',
      'BAdI': '#238636',
      'CDS View': '#8b5cf6',
      'RAP Entity': '#3fb950',
      'OData': '#db6d28',
      'IDoc': '#e3b341',
      'BAPI': '#58a6ff',
      'Middleware': '#ec4899',
      'default': '#8b949e'
    };

    let rows = '';
    components.forEach((comp, i) => {
      const y = 20 + i * rowH;
      const typeKey = Object.keys(typeColors).find(k =>
        comp.type.toLowerCase().includes(k.toLowerCase())
      ) ?? 'default';
      const color = typeColors[typeKey];

      rows += `
        <rect x="10" y="${y}" width="780" height="${rowH - 10}" rx="6"
          fill="${color}11" stroke="${color}44" stroke-width="1"/>
        <rect x="10" y="${y}" width="4" height="${rowH - 10}" rx="2" fill="${color}"/>
        <text x="24" y="${y + 22}" fill="${color}" font-size="12" font-weight="700"
          font-family="Segoe UI,Arial">${comp.name}</text>
        <text x="24" y="${y + 38}" fill="#8b949e" font-size="10"
          font-family="Segoe UI,Arial">${comp.type}</text>
        <text x="24" y="${y + 56}" fill="#c9d1d9" font-size="10"
          font-family="Segoe UI,Arial">${comp.detail.substring(0, 100)}</text>
      `;
    });

    return `
      <svg viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg"
        style="width:100%;background:#0d1117;border-radius:8px;border:1px solid #30363d">
        ${rows}
      </svg>`;
  }

  private getHtml(): string {
    const ov = this.overview;
    const hasLevelD = ov.overallCleanCoreLevel === 'D' ||
      ov.deviations.some(d => d.level === 'D');
    const hasLevelC = ov.deviations.some(d => d.level === 'C') && !hasLevelD;

    const levelColor = this.getLevelColor(ov.overallCleanCoreLevel);
    const levelBg = this.getLevelBg(ov.overallCleanCoreLevel);

    const ccRows = ov.cleanCoreAlignment.map(c => `
      <tr>
        <td class="comp-name">${c.component}</td>
        <td>${c.approach}</td>
        <td><span class="level-badge" style="background:${this.getLevelBg(c.level)};color:${this.getLevelColor(c.level)};border:1px solid ${this.getLevelColor(c.level)}">Level ${c.level}</span></td>
        <td class="reasoning">${c.reasoning}</td>
      </tr>`).join('');

    const deviationRows = ov.deviations.map(d => `
      <tr>
        <td class="comp-name">${d.component}</td>
        <td><span class="level-badge" style="background:${this.getLevelBg(d.level)};color:${this.getLevelColor(d.level)};border:1px solid ${this.getLevelColor(d.level)}">Level ${d.level}</span></td>
        <td>${d.risk}</td>
      </tr>`).join('');

    const modules = ov.affectedModules.map(m =>
      `<span class="module-badge">${m}</span>`).join('');

    const level2Svg = this.buildLevel2Svg();
    const level3Svg = this.buildLevel3Svg();

    const brText = this.stateManager.getState()?.brText ?? '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solution Overview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #0d1117; color: #e6edf3; }
    .header {
      background: #161b22; border-bottom: 1px solid #30363d;
      padding: 16px 28px; position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
    }
    .header-left h2 { color: #58a6ff; font-size: 17px; }
    .header-left p { color: #8b949e; font-size: 12px; margin-top: 3px; }
    .header-actions { display: flex; gap: 10px; align-items: center; }
    .level-main {
      padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700;
      background: ${levelBg}; color: ${levelColor}; border: 1px solid ${levelColor};
    }
    button { padding: 8px 18px; border-radius: 6px; font-size: 13px;
      font-weight: 600; cursor: pointer; border: none; }
    .btn-approve { background: #238636; color: #fff; }
    .btn-approve:hover { background: #2ea043; }
    .btn-approve:disabled { background: #21262d; color: #484f58; cursor: not-allowed; }
    .btn-regen { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
    .btn-regen:hover { background: #30363d; }
    .btn-refine { background: #b45309; color: #fff; }
    .btn-refine:hover { background: #d97706; }
    .content { padding: 28px; max-width: 1000px; margin: 0 auto; }
    .section { margin-bottom: 28px; }
    .section h3 { font-size: 15px; color: #58a6ff; margin-bottom: 12px;
      padding-bottom: 8px; border-bottom: 1px solid #21262d; }
    .section p { font-size: 14px; line-height: 1.7; color: #c9d1d9; }
    .module-badge {
      display: inline-block; padding: 3px 10px; border-radius: 12px;
      background: #1f3a5f; color: #79c0ff; font-size: 12px;
      margin: 2px; border: 1px solid #1f6feb44;
    }
    .level-badge {
      display: inline-block; padding: 3px 10px; border-radius: 12px;
      font-size: 12px; font-weight: 700;
    }
    .cc-table, .dev-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    .cc-table th, .dev-table th {
      background: #1a1a2e; color: #fff; padding: 10px 12px;
      text-align: left; border: 1px solid #30363d;
    }
    .cc-table td, .dev-table td {
      padding: 10px 12px; border: 1px solid #30363d; vertical-align: top;
    }
    .cc-table tr:nth-child(even) td, .dev-table tr:nth-child(even) td {
      background: #0d1117;
    }
    .comp-name { font-weight: 600; color: #58a6ff; white-space: nowrap; }
    .reasoning { color: #8b949e; font-size: 12px; }
    .blocked-banner {
      background: #3a0a0a; border: 2px solid #f85149; border-radius: 8px;
      padding: 20px 24px; margin-bottom: 24px;
    }
    .blocked-banner h3 { color: #f85149; font-size: 16px; margin-bottom: 8px; }
    .blocked-banner p { color: #e6edf3; font-size: 13px; line-height: 1.6; }
    .warning-banner {
      background: #3a2a00; border: 1px solid #e3b341; border-radius: 8px;
      padding: 16px 20px; margin-bottom: 20px;
    }
    .warning-banner h4 { color: #e3b341; margin-bottom: 6px; }
    .warning-banner p { color: #c9d1d9; font-size: 13px; }
    .justification-area {
      background: #161b22; border: 1px solid #e3b341; border-radius: 6px;
      padding: 16px; margin-top: 12px;
    }
    .justification-area label { font-size: 13px; color: #e3b341; display: block; margin-bottom: 8px; }
    .justification-area textarea {
      width: 100%; background: #0d1117; border: 1px solid #30363d;
      border-radius: 4px; color: #e6edf3; font-size: 13px;
      padding: 10px; resize: vertical; min-height: 80px; font-family: inherit;
    }
    .refine-area {
      background: #161b22; border: 1px solid #f85149; border-radius: 6px;
      padding: 16px; margin-top: 16px;
    }
    .refine-area label { font-size: 13px; color: #f85149; display: block; margin-bottom: 8px; }
    .refine-area textarea {
      width: 100%; background: #0d1117; border: 1px solid #30363d;
      border-radius: 4px; color: #e6edf3; font-size: 13px;
      padding: 10px; resize: vertical; min-height: 120px; font-family: inherit;
    }
    .approve-bar {
      background: #1a2d1a; border: 1px solid #238636; border-radius: 8px;
      padding: 20px 24px; display: flex; align-items: center;
      justify-content: space-between; margin-top: 32px; margin-bottom: 40px;
    }
    .approve-bar p { font-size: 14px; color: #3fb950; }
    .approve-bar small { font-size: 12px; color: #8b949e; display: block; margin-top: 4px; }
    .arch-placeholder { color: #8b949e; font-size: 13px; padding: 20px; text-align: center; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .info-cell { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; }
    .info-cell .label { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
    .info-cell .value { font-size: 14px; color: #e6edf3; font-weight: 600; }
    .error-msg { color: #f85149; font-size: 12px; margin-top: 6px; display: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h2>🏗️ Solution Overview Review</h2>
      <p>Complexity: ${ov.complexity} | Overall Clean Core: Level ${ov.overallCleanCoreLevel}</p>
    </div>
    <div class="header-actions">
      <span class="level-main">Level ${ov.overallCleanCoreLevel}</span>
      <button class="btn-regen" onclick="regenerate()">↺ Regenerate</button>
      ${!hasLevelD ? `<button class="btn-approve" id="approveBtn" onclick="approve()">✓ Approve → Generate FDS</button>` : ''}
    </div>
  </div>

  <div class="content">

    ${hasLevelD ? `
    <div class="blocked-banner">
      <h3>🚫 Pipeline Blocked — Level D Violation Detected</h3>
      <p>The proposed solution contains components classified as Level D (Not Recommended) by SAP's Clean Core extensibility model. This violates Deloitte's mandate that all solutions must target Level A or B.</p>
      <p style="margin-top:8px"><strong>Violated components:</strong> ${ov.deviations.filter(d => d.level === 'D').map(d => d.component).join(', ')}</p>
      <p style="margin-top:8px">Please refine your Business Requirement to avoid these patterns, or restructure the solution approach to achieve Level A or B compliance.</p>
      <div class="refine-area">
        <label>✏️ Refine your Business Requirement — remove Level D patterns and resubmit:</label>
        <textarea id="refinedBr" placeholder="Paste your refined Business Requirement here...">${brText}</textarea>
        <div class="error-msg" id="refineError">Please provide a refined requirement.</div>
        <br/>
        <button class="btn-refine" onclick="refineBr()" style="margin-top:10px">🔄 Regenerate Solution Overview with Refined BR</button>
      </div>
    </div>` : ''}

    ${hasLevelC ? `
    <div class="warning-banner">
      <h4>⚠️ Level C Deviation Detected — Justification Required</h4>
      <p>The solution contains Level C components (Internal SAP Objects). Per Deloitte policy, written justification is required before proceeding. The Approve button will remain disabled until justification is provided.</p>
      <div class="justification-area">
        <label>📝 Provide written justification for Level C usage:</label>
        <textarea id="justification" placeholder="Explain why Level A or B was not feasible, what risk mitigation is in place, and who approved this deviation..." oninput="checkJustification()"></textarea>
        <div class="error-msg" id="justError">Justification is required for Level C deviations.</div>
      </div>
    </div>` : ''}

    <div class="section">
      <h3>1. Solution Overview</h3>
      <p>${ov.solutionSummary}</p>
    </div>

    <div class="section">
      <h3>2. Solution Details</h3>
      <div class="info-grid">
        <div class="info-cell">
          <div class="label">Complexity</div>
          <div class="value">${ov.complexity}</div>
        </div>
        <div class="info-cell">
          <div class="label">Overall Clean Core Level</div>
          <div class="value" style="color:${levelColor}">Level ${ov.overallCleanCoreLevel}</div>
        </div>
        <div class="info-cell">
          <div class="label">Affected SAP Modules</div>
          <div class="value">${modules || 'TBD'}</div>
        </div>
        <div class="info-cell">
          <div class="label">RICEFW Type</div>
          <div class="value">${ov.affectedModules.join(', ') || 'See Details'}</div>
        </div>
      </div>
      <br/>
      <p>${ov.solutionDetails}</p>
    </div>

    <div class="section">
      <h3>3. Solution Architecture — Level 2 (WHAT)</h3>
      <p style="margin-bottom:12px;font-size:13px;color:#8b949e">${ov.level2Architecture.description}</p>
      ${level2Svg}
      ${ov.level2Architecture.triggerPoint ?
        `<p style="margin-top:12px;font-size:13px"><span style="color:#e3b341">⚡ Trigger Point:</span> ${ov.level2Architecture.triggerPoint}</p>` : ''}
    </div>

    <div class="section">
      <h3>4. Solution Architecture — Level 3 (HOW)</h3>
      <p style="margin-bottom:12px;font-size:13px;color:#8b949e">${ov.level3Architecture.description}</p>
      ${level3Svg}
    </div>

    <div class="section">
      <h3>5. Clean Core Alignment</h3>
      <table class="cc-table">
        <thead>
          <tr><th>Component</th><th>Approach</th><th>Level</th><th>Reasoning</th></tr>
        </thead>
        <tbody>${ccRows || '<tr><td colspan="4" style="color:#8b949e;text-align:center">No components assessed</td></tr>'}</tbody>
      </table>
    </div>

    ${ov.deviations.length > 0 ? `
    <div class="section">
      <h3>6. Deviations from Clean Core</h3>
      <table class="dev-table">
        <thead>
          <tr><th>Component</th><th>Level</th><th>Risk & Justification Required</th></tr>
        </thead>
        <tbody>${deviationRows}</tbody>
      </table>
    </div>` : ''}

    <div class="section">
      <h3>${ov.deviations.length > 0 ? '7' : '6'}. Error Handling Approach</h3>
      <p>${ov.errorHandlingApproach}</p>
    </div>

    ${!hasLevelD ? `
    <div class="approve-bar">
      <div>
        <p>Ready to approve this Solution Overview and proceed to FDS generation?</p>
        <small>${hasLevelC ? '⚠️ Justification required for Level C deviation before approving.' : '✅ Solution is Level A/B compliant — ready to proceed.'}</small>
      </div>
      <button class="btn-approve" id="approveBarBtn"
        ${hasLevelC ? 'disabled' : ''}
        onclick="approve()">
        ✓ Approve Solution → Generate FDS
      </button>
    </div>` : ''}

  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const hasLevelC = ${hasLevelC};
    const hasLevelD = ${hasLevelD};

    function checkJustification() {
      if (!hasLevelC) { return; }
      const just = document.getElementById('justification')?.value?.trim() ?? '';
      const btn1 = document.getElementById('approveBtn');
      const btn2 = document.getElementById('approveBarBtn');
      const enabled = just.length >= 30;
      if (btn1) { btn1.disabled = !enabled; }
      if (btn2) { btn2.disabled = !enabled; }
    }

    function approve() {
      if (hasLevelD) { return; }
      const just = hasLevelC
        ? (document.getElementById('justification')?.value?.trim() ?? '')
        : undefined;
      if (hasLevelC && (!just || just.length < 30)) {
        const err = document.getElementById('justError');
        if (err) { err.style.display = 'block'; }
        return;
      }
      vscode.postMessage({ command: 'approve', justification: just });
    }

    function regenerate() {
      if (confirm('Regenerate the Solution Overview? Current version will be replaced.')) {
        vscode.postMessage({ command: 'regenerate' });
      }
    }

    function refineBr() {
      const text = document.getElementById('refinedBr')?.value?.trim() ?? '';
      if (text.length < 20) {
        const err = document.getElementById('refineError');
        if (err) { err.style.display = 'block'; }
        return;
      }
      vscode.postMessage({ command: 'refineBr', newBrText: text });
    }

    window.addEventListener('message', e => {
      if (e.data.command === 'error') {
        alert(e.data.message);
      }
    });
  </script>
</body>
</html>`;
  }
}