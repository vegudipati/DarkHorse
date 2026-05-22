/**
 * GetFioriPattern — returns the canonical Fiori Elements pattern for a UI
 * scenario, biased to the 80% case (Fiori Elements templates over Freestyle
 * UI5).
 *
 * Item-2 default policy (per Deloitte standard):
 *   - Fiori Elements is the DEFAULT for ~80% of enterprise UI scenarios.
 *   - Freestyle UI5 is the EXCEPTION, used only when:
 *       * Custom controls or animations outside Fiori templates
 *       * Third-party library integrations (D3.js, Leaflet, etc.)
 *       * Guided multi-step wizards beyond standard process flow
 *       * Consumer-grade experiences beyond enterprise norms
 *   - Selection by decision tree:
 *       Can the app be expressed via CDS annotations? -> Fiori Elements
 *       Need custom controls / third-party integrations? -> Freestyle UI5
 *       Standard business process w/ some customization? -> FE + extensions
 *
 * Five Fiori Elements templates are exposed:
 *   list_report          — tabular data with filter bar
 *   object_page          — single-object detail / edit
 *   analytical_list_page — analytical / KPI report with chart + table
 *   overview_page        — dashboard with multiple cards
 *   worklist             — task-style inbox/processing
 *
 * Plus freestyle_ui5 as an explicit exception scenario.
 *
 * Embedded pattern. The 6 templates are stable; a future session can fetch
 * fresh manifest snippets from the SAP Architecture Center if needed.
 */
export type FioriScenario = 'LIST_REPORT' | 'OBJECT_PAGE' | 'ANALYTICAL_LIST_PAGE' | 'OVERVIEW_PAGE' | 'WORKLIST' | 'FREESTYLE_UI5';
export interface GetFioriPatternInput {
    scenario: FioriScenario | string;
    entity_hint?: string;
}
export interface FioriObject {
    role: string;
    type: string;
    namingHint: string;
    notes?: string;
}
export interface GetFioriPatternOutput {
    scenario: FioriScenario;
    pattern: string;
    whenToUse: string;
    requiredObjects: FioriObject[];
    cdsAnnotations: string;
    manifestSnippet: string;
    cleanCoreLevel: 'A' | 'B';
    source: 'embedded';
    catalogVersion: string;
}
export declare function getFioriPattern(input: GetFioriPatternInput): GetFioriPatternOutput;
//# sourceMappingURL=GetFioriPattern.d.ts.map