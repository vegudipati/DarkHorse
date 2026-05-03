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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitCredentials = void 0;
const vscode = __importStar(require("vscode"));
const SECRET_KEY_GITHUB_PAT = 'darkhorse.githubPat';
const SECRET_KEY_GITHUB_USER = 'darkhorse.githubUsername';
class GitCredentials {
    secrets;
    constructor(secrets) {
        this.secrets = secrets;
    }
    // ---------------------------------------------------------------------------
    // PAT management
    // ---------------------------------------------------------------------------
    async savePat(pat, username) {
        await this.secrets.store(SECRET_KEY_GITHUB_PAT, pat);
        await this.secrets.store(SECRET_KEY_GITHUB_USER, username);
    }
    async getPat() {
        return this.secrets.get(SECRET_KEY_GITHUB_PAT);
    }
    async getUsername() {
        return this.secrets.get(SECRET_KEY_GITHUB_USER);
    }
    async deletePat() {
        await this.secrets.delete(SECRET_KEY_GITHUB_PAT);
        await this.secrets.delete(SECRET_KEY_GITHUB_USER);
    }
    async hasCredentials() {
        const pat = await this.getPat();
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
    async buildAuthenticatedUrl(httpsUrl) {
        const pat = await this.getPat();
        const username = await this.getUsername();
        if (!pat || !username) {
            throw new Error('GitHub credentials not configured. ' +
                'Use "DarkHorse: Set GitHub Credentials" to add your PAT.');
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
    async promptAndSave() {
        const username = await vscode.window.showInputBox({
            prompt: 'GitHub username',
            placeHolder: 'your-github-username',
            ignoreFocusOut: true
        });
        if (!username) {
            return false;
        }
        const pat = await vscode.window.showInputBox({
            prompt: 'GitHub Personal Access Token',
            placeHolder: 'ghp_...',
            password: true,
            ignoreFocusOut: true
        });
        if (!pat) {
            return false;
        }
        if (!pat.startsWith('ghp_') && !pat.startsWith('github_pat_')) {
            vscode.window.showWarningMessage('That does not look like a GitHub PAT (should start with ghp_ or github_pat_). ' +
                'Saved anyway — authentication will fail if the token is invalid.');
        }
        await this.savePat(pat, username);
        return true;
    }
}
exports.GitCredentials = GitCredentials;
//# sourceMappingURL=GitCredentials.js.map