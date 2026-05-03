/**
 * DarkHorse Git Extension — Entry Point
 */

'use strict';

import * as vscode from 'vscode';
import { GitPanelProvider } from './GitPanelProvider';
import { GitCommands }      from './commands/gitCommands';

export function activate(context: vscode.ExtensionContext): void {

  const panelProvider = new GitPanelProvider();
  context.subscriptions.push(panelProvider);

  // Register the sidebar tree view
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('darkhorse.gitPanel', panelProvider)
  );

  // Register all commands
  const commands = new GitCommands(context.secrets, panelProvider);
  commands.registerAll(context);
}

export function deactivate(): void {}
