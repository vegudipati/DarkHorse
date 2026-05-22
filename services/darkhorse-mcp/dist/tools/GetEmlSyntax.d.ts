/**
 * GetEmlSyntax — returns ABAP EML (Entity Manipulation Language) syntax for
 * CREATE / UPDATE / DELETE / READ operations on a RAP-managed entity.
 *
 * Sprint 3 Session 1: this tool is what the Code Agent calls BEFORE
 * emitting any write operation on a sales order / purchase order / etc.
 * The result steers generation away from legacy BAPIs (Level B) toward
 * EML (Level A).
 *
 * Embedded templates — the syntax shapes are small, stable, and well-known.
 * Substitutes the caller's entity name into the template. No RAG roundtrip
 * required.
 */
export type EmlOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';
export interface GetEmlSyntaxInput {
    operation: EmlOperation | string;
    entity: string;
}
export interface GetEmlSyntaxOutput {
    operation: EmlOperation;
    entity: string;
    syntax: string;
    example: string;
    commitRequired: boolean;
    cleanCoreLevel: 'A';
    rationale: string;
    /** What legacy approach the agent should NOT generate instead. */
    doNotUse: string;
    source: 'embedded';
    catalogVersion: string;
}
export declare function getEmlSyntax(input: GetEmlSyntaxInput): GetEmlSyntaxOutput;
//# sourceMappingURL=GetEmlSyntax.d.ts.map