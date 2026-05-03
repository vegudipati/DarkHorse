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

import simpleGit, { SimpleGit, SimpleGitOptions, StatusResult, LogResult } from 'simple-git';
import * as path from 'path';
import * as fs   from 'fs';

export interface CommitInfo {
  hash:    string;
  date:    string;
  message: string;
  author:  string;
}

export interface RepoStatus {
  branch:         string;
  staged:         string[];
  unstaged:       string[];
  untracked:      string[];
  ahead:          number;
  behind:         number;
  isClean:        boolean;
}

export class GitService {

  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;

    const options: Partial<SimpleGitOptions> = {
      baseDir:  repoPath,
      binary:   'git',
      maxConcurrentProcesses: 2,
      trimmed: false
    };

    this.git = simpleGit(options);
  }

  // ---------------------------------------------------------------------------
  // Repository setup
  // ---------------------------------------------------------------------------

  /**
   * Clone a remote repository into a local directory.
   * @param remoteUrl  GitHub HTTPS URL — PAT embedded by GitCredentials before calling
   * @param targetDir  Local directory to clone into
   */
  static async clone(remoteUrl: string, targetDir: string): Promise<GitService> {
    const git = simpleGit();
    await git.clone(remoteUrl, targetDir);
    return new GitService(targetDir);
  }

  /**
   * Initialize a new Git repo in an existing directory.
   */
  static async init(dirPath: string): Promise<GitService> {
    const git = simpleGit(dirPath);
    await git.init();
    return new GitService(dirPath);
  }

  /**
   * Verify the repoPath is actually a Git repository.
   * Throws if it is not.
   */
  public async verifyRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw new Error(
        `${this.repoPath} is not a Git repository. ` +
        'Use "Clone Repository" or "Initialize Repository" first.'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  public async getStatus(): Promise<RepoStatus> {
    const status: StatusResult = await this.git.status();

    return {
      branch:    status.current || 'unknown',
      staged:    status.staged,
      unstaged:  [...status.modified, ...status.deleted].filter(f => !status.staged.includes(f)),
      untracked: status.not_added,
      ahead:     status.ahead,
      behind:    status.behind,
      isClean:   status.isClean()
    };
  }

  // ---------------------------------------------------------------------------
  // Stage & Commit
  // ---------------------------------------------------------------------------

  /**
   * Stage specific files.
   * @param files  Array of file paths relative to repo root
   */
  public async stage(files: string[]): Promise<void> {
    if (files.length === 0) {
      throw new Error('No files specified to stage.');
    }
    await this.git.add(files);
  }

  /**
   * Stage all changed files.
   */
  public async stageAll(): Promise<void> {
    await this.git.add('.');
  }

  /**
   * Commit staged files.
   * @param message  Commit message — validated to be non-empty
   */
  public async commit(message: string): Promise<string> {
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
  public async push(remote: string = 'origin', branch?: string): Promise<void> {
    const status   = await this.git.status();
    const target   = branch || status.current || 'main';

    await this.git.push(remote, target);
  }

  /**
   * Push and set upstream for new branches.
   */
  public async pushSetUpstream(remote: string = 'origin', branch: string): Promise<void> {
    await this.git.push(['-u', remote, branch]);
  }

  /**
   * Pull latest changes from remote.
   */
  public async pull(remote: string = 'origin', branch?: string): Promise<void> {
    const status = await this.git.status();
    const target = branch || status.current || 'main';
    await this.git.pull(remote, target);
  }

  /**
   * Fetch without merging — updates remote tracking branches.
   */
  public async fetch(): Promise<void> {
    await this.git.fetch();
  }

  // ---------------------------------------------------------------------------
  // Branch operations
  // ---------------------------------------------------------------------------

  /**
   * List all local branches.
   * Returns branch names and which one is current.
   */
  public async listBranches(): Promise<{ all: string[]; current: string }> {
    const result = await this.git.branchLocal();
    return {
      all:     result.all,
      current: result.current
    };
  }

  /**
   * Create a new branch from the current HEAD.
   */
  public async createBranch(name: string): Promise<void> {
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
  public async switchBranch(name: string): Promise<void> {
    await this.git.checkout(name);
  }

  /**
   * Delete a local branch.
   * Requires the branch to be fully merged (-d, not -D).
   */
  public async deleteBranch(name: string): Promise<void> {
    await this.git.deleteLocalBranch(name);
  }

  // ---------------------------------------------------------------------------
  // Log
  // ---------------------------------------------------------------------------

  /**
   * Get recent commit history.
   * @param maxCount  Number of commits to return — defaults to 20
   */
  public async getLog(maxCount: number = 20): Promise<CommitInfo[]> {
    const result: LogResult = await this.git.log({ maxCount });

    return result.all.map(entry => ({
      hash:    entry.hash.slice(0, 8),
      date:    entry.date,
      message: entry.message,
      author:  entry.author_name
    }));
  }

  // ---------------------------------------------------------------------------
  // Remote management
  // ---------------------------------------------------------------------------

  /**
   * Add a remote origin — used when initializing a fresh repo.
   */
  public async addRemote(name: string, url: string): Promise<void> {
    await this.git.addRemote(name, url);
  }

  /**
   * List configured remotes.
   */
  public async listRemotes(): Promise<Array<{ name: string; refs: { fetch: string; push: string } }>> {
    return this.git.getRemotes(true);
  }

  // ---------------------------------------------------------------------------
  // Diff
  // ---------------------------------------------------------------------------

  /**
   * Get the diff of a specific file against HEAD.
   * Used to show what changed before staging.
   */
  public async diffFile(filePath: string): Promise<string> {
    return this.git.diff([filePath]);
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  public getRepoPath(): string {
    return this.repoPath;
  }

  /**
   * Check if a directory contains a valid Git repo without throwing.
   */
  static async isGitRepo(dirPath: string): Promise<boolean> {
    if (!fs.existsSync(dirPath)) { return false; }
    try {
      const git = simpleGit(dirPath);
      return await git.checkIsRepo();
    } catch {
      return false;
    }
  }
}
