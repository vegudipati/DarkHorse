/**
 * SapApiHubSearchFetcher — scrapes the SAP API Business Hub search pages
 * (api.sap.com/search?tab=...) using headless Chrome to discover ALL
 * published API artifacts: OData APIs, CDS Views, Integration Flows,
 * Events, Build artifacts, Analytics, Data Products.
 *
 * Why puppeteer (not plain HTTP):
 *   api.sap.com is an Angular SPA. The search results are rendered
 *   client-side via infinite scroll — plain HTTP only gets the empty shell.
 *
 * Extraction strategy:
 *   Rather than targeting CSS classes (which SAP rotates frequently), we
 *   harvest every <a href> whose path matches /api/<NAME>/ or
 *   /package/<PKG>/artifact/<ARTIFACT>. The service/artifact name is always
 *   encoded in the URL, making this robust across UI redesigns.
 *
 * Outputs:
 *   1. IngestDocument[] — one document per discovered artifact with title,
 *      description, type, and package. Feeds the vector index for semantic
 *      search ("which integration package handles vendor invoice posting?").
 *   2. fixtures/api-hub-search-discovery.json — structured catalog of ALL
 *      discovered items by category. The EdmxFetcher reads the "APIs" section
 *      to get a comprehensive OData service-name list.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
export declare const DEFAULT_SEARCH_URLS: Record<string, string>;
export interface SearchResultItem {
    id: string;
    title: string;
    type: string;
    category: string;
    detailUrl: string;
    description: string;
}
export interface ApiHubDiscoveryFile {
    _metadata: {
        fetchedAt: string;
        totalItems: number;
        categories: string[];
    };
    byCategory: Record<string, SearchResultItem[]>;
    /** Flat list of OData service names (from "APIs" category) — for EdmxFetcher. */
    odataServiceNames: string[];
}
export interface SapApiHubSearchFetcherOptions {
    live?: boolean;
    /** Map of category name → search URL. Defaults to DEFAULT_SEARCH_URLS. */
    searchUrls?: Record<string, string>;
    /** Categories to scrape. Default: all keys in searchUrls. */
    categories?: string[];
    /** Max items to collect per category (0 = unlimited). Default 0. */
    maxItemsPerCat?: number;
    /** Scroll increment in px. Default 800. */
    scrollStep?: number;
    /** Ms to wait after each scroll for new content to load. Default 1200. */
    scrollWaitMs?: number;
    /** Max scroll rounds per page (safety cap). Default 200. */
    maxScrolls?: number;
    /** Per-page navigation timeout in ms. Default 60s. */
    pageTimeoutMs?: number;
    /** Session cookie for api.sap.com (needed if search results are auth-gated). */
    cookie?: string;
    /** Explicit browser executable. */
    chromePath?: string;
    /** Override discovery output path. */
    discoveryPath?: string;
    /** Override fixture path for fixture-mode replay. */
    fixturePath?: string;
    verbose?: boolean;
}
export declare class SapApiHubSearchFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: SapApiHubSearchFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private autoScroll;
    private toDocument;
}
//# sourceMappingURL=SapApiHubSearchFetcher.d.ts.map