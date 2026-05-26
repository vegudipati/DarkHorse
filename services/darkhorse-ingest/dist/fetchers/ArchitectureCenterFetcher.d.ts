/**
 * ArchitectureCenterFetcher — Sprint 2 session 3 fetcher for the SAP
 * Architecture Center (architecture.learning.sap.com).
 *
 * The Architecture Center publishes ~87 reference architectures spanning AI,
 * integration, app development, DevOps, and Clean Core. It is the canonical
 * source for "what is the approved pattern for X" in the SO/FDS/TDS agents.
 *
 * Why this fetcher is special:
 *   The site is a JS-rendered Docusaurus app. Plain HTTP fetchers receive an
 *   empty HTML shell — the actual content is hydrated client-side. Per the
 *   CPI-6 spec the live ingestion path MUST render pages via headless
 *   Chrome.
 *
 * Sprint 2 strategy:
 *   - Default path: load fixtures/architecture-center-seed.json — curated
 *     extracts of the 6 priority documents from the spec plus a small set
 *     of widely-referenced reference architectures.
 *   - Live path (live=true + urls): launches headless Chrome via
 *     puppeteer-core, navigates each /docs/ref-arch/<id> URL, waits for the
 *     content selector, extracts page text, returns one IngestDocument per
 *     architecture.
 *
 * Browser dependency:
 *   puppeteer-core requires a Chromium-based browser to be installed locally
 *   (we do NOT bundle Chrome). BrowserDiscovery resolves Chrome → Edge →
 *   CHROME_PATH env. The seed-fixture path requires no browser.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
export interface ArchitectureCenterFetcherOptions {
    live?: boolean;
    /** Auto-discover all ref-arch URLs from the site's sitemap.xml before
     *  scraping. When true, the urls[] list is used as a fallback seed in case
     *  sitemap discovery returns zero results. Default false. */
    discoverUrls?: boolean;
    /** Override the sitemap URL. Default: https://architecture.learning.sap.com/sitemap.xml */
    sitemapUrl?: string;
    /** Seed URL list. When discoverUrls=true these are merged with sitemap
     *  results (deduped). When discoverUrls=false, required for live mode. */
    urls?: string[];
    /** Override fixture path for tests. */
    fixturePath?: string;
    /** Explicit browser executable path. If absent, BrowserDiscovery resolves. */
    chromePath?: string;
    /** CSS selector to wait for before extracting text. Docusaurus content
     *  div by convention. */
    contentSelector?: string;
    /** Per-page timeout in ms. Default 30s. */
    pageTimeoutMs?: number;
    /** Timeout in ms for the sitemap HTTP fetch. Default 15s. */
    sitemapTimeoutMs?: number;
}
export declare class ArchitectureCenterFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: ArchitectureCenterFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private discoverFromSitemap;
    private toDocument;
}
//# sourceMappingURL=ArchitectureCenterFetcher.d.ts.map