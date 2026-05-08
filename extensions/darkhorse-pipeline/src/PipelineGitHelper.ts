import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineStateManager } from './PipelineStateManager';

export class PipelineGitHelper {

  /**
   * Commit FDS document to Git after approval.
   */
  public static async commitFds(
    stateManager: PipelineStateManager
  ): Promise<void> {
    const state = stateManager.getState();
    if (!state?.fdsFilePath) {
      return;
    }

    await PipelineGitHelper.commitFile(
      state.fdsFilePath,
      `docs: Add FDS for ${state.title} v1.0`,
      'FDS'
    );
  }

  /**
   * Commit TDS document to Git after approval.
   */
  public static async commitTds(
    stateManager: PipelineStateManager
  ): Promise<void> {
    const state = stateManager.getState();
    if (!state?.tdsFilePath) {
      return;
    }

    await PipelineGitHelper.commitFile(
      state.tdsFilePath,
      `docs: Add TDS for ${state.title} v1.0`,
      'TDS'
    );
  }

  /**
   * Commit generated ABAP code file to Git.
   */
  public static async commitCode(
    filePath: string,
    objectName: string,
    stateManager: PipelineStateManager
  ): Promise<void> {
    const state = stateManager.getState();
    await PipelineGitHelper.commitFile(
      filePath,
      `feat: Add generated ABAP ${objectName} from pipeline`,
      'Code'
    );
  }

  /**
   * Core commit function — stages a file and commits to Git.
   * Uses simple-git if available, falls back to VS Code Git API.
   */
  private static async commitFile(
    filePath: string,
    commitMessage: string,
    docType: string
  ): Promise<void> {

    // Ask developer if they want to commit
    const action = await vscode.window.showInformationMessage(
      `DarkHorse: ${docType} ready. Commit to Git?`,
      'Commit', 'Skip'
    );

    if (action !== 'Commit') {
      return;
    }

    try {
      // Try using VS Code's built-in Git extension
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (gitExtension && gitExtension.isActive) {
        const git = gitExtension.exports.getAPI(1);
        const repos = git.repositories;

        if (repos.length === 0) {
          vscode.window.showWarningMessage(
            'DarkHorse: No Git repository found. Open your project repo in VS Code first.'
          );
          return;
        }

        const repo = repos[0];
        await repo.add([filePath]);
        await repo.commit(commitMessage);

        vscode.window.showInformationMessage(
          `DarkHorse: ${docType} committed — "${commitMessage}"`
        );
        return;
      }

      // Fallback: use simple-git
      await PipelineGitHelper.commitWithSimpleGit(filePath, commitMessage);
      vscode.window.showInformationMessage(
        `DarkHorse: ${docType} committed — "${commitMessage}"`
      );

    } catch (err: any) {
      vscode.window.showWarningMessage(
        `DarkHorse: Git commit failed — ${err.message}. ` +
        'You can commit manually using the Source Control panel.'
      );
    }
  }

  private static async commitWithSimpleGit(
    filePath: string,
    commitMessage: string
  ): Promise<void> {
    const simpleGit = require('simple-git');
    const repoPath = path.dirname(filePath);

    // Walk up to find .git folder
    const git = simpleGit(repoPath);
    await git.add(filePath);
    await git.commit(commitMessage);
  }

  /**
   * Save generated ABAP code to a .abap file in the output folder.
   * Returns the file path.
   */
  public static async saveCodeToFile(
    objectName: string,
    objectType: string,
    code: string,
    outputFolder: string
  ): Promise<string> {
    const fs = require('fs');
    const fileName = `${objectType}_${objectName}.abap`;
    const filePath = path.join(outputFolder, fileName);
    fs.writeFileSync(filePath, code, 'utf8');
    return filePath;
  }
}