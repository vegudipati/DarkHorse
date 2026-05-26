/**
 * SapApiHubEdmxFetcher — bulk field-metadata fetcher via api.sap.com EDMX.
 *
 * The user's pain point: a per-CDS-view scraper against help.sap.com requires
 * manual URL collection (no clean view-name → URL mapping). EDMX bypasses that
 * entirely.
 *
 * Each released SAP OData service publishes a $metadata XML document
 * (Entity Data Model XML, "EDMX") containing the field schemas of every
 * entity it exposes — CDS views included. ~500 services × ~10-30 entities
 * each ≈ 7K+ entity schemas in a single bulk download, versus 7K+ separate
 * help-portal page scrapes.
 *
 * The fetcher is the inverse of HelpPortalFetcher:
 *   HelpPortalFetcher:  one help page  -> one CDS view's fields
 *   SapApiHubEdmxFetcher: one EDMX file -> many CDS views' fields
 *
 * Pipeline:
 *   1. List services from api.sap.com OData catalog (paged).
 *   2. For each service, download its EDMX via one of several known URL
 *      patterns (the catalog provides the canonical link but we keep
 *      fallbacks in case the schema changes).
 *   3. Parse the EDMX to extract EntityType blocks → field arrays.
 *   4. Emit one IngestDocument per entity, keyed by its TypeName so the
 *      CdsFieldCatalogProvider can index it.
 *
 * EDMX parsing strategy:
 *   We use regex extraction rather than a full XML parser. CSDL (the schema
 *   inside EDMX) has a predictable structure — EntityType blocks are
 *   well-delimited and their Property children are flat (no nested tags
 *   that confuse regex matching). Trade-off: simpler dependency footprint
 *   (no @xmldom/xmldom, no fast-xml-parser) at the cost of accepting a
 *   small set of CSDL edge cases (function imports, complex types) being
 *   skipped. For field-grounding purposes, EntityType + Property is the
 *   only thing the grounder cares about.
 *
 * Live mode requires network. Set DARKHORSE_API_HUB_EDMX_LIVE=true. Fixture
 * mode (default) emits zero documents — the result of a live run is
 * persisted to fixtures/api-sap-hub-edmx.snapshot.json and consumed by the
 * MCP CdsFieldCatalogProvider on next restart.
 *
 * No authentication: api.sap.com's public-facing OData catalog is
 * unauthenticated. Authenticated sandbox testing of individual APIs is a
 * separate concern (S-user creds) and isn't required for metadata
 * download.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
/** Field metadata for a single EntityType property. Matches
 *  HelpPortalFetcher.CdsFieldSchema so both fetchers feed the same
 *  CdsFieldCatalogProvider without translation. */
export interface EdmxFieldSchema {
    name: string;
    type: string | null;
    length: string | null;
    isKey: boolean;
    association: string | null;
    description: string;
}
export interface EdmxEntityExtract {
    viewName: string;
    serviceName: string;
    serviceUrl: string;
    edmxUrl: string;
    fields: EdmxFieldSchema[];
    entityCount: number;
}
export interface SapApiHubEdmxFetcherOptions {
    live?: boolean;
    /** Base URL of the OData catalog. Defaults to the public one. */
    catalogBaseUrl?: string;
    /** Comma-separated service-name filter — only fetch EDMX for these services.
     *  Useful for incremental runs / debugging. When unset, fetches every
     *  service the catalog returns. */
    serviceFilter?: string[];
    /** Per-EDMX timeout in ms. Default 20s. */
    pageTimeoutMs?: number;
    /** Milliseconds between EDMX downloads to be polite to api.sap.com.
     *  Default 500ms. */
    rateLimitMs?: number;
    /** Maximum number of services to fetch in one run. 0 = unlimited.
     *  Useful for incremental ingests. Default 0. */
    maxServices?: number;
    /** Optional checkpoint file path. JSON-lines progress log so interrupted
     *  runs can resume by skipping services already in the file. */
    checkpointPath?: string;
    /** Override fixture path for tests / replay. */
    fixturePath?: string;
    verbose?: boolean;
}
export declare class SapApiHubEdmxFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: SapApiHubEdmxFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private listServices;
    private downloadEdmx;
    private snapshotEntryToDocument;
}
interface ParsedEntity {
    name: string;
    fields: EdmxFieldSchema[];
}
export declare function parseEdmx(xml: string): ParsedEntity[];
export {};
//# sourceMappingURL=SapApiHubEdmxFetcher.d.ts.map