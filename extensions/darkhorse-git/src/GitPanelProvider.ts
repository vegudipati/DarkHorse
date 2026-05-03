/**
 * DarkHorse Git Extension — Git Panel Provider
 * 
 * VS Code TreeDataProvider for the DarkHorse ABAP Git sidebar panel.
 * Shows: current branch, changed files, recent commits.
 * 
 * This panel is SAP-aware — it knows about .abap files and shows
 * the SAP object name/type alongside the file path.
 * 
 * Tree structure:
 * 
 *   📁 ABAP Git  [branch: feature/my-fix]
 *   ├── 📂 Changed Files (3)
 *   │   ├── [M] ZMYREPORT.prog.abap        (PROG)
 *   │   ├── [M] ZCL_MYCLASS.clas.abap      (CLAS)
 *   │   └── [?] ZNEW_PROG.prog.abap        (untracked)
 *   └── 📂 Recent Commits
 *       ├── a1b2c3d4  feat: add MARA select  (2h ago)
 *       └── e5f6g7h8  fix: null check        (yesterday)
 */

'use strict';

import * as vscode from 'vscode';
import * as path   from 'path';
import { GitService, RepoStatus, CommitInfo } from './GitService';

type GitTreeItem = ChangedFileItem | CommitItem | SectionItem | EmptyItem;

export class GitPanelProvider
  implements vscode.TreeDataProvider<GitTreeItem>, vscode.Disposable {

  private _onDidChangeTreeData = new vscode.EventEmitter<GitTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private gitService: GitService | null = null;
  private status: RepoStatus | null     = null;
  private commits: CommitInfo[]         = [];
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Auto-refresh every 30 seconds if a repo is connected
    const interval = setInterval(() => {
      if (this.gitService) { this.refresh(); }
    }, 30_000);

    this.disposables.push({ dispose: () => clearInterval(interval) });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Connect the panel to a Git repo.
   */
  public setRepo(gitService: GitService): void {
    this.gitService = gitService;
    this.refresh();
  }

  /**
   * Disconnect — show empty state.
   */
  public clearRepo(): void {
    this.gitService = null;
    this.status     = null;
    this.commits    = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Trigger a tree refresh — fetches latest status and commits.
   */
  public refresh(): void {
    this.loadData().then(() => {
      this._onDidChangeTreeData.fire(undefined);
    }).catch(() => {
      // Silent — don't crash the panel on a transient git error
    });
  }

  // ---------------------------------------------------------------------------
  // TreeDataProvider implementation
  // ---------------------------------------------------------------------------

  getTreeItem(element: GitTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GitTreeItem): Promise<GitTreeItem[]> {
    if (!this.gitService) {
      return [new EmptyItem('No repo connected. Use "Open Client Repo" to connect.')];
    }

    if (!element) {
      // Root level: sections
      return this.getRootItems();
    }

    if (element instanceof SectionItem) {
      if (element.sectionId === 'changed') {
        return this.getChangedFileItems();
      }
      if (element.sectionId === 'commits') {
        return this.getCommitItems();
      }
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Tree item builders
  // ---------------------------------------------------------------------------

  private getRootItems(): GitTreeItem[] {
    if (!this.status) {
      return [new EmptyItem('Loading…')];
    }

    const changedCount =
      this.status.staged.length +
      this.status.unstaged.length +
      this.status.untracked.length;

    const changedLabel = changedCount > 0
      ? `Changed Files (${changedCount})`
      : 'Changed Files';

    return [
      new SectionItem(
        'changed',
        changedLabel,
        `Branch: ${this.status.branch}`,
        changedCount > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      ),
      new SectionItem(
        'commits',
        'Recent Commits',
        undefined,
        vscode.TreeItemCollapsibleState.Collapsed
      )
    ];
  }

  private getChangedFileItems(): GitTreeItem[] {
    if (!this.status) { return []; }

    const items: ChangedFileItem[] = [];

    for (const f of this.status.staged) {
      items.push(new ChangedFileItem(f, 'staged'));
    }
    for (const f of this.status.unstaged) {
      if (!this.status.staged.includes(f)) {
        items.push(new ChangedFileItem(f, 'modified'));
      }
    }
    for (const f of this.status.untracked) {
      items.push(new ChangedFileItem(f, 'untracked'));
    }

    if (items.length === 0) {
      return [new EmptyItem('No changes — working tree clean.')];
    }

    return items;
  }

  private getCommitItems(): GitTreeItem[] {
    if (this.commits.length === 0) {
      return [new EmptyItem('No commits yet.')];
    }
    return this.commits.map(c => new CommitItem(c));
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  private async loadData(): Promise<void> {
    if (!this.gitService) { return; }

    try {
      this.status  = await this.gitService.getStatus();
      this.commits = await this.gitService.getLog(15);
    } catch {
      // Swallow — panel shows stale data rather than crashing
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Tree item classes
// ---------------------------------------------------------------------------

class SectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: string,
    label: string,
    description?: string,
    collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = `gitSection_${sectionId}`;
  }
}

class ChangedFileItem extends vscode.TreeItem {

  private static readonly STATUS_ICONS: Record<string, string> = {
    staged:    '$(check)',
    modified:  '$(edit)',
    untracked: '$(question)'
  };

  private static readonly STATUS_COLORS: Record<string, vscode.ThemeColor> = {
    staged:    new vscode.ThemeColor('gitDecoration.stagedModifiedResourceForeground'),
    modified:  new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
    untracked: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
  };

  constructor(
    public readonly filePath: string,
    public readonly fileStatus: 'staged' | 'modified' | 'untracked'
  ) {
    super(
      ChangedFileItem.getLabel(filePath),
      vscode.TreeItemCollapsibleState.None
    );

    this.description  = ChangedFileItem.getObjectType(filePath);
    this.tooltip      = filePath;
    this.iconPath     = new vscode.ThemeIcon(
      ChangedFileItem.STATUS_ICONS[fileStatus]?.replace('$(', '').replace(')', '') || 'file',
      ChangedFileItem.STATUS_COLORS[fileStatus]
    );
    this.contextValue = `gitFile_${fileStatus}`;

    // Click opens the file if it exists locally
    this.command = {
      command:   'darkhorse.git.openFile',
      title:     'Open File',
      arguments: [filePath]
    };
  }

  private static getLabel(filePath: string): string {
    return path.basename(filePath);
  }

  private static getObjectType(filePath: string): string {
    const base = path.basename(filePath, '.abap');
    const parts = base.split('.');
    if (parts.length >= 2) {
      const extToType: Record<string, string> = {
        'prog': 'PROG', 'clas': 'CLAS', 'intf': 'INTF',
        'fugr': 'FUGR', 'func': 'FUNC', 'incl': 'INCL',
        'tabl': 'TABL', 'dtel': 'DTEL', 'enho': 'ENHO'
      };
      return extToType[parts[parts.length - 1]] || '';
    }
    return '';
  }
}

class CommitItem extends vscode.TreeItem {
  constructor(commit: CommitInfo) {
    super(commit.message, vscode.TreeItemCollapsibleState.None);
    this.description  = `${commit.hash} · ${commit.author}`;
    this.tooltip      = `${commit.date}\n${commit.message}`;
    this.iconPath     = new vscode.ThemeIcon('git-commit');
    this.contextValue = 'gitCommit';
  }
}

class EmptyItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'gitEmpty';
  }
}
