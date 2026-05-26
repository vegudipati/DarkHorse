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
import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';
import { CdsFieldCatalogProvider, CdsFieldSchema } from '../src/providers/CdsFieldCatalogProvider';
export interface GetCdsViewInput {
    sap_table: string;
    use_case?: string;
}
export interface ProposedCdsView {
    /** Suggested Z* DDLS name, e.g. ZI_VBAK. */
    name: string;
    /** SQL view name (16-char DDIC limit). */
    sqlViewName: string;
    /** Clean Core level the wrapper inherits — typically B (released-but-classic). */
    level: 'B';
    /** Ready-to-paste DDL skeleton. Field list is TODO — TDS inputOutputSpec fills it. */
    template: string;
}
export interface GetCdsViewOutput {
    /** True if a released CDS replacement was found, false otherwise. */
    found: boolean;
    sapTable: string;
    viewName: string | null;
    viewLevel: 'A' | 'B' | 'C' | 'D' | null;
    /** Legacy string-only field list — kept for older callers that only need
     *  names. Populated from `fieldsDetail` when the field catalog has the
     *  view. Empty array when the field catalog is silent on this view. */
    fields: string[];
    /** Structured field metadata for the released alternative view. Sourced
     *  from CdsFieldCatalogProvider (HelpPortalFetcher output). Empty array
     *  when no field-level data is available for this view yet. */
    fieldsDetail: CdsFieldSchema[];
    example: string;
    rationale: string;
    /** Falls through to a Level B BAPI when no Level A CDS is registered. */
    fallbackHint: string | null;
    /** Sprint 6 step (B): when no released view exists, a proposed Z wrapper
     *  view is suggested. The TDS Agent should add this as a new DDLS object
     *  in the abapObjectList; the Code Agent should SELECT from this view
     *  instead of the underlying SAP table. */
    proposed: ProposedCdsView | null;
    source: string;
    catalogVersion: string;
    /** Source of the fieldsDetail array, if any. 'help-portal-cds' when
     *  HelpPortalFetcher populated it; null when the field catalog had no
     *  entry for this view. */
    fieldsSource: string | null;
}
export declare function getCdsView(input: GetCdsViewInput, provider: KnowledgeProvider, fieldCatalog?: CdsFieldCatalogProvider): Promise<GetCdsViewOutput>;
//# sourceMappingURL=GetCdsView.d.ts.map