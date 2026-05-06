import * as vscode from 'vscode';

export type PipelineStage =
  | 'idle'
  | 'br_captured'
  | 'fds_generating'
  | 'fds_review'
  | 'fds_approved'
  | 'tds_generating'
  | 'tds_review'
  | 'tds_approved'
  | 'code_generating'
  | 'complete';

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
  fdsFilePath?: string;
  tdsFilePath?: string;
  fdsContent?: string;        // JSON string of FdsDocument
  tdsContent?: string;        // JSON string of TdsDocument
  abapObjects: AbapObject[];
  currentObjectIndex: number;
  startedAt: string;
  lastUpdatedAt: string;
  referenceDocsLoaded: boolean;
  styleContext?: string;      // JSON string of StyleContext
}

const STATE_KEY = 'darkhorse.pipeline.state';
const STYLE_KEY = 'darkhorse.pipeline.styleContext';

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
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
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
      abapObjects: [],
      currentObjectIndex: 0,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      referenceDocsLoaded: this.getStyleContext() !== undefined
    };
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
    if (state.currentObjectIndex >= state.abapObjects.length) {
      state.currentStage = 'complete';
    } else {
      state.currentStage = 'code_generating';
    }
    await this.setState(state);
  }

  public async resetCodeGeneration(): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentObjectIndex = 0;
    state.currentStage = 'tds_approved';
    state.abapObjects = state.abapObjects.map(obj => ({
      ...obj,
      codeGenerated: false,
      codeAccepted: false
    }));
    await this.setState(state);
  }

  public getStageSummary(): string {
    const state = this.getState();
    if (!state) { return 'No active pipeline'; }
    const stageLabels: Record<PipelineStage, string> = {
      idle: 'Idle',
      br_captured: 'BR Captured',
      fds_generating: 'Generating FDS...',
      fds_review: 'FDS Under Review',
      fds_approved: 'FDS Approved',
      tds_generating: 'Generating TDS...',
      tds_review: 'TDS Under Review',
      tds_approved: 'TDS Approved',
      code_generating: `Generating Code (${state.currentObjectIndex}/${state.abapObjects.length})`,
      complete: 'Pipeline Complete'
    };
    return stageLabels[state.currentStage];
  }
}