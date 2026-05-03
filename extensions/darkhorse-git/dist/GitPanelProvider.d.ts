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
import * as vscode from 'vscode';
import { GitService, CommitInfo } from './GitService';
type GitTreeItem = ChangedFileItem | CommitItem | SectionItem | EmptyItem;
export declare class GitPanelProvider implements vscode.TreeDataProvider<GitTreeItem>, vscode.Disposable {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<GitTreeItem | undefined>;
    private gitService;
    private status;
    private commits;
    private disposables;
    constructor();
    /**
     * Connect the panel to a Git repo.
     */
    setRepo(gitService: GitService): void;
    /**
     * Disconnect — show empty state.
     */
    clearRepo(): void;
    /**
     * Trigger a tree refresh — fetches latest status and commits.
     */
    refresh(): void;
    getTreeItem(element: GitTreeItem): vscode.TreeItem;
    getChildren(element?: GitTreeItem): Promise<GitTreeItem[]>;
    private getRootItems;
    private getChangedFileItems;
    private getCommitItems;
    private loadData;
    dispose(): void;
}
declare class SectionItem extends vscode.TreeItem {
    readonly sectionId: string;
    constructor(sectionId: string, label: string, description?: string, collapsibleState?: vscode.TreeItemCollapsibleState);
}
declare class ChangedFileItem extends vscode.TreeItem {
    readonly filePath: string;
    readonly fileStatus: 'staged' | 'modified' | 'untracked';
    private static readonly STATUS_ICONS;
    private static readonly STATUS_COLORS;
    constructor(filePath: string, fileStatus: 'staged' | 'modified' | 'untracked');
    private static getLabel;
    private static getObjectType;
}
declare class CommitItem extends vscode.TreeItem {
    constructor(commit: CommitInfo);
}
declare class EmptyItem extends vscode.TreeItem {
    constructor(message: string);
}
export {};
