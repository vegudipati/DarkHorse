/**
 * CdsFieldCatalogProvider — supplemental knowledge source for per-CDS-view
 * field metadata.
 *
 * Why this is a separate provider (not folded into CloudificationCatalogProvider):
 *   The SAP cloudification repository knows WHICH released CDS views exist,
 *   but NOT what fields each view exposes. Field-level metadata comes from a
 *   second source — help.sap.com via HelpPortalFetcher — and lives in its
 *   own fixture file. Keeping the providers separate means we can update
 *   either source independently and the chain composes cleanly.
 *
 * Why this is NOT a KnowledgeProvider implementation (the BadiRecord /
 * ExitRecord / CleanCoreLevelRecord interface):
 *   The three KnowledgeProvider methods return classification records, not
 *   field arrays. Adding a fourth method to KnowledgeProvider would couple
 *   every provider (Static, Cloudification, Azure, Terminal) to a concern
 *   only this one needs to satisfy. Instead, this is a STANDALONE provider
 *   the MCP server passes to the get_cds_view tool directly; the existing
 *   KnowledgeProvider chain handles existence + Clean Core level questions,
 *   and this catalog answers "what fields does this view have?"
 *
 * Storage:
 *   Reads from services/darkhorse-ingest/fixtures/help-portal-cds-seed.json
 *   (HelpPortalFetcher's output fixture). Loaded once on first lookup,
 *   indexed by uppercase view name for O(1) access.
 */
export interface CdsFieldSchema {
    name: string;
    type: string | null;
    length: string | null;
    isKey: boolean;
    association: string | null;
    description: string;
}
export interface CdsFieldCatalogEntry {
    viewName: string;
    pageTitle: string;
    pageUrl: string;
    fields: CdsFieldSchema[];
    fetchedAt: string;
}
export interface CdsFieldCatalogProviderOptions {
    /** Override the fixture file path. */
    fixturePath?: string;
    /** Print load stats to stderr at construction. */
    verbose?: boolean;
}
export declare class CdsFieldCatalogProvider {
    private readonly options;
    readonly id = "cds-field-catalog";
    readonly catalogVersion = "help-portal-cds-2026-05";
    private _byName;
    constructor(options?: CdsFieldCatalogProviderOptions);
    /** Return the field array for the given view, or null when the catalog has
     *  no entry. The lookup is case-insensitive on the view name. */
    getFields(viewName: string): CdsFieldSchema[] | null;
    /** Return the full catalog entry — handy for the tool layer when it wants
     *  to include the help-portal URL or fetchedAt timestamp in its response. */
    getEntry(viewName: string): CdsFieldCatalogEntry | null;
    /** Number of views with fields[] populated. Used by /health output. */
    size(): number;
    private ensureLoaded;
}
//# sourceMappingURL=CdsFieldCatalogProvider.d.ts.map