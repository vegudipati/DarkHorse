/**
 * CheckCleanCoreLevel — adapter over a KnowledgeProvider for the
 * /tools/check-clean-core-level endpoint.
 *
 * Sprint 2 session 4: delegates lookup to the injected provider. The static
 * provider keeps the Sprint-1 heuristic fallback (I_ prefix -> A, Z/Y
 * customer namespace -> C, etc.) for objects not present in the catalog.
 * The Azure provider returns null if not indexed so the composite can fall
 * through to the static heuristic.
 */
import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';
export type ObjectType = 'TABL' | 'VIEW' | 'CDS' | 'FUNC' | 'BAPI' | 'CLAS' | 'PROG' | 'TRAN' | 'BDEF' | 'DDLS';
export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';
export interface CheckCleanCoreLevelInput {
    object_name: string;
    object_type: ObjectType | string;
}
export interface CleanCoreAlternative {
    name: string;
    type: string;
    level: CleanCoreLevel;
    notes?: string;
}
export interface CheckCleanCoreLevelOutput {
    level: CleanCoreLevel;
    name: string;
    type: string;
    module: string | null;
    reasoning: string;
    alternatives: CleanCoreAlternative[];
    confidence: 'high' | 'medium' | 'low';
    source: string;
    catalogVersion: string;
}
export declare function checkCleanCoreLevel(input: CheckCleanCoreLevelInput, provider: KnowledgeProvider): Promise<CheckCleanCoreLevelOutput>;
//# sourceMappingURL=CheckCleanCoreLevel.d.ts.map