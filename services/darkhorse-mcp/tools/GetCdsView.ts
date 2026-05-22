/**
 * GetCdsView — returns the released SAP CDS view that should be used in
 * place of a direct SELECT on a SAP standard table.
 *
 * Strategy: ask the KnowledgeProvider to classify the table (TABL). If the
 * provider has a catalog entry with `alternatives` populated, the first
 * alternative IS the replacement CDS view. Otherwise return a clear "no
 * released CDS view in catalog" response with manual-verification guidance.
 *
 * Sprint 3 Session 1: this tool is what the Code Agent will call BEFORE
 * emitting any FROM <sap_table> in generated ABAP. The agent uses the
 * returned view name + level to rewrite the SELECT path Level A.
 */

'use strict';

import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GetCdsViewInput {
  sap_table:  string;
  use_case?:  string;
}

export interface GetCdsViewOutput {
  /** True if a released CDS replacement was found, false otherwise. */
  found:           boolean;
  sapTable:        string;
  viewName:        string | null;
  viewLevel:       'A' | 'B' | 'C' | 'D' | null;
  fields:          string[];
  example:         string;
  rationale:       string;
  /** Falls through to a Level B BAPI when no Level A CDS is registered. */
  fallbackHint:    string | null;
  source:          string;
  catalogVersion:  string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getCdsView(
  input: GetCdsViewInput,
  provider: KnowledgeProvider
): Promise<GetCdsViewOutput> {
  if (!input || typeof input.sap_table !== 'string' || input.sap_table.trim().length === 0) {
    throw new Error('get_cds_view: sap_table is required and must be a non-empty string.');
  }

  const table = input.sap_table.trim().toUpperCase();
  const record = await provider.checkCleanCoreLevel(table, 'TABL');
  if (!record) {
    throw new Error('get_cds_view: no provider produced a result for this table.');
  }

  // The "is there a CDS replacement" question is whether `alternatives`
  // contains a CDS entry.
  const cdsAlt = record.alternatives?.find(a => a.type === 'CDS');

  if (!cdsAlt) {
    return {
      found:          false,
      sapTable:       table,
      viewName:       null,
      viewLevel:      null,
      fields:         [],
      example:        '',
      rationale:
        `No released CDS interface view is registered for ${table} in the DarkHorse catalog. ` +
        'Before generating code, check the SAP Business Accelerator Hub (api.sap.com) for an ' +
        `I_*-prefixed view that exposes ${table}. If none exists, document the gap and proceed ` +
        'with the lowest-level acceptable alternative (BAPI for writes; classic SELECT only as a ' +
        'last resort with explicit Level C acknowledgement in the design).',
      fallbackHint:   record.alternatives && record.alternatives.length > 0
                        ? `Non-CDS alternative noted: ${record.alternatives[0]!.name} (${record.alternatives[0]!.type}, Level ${record.alternatives[0]!.level})`
                        : null,
      source:         record.providerId,
      catalogVersion: record.catalogVersion
    };
  }

  const example = buildSelectExample(table, cdsAlt.name, input.use_case);

  return {
    found:          true,
    sapTable:       table,
    viewName:       cdsAlt.name,
    viewLevel:      cdsAlt.level,
    fields:         [],   // catalog does not enumerate fields today; populated in a later session
    example,
    rationale:
      `Direct SELECTs on ${table} are Clean Core Level ${record.level}. ` +
      `Use the released CDS interface view ${cdsAlt.name} (Level ${cdsAlt.level}) instead. ` +
      `${cdsAlt.notes ?? ''}`.trim(),
    fallbackHint:   null,
    source:         record.providerId,
    catalogVersion: record.catalogVersion
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSelectExample(sapTable: string, cdsView: string, useCase?: string): string {
  const where = useCase
    ? `\n*   WHERE ... " refine for use case: ${useCase}`
    : '';
  return [
    `" Level A read access: use ${cdsView} instead of direct ${sapTable} SELECT`,
    `SELECT FROM ${cdsView}`,
    `  FIELDS *${where}`,
    `  INTO TABLE @DATA(lt_rows).`
  ].join('\n');
}
