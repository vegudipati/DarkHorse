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
        if (!entry) {
            // Preserve Sprint 1 behavior — return a "not found" record (still useful
            // for the agent) instead of null. Null is reserved for "provider has
            // no opinion, try the next one".
            return {
                exists: false,
                name,
                level: null,
                module: null,
                enhancementSpot: null,
                interfaceName: null,
                description: 'BAdI not found in the DarkHorse seed catalog. This may mean the BAdI does not exist, ' +
                    'or that the catalog has not yet been extended to cover this module. ' +
                    'Do NOT reference this BAdI in generated code without manual verification in SE18/SE19.',
                alternative: null,
                providerId: this.id,
                catalogVersion: catalog._metadata.schemaVersion
            };
        }
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
        if (!matches || matches.length === 0) {
            return {
                exists: false,
                name,
                type: null,
                level: null,
                module: null,
                program: null,
                include: null,
                enhancement: null,
                functionModule: null,
                description: 'Exit not found in the DarkHorse seed catalog. This is a STRONG signal that the exit ' +
                    'does not exist — LLM-hallucinated exit names are a known failure mode. ' +
                    'Do NOT reference this exit in generated code without manual verification (SMOD/SE38).',
                alternative: null,
                providerId: this.id,
                catalogVersion: catalog._metadata.schemaVersion
            };
        }
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
        return applyHeuristic(name, type, catalog._metadata.schemaVersion, this.id);
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
function applyHeuristic(name, type, catalogVersion, providerId) {
    const upperName = name.trim().toUpperCase();
    const upperType = type.trim().toUpperCase();
    const base = { name, type: upperType, module: null, alternatives: [], providerId, catalogVersion };
    // Default principle: SAP standard objects (anything NOT in the customer Z/Y
    // namespace) are Clean Core. The only question is which level — Level A for
    // modern released APIs (CDS interface views, RAP BDEFs) and Level B for
    // classic-but-released SAP objects (BAPIs, RFC FMs, standard transactions,
    // IDocs). Calling a Level B object does NOT violate Clean Core — it is
    // upgrade-stable and supported. Modernization to Level A is best practice
    // when a released RAP / CDS equivalent exists, but not required for
    // compliance.
    // Level A — modern released APIs
    if (upperType === 'CDS' && /^I_[A-Z]/.test(upperName)) {
        return { ...base, level: 'A',
            reasoning: 'CDS interface view (I_*) — released interface views follow SAP\'s Clean Core API contract and are Level A by convention.',
            confidence: 'medium' };
    }
    if (upperType === 'BDEF' || upperType === 'DDLS' && /^I_[A-Z]/.test(upperName) || /TP$/.test(upperName)) {
        return { ...base, level: 'A',
            reasoning: 'RAP Behavior Definition / projection — RAP is the Level A target for transactional operations; EML against this BDEF is the cloud-ready write path.',
            confidence: 'medium' };
    }
    // Customer namespace — depends entirely on what it does; default to C
    if (/^[ZY]/.test(upperName)) {
        return { ...base, level: 'C',
            reasoning: 'Customer namespace (Z*/Y*) object. Custom objects are acceptable only when implemented as released-API consumers (Level A) or RAP-managed CBO (Level A). Direct custom-table reads/writes are Level C — refactor to a CBO with CDS + RAP behavior.',
            confidence: 'low' };
    }
    // Direct table access — the act of SELECT-ing a SAP standard table bypasses
    // the released-API contract. The table object itself is standard SAP, but
    // the action of direct access drops to Level C. (When generated code needs
    // to read the table, the agent should use the released CDS view instead.)
    if (upperType === 'TABL') {
        return { ...base, level: 'C',
            reasoning: 'SAP standard database table. The table itself is part of standard SAP, but direct SELECT bypasses the released-API contract — that act is Level C. Replace with the released CDS interface view (I_*) when one exists. Look it up in the SAP Business Accelerator Hub.',
            confidence: 'medium' };
    }
    // BAPIs and RFC-enabled / released function modules — Level B by default.
    // BAPIs are classic SAP-released APIs: upgrade-stable, supported, do NOT
    // violate Clean Core. The Level A target (RAP EML on a released BDEF) is
    // best practice when one exists, but the BAPI itself is fully compliant.
    if (upperType === 'BAPI' || /^BAPI_/.test(upperName)) {
        return { ...base, level: 'B',
            reasoning: 'Classic SAP-released BAPI — Level B. BAPIs are upgrade-stable, supported, and treated as released APIs by SAP. Calling a BAPI does NOT violate Clean Core. ' +
                'When a released RAP Behavior Definition (BDEF) exists for the same operation, EML against the BDEF is the Level A modernization target — check the SAP Business Accelerator Hub. ' +
                'For new development, prefer Level A; for existing BAPI integrations, no refactor is required for compliance.',
            confidence: 'medium' };
    }
    if (upperType === 'FUNC' || upperType === 'RFM') {
        return { ...base, level: 'B',
            reasoning: 'Standard SAP function module — Level B by default. Released, upgrade-stable, supported. Does not violate Clean Core. ' +
                'If a released RAP/CDS/OData equivalent exists in the SAP Business Accelerator Hub, use it for new code (Level A). ' +
                'Customer-namespace (Z*/Y*) FMs are handled separately and may fall to Level C.',
            confidence: 'medium' };
    }
    // IDocs — standard SAP-released integration messages, Level B.
    if (upperType === 'IDOC' || upperType === 'IDOC_BAS' || /^IDOC_/.test(upperName) || /^E1_/.test(upperName)) {
        return { ...base, level: 'B',
            reasoning: 'Standard SAP IDoc / IDoc segment — Level B. Released, upgrade-stable, supported integration interface. ' +
                'Modernization path: prefer SAP Event Mesh + business events (Level A) for new asynchronous integrations, but existing IDoc flows are fully Clean Core compliant.',
            confidence: 'medium' };
    }
    // Standard transactions — Level B (calling them via SUBMIT / CALL TRANSACTION
    // is the released path).
    if (upperType === 'TRAN') {
        return { ...base, level: 'B',
            reasoning: 'Standard SAP transaction code — Level B. Released and supported. Calling via CALL TRANSACTION / SUBMIT is upgrade-stable. ' +
                'For new development, prefer the released RAP/OData service exposing the same business object (Level A) when available.',
            confidence: 'medium' };
    }
    // Standard classes (CL_*, CX_*) — Level B for released framework classes.
    if (upperType === 'CLAS' && /^(CL_|CX_)/.test(upperName)) {
        return { ...base, level: 'B',
            reasoning: 'Standard SAP class — Level B. Released framework classes (CL_BAL_*, CL_SALV_*, CL_GUI_*, etc.) are supported and upgrade-stable. ' +
                'Calling their public methods is fully Clean Core compliant.',
            confidence: 'medium' };
    }
    // Standard programs / includes — Level B (just referencing them, e.g. SUBMIT).
    if (upperType === 'PROG') {
        return { ...base, level: 'B',
            reasoning: 'Standard SAP program — Level B. SUBMIT-ing a released report is upgrade-stable and supported.',
            confidence: 'low' };
    }
    // Anything else in the standard SAP namespace — default to Level B with low
    // confidence. The user can override via the catalog when they have more
    // information. Previously this branch returned Level D, which incorrectly
    // flagged released SAP objects as prohibited.
    return { ...base, level: 'B',
        reasoning: 'Object appears to be in the standard SAP namespace and not in the DarkHorse seed catalog. Defaulting to Level B (released, upgrade-stable) — standard SAP objects are Clean Core unless they involve direct table access (Level C) or implicit enhancements (Level D). ' +
            'Verify against the SAP Business Accelerator Hub for the canonical level and any Level A modernization alternatives.',
        confidence: 'low' };
}
//# sourceMappingURL=StaticCatalogProvider.js.map