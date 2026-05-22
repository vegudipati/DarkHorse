/**
 * GetCboPattern — returns the canonical Custom Business Object pattern.
 *
 * Use when the FDS calls for NEW persistent custom data — fields that don't
 * map to any released SAP table. The pattern replaces the old habit of
 * "create a Z-table and INSERT directly into it" (Level C) with a fully
 * RAP-managed Custom Business Object (Level A): persistent table + CDS
 * interface + managed BDEF + behavior pool + projection + service binding.
 *
 * Sprint 4 — primary use case is the TDS Agent. When the FDS says "store
 * audit trail / approval status / custom backorder header", the TDS object
 * list should be the CBO 7-piece structure, not a classic Z-table + report.
 *
 * Embedded pattern. The structure is small and stable; a future session can
 * augment with index-backed lookup for richer scenario-specific guidance.
 */
export interface GetCboPatternInput {
    scenario: string;
    required_fields?: string[];
}
export interface CboObject {
    role: string;
    type: string;
    namingHint: string;
    notes?: string;
}
export interface GetCboPatternOutput {
    scenario: string;
    pattern: string;
    requiredObjects: CboObject[];
    ddlTemplate: string;
    bdefTemplate: string;
    cleanCoreLevel: 'A';
    rationale: string;
    doNotUse: string;
    source: 'embedded';
    catalogVersion: string;
}
export declare function getCboPattern(input: GetCboPatternInput): GetCboPatternOutput;
//# sourceMappingURL=GetCboPattern.d.ts.map