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
export interface GetCdsViewInput {
    sap_table: string;
    use_case?: string;
}
export interface GetCdsViewOutput {
    /** True if a released CDS replacement was found, false otherwise. */
    found: boolean;
    sapTable: string;
    viewName: string | null;
    viewLevel: 'A' | 'B' | 'C' | 'D' | null;
    fields: string[];
    example: string;
    rationale: string;
    /** Falls through to a Level B BAPI when no Level A CDS is registered. */
    fallbackHint: string | null;
    source: string;
    catalogVersion: string;
}
export declare function getCdsView(input: GetCdsViewInput, provider: KnowledgeProvider): Promise<GetCdsViewOutput>;
//# sourceMappingURL=GetCdsView.d.ts.map