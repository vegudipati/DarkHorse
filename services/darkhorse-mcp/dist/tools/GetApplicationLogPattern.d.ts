/**
 * GetApplicationLogPattern — returns SAP SLG1 / Application Log code patterns.
 *
 * Primary purpose (CPI-6 Sprint 1): force the Code Agent to use SLG1
 * Application Log for ALL logging instead of inventing custom Z-tables
 * (a Level C/D anti-pattern that currently dominates generated code).
 *
 * The tool returns a ready-to-paste ABAP snippet for the requested use case,
 * the standard log object/subobject pair (or recommends a custom object name
 * registered via SLG0), and the related SAP function modules.
 *
 * Patterns embedded inline because the set is small, stable, and well-known.
 * Sprint 2 may relocate these to a RAG-indexed pattern store.
 */
export interface GetApplicationLogPatternInput {
    use_case?: string;
    object?: string;
    subobject?: string;
}
export interface ApplicationLogPattern {
    patternId: string;
    description: string;
    logObject: string;
    logSubobject: string;
    registration: string;
    objectsNeeded: string[];
    example: string;
    cleanCoreLevel: 'A' | 'B';
}
export interface GetApplicationLogPatternOutput {
    pattern: ApplicationLogPattern;
    matchedBy: 'use_case' | 'object' | 'default';
    availablePatterns: string[];
    source: 'embedded';
    catalogVersion: string;
}
export declare function getApplicationLogPattern(input: GetApplicationLogPatternInput): GetApplicationLogPatternOutput;
//# sourceMappingURL=GetApplicationLogPattern.d.ts.map