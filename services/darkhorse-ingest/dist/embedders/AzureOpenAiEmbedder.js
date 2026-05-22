/**
 * AzureOpenAiEmbedder — production IEmbedder backed by Azure OpenAI.
 *
 * Uses the official OpenAI SDK (`openai` package) with the `AzureOpenAI`
 * client. This is the pattern Microsoft now steers Azure customers toward:
 * same SDK as direct-OpenAI clients, swap the constructor, keep the rest.
 *
 * Config (all required when this embedder is in use):
 *   - endpoint:           https://<resource>.openai.azure.com
 *   - apiKey:             Azure OpenAI key (or use AAD via apiKey=null,
 *                         though Sprint 2 ships key-only)
 *   - embeddingDeployment: the deployment name created in the Azure
 *                          portal for the text-embedding-3-small model
 *   - apiVersion:         optional; defaults to a recent stable preview
 *
 * Batching: Azure OpenAI accepts up to ~2048 inputs per /embeddings call,
 * but per-request token caps mean smaller chunks are safer. We batch at
 * 16 chunks per request which matches Microsoft's recommended starting
 * point for embedding throughput.
 *
 * AWS-portability note: this file is the ONLY place that imports the
 * OpenAI SDK. A future BedrockTitanEmbedder.ts implements the same
 * IEmbedder interface using @aws-sdk/client-bedrock-runtime; nothing
 * else in the pipeline needs to change.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureOpenAiEmbedder = void 0;
const DEFAULT_API_VERSION = '2024-10-21';
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_DIMENSIONS = 1536;
// ---------------------------------------------------------------------------
// Embedder implementation
// ---------------------------------------------------------------------------
class AzureOpenAiEmbedder {
    opts;
    id;
    dimensions;
    batchSize;
    embeddingDeployment;
    // The SDK client is lazy-instantiated so importing this module does NOT
    // require Azure config — only invoking embed() does.
    _client = null;
    constructor(opts) {
        this.opts = opts;
        if (!opts.endpoint)
            throw new Error('AzureOpenAiEmbedder: endpoint is required.');
        if (!opts.apiKey)
            throw new Error('AzureOpenAiEmbedder: apiKey is required.');
        if (!opts.embeddingDeployment)
            throw new Error('AzureOpenAiEmbedder: embeddingDeployment is required.');
        this.embeddingDeployment = opts.embeddingDeployment;
        this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
        this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
        this.id = `azure-openai-${opts.embeddingDeployment}-d${this.dimensions}`;
    }
    getClient() {
        if (this._client)
            return this._client;
        // Lazy import so the rest of the pipeline doesn't pay the cost when
        // this embedder isn't selected.
        const { AzureOpenAI } = require('openai');
        this._client = new AzureOpenAI({
            endpoint: this.opts.endpoint,
            apiKey: this.opts.apiKey,
            apiVersion: this.opts.apiVersion ?? DEFAULT_API_VERSION
        });
        return this._client;
    }
    async embed(chunks) {
        if (chunks.length === 0)
            return [];
        const client = this.getClient();
        const now = new Date().toISOString();
        const result = new Array(chunks.length);
        // Batch in slices to stay under per-request input caps.
        for (let i = 0; i < chunks.length; i += this.batchSize) {
            const slice = chunks.slice(i, i + this.batchSize);
            const inputs = slice.map(c => c.text);
            const response = await client.embeddings.create({
                model: this.embeddingDeployment, // Azure: pass the deployment name
                input: inputs,
                dimensions: this.dimensions
            });
            // The SDK returns data in input-order; defensive sort just in case.
            const byIndex = new Map();
            for (const item of response.data) {
                byIndex.set(item.index, item.embedding);
            }
            for (let j = 0; j < slice.length; j++) {
                const vec = byIndex.get(j);
                if (!vec) {
                    throw new Error(`AzureOpenAiEmbedder: missing embedding for batch index ${j}`);
                }
                const c = slice[j];
                result[i + j] = {
                    ...c,
                    vector: vec,
                    embeddedAt: now,
                    embeddingModel: this.id
                };
            }
        }
        return result;
    }
}
exports.AzureOpenAiEmbedder = AzureOpenAiEmbedder;
//# sourceMappingURL=AzureOpenAiEmbedder.js.map