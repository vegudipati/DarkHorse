/**
 * SapApiHubFetcher — Sprint 2 session 1 fetcher for SAP Business Accelerator Hub.
 *
 * The SAP API Hub (api.sap.com) is a structured catalog of released SAP APIs:
 * CDS views, BAPIs, OData services, RAP services, etc. It is the canonical
 * answer to "does this CDS view exist?" and "is this BAPI released?".
 *
 * Sprint 2 strategy:
 *   - This fetcher is the FIRST real fetcher and intentionally ships with a
 *     local seed fixture (fixtures/sap-api-hub-seed.json) so the full ingest
 *     pipeline runs end-to-end with zero network dependency in code-first
 *     mode.
 *   - The live HTTP path is implemented but disabled unless the caller passes
 *     `{ live: true, baseUrl }`. The real endpoint shape on api.sap.com is
 *     documented as TODO since SAP rotates the catalog API URL; a future
 *     session will pin the production endpoint after Deloitte confirms.
 */
import { IFetcher, IngestDocument, SourceId } from '../types';
export interface SapApiHubFetcherOptions {
    /** When true, the fetcher hits the live SAP API Hub catalog endpoint.
     *  When false (default for Sprint 2), it loads from the local seed fixture. */
    live?: boolean;
    /** Base URL for the SAP API Hub catalog. Required when live=true.
     *  TODO: pin this in a later session once Deloitte confirms the exact
     *        public endpoint. */
    baseUrl?: string;
    /** Override fixture path for tests. */
    fixturePath?: string;
}
export declare class SapApiHubFetcher implements IFetcher {
    private readonly options;
    readonly id: SourceId;
    readonly label: string;
    constructor(options?: SapApiHubFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private toDocument;
}
//# sourceMappingURL=SapApiHubFetcher.d.ts.map