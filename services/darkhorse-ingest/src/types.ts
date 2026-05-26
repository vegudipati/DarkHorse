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

// ---------------------------------------------------------------------------
// Source taxonomy — every chunk carries enough metadata for the MCP server
// to filter by object type and clean-core level at query time.
// ---------------------------------------------------------------------------

export type SourceId =
  | 'SAP_API_HUB'
  | 'SAP_API_HUB_SEARCH'
  | 'SAP_CLEAN_CORE_GUIDE'
  | 'SAP_ARCHITECTURE_CENTER'
  | 'SAP_HELP_PORTAL_CDS';

export type SapObjectType =
  | 'CDS'    | 'BAPI'   | 'BADI'   | 'EXIT'
  | 'TABL'   | 'BDEF'   | 'DDLS'   | 'CLAS'
  | 'PATTERN'              // architectural pattern (not a concrete object)
  | 'API_ARTIFACT'         // generic artifact from API Hub search (API, Integration, Event…)
  | 'UNKNOWN';

export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';

// ---------------------------------------------------------------------------
// Document — output of an IFetcher. One document per source artefact
// (e.g. one CDS view, one BAdI, one architecture pattern).
// ---------------------------------------------------------------------------

export interface IngestDocument {
  /** Stable cross-source id, e.g. "sap-api-hub/cds/I_SalesOrder" */
  id:              string;
  source:          SourceId;
  sourceUrl:       string | null;
  /** Canonical SAP object name when the document represents one (BAdI, exit, table, CDS, BAPI). */
  objectName:      string | null;
  objectType:      SapObjectType;
  module:          string | null;
  cleanCoreLevel:  CleanCoreLevel | null;
  title:           string;
  /** Raw text the chunker will split. */
  body:            string;
  /** Loose key/value metadata, propagated to every chunk. */
  metadata:        Record<string, string | number | boolean>;
  fetchedAt:       string;     // ISO-8601
}

// ---------------------------------------------------------------------------
// Chunk — output of an IChunker.
// ---------------------------------------------------------------------------

export interface DocumentChunk {
  chunkId:         string;     // `${documentId}#${ordinal}`
  documentId:      string;
  ordinal:         number;     // 0-based
  text:            string;
  /** Source/object metadata is denormalized onto every chunk so the index
   *  can filter without joining back to the parent document. */
  source:          SourceId;
  sourceUrl:       string | null;
  objectName:      string | null;
  objectType:      SapObjectType;
  module:          string | null;
  cleanCoreLevel:  CleanCoreLevel | null;
  title:           string;
  metadata:        Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Embedded chunk — output of an IEmbedder.
// ---------------------------------------------------------------------------

export interface EmbeddedChunk extends DocumentChunk {
  vector:          number[];   // typically 1536 dims for text-embedding-3-small
  embeddedAt:      string;     // ISO-8601
  embeddingModel:  string;     // e.g. "text-embedding-3-small" or "mock-hash-v1"
}

// ---------------------------------------------------------------------------
// Search result — output of IVectorIndex retrieval methods.
// ---------------------------------------------------------------------------

export interface SearchHit {
  chunk:           EmbeddedChunk;
  /** Higher = better match. Cosine similarity for semantic; 1.0 for exact-name. */
  score:           number;
}

// ---------------------------------------------------------------------------
// Pipeline stage interfaces
// ---------------------------------------------------------------------------

export interface IFetcher {
  /** Stable identifier for logs and the CLI selector ("sap-api-hub" etc). */
  readonly id:       SourceId;
  readonly label:    string;

  /** Pull source artefacts and emit one IngestDocument per logical object. */
  fetch(): Promise<IngestDocument[]>;
}

export interface IChunker {
  readonly id:       string;     // descriptive identifier, e.g. "token-500-overlap-50"

  chunk(doc: IngestDocument): DocumentChunk[];
}

export interface IEmbedder {
  readonly id:       string;     // descriptive identifier, e.g. "azure-openai-text-embedding-3-small"
  readonly dimensions: number;

  embed(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]>;
}

export interface IVectorIndex {
  readonly id:       string;     // descriptive identifier

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
  stats(): Promise<{ chunks: number; documents: number; bySource: Record<string, number> }>;
}

export interface VectorFilter {
  source?:         SourceId;
  objectType?:     SapObjectType;
  cleanCoreLevel?: CleanCoreLevel;
  module?:         string;
}

// ---------------------------------------------------------------------------
// Pipeline run result — what the CLI reports at the end.
// ---------------------------------------------------------------------------

export interface IngestRunSummary {
  source:          SourceId;
  fetcher:         string;
  chunker:         string;
  embedder:        string;
  index:           string;
  documents:       number;
  chunks:          number;
  startedAt:       string;
  finishedAt:      string;
  durationMs:      number;
}
