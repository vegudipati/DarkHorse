/**
 * InMemoryVectorIndex — Sprint 2 session 1 vector store.
 *
 * Two access patterns:
 *   1. lookupByName    — exact match on objectName (+ optional objectType).
 *                        Powers verify_badi / verify_exit / check_clean_core_level
 *                        when the MCP server is migrated to this index in
 *                        Sprint 2 session 4.
 *   2. searchSemantic  — cosine similarity over stored vectors with an
 *                        optional metadata filter. Powers future search_sap_apis
 *                        and pattern-retrieval tools.
 *
 * Persistence: this backend keeps everything in memory. The CLI provides a
 * snapshot-to-disk option (writes JSON to data/<source>.snapshot.json) so
 * a re-ingest cycle isn't required between sessions. Snapshots are not the
 * primary persistence mechanism — Azure AI Search will be in later sessions.
 */

'use strict';

import fs   = require('fs');
import path = require('path');

import {
  IVectorIndex,
  EmbeddedChunk,
  SearchHit,
  SapObjectType,
  VectorFilter
} from '../types';

export interface InMemoryVectorIndexOptions {
  /** Optional snapshot file. If present at construction, the index loads from
   *  it; subsequent upserts can persist back via persist(). */
  snapshotPath?: string;
}

export class InMemoryVectorIndex implements IVectorIndex {

  public readonly id: string = 'in-memory-v1';

  // Primary store: chunkId → EmbeddedChunk
  private readonly chunksById: Map<string, EmbeddedChunk> = new Map();

  // Secondary index: normalisedObjectName → Set<chunkId>
  private readonly chunkIdsByName: Map<string, Set<string>> = new Map();

  constructor(private readonly options: InMemoryVectorIndexOptions = {}) {
    if (options.snapshotPath && fs.existsSync(options.snapshotPath)) {
      this.loadSnapshot(options.snapshotPath);
    }
  }

  // -------------------------------------------------------------------
  // Upsert — Stores embedded chunks. Existing chunkIds are overwritten.
  // -------------------------------------------------------------------

  public async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    for (const c of chunks) {
      this.chunksById.set(c.chunkId, c);
      if (c.objectName) {
        const key = c.objectName.trim().toUpperCase();
        let bucket = this.chunkIdsByName.get(key);
        if (!bucket) {
          bucket = new Set<string>();
          this.chunkIdsByName.set(key, bucket);
        }
        bucket.add(c.chunkId);
      }
    }
  }

  // -------------------------------------------------------------------
  // Lookup by exact name (+ optional type)
  // -------------------------------------------------------------------

  public async lookupByName(objectName: string, objectType?: SapObjectType): Promise<SearchHit[]> {
    if (!objectName || objectName.trim().length === 0) {
      return [];
    }
    const key   = objectName.trim().toUpperCase();
    const bucket = this.chunkIdsByName.get(key);
    if (!bucket || bucket.size === 0) {
      return [];
    }

    const hits: SearchHit[] = [];
    for (const id of bucket) {
      const chunk = this.chunksById.get(id);
      if (!chunk) continue;
      if (objectType && chunk.objectType !== objectType) continue;
      hits.push({ chunk, score: 1.0 });
    }
    return hits;
  }

  // -------------------------------------------------------------------
  // Cosine-similarity semantic search with optional filter
  // -------------------------------------------------------------------

  public async searchSemantic(
    queryVector: number[],
    topK: number,
    filter?: VectorFilter
  ): Promise<SearchHit[]> {

    if (!queryVector || queryVector.length === 0) {
      return [];
    }

    // Heap-of-K is overkill for an in-memory mock; full scan is fine.
    const hits: SearchHit[] = [];
    for (const chunk of this.chunksById.values()) {
      if (!chunkPassesFilter(chunk, filter)) continue;
      if (chunk.vector.length !== queryVector.length) continue;   // dim mismatch
      const score = cosineSimilarity(queryVector, chunk.vector);
      hits.push({ chunk, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(0, topK));
  }

  // -------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------

  public async stats(): Promise<{ chunks: number; documents: number; bySource: Record<string, number> }> {
    const bySource: Record<string, number> = {};
    const documents = new Set<string>();
    for (const c of this.chunksById.values()) {
      bySource[c.source] = (bySource[c.source] ?? 0) + 1;
      documents.add(c.documentId);
    }
    return { chunks: this.chunksById.size, documents: documents.size, bySource };
  }

  // -------------------------------------------------------------------
  // Snapshot helpers — JSON dump, for convenience across sessions.
  // -------------------------------------------------------------------

  public persist(snapshotPath: string = this.options.snapshotPath ?? ''): void {
    if (!snapshotPath) {
      throw new Error('InMemoryVectorIndex.persist: no snapshotPath configured.');
    }
    const dir = path.dirname(snapshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      _metadata: {
        indexId:     this.id,
        savedAt:     new Date().toISOString(),
        chunkCount:  this.chunksById.size
      },
      chunks: Array.from(this.chunksById.values())
    };
    fs.writeFileSync(snapshotPath, JSON.stringify(payload), 'utf-8');
  }

  private loadSnapshot(snapshotPath: string): void {
    const raw  = fs.readFileSync(snapshotPath, 'utf-8');
    const data = JSON.parse(raw) as { chunks: EmbeddedChunk[] };
    if (!data.chunks) return;
    for (const c of data.chunks) {
      this.chunksById.set(c.chunkId, c);
      if (c.objectName) {
        const key = c.objectName.trim().toUpperCase();
        let bucket = this.chunkIdsByName.get(key);
        if (!bucket) {
          bucket = new Set<string>();
          this.chunkIdsByName.set(key, bucket);
        }
        bucket.add(c.chunkId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function chunkPassesFilter(chunk: EmbeddedChunk, f?: VectorFilter): boolean {
  if (!f) return true;
  if (f.source         && chunk.source         !== f.source)         return false;
  if (f.objectType     && chunk.objectType     !== f.objectType)     return false;
  if (f.cleanCoreLevel && chunk.cleanCoreLevel !== f.cleanCoreLevel) return false;
  if (f.module         && chunk.module         !== f.module)         return false;
  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
  // Vectors stored from MockEmbedder are already L2-normalised, so we
  // could just dot-product. We compute the full form here for safety in
  // case the future Azure embedder returns un-normalised vectors.
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na  += x * x;
    nb  += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
