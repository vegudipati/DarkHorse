/**
 * MockEmbedder — deterministic embedding backend for Sprint 2 session 1.
 *
 * Produces a fixed-dimension vector from input text via a simple keyed hash.
 * The vector is reproducible (same text → same vector), which is enough to
 * exercise the upsert + retrieval pipeline end-to-end without an Azure
 * OpenAI deployment.
 *
 * IMPORTANT: this embedder is NOT semantically meaningful. Two unrelated
 * sentences will not have systematically different similarity from two
 * paraphrases. Sprint 2 session 2 swaps this for AzureOpenAiEmbedder.
 */
import { IEmbedder, DocumentChunk, EmbeddedChunk } from '../types';
export interface MockEmbedderOptions {
    dimensions?: number;
}
export declare class MockEmbedder implements IEmbedder {
    readonly id: string;
    readonly dimensions: number;
    constructor(opts?: MockEmbedderOptions);
    embed(chunks: DocumentChunk[]): Promise<EmbeddedChunk[]>;
    private vectorize;
}
export declare function l2Normalise(vec: number[]): number[];
//# sourceMappingURL=MockEmbedder.d.ts.map