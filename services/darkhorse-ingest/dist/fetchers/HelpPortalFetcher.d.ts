/**
 * HelpPortalFetcher — scrapes help.sap.com CDS view reference pages for
 * per-view field metadata.
 *
 * Why this fetcher exists:
 *   The Cloudification Repository tells us a view EXISTS and what state it's
 *   in. It does NOT tell us which fields the view exposes. When the Code
 *   Agent generates a SELECT against I_OutboundDelivery, it still guesses
 *   field names from training data — producing hallucinations like `ktokk`
 *   on I_Supplier (a KNA1/LFA1 field that doesn't exist on the released
 *   business-partner views) or invented LIKP columns in Z wrappers.
 *
 *   This fetcher fixes the gap by pulling the field table from each view's
 *   help-portal reference page. Output JSON feeds a CdsFieldCatalogProvider
 *   that surfaces fields[] in the get_cds_view tool response.
 *
 * Why help.sap.com (not api.sap.com or an EDMX bulk dump):
 *   - help.sap.com is the canonical SAP-published reference. Every released
 *     CDS view has a page.
 *   - api.sap.com is also SPA but is organized by API service, not by
 *     individual view — would require navigating service → entity, ~similar
 *     scraping cost.
 *   - EDMX bulk dumps require S-user authentication and aren't published as
 *     a public artefact.
 *
 * Site rendering:
 *   help.sap.com is a JS-rendered SPA. Plain HTTP fetchers receive an empty
 *   shell. The live path uses puppeteer-core via BrowserDiscovery, same as
 *   ArchitectureCenterFetcher.
 *
 * Input shape:
 *   The fetcher takes an explicit list of {viewName, url} pairs in options.
 *   URL discovery (mapping view name → help-portal URL automatically) is a
 *   follow-up task — discovery is a separate concern from extraction, and
 *   getting extraction right on a small curated list first is the right
 *   sequence.
 *
 *   Curation source for the initial list: pull the top-N most-frequently
 *   needed I_* CDS views from the cloudification fixture + the views named
 *   in the most-failing pipelines (OTC backorder, PTP PO enhancement, ZOTC
 *   routing report).
 *
 * Output shape:
 *   One IngestDocument per view, with:
 *     - title:       the view's human label from the help page
 *     - body:        a human-readable summary + the rendered field table
 *     - metadata.fields: structured field array (the actual value the MCP
 *                   provider consumes)
 *     - metadata.fieldsJson: same array serialized so the JSON-on-disk
 *                   fixture round-trips without losing field structure
 *                   through DocumentChunk -> EmbeddedChunk -> SearchHit.
 *
 * Robustness:
 *   The help-portal HTML changes shape periodically. The extractor tries
 *   several selectors in priority order and degrades gracefully — a view
 *   with no extractable table still produces a document carrying the page
 *   title and full text body, so the LLM has SOMETHING to ground against
 *   even when our parser misses.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
/** One view to fetch — name + the help.sap.com reference URL. */
export interface ViewTarget {
    viewName: string;
    url: string;
    module?: string | null;
    /** Curator-provided hint about what the view is for. Surfaces in the
     *  rendered prompt block when the help-page summary is thin. */
    notes?: string;
}
export interface CdsFieldSchema {
    name: string;
    type: string | null;
    length: string | null;
    isKey: boolean;
    association: string | null;
    description: string;
}
export interface ViewFieldExtract {
    viewName: string;
    pageTitle: string;
    pageUrl: string;
    fields: CdsFieldSchema[];
    /** Free-text page body — kept for chunker/embedder so semantic search
     *  works even on pages where field extraction failed. */
    bodyText: string;
    /** True if the field table extractor found at least one row. */
    hasFields: boolean;
}
export interface HelpPortalFetcherOptions {
    /** When true, launches puppeteer-core and scrapes each ViewTarget.
     *  When false (default), loads from the seed fixture. */
    live?: boolean;
    /** Crawl mode: render this root URL, discover all child links under the
     *  same product/version prefix, and scrape each. Supersedes targets[].
     *  Example: https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/<ver>/<guid>.html */
    crawlRootUrl?: string;
    /** Maximum crawl depth from root. Default 3. */
    maxCrawlDepth?: number;
    /** Maximum pages to scrape beyond the root. Default 500. */
    maxCrawlPages?: number;
    /** Flat targets list. Required when live=true and crawlRootUrl is not set. */
    targets?: ViewTarget[];
    /** Override fixture path for tests / replay. */
    fixturePath?: string;
    /** Explicit browser executable path. If absent, BrowserDiscovery resolves. */
    chromePath?: string;
    /** CSS selector to wait for before extracting content. */
    contentSelector?: string;
    /** Per-page timeout in ms. Default 45s — help.sap.com is slow. */
    pageTimeoutMs?: number;
    /** Milliseconds to sleep between pages. Default 1500ms. */
    rateLimitMs?: number;
    /** Optional checkpoint file path (JSON-lines, one completed URL per line). */
    checkpointPath?: string;
    /** When verbose=true, print per-view progress to stderr. */
    verbose?: boolean;
}
export declare class HelpPortalFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: HelpPortalFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private crawlFromRoot;
    private writeSeedFixture;
    private toDocumentFromExtract;
    private toFailureDocument;
    private toDocumentFromSeed;
}
//# sourceMappingURL=HelpPortalFetcher.d.ts.map