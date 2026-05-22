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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureSearchKnowledgeProvider = void 0;
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
class AzureSearchKnowledgeProvider {
    opts;
    id;
    _client = null;
    constructor(opts) {
        this.opts = opts;
        if (!opts.endpoint)
            throw new Error('AzureSearchKnowledgeProvider: endpoint is required.');
        if (!opts.apiKey)
            throw new Error('AzureSearchKnowledgeProvider: apiKey is required.');
        if (!opts.indexName)
            throw new Error('AzureSearchKnowledgeProvider: indexName is required.');
        this.id = `azure-ai-search:${opts.indexName}`;
    }
    getClient() {
        if (this._client)
            return this._client;
        const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
        this._client = new SearchClient(this.opts.endpoint, this.opts.indexName, new AzureKeyCredential(this.opts.apiKey));
        return this._client;
    }
    async findOne(objectName, objectType) {
        const safe = objectName.trim().replace(/'/g, "''");
        const filter = `objectName eq '${safe}' and objectType eq '${objectType}'`;
        const client = this.getClient();
        const iter = await client.search('*', { filter, top: 1 });
        for await (const result of iter.results) {
            return result.document;
        }
        return null;
    }
    parseMeta(doc) {
        if (!doc.metadataJson)
            return {};
        try {
            return JSON.parse(doc.metadataJson) ?? {};
        }
        catch {
            return {};
        }
    }
    // -------------------------------------------------------------------
    // verifyBadi
    // -------------------------------------------------------------------
    async verifyBadi(name, _program, _module) {
        if (!name?.trim())
            return null;
        const doc = await this.findOne(name, 'BADI');
        if (!doc)
            return null;
        const meta = this.parseMeta(doc);
        const level = doc.cleanCoreLevel ?? null;
        const exists = level !== 'D';
        return {
            exists,
            name: doc.objectName ?? name,
            level,
            module: doc.module ?? null,
            enhancementSpot: meta.enhancementSpot ?? null,
            interfaceName: meta.interface ?? null,
            description: doc.text ?? doc.title ?? '',
            alternative: meta.alternative
                ?? meta.replaces
                ?? null,
            providerId: this.id,
            catalogVersion: `azure-index-${this.opts.indexName}`
        };
    }
    // -------------------------------------------------------------------
    // verifyExit
    // -------------------------------------------------------------------
    async verifyExit(name, _programName, _exitType) {
        if (!name?.trim())
            return null;
        const doc = await this.findOne(name, 'EXIT');
        if (!doc)
            return null;
        const meta = this.parseMeta(doc);
        const level = doc.cleanCoreLevel ?? null;
        const exists = level !== 'D';
        return {
            exists,
            name: doc.objectName ?? name,
            type: meta.type ?? null,
            level,
            module: doc.module ?? null,
            program: meta.program ?? null,
            include: meta.include ?? null,
            enhancement: meta.enhancement ?? null,
            functionModule: meta.functionModule ?? null,
            description: doc.text ?? doc.title ?? '',
            alternative: meta.alternative
                ?? meta.replaces
                ?? null,
            providerId: this.id,
            catalogVersion: `azure-index-${this.opts.indexName}`
        };
    }
    // -------------------------------------------------------------------
    // checkCleanCoreLevel
    // -------------------------------------------------------------------
    async checkCleanCoreLevel(name, type) {
        if (!name?.trim() || !type?.trim())
            return null;
        const doc = await this.findOne(name, type.trim().toUpperCase());
        if (!doc)
            return null;
        const meta = this.parseMeta(doc);
        const level = (doc.cleanCoreLevel ?? null);
        if (!level)
            return null; // can't classify without a level — let static fall through
        const alternatives = Array.isArray(meta.alternatives)
            ? meta.alternatives
            : [];
        return {
            level,
            name: doc.objectName ?? name,
            type: doc.objectType ?? type,
            module: doc.module ?? null,
            reasoning: doc.text ?? doc.title ?? '',
            alternatives,
            confidence: 'high',
            providerId: this.id,
            catalogVersion: `azure-index-${this.opts.indexName}`
        };
    }
}
exports.AzureSearchKnowledgeProvider = AzureSearchKnowledgeProvider;
//# sourceMappingURL=AzureSearchKnowledgeProvider.js.map