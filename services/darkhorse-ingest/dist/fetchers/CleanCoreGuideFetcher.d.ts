/**
 * CleanCoreGuideFetcher — Sprint 2 session 2 fetcher for the SAP Clean Core
 * Extensibility Guide.
 *
 * The Clean Core Extensibility Guide is published by SAP as a PDF that
 * defines the Level A-D extensibility model and the canonical patterns
 * for ABAP development on S/4HANA Cloud and Private editions. It is the
 * authoritative source for `check_clean_core_level` reasoning.
 *
 * Sprint 2 strategy:
 *   - Default path: load fixtures/clean-core-guide-seed.json — a curated
 *     extract of the canonical rules (Level A/B/C/D definitions, RAP / CDS /
 *     SLG1 / APJ / BAdI / CBO patterns). Each rule becomes one IngestDocument
 *     of objectType='PATTERN' so the index can be queried by patternId.
 *   - Live path (live=true + pdfUrl): downloads the PDF, parses it via
 *     pdf-parse, splits on heading-style markers ("Level A", "Level B",
 *     numbered sections) into pattern-sized documents. The live path stays
 *     disabled until a Deloitte-pinned PDF URL is in scope.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
export interface CleanCoreGuideFetcherOptions {
    /** When true, fetcher pulls a real PDF and parses it. When false (default),
     *  loads from the curated seed fixture. */
    live?: boolean;
    /** Absolute URL of the SAP Clean Core Extensibility Guide PDF. Required when
     *  live=true. */
    pdfUrl?: string;
    /** Override fixture path for tests. */
    fixturePath?: string;
}
export declare class CleanCoreGuideFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: CleanCoreGuideFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLivePdf;
    private splitParsedPdf;
    private toDocument;
}
//# sourceMappingURL=CleanCoreGuideFetcher.d.ts.map