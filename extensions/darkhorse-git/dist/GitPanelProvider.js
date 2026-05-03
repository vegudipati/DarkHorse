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
exports.GitPanelProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class GitPanelProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    gitService = null;
    status = null;
    commits = [];
    disposables = [];
    constructor() {
        // Auto-refresh every 30 seconds if a repo is connected
        const interval = setInterval(() => {
            if (this.gitService) {
                this.refresh();
            }
        }, 30_000);
        this.disposables.push({ dispose: () => clearInterval(interval) });
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Connect the panel to a Git repo.
     */
    setRepo(gitService) {
        this.gitService = gitService;
        this.refresh();
    }
    /**
     * Disconnect — show empty state.
     */
    clearRepo() {
        this.gitService = null;
        this.status = null;
        this.commits = [];
        this._onDidChangeTreeData.fire(undefined);
    }
    /**
     * Trigger a tree refresh — fetches latest status and commits.
     */
    refresh() {
        this.loadData().then(() => {
            this._onDidChangeTreeData.fire(undefined);
        }).catch(() => {
            // Silent — don't crash the panel on a transient git error
        });
    }
    // ---------------------------------------------------------------------------
    // TreeDataProvider implementation
    // ---------------------------------------------------------------------------
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
    getRootItems() {
        if (!this.status) {
            return [new EmptyItem('Loading…')];
        }
        const changedCount = this.status.staged.length +
            this.status.unstaged.length +
            this.status.untracked.length;
        const changedLabel = changedCount > 0
            ? `Changed Files (${changedCount})`
            : 'Changed Files';
        return [
            new SectionItem('changed', changedLabel, `Branch: ${this.status.branch}`, changedCount > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed),
            new SectionItem('commits', 'Recent Commits', undefined, vscode.TreeItemCollapsibleState.Collapsed)
        ];
    }
    getChangedFileItems() {
        if (!this.status) {
            return [];
        }
        const items = [];
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
    getCommitItems() {
        if (this.commits.length === 0) {
            return [new EmptyItem('No commits yet.')];
        }
        return this.commits.map(c => new CommitItem(c));
    }
    // ---------------------------------------------------------------------------
    // Data loading
    // ---------------------------------------------------------------------------
    async loadData() {
        if (!this.gitService) {
            return;
        }
        try {
            this.status = await this.gitService.getStatus();
            this.commits = await this.gitService.getLog(15);
        }
        catch {
            // Swallow — panel shows stale data rather than crashing
        }
    }
    // ---------------------------------------------------------------------------
    // Dispose
    // ---------------------------------------------------------------------------
    dispose() {
        this._onDidChangeTreeData.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}
exports.GitPanelProvider = GitPanelProvider;
// ---------------------------------------------------------------------------
// Tree item classes
// ---------------------------------------------------------------------------
class SectionItem extends vscode.TreeItem {
    sectionId;
    constructor(sectionId, label, description, collapsibleState = vscode.TreeItemCollapsibleState.Collapsed) {
        super(label, collapsibleState);
        this.sectionId = sectionId;
        this.description = description;
        this.contextValue = `gitSection_${sectionId}`;
    }
}
class ChangedFileItem extends vscode.TreeItem {
    filePath;
    fileStatus;
    static STATUS_ICONS = {
        staged: '$(check)',
        modified: '$(edit)',
        untracked: '$(question)'
    };
    static STATUS_COLORS = {
        staged: new vscode.ThemeColor('gitDecoration.stagedModifiedResourceForeground'),
        modified: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
        untracked: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
    };
    constructor(filePath, fileStatus) {
        super(ChangedFileItem.getLabel(filePath), vscode.TreeItemCollapsibleState.None);
        this.filePath = filePath;
        this.fileStatus = fileStatus;
        this.description = ChangedFileItem.getObjectType(filePath);
        this.tooltip = filePath;
        this.iconPath = new vscode.ThemeIcon(ChangedFileItem.STATUS_ICONS[fileStatus]?.replace('$(', '').replace(')', '') || 'file', ChangedFileItem.STATUS_COLORS[fileStatus]);
        this.contextValue = `gitFile_${fileStatus}`;
        // Click opens the file if it exists locally
        this.command = {
            command: 'darkhorse.git.openFile',
            title: 'Open File',
            arguments: [filePath]
        };
    }
    static getLabel(filePath) {
        return path.basename(filePath);
    }
    static getObjectType(filePath) {
        const base = path.basename(filePath, '.abap');
        const parts = base.split('.');
        if (parts.length >= 2) {
            const extToType = {
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
    constructor(commit) {
        super(commit.message, vscode.TreeItemCollapsibleState.None);
        this.description = `${commit.hash} · ${commit.author}`;
        this.tooltip = `${commit.date}\n${commit.message}`;
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.contextValue = 'gitCommit';
    }
}
class EmptyItem extends vscode.TreeItem {
    constructor(message) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'gitEmpty';
    }
}
//# sourceMappingURL=GitPanelProvider.js.map