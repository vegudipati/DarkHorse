/**
 * AzureAiSearchVectorIndex — production IVectorIndex backed by Azure AI Search.
 *
 * Provides the same surface as InMemoryVectorIndex:
 *   - upsert         (mergeOrUpload via SearchClient)
 *   - lookupByName   (filter on objectName field — exact match)
 *   - searchSemantic (vector search with k-NN via HNSW)
 *   - stats          (document count + per-source breakdown via facet query)
 *
 * The index schema is created (or updated) on first use, so the caller does
 * not need to provision the index manually — just create the Azure AI Search
 * service and supply the endpoint + admin key.
 *
 * AWS-portability note: only this file imports @azure/search-documents.
 * A future OpenSearchVectorIndex.ts implements the same IVectorIndex
 * interface using @opensearch-project/opensearch — nothing else changes.
 */
import { IVectorIndex, EmbeddedChunk, SearchHit, SapObjectType, VectorFilter } from '../types';
export interface AzureAiSearchVectorIndexOptions {
    endpoint: string;
    apiKey: string;
    indexName: string;
    /** Vector dimension — must match the embedder. Default 1536 (text-embedding-3-small). */
    dimensions?: number;
}
export declare class AzureAiSearchVectorIndex implements IVectorIndex {
    private readonly opts;
    readonly id: string;
    private readonly dimensions;
    private _indexEnsured;
    private _searchClient;
    private _indexClient;
    constructor(opts: AzureAiSearchVectorIndexOptions);
    private getIndexClient;
    private getSearchClient;
    private ensureIndex;
    upsert(chunks: EmbeddedChunk[]): Promise<void>;
    lookupByName(objectName: string, objectType?: SapObjectType): Promise<SearchHit[]>;
    searchSemantic(queryVector: number[], topK: number, filter?: VectorFilter): Promise<SearchHit[]>;
    stats(): Promise<{
        chunks: number;
        documents: number;
        bySource: Record<string, number>;
    }>;
}
//# sourceMappingURL=AzureAiSearchVectorIndex.d.ts.map