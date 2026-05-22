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
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockEmbedder = void 0;
exports.l2Normalise = l2Normalise;
const DEFAULT_DIM = 1536; // matches Azure OpenAI text-embedding-3-small default
class MockEmbedder {
    id;
    dimensions;
    constructor(opts = {}) {
        this.dimensions = opts.dimensions ?? DEFAULT_DIM;
        if (this.dimensions < 16 || this.dimensions > 4096) {
            throw new Error(`MockEmbedder: dimensions must be in [16, 4096], got ${this.dimensions}.`);
        }
        this.id = `mock-hash-v1-d${this.dimensions}`;
    }
    async embed(chunks) {
        const now = new Date().toISOString();
        return chunks.map(chunk => ({
            ...chunk,
            vector: this.vectorize(chunk.text),
            embeddedAt: now,
            embeddingModel: this.id
        }));
    }
    // -------------------------------------------------------------------
    // Vectorisation — simple but stable. For each input character, fold its
    // char code into one of `dimensions` accumulators using its position
    // index as a stride. Then L2-normalise so cosine similarity is a plain
    // dot product later.
    // -------------------------------------------------------------------
    vectorize(text) {
        const dim = this.dimensions;
        const vec = new Array(dim).fill(0);
        const lowered = text.toLowerCase();
        for (let i = 0; i < lowered.length; i++) {
            const c = lowered.charCodeAt(i);
            const idx = (c * 31 + i * 17) % dim;
            // Cheap sign mixing so the vector is not strictly non-negative.
            const sign = (c & 1) === 0 ? 1 : -1;
            vec[idx] = (vec[idx] ?? 0) + sign * (1 + (c % 7) * 0.1);
        }
        return l2Normalise(vec);
    }
}
exports.MockEmbedder = MockEmbedder;
function l2Normalise(vec) {
    let sumSq = 0;
    for (const v of vec)
        sumSq += v * v;
    const norm = Math.sqrt(sumSq);
    if (norm === 0)
        return vec.slice();
    return vec.map(v => v / norm);
}
//# sourceMappingURL=MockEmbedder.js.map