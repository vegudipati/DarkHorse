import * as vscode from 'vscode';
import { PipelineTracker } from './PipelineTracker';
import { PipelineStateManager } from './PipelineStateManager';

let tracker: PipelineTracker;
let stateManager: PipelineStateManager;

export function activate(context: vscode.ExtensionContext) {

  // Initialize state manager — persists pipeline across sessions
  stateManager = new PipelineStateManager(context);

  // Initialize pipeline tracker sidebar
  tracker = new PipelineTracker(stateManager);
  vscode.window.registerTreeDataProvider('darkhorse.pipelineTracker', tracker);

  // Command: Start new pipeline
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.pipeline.start', async () => {
      const { BrIntakePanel } = require('./BrIntakePanel');
      await BrIntakePanel.show(context, stateManager, tracker);
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
      vscode.window.showInformationMessage(
        `DarkHorse: Resuming pipeline "${state.title}" at stage: ${state.currentStage}`
      );
      tracker.refresh();
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