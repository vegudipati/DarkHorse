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
 *   Reads from TWO fixture files in priority order:
 *     1. fixtures/help-portal-cds-seed.json        (HelpPortalFetcher output)
 *     2. fixtures/api-sap-hub-edmx.snapshot.json   (SapApiHubEdmxFetcher output)
 *   Both files share the same entry shape. The help-portal source wins on
 *   conflict because its descriptions are typically richer than EDMX
 *   attribute-derived ones. EDMX coverage is broader (thousands of views
 *   from one bulk download) but its `description` field carries only
 *   sap:label / sap:quickinfo annotations from the EDMX, not free text.
 *
 *   Loaded once on first lookup, indexed by uppercase view name for O(1)
 *   access.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdsFieldCatalogProvider = void 0;
const fs = require("fs");
const path = require("path");
class CdsFieldCatalogProvider {
    options;
    id = 'cds-field-catalog';
    catalogVersion = 'help-portal-cds-2026-05';
    _byName = null;
    constructor(options = {}) {
        this.options = options;
    }
    /** Return the field array for the given view, or null when the catalog has
     *  no entry. The lookup is case-insensitive on the view name. */
    getFields(viewName) {
        if (!viewName?.trim())
            return null;
        const entry = this.getEntry(viewName);
        return entry ? entry.fields : null;
    }
    /** Return the full catalog entry — handy for the tool layer when it wants
     *  to include the help-portal URL or fetchedAt timestamp in its response. */
    getEntry(viewName) {
        this.ensureLoaded();
        const e = this._byName.get(viewName.trim().toUpperCase());
        return e ?? null;
    }
    /** Number of views with fields[] populated. Used by /health output. */
    size() {
        this.ensureLoaded();
        return this._byName.size;
    }
    // -------------------------------------------------------------------
    // Loader
    // -------------------------------------------------------------------
    ensureLoaded() {
        if (this._byName)
            return;
        const map = new Map();
        const paths = this.options.fixturePath
            ? [this.options.fixturePath]
            : defaultFixturePaths();
        // Load EDMX FIRST so the help-portal entries overwrite on conflict — help
        // descriptions tend to be richer free-text vs EDMX sap:label snippets.
        const edmxPath = paths.find(p => p.endsWith('api-sap-hub-edmx.snapshot.json'));
        const helpPath = paths.find(p => p.endsWith('help-portal-cds-seed.json')) ?? paths[0];
        if (edmxPath)
            this.loadEdmxSnapshot(edmxPath, map);
        if (helpPath)
            this.loadHelpPortalSeed(helpPath, map);
        this._byName = map;
        if (this.options.verbose) {
            const withFields = Array.from(map.values()).filter(e => e.fields.length > 0).length;
            process.stderr.write(`[CdsFieldCatalogProvider] Loaded ${map.size} CDS views ` +
                `(${withFields} with non-empty field lists) from ${paths.filter(Boolean).join(' + ')}\n`);
        }
    }
    loadHelpPortalSeed(filePath, map) {
        if (!fs.existsSync(filePath))
            return;
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch (err) {
            process.stderr.write(`[CdsFieldCatalogProvider] Failed to parse ${filePath}: ${err?.message ?? err}. Skipping.\n`);
            return;
        }
        for (const e of parsed.entries ?? []) {
            if (!e.viewName)
                continue;
            map.set(e.viewName.trim().toUpperCase(), {
                viewName: e.viewName,
                pageTitle: e.title ?? e.viewName,
                pageUrl: e.url ?? '',
                fields: Array.isArray(e.fields) ? e.fields : [],
                fetchedAt: parsed._metadata?.fetchedAt ?? ''
            });
        }
    }
    loadEdmxSnapshot(filePath, map) {
        if (!fs.existsSync(filePath))
            return;
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        catch (err) {
            process.stderr.write(`[CdsFieldCatalogProvider] Failed to parse ${filePath}: ${err?.message ?? err}. Skipping.\n`);
            return;
        }
        for (const e of parsed.entries ?? []) {
            if (!e.viewName)
                continue;
            // Don't overwrite an existing help-portal entry — help-portal is loaded
            // AFTER edmx (see ensureLoaded ordering), so a later help-portal entry
            // takes precedence by virtue of the simple set order. This branch only
            // fires when help has no entry for this view.
            map.set(e.viewName.trim().toUpperCase(), {
                viewName: e.viewName,
                pageTitle: `${e.viewName} (${e.serviceName})`,
                pageUrl: e.edmxUrl ?? '',
                fields: Array.isArray(e.fields) ? e.fields : [],
                fetchedAt: e.fetchedAt ?? parsed._metadata?.fetchedAt ?? ''
            });
        }
    }
}
exports.CdsFieldCatalogProvider = CdsFieldCatalogProvider;
// ---------------------------------------------------------------------------
// Default fixture path resolution — same robustness pattern as
// CloudificationCatalogProvider: prefer an MCP-local copy if one exists,
// fall back to the canonical ingest fixture location.
// ---------------------------------------------------------------------------
function defaultFixturePaths() {
    // Return both fixture file paths. Caller filters by existence. __dirname at
    // runtime is dist/src/providers/, so the ingest fixtures are five levels up.
    const ingestFixtures = path.resolve(__dirname, '..', '..', '..', '..', 'darkhorse-ingest', 'fixtures');
    return [
        path.join(ingestFixtures, 'help-portal-cds-seed.json'),
        path.join(ingestFixtures, 'api-sap-hub-edmx.snapshot.json')
    ];
}
//# sourceMappingURL=CdsFieldCatalogProvider.js.map