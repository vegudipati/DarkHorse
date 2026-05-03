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
export interface CommitInfo {
    hash: string;
    date: string;
    message: string;
    author: string;
}
export interface RepoStatus {
    branch: string;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    isClean: boolean;
}
export declare class GitService {
    private git;
    private repoPath;
    constructor(repoPath: string);
    /**
     * Clone a remote repository into a local directory.
     * @param remoteUrl  GitHub HTTPS URL — PAT embedded by GitCredentials before calling
     * @param targetDir  Local directory to clone into
     */
    static clone(remoteUrl: string, targetDir: string): Promise<GitService>;
    /**
     * Initialize a new Git repo in an existing directory.
     */
    static init(dirPath: string): Promise<GitService>;
    /**
     * Verify the repoPath is actually a Git repository.
     * Throws if it is not.
     */
    verifyRepo(): Promise<void>;
    getStatus(): Promise<RepoStatus>;
    /**
     * Stage specific files.
     * @param files  Array of file paths relative to repo root
     */
    stage(files: string[]): Promise<void>;
    /**
     * Stage all changed files.
     */
    stageAll(): Promise<void>;
    /**
     * Commit staged files.
     * @param message  Commit message — validated to be non-empty
     */
    commit(message: string): Promise<string>;
    /**
     * Push current branch to remote.
     * @param remote  Remote name — defaults to 'origin'
     * @param branch  Branch name — defaults to current branch
     */
    push(remote?: string, branch?: string): Promise<void>;
    /**
     * Push and set upstream for new branches.
     */
    pushSetUpstream(remote: string | undefined, branch: string): Promise<void>;
    /**
     * Pull latest changes from remote.
     */
    pull(remote?: string, branch?: string): Promise<void>;
    /**
     * Fetch without merging — updates remote tracking branches.
     */
    fetch(): Promise<void>;
    /**
     * List all local branches.
     * Returns branch names and which one is current.
     */
    listBranches(): Promise<{
        all: string[];
        current: string;
    }>;
    /**
     * Create a new branch from the current HEAD.
     */
    createBranch(name: string): Promise<void>;
    /**
     * Switch to an existing branch.
     */
    switchBranch(name: string): Promise<void>;
    /**
     * Delete a local branch.
     * Requires the branch to be fully merged (-d, not -D).
     */
    deleteBranch(name: string): Promise<void>;
    /**
     * Get recent commit history.
     * @param maxCount  Number of commits to return — defaults to 20
     */
    getLog(maxCount?: number): Promise<CommitInfo[]>;
    /**
     * Add a remote origin — used when initializing a fresh repo.
     */
    addRemote(name: string, url: string): Promise<void>;
    /**
     * List configured remotes.
     */
    listRemotes(): Promise<Array<{
        name: string;
        refs: {
            fetch: string;
            push: string;
        };
    }>>;
    /**
     * Get the diff of a specific file against HEAD.
     * Used to show what changed before staging.
     */
    diffFile(filePath: string): Promise<string>;
    getRepoPath(): string;
    /**
     * Check if a directory contains a valid Git repo without throwing.
     */
    static isGitRepo(dirPath: string): Promise<boolean>;
}
