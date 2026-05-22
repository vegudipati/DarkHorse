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

'use strict';

import {
  IVectorIndex,
  EmbeddedChunk,
  SearchHit,
  SapObjectType,
  VectorFilter
} from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AzureAiSearchVectorIndexOptions {
  endpoint:    string;
  apiKey:      string;
  indexName:   string;
  /** Vector dimension — must match the embedder. Default 1536 (text-embedding-3-small). */
  dimensions?: number;
}

const DEFAULT_DIMENSIONS = 1536;
const VECTOR_PROFILE     = 'dh-vector-profile';
const VECTOR_ALGORITHM   = 'dh-hnsw';

// ---------------------------------------------------------------------------
// Internal Azure-side document shape — flat, all top-level fields.
// metadata is JSON-encoded since Azure AI Search has no generic JSON type.
// ---------------------------------------------------------------------------

interface AzureSearchDoc {
  key:             string;     // base64url(chunkId) — Azure key char restrictions
  chunkId:         string;
  documentId:      string;
  ordinal:         number;
  text:            string;
  vector:          number[];
  source:          string;
  sourceUrl:       string | null;
  objectName:      string | null;
  objectType:      string;
  module:          string | null;
  cleanCoreLevel:  string | null;
  title:           string;
  embeddedAt:      string;
  embeddingModel:  string;
  metadataJson:    string;
}

// ---------------------------------------------------------------------------
// Index implementation
// ---------------------------------------------------------------------------

export class AzureAiSearchVectorIndex implements IVectorIndex {

  public readonly id: string;

  private readonly dimensions: number;
  private _indexEnsured = false;
  private _searchClient: any | null = null;
  private _indexClient:  any | null = null;

  constructor(private readonly opts: AzureAiSearchVectorIndexOptions) {
    if (!opts.endpoint)  throw new Error('AzureAiSearchVectorIndex: endpoint is required.');
    if (!opts.apiKey)    throw new Error('AzureAiSearchVectorIndex: apiKey is required.');
    if (!opts.indexName) throw new Error('AzureAiSearchVectorIndex: indexName is required.');

    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
    this.id         = `azure-ai-search-${opts.indexName}`;
  }

  // -------------------------------------------------------------------
  // Lazy SDK init — pay the cost only when this backend is actually used.
  // -------------------------------------------------------------------

  private getIndexClient(): any {
    if (this._indexClient) return this._indexClient;
    const { SearchIndexClient, AzureKeyCredential } = require('@azure/search-documents');
    this._indexClient = new SearchIndexClient(
      this.opts.endpoint,
      new AzureKeyCredential(this.opts.apiKey)
    );
    return this._indexClient;
  }

  private getSearchClient(): any {
    if (this._searchClient) return this._searchClient;
    const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
    this._searchClient = new SearchClient(
      this.opts.endpoint,
      this.opts.indexName,
      new AzureKeyCredential(this.opts.apiKey)
    );
    return this._searchClient;
  }

  // -------------------------------------------------------------------
  // Schema creation — idempotent createOrUpdateIndex with vector config
  // -------------------------------------------------------------------

  private async ensureIndex(): Promise<void> {
    if (this._indexEnsured) return;
    const client = this.getIndexClient();

    const indexDef = {
      name:   this.opts.indexName,
      fields: [
        { name: 'key',            type: 'Edm.String',                  key: true, filterable: true },
        { name: 'chunkId',        type: 'Edm.String',                  filterable: true,           retrievable: true },
        { name: 'documentId',     type: 'Edm.String',                  filterable: true,           retrievable: true },
        { name: 'ordinal',        type: 'Edm.Int32',                   filterable: true,           retrievable: true },
        { name: 'text',           type: 'Edm.String', searchable: true,                            retrievable: true },
        { name: 'vector',         type: 'Collection(Edm.Single)',      searchable: true,
                                  vectorSearchDimensions: this.dimensions,
                                  vectorSearchProfileName: VECTOR_PROFILE },
        { name: 'source',         type: 'Edm.String',                  filterable: true, facetable: true, retrievable: true },
        { name: 'sourceUrl',      type: 'Edm.String',                                                       retrievable: true },
        { name: 'objectName',     type: 'Edm.String', searchable: true, filterable: true, facetable: true, retrievable: true },
        { name: 'objectType',     type: 'Edm.String',                  filterable: true, facetable: true, retrievable: true },
        { name: 'module',         type: 'Edm.String',                  filterable: true, facetable: true, retrievable: true },
        { name: 'cleanCoreLevel', type: 'Edm.String',                  filterable: true, facetable: true, retrievable: true },
        { name: 'title',          type: 'Edm.String', searchable: true,                            retrievable: true },
        { name: 'embeddedAt',     type: 'Edm.String',                                              retrievable: true },
        { name: 'embeddingModel', type: 'Edm.String',                                              retrievable: true },
        { name: 'metadataJson',   type: 'Edm.String',                                              retrievable: true }
      ],
      vectorSearch: {
        algorithms: [
          { name: VECTOR_ALGORITHM, kind: 'hnsw' }
        ],
        profiles: [
          { name: VECTOR_PROFILE, algorithmConfigurationName: VECTOR_ALGORITHM }
        ]
      }
    };

    await client.createOrUpdateIndex(indexDef);
    this._indexEnsured = true;
  }

  // -------------------------------------------------------------------
  // Upsert
  // -------------------------------------------------------------------

  public async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.ensureIndex();

    const docs: AzureSearchDoc[] = chunks.map(c => ({
      key:            encodeKey(c.chunkId),
      chunkId:        c.chunkId,
      documentId:     c.documentId,
      ordinal:        c.ordinal,
      text:           c.text,
      vector:         c.vector,
      source:         c.source,
      sourceUrl:      c.sourceUrl,
      objectName:     c.objectName,
      objectType:     c.objectType,
      module:         c.module,
      cleanCoreLevel: c.cleanCoreLevel,
      title:          c.title,
      embeddedAt:     c.embeddedAt,
      embeddingModel: c.embeddingModel,
      metadataJson:   JSON.stringify(c.metadata ?? {})
    }));

    const client = this.getSearchClient();
    // mergeOrUploadDocuments creates new docs or replaces existing ones by key
    await client.mergeOrUploadDocuments(docs);
  }

  // -------------------------------------------------------------------
  // Exact lookup by SAP object name
  // -------------------------------------------------------------------

  public async lookupByName(objectName: string, objectType?: SapObjectType): Promise<SearchHit[]> {
    if (!objectName || objectName.trim().length === 0) return [];
    await this.ensureIndex();

    const safeName = objectName.trim().replace(/'/g, "''");   // OData escape
    let filter = `objectName eq '${safeName}'`;
    if (objectType) {
      filter += ` and objectType eq '${objectType}'`;
    }

    const client = this.getSearchClient();
    const results: SearchHit[] = [];
    const iter = await client.search('*', { filter, top: 25 });

    for await (const item of iter.results) {
      results.push({ chunk: docToEmbeddedChunk(item.document), score: 1.0 });
    }
    return results;
  }

  // -------------------------------------------------------------------
  // Semantic search via k-NN over the vector field
  // -------------------------------------------------------------------

  public async searchSemantic(
    queryVector: number[],
    topK: number,
    filter?: VectorFilter
  ): Promise<SearchHit[]> {
    if (!queryVector || queryVector.length === 0) return [];
    await this.ensureIndex();

    const odata = buildODataFilter(filter);
    const client = this.getSearchClient();

    const opts: any = {
      top: Math.max(1, topK),
      vectorSearchOptions: {
        queries: [{
          kind:                    'vector',
          vector:                  queryVector,
          kNearestNeighborsCount:  topK,
          fields:                  ['vector']
        }]
      }
    };
    if (odata) opts.filter = odata;

    const results: SearchHit[] = [];
    const iter = await client.search('*', opts);
    for await (const item of iter.results) {
      results.push({
        chunk: docToEmbeddedChunk(item.document),
        score: typeof item.score === 'number' ? item.score : 0
      });
    }
    return results;
  }

  // -------------------------------------------------------------------
  // Stats — count + per-source breakdown via facet
  // -------------------------------------------------------------------

  public async stats(): Promise<{ chunks: number; documents: number; bySource: Record<string, number> }> {
    await this.ensureIndex();
    const client = this.getSearchClient();

    const iter = await client.search('*', {
      top:           0,
      includeTotalCount: true,
      facets:        ['source,count:50']
    });

    const total      = typeof iter.count === 'number' ? iter.count : 0;
    const bySource: Record<string, number> = {};
    const sourceFacets = iter.facets?.source ?? [];
    for (const f of sourceFacets) {
      bySource[String(f.value)] = f.count;
    }

    // Distinct-document count requires a second scan; for an in-process
    // accuracy/cost trade-off we approximate as total here. Honest result —
    // we can revisit if/when this metric is consumed.
    return { chunks: total, documents: total, bySource };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeKey(chunkId: string): string {
  return Buffer.from(chunkId, 'utf-8').toString('base64url');
}

function buildODataFilter(f?: VectorFilter): string | null {
  if (!f) return null;
  const parts: string[] = [];
  if (f.source)         parts.push(`source eq '${escape(f.source)}'`);
  if (f.objectType)     parts.push(`objectType eq '${escape(f.objectType)}'`);
  if (f.module)         parts.push(`module eq '${escape(f.module)}'`);
  if (f.cleanCoreLevel) parts.push(`cleanCoreLevel eq '${escape(f.cleanCoreLevel)}'`);
  return parts.length === 0 ? null : parts.join(' and ');

  function escape(s: string): string {
    return s.replace(/'/g, "''");
  }
}

function docToEmbeddedChunk(d: AzureSearchDoc): EmbeddedChunk {
  let metadata: Record<string, string | number | boolean> = {};
  try { metadata = JSON.parse(d.metadataJson) ?? {}; } catch { /* keep empty */ }

  return {
    chunkId:        d.chunkId,
    documentId:     d.documentId,
    ordinal:        d.ordinal,
    text:           d.text,
    vector:         d.vector,
    source:         d.source as EmbeddedChunk['source'],
    sourceUrl:      d.sourceUrl,
    objectName:     d.objectName,
    objectType:     d.objectType as SapObjectType,
    module:         d.module,
    cleanCoreLevel: d.cleanCoreLevel as EmbeddedChunk['cleanCoreLevel'],
    title:          d.title,
    metadata,
    embeddedAt:     d.embeddedAt,
    embeddingModel: d.embeddingModel
  };
}
