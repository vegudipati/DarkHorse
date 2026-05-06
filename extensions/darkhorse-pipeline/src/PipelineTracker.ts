import * as vscode from 'vscode';
import { PipelineStateManager, PipelineStage } from './PipelineStateManager';

class PipelineItem extends vscode.TreeItem {
  constructor(
    label: string,
    status: 'complete' | 'active' | 'pending' | 'info',
    description?: string,
    command?: vscode.Command
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description ?? '';
    this.command = command;
    this.iconPath = this.getIcon(status);
  }

  private getIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'complete': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'active':   return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
      case 'pending':  return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.gray'));
      case 'info':     return new vscode.ThemeIcon('info');
      default:         return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class PipelineTracker implements vscode.TreeDataProvider<PipelineItem> {

  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private stateManager: PipelineStateManager) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PipelineItem): vscode.TreeItem {
    return element;
  }

  getChildren(): PipelineItem[] {
    const state = this.stateManager.getState();

    if (!state) {
      return [
        new PipelineItem(
          'No active pipeline',
          'info',
          'Run: DarkHorse: Start Pipeline'
        ),
        new PipelineItem(
          'Load Reference Docs',
          'info',
          'Optional but recommended',
          {
            command: 'darkhorse.pipeline.loadReferenceDocs',
            title: 'Load Reference Docs'
          }
        )
      ];
    }

    const stage = state.currentStage;
    const items: PipelineItem[] = [];

    // Pipeline title
    items.push(new PipelineItem(
      `📋 ${state.title}`,
      'info',
      state.ricefwType
    ));

    // Reference docs
    items.push(new PipelineItem(
      'Reference Docs',
      state.referenceDocsLoaded ? 'complete' : 'pending',
      state.referenceDocsLoaded ? 'Loaded' : 'Not loaded'
    ));

    // Stage 1: BR
// Stage 1: BR
    const brStatus = stage === 'br_captured' ? 'active' : 
                    this.isAfter(stage, 'br_captured') ? 'complete' : 'pending';
    items.push(new PipelineItem(
      'Business Requirement',
      brStatus,
      brStatus === 'complete' ? 'Captured ✓' : 
      brStatus === 'active' ? 'Captured — Awaiting FDS' : 'Pending'
    ));
    // Stage 2: FDS
    const fdsStatus = this.getStageStatus(stage, 'fds_approved');
    items.push(new PipelineItem(
      'Functional Design Spec',
      fdsStatus,
      stage === 'fds_review' ? 'Under Review' :
      stage === 'fds_approved' || this.isAfter(stage, 'fds_approved') ? 'Approved ✓' : 'Pending',
      state.fdsFilePath ? {
        command: 'vscode.open',
        title: 'Open FDS',
        arguments: [vscode.Uri.file(state.fdsFilePath)]
      } : undefined
    ));

    // Stage 3: TDS
    const tdsStatus = this.getStageStatus(stage, 'tds_approved');
    items.push(new PipelineItem(
      'Technical Design Spec',
      tdsStatus,
      stage === 'tds_review' ? 'Under Review' :
      stage === 'tds_approved' || this.isAfter(stage, 'tds_approved') ? 'Approved ✓' : 'Pending',
      state.tdsFilePath ? {
        command: 'vscode.open',
        title: 'Open TDS',
        arguments: [vscode.Uri.file(state.tdsFilePath)]
      } : undefined
    ));

    // Stage 4: Code objects
    if (state.abapObjects.length > 0) {
      state.abapObjects.forEach((obj, idx) => {
        const objStatus = obj.codeAccepted ? 'complete' :
                          idx === state.currentObjectIndex ? 'active' : 'pending';
        items.push(new PipelineItem(
          `  ${obj.sequence}. ${obj.objectName}`,
          objStatus,
          obj.codeAccepted ? 'Generated & Accepted' :
          idx === state.currentObjectIndex ? 'In Progress' : obj.objectType
        ));
      });
    } else if (this.isAfter(stage, 'tds_approved')) {
      items.push(new PipelineItem('Code Generation', 'pending', 'Awaiting TDS approval'));
    }

    // Stage complete
    if (stage === 'complete') {
      items.push(new PipelineItem(
        '🎉 Pipeline Complete',
        'complete',
        `${state.abapObjects.filter(o => o.codeAccepted).length} objects generated`
      ));
    }

    return items;
  }

  private stageOrder: PipelineStage[] = [
    'idle', 'br_captured', 'fds_generating', 'fds_review',
    'fds_approved', 'tds_generating', 'tds_review',
    'tds_approved', 'code_generating', 'complete'
  ];

  private getStageStatus(
    current: PipelineStage,
    target: PipelineStage
  ): 'complete' | 'active' | 'pending' {
    const currentIdx = this.stageOrder.indexOf(current);
    const targetIdx = this.stageOrder.indexOf(target);
    if (currentIdx > targetIdx) { return 'complete'; }
    if (currentIdx === targetIdx) { return 'active'; }
    return 'pending';
  }

  private isAfter(current: PipelineStage, target: PipelineStage): boolean {
    return this.stageOrder.indexOf(current) > this.stageOrder.indexOf(target);
  }
}