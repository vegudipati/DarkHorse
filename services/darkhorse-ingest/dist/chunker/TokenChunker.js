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
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenChunker = void 0;
const DEFAULT_CHUNK_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 50;
const TOKENS_TO_WORDS_RATIO = 0.75; // ≈ 0.75 words per token for English
class TokenChunker {
    id;
    chunkWords;
    overlapWords;
    constructor(opts = {}) {
        const chunkTokens = opts.chunkSizeTokens ?? DEFAULT_CHUNK_TOKENS;
        const overlapTokens = opts.chunkOverlapTokens ?? DEFAULT_OVERLAP_TOKENS;
        if (chunkTokens <= 0) {
            throw new Error('TokenChunker: chunkSizeTokens must be positive.');
        }
        if (overlapTokens < 0 || overlapTokens >= chunkTokens) {
            throw new Error('TokenChunker: chunkOverlapTokens must be in [0, chunkSizeTokens).');
        }
        this.chunkWords = Math.max(1, Math.round(chunkTokens * TOKENS_TO_WORDS_RATIO));
        this.overlapWords = Math.max(0, Math.round(overlapTokens * TOKENS_TO_WORDS_RATIO));
        this.id = `token-${chunkTokens}-overlap-${overlapTokens}`;
    }
    chunk(doc) {
        const words = doc.body.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) {
            return [];
        }
        // Single-chunk fast path — covers the seed-fixture documents.
        if (words.length <= this.chunkWords) {
            return [this.buildChunk(doc, 0, doc.body)];
        }
        const stride = this.chunkWords - this.overlapWords;
        const chunks = [];
        let start = 0;
        let ordinal = 0;
        while (start < words.length) {
            const end = Math.min(start + this.chunkWords, words.length);
            const slice = words.slice(start, end).join(' ');
            chunks.push(this.buildChunk(doc, ordinal, slice));
            if (end >= words.length)
                break;
            start += stride;
            ordinal += 1;
        }
        return chunks;
    }
    buildChunk(doc, ordinal, text) {
        return {
            chunkId: `${doc.id}#${ordinal}`,
            documentId: doc.id,
            ordinal,
            text,
            source: doc.source,
            sourceUrl: doc.sourceUrl,
            objectName: doc.objectName,
            objectType: doc.objectType,
            module: doc.module,
            cleanCoreLevel: doc.cleanCoreLevel,
            title: doc.title,
            metadata: doc.metadata
        };
    }
}
exports.TokenChunker = TokenChunker;
//# sourceMappingURL=TokenChunker.js.map