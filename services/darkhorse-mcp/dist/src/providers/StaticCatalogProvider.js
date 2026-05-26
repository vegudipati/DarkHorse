/**
 * StaticCatalogProvider — KnowledgeProvider backed by the Sprint 1 JSON
 * catalogs under services/darkhorse-mcp/catalog/.
 *
 * Preserves Sprint 1 behavior exactly: same hallucination guards, same
 * heuristic fallbacks for unknown objects. The only behavioral change is
 * that lookups are async (the interface is Promise-returning so a
 * composite can mix this provider with the Azure-backed one).
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticCatalogProvider = void 0;
const fs = require("fs");
const path = require("path");
// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------
class StaticCatalogProvider {
    catalogDir;
    id = 'static-catalog';
    _badiCatalog = null;
    _exitCatalog = null;
    _ccCatalog = null;
    _badiByName = null;
    _exitByName = null;
    _ccByKey = null;
    constructor(catalogDir = defaultCatalogDir()) {
        this.catalogDir = catalogDir;
    }
    /** Public accessor for catalog write tools that need to know where the
     *  seed JSON lives. */
    getCatalogDir() {
        return this.catalogDir;
    }
    /** Invalidate all in-memory caches. Call after writing to a catalog JSON
     *  file so the next lookup re-reads it. */
    reload() {
        this._badiCatalog = null;
        this._badiByName = null;
        this._exitCatalog = null;
        this._exitByName = null;
        this._ccCatalog = null;
        this._ccByKey = null;
    }
    // -------------------------------------------------------------------
    // verifyBadi
    // -------------------------------------------------------------------
    async verifyBadi(name, _program, _module) {
        if (!name?.trim())
            return null;
        const { catalog, index } = this.getBadiIndex();
        const entry = index.get(name.trim().toUpperCase());
        // Provider semantics: null means "no opinion here, let the next provider
        // try". A downstream provider (Cloudification, then TerminalStub) supplies
        // a defensible fallback record. Static is intentionally narrow — only
        // returns positive matches from its curated catalog.
        if (!entry)
            return null;
        const exists = entry.exists !== false && entry.level !== 'D';
        return {
            exists,
            name: entry.name,
            level: entry.level,
            module: entry.module,
            enhancementSpot: entry.enhancementSpot ?? null,
            interfaceName: entry.interface ?? null,
            description: entry.description,
            alternative: entry.alternative ?? null,
            providerId: this.id,
            catalogVersion: catalog._metadata.schemaVersion
        };
    }
    // -------------------------------------------------------------------
    // verifyExit
    // -------------------------------------------------------------------
    async verifyExit(name, programName, _exitType) {
        if (!name?.trim())
            return null;
        const { catalog, index } = this.getExitIndex();
        const matches = index.get(name.trim().toUpperCase());
        // Null on miss — TerminalStub at the end of the chain produces the
        // hallucination-guard message.
        if (!matches || matches.length === 0)
            return null;
        let entry = matches[0];
        if (matches.length > 1 && programName) {
            const wanted = programName.trim().toUpperCase();
            const byProgram = matches.find(e => e.program && e.program.toUpperCase() === wanted);
            if (byProgram)
                entry = byProgram;
        }
        const exists = entry.exists !== false && entry.level !== 'D';
        return {
            exists,
            name: entry.name,
            type: entry.type,
            level: entry.level,
            module: entry.module,
            program: entry.program ?? null,
            include: entry.include ?? null,
            enhancement: entry.enhancement ?? null,
            functionModule: entry.function_module ?? null,
            description: entry.description,
            alternative: entry.alternative ?? null,
            providerId: this.id,
            catalogVersion: catalog._metadata.schemaVersion
        };
    }
    // -------------------------------------------------------------------
    // checkCleanCoreLevel — exact match + heuristic fallback (Sprint-1 logic)
    // -------------------------------------------------------------------
    async checkCleanCoreLevel(name, type) {
        if (!name?.trim() || !type?.trim())
            return null;
        const { catalog, index } = this.getCcIndex();
        const key = ccKey(type, name);
        const entry = index.get(key);
        if (entry) {
            return {
                level: entry.level,
                name: entry.name,
                type: entry.type,
                module: entry.module,
                reasoning: entry.reasoning ?? entry.description,
                alternatives: entry.alternatives ?? [],
                confidence: 'high',
                providerId: this.id,
                catalogVersion: catalog._metadata.schemaVersion
            };
        }
        // No curated entry — fall through. The heuristic verdicts moved to
        // TerminalStubProvider (the last provider in the composite chain) so that
        // Cloudification gets a shot at returning the SAP-published level before
        // we resort to name-pattern guesses.
        return null;
    }
    // -------------------------------------------------------------------
    // Catalog loaders (cached after first call)
    // -------------------------------------------------------------------
    getBadiIndex() {
        if (this._badiCatalog && this._badiByName) {
            return { catalog: this._badiCatalog, index: this._badiByName };
        }
        const raw = fs.readFileSync(path.join(this.catalogDir, 'badi-catalog.json'), 'utf-8');
        this._badiCatalog = JSON.parse(raw);
        this._badiByName = new Map();
        for (const e of this._badiCatalog.badis) {
            this._badiByName.set(e.name.trim().toUpperCase(), e);
        }
        return { catalog: this._badiCatalog, index: this._badiByName };
    }
    getExitIndex() {
        if (this._exitCatalog && this._exitByName) {
            return { catalog: this._exitCatalog, index: this._exitByName };
        }
        const raw = fs.readFileSync(path.join(this.catalogDir, 'exit-catalog.json'), 'utf-8');
        this._exitCatalog = JSON.parse(raw);
        this._exitByName = new Map();
        for (const e of this._exitCatalog.exits) {
            const key = e.name.trim().toUpperCase();
            let bucket = this._exitByName.get(key);
            if (!bucket) {
                bucket = [];
                this._exitByName.set(key, bucket);
            }
            bucket.push(e);
        }
        return { catalog: this._exitCatalog, index: this._exitByName };
    }
    getCcIndex() {
        if (this._ccCatalog && this._ccByKey) {
            return { catalog: this._ccCatalog, index: this._ccByKey };
        }
        const raw = fs.readFileSync(path.join(this.catalogDir, 'clean-core-objects.json'), 'utf-8');
        this._ccCatalog = JSON.parse(raw);
        this._ccByKey = new Map();
        for (const e of this._ccCatalog.objects) {
            this._ccByKey.set(ccKey(e.type, e.name), e);
        }
        return { catalog: this._ccCatalog, index: this._ccByKey };
    }
}
exports.StaticCatalogProvider = StaticCatalogProvider;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultCatalogDir() {
    // __dirname at runtime is dist/src/providers/, walk up three to the package
    // root (out of providers/, src/, dist/), then into catalog/.
    return path.resolve(__dirname, '..', '..', '..', 'catalog');
}
function ccKey(type, name) {
    return `${type.trim().toUpperCase()}::${name.trim().toUpperCase()}`;
}
//# sourceMappingURL=StaticCatalogProvider.js.map