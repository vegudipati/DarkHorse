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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCdsView = getCdsView;
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function getCdsView(input, provider) {
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
        // Sprint 6 step (B): propose a Z wrapper view so the deliverable can still
        // be Level A-leaning. The TDS Agent grounder adds this to the abapObjectList.
        const proposed = buildProposedWrapper(table);
        return {
            found: false,
            sapTable: table,
            viewName: null,
            viewLevel: null,
            fields: [],
            example: '',
            rationale: `No released CDS interface view is registered for ${table} in the DarkHorse catalog. ` +
                `PROPOSED: include a new DDLS object ${proposed.name} in the abapObjectList ` +
                `that wraps ${table}, then SELECT from ${proposed.name} in the consuming program. ` +
                `Also check the SAP Business Accelerator Hub (api.sap.com) for an I_*-prefixed view ` +
                `that exposes ${table}; if one exists it should be preferred over the Z wrapper.`,
            fallbackHint: record.alternatives && record.alternatives.length > 0
                ? `Non-CDS alternative noted: ${record.alternatives[0].name} (${record.alternatives[0].type}, Level ${record.alternatives[0].level})`
                : null,
            proposed,
            source: record.providerId,
            catalogVersion: record.catalogVersion
        };
    }
    const example = buildSelectExample(table, cdsAlt.name, input.use_case);
    return {
        found: true,
        sapTable: table,
        viewName: cdsAlt.name,
        viewLevel: cdsAlt.level,
        fields: [], // catalog does not enumerate fields today; populated in a later session
        example,
        rationale: `Direct SELECTs on ${table} are Clean Core Level ${record.level}. ` +
            `Use the released CDS interface view ${cdsAlt.name} (Level ${cdsAlt.level}) instead. ` +
            `${cdsAlt.notes ?? ''}`.trim(),
        fallbackHint: null,
        proposed: null,
        source: record.providerId,
        catalogVersion: record.catalogVersion
    };
}
// ---------------------------------------------------------------------------
// Wrapper-view proposal — used when no released CDS view exists for the table.
// Generates a name + SQL view name + ready-to-paste DDL skeleton with a TODO
// field list. The TDS inputOutputSpec drives which fields the Code Agent
// fills in when generating the consuming program.
// ---------------------------------------------------------------------------
function buildProposedWrapper(table) {
    const upperTable = table.trim().toUpperCase();
    // ZI_ + table — kept short (max DDIC view name = 30 chars; standard tables
    // are <=5 chars so ZI_<TABLE> is comfortably within limits).
    const viewName = `ZI_${upperTable}`;
    // SQL view name has a 16-char limit. ZIV_<TABLE> for 4 + 5 = 9 chars.
    const sqlViewName = `ZIV_${upperTable}`.slice(0, 16);
    const template = [
        `@AbapCatalog.sqlViewName: '${sqlViewName}'`,
        `@AbapCatalog.compiler.compareFilter: true`,
        `@AbapCatalog.preserveKey: true`,
        `@AccessControl.authorizationCheck: #CHECK`,
        `@EndUserText.label: 'DarkHorse wrapper view over ${upperTable}'`,
        `@ClientHandling.algorithm: #SESSION_VARIABLE`,
        `define view ${viewName} as select from ${upperTable.toLowerCase()} {`,
        `  // TODO — list the fields the consuming program needs.`,
        `  // Drive this list from the TDS inputOutputSpec. Mark key fields with`,
        `  // the leading "key" keyword.`,
        `  key mandt,`,
        `  // key <key_field_1>,`,
        `  // <non_key_field_1>,`,
        `  // <non_key_field_2>`,
        `}`
    ].join('\n');
    return { name: viewName, sqlViewName, level: 'B', template };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildSelectExample(sapTable, cdsView, useCase) {
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
//# sourceMappingURL=GetCdsView.js.map