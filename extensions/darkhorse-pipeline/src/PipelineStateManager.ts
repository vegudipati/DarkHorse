import * as vscode from 'vscode';

export type PipelineStage =
  | 'idle'
  | 'br_captured'
  | 'solution_overview_generating'
  | 'solution_overview_review'
  | 'solution_overview_approved'
  | 'fds_generating'
  | 'fds_review'
  | 'fds_approved'
  | 'tds_generating'
  | 'tds_review'
  | 'tds_approved'
  | 'code_generating'
  | 'complete'
  | 'blocked_level_d';

export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D' | 'mixed';

export interface CleanCoreComponent {
  component: string;
  approach: string;
  level: CleanCoreLevel;
  reasoning: string;
}

export interface SolutionOverview {
  solutionSummary: string;
  solutionDetails: string;
  affectedModules: string[];
  complexity: 'Low' | 'Medium' | 'High';
  level2Architecture: {
    description: string;
    systems: Array<{ name: string; role: string }>;
    flows: Array<{ from: string; to: string; protocol: string; description: string }>;
    triggerPoint: string;
  };
  level3Architecture: {
    description: string;
    components: Array<{ name: string; type: string; detail: string }>;
  };
  cleanCoreAlignment: CleanCoreComponent[];
  overallCleanCoreLevel: CleanCoreLevel;
  deviations: Array<{ component: string; level: CleanCoreLevel; risk: string }>;
  errorHandlingApproach: string;
}

export interface AbapObject {
  sequence: number;
  objectType: string;
  objectName: string;
  description: string;
  keyLogic: string[];
  dependencies: string[];
  codeGenerated: boolean;
  codeAccepted: boolean;
}

export interface PipelineState {
  title: string;
  ricefwType: string;
  objectType: string;
  sapPackage: string;
  brText: string;
  currentStage: PipelineStage;
  // Solution Overview
  solutionOverview?: SolutionOverview;
  cleanCoreLevelJustification?: string;
  hasLevelDViolation: boolean;
  levelDViolationDetails?: string;
  // FDS/TDS
  fdsFilePath?: string;
  tdsFilePath?: string;
  fdsContent?: string;
  tdsContent?: string;
  // Code generation
  abapObjects: AbapObject[];
  currentObjectIndex: number;
  // Metadata
  startedAt: string;
  lastUpdatedAt: string;
  referenceDocsLoaded: boolean;
  styleContext?: string;
}

const STATE_KEY  = 'darkhorse.pipeline.state';
const STYLE_KEY  = 'darkhorse.pipeline.styleContext';

export class PipelineStateManager {

  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public getState(): PipelineState | undefined {
    return this.context.globalState.get<PipelineState>(STATE_KEY);
  }

  public async setState(state: PipelineState): Promise<void> {
    state.lastUpdatedAt = new Date().toISOString();
    await this.context.globalState.update(STATE_KEY, state);
  }

  public async updateStage(stage: PipelineStage): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentStage = stage;
    await this.setState(state);
  }

  public async clearState(): Promise<void> {
    await this.context.globalState.update(STATE_KEY, undefined);
  }

  public async saveStyleContext(styleContext: object): Promise<void> {
    await this.context.globalState.update(STYLE_KEY, JSON.stringify(styleContext));
  }

  public getStyleContext(): object | undefined {
    const raw = this.context.globalState.get<string>(STYLE_KEY);
    if (!raw) { return undefined; }
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  public async initPipeline(
    title: string,
    ricefwType: string,
    objectType: string,
    sapPackage: string,
    brText: string
  ): Promise<void> {
    const state: PipelineState = {
      title,
      ricefwType,
      objectType,
      sapPackage,
      brText,
      currentStage: 'br_captured',
      hasLevelDViolation: false,
      abapObjects: [],
      currentObjectIndex: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      referenceDocsLoaded: this.getStyleContext() !== undefined
    };
    await this.setState(state);
  }

  public async markSolutionOverviewGenerated(overview: SolutionOverview): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.solutionOverview = overview;
    state.hasLevelDViolation = overview.overallCleanCoreLevel === 'D' ||
      overview.deviations.some(d => d.level === 'D');
    state.levelDViolationDetails = state.hasLevelDViolation
      ? overview.deviations.filter(d => d.level === 'D').map(d => d.component).join(', ')
      : undefined;
    state.currentStage = 'solution_overview_review';
    await this.setState(state);
  }

  public async markSolutionOverviewApproved(justification?: string): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentStage = 'solution_overview_approved';
    if (justification) {
      state.cleanCoreLevelJustification = justification;
    }
    await this.setState(state);
  }

  public async blockForLevelD(): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentStage = 'blocked_level_d';
    state.hasLevelDViolation = true;
    await this.setState(state);
  }

  public async refineBrForLevelD(newBrText: string): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.brText = newBrText;
    state.currentStage = 'br_captured';
    state.hasLevelDViolation = false;
    state.levelDViolationDetails = undefined;
    state.solutionOverview = undefined;
    state.cleanCoreLevelJustification = undefined;
    await this.setState(state);
  }

  public async markFdsGenerated(fdsContent: string, filePath: string): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.fdsContent = fdsContent;
    state.fdsFilePath = filePath;
    state.currentStage = 'fds_review';
    await this.setState(state);
  }

  public async markFdsApproved(): Promise<void> {
    await this.updateStage('fds_approved');
  }

  public async markTdsGenerated(tdsContent: string, filePath: string, objects: AbapObject[]): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.tdsContent = tdsContent;
    state.tdsFilePath = filePath;
    state.abapObjects = objects;
    state.currentObjectIndex = 0;
    state.currentStage = 'tds_review';
    await this.setState(state);
  }

  public async markTdsApproved(): Promise<void> {
    await this.updateStage('tds_approved');
  }

  public async markObjectComplete(index: number, accepted: boolean): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.abapObjects[index].codeGenerated = true;
    state.abapObjects[index].codeAccepted = accepted;
    state.currentObjectIndex = index + 1;
    state.currentStage = state.currentObjectIndex >= state.abapObjects.length
      ? 'complete'
      : 'code_generating';
    await this.setState(state);
  }

  public async resetCodeGeneration(): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentObjectIndex = 0;
    state.currentStage = 'tds_approved';
    state.abapObjects = state.abapObjects.map(obj => ({
      ...obj, codeGenerated: false, codeAccepted: false
    }));
    await this.setState(state);
  }

  public getStageSummary(): string {
    const state = this.getState();
    if (!state) { return 'No active pipeline'; }
    const labels: Record<PipelineStage, string> = {
      idle: 'Idle',
      br_captured: 'BR Captured',
      solution_overview_generating: 'Generating Solution Overview...',
      solution_overview_review: 'Solution Overview Under Review',
      solution_overview_approved: 'Solution Overview Approved',
      fds_generating: 'Generating FDS...',
      fds_review: 'FDS Under Review',
      fds_approved: 'FDS Approved',
      tds_generating: 'Generating TDS...',
      tds_review: 'TDS Under Review',
      tds_approved: 'TDS Approved',
      code_generating: `Generating Code (${state.currentObjectIndex}/${state.abapObjects.length})`,
      complete: 'Pipeline Complete',
      blocked_level_d: '🚫 BLOCKED — Level D Violation'
    };
    return labels[state.currentStage];
  }
}