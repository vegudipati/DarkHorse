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
  /** The exact code the LLM produced and the developer accepted. Stored so
   *  the Correction Store can diff the developer's later edits against the
   *  original AI output. Captured by ObjectCodeGenerator on Accept. */
  generatedCode?: string;
}

export interface PipelineState {
  /** Stable identifier for this pipeline. Generated on initPipeline.
   *  Used to disambiguate output subfolders and identify pipelines
   *  in the Switch / Delete UIs. */
  pipelineId: string;
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

/** Legacy single-state key — read once at startup for migration into the
 *  multi-pipeline map. Never written after the migration. */
const STATE_KEY_LEGACY = 'darkhorse.pipeline.state';

/** Current multi-pipeline storage: Record<pipelineId, PipelineState>. */
const STATES_KEY  = 'darkhorse.pipeline.allStates';

/** Active pipeline id (string). Undefined when no pipelines exist. */
const ACTIVE_KEY  = 'darkhorse.pipeline.activePipelineId';

const STYLE_KEY   = 'darkhorse.pipeline.styleContext';

/** Compact identifier shared with UidLogger style: 16 hex chars from crypto. */
function generatePipelineId(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(8).toString('hex');
}

export interface PipelineSummary {
  pipelineId:    string;
  title:         string;
  ricefwType:    string;
  currentStage:  PipelineStage;
  startedAt:     string;
  lastUpdatedAt: string;
  isActive:      boolean;
}

export class PipelineStateManager {

  private context: vscode.ExtensionContext;
  /** Lazy one-shot migration of the legacy single-state key. */
  private migrated = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /** Exposes the extension context so modules that need globalState access
   *  (ReusableCatalog, future cross-pipeline registries) can share it. */
  public getContext(): vscode.ExtensionContext {
    return this.context;
  }

  // --------------------------------------------------------------------
  // Backwards-compatible getState / setState — operate on the ACTIVE pipeline
  // --------------------------------------------------------------------

  public getState(): PipelineState | undefined {
    this.migrateLegacyOnce();
    const activeId = this.context.globalState.get<string>(ACTIVE_KEY);
    if (!activeId) return undefined;
    const map = this.allStates();
    return map[activeId];
  }

  public async setState(state: PipelineState): Promise<void> {
    this.migrateLegacyOnce();
    if (!state.pipelineId) {
      // Defensive — every PipelineState going through here must carry an id.
      // initPipeline always assigns one; any pre-migration state was given
      // one during the migration step.
      state.pipelineId = generatePipelineId();
    }
    state.lastUpdatedAt = new Date().toISOString();
    const map = this.allStates();
    map[state.pipelineId] = state;
    await this.context.globalState.update(STATES_KEY, map);
    // First write of a state with no active pointer set -> make it active.
    const activeId = this.context.globalState.get<string>(ACTIVE_KEY);
    if (!activeId) {
      await this.context.globalState.update(ACTIVE_KEY, state.pipelineId);
    }
  }

  // --------------------------------------------------------------------
  // Multi-pipeline operations
  // --------------------------------------------------------------------

  public listPipelines(): PipelineSummary[] {
    this.migrateLegacyOnce();
    const map = this.allStates();
    const activeId = this.context.globalState.get<string>(ACTIVE_KEY);
    return Object.values(map)
      .filter((s): s is PipelineState => Boolean(s))
      .map(s => ({
        pipelineId:    s.pipelineId,
        title:         s.title,
        ricefwType:    s.ricefwType,
        currentStage:  s.currentStage,
        startedAt:     s.startedAt,
        lastUpdatedAt: s.lastUpdatedAt,
        isActive:      s.pipelineId === activeId
      }))
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  }

  public getActivePipelineId(): string | undefined {
    this.migrateLegacyOnce();
    return this.context.globalState.get<string>(ACTIVE_KEY);
  }

  /** Returns the full PipelineState for an arbitrary pipelineId — used by
   *  the tracker to render every pipeline (not just the active one). */
  public getPipelineState(pipelineId: string): PipelineState | undefined {
    this.migrateLegacyOnce();
    return this.allStates()[pipelineId];
  }

  public async switchPipeline(pipelineId: string): Promise<boolean> {
    this.migrateLegacyOnce();
    const map = this.allStates();
    if (!map[pipelineId]) return false;
    await this.context.globalState.update(ACTIVE_KEY, pipelineId);
    return true;
  }

  public async deletePipeline(pipelineId: string): Promise<void> {
    this.migrateLegacyOnce();
    const map = this.allStates();
    delete map[pipelineId];
    await this.context.globalState.update(STATES_KEY, map);
    const activeId = this.context.globalState.get<string>(ACTIVE_KEY);
    if (activeId === pipelineId) {
      // Auto-switch to the most-recently-touched remaining pipeline.
      const remaining = Object.values(map)
        .filter((s): s is PipelineState => Boolean(s))
        .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
      await this.context.globalState.update(
        ACTIVE_KEY,
        remaining[0]?.pipelineId ?? undefined
      );
    }
  }

  private allStates(): Record<string, PipelineState> {
    return this.context.globalState.get<Record<string, PipelineState>>(STATES_KEY) ?? {};
  }

  /** One-time migration of legacy single-pipeline state into the new map.
   *  Runs on the first getState/setState/listPipelines call per session. */
  private migrateLegacyOnce(): void {
    if (this.migrated) return;
    this.migrated = true;
    const legacy = this.context.globalState.get<PipelineState>(STATE_KEY_LEGACY);
    if (!legacy) return;
    const map = this.context.globalState.get<Record<string, PipelineState>>(STATES_KEY);
    if (map && Object.keys(map).length > 0) {
      // Map already populated by a previous session — drop the legacy key.
      this.context.globalState.update(STATE_KEY_LEGACY, undefined);
      return;
    }
    const id = legacy.pipelineId ?? generatePipelineId();
    legacy.pipelineId = id;
    const newMap: Record<string, PipelineState> = { [id]: legacy };
    this.context.globalState.update(STATES_KEY, newMap);
    this.context.globalState.update(ACTIVE_KEY, id);
    this.context.globalState.update(STATE_KEY_LEGACY, undefined);
  }

  public async updateStage(stage: PipelineStage): Promise<void> {
    const state = this.getState();
    if (!state) { return; }
    state.currentStage = stage;
    await this.setState(state);
  }

  /** Backwards-compatible name. In the multi-pipeline model this deletes
   *  the ACTIVE pipeline and (if any other pipelines exist) auto-switches
   *  to the most recently touched one. */
  public async clearState(): Promise<void> {
    const activeId = this.context.globalState.get<string>(ACTIVE_KEY);
    if (!activeId) return;
    await this.deletePipeline(activeId);
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
    // Every Start-Pipeline creates a NEW pipeline-id, even when other
    // pipelines already exist. The new one becomes the active pipeline;
    // prior pipelines remain in the map and can be reached via Switch.
    const id = generatePipelineId();
    const state: PipelineState = {
      pipelineId: id,
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
    // Make the new pipeline active BEFORE writing so setState writes to it.
    await this.context.globalState.update(ACTIVE_KEY, id);
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

  /** Per-pipeline output subfolder under the configured root.
   *  Returns '' when no root is configured. Each pipeline gets its own
   *  subfolder so each is its own self-contained abapGit repository and
   *  switching pipelines doesn't clobber the prior one's files. */
  public getPipelineOutputFolder(state?: PipelineState): string {
    const s = state ?? this.getState();
    if (!s) return '';
    const root = vscode.workspace.getConfiguration()
      .get<string>('darkhorse.pipeline.outputFolder', '');
    if (!root) return '';
    const slug = this.pipelineSlug(s);
    const path = require('path');
    return path.join(root, slug);
  }

  /** Filesystem-safe slug derived from the pipeline title + a short hash
   *  of the pipelineId. Collisions are avoided even when two pipelines
   *  share a title. */
  public pipelineSlug(state: PipelineState): string {
    const baseRaw = (state.title ?? 'pipeline').toLowerCase();
    const base    = baseRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const idSuffix = (state.pipelineId ?? '').slice(0, 4);
    return idSuffix ? `${base}-${idSuffix}` : base;
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