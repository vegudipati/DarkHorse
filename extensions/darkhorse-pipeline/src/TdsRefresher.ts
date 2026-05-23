/**
 * TdsRefresher — keep the TDS .docx + a generation report aligned with what
 * was actually built, without touching the FDS (which is a business artefact).
 *
 * Invoked after:
 *   - Accept (ObjectCodeGenerator) — one object just flipped to accepted
 *   - Approve (TdsReviewPanel)      — auto-fill may have added objects
 *
 * Two outputs:
 *   1. The original TDS .docx is re-rendered with the current abapObjectList
 *      and per-object status markers ([Accepted ✓] / [Pending] / [Auto-added])
 *      so anyone reading the doc sees what reality is. Uses the same client-
 *      template-or-fallback logic as TdsGenerator so client formatting is
 *      preserved when a template is configured.
 *
 *   2. A sibling pipeline-generation-report.md captures the wider picture:
 *      pipeline metadata, full object grid with statuses, what auto-fill
 *      added, and a placeholder for FDS divergence (so analysts can decide
 *      whether the FDS needs revision).
 *
 * Failure handling: every operation is best-effort. If we can't parse the
 * TDS JSON, can't write the .docx, or can't write the .md, we log and
 * continue — refresh is convenience, not correctness.
 */

'use strict';

import * as fs   from 'fs';
import * as path from 'path';

import { PipelineStateManager, AbapObject } from './PipelineStateManager';
import { DocxWriter, TdsDocument }          from './DocxWriter';
import { resolveTemplate }                  from './TemplateConfig';
import { renderIntoTemplateFile }           from './TemplateRenderer';
import { TdsGenerator }                     from './TdsGenerator';
import { AUTOFILL_TAG }                     from './ThreeLayerVerifier';

// ---------------------------------------------------------------------------
// Status markers
// ---------------------------------------------------------------------------

type Status = 'accepted' | 'generated' | 'pending';

function statusOf(obj: AbapObject): Status {
  if (obj.codeAccepted)  return 'accepted';
  if (obj.codeGenerated) return 'generated';
  return 'pending';
}

function statusBadge(s: Status): string {
  switch (s) {
    case 'accepted':  return '[Accepted ✓]';
    case 'generated': return '[Generated — pending review]';
    case 'pending':   return '[Pending]';
  }
}

function isAutoAdded(obj: AbapObject): boolean {
  return (obj.description ?? '').startsWith(AUTOFILL_TAG);
}

// ---------------------------------------------------------------------------
// Build the updated object list with status decoration
// ---------------------------------------------------------------------------

function decorate(objects: ReadonlyArray<AbapObject>) {
  return objects.map(o => ({
    sequence:     o.sequence,
    objectType:   o.objectType,
    objectName:   o.objectName,
    /** Description prefixed with the status badge so it surfaces in
     *  both client-template renders and the generic DocxWriter render. */
    description:  `${statusBadge(statusOf(o))} ${o.description ?? ''}`.trim(),
    keyLogic:     o.keyLogic ?? [],
    dependencies: o.dependencies ?? []
  }));
}

// ---------------------------------------------------------------------------
// Re-render the .docx
// ---------------------------------------------------------------------------

async function reRenderDocxAsync(tdsDoc: TdsDocument, filePath: string, ricefwType: string): Promise<void> {
  const tpl = resolveTemplate(ricefwType, 'tds');
  if (tpl) {
    try {
      const fields = TdsGenerator.flattenForTemplate(tdsDoc);
      renderIntoTemplateFile(tpl, fields, filePath);
      return;
    } catch (err: any) {
      console.warn(`[DarkHorse] TdsRefresher: client template render failed (${err?.message ?? err}); falling back to DocxWriter.`);
    }
  }
  await DocxWriter.writeTds(tdsDoc, filePath);
}

// ---------------------------------------------------------------------------
// Build the pipeline-generation-report.md
// ---------------------------------------------------------------------------

function buildReport(state: any, tdsDoc: TdsDocument): string {
  const now = new Date().toISOString();
  const objects: AbapObject[] = state?.abapObjects ?? [];

  const counts = {
    total:     objects.length,
    accepted:  objects.filter(o => statusOf(o) === 'accepted').length,
    generated: objects.filter(o => statusOf(o) === 'generated').length,
    pending:   objects.filter(o => statusOf(o) === 'pending').length,
    autoAdded: objects.filter(isAutoAdded).length
  };

  const objectsTable = [
    '| # | Type | Name | Status | Auto-added | Description |',
    '|---|------|------|--------|------------|-------------|',
    ...objects.map(o => {
      const desc = (o.description ?? '').replace(AUTOFILL_TAG, '').trim();
      return `| ${o.sequence} | ${o.objectType} | \`${o.objectName}\` | ${statusBadge(statusOf(o))} | ${isAutoAdded(o) ? 'yes' : 'no'} | ${desc.replace(/\|/g, '\\|')} |`;
    })
  ].join('\n');

  const autoAddedSection = counts.autoAdded === 0
    ? '_No objects were auto-added. The TDS Agent produced the complete layer set on its own._'
    : [
        'These objects were added by DarkHorse to complete the Clean Core three-layer set.',
        'Review each one — if any aren\'t needed (e.g. the entity isn\'t actually service-exposed),',
        'remove them from the object list before regenerating.',
        '',
        ...objects.filter(isAutoAdded).map(o =>
          `- **${o.objectType} ${o.objectName}** — ${(o.description ?? '').replace(AUTOFILL_TAG, '').trim()}`
        )
      ].join('\n');

  const divergenceNote = [
    'This report does not currently diff the generated object list against the',
    'original FDS specification. If the final object list materially differs',
    'from the FDS (e.g. layers split differently, new building-block views',
    'introduced, or transactional scope changed), flag it to the business',
    'analyst so the FDS can be updated by hand. The FDS is a business artefact',
    'and is NOT auto-rewritten from code by design.'
  ].join('\n');

  return [
    `# DarkHorse pipeline generation report`,
    ``,
    `- **Pipeline title:** ${state?.title ?? '(unknown)'}`,
    `- **RICEFW type:** ${state?.ricefwType ?? '(unknown)'}`,
    `- **SAP package:** ${state?.sapPackage ?? '(unknown)'}`,
    `- **Stage:** ${state?.currentStage ?? '(unknown)'}`,
    `- **TDS file:** ${state?.tdsFilePath ?? '(unknown)'}`,
    `- **FDS file:** ${state?.fdsFilePath ?? '(unknown)'}`,
    `- **Refreshed at:** ${now}`,
    ``,
    `## Object counts`,
    ``,
    `- **Total:** ${counts.total}`,
    `- **Accepted:** ${counts.accepted}`,
    `- **Generated (pending review):** ${counts.generated}`,
    `- **Pending generation:** ${counts.pending}`,
    `- **Auto-added by DarkHorse:** ${counts.autoAdded}`,
    ``,
    `## Object list`,
    ``,
    objectsTable,
    ``,
    `## Auto-fill provenance`,
    ``,
    autoAddedSection,
    ``,
    `## FDS divergence`,
    ``,
    divergenceNote,
    ``,
    `---`,
    `_Generated by DarkHorse TdsRefresher._`
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function refreshTdsAndReport(stateManager: PipelineStateManager): Promise<void> {
  try {
    const state = stateManager.getState();
    if (!state) return;
    const tdsPath = state.tdsFilePath;
    const tdsRaw  = state.tdsContent;
    if (!tdsPath || !tdsRaw) return;

    // Parse the TDS JSON we saved when the doc was first written.
    let tdsDoc: TdsDocument;
    try {
      tdsDoc = JSON.parse(tdsRaw) as TdsDocument;
    } catch (err: any) {
      console.warn(`[DarkHorse] TdsRefresher: failed to parse state.tdsContent (${err?.message ?? err}); skipping refresh.`);
      return;
    }

    // Inject the current decorated object list. State is the source of truth
    // for object identity, status, and auto-fill provenance.
    tdsDoc.sections.abapObjectList = decorate(state.abapObjects ?? []);

    // Re-render the .docx in place.
    await reRenderDocxAsync(tdsDoc, tdsPath, state.ricefwType);

    // Write the markdown report next to the .docx.
    const reportPath = path.join(
      path.dirname(tdsPath),
      `pipeline-generation-report.md`
    );
    const reportText = buildReport(state, tdsDoc);
    fs.writeFileSync(reportPath, reportText, 'utf8');
  } catch (err: any) {
    console.warn(`[DarkHorse] TdsRefresher: refresh failed silently (${err?.message ?? err}).`);
  }
}
