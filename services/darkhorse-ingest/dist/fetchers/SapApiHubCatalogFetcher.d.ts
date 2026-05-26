import { IFetcher, IngestDocument, SourceId } from '../types';
export interface SapApiHubCatalogFetcherOptions {
    apiKey: string;
    live?: boolean;
    /** Which entity sets to page. Default: ['APIs', 'ContentPackages'] */
    entitySets?: Array<'APIs' | 'ContentPackages'>;
    /** Records per OData page. Default 100. */
    pageSize?: number;
    /** Ms between page requests (rate-limit courtesy). Default 150. */
    delayMs?: number;
    /** Max records per entity set (0 = all). Default 0. */
    maxRecords?: number;
    /** Override output fixture path. */
    fixturePath?: string;
    verbose?: boolean;
}
export declare class SapApiHubCatalogFetcher implements IFetcher {
    private readonly opts;
    readonly id: SourceId;
    readonly label: string;
    private readonly BASE;
    constructor(opts: SapApiHubCatalogFetcherOptions);
    fetch(): Promise<IngestDocument[]>;
    private fetchFromFixture;
    private fetchLive;
    private pageAll;
    private apiToDocument;
    private packageToDocument;
}
//# sourceMappingURL=SapApiHubCatalogFetcher.d.ts.map