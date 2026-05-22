/**
 * StaticCatalogProvider — KnowledgeProvider backed by the Sprint 1 JSON
 * catalogs under services/darkhorse-mcp/catalog/.
 *
 * Preserves Sprint 1 behavior exactly: same hallucination guards, same
 * heuristic fallbacks for unknown objects. The only behavioral change is
 * that lookups are async (the interface is Promise-returning so a
 * composite can mix this provider with the Azure-backed one).
 */
import { KnowledgeProvider, BadiRecord, ExitRecord, ExitType, CleanCoreLevelRecord } from './KnowledgeProvider';
export declare class StaticCatalogProvider implements KnowledgeProvider {
    private readonly catalogDir;
    readonly id = "static-catalog";
    private _badiCatalog;
    private _exitCatalog;
    private _ccCatalog;
    private _badiByName;
    private _exitByName;
    private _ccByKey;
    constructor(catalogDir?: string);
    /** Public accessor for catalog write tools that need to know where the
     *  seed JSON lives. */
    getCatalogDir(): string;
    /** Invalidate all in-memory caches. Call after writing to a catalog JSON
     *  file so the next lookup re-reads it. */
    reload(): void;
    verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null>;
    verifyExit(name: string, programName?: string, _exitType?: ExitType): Promise<ExitRecord | null>;
    checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
    private getBadiIndex;
    private getExitIndex;
    private getCcIndex;
}
//# sourceMappingURL=StaticCatalogProvider.d.ts.map