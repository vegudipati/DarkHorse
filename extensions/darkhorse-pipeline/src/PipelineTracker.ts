import * as vscode from 'vscode';
import { PipelineStateManager, PipelineStage, PipelineState } from './PipelineStateManager';

type ItemStatus = 'complete' | 'active' | 'pending' | 'info' | 'blocked' | 'warning';

class PipelineItem extends vscode.TreeItem {
  /** Pipeline root items carry the pipelineId so getChildren can route the
   *  request to the correct pipeline state. Stage items leave this undefined. */
  public readonly pipelineId?: string;

  constructor(
    label: string,
    status: ItemStatus,
    description?: string,
    command?: vscode.Command,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    pipelineId?: string
  ) {
    super(label, collapsibleState);
    this.description = description ?? '';
    this.command = command;
    this.iconPath = this.getIcon(status);
    this.pipelineId = pipelineId;
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

  getChildren(element?: PipelineItem): PipelineItem[] {
    // Pipeline-root expanded -> return its stage items.
    if (element && element.pipelineId) {
      const state = this.stateManager.getPipelineState(element.pipelineId);
      if (!state) return [];
      return this.getStageItems(state);
    }
    // Root level -> list every pipeline as a collapsible parent.
    const pipelines = this.stateManager.listPipelines();
    if (pipelines.length === 0) {
      return [
        new PipelineItem('No active pipeline', 'info', 'Run: DarkHorse: Start Pipeline'),
        new PipelineItem('Load Reference Docs', 'info', 'Optional but recommended', {
          command: 'darkhorse.pipeline.loadReferenceDocs', title: 'Load Reference Docs'
        })
      ];
    }

    return pipelines.map(p => {
      const state = this.stateManager.getPipelineState(p.pipelineId);
      // The root status reflects the pipeline's current stage.
      const stageStatus: ItemStatus =
        p.currentStage === 'blocked_level_d' ? 'blocked'
        : p.currentStage === 'complete'      ? 'complete'
        : p.isActive                          ? 'active'
        : 'pending';
      // Active pipeline gets expanded by default so the developer sees its
      // stages immediately; other pipelines collapse to keep the panel compact.
      const collapse = p.isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      const label = `${p.isActive ? '▶ ' : ''}${p.title}`;
      const description = state ? this.shortStageLabel(state) : p.currentStage;
      // Clicking a non-active root switches to that pipeline. Active root's
      // command is a no-op so it doesn't re-switch to itself.
      const command: vscode.Command | undefined = p.isActive
        ? undefined
        : {
            command:   'darkhorse.pipeline.switchPipeline',
            title:     'Switch Pipeline',
            arguments: [p.pipelineId]
          };
      return new PipelineItem(
        label,
        stageStatus,
        description,
        command,
        collapse,
        p.pipelineId
      );
    });
  }

  /** Compact one-line status label for the pipeline root row. */
  private shortStageLabel(state: PipelineState): string {
    const stage = state.currentStage;
    if (stage === 'complete')        return `complete · ${state.abapObjects.filter(o => o.codeAccepted).length}/${state.abapObjects.length} accepted`;
    if (stage === 'blocked_level_d') return '🚫 blocked (Level D)';
    if (stage === 'code_generating') return `code (${state.currentObjectIndex}/${state.abapObjects.length})`;
    return stage.replace(/_/g, ' ');
  }

  /** Build the per-stage rows for a single pipeline. Used both as the active
   *  pipeline's expansion AND as any pipeline's children when expanded. */
  private getStageItems(state: PipelineState): PipelineItem[] {
    const stage = state.currentStage;
    const items: PipelineItem[] = [];

    // RICEFW type / pipeline id badge row (always at the top of the expansion).
    items.push(new PipelineItem(
      `${state.ricefwType}`,
      'info',
      `id ${(state.pipelineId ?? '').slice(0, 4)} · started ${state.startedAt.split('T')[0]}`
    ));

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
    const brStatus: ItemStatus = stage === 'br_captured' ? 'active'
      : this.isAfter(stage, 'br_captured') ? 'complete' : 'pending';
    items.push(new PipelineItem(
      'Business Requirement',
      brStatus,
      brStatus === 'complete' ? 'Captured ✓' :
      brStatus === 'active' ? 'Captured — Awaiting Solution Overview' : 'Pending'
    ));

    // Solution Overview
    const soStatus: ItemStatus = stage === 'solution_overview_review' ? 'active'
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
    const fdsStatus: ItemStatus = stage === 'fds_review' ? 'active'
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
    const tdsStatus: ItemStatus = stage === 'tds_review' ? 'active'
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
        const objStatus: ItemStatus = obj.codeAccepted ? 'complete'
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
