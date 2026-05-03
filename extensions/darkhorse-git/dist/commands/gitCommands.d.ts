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
import * as vscode from 'vscode';
import { GitPanelProvider } from '../GitPanelProvider';
export declare class GitCommands {
    private gitService;
    private repoRoot;
    private exporter;
    private credentials;
    private panelProvider;
    constructor(secrets: vscode.SecretStorage, panelProvider: GitPanelProvider);
    registerAll(context: vscode.ExtensionContext): void;
    /** Store GitHub username + PAT in SecretStorage */
    private setCredentials;
    /** Let developer choose a local folder that is already a Git repo */
    private openRepo;
    /** Clone a remote repo — prompts for URL, lets developer choose target folder */
    private cloneRepo;
    /** Export the active ABAP editor file to the client repo and stage it */
    private exportAndStage;
    /** Stage all changed files */
    private stageAll;
    /** Commit staged changes */
    private commitChanges;
    /** Push current branch to origin */
    private push;
    /** Pull latest from origin */
    private pull;
    /** Create a new branch */
    private newBranch;
    /** Switch to an existing branch via QuickPick */
    private switchBranch;
    /** Refresh the panel manually */
    private refresh;
    /** Open a changed file in the editor */
    private openFile;
    private requireRepo;
}
