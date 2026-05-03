/**
 * DarkHorse Git Extension — Command Handlers
 * 
 * All Git-related commands registered in the VS Code command palette.
 * Each command is a thin orchestration layer:
 *   1. Validate prerequisites
 *   2. Gather input (via QuickPick / InputBox)
 *   3. Delegate to GitService or AbapExporter
 *   4. Refresh the panel
 *   5. Show success/error notification
 */

'use strict';

import * as vscode from 'vscode';
import * as path   from 'path';
import * as fs     from 'fs';
import { GitService }      from '../GitService';
import { GitCredentials }  from '../GitCredentials';
import { AbapExporter }    from '../AbapExporter';
import { GitPanelProvider } from '../GitPanelProvider';

export class GitCommands {

  private gitService:   GitService | null = null;
  private repoRoot:     string | null     = null;
  private exporter:     AbapExporter;
  private credentials:  GitCredentials;
  private panelProvider: GitPanelProvider;

  constructor(
    secrets:       vscode.SecretStorage,
    panelProvider: GitPanelProvider
  ) {
    this.credentials   = new GitCredentials(secrets);
    this.exporter      = new AbapExporter();
    this.panelProvider = panelProvider;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  public registerAll(context: vscode.ExtensionContext): void {
    const cmds: Array<[string, (...args: unknown[]) => Promise<void>]> = [
      ['darkhorse.git.setCredentials',  () => this.setCredentials()],
      ['darkhorse.git.openRepo',        () => this.openRepo()],
      ['darkhorse.git.cloneRepo',       () => this.cloneRepo()],
      ['darkhorse.git.exportAndStage',  () => this.exportAndStage()],
      ['darkhorse.git.stageAll',        () => this.stageAll()],
      ['darkhorse.git.commit',          () => this.commitChanges()],
      ['darkhorse.git.push',            () => this.push()],
      ['darkhorse.git.pull',            () => this.pull()],
      ['darkhorse.git.newBranch',       () => this.newBranch()],
      ['darkhorse.git.switchBranch',    () => this.switchBranch()],
      ['darkhorse.git.refresh',         () => this.refresh()],
      ['darkhorse.git.openFile',        (filePath: unknown) => this.openFile(filePath as string)]
    ];

    for (const [cmd, handler] of cmds) {
      context.subscriptions.push(
        vscode.commands.registerCommand(cmd, handler.bind(this))
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /** Store GitHub username + PAT in SecretStorage */
  private async setCredentials(): Promise<void> {
    const saved = await this.credentials.promptAndSave();
    if (saved) {
      vscode.window.showInformationMessage('DarkHorse Git: GitHub credentials saved.');
    }
  }

  /** Let developer choose a local folder that is already a Git repo */
  private async openRepo(): Promise<void> {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles:       false,
      canSelectFolders:     true,
      canSelectMany:        false,
      openLabel:            'Open Client Repo',
      title:                'Select your local client ABAP Git repository'
    });

    if (!folders || folders.length === 0) { return; }

    const selectedPath = folders[0].fsPath;
    const isRepo = await GitService.isGitRepo(selectedPath);

    if (!isRepo) {
      const init = await vscode.window.showWarningMessage(
        `${selectedPath} is not a Git repository. Initialize it?`,
        'Initialize', 'Cancel'
      );
      if (init !== 'Initialize') { return; }
      this.gitService = await GitService.init(selectedPath);
    } else {
      this.gitService = new GitService(selectedPath);
    }

    this.repoRoot = selectedPath;
    this.panelProvider.setRepo(this.gitService);

    const status = await this.gitService.getStatus();
    vscode.window.showInformationMessage(
      `DarkHorse Git: Connected to repo at ${path.basename(selectedPath)} [${status.branch}]`
    );
  }

  /** Clone a remote repo — prompts for URL, lets developer choose target folder */
  private async cloneRepo(): Promise<void> {
    const hasCredentials = await this.credentials.hasCredentials();
    if (!hasCredentials) {
      const setup = await vscode.window.showWarningMessage(
        'GitHub credentials not set. Set them now?',
        'Set Credentials', 'Cancel'
      );
      if (setup !== 'Set Credentials') { return; }
      await this.setCredentials();
    }

    const repoUrl = await vscode.window.showInputBox({
      prompt:         'GitHub repository HTTPS URL',
      placeHolder:    'https://github.com/your-org/client-abap-repo.git',
      ignoreFocusOut: true,
      validateInput:  (v) => v.startsWith('https://') ? null : 'Must be an HTTPS URL'
    });
    if (!repoUrl) { return; }

    const targetFolders = await vscode.window.showOpenDialog({
      canSelectFiles:   false,
      canSelectFolders: true,
      canSelectMany:    false,
      openLabel:        'Clone Here',
      title:            'Select parent folder for the cloned repository'
    });
    if (!targetFolders || targetFolders.length === 0) { return; }

    const targetDir = path.join(
      targetFolders[0].fsPath,
      path.basename(repoUrl, '.git')
    );

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Cloning repository…', cancellable: false },
      async () => {
        try {
          const authUrl = await this.credentials.buildAuthenticatedUrl(repoUrl);
          this.gitService = await GitService.clone(authUrl, targetDir);
          this.repoRoot   = targetDir;
          this.panelProvider.setRepo(this.gitService);
          vscode.window.showInformationMessage(
            `DarkHorse Git: Cloned to ${targetDir}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`DarkHorse Git: Clone failed — ${msg}`);
        }
      }
    );
  }

  /** Export the active ABAP editor file to the client repo and stage it */
  private async exportAndStage(): Promise<void> {
    if (!this.requireRepo()) { return; }

    // Optional: ask for package and transport for metadata
    const transportNo = await vscode.window.showInputBox({
      prompt:         'Transport request number (optional)',
      placeHolder:    'Leave blank to skip',
      ignoreFocusOut: false
    });

    try {
      const result = await this.exporter.exportActiveEditor(
        this.repoRoot!,
        { transportNo: transportNo || undefined }
      );

      // Stage the exported file and its metadata companion
      const metaRelative = result.relativePath.replace('.abap', '.json');
      const filesToStage = [result.relativePath];
      if (fs.existsSync(path.join(this.repoRoot!, metaRelative))) {
        filesToStage.push(metaRelative);
      }

      await this.gitService!.stage(filesToStage);
      this.panelProvider.refresh();

      vscode.window.showInformationMessage(
        `DarkHorse Git: Exported and staged ${result.objectName} → ${result.relativePath}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DarkHorse Git: Export failed — ${msg}`);
    }
  }

  /** Stage all changed files */
  private async stageAll(): Promise<void> {
    if (!this.requireRepo()) { return; }

    try {
      await this.gitService!.stageAll();
      this.panelProvider.refresh();
      vscode.window.showInformationMessage('DarkHorse Git: All changes staged.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DarkHorse Git: Stage failed — ${msg}`);
    }
  }

  /** Commit staged changes */
  private async commitChanges(): Promise<void> {
    if (!this.requireRepo()) { return; }

    const status = await this.gitService!.getStatus();
    if (status.staged.length === 0) {
      vscode.window.showWarningMessage(
        'DarkHorse Git: No staged changes. Stage files first using "Export & Stage" or "Stage All".'
      );
      return;
    }

    const message = await vscode.window.showInputBox({
      prompt:         `Commit message (${status.staged.length} file(s) staged)`,
      placeHolder:    'feat: add ZMYREPORT report for open orders',
      ignoreFocusOut: true,
      validateInput:  (v) => v.trim().length > 0 ? null : 'Commit message cannot be empty'
    });
    if (!message) { return; }

    try {
      const hash = await this.gitService!.commit(message);
      this.panelProvider.refresh();
      vscode.window.showInformationMessage(`DarkHorse Git: Committed ${hash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DarkHorse Git: Commit failed — ${msg}`);
    }
  }

  /** Push current branch to origin */
  private async push(): Promise<void> {
    if (!this.requireRepo()) { return; }

    const hasCredentials = await this.credentials.hasCredentials();
    if (!hasCredentials) {
      vscode.window.showErrorMessage(
        'DarkHorse Git: GitHub credentials not set. Use "DarkHorse: Set GitHub Credentials".'
      );
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Pushing to GitHub…', cancellable: false },
      async () => {
        try {
          await this.gitService!.push();
          this.panelProvider.refresh();
          vscode.window.showInformationMessage('DarkHorse Git: Push successful.');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`DarkHorse Git: Push failed — ${msg}`);
        }
      }
    );
  }

  /** Pull latest from origin */
  private async pull(): Promise<void> {
    if (!this.requireRepo()) { return; }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Pulling from GitHub…', cancellable: false },
      async () => {
        try {
          await this.gitService!.pull();
          this.panelProvider.refresh();
          vscode.window.showInformationMessage('DarkHorse Git: Pull successful.');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`DarkHorse Git: Pull failed — ${msg}`);
        }
      }
    );
  }

  /** Create a new branch */
  private async newBranch(): Promise<void> {
    if (!this.requireRepo()) { return; }

    const name = await vscode.window.showInputBox({
      prompt:         'New branch name',
      placeHolder:    'feature/my-abap-change',
      ignoreFocusOut: true,
      validateInput:  (v) => v.trim().length > 0 ? null : 'Branch name cannot be empty'
    });
    if (!name) { return; }

    try {
      await this.gitService!.createBranch(name);
      this.panelProvider.refresh();
      vscode.window.showInformationMessage(`DarkHorse Git: Created and switched to branch "${name}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DarkHorse Git: Create branch failed — ${msg}`);
    }
  }

  /** Switch to an existing branch via QuickPick */
  private async switchBranch(): Promise<void> {
    if (!this.requireRepo()) { return; }

    const { all, current } = await this.gitService!.listBranches();
    const others = all.filter((b: string) => b !== current);

    if (others.length === 0) {
      vscode.window.showInformationMessage('DarkHorse Git: No other branches to switch to.');
      return;
    }

    const selected = await vscode.window.showQuickPick(others, {
      placeHolder: `Current branch: ${current}. Select branch to switch to.`
    });
    if (!selected) { return; }

    try {
      await this.gitService!.switchBranch(selected);
      this.panelProvider.refresh();
      vscode.window.showInformationMessage(`DarkHorse Git: Switched to branch "${selected}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`DarkHorse Git: Switch branch failed — ${msg}`);
    }
  }

  /** Refresh the panel manually */
  private async refresh(): Promise<void> {
    this.panelProvider.refresh();
  }

  /** Open a changed file in the editor */
  private async openFile(filePath: string): Promise<void> {
    if (!this.repoRoot || !filePath) { return; }
    const fullPath = path.join(this.repoRoot, filePath);
    if (!fs.existsSync(fullPath)) { return; }
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc);
  }

  // ---------------------------------------------------------------------------
  // Guard
  // ---------------------------------------------------------------------------

  private requireRepo(): boolean {
    if (!this.gitService || !this.repoRoot) {
      vscode.window.showWarningMessage(
        'DarkHorse Git: No repository connected. Use "Open Client Repo" or "Clone Repository" first.'
      );
      return false;
    }
    return true;
  }
}
