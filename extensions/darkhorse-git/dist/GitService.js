/**
 * DarkHorse Git Extension — Git Service
 *
 * Thin wrapper around simple-git for all Git operations.
 * All methods are async and throw descriptive errors on failure.
 *
 * Scope:
 *   - Clone, init, status, stage, commit, push, pull, fetch
 *   - Branch create, switch, list
 *   - Log (recent commits)
 *
 * This service knows nothing about SAP — it operates purely on
 * the local file system. SAP export is handled by AbapExporter.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const simple_git_1 = __importDefault(require("simple-git"));
const fs = __importStar(require("fs"));
class GitService {
    git;
    repoPath;
    constructor(repoPath) {
        this.repoPath = repoPath;
        const options = {
            baseDir: repoPath,
            binary: 'git',
            maxConcurrentProcesses: 2,
            trimmed: false
        };
        this.git = (0, simple_git_1.default)(options);
    }
    // ---------------------------------------------------------------------------
    // Repository setup
    // ---------------------------------------------------------------------------
    /**
     * Clone a remote repository into a local directory.
     * @param remoteUrl  GitHub HTTPS URL — PAT embedded by GitCredentials before calling
     * @param targetDir  Local directory to clone into
     */
    static async clone(remoteUrl, targetDir) {
        const git = (0, simple_git_1.default)();
        await git.clone(remoteUrl, targetDir);
        return new GitService(targetDir);
    }
    /**
     * Initialize a new Git repo in an existing directory.
     */
    static async init(dirPath) {
        const git = (0, simple_git_1.default)(dirPath);
        await git.init();
        return new GitService(dirPath);
    }
    /**
     * Verify the repoPath is actually a Git repository.
     * Throws if it is not.
     */
    async verifyRepo() {
        const isRepo = await this.git.checkIsRepo();
        if (!isRepo) {
            throw new Error(`${this.repoPath} is not a Git repository. ` +
                'Use "Clone Repository" or "Initialize Repository" first.');
        }
    }
    // ---------------------------------------------------------------------------
    // Status
    // ---------------------------------------------------------------------------
    async getStatus() {
        const status = await this.git.status();
        return {
            branch: status.current || 'unknown',
            staged: status.staged,
            unstaged: [...status.modified, ...status.deleted].filter(f => !status.staged.includes(f)),
            untracked: status.not_added,
            ahead: status.ahead,
            behind: status.behind,
            isClean: status.isClean()
        };
    }
    // ---------------------------------------------------------------------------
    // Stage & Commit
    // ---------------------------------------------------------------------------
    /**
     * Stage specific files.
     * @param files  Array of file paths relative to repo root
     */
    async stage(files) {
        if (files.length === 0) {
            throw new Error('No files specified to stage.');
        }
        await this.git.add(files);
    }
    /**
     * Stage all changed files.
     */
    async stageAll() {
        await this.git.add('.');
    }
    /**
     * Commit staged files.
     * @param message  Commit message — validated to be non-empty
     */
    async commit(message) {
        if (!message || message.trim().length === 0) {
            throw new Error('Commit message cannot be empty.');
        }
        if (message.length > 72) {
            // Warn but don't block — just a convention
            console.warn('[GitService] Commit message exceeds 72 characters. Consider shortening.');
        }
        const result = await this.git.commit(message.trim());
        return result.commit;
    }
    // ---------------------------------------------------------------------------
    // Push & Pull
    // ---------------------------------------------------------------------------
    /**
     * Push current branch to remote.
     * @param remote  Remote name — defaults to 'origin'
     * @param branch  Branch name — defaults to current branch
     */
    async push(remote = 'origin', branch) {
        const status = await this.git.status();
        const target = branch || status.current || 'main';
        await this.git.push(remote, target);
    }
    /**
     * Push and set upstream for new branches.
     */
    async pushSetUpstream(remote = 'origin', branch) {
        await this.git.push(['-u', remote, branch]);
    }
    /**
     * Pull latest changes from remote.
     */
    async pull(remote = 'origin', branch) {
        const status = await this.git.status();
        const target = branch || status.current || 'main';
        await this.git.pull(remote, target);
    }
    /**
     * Fetch without merging — updates remote tracking branches.
     */
    async fetch() {
        await this.git.fetch();
    }
    // ---------------------------------------------------------------------------
    // Branch operations
    // ---------------------------------------------------------------------------
    /**
     * List all local branches.
     * Returns branch names and which one is current.
     */
    async listBranches() {
        const result = await this.git.branchLocal();
        return {
            all: result.all,
            current: result.current
        };
    }
    /**
     * Create a new branch from the current HEAD.
     */
    async createBranch(name) {
        if (!name || name.trim().length === 0) {
            throw new Error('Branch name cannot be empty.');
        }
        // Sanitize: replace spaces with hyphens, remove invalid chars
        const safeName = name.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '');
        await this.git.checkoutLocalBranch(safeName);
    }
    /**
     * Switch to an existing branch.
     */
    async switchBranch(name) {
        await this.git.checkout(name);
    }
    /**
     * Delete a local branch.
     * Requires the branch to be fully merged (-d, not -D).
     */
    async deleteBranch(name) {
        await this.git.deleteLocalBranch(name);
    }
    // ---------------------------------------------------------------------------
    // Log
    // ---------------------------------------------------------------------------
    /**
     * Get recent commit history.
     * @param maxCount  Number of commits to return — defaults to 20
     */
    async getLog(maxCount = 20) {
        const result = await this.git.log({ maxCount });
        return result.all.map(entry => ({
            hash: entry.hash.slice(0, 8),
            date: entry.date,
            message: entry.message,
            author: entry.author_name
        }));
    }
    // ---------------------------------------------------------------------------
    // Remote management
    // ---------------------------------------------------------------------------
    /**
     * Add a remote origin — used when initializing a fresh repo.
     */
    async addRemote(name, url) {
        await this.git.addRemote(name, url);
    }
    /**
     * List configured remotes.
     */
    async listRemotes() {
        return this.git.getRemotes(true);
    }
    // ---------------------------------------------------------------------------
    // Diff
    // ---------------------------------------------------------------------------
    /**
     * Get the diff of a specific file against HEAD.
     * Used to show what changed before staging.
     */
    async diffFile(filePath) {
        return this.git.diff([filePath]);
    }
    // ---------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------
    getRepoPath() {
        return this.repoPath;
    }
    /**
     * Check if a directory contains a valid Git repo without throwing.
     */
    static async isGitRepo(dirPath) {
        if (!fs.existsSync(dirPath)) {
            return false;
        }
        try {
            const git = (0, simple_git_1.default)(dirPath);
            return await git.checkIsRepo();
        }
        catch {
            return false;
        }
    }
}
exports.GitService = GitService;
//# sourceMappingURL=GitService.js.map