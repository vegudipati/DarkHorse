/**
 * Pipeline — orchestrates a single fetcher → chunker → embedder → index run.
 *
 * Decoupled from CLI parsing so the pipeline can be exercised by tests and
 * by the future Azure-backed CLI without duplication.
 */

'use strict';

import {
  IFetcher,
  IChunker,
  IEmbedder,
  IVectorIndex,
  IngestRunSummary
} from './types';

export interface PipelineDeps {
  fetcher:  IFetcher;
  chunker:  IChunker;
  embedder: IEmbedder;
  index:    IVectorIndex;
}

export class Pipeline {

  constructor(private readonly deps: PipelineDeps) {}

  public async ingest(): Promise<IngestRunSummary> {
    const { fetcher, chunker, embedder, index } = this.deps;

    const startedAt = new Date();
    const startMs   = startedAt.getTime();

    const documents = await fetcher.fetch();

    const allChunks = [];
    for (const doc of documents) {
      allChunks.push(...chunker.chunk(doc));
    }

    const embedded = await embedder.embed(allChunks);
    await index.upsert(embedded);

    const finishedAt = new Date();

    return {
      source:     fetcher.id,
      fetcher:    `${fetcher.id} (${fetcher.label})`,
      chunker:    chunker.id,
      embedder:   embedder.id,
      index:      index.id,
      documents:  documents.length,
      chunks:     embedded.length,
      startedAt:  startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startMs
    };
  }
}
