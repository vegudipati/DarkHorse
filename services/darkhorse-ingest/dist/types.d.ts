/**
 * darkhorse-ingest — pipeline contracts.
 *
 * The four interfaces below split RAG ingestion into independently testable
 * stages. Real backends (Azure OpenAI, Azure AI Search) are swapped in by
 * implementing IEmbedder / IVectorIndex; the pipeline itself never imports
 * a specific backend.
 *
 *   Source --[IFetcher]--> IngestDocument
 *          --[IChunker]--> DocumentChunk
 *          --[IEmbedder]-> EmbeddedChunk
 *          --[IVectorIndex.upsert]--> indexed
 *
 * Retrieval (post-ingest, used by darkhorse-mcp in a later session):
 *   IVectorIndex.lookupByName  → exact-match (BAdI / exit / table name)
 *   IVectorIndex.searchSemantic → cosine similarity over the embedding
 */
export type SourceId = 'SAP_API_HUB' | 'SAP_API_HUB_SEARCH' | 'SAP_CLEAN_CORE_GUIDE' | 'SAP_ARCHITECTURE_CENTER' | 'SAP_HELP_PORTAL_CDS';
export type SapObjectType = 'CDS' | 'BAPI' | 'BADI' | 'EXIT' | 'TABL' | 'BDEF' | 'DDLS' | 'CLAS' | 'PATTERN' | 'API_ARTIFACT' | 'UNKNOWN';
export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';
export interface IngestDocument {
    /** Stable cross-source id, e.g. "sap-api-hub/cds/I_SalesOrder" */
    id: string;
    source: SourceId;
    sourceUrl: string | null;
    /** Canonical SAP object name when the document represents one (BAdI, exit, table, CDS, BAPI). */
    objectName: string | null;
    objectType: SapObjectType;
    module: string | null;
    cleanCoreLevel: CleanCoreLevel | null;
    title: string;
    /** Raw text the chunker will split. */
    body: string;
    /** Loose key/value metadata, propagated to every chunk. */
    metadata: Record<string, string | number | boolean>;
    fetchedAt: string;
}
export interface DocumentChunk {
    chunkId: string;
    documentId: string;
    ordinal: number;
    text: string;
    /** Source/object metadata is denormalized onto every chunk so the index
     *  can filter without joining back to the parent document. */
    source: SourceId;
    sourceUrl: string | null;
    objectName: string | null;
    objectType: SapObjectType;
    module: string | null;
    cleanCoreLevel: CleanCoreLevel | null;
    title: string;
    metadata: Record<string, string | number | boolean>;
}
export interface EmbeddedChunk extends DocumentChunk {
    vector: number[];
    embeddedAt: string;
    embeddingModel: string;
}
export interface SearchHit {
    chunk: EmbeddedChunk;
    /** Higher = better match. Cosine similarity for semantic; 1.0 for exact-name. */
    score: number;
}
export interface IFetcher {
    /** Stable identifier for logs and the CLI selector ("sap-api-hub" etc). */
    readonly id: SourceId;
    readonly label: string;
    /** Pull source artefacts and emit one IngestDocument per logical object. */
    fetch(): Promise<IngestDocument[]>;
}
export interface IChunker {
    readonly id: string;
    chunk(doc: IngestDocument): DocumentChunk[];
}
export interface IEmbedder {
    readonly id: string;
    readonly dimensions: number;
    embed(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]>;
}
export interface IVectorIndex {
    readonly id: string;
    /** Upsert by chunkId. Re-running ingestion overwrites previous chunks. */
    upsert(chunks: EmbeddedChunk[]): Promise<void>;
    /** Exact lookup by SAP object name. Returns all chunks that name (across all
     *  documents in the index). Powers verify_badi / verify_exit /
     *  check_clean_core_level in the MCP server. */
    lookupByName(objectName: string, objectType?: SapObjectType): Promise<SearchHit[]>;
    /** Semantic search via cosine similarity on the query vector. Powers the
     *  future search_sap_apis / get_rap_pattern / get_cds_view tools. */
    searchSemantic(queryVector: number[], topK: number, filter?: VectorFilter): Promise<SearchHit[]>;
    /** Diagnostic — how many chunks and how many distinct documents. */
    stats(): Promise<{
        chunks: number;
        documents: number;
        bySource: Record<string, number>;
    }>;
}
export interface VectorFilter {
    source?: SourceId;
    objectType?: SapObjectType;
    cleanCoreLevel?: CleanCoreLevel;
    module?: string;
}
export interface IngestRunSummary {
    source: SourceId;
    fetcher: string;
    chunker: string;
    embedder: string;
    index: string;
    documents: number;
    chunks: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
}
//# sourceMappingURL=types.d.ts.map