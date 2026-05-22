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
import { IEmbedder, DocumentChunk, EmbeddedChunk } from '../types';
export interface AzureOpenAiEmbedderOptions {
    endpoint: string;
    apiKey: string;
    embeddingDeployment: string;
    apiVersion?: string;
    /** Per-request input batch size. Default 16. */
    batchSize?: number;
    /** Vector dimension. text-embedding-3-small defaults to 1536; some
     *  deployments customise this. Defaults to 1536. */
    dimensions?: number;
}
export declare class AzureOpenAiEmbedder implements IEmbedder {
    private readonly opts;
    readonly id: string;
    readonly dimensions: number;
    private readonly batchSize;
    private readonly embeddingDeployment;
    private _client;
    constructor(opts: AzureOpenAiEmbedderOptions);
    private getClient;
    embed(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]>;
}
//# sourceMappingURL=AzureOpenAiEmbedder.d.ts.map