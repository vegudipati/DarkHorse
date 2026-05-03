/**
 * DarkHorse Git Extension — Git Credentials
 *
 * Stores and retrieves GitHub Personal Access Token (PAT)
 * via VS Code SecretStorage (no native modules — no keytar).
 *
 * The PAT is embedded into HTTPS clone/push URLs at runtime:
 *   https://<PAT>@github.com/org/repo.git
 *
 * The PAT is NEVER:
 *   - Written to disk
 *   - Logged
 *   - Stored in Git config
 *   - Visible in the URL bar (URLs are constructed in memory only)
 *
 * Upgrade in CPI-1:
 *   - Replace PAT with GitHub OAuth App flow
 *   - Support GitHub Enterprise Server URLs
 */
import * as vscode from 'vscode';
export declare class GitCredentials {
    private readonly secrets;
    constructor(secrets: vscode.SecretStorage);
    savePat(pat: string, username: string): Promise<void>;
    getPat(): Promise<string | undefined>;
    getUsername(): Promise<string | undefined>;
    deletePat(): Promise<void>;
    hasCredentials(): Promise<boolean>;
    /**
     * Embed PAT into a GitHub HTTPS URL for authenticated operations.
     * Input:  https://github.com/org/repo.git
     * Output: https://<username>:<PAT>@github.com/org/repo.git
     *
     * The returned URL is used transiently for clone/push/pull.
     * It is never stored or logged.
     */
    buildAuthenticatedUrl(httpsUrl: string): Promise<string>;
    /**
     * Prompt the developer to enter GitHub credentials via VS Code input boxes.
     * Called from the "Set GitHub Credentials" command.
     */
    promptAndSave(): Promise<boolean>;
}
