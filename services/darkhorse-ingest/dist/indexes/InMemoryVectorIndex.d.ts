/**
 * InMemoryVectorIndex — Sprint 2 session 1 vector store.
 *
 * Two access patterns:
 *   1. lookupByName    — exact match on objectName (+ optional objectType).
 *                        Powers verify_badi / verify_exit / check_clean_core_level
 *                        when the MCP server is migrated to this index in
 *                        Sprint 2 session 4.
 *   2. searchSemantic  — cosine similarity over stored vectors with an
 *                        optional metadata filter. Powers future search_sap_apis
 *                        and pattern-retrieval tools.
 *
 * Persistence: this backend keeps everything in memory. The CLI provides a
 * snapshot-to-disk option (writes JSON to data/<source>.snapshot.json) so
 * a re-ingest cycle isn't required between sessions. Snapshots are not the
 * primary persistence mechanism — Azure AI Search will be in later sessions.
 */
import { IVectorIndex, EmbeddedChunk, SearchHit, SapObjectType, VectorFilter } from '../types';
export interface InMemoryVectorIndexOptions {
    /** Optional snapshot file. If present at construction, the index loads from
     *  it; subsequent upserts can persist back via persist(). */
    snapshotPath?: string;
}
export declare class InMemoryVectorIndex implements IVectorIndex {
    private readonly options;
    readonly id: string;
    private readonly chunksById;
    private readonly chunkIdsByName;
    constructor(options?: InMemoryVectorIndexOptions);
    upsert(chunks: EmbeddedChunk[]): Promise<void>;
    lookupByName(objectName: string, objectType?: SapObjectType): Promise<SearchHit[]>;
    searchSemantic(queryVector: number[], topK: number, filter?: VectorFilter): Promise<SearchHit[]>;
    stats(): Promise<{
        chunks: number;
        documents: number;
        bySource: Record<string, number>;
    }>;
    persist(snapshotPath?: string): void;
    private loadSnapshot;
}
//# sourceMappingURL=InMemoryVectorIndex.d.ts.map