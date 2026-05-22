/**
 * GetRapPattern — returns the canonical RAP layered structure for a scenario.
 *
 * Sprint 3 Session 1: the Code Agent calls this BEFORE deciding the object
 * list for a new transactional development. The returned `requiredObjects`
 * array drives what the TDS Agent generates (BDEF + BBEH + SRVD + CDS data
 * model, NOT classic PROG/FUGR).
 *
 * Embedded patterns cover the common scenarios. A future session can
 * augment with index-backed semantic lookup for less common patterns.
 */
export type RapScenario = 'TRANSACTIONAL' | 'READ_ONLY_ANALYTICAL' | 'DRAFT_ENABLED' | 'MANAGED' | 'UNMANAGED' | 'PROJECTION' | 'EXTENSION';
export interface GetRapPatternInput {
    scenario: RapScenario | string;
    object_type?: string;
    operation?: string;
}
export interface RapObject {
    role: string;
    type: string;
    namingHint: string;
    notes?: string;
}
export interface GetRapPatternOutput {
    scenario: RapScenario;
    pattern: string;
    requiredObjects: RapObject[];
    codeTemplate: string;
    cleanCoreLevel: 'A';
    source: 'embedded';
    catalogVersion: string;
}
export declare function getRapPattern(input: GetRapPatternInput): GetRapPatternOutput;
//# sourceMappingURL=GetRapPattern.d.ts.map