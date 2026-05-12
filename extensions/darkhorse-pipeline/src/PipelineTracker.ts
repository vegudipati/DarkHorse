import * as vscode from 'vscode';
import { PipelineStateManager, PipelineStage, CleanCoreLevel } from './PipelineStateManager';

class PipelineItem extends vscode.TreeItem {
  constructor(
    label: string,
    status: 'complete' | 'active' | 'pending' | 'info' | 'blocked' | 'warning',
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
      case 'blocked':  return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'warning':  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
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
        new PipelineItem('No active pipeline', 'info', 'Run: DarkHorse: Start Pipeline'),
        new PipelineItem('Load Reference Docs', 'info', 'Optional but recommended', {
          command: 'darkhorse.pipeline.loadReferenceDocs', title: 'Load Reference Docs'
        })
      ];
    }

    const stage = state.currentStage;
    const items: PipelineItem[] = [];

    // Pipeline title
    items.push(new PipelineItem(`📋 ${state.title}`, 'info', state.ricefwType));

    // Blocked banner
    if (stage === 'blocked_level_d') {
      items.push(new PipelineItem(
        '🚫 PIPELINE BLOCKED',
        'blocked',
        'Level D violation — refine BR and retry'
      ));
      items.push(new PipelineItem(
        'Violated: ' + (state.levelDViolationDetails ?? 'Unknown component'),
        'blocked', 'Must be resolved before proceeding'
      ));
      return items;
    }

    // Reference docs
    items.push(new PipelineItem(
      'Reference Docs',
      state.referenceDocsLoaded ? 'complete' : 'pending',
      state.referenceDocsLoaded ? 'Loaded' : 'Not loaded'
    ));

    // BR
    const brStatus = stage === 'br_captured' ? 'active'
      : this.isAfter(stage, 'br_captured') ? 'complete' : 'pending';
    items.push(new PipelineItem(
      'Business Requirement',
      brStatus,
      brStatus === 'complete' ? 'Captured ✓' :
      brStatus === 'active' ? 'Captured — Awaiting Solution Overview' : 'Pending'
    ));

    // Solution Overview
    const soStatus = stage === 'solution_overview_review' ? 'active'
      : stage === 'solution_overview_generating' ? 'active'
      : this.isAfter(stage, 'solution_overview_approved') ? 'complete'
      : stage === 'solution_overview_approved' ? 'complete'
      : 'pending';

    const ccLevel = state.solutionOverview?.overallCleanCoreLevel;
    const ccBadge = ccLevel ? ` [Level ${ccLevel}]` : '';
    const hasLevelC = state.solutionOverview?.deviations.some(d => d.level === 'C');

    items.push(new PipelineItem(
      'Solution Overview',
      hasLevelC ? 'warning' : soStatus,
      stage === 'solution_overview_generating' ? 'Generating...' :
      stage === 'solution_overview_review' ? `Under Review${ccBadge}` :
      this.isAfter(stage, 'solution_overview_approved') || stage === 'solution_overview_approved'
        ? `Approved ✓${ccBadge}` : 'Pending'
    ));

    // FDS
    const fdsStatus = stage === 'fds_review' ? 'active'
      : this.isAfter(stage, 'fds_approved') || stage === 'fds_approved' ? 'complete' : 'pending';
    items.push(new PipelineItem(
      'Functional Design Spec',
      fdsStatus,
      stage === 'fds_review' ? 'Under Review' :
      fdsStatus === 'complete' ? 'Approved ✓' : 'Pending',
      state.fdsFilePath ? {
        command: 'vscode.open', title: 'Open FDS',
        arguments: [vscode.Uri.file(state.fdsFilePath)]
      } : undefined
    ));

    // TDS
    const tdsStatus = stage === 'tds_review' ? 'active'
      : this.isAfter(stage, 'tds_approved') || stage === 'tds_approved' ? 'complete' : 'pending';
    items.push(new PipelineItem(
      'Technical Design Spec',
      tdsStatus,
      stage === 'tds_review' ? 'Under Review' :
      tdsStatus === 'complete' ? 'Approved ✓' : 'Pending',
      state.tdsFilePath ? {
        command: 'vscode.open', title: 'Open TDS',
        arguments: [vscode.Uri.file(state.tdsFilePath)]
      } : undefined
    ));

    // Code objects
    if (state.abapObjects.length > 0) {
      state.abapObjects.forEach((obj, idx) => {
        const objStatus = obj.codeAccepted ? 'complete'
          : idx === state.currentObjectIndex ? 'active' : 'pending';
        items.push(new PipelineItem(
          `  ${obj.sequence}. ${obj.objectName}`,
          objStatus,
          obj.codeAccepted ? 'Generated & Accepted' :
          idx === state.currentObjectIndex ? 'In Progress' : obj.objectType
        ));
      });
    }

    // Complete
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
    'idle', 'br_captured',
    'solution_overview_generating', 'solution_overview_review', 'solution_overview_approved',
    'fds_generating', 'fds_review', 'fds_approved',
    'tds_generating', 'tds_review', 'tds_approved',
    'code_generating', 'complete', 'blocked_level_d'
  ];

  private isAfter(current: PipelineStage, target: PipelineStage): boolean {
    return this.stageOrder.indexOf(current) > this.stageOrder.indexOf(target);
  }
}