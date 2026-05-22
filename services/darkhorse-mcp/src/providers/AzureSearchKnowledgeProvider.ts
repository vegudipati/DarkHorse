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

'use strict';

import {
  KnowledgeProvider,
  BadiRecord,
  ExitRecord,
  ExitType,
  CleanCoreLevelRecord,
  CleanCoreAlternative,
  CleanCoreLevel
} from './KnowledgeProvider';

// ---------------------------------------------------------------------------
// Public types — config
// ---------------------------------------------------------------------------

export interface AzureSearchKnowledgeProviderOptions {
  endpoint:  string;
  apiKey:    string;
  indexName: string;
}

// ---------------------------------------------------------------------------
// Shape of an index document — mirrors AzureSearchDoc in darkhorse-ingest.
// ---------------------------------------------------------------------------

interface AzureSearchDoc {
  chunkId?:         string;
  documentId?:      string;
  text?:            string;
  source?:          string;
  sourceUrl?:       string | null;
  objectName?:      string | null;
  objectType?:      string;
  module?:          string | null;
  cleanCoreLevel?:  CleanCoreLevel | null;
  title?:           string;
  metadataJson?:    string;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class AzureSearchKnowledgeProvider implements KnowledgeProvider {

  public readonly id: string;

  private _client: any | null = null;

  constructor(private readonly opts: AzureSearchKnowledgeProviderOptions) {
    if (!opts.endpoint)  throw new Error('AzureSearchKnowledgeProvider: endpoint is required.');
    if (!opts.apiKey)    throw new Error('AzureSearchKnowledgeProvider: apiKey is required.');
    if (!opts.indexName) throw new Error('AzureSearchKnowledgeProvider: indexName is required.');
    this.id = `azure-ai-search:${opts.indexName}`;
  }

  private getClient(): any {
    if (this._client) return this._client;
    const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
    this._client = new SearchClient(
      this.opts.endpoint,
      this.opts.indexName,
      new AzureKeyCredential(this.opts.apiKey)
    );
    return this._client;
  }

  private async findOne(objectName: string, objectType: string): Promise<AzureSearchDoc | null> {
    const safe = objectName.trim().replace(/'/g, "''");
    const filter = `objectName eq '${safe}' and objectType eq '${objectType}'`;
    const client = this.getClient();
    const iter   = await client.search('*', { filter, top: 1 });
    for await (const result of iter.results) {
      return result.document as AzureSearchDoc;
    }
    return null;
  }

  private parseMeta(doc: AzureSearchDoc): Record<string, any> {
    if (!doc.metadataJson) return {};
    try { return JSON.parse(doc.metadataJson) ?? {}; }
    catch { return {}; }
  }

  // -------------------------------------------------------------------
  // verifyBadi
  // -------------------------------------------------------------------

  public async verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null> {
    if (!name?.trim()) return null;
    const doc = await this.findOne(name, 'BADI');
    if (!doc) return null;
    const meta = this.parseMeta(doc);

    const level = doc.cleanCoreLevel ?? null;
    const exists = level !== 'D';
    return {
      exists,
      name:            doc.objectName ?? name,
      level,
      module:          doc.module ?? null,
      enhancementSpot: (meta.enhancementSpot as string | undefined) ?? null,
      interfaceName:   (meta.interface       as string | undefined) ?? null,
      description:     doc.text ?? doc.title ?? '',
      alternative:     (meta.alternative     as string | undefined)
                       ?? (meta.replaces    as string | undefined)
                       ?? null,
      providerId:      this.id,
      catalogVersion:  `azure-index-${this.opts.indexName}`
    };
  }

  // -------------------------------------------------------------------
  // verifyExit
  // -------------------------------------------------------------------

  public async verifyExit(
    name: string,
    _programName?: string,
    _exitType?: ExitType
  ): Promise<ExitRecord | null> {
    if (!name?.trim()) return null;
    const doc = await this.findOne(name, 'EXIT');
    if (!doc) return null;
    const meta = this.parseMeta(doc);

    const level = doc.cleanCoreLevel ?? null;
    const exists = level !== 'D';
    return {
      exists,
      name:           doc.objectName ?? name,
      type:           (meta.type           as ExitType | undefined) ?? null,
      level,
      module:         doc.module ?? null,
      program:        (meta.program        as string | undefined) ?? null,
      include:        (meta.include        as string | undefined) ?? null,
      enhancement:    (meta.enhancement    as string | undefined) ?? null,
      functionModule: (meta.functionModule as string | undefined) ?? null,
      description:    doc.text ?? doc.title ?? '',
      alternative:    (meta.alternative    as string | undefined)
                       ?? (meta.replaces   as string | undefined)
                       ?? null,
      providerId:     this.id,
      catalogVersion: `azure-index-${this.opts.indexName}`
    };
  }

  // -------------------------------------------------------------------
  // checkCleanCoreLevel
  // -------------------------------------------------------------------

  public async checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null> {
    if (!name?.trim() || !type?.trim()) return null;
    const doc = await this.findOne(name, type.trim().toUpperCase());
    if (!doc) return null;
    const meta = this.parseMeta(doc);

    const level = (doc.cleanCoreLevel ?? null) as CleanCoreLevel | null;
    if (!level) return null;   // can't classify without a level — let static fall through

    const alternatives: CleanCoreAlternative[] = Array.isArray(meta.alternatives)
      ? meta.alternatives as CleanCoreAlternative[]
      : [];

    return {
      level,
      name:           doc.objectName ?? name,
      type:           doc.objectType ?? type,
      module:         doc.module ?? null,
      reasoning:      doc.text ?? doc.title ?? '',
      alternatives,
      confidence:     'high',
      providerId:     this.id,
      catalogVersion: `azure-index-${this.opts.indexName}`
    };
  }
}
