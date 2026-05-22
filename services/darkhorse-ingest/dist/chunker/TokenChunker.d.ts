/**
 * TokenChunker — word-approximation chunker for Sprint 2.
 *
 * The spec calls for 500-token chunks with 50-token overlap. Implementing this
 * precisely would require a model-specific tokenizer (e.g. tiktoken), which is
 * a native dep we explicitly want to avoid in Sprint 2. Instead we approximate
 * with whitespace-delimited words. The OpenAI rule of thumb is roughly
 * 1 token ≈ 0.75 words for English; we treat the chunk-size parameter as
 * "approximate tokens" and convert internally.
 *
 * Documents shorter than the chunk size yield exactly one chunk — the common
 * case for the seed fixture entries.
 */
import { IChunker, IngestDocument, DocumentChunk } from '../types';
export interface TokenChunkerOptions {
    /** Target chunk size in approximate tokens. Spec default: 500. */
    chunkSizeTokens?: number;
    /** Overlap between consecutive chunks, in approximate tokens. Spec default: 50. */
    chunkOverlapTokens?: number;
}
export declare class TokenChunker implements IChunker {
    readonly id: string;
    private readonly chunkWords;
    private readonly overlapWords;
    constructor(opts?: TokenChunkerOptions);
    chunk(doc: IngestDocument): DocumentChunk[];
    private buildChunk;
}
//# sourceMappingURL=TokenChunker.d.ts.map