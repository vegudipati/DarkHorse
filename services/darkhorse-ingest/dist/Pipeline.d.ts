/**
 * Pipeline — orchestrates a single fetcher → chunker → embedder → index run.
 *
 * Decoupled from CLI parsing so the pipeline can be exercised by tests and
 * by the future Azure-backed CLI without duplication.
 */
import { IFetcher, IChunker, IEmbedder, IVectorIndex, IngestRunSummary } from './types';
export interface PipelineDeps {
    fetcher: IFetcher;
    chunker: IChunker;
    embedder: IEmbedder;
    index: IVectorIndex;
}
export declare class Pipeline {
    private readonly deps;
    constructor(deps: PipelineDeps);
    ingest(): Promise<IngestRunSummary>;
}
//# sourceMappingURL=Pipeline.d.ts.map