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

'use strict';

import * as vscode from 'vscode';

const SECRET_KEY_GITHUB_PAT = 'darkhorse.githubPat';
const SECRET_KEY_GITHUB_USER = 'darkhorse.githubUsername';

export class GitCredentials {

  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ---------------------------------------------------------------------------
  // PAT management
  // ---------------------------------------------------------------------------

  public async savePat(pat: string, username: string): Promise<void> {
    await this.secrets.store(SECRET_KEY_GITHUB_PAT,  pat);
    await this.secrets.store(SECRET_KEY_GITHUB_USER, username);
  }

  public async getPat(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_GITHUB_PAT);
  }

  public async getUsername(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY_GITHUB_USER);
  }

  public async deletePat(): Promise<void> {
    await this.secrets.delete(SECRET_KEY_GITHUB_PAT);
    await this.secrets.delete(SECRET_KEY_GITHUB_USER);
  }

  public async hasCredentials(): Promise<boolean> {
    const pat  = await this.getPat();
    const user = await this.getUsername();
    return !!pat && !!user;
  }

  // ---------------------------------------------------------------------------
  // URL construction
  // ---------------------------------------------------------------------------

  /**
   * Embed PAT into a GitHub HTTPS URL for authenticated operations.
   * Input:  https://github.com/org/repo.git
   * Output: https://<username>:<PAT>@github.com/org/repo.git
   * 
   * The returned URL is used transiently for clone/push/pull.
   * It is never stored or logged.
   */
  public async buildAuthenticatedUrl(httpsUrl: string): Promise<string> {
    const pat      = await this.getPat();
    const username = await this.getUsername();

    if (!pat || !username) {
      throw new Error(
        'GitHub credentials not configured. ' +
        'Use "DarkHorse: Set GitHub Credentials" to add your PAT.'
      );
    }

    // Strip any existing auth from the URL before embedding new credentials
    const url = new URL(httpsUrl);
    url.username = encodeURIComponent(username);
    url.password = encodeURIComponent(pat);

    return url.toString();
  }

  // ---------------------------------------------------------------------------
  // Interactive credential setup
  // ---------------------------------------------------------------------------

  /**
   * Prompt the developer to enter GitHub credentials via VS Code input boxes.
   * Called from the "Set GitHub Credentials" command.
   */
  public async promptAndSave(): Promise<boolean> {
    const username = await vscode.window.showInputBox({
      prompt:         'GitHub username',
      placeHolder:    'your-github-username',
      ignoreFocusOut: true
    });
    if (!username) { return false; }

    const pat = await vscode.window.showInputBox({
      prompt:         'GitHub Personal Access Token',
      placeHolder:    'ghp_...',
      password:       true,
      ignoreFocusOut: true
    });
    if (!pat) { return false; }

    if (!pat.startsWith('ghp_') && !pat.startsWith('github_pat_')) {
      vscode.window.showWarningMessage(
        'That does not look like a GitHub PAT (should start with ghp_ or github_pat_). ' +
        'Saved anyway — authentication will fail if the token is invalid.'
      );
    }

    await this.savePat(pat, username);
    return true;
  }
}
