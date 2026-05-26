/**
 * TerminalStubProvider — last-resort provider that always returns a
 * "not found" envelope rather than null.
 *
 * Sits at the end of the composite chain. When every upstream provider
 * (curated static catalog, SAP cloudification, Azure AI Search) returned
 * null for a query, this provider produces the deterministic stub the MCP
 * tools and the LLM-facing grounders rely on. Keeping the stub here (rather
 * than inside any single data provider) lets the upstream providers cleanly
 * signal "I don't have this" with null, so a downstream provider with the
 * data can win.
 */
import { KnowledgeProvider, BadiRecord, ExitRecord, ExitType, CleanCoreLevelRecord } from './KnowledgeProvider';
export declare class TerminalStubProvider implements KnowledgeProvider {
    readonly id = "terminal-stub";
    readonly catalogVersion = "stub-1";
    verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null>;
    verifyExit(name: string, _programName?: string, _exitType?: ExitType): Promise<ExitRecord | null>;
    checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
}
//# sourceMappingURL=TerminalStubProvider.d.ts.map