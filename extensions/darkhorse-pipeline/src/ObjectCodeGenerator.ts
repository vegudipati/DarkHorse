import * as vscode from 'vscode';
import { PipelineStateManager, AbapObject } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { TdsDocument } from './DocxWriter';
import {
  verifyGeneratedCode,
  acknowledgeCatalogEntry,
  resolveMcpPort,
  CleanCoreReport,
  CleanCoreFinding
} from './CleanCoreVerifier';
import {
  groundObjectForGeneration,
  renderGroundingForPrompt,
  GroundingContext
} from './CodeAgentGrounder';
import {
  reviewGeneratedCode,
  ReviewReport,
  ReviewFinding,
  ReviewSeverity
} from './ReviewAgent';
import {
  applyCdsAutoFix,
  AutoFixSummary
} from './CleanCoreAutoFix';
import { recordGeneration }       from './UidLogger';
import { applyHeader }            from './HeaderEmitter';
import { renderStandardsForPrompt } from './StandardsLoader';
import { generateZWrapper }       from './ZWrapperGenerator';
import { enforceObjectName }      from './ObjectNameEnforcer';
import * as crypto                from 'crypto';

export class ObjectCodeGenerator {

  public static async generate(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {

    const state = stateManager.getState();
    if (!state || !state.tdsContent) {
      vscode.window.showErrorMessage('DarkHorse: No approved TDS found.');
      return;
    }

    const tdsDoc = JSON.parse(state.tdsContent) as TdsDocument;
    const objects = state.abapObjects;

    if (!objects || objects.length === 0) {
      vscode.window.showErrorMessage('DarkHorse: No ABAP objects found in TDS.');
      return;
    }

    await stateManager.updateStage('code_generating');
    tracker.refresh();

    // Process objects starting from current index
    const startIndex = state.currentObjectIndex;
    for (let i = startIndex; i < objects.length; i++) {
      const obj = objects[i];

      // Reusable-objects marketplace — before invoking the LLM, check whether
      // an accepted object with this same name + type already exists in the
      // cross-pipeline catalog. When the developer picks Reuse, the cached
      // code is written directly (no LLM call, no preview) and the object is
      // marked accepted in state. Selective regen explicitly bypasses this
      // (it has its own entry point and the developer there is asking for a
      // fresh generation).
      const reuseOutcome = await ObjectCodeGenerator.tryReuseFromCatalog(
        i, obj, stateManager, tracker
      );
      if (reuseOutcome === 'reused') {
        await stateManager.markObjectComplete(i, true);
        await stateManager.setState(stateManager.getState()!);
        tracker.refresh();
        vscode.window.showInformationMessage(
          `DarkHorse: ${obj.objectName} reused from catalog ✓`
        );
        continue;
      }
      if (reuseOutcome === 'skipped') {
        vscode.window.showInformationMessage(
          `DarkHorse: Code generation paused at object ${i + 1}. ` +
          'Use "Resume Pipeline" to continue.'
        );
        return;
      }
      // 'generate-fresh' or 'no-match' — fall through to normal LLM path.

      const accepted = await ObjectCodeGenerator.generateObject(
        i, obj, tdsDoc, stateManager, tracker
      );

      // If developer skipped or closed — stop and let them resume later
      if (accepted === undefined) {
        vscode.window.showInformationMessage(
          `DarkHorse: Code generation paused at object ${i + 1}. ` +
          'Use "Resume Pipeline" to continue.'
        );
        return;
      }

      // Mark complete BEFORE showing any further UI
      await stateManager.markObjectComplete(i, accepted);
      await stateManager.setState(stateManager.getState()!);
      tracker.refresh();

      vscode.window.showInformationMessage(
        accepted
          ? `DarkHorse: ${obj.objectName} accepted ✓`
          : `DarkHorse: ${obj.objectName} rejected — skipping.`
      );
    }

    // All objects complete
    vscode.window.showInformationMessage(
      `🎉 DarkHorse: Pipeline complete! ` +
      `${objects.filter(o => o.codeAccepted).length} of ${objects.length} objects generated and accepted.`
    );
    tracker.refresh();
  }

  /**
   * Selective regen — regenerate code for ONE specific object (by index)
   * without re-running siblings and without advancing currentObjectIndex.
   * Used when a single object needs a redo (LLM produced something wrong,
   * developer edited the keyLogic, sibling regenerated and we want to
   * cascade). The accept/reject result only updates THAT object's state.
   */
  public static async regenerateSingle(
    index: number,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {
    const state = stateManager.getState();
    if (!state || !state.tdsContent) {
      vscode.window.showErrorMessage('DarkHorse: No approved TDS found.');
      return;
    }
    const objects = state.abapObjects;
    if (!objects || index < 0 || index >= objects.length) {
      vscode.window.showErrorMessage(`DarkHorse: Invalid object index ${index}.`);
      return;
    }
    const tdsDoc = JSON.parse(state.tdsContent) as TdsDocument;
    const obj = objects[index];

    // Reset the object's generation state so the preview/accept path treats
    // this as a fresh first-pass generation (no stale accepted code carried
    // over from a previous run).
    obj.codeGenerated = false;
    obj.codeAccepted  = false;
    obj.generatedCode = undefined;
    await stateManager.setState(state);
    tracker.refresh();

    const accepted = await ObjectCodeGenerator.generateObject(
      index, obj, tdsDoc, stateManager, tracker
    );

    if (accepted === undefined) {
      // Developer closed the panel without accepting/rejecting — leave the
      // object in its reset state. They can regen again at will.
      tracker.refresh();
      return;
    }

    // Mirror what the main loop does for ONE object only — do NOT advance
    // currentObjectIndex (other objects haven't been touched) and do NOT
    // change the pipeline stage. We hand-set the per-object flags so the
    // tracker shows the regenerated object correctly without flipping the
    // pipeline to "complete" prematurely.
    const final = stateManager.getState();
    if (final) {
      final.abapObjects[index].codeGenerated = true;
      final.abapObjects[index].codeAccepted  = accepted;
      await stateManager.setState(final);
    }
    tracker.refresh();

    vscode.window.showInformationMessage(
      accepted
        ? `DarkHorse: ${obj.objectName} regenerated ✓`
        : `DarkHorse: ${obj.objectName} rejected — keep editing as needed.`
    );
  }

  /**
   * Reusable-objects marketplace — offer reuse of a previously accepted
   * object with the same name + type. Returns:
   *   'reused'         — developer chose reuse; cached code written to the
   *                      abapGit folder + state.generatedCode updated.
   *                      Caller should markObjectComplete(i, true).
   *   'generate-fresh' — developer chose to regenerate fresh; caller should
   *                      proceed with the normal LLM path.
   *   'skipped'        — developer cancelled; caller should treat like the
   *                      panel-closed outcome (return from the loop).
   *   'no-match'       — catalog has no matching entry; caller proceeds.
   */
  private static async tryReuseFromCatalog(
    index: number,
    obj: AbapObject,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<'reused' | 'generate-fresh' | 'skipped' | 'no-match'> {
    const { ReusableCatalog } = require('./ReusableCatalog');
    const catalog = new ReusableCatalog(stateManager.getContext());
    const hits = catalog.find(obj.objectName, obj.objectType);
    if (!hits || hits.length === 0) return 'no-match';

    // Pick the most recent hit by default; if multiple variants exist, offer
    // a QuickPick to disambiguate. Each entry shows source pipeline +
    // accepted-at + usage count so the developer can choose deliberately.
    let entry = hits[0]!;
    if (hits.length > 1) {
      type VariantItem = vscode.QuickPickItem & { entry: any };
      const items: VariantItem[] = hits.map((h: any) => ({
        label:       `${h.objectName} — from ${h.metadata.sourcePipelineTitle}`,
        description: `accepted ${h.metadata.acceptedAt.split('T')[0]} · used ${h.usageCount ?? 0}×`,
        detail:      h.description,
        entry:       h
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title:       `DarkHorse: ${hits.length} reusable variants of ${obj.objectName} (${obj.objectType})`,
        placeHolder: 'Pick the variant to reuse, or press Esc to skip the catalog and generate fresh.'
      });
      if (!picked) return 'generate-fresh';   // Esc -> proceed with LLM
      entry = picked.entry;
    } else {
      // Single hit -> simple three-way prompt.
      const choice = await vscode.window.showInformationMessage(
        `DarkHorse: ${obj.objectName} (${obj.objectType}) already exists in the catalog ` +
          `from pipeline "${entry.metadata.sourcePipelineTitle}" (accepted ` +
          `${entry.metadata.acceptedAt.split('T')[0]}, used ${entry.usageCount ?? 0}× so far). ` +
          `Reuse, generate fresh, or skip this object?`,
        { modal: false },
        'Reuse from catalog',
        'Generate fresh',
        'Skip this object'
      );
      if (choice === 'Reuse from catalog') {
        // fall through
      } else if (choice === 'Generate fresh') {
        return 'generate-fresh';
      } else if (choice === 'Skip this object') {
        return 'skipped';
      } else {
        // dialog dismissed without choice -> safe default = generate fresh
        return 'generate-fresh';
      }
    }

    // ---- Apply reuse ------------------------------------------------------
    // Mirror what the Accept handler does: write the cached code to the
    // abapGit folder, update the audit-relevant state, bump catalog usage.
    const config = vscode.workspace.getConfiguration();
    const outputFolder = stateManager.getPipelineOutputFolder();
    if (outputFolder) {
      try {
        const { saveAbapGit } = require('./AbapGitWriter');
        const packageName = config.get<string>('darkhorse.pipeline.defaultPackage', '') || '$TMP';
        saveAbapGit({
          objectName:   obj.objectName,
          objectType:   obj.objectType,
          description:  obj.description ?? obj.objectName,
          code:         entry.generatedCode,
          outputFolder,
          packageName
        });
      } catch (err: any) {
        console.warn(`[DarkHorse] tryReuseFromCatalog write failed: ${err?.message ?? err}`);
      }
    }

    // Persist the reused code on the AbapObject so the TDS refresh + report
    // pick it up like any other accepted output.
    const live = stateManager.getState();
    if (live) {
      live.abapObjects[index].generatedCode = entry.generatedCode;
      await stateManager.setState(live);
    }
    await catalog.bumpUsage(entry.id);

    // Best-effort: refresh the TDS .docx + generation report.
    try {
      const { refreshTdsAndReport } = require('./TdsRefresher');
      await refreshTdsAndReport(stateManager);
    } catch { /* non-fatal */ }
    tracker.refresh();
    return 'reused';
  }

  /**
   * Generate code for a single ABAP object.
   * Shows a confirmation dialog, calls LLM, shows diff preview.
   * Returns true if accepted, false if rejected, undefined if skipped/cancelled.
   */
  private static async generateObject(
    index: number,
    obj: AbapObject,
    tdsDoc: TdsDocument,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<boolean | undefined> {

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 47291);
    const totalObjects = stateManager.getState()?.abapObjects.length ?? 1;

    const pipelineTitle = stateManager.getState()?.title ?? 'DarkHorse Pipeline';

    // CPI-6 A9 — pull the FDS corpus once per object so the grounder can
    // extract verbatim anchors. Returns an empty string when no FDS is
    // available (e.g. selective regen on a partial pipeline).
    const fdsCorpus = ObjectCodeGenerator.extractFdsCorpus(stateManager);

    // First-pass generation with no acknowledgements.
    const first = await ObjectCodeGenerator.generateOnce(
      obj, tdsDoc, index, proxyPort, totalObjects, [], pipelineTitle, fdsCorpus
    );
    if (!first.code) {
      return false;
    }

    // Show preview. The regenerator lets the developer acknowledge "not in
    // catalog" findings and retry without losing scroll/context.
    const accepted = await ObjectCodeGenerator.showDiffPreview(
      obj, first.code, stateManager, first.report, first.review, first.autoFix,
      async (acks: string[]) => {
        return ObjectCodeGenerator.generateOnce(
          obj, tdsDoc, index, proxyPort, totalObjects, acks, pipelineTitle, fdsCorpus
        );
      }
    );
    return accepted;
  }

  /** Pull the FDS corpus from state.fdsContent. Returns an empty string when
   *  no FDS is saved (e.g. fresh pipeline or selective regen on a partial
   *  state). FDS content is stored as JSON.stringify(FdsDocument). */
  private static extractFdsCorpus(stateManager: PipelineStateManager): string {
    const state = stateManager.getState();
    const raw = state?.fdsContent;
    if (!raw) return '';
    try {
      const fds = JSON.parse(raw);
      const s = fds?.sections ?? {};
      return [
        fds.title ?? '',
        s.businessBackground     ?? '',
        s.processOverview        ?? '',
        ...((s.functionalRequirements ?? []) as Array<{ description?: string }>).map(r => r.description ?? ''),
        s.inputOutputSpec        ?? '',
        ...(s.businessRules      ?? []),
        ...(s.errorHandling      ?? []),
        s.authorization          ?? '',
        s.reportingRequirements  ?? '',
        s.uiDesign               ?? ''
      ].join('\n');
    } catch {
      return '';
    }
  }

  /**
   * One full generate cycle: ground (MCP) -> prompt -> LLM -> clean -> verify.
   * Reused for the initial generation and for every developer-driven
   * regeneration with acknowledgements.
   */
  private static async generateOnce(
    obj: AbapObject,
    tdsDoc: TdsDocument,
    index: number,
    proxyPort: number,
    totalObjects: number,
    acknowledgements: readonly string[],
    pipelineTitle: string,
    /** CPI-6 A9 — FDS corpus for verbatim-anchor extraction. Pass empty string
     *  to skip anchor grounding (e.g. when called from selective regen and
     *  the FDS is not yet available in state). */
    fdsCorpus: string = ''
  ): Promise<{ code: string; report?: CleanCoreReport; review?: ReviewReport; autoFix?: AutoFixSummary }> {

    const ackSuffix = acknowledgements.length > 0
      ? ` (regen with ${acknowledgements.length} ack)`
      : '';

    let generatedCode = '';
    let usedModel     = 'unknown';
    let promptText    = '';

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `DarkHorse: Generating ${obj.objectName} (${index + 1} of ${totalObjects})${ackSuffix}...`,
      cancellable: false
    }, async (progress) => {
      // Pre-generation grounding via MCP. Fails-open if MCP is down.
      progress.report({ message: 'Grounding via MCP...' });
      let groundingContext: GroundingContext | undefined;
      try {
        // CPI-6 B4 — pass the full TDS object list so the grounder can spot
        // sibling wrapper views (ZI_<TABLE>) and steer the LLM away from
        // direct SELECT FROM <TABLE>.
        const siblings = tdsDoc.sections.abapObjectList ?? [];
        // CPI-6 A9 — fdsCorpus threaded through from generateObject. When
        // non-empty, the grounder extracts verbatim identifiers (txns,
        // tables, BAdIs, field labels) the LLM must reuse unchanged.
        groundingContext = await groundObjectForGeneration(obj, resolveMcpPort(), siblings, fdsCorpus);
      } catch (err: any) {
        console.error('DarkHorse: CodeAgentGrounder threw:', err?.message ?? err);
      }

      progress.report({ message: 'Calling AI...' });
      try {
        promptText = ObjectCodeGenerator.buildPrompt(
          obj, tdsDoc, index, groundingContext, acknowledgements
        );
        const result = await ObjectCodeGenerator.callProxy(proxyPort, {
          prompt:       promptText,
          systemPrompt: ObjectCodeGenerator.getSystemPrompt(),
          maxTokens:    2000,
          sessionId:    `code-${obj.objectName}-${Date.now()}`
        });
        generatedCode = result.code;
        usedModel     = result.model;
        progress.report({ message: 'Done.' });
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DarkHorse: Code generation failed for ${obj.objectName} — ${err.message}`
        );
        generatedCode = '';
      }
    });

    if (!generatedCode) {
      return { code: '' };
    }

    generatedCode = generatedCode
      .replace(/```abap/gi, '')
      .replace(/```/g, '')
      .trim();

    // CPI-6 B3 — enforce the TDS-specified object name. The LLM sometimes
    // emits an invented declaration name (e.g. "define service RFC_DEST" when
    // the TDS specified ZUI_OTC_ROUTING_DETAIL). Rewrite the declaration line
    // so the saved file actually compiles against the TDS object list.
    const nameEnforcement = enforceObjectName(generatedCode, obj.objectName, obj.objectType);
    if (nameEnforcement.rewrites.length > 0) {
      generatedCode = nameEnforcement.code;
      for (const r of nameEnforcement.rewrites) {
        console.log(`[DarkHorse] Name enforcement: ${r.where} ${r.from} -> ${r.to}`);
      }
      vscode.window.showInformationMessage(
        `DarkHorse: Corrected ${nameEnforcement.rewrites.length} declaration name(s) in ${obj.objectName} ` +
        `(LLM emitted ${nameEnforcement.rewrites.map(r => `"${r.from}"`).join(', ')}).`
      );
    }

    // CPI-6 — emit a 16-hex DarkHorse UID, append the audit log entry to the
    // tamper-evident chain, then prepend the canonical header comment block.
    // Any LLM-emitted header is stripped first so we never double up.
    const promptHash = crypto.createHash('sha256')
      .update(promptText, 'utf8').digest('hex');
    const audit = recordGeneration({
      objectName: obj.objectName,
      objectType: obj.objectType,
      model:      usedModel,
      pipelineId: pipelineTitle,
      brRef:      pipelineTitle,
      promptHash
    });
    generatedCode = applyHeader(generatedCode, {
      obj,
      uid:           audit.uid,
      timestamp:     audit.timestamp,
      model:         usedModel,
      pipelineTitle,
      brRef:         pipelineTitle,
      version:       '1.0'
    });

    // Post-generation in parallel:
    //   - CleanCoreVerifier  (deterministic regex + MCP catalog lookup)
    //   - ReviewAgent        (LLM critic; catches judgment-call issues)
    // Acknowledged refs are excluded from the Clean Core verdict so a
    // fully-acknowledged report passes. Both reports surface in the preview;
    // only Clean Core verdict=fail blocks Accept.
    const [reportRes, reviewRes] = await Promise.allSettled([
      verifyGeneratedCode(generatedCode, resolveMcpPort(), acknowledgements),
      reviewGeneratedCode(obj, generatedCode, proxyPort)
    ]);

    let report: CleanCoreReport | undefined;
    if (reportRes.status === 'fulfilled') {
      report = reportRes.value;
    } else {
      console.error('DarkHorse: CleanCoreVerifier threw:', reportRes.reason?.message ?? reportRes.reason);
    }

    let review: ReviewReport | undefined;
    if (reviewRes.status === 'fulfilled') {
      review = reviewRes.value;
    } else {
      console.error('DarkHorse: ReviewAgent threw:', reviewRes.reason?.message ?? reviewRes.reason);
    }

    // Sprint 6 — deterministic auto-fix for direct SAP-table SELECTs when MCP
    // knows the released CDS replacement. Catches the case where the LLM had
    // grounding for VBAK -> I_SalesDocument but still emitted FROM vbak.
    // After rewriting we re-run the verifier (and review) so the panel reflects
    // the corrected state.
    const autoFix = applyCdsAutoFix(generatedCode, report);
    if (autoFix.summary.fixes.length > 0) {
      generatedCode = autoFix.fixedCode;

      const [reportRes2, reviewRes2] = await Promise.allSettled([
        verifyGeneratedCode(generatedCode, resolveMcpPort(), acknowledgements),
        reviewGeneratedCode(obj, generatedCode, proxyPort)
      ]);
      if (reportRes2.status === 'fulfilled') report = reportRes2.value;
      if (reviewRes2.status === 'fulfilled') review = reviewRes2.value;
    }

    return { code: generatedCode, report, review, autoFix: autoFix.summary };
  }

  /**
   * Show generated code as a diff preview in VS Code.
   * Developer reviews and accepts or rejects.
   */
  private static async showDiffPreview(
    obj: AbapObject,
    initialCode: string,
    stateManager: PipelineStateManager,
    initialReport: CleanCoreReport | undefined,
    initialReview: ReviewReport | undefined,
    initialAutoFix: AutoFixSummary | undefined,
    regenerator: (acknowledgements: string[]) => Promise<{ code: string; report?: CleanCoreReport; review?: ReviewReport; autoFix?: AutoFixSummary }>
  ): Promise<boolean> {

    return new Promise(async (resolve) => {
      const panel = vscode.window.createWebviewPanel(
        'darkhorseCodePreview',
        `Generated: ${obj.objectName}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      // Mutable state — the regenerate handler swaps these in place.
      let currentCode    = initialCode;
      let currentReport  = initialReport;
      let currentReview  = initialReview;
      let currentAutoFix = initialAutoFix;
      // Sticky set of acknowledgements across regenerations within this preview.
      const stickyAcks   = new Set<string>();

      panel.webview.html = ObjectCodeGenerator.getPreviewHtml(
        obj, currentCode, currentReport, currentReview, currentAutoFix
      );

      let resolved = false;

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'accept') {
          resolved = true;

          // Copy to clipboard first
          await vscode.env.clipboard.writeText(currentCode);

          // Save state immediately before any other async operations
          const currentState = stateManager.getState();
          if (currentState) {
            const objIndex = currentState.abapObjects.findIndex(
              o => o.objectName === obj.objectName
            );
            if (objIndex >= 0) {
              currentState.abapObjects[objIndex].codeGenerated = true;
              currentState.abapObjects[objIndex].codeAccepted = true;
              // CPI-6 Sprint 6 — store the AI-generated code on the state so
              // the Correction Store can diff later developer edits against it.
              currentState.abapObjects[objIndex].generatedCode = currentCode;
              currentState.currentObjectIndex = objIndex + 1;
              if (currentState.currentObjectIndex >= currentState.abapObjects.length) {
                currentState.currentStage = 'complete';
              }
              await stateManager.setState(currentState);
            }
          }

          panel.dispose();

          // CPI-6 A7 — save in abapGit layout. The output folder becomes a
          // valid abapGit repo (.abapgit.xml + src/package.devc.xml + per-
          // object files using the correct .<type>.<ext> naming) so the
          // developer can cloneTo from ADT directly.
          const config = vscode.workspace.getConfiguration();
          const outputFolder = stateManager.getPipelineOutputFolder();
          if (outputFolder) {
            try {
              const { saveAbapGit } = require('./AbapGitWriter');
              const packageName = config.get<string>('darkhorse.pipeline.defaultPackage', '') || '$TMP';
              const writeResult = saveAbapGit({
                objectName:   obj.objectName,
                objectType:   obj.objectType,
                description:  obj.description ?? obj.objectName,
                code:         currentCode,
                outputFolder,
                packageName
              });
              const primaryPath = writeResult.sourcePath ?? writeResult.metadataPath ?? outputFolder;
              vscode.window.showInformationMessage(
                `DarkHorse: ${obj.objectName} ✓ Saved (abapGit layout) to ${primaryPath}`
              );
              setTimeout(async () => {
                try {
                  if (primaryPath) {
                    const { PipelineGitHelper } = require('./PipelineGitHelper');
                    await PipelineGitHelper.commitCode(primaryPath, obj.objectName, stateManager);
                  }
                } catch { }
              }, 1000);
            } catch {
              vscode.window.showInformationMessage(
                `DarkHorse: ${obj.objectName} code copied to clipboard.`
              );
            }
          }

          // Re-render the TDS .docx and rewrite the generation report so the
          // doc reflects the freshly accepted object. Best-effort — refresh
          // failures don't block the accept flow.
          try {
            const { refreshTdsAndReport } = require('./TdsRefresher');
            await refreshTdsAndReport(stateManager);
          } catch (err: any) {
            console.warn(`[DarkHorse] TdsRefresher invocation failed: ${err?.message ?? err}`);
          }

          // Add this accepted object to the cross-pipeline Reusable Catalog
          // so future pipelines can offer reuse instead of regenerating.
          // De-duplicated by (name, type, code) — re-accepting the same code
          // returns the existing entry id.
          try {
            const { ReusableCatalog } = require('./ReusableCatalog');
            const catalog = new ReusableCatalog(stateManager.getContext());
            const activeState = stateManager.getState();
            await catalog.add({
              objectName:    obj.objectName,
              objectType:    obj.objectType,
              description:   obj.description ?? '',
              keyLogic:      obj.keyLogic ?? [],
              dependencies:  obj.dependencies ?? [],
              generatedCode: currentCode,
              metadata: {
                sourcePipelineId:    activeState?.pipelineId    ?? '',
                sourcePipelineTitle: activeState?.title         ?? '',
                acceptedAt:          new Date().toISOString()
              }
            });
          } catch (err: any) {
            console.warn(`[DarkHorse] ReusableCatalog.add failed: ${err?.message ?? err}`);
          }

          resolve(true);
        } else if (message.command === 'reject') {
          resolved = true;
          panel.dispose();
          resolve(false);
        } else if (message.command === 'generateZWrapper') {
          // One-click Z wrapper action. Generates the Z CDS view file
          // alongside the consuming program, rewrites the FROM clause, and
          // re-runs the verifier + reviewer on the corrected code.
          const table = String(message.table ?? '').trim();
          if (!table) return;

          const outputFolder = stateManager.getPipelineOutputFolder();
          if (!outputFolder) {
            vscode.window.showErrorMessage(
              'DarkHorse: Output folder not configured — cannot save the Z wrapper view.'
            );
            return;
          }

          const pipelineTitle = stateManager.getState()?.title ?? 'DarkHorse Pipeline';

          try {
            const result = await generateZWrapper({
              tableName:     table,
              code:          currentCode,
              obj,
              outputFolder,
              pipelineTitle,
              mcpPort:       resolveMcpPort(),
              model:         'darkhorse-zwrapper-deterministic'
            });

            // Save the new code to file + state if the original was already
            // accepted. For the in-progress preview we just refresh the panel.
            currentCode = result.rewrittenCode;

            // Re-run verifier + reviewer on the rewritten code so the panel
            // reflects the corrected state.
            const proxyPort = vscode.workspace.getConfiguration()
              .get<number>('darkhorse.pipeline.llmProxyPort', 47291);
            const [vRes, rRes] = await Promise.allSettled([
              verifyGeneratedCode(currentCode, resolveMcpPort(), Array.from(stickyAcks)),
              reviewGeneratedCode(obj, currentCode, proxyPort)
            ]);
            if (vRes.status === 'fulfilled') currentReport = vRes.value;
            if (rRes.status === 'fulfilled') currentReview = rRes.value;

            panel.webview.html = ObjectCodeGenerator.getPreviewHtml(
              obj, currentCode, currentReport, currentReview, currentAutoFix
            );

            const fieldsBlurb = result.fieldsUsed.length > 0
              ? `with fields ${result.fieldsUsed.slice(0, 6).join(', ')}${result.fieldsUsed.length > 6 ? '...' : ''}`
              : 'with placeholder fields (review the generated DDL)';
            vscode.window.showInformationMessage(
              `DarkHorse: Generated ${result.zViewName} ${fieldsBlurb}. ${result.rewriteCount} FROM ${table} → FROM ${result.zViewName} rewrites applied. Z view saved to ${result.zViewPath}.`
            );
          } catch (err: any) {
            console.error('DarkHorse: generateZWrapper failed', err);
            vscode.window.showErrorMessage(
              `DarkHorse: Generate Z Wrapper failed — ${err?.message ?? err}`
            );
          }
        } else if (message.command === 'regenerate') {
          // Developer acknowledged one or more findings and wants a fresh
          // generation. We merge into a sticky set so prior acknowledgements
          // survive across multiple regen rounds.
          const newAcks: string[] = Array.isArray(message.acknowledgements)
            ? message.acknowledgements.map((s: any) => String(s)).filter((s: string) => s.length > 0)
            : [];

          // Persist each NEW (not already-sticky) acknowledgement to the MCP
          // seed catalog so future runs treat the object as known valid.
          // We look up the category in the current report so the MCP server
          // writes to the right JSON file. Fails-soft — if the write fails,
          // the in-memory acknowledgement still applies for this regen.
          const findingsByRef = new Map<string, CleanCoreFinding>();
          for (const f of (currentReport?.findings ?? [])) {
            findingsByRef.set(f.reference.toUpperCase(), f);
          }
          const port = resolveMcpPort();
          const writes: Promise<unknown>[] = [];
          for (const ack of newAcks) {
            const key = ack.toUpperCase();
            if (stickyAcks.has(key)) continue;   // already persisted earlier this preview
            const finding = findingsByRef.get(key);
            // Today only 'exit' findings reach the Acknowledge checkbox; future
            // BAdI / FM scanners can extend this map.
            const mcpCategory: 'exit' | 'badi' | null =
              finding?.category === 'exit' ? 'exit' : null;
            if (mcpCategory) {
              writes.push(acknowledgeCatalogEntry(ack, mcpCategory, port));
            }
            stickyAcks.add(key);
          }
          await Promise.all(writes);

          try {
            const result = await regenerator(Array.from(stickyAcks));
            if (result.code) {
              currentCode    = result.code;
              currentReport  = result.report;
              currentReview  = result.review;
              currentAutoFix = result.autoFix;
              panel.webview.html = ObjectCodeGenerator.getPreviewHtml(
                obj, currentCode, currentReport, currentReview, currentAutoFix
              );
            } else {
              vscode.window.showErrorMessage(
                `DarkHorse: regeneration for ${obj.objectName} produced no code.`
              );
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `DarkHorse: regeneration failed — ${err?.message ?? err}`
            );
          }
        }
      });

      panel.onDidDispose(() => {
        if (!resolved) {
          resolve(false);
        }
      });
    });
  }

  private static buildPrompt(
    obj: AbapObject,
    tds: TdsDocument,
    index: number,
    groundingContext?: GroundingContext,
    acknowledgements: readonly string[] = []
  ): string {
    const prevObj = index > 0
      ? tds.sections.abapObjectList[index - 1]
      : null;
    const nextObj = index < tds.sections.abapObjectList.length - 1
      ? tds.sections.abapObjectList[index + 1]
      : null;

    const groundingBlock = groundingContext
      ? renderGroundingForPrompt(groundingContext)
      : '';

    const groundingSection = groundingBlock
      ? `\n\n${groundingBlock}\n`
      : '';

    const standardsBlock   = renderStandardsForPrompt();
    const standardsSection = standardsBlock ? `${standardsBlock}\n\n` : '';

    const ackSection = acknowledgements.length === 0 ? '' : `

## Developer Acknowledgements
The following SAP objects have been explicitly confirmed by the developer as
real, released SAP artifacts (even though the DarkHorse seed catalog does not
yet contain them). You MAY reference these by name in the generated code:

${acknowledgements.map(a => `- ${a} (developer-acknowledged valid SAP object)`).join('\n')}

Use the acknowledged names exactly as written. Do not invent variant names.
`;

    return `${standardsSection}Generate complete, production-ready ABAP code for this SAP object.

Object Details:
- Type: ${obj.objectType}
- Name: ${obj.objectName}
- Description: ${obj.description}

Key Logic to implement:
${obj.keyLogic.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Dependencies:
${obj.dependencies.join(', ') || 'None specified'}

Context:
- Previous object: ${prevObj ? `${prevObj.objectName} (${prevObj.objectType})` : 'None'}
- Next object: ${nextObj ? `${nextObj.objectName} (${nextObj.objectType})` : 'None'}
- Technical approach: ${tds.sections.technicalApproach}
- Database strategy: ${tds.sections.dbDesign}
${groundingSection}${ackSection}
Return ONLY the complete ABAP source code. No explanation. No markdown fences.
Start with REPORT ${obj.objectName}. or CLASS ${obj.objectName} DEFINITION. as appropriate.`;
  }

  private static getSystemPrompt(): string {
    return `You are an expert SAP ABAP developer with 15 years of experience writing
Clean Core compliant code for S/4HANA Cloud and Private editions.

The user prompt MAY include a "## Grounded SAP knowledge (CPI-6 Sprint 3)" section.
If present, that section contains REAL SAP object names, RAP patterns, EML templates,
CDS view names, and SLG1 patterns retrieved live from the DarkHorse MCP knowledge
service. You MUST use those exact names and templates in the generated code. Do
not invent SAP object names when the grounding section provides them. The grounding
is authoritative — it overrides anything your training data suggests.

# UI / report / form policy — Fiori first
- ANY user-facing object (report / list / detail screen / dashboard / worklist) MUST be implemented as a Fiori Elements app (List Report / Object Page / Analytical List Page / Overview Page / Worklist). Generate the CDS projection view + RAP projection BDEF + SRVD + SRVB + manifest.json — NOT a classic ALV report or DYNPRO screen.
- ANY print or interactive output MUST be implemented as an SAP Adobe Form (FP_FUNCTION_MODULE_NAME-driven). Generate the form interface signature and the driver class — NOT SAPscript, NOT Smart Forms (legacy).
- Freestyle SAPUI5 is acceptable ONLY when the grounding section says so (custom controls / third-party libraries / multi-step wizards / consumer-grade UX). In every other case Fiori Elements is correct.
- CL_GUI_ALV_GRID / CL_SALV_TABLE / CALL SCREEN / WRITE statements / OPEN_FORM / SSF_FUNCTION_MODULE_NAME are Level B fallbacks. Generate them only when the grounding section explicitly requests a legacy fallback.

Clean Core compliance rules — apply in this order:
- Reads: ONLY via released CDS interface views (I_*). NEVER SELECT directly from
  SAP standard tables (VBAK, MARA, KNA1, BKPF, BSEG, EKKO, etc.). The grounding
  section names the correct CDS view per table when applicable.
- Writes on RAP-managed entities: ONLY via EML (MODIFY ENTITIES ... CREATE/UPDATE/
  DELETE ... COMMIT ENTITIES). The grounding section provides EML templates.
- Custom persistent data: use the CBO framework (CDS + managed BDEF), not
  Z* tables with direct INSERTs.
- Enhancements: ONLY released BAdIs in published enhancement spots. Classic
  user exits (USEREXIT_*) are Level B and acceptable only when no released
  BAdI exists. NEVER reference USEREXIT_ATP_QUANTITY — it does not exist;
  ATP_CUST_BADI is the real extension point.
- Logging: ALWAYS use SAP Application Log (SLG1) via BAL_LOG_CREATE /
  BAL_LOG_MSG_ADD / BAL_DB_SAVE. NEVER create custom Z log tables.
- Background processing: use Application Jobs framework (IF_APJ_RT_RUN) —
  NOT classic SM37 / JOB_OPEN.

General quality rules:
- Always check SY-SUBRC after CDS/table operations and CALL FUNCTION
- Use CL_SALV_TABLE for classic ALV output (acceptable Level B for reports)
- Use AUTHORITY-CHECK where authorization objects are mentioned in the TDS
- Follow SAP naming conventions (Z prefix for custom objects)
- Never SELECT * — always specify fields
- Never DELETE / UPDATE without a WHERE clause
- Never release transports from code
- Add concise inline comments only where the logic is non-obvious

# Worked examples — DO follow these patterns

## Example 1 — Reading sales order header data
WRONG (Level C — direct SELECT on SAP standard table):
\`\`\`
SELECT vbeln, vkorg, kunnr, netwr
  FROM vbak
  INTO TABLE @DATA(lt_orders)
  WHERE vkorg = '1000'.
\`\`\`

CORRECT (Level A — released CDS interface view):
\`\`\`
SELECT salesorder, salesorganization, soldtoparty, totalnetamount
  FROM i_salesorder
  INTO TABLE @DATA(lt_orders)
  WHERE salesorganization = '1000'.
IF sy-subrc <> 0.
  " no data — caller handles
ENDIF.
\`\`\`

## Example 2 — Creating a sales order
WRONG (Level B — classic BAPI when a released RAP BDEF exists):
\`\`\`
CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'
  EXPORTING order_header_in = ls_header
  IMPORTING salesdocument   = lv_doc
  TABLES    return           = lt_return.
COMMIT WORK.
\`\`\`

CORRECT (Level A — EML against the released RAP behavior definition):
\`\`\`
MODIFY ENTITIES OF i_salesordertp
  ENTITY salesorder
    CREATE FIELDS ( salesorganization distributionchannel division )
    WITH VALUE #( ( %cid                 = 'cid_so_1'
                    salesorganization    = '1000'
                    distributionchannel  = '10'
                    division             = '00' ) )
    MAPPED   DATA(ls_mapped)
    FAILED   DATA(ls_failed)
    REPORTED DATA(ls_reported).

COMMIT ENTITIES RESPONSE OF i_salesordertp
  FAILED   DATA(ls_commit_failed)
  REPORTED DATA(ls_commit_reported).
\`\`\`

## Example 3 — Logging an error
WRONG (Level C — custom Z log table):
\`\`\`
INSERT INTO z_error_log VALUES @( VALUE #(
  log_date    = sy-datum
  log_time    = sy-uzeit
  log_user    = sy-uname
  log_message = 'ATP check failed' ) ).
\`\`\`

CORRECT (Level A — SAP Application Log via SLG1):
\`\`\`
DATA: lv_log_handle TYPE balloghndl,
      ls_log        TYPE bal_s_log,
      ls_msg        TYPE bal_s_msg.

ls_log-object    = 'Z_DARKHORSE'.
ls_log-subobject = 'Z_BACKORDER'.
ls_log-aldate    = sy-datum.
ls_log-altime    = sy-uzeit.
ls_log-aluser    = sy-uname.

CALL FUNCTION 'BAL_LOG_CREATE'
  EXPORTING  i_s_log      = ls_log
  IMPORTING  e_log_handle = lv_log_handle.

ls_msg-msgty = 'E'.
ls_msg-msgid = 'ZDH'.
ls_msg-msgno = '001'.
ls_msg-msgv1 = 'ATP check failed'.

CALL FUNCTION 'BAL_LOG_MSG_ADD'
  EXPORTING  i_log_handle = lv_log_handle
             i_s_msg      = ls_msg.

CALL FUNCTION 'BAL_DB_SAVE'
  EXPORTING  i_save_all   = abap_true.
\`\`\`

# Output format
Return ONLY the ABAP / CDS / DDL source code. No markdown fences. No explanation outside source comments.
Start directly with the source declaration: REPORT, CLASS ... DEFINITION, INTERFACE, "define view ...", "managed implementation ...", or whatever the TDS objectType requires.

# Header policy — important
DO NOT emit a top-of-file header comment block describing the object (Object Name / Function / Business Purpose / Model / UID etc.). DarkHorse appends a deterministic, audit-grade header AFTER your generation that includes the AI model name, generation timestamp, and a 16-hex tamper-evident UID linked to a per-developer audit log. Any header you write will be stripped and replaced.

Inline comments inside the BODY of the code remain REQUIRED — explain non-obvious logic, name SAP authorization checks, mark validation / determination boundaries, document EML side effects, and call out the WHY (not just the WHAT) for any business rule.`;
  }

  private static escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static renderCleanCoreReport(report?: CleanCoreReport): string {
    if (!report) {
      return '';
    }

    if (report.mcpUnavailable) {
      return `
  <div class="cc-report cc-skipped">
    <div class="cc-header">
      <span class="cc-badge cc-badge-skip">CLEAN CORE</span>
      <span class="cc-verdict">MCP server unavailable — verification skipped</span>
    </div>
    <div class="cc-notes">
      ${report.notes.map(n => `<div>• ${ObjectCodeGenerator.escapeHtml(n)}</div>`).join('')}
    </div>
  </div>`;
    }

    const verdictLabel: Record<string, string> = {
      pass:    'PASS — no Clean Core violations detected',
      warn:    'WARN — Level C references present',
      fail:    'FAIL — Level D references present',
      skipped: 'SKIPPED'
    };
    const verdictClass: Record<string, string> = {
      pass: 'cc-pass', warn: 'cc-warn', fail: 'cc-fail', skipped: 'cc-skipped'
    };

    // A finding qualifies for the Acknowledge action when MCP reported it as
    // "not in the catalog" (exists=false AND level=null) — i.e., we couldn't
    // confirm or deny the object's existence. Developers familiar with the
    // SAP system can mark these as real to keep them in the next regenerate.
    const isAcknowledgeable = (f: CleanCoreFinding): boolean =>
      !f.acknowledged && f.exists === false && f.level === null;

    const acknowledgeableCount = report.findings.filter(isAcknowledgeable).length;

    const findingsHtml = report.findings.length === 0
      ? '<div class="cc-empty">No SAP references required verification.</div>'
      : `<table class="cc-table">
           <thead>
             <tr>
               <th>Level</th><th>Reference</th><th>Category</th>
               <th>Count</th><th>Suggested alternative</th><th>Notes</th>
               <th class="cc-action-col">Action</th>
             </tr>
           </thead>
           <tbody>
             ${report.findings.map(f => {
               const lvl = f.level ?? '?';
               const lvlClass = `cc-lvl-${(f.level ?? 'unknown').toLowerCase()}`;
               const refEsc = ObjectCodeGenerator.escapeHtml(f.reference);
               const rowClass = f.acknowledged ? 'cc-ack-row' : '';
               let actionCell = '<td class="cc-action-col"></td>';
               if (f.acknowledged) {
                 actionCell = '<td class="cc-action-col"><span class="cc-ack-badge">ACK</span></td>';
               } else if (isAcknowledgeable(f)) {
                 actionCell = `<td class="cc-action-col">
                   <label class="cc-ack-label">
                     <input type="checkbox" class="cc-ack-check" data-ref="${refEsc}"/>
                     <span>Acknowledge as valid</span>
                   </label>
                 </td>`;
               } else if (f.category === 'table' && f.level === 'C') {
                 // Level C table finding — offer one-click Z wrapper generation
                 actionCell = `<td class="cc-action-col">
                   <button class="cc-zwrap-btn" data-table="${refEsc}" onclick="ccGenerateZWrapper(this)">
                     🔧 Generate Z Wrapper
                   </button>
                 </td>`;
               }
               return `<tr class="${rowClass}">
                 <td><span class="cc-lvl ${lvlClass}">${lvl}</span></td>
                 <td class="cc-mono">${refEsc}</td>
                 <td>${f.category}</td>
                 <td>${f.occurrences}</td>
                 <td class="cc-mono">${ObjectCodeGenerator.escapeHtml(f.alternative ?? '—')}</td>
                 <td>${ObjectCodeGenerator.escapeHtml(f.description)}</td>
                 ${actionCell}
               </tr>`;
             }).join('')}
           </tbody>
         </table>`;

    const regenBar = acknowledgeableCount > 0
      ? `<div class="cc-regen-bar">
           <span class="cc-regen-hint">Tick "Acknowledge as valid" for each object MCP couldn't find but you know is a real SAP artifact. Each acknowledgement is written to the DarkHorse seed catalog so future runs treat it as known valid (Level B), then regenerate with the developer acknowledgements passed into the prompt.</span>
           <button id="ccRegenBtn" class="cc-regen-btn" disabled onclick="ccRegenerate()">
             ↻ Save &amp; Regenerate with <span id="ccAckCount">0</span> acknowledgement(s)
           </button>
         </div>`
      : '';

    return `
  <div class="cc-report ${verdictClass[report.verdict] ?? ''}">
    <div class="cc-header">
      <span class="cc-badge">CLEAN CORE — CPI-6</span>
      <span class="cc-verdict">${verdictLabel[report.verdict] ?? report.verdict}</span>
      <span class="cc-counts">
        <span class="cc-lvl cc-lvl-d">D: ${report.countsByLevel.D}</span>
        <span class="cc-lvl cc-lvl-c">C: ${report.countsByLevel.C}</span>
        <span class="cc-lvl cc-lvl-b">B: ${report.countsByLevel.B}</span>
        <span class="cc-lvl cc-lvl-a">A: ${report.countsByLevel.A}</span>
      </span>
    </div>
    ${findingsHtml}
    ${regenBar}
  </div>`;
  }

  private static renderReviewReport(report?: ReviewReport): string {
    if (!report || report.unavailable) {
      return '';
    }
    const sevLabel: Record<ReviewSeverity, string> = {
      critical: 'CRITICAL', major: 'MAJOR', minor: 'MINOR', info: 'INFO'
    };
    const sevClass: Record<ReviewSeverity, string> = {
      critical: 'rv-sev-critical', major: 'rv-sev-major',
      minor: 'rv-sev-minor', info: 'rv-sev-info'
    };
    const c = report.counts;
    const hasFindings = report.findings.length > 0;

    const findingsHtml = hasFindings
      ? `<table class="rv-table">
           <thead>
             <tr>
               <th>Severity</th><th>Category</th><th>Location</th>
               <th>Description</th><th>Suggestion</th>
             </tr>
           </thead>
           <tbody>
             ${report.findings.map(f => `<tr>
               <td><span class="rv-sev ${sevClass[f.severity]}">${sevLabel[f.severity]}</span></td>
               <td>${ObjectCodeGenerator.escapeHtml(f.category)}</td>
               <td class="rv-mono">${ObjectCodeGenerator.escapeHtml(f.location || '—')}</td>
               <td>${ObjectCodeGenerator.escapeHtml(f.description)}</td>
               <td>${ObjectCodeGenerator.escapeHtml(f.suggestion || '—')}</td>
             </tr>`).join('')}
           </tbody>
         </table>`
      : `<div class="rv-empty">No findings.</div>`;

    const verdictClass = c.critical > 0 ? 'rv-fail'
                        : c.major   > 0 ? 'rv-warn'
                        : 'rv-pass';

    return `
  <div class="rv-report ${verdictClass}">
    <div class="rv-header">
      <span class="rv-badge">REVIEW AGENT — CPI-6</span>
      <span class="rv-summary">${ObjectCodeGenerator.escapeHtml(report.summary)}</span>
      <span class="rv-counts">
        <span class="rv-sev rv-sev-critical">Critical: ${c.critical}</span>
        <span class="rv-sev rv-sev-major">Major: ${c.major}</span>
        <span class="rv-sev rv-sev-minor">Minor: ${c.minor}</span>
        <span class="rv-sev rv-sev-info">Info: ${c.info}</span>
      </span>
    </div>
    ${findingsHtml}
  </div>`;
  }

  private static renderAutoFixBanner(autoFix?: AutoFixSummary): string {
    if (!autoFix || autoFix.fixes.length === 0) return '';
    const rows = autoFix.fixes.map(f =>
      `<li><span class="af-mono">FROM ${ObjectCodeGenerator.escapeHtml(f.table)}</span> ` +
      `&rarr; <span class="af-mono">FROM ${ObjectCodeGenerator.escapeHtml(f.cdsView)}</span> ` +
      `(${f.occurrences} occurrence${f.occurrences === 1 ? '' : 's'})</li>`
    ).join('');
    return `
  <div class="af-banner">
    <div class="af-title">ℹ️ Auto-fix applied — direct SAP-table SELECTs rewritten to released CDS views</div>
    <ul class="af-list">${rows}</ul>
    <div class="af-caveat">
      The FROM clause was rewritten deterministically. CDS field names may differ
      from the original table fields (e.g. <span class="af-mono">vbak-vbeln</span>
      &rarr; <span class="af-mono">salesorder</span>). Review SELECT field lists
      and any <span class="af-mono">~</span> alias references before accepting.
    </div>
  </div>`;
  }

  private static getPreviewHtml(
    obj: AbapObject,
    code: string,
    cleanCoreReport?: CleanCoreReport,
    reviewReport?: ReviewReport,
    autoFix?: AutoFixSummary
  ): string {
    const escapedCode = ObjectCodeGenerator.escapeHtml(code);

    const lineCount = code.split('\n').length;

    const autoFixHtml   = ObjectCodeGenerator.renderAutoFixBanner(autoFix);
    const cleanCoreHtml = ObjectCodeGenerator.renderCleanCoreReport(cleanCoreReport);
    const reviewHtml    = ObjectCodeGenerator.renderReviewReport(reviewReport);

    // CPI-6 hard gate: a Level D finding blocks Accept. The developer must
    // either acknowledge any "not in catalog" finding they know is real
    // (which removes them from the verdict count), reject and refine the BR,
    // or manually edit the seed catalog if a known-hallucination entry is
    // mis-flagged.
    const isHardFail =
      cleanCoreReport !== undefined &&
      cleanCoreReport.verdict === 'fail';
    const acceptDisabled = isHardFail ? 'disabled' : '';
    const failBannerHtml = isHardFail
      ? `<div class="cc-fail-banner">
           <div class="cc-fail-title">🚫 Cannot accept — Level D Clean Core violation present</div>
           <div class="cc-fail-body">
             The Clean Core verifier found ${cleanCoreReport!.countsByLevel.D} Level&nbsp;D
             reference(s) in the generated code (prohibited per the Clean Core
             contract). The Accept button is disabled until you resolve them.
             Choose one of:
             <ul>
               <li>If the finding is in the "Acknowledge as valid" column, tick it
                   and click <em>Save &amp; Regenerate</em> — this writes the
                   acknowledgement to the seed catalog and re-runs generation.</li>
               <li>Click <em>Reject</em>, then refine the Business Requirement to
                   avoid the prohibited pattern.</li>
               <li>For catalog-flagged hallucinations (e.g. USEREXIT_ATP_QUANTITY),
                   the catalog is authoritative — edit the JSON only if you have
                   verified evidence the entry is wrong.</li>
             </ul>
           </div>
         </div>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
    }
    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left h2 { color: #58a6ff; font-size: 16px; }
    .header-left p { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .header-actions { display: flex; gap: 10px; }
    button {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
    }
    .btn-accept { background: #238636; color: #fff; }
    .btn-accept:hover:not(:disabled) { background: #2ea043; }
    .btn-accept:disabled {
      background: #30363d; color: #6e7681; cursor: not-allowed;
      border: 1px dashed #da3633;
    }
    .btn-reject { background: #da3633; color: #fff; }
    .btn-reject:hover { background: #f85149; }
    .cc-fail-banner {
      background: #3a0a0a; border: 2px solid #f85149; border-radius: 8px;
      padding: 16px 20px; margin: 0 24px 16px;
    }
    .cc-fail-title { color: #f85149; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
    .cc-fail-body { color: #e6edf3; font-size: 13px; line-height: 1.6; }
    .cc-fail-body ul { margin: 8px 0 0 20px; }
    .cc-fail-body li { margin-bottom: 4px; }
    .cc-fail-body em { color: #79c0ff; font-style: normal; font-weight: 600; }
    .meta-bar {
      background: #1c2128;
      border-bottom: 1px solid #30363d;
      padding: 10px 24px;
      display: flex;
      gap: 24px;
      font-size: 12px;
      color: #8b949e;
    }
    .meta-bar span { color: #58a6ff; font-weight: 600; }
    .code-container {
      padding: 24px;
      overflow: auto;
    }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #e6edf3;
      white-space: pre-wrap;
      word-wrap: break-word;
      counter-reset: line;
    }
    .note {
      background: #1f3a5f;
      border: 1px solid #1f6feb;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 12px;
      color: #79c0ff;
      margin: 0 24px 16px;
    }
    /* Clean Core report panel (CPI-6 Sprint 1) */
    .cc-report {
      margin: 0 24px 16px;
      border-radius: 8px;
      padding: 14px 18px;
      font-size: 12px;
      border: 1px solid #30363d;
      background: #161b22;
    }
    .cc-report.cc-pass    { border-color: #238636; }
    .cc-report.cc-warn    { border-color: #d29922; }
    .cc-report.cc-fail    { border-color: #da3633; }
    .cc-report.cc-skipped { border-color: #6e7681; }
    .cc-header {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .cc-badge {
      background: #1f6feb;
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .cc-badge.cc-badge-skip { background: #6e7681; }
    .cc-verdict { color: #e6edf3; font-weight: 600; }
    .cc-counts { margin-left: auto; display: flex; gap: 6px; }
    .cc-lvl {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 4px;
      font-weight: 700;
      color: #fff;
    }
    .cc-lvl-a { background: #238636; }
    .cc-lvl-b { background: #1f6feb; }
    .cc-lvl-c { background: #d29922; color: #0d1117; }
    .cc-lvl-d { background: #da3633; }
    .cc-lvl-unknown { background: #6e7681; }
    .cc-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
    }
    .cc-table th, .cc-table td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid #30363d;
      vertical-align: top;
    }
    .cc-table th { color: #8b949e; font-weight: 600; }
    .cc-mono { font-family: 'Consolas', 'Courier New', monospace; color: #79c0ff; }
    .cc-empty { color: #8b949e; padding: 4px 0; }
    .cc-notes { color: #8b949e; line-height: 1.6; }
    .cc-action-col { width: 200px; white-space: nowrap; }
    .cc-ack-label { display: inline-flex; align-items: center; gap: 6px;
      color: #79c0ff; cursor: pointer; font-size: 12px; }
    .cc-ack-label input { accent-color: #1f6feb; }
    .cc-ack-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      background: #1a3a1a; color: #3fb950; font-weight: 700;
      font-size: 11px; letter-spacing: 0.5px; border: 1px solid #238636;
    }
    .cc-ack-row td { opacity: 0.55; }
    .cc-ack-row .cc-mono { text-decoration: line-through; }
    .cc-regen-bar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-top: 12px; padding: 10px 12px;
      background: #1a2d4a; border: 1px solid #1f6feb; border-radius: 6px;
    }
    .cc-regen-hint { color: #79c0ff; font-size: 12px; flex: 1; }
    .cc-regen-btn {
      padding: 6px 14px; border-radius: 4px; border: none;
      background: #1f6feb; color: #fff; font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .cc-regen-btn:hover:not(:disabled) { background: #388bfd; }
    .cc-regen-btn:disabled { background: #30363d; color: #6e7681; cursor: not-allowed; }
    .cc-zwrap-btn {
      padding: 4px 10px; border-radius: 4px; border: none;
      background: #d29922; color: #0d1117; font-size: 11px; font-weight: 700;
      cursor: pointer; white-space: nowrap;
    }
    .cc-zwrap-btn:hover { background: #e3b341; }
    .cc-zwrap-btn:disabled { background: #30363d; color: #6e7681; cursor: not-allowed; }
    /* Review Agent panel (CPI-6 Sprint 6) */
    .rv-report {
      margin: 0 24px 16px;
      border-radius: 8px;
      padding: 14px 18px;
      font-size: 12px;
      border: 1px solid #30363d;
      background: #161b22;
    }
    .rv-report.rv-pass { border-color: #238636; }
    .rv-report.rv-warn { border-color: #d29922; }
    .rv-report.rv-fail { border-color: #da3633; }
    .rv-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .rv-badge {
      background: #6e7681;
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .rv-summary { color: #e6edf3; font-weight: 500; flex: 1; min-width: 200px; }
    .rv-counts { display: flex; gap: 6px; }
    .rv-sev {
      display: inline-block;
      padding: 1px 7px;
      border-radius: 4px;
      font-weight: 700;
      color: #fff;
      font-size: 11px;
    }
    .rv-sev-critical { background: #da3633; }
    .rv-sev-major    { background: #d29922; color: #0d1117; }
    .rv-sev-minor    { background: #1f6feb; }
    .rv-sev-info     { background: #6e7681; }
    .rv-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    .rv-table th, .rv-table td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid #30363d;
      vertical-align: top;
    }
    .rv-table th { color: #8b949e; font-weight: 600; }
    .rv-mono { font-family: 'Consolas', 'Courier New', monospace; color: #79c0ff; }
    .rv-empty { color: #8b949e; padding: 4px 0; }
    /* Auto-fix banner */
    .af-banner {
      margin: 0 24px 16px;
      padding: 12px 16px;
      background: #0d2942;
      border: 1px solid #1f6feb;
      border-radius: 8px;
      font-size: 12px;
      color: #c9d1d9;
    }
    .af-title { font-weight: 700; color: #79c0ff; margin-bottom: 6px; }
    .af-list  { margin: 4px 0 8px 24px; padding: 0; }
    .af-list li { margin-bottom: 2px; }
    .af-mono  { font-family: 'Consolas', 'Courier New', monospace; color: #79c0ff; }
    .af-caveat { color: #8b949e; line-height: 1.5; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h2>💻 Generated Code — ${obj.objectName}</h2>
      <p>${obj.objectType} | ${obj.description}</p>
    </div>
    <div class="header-actions">
      <button class="btn-reject" onclick="reject()">✗ Reject</button>
      <button class="btn-accept" onclick="accept()" ${acceptDisabled}>✓ Accept & Copy to Clipboard</button>
    </div>
  </div>

  <div class="meta-bar">
    <div>Object: <span>${obj.objectName}</span></div>
    <div>Type: <span>${obj.objectType}</span></div>
    <div>Lines: <span>${lineCount}</span></div>
  </div>

  <div class="note">
    📋 Accepting will copy the code to your clipboard.
    Paste it into SAP ADT, SE38, or the DarkHorse ABAP editor.
    The code has NOT been automatically saved to SAP.
  </div>

  ${autoFixHtml}

  ${failBannerHtml}

  ${cleanCoreHtml}

  ${reviewHtml}

  <div class="code-container">
    <pre>${escapedCode}</pre>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function accept() { vscode.postMessage({ command: 'accept' }); }
    function reject() { vscode.postMessage({ command: 'reject' }); }

    // Clean Core acknowledge/regenerate wiring (re-runs on every webview render)
    (function () {
      const checks = document.querySelectorAll('.cc-ack-check');
      const btn = document.getElementById('ccRegenBtn');
      const counter = document.getElementById('ccAckCount');
      if (!btn) return;
      function refreshState() {
        const n = Array.from(checks).filter(c => c.checked).length;
        if (counter) counter.textContent = String(n);
        btn.disabled = n === 0;
      }
      checks.forEach(c => c.addEventListener('change', refreshState));
      refreshState();
    })();

    function ccRegenerate() {
      const acks = Array.from(document.querySelectorAll('.cc-ack-check'))
        .filter(c => c.checked)
        .map(c => c.getAttribute('data-ref'))
        .filter(Boolean);
      if (acks.length === 0) return;
      vscode.postMessage({ command: 'regenerate', acknowledgements: acks });
    }

    function ccGenerateZWrapper(btn) {
      const table = btn.getAttribute('data-table');
      if (!table) return;
      btn.disabled = true;
      btn.textContent = 'Working...';
      vscode.postMessage({ command: 'generateZWrapper', table: table });
    }
  </script>
</body>
</html>`;
  }

  private static callProxy(port: number, body: object): Promise<{ code: string; model: string }> {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const payload = JSON.stringify(body);

      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 120000  // 2 minutes for code generation
      };

      const req = http.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error ?? `Proxy error: ${res.statusCode}`));
              return;
            }
            resolve({
              code:  parsed.code ?? parsed.content ?? '',
              model: parsed.model ?? 'unknown'
            });
          } catch {
            resolve({ code: data, model: 'unknown' });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Code generation timed out after 2 minutes. Try again.'));
      });

      req.on('error', (err: any) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}