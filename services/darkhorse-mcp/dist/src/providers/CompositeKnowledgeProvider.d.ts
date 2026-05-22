/**
 * CompositeKnowledgeProvider — Azure-first with static-catalog fallback.
 *
 * Tries each provider in order. The first one that returns a non-null record
 * wins. If a provider throws (e.g. Azure is misconfigured, rate-limited, or
 * unreachable), the composite logs and moves on — same fail-open pattern the
 * darkhorse-pipeline CleanCoreVerifier uses for the MCP-down case.
 *
 * Special case for verifyBadi/verifyExit: the static provider returns a
 * "not found" record (exists=false) rather than null when the catalog has
 * no entry. That is still a valid answer (it triggers the agent's
 * hallucination guard), so we accept it. The composite only falls through
 * when a provider returns *null*.
 */
import { KnowledgeProvider, BadiRecord, ExitRecord, ExitType, CleanCoreLevelRecord } from './KnowledgeProvider';
export declare class CompositeKnowledgeProvider implements KnowledgeProvider {
    private readonly providers;
    readonly id: string;
    constructor(providers: KnowledgeProvider[]);
    verifyBadi(name: string, program?: string, module?: string): Promise<BadiRecord | null>;
    verifyExit(name: string, programName?: string, exitType?: ExitType): Promise<ExitRecord | null>;
    checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
    private firstOk;
}
//# sourceMappingURL=CompositeKnowledgeProvider.d.ts.map