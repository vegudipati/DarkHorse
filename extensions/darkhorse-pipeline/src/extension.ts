import * as vscode from 'vscode';
import { PipelineTracker } from './PipelineTracker';
import { PipelineStateManager } from './PipelineStateManager';

let tracker: PipelineTracker;
let stateManager: PipelineStateManager;
let statusBarItem: vscode.StatusBarItem;

/** Map a structured RICEFW/RTM intake JSON into BrIntakeData prefill values.
 *  Tolerant of missing fields — anything not present comes through as
 *  undefined and the developer can fill it in the panel. */
function mapJsonToBrIntake(json: any): {
  title?: string; ricefwType?: string; objectType?: string;
  sapPackage?: string; brText?: string; outputFolder?: string;
} {
  if (!json || typeof json !== 'object') return {};
  // Title combines ricefw_id + title (SAP convention). Either alone is acceptable.
  const ricefwId = (json.ricefw_id ?? '').toString().trim();
  const titleRaw = (json.title     ?? '').toString().trim();
  const title    = ricefwId && titleRaw ? `${ricefwId} - ${titleRaw}`
                 : titleRaw             ? titleRaw
                 : ricefwId             ? ricefwId
                 :                        '';
  // ricefw_type values in the JSON ("Report", "Interface", "Enhancement", ...)
  // already match the panel's option values.
  const ricefwType = (json.ricefw_type ?? '').toString().trim();

  // Synthesize a multi-section BR text the LLM can chew on.
  const lines: string[] = [];
  if (ricefwId)         lines.push(`RICEFW ID: ${ricefwId}`);
  if (json.workstream)  lines.push(`Workstream: ${json.workstream}`);
  if (json.build_sprint) lines.push(`Sprint: ${json.build_sprint}`);
  if (lines.length > 0) lines.push('');
  if (json.long_description) {
    lines.push('## Description');
    lines.push(json.long_description.toString());
    lines.push('');
  }
  if (Array.isArray(json.rtm_details) && json.rtm_details.length > 0) {
    lines.push('## RTM Details');
    json.rtm_details.forEach((r: any, i: number) => {
      const id = r.rtm_id ?? `RTM ${i + 1}`;
      lines.push('');
      lines.push(`### ${id}`);
      if (r.business_requirements) lines.push(`**Business requirement:** ${r.business_requirements}`);
      if (r.requirement_status)    lines.push(`**Status:** ${r.requirement_status}`);
      if (r.user_story_deloitte)   lines.push(`**User story:** ${r.user_story_deloitte}`);
      if (r.user_story_unfi)       lines.push(`**User story (client):** ${r.user_story_unfi}`);
      if (r.description)           lines.push(`**Description:** ${r.description}`);
      if (r.acceptance_criteria)   lines.push(`**Acceptance criteria:** ${r.acceptance_criteria}`);
    });
  } else if (!json.long_description) {
    // Fallback: dump the raw object if no recognised sections were present.
    lines.push(JSON.stringify(json, null, 2));
  }
  return { title, ricefwType, brText: lines.join('\n').trim() };
}

/** Refresh the multi-pipeline status bar item (active pipeline name + stage).
 *  Called after any state change so the bar reflects reality. */
function refreshStatusBar(): void {
  const state = stateManager.getState();
  if (!state) {
    statusBarItem.text  = '$(circuit-board) DarkHorse: no pipeline';
    statusBarItem.tooltip = 'Click to start a new pipeline.';
    statusBarItem.command = 'darkhorse.pipeline.start';
    statusBarItem.show();
    return;
  }
  const count = stateManager.listPipelines().length;
  const suffix = count > 1 ? ` (1 of ${count})` : '';
  statusBarItem.text  = `$(circuit-board) ${state.title}${suffix}`;
  statusBarItem.tooltip =
    `Active pipeline: ${state.title}\n` +
    `Stage: ${stateManager.getStageSummary()}\n` +
    `Click to switch between ${count} pipeline(s).`;
  statusBarItem.command = 'darkhorse.pipeline.switchPipeline';
  statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext) {

  // Initialize state manager — persists pipeline across sessions
  stateManager = new PipelineStateManager(context);

  // Initialize pipeline tracker sidebar
  tracker = new PipelineTracker(stateManager);
  vscode.window.registerTreeDataProvider('darkhorse.pipelineTracker', tracker);

  // Multi-pipeline status bar — shows active pipeline + total count.
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);

  // Wrap tracker.refresh so the status bar updates in lockstep.
  const originalRefresh = tracker.refresh.bind(tracker);
  tracker.refresh = () => {
    originalRefresh();
    refreshStatusBar();
  };
  refreshStatusBar();

  // Command: Start new pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.start', async () => {
      const { BrIntakePanel } = require('./BrIntakePanel');
      await BrIntakePanel.show(context, stateManager, tracker);
    })
  );
  
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.resetCodeGen', async () => {
      await stateManager.resetCodeGeneration();
      tracker.refresh();
      vscode.window.showInformationMessage('DarkHorse: Code generation reset. Use Resume Pipeline to retry.');
    })
  );

  // JSON intake — start a pipeline from a structured RICEFW/RTM JSON file.
  // Schema: { ricefw_id, title, workstream, ricefw_type, long_description,
  // build_sprint, rtm_ids[], rtm_details[{rtm_id, business_requirements,
  // requirement_status, user_story_deloitte, user_story_unfi, description,
  // acceptance_criteria}] }. We open a file picker, parse the JSON, map it
  // to the BrIntakeData shape, and open the BR intake panel prefilled so
  // the developer can review + add the missing fields (output folder, SAP
  // package, primary object type) before submitting.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.startFromJson', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany:  false,
        filters:        { 'BR intake JSON': ['json'] },
        title:          'DarkHorse: pick a BR intake JSON file'
      });
      if (!picked || picked.length === 0) return;
      const fs = require('fs');
      let raw: string;
      try {
        raw = fs.readFileSync(picked[0].fsPath, 'utf8');
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DarkHorse: could not read JSON file — ${err?.message ?? err}`
        );
        return;
      }
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DarkHorse: invalid JSON — ${err?.message ?? err}`
        );
        return;
      }
      const prefill = mapJsonToBrIntake(json);
      if (!prefill.title) {
        vscode.window.showErrorMessage(
          'DarkHorse: JSON missing "title" (and "ricefw_id"). Expected RICEFW/RTM schema with at least one of those fields.'
        );
        return;
      }
      const { BrIntakePanel } = require('./BrIntakePanel');
      await BrIntakePanel.show(context, stateManager, tracker, prefill);
    })
  );

  // Multi-pipeline — switch between concurrent pipelines via QuickPick.
  // The status bar item invokes this command on click.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.switchPipeline', async (pipelineIdArg?: string) => {
      // When called from a tree-item click, the pipelineId is passed
      // directly — no QuickPick needed. When called from the palette or
      // status bar, no arg is supplied and we prompt.
      if (pipelineIdArg) {
        const ok = await stateManager.switchPipeline(pipelineIdArg);
        if (ok) {
          tracker.refresh();
          const newActive = stateManager.getState();
          vscode.window.showInformationMessage(
            `DarkHorse: switched to "${newActive?.title ?? '(unknown)'}"`
          );
        }
        return;
      }
      const pipelines = stateManager.listPipelines();
      if (pipelines.length === 0) {
        vscode.window.showInformationMessage(
          'DarkHorse: No pipelines yet. Use "Start Pipeline" to create one.'
        );
        return;
      }
      if (pipelines.length === 1) {
        vscode.window.showInformationMessage(
          `DarkHorse: Only one pipeline exists (${pipelines[0]!.title}). Use "Start Pipeline" to add another.`
        );
        return;
      }
      type SwitchItem = vscode.QuickPickItem & { pipelineId: string };
      const items: SwitchItem[] = pipelines.map(p => ({
        label:       `${p.isActive ? '$(check) ' : '   '}${p.title}`,
        description: p.ricefwType,
        detail:      `${p.currentStage} · last update ${p.lastUpdatedAt.split('T')[0]} · id ${p.pipelineId.slice(0, 4)}`,
        pipelineId:  p.pipelineId
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title:       'DarkHorse: switch pipeline',
        placeHolder: 'Pick the pipeline you want active',
        matchOnDescription: true,
        matchOnDetail:      true
      });
      if (!pick) return;
      const ok = await stateManager.switchPipeline(pick.pipelineId);
      if (ok) {
        tracker.refresh();
        const newActive = stateManager.getState();
        vscode.window.showInformationMessage(
          `DarkHorse: switched to "${newActive?.title ?? '(unknown)'}"`
        );
      }
    })
  );

  // Multi-pipeline — delete a pipeline (the active one or any other) with
  // explicit confirmation. Output files on disk are NOT deleted; only the
  // in-extension state.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.deletePipeline', async () => {
      const pipelines = stateManager.listPipelines();
      if (pipelines.length === 0) {
        vscode.window.showInformationMessage('DarkHorse: No pipelines to delete.');
        return;
      }
      const items = pipelines.map(p => ({
        label:       `${p.isActive ? '$(check) ' : '   '}${p.title}`,
        description: p.ricefwType,
        detail:      `${p.currentStage} · id ${p.pipelineId.slice(0, 4)}`,
        pipelineId:  p.pipelineId,
        title:       p.title
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title:       'DarkHorse: delete pipeline',
        placeHolder: 'Pick the pipeline to remove from extension state'
      });
      if (!pick) return;
      const confirm = await vscode.window.showWarningMessage(
        `Remove pipeline "${pick.title}" from DarkHorse?`,
        { modal: true, detail: 'Output files on disk are NOT deleted — only the pipeline state inside the extension.' },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      await stateManager.deletePipeline(pick.pipelineId);
      tracker.refresh();
      vscode.window.showInformationMessage(`DarkHorse: deleted pipeline "${pick.title}".`);
    })
  );

  // Reusable-objects marketplace — browse the cross-pipeline catalog. The
  // QuickPick shows every accepted object across all pipelines with source
  // and usage; selecting an entry opens a webview-free read-only doc with
  // the cached code so the developer can review.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.browseReusable', async () => {
      const { ReusableCatalog } = require('./ReusableCatalog');
      const catalog = new ReusableCatalog(context);
      type BrowseItem = vscode.QuickPickItem & { id: string };
      const items: BrowseItem[] = catalog.list().map((s: any) => ({
        label:       `${s.objectName}`,
        description: `${s.objectType} · from ${s.sourcePipelineTitle}`,
        detail:      `accepted ${s.acceptedAt.split('T')[0]} · used ${s.usageCount}× · ${(s.description || '').slice(0, 80)}`,
        id:          s.id
      }));
      if (items.length === 0) {
        vscode.window.showInformationMessage(
          'DarkHorse: Reusable catalog is empty. Accept an object in any pipeline to add the first entry.'
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(items, {
        title:       `DarkHorse: ${items.length} reusable object(s) in the catalog`,
        placeHolder: 'Pick an entry to view its accepted code',
        matchOnDescription: true,
        matchOnDetail:      true
      });
      if (!pick) return;
      const entry = catalog.getById(pick.id);
      if (!entry) return;
      const doc = await vscode.workspace.openTextDocument({
        content:  entry.generatedCode,
        language: 'abap'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    })
  );

  // Reusable-objects marketplace — remove an entry from the catalog. Output
  // files on disk (in any pipeline's abapGit folder) are untouched; only the
  // extension's reuse-offer registry is affected.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.removeReusable', async () => {
      const { ReusableCatalog } = require('./ReusableCatalog');
      const catalog = new ReusableCatalog(context);
      const entries = catalog.list();
      if (entries.length === 0) {
        vscode.window.showInformationMessage('DarkHorse: Reusable catalog is empty — nothing to remove.');
        return;
      }
      type RemoveItem = vscode.QuickPickItem & { id: string; name: string };
      const items: RemoveItem[] = entries.map((s: any) => ({
        label:       s.objectName,
        description: `${s.objectType} · from ${s.sourcePipelineTitle}`,
        detail:      `accepted ${s.acceptedAt.split('T')[0]} · used ${s.usageCount}×`,
        id:          s.id,
        name:        s.objectName
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title:       'DarkHorse: remove entry from reusable catalog',
        placeHolder: 'Pick the entry to remove'
      });
      if (!pick) return;
      const confirm = await vscode.window.showWarningMessage(
        `Remove "${pick.name}" from the reusable catalog?`,
        { modal: true, detail: 'Only the catalog entry is removed. The actual source files in any pipeline\'s output folder stay intact.' },
        'Remove'
      );
      if (confirm !== 'Remove') return;
      await catalog.remove(pick.id);
      vscode.window.showInformationMessage(`DarkHorse: removed "${pick.name}" from the reusable catalog.`);
    })
  );

  // Selective regen — re-generate ONE specific object without re-running
  // the whole pipeline. Prompts the developer to pick which object via
  // QuickPick, then runs the standard preview/accept flow for just that
  // one. The pipeline's currentObjectIndex and stage are NOT changed.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.regenerateObject', async () => {
      const state = stateManager.getState();
      if (!state) {
        vscode.window.showInformationMessage(
          'DarkHorse: No active pipeline. Start one first with "Start Pipeline".'
        );
        return;
      }
      const objects = state.abapObjects ?? [];
      if (objects.length === 0) {
        vscode.window.showInformationMessage(
          'DarkHorse: This pipeline has no ABAP objects yet. Approve the TDS first.'
        );
        return;
      }
      const items = objects.map((o, idx) => ({
        label:       `${o.sequence}. ${o.objectName}`,
        description: o.objectType,
        detail:      o.codeAccepted
                       ? '✓ Accepted — regen will replace the saved code'
                       : o.codeGenerated
                         ? '○ Generated but not accepted — regen will replace pending output'
                         : '◇ Not yet generated — regen will produce the first version',
        index:       idx
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title:       'DarkHorse: which object to regenerate?',
        placeHolder: 'Pick the object — only this one will be regenerated; others stay as-is',
        matchOnDescription: true,
        matchOnDetail:      true
      });
      if (!pick) return;
      const { ObjectCodeGenerator } = require('./ObjectCodeGenerator');
      await ObjectCodeGenerator.regenerateSingle(pick.index, stateManager, tracker);
    })
  );

  // Command: Load reference documents
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.loadReferenceDocs', async () => {
      const { ReferenceDocLoader } = require('./ReferenceDocLoader');
      const styleContext = await ReferenceDocLoader.loadAndConfigure(context, stateManager);
      if (styleContext) {
        tracker.refresh();
        vscode.window.showInformationMessage(
          `DarkHorse: ${styleContext.documentCount} reference document(s) loaded successfully.`
        );
      }
    })
  );

  // Command: Resume pipeline
 context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.resumePipeline', async () => {
      const state = stateManager.getState();
      if (!state) {
        vscode.window.showInformationMessage(
          'DarkHorse: No active pipeline. Use "Start Pipeline" to begin.'
        );
        return;
      }

      tracker.refresh();

      if (state.currentStage === 'blocked_level_d') {
        vscode.window.showErrorMessage(
          '🚫 DarkHorse: Pipeline is BLOCKED due to Level D violation. ' +
          'Use "DarkHorse: Start Pipeline" to begin a new pipeline with a refined BR.'
        );

      } else if (state.currentStage === 'solution_overview_review' && state.solutionOverview) {
        const { SolutionOverviewPanel } = require('./SolutionOverviewPanel');
        await SolutionOverviewPanel.show(context, state.solutionOverview, stateManager, tracker);

      } else if (state.currentStage === 'solution_overview_approved' ||
                 state.currentStage === 'fds_generating') {
        vscode.window.showInformationMessage('DarkHorse: Generating FDS...');
        const { FdsGenerator } = require('./FdsGenerator');
        await FdsGenerator.generate(context, stateManager, tracker);

      } else if (state.currentStage === 'fds_review' && state.fdsContent && state.fdsFilePath) {
        const { FdsReviewPanel } = require('./FdsReviewPanel');
        const fdsDoc = JSON.parse(state.fdsContent);
        await FdsReviewPanel.show(context, fdsDoc, state.fdsFilePath, stateManager, tracker);

      } else if (state.currentStage === 'fds_approved') {
        const { TdsGenerator } = require('./TdsGenerator');
        await TdsGenerator.generate(context, stateManager, tracker);

      } else if (state.currentStage === 'tds_review' && state.tdsContent && state.tdsFilePath) {
        const { TdsReviewPanel } = require('./TdsReviewPanel');
        const tdsDoc = JSON.parse(state.tdsContent);
        await TdsReviewPanel.show(context, tdsDoc, state.tdsFilePath, stateManager, tracker);

      } else if (state.currentStage === 'tds_approved' || state.currentStage === 'code_generating') {
        const { ObjectCodeGenerator } = require('./ObjectCodeGenerator');
        await ObjectCodeGenerator.generate(context, stateManager, tracker);

      } else {
        vscode.window.showInformationMessage(
          `DarkHorse: Pipeline "${state.title}" is at stage: ${state.currentStage}`
        );
      }
    })
  );

  // Command: Capture corrections — CPI-6 Sprint 6 Session 3.
  // Diffs each accepted .abap file in the output folder against the AI code
  // saved on state.abapObjects[i].generatedCode and writes per-object
  // correction JSON files for any deltas.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.captureCorrections', async () => {
      const { runCaptureCorrectionsCommand } = require('./CorrectionStore');
      await runCaptureCorrectionsCommand(stateManager);
    })
  );

  // Command: Open / create client standards file — CPI-6 item 3.
  // Opens darkhorse.client.standardsFile in the editor. If the file does not
  // exist, prompts to create it from a starter Markdown template.
  // Wrapped in try/catch with explicit error toast so handler failures
  // (bad path, permission, etc.) surface instead of silently swallowing.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.openClientStandards', async () => {
      try {
        const { runOpenClientStandardsCommand } = require('./StandardsLoader');
        await runOpenClientStandardsCommand();
      } catch (err: any) {
        const message = err?.message ?? String(err);
        console.error('DarkHorse: openClientStandards failed:', err);
        vscode.window.showErrorMessage(
          `DarkHorse: Open Client Standards failed — ${message}`
        );
      }
    })
  );

  // Command: Discover Template Headings — CPI-6 item 4.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.discoverTemplateHeadings', async () => {
      try {
        const { runDiscoverTemplateHeadingsCommand } = require('./TemplateDiscovery');
        await runDiscoverTemplateHeadingsCommand();
      } catch (err: any) {
        console.error('DarkHorse: discoverTemplateHeadings failed:', err);
        vscode.window.showErrorMessage(
          `DarkHorse: Discover Template Headings failed — ${err?.message ?? err}`
        );
      }
    })
  );

  // Command: Open Templates Config — CPI-6 item 4.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.openTemplatesConfig', async () => {
      try {
        const { runOpenTemplatesConfigCommand } = require('./TemplateConfig');
        await runOpenTemplatesConfigCommand();
      } catch (err: any) {
        console.error('DarkHorse: openTemplatesConfig failed:', err);
        vscode.window.showErrorMessage(
          `DarkHorse: Open Templates Config failed — ${err?.message ?? err}`
        );
      }
    })
  );

  // Command: Verify AI Log Chain — CPI-6 audit-log integrity check.
  // Walks ~/.darkhorse/ai-generation-log.jsonl line by line and confirms
  // every prevHash matches the SHA-256 of the previous line. Any break
  // means the log was edited outside DarkHorse and the chain is no longer
  // tamper-evident.
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.verifyAiLog', async () => {
      const { runVerifyAiLogCommand } = require('./UidLogger');
      await runVerifyAiLogCommand();
    })
  );

  // Command: Clear pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.clearPipeline', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear the current pipeline? This cannot be undone.',
        'Clear', 'Cancel'
      );
      if (confirm === 'Clear') {
        stateManager.clearState();
        tracker.refresh();
        vscode.window.showInformationMessage('DarkHorse: Pipeline cleared.');
      }
    })
  );

  console.log('DarkHorse Pipeline: activated');
}
export function deactivate() {}