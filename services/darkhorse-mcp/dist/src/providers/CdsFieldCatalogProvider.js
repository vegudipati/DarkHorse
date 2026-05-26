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
        const fixturePath = this.options.fixturePath ?? defaultFixturePath();
        const map = new Map();
        if (!fs.existsSync(fixturePath)) {
            if (this.options.verbose) {
                process.stderr.write(`[CdsFieldCatalogProvider] No fixture at ${fixturePath} — operating empty.\n`);
            }
            this._byName = map;
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
        }
        catch (err) {
            process.stderr.write(`[CdsFieldCatalogProvider] Failed to parse ${fixturePath}: ${err?.message ?? err}. Operating empty.\n`);
            this._byName = map;
            return;
        }
        const entries = parsed.entries ?? [];
        for (const e of entries) {
            // Skip entries with no actual fields — those add no value to the
            // grounder. The HelpPortalFetcher leaves stub entries when scraping
            // fails; we still index them so /health reports them, but only if
            // fields[] is non-empty do they answer getFields() positively.
            if (!e.viewName)
                continue;
            map.set(e.viewName.trim().toUpperCase(), {
                viewName: e.viewName,
                pageTitle: e.title,
                pageUrl: e.url ?? '',
                fields: Array.isArray(e.fields) ? e.fields : [],
                fetchedAt: parsed._metadata?.fetchedAt ?? ''
            });
        }
        this._byName = map;
        if (this.options.verbose) {
            const withFields = Array.from(map.values()).filter(e => e.fields.length > 0).length;
            process.stderr.write(`[CdsFieldCatalogProvider] Loaded ${map.size} CDS views ` +
                `(${withFields} with non-empty field lists) from ${fixturePath}\n`);
        }
    }
}
exports.CdsFieldCatalogProvider = CdsFieldCatalogProvider;
// ---------------------------------------------------------------------------
// Default fixture path resolution — same robustness pattern as
// CloudificationCatalogProvider: prefer an MCP-local copy if one exists,
// fall back to the canonical ingest fixture location.
// ---------------------------------------------------------------------------
function defaultFixturePath() {
    // __dirname at runtime is dist/src/providers/.
    const mcpLocal = path.resolve(__dirname, '..', '..', '..', 'data', 'help-portal-cds-seed.json');
    if (fs.existsSync(mcpLocal))
        return mcpLocal;
    return path.resolve(__dirname, '..', '..', '..', '..', 'darkhorse-ingest', 'fixtures', 'help-portal-cds-seed.json');
}
//# sourceMappingURL=CdsFieldCatalogProvider.js.map