/**
 * AzureSearchKnowledgeProvider — queries the RAG index in Azure AI Search.
 *
 * Wraps @azure/search-documents and returns records shaped for the MCP
 * tools. Each tool method:
 *   1. Issues a filtered $search query against the canonical objectName
 *      field with the right objectType filter.
 *   2. Reads the chunk's `metadataJson` field (set by darkhorse-ingest at
 *      indexing time) to recover any rich fields the static catalog has
 *      but the flat index schema does not.
 *   3. Returns null if no document is found — the composite provider then
 *      falls back to the static catalog.
 *
 * The provider lazy-instantiates the Azure SDK clients so importing this
 * module never triggers Azure traffic. The clients only spin up when one
 * of the lookup methods is actually called.
 */
import { KnowledgeProvider, BadiRecord, ExitRecord, ExitType, CleanCoreLevelRecord } from './KnowledgeProvider';
export interface AzureSearchKnowledgeProviderOptions {
    endpoint: string;
    apiKey: string;
    indexName: string;
}
export declare class AzureSearchKnowledgeProvider implements KnowledgeProvider {
    private readonly opts;
    readonly id: string;
    private _client;
    constructor(opts: AzureSearchKnowledgeProviderOptions);
    private getClient;
    private findOne;
    private parseMeta;
    verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null>;
    verifyExit(name: string, _programName?: string, _exitType?: ExitType): Promise<ExitRecord | null>;
    checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
}
//# sourceMappingURL=AzureSearchKnowledgeProvider.d.ts.map