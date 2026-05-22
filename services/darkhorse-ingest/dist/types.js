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
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=types.js.map