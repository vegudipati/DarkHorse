/**
 * CloudificationCatalogProvider — KnowledgeProvider backed by SAP's official
 * cloudification repository (github.com/SAP/abap-atc-cr-cv-s4hc).
 *
 * This is the same data the ABAP Test Cockpit (ATC) "Usage of Released APIs"
 * check consumes. Three JSON files, ~80K entries total:
 *
 *   objectReleaseInfoLatest.json     — SAP Cloud ERP (Public Edition) APIs
 *   objectReleaseInfo_PCELatest.json — SAP Cloud ERP Private Edition APIs
 *   objectClassifications_SAP.json   — Classic / non-released objects + successors
 *
 * Mapping rules (SAP-native → DarkHorse KnowledgeProvider):
 *
 *   state                       → CleanCoreLevel
 *   ---------------------------------------------------
 *   released                    → A
 *   classicAPI                  → B
 *   deprecated                  → C   (with successor[] → alternatives[])
 *   notToBeReleased             → C
 *   notToBeReleasedStable       → C
 *   noAPI                       → D
 *
 *   applicationComponent like "MM-PUR-SRC-SL" → first segment → module ("MM").
 *
 *   objectType filtering per tool:
 *     verifyBadi              → BADI_DEF entries (tadirObject=ENHS)
 *     checkCleanCoreLevel     → all objectTypes
 *     verifyExit              → NOT covered (exits are not in this repo;
 *                               return null so static catalog handles them)
 *
 * This provider returns null on miss so a composite can fall through to a
 * curated static catalog (preferred for richness) or a terminal stub
 * provider.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudificationCatalogProvider = void 0;
const fs = require("fs");
const path = require("path");
class CloudificationCatalogProvider {
    options;
    id = 'sap-cloudification';
    /** Schema version of the underlying upstream data — bumped when the SAP
     *  format changes. We expose this so MCP tool responses can carry it. */
    catalogVersion = 'sap-cloudification-2026-05';
    // Indexes built lazily on first use, keyed by uppercase objectKey.
    // - byName               — primary lookup for checkCleanCoreLevel
    // - byTypeAndName        — for type-disambiguating lookups (BAPI vs FUNC etc.)
    // - badiByName           — only BADI_DEF entries, indexed for verify_badi
    // - badiByEnhancementSpot — for spot-based queries
    _byName = null;
    _byTypeAndName = null;
    _badiByName = null;
    _badiByEnhancementSpot = null;
    constructor(options = {}) {
        this.options = options;
    }
    // -------------------------------------------------------------------
    // verifyBadi
    // -------------------------------------------------------------------
    async verifyBadi(name, _program, _module) {
        if (!name?.trim())
            return null;
        const key = name.trim().toUpperCase();
        const { byName, byEnhancementSpot } = this.getBadiIndexes();
        // Try direct match first (the BAdI name itself), then fall back to a spot
        // match (callers sometimes pass the enhancement spot ENHS).
        let entry = byName.get(key);
        if (!entry) {
            const spotMatches = byEnhancementSpot.get(key);
            if (spotMatches && spotMatches.length > 0) {
                // Prefer a non-deprecated entry when the spot has multiple BAdIs.
                entry = spotMatches.find(e => e.state === 'released') ?? spotMatches[0];
            }
        }
        if (!entry)
            return null;
        const successor = entry.successors[0]; // BADI_DEF successors are exact BAdI replacements
        return {
            exists: entry.state !== 'noAPI' && entry.level !== 'D',
            name: entry.name,
            level: entry.level,
            module: entry.module,
            enhancementSpot: entry.enhancementSpot,
            interfaceName: null, // cloudification data does not carry the IF_EX_* interface name
            description: this.renderBadiDescription(entry, successor),
            alternative: successor ? successor.objectKey : null,
            providerId: this.id,
            catalogVersion: this.catalogVersion
        };
    }
    // -------------------------------------------------------------------
    // verifyExit — exits are not in the cloudification repo. Always null;
    // composite falls through to the static catalog.
    // -------------------------------------------------------------------
    async verifyExit(_name, _programName, _exitType) {
        return null;
    }
    // -------------------------------------------------------------------
    // checkCleanCoreLevel
    // -------------------------------------------------------------------
    async checkCleanCoreLevel(name, type) {
        if (!name?.trim() || !type?.trim())
            return null;
        const upperName = name.trim().toUpperCase();
        const upperType = type.trim().toUpperCase();
        const { byTypeAndName, byName } = this.getCleanCoreIndexes();
        // Try (type, name) match first — disambiguates same-name CLAS vs INTF etc.
        let entry = byTypeAndName.get(`${upperType}::${upperName}`);
        if (!entry) {
            // Fall back to name-only (caller's type may be slightly different —
            // e.g. they passed "CDS" but the repo has "CDS_STOB").
            entry = byName.get(upperName);
        }
        if (!entry)
            return null;
        const alternatives = entry.successors.map(s => ({
            name: s.objectKey,
            type: mapTadirToShortType(s.tadirObject, s.objectType),
            level: 'A',
            notes: 'Successor from SAP Cloudification Repository — replacement recommendation.'
        }));
        return {
            level: entry.level,
            name: entry.name,
            type: mapTadirToShortType(entry.tadirObject, entry.objectType),
            module: entry.module,
            reasoning: this.renderLevelReasoning(entry),
            alternatives,
            confidence: 'high',
            providerId: this.id,
            catalogVersion: this.catalogVersion
        };
    }
    // -------------------------------------------------------------------
    // Index loaders (cached after first call)
    // -------------------------------------------------------------------
    getCleanCoreIndexes() {
        this.ensureLoaded();
        return { byName: this._byName, byTypeAndName: this._byTypeAndName };
    }
    getBadiIndexes() {
        this.ensureLoaded();
        return { byName: this._badiByName, byEnhancementSpot: this._badiByEnhancementSpot };
    }
    ensureLoaded() {
        if (this._byName)
            return;
        const dataDir = this.options.dataDir ?? defaultDataDir();
        const start = Date.now();
        // The PCE (Private Edition) file is the larger, more inclusive of the two
        // release files — it carries every Cloud-released object PLUS additional
        // on-premise-compatible ones. We load it first so its entries are the
        // baseline, then layer the Cloud-only release file on top, then the
        // classifications file (which carries classicAPI/noAPI states not present
        // in the release files).
        const pce = loadJsonIfExists(path.join(dataDir, 'objectReleaseInfo_PCELatest.json'));
        const cloud = loadJsonIfExists(path.join(dataDir, 'objectReleaseInfoLatest.json'));
        const classics = loadJsonIfExists(path.join(dataDir, 'objectClassifications_SAP.json'));
        const merged = new Map();
        if (pce) {
            for (const e of pce.objectReleaseInfo) {
                const m = sapToMerged(e, 'pce');
                merged.set(mergedKey(m), m);
            }
        }
        if (cloud) {
            for (const e of cloud.objectReleaseInfo) {
                const m = sapToMerged(e, 'cloud');
                // Cloud release wins over PCE for state/level (Level A definition is cloud).
                merged.set(mergedKey(m), m);
            }
        }
        if (classics) {
            for (const e of classics.objectClassifications) {
                const m = sapToMerged(e, 'classic');
                // Classification file only wins where the release files don't have an
                // entry (the release files always have richer state info).
                const k = mergedKey(m);
                if (!merged.has(k))
                    merged.set(k, m);
            }
        }
        // Build secondary indexes.
        const byName = new Map();
        const byTypeAndName = new Map();
        const badiByName = new Map();
        const badiByEnhancementSpot = new Map();
        for (const m of merged.values()) {
            byName.set(m.name, m);
            byTypeAndName.set(`${mapTadirToShortType(m.tadirObject, m.objectType)}::${m.name}`, m);
            if (m.objectType === 'BADI_DEF') {
                badiByName.set(m.name, m);
                if (m.enhancementSpot) {
                    let bucket = badiByEnhancementSpot.get(m.enhancementSpot);
                    if (!bucket) {
                        bucket = [];
                        badiByEnhancementSpot.set(m.enhancementSpot, bucket);
                    }
                    bucket.push(m);
                }
            }
        }
        this._byName = byName;
        this._byTypeAndName = byTypeAndName;
        this._badiByName = badiByName;
        this._badiByEnhancementSpot = badiByEnhancementSpot;
        if (this.options.verbose) {
            const ms = Date.now() - start;
            process.stderr.write(`[CloudificationCatalogProvider] Loaded ${merged.size} entries ` +
                `(${badiByName.size} BAdIs) in ${ms}ms from ${dataDir}\n`);
        }
    }
    // -------------------------------------------------------------------
    // Description rendering — keeps the agent-facing text consistent with the
    // Sprint-1 static catalog descriptions so prompts don't need conditionals.
    // -------------------------------------------------------------------
    renderBadiDescription(entry, successor) {
        const parts = [];
        parts.push(`BAdI ${entry.name} (enhancement spot ${entry.enhancementSpot ?? 'n/a'}) ` +
            `is classified by the SAP Cloudification Repository as state="${entry.state}" ` +
            `(Level ${entry.level}).`);
        if (entry.module) {
            parts.push(`Application component: ${entry.applicationComponent} (module ${entry.module}).`);
        }
        if (entry.state === 'released') {
            parts.push('This BAdI is RELEASED for SAP Cloud ERP. Safe to use in Clean Core developments.');
        }
        else if (entry.state === 'deprecated' && successor) {
            parts.push(`DEPRECATED — SAP recommends using ${successor.objectKey} instead. ` +
                `Generated code should reference the successor, not this BAdI.`);
        }
        else if (entry.state === 'deprecated') {
            parts.push('DEPRECATED — SAP no longer recommends this BAdI but has not published a 1:1 successor. ' +
                'Check the SAP Business Accelerator Hub for the Level A replacement (typically a RAP BDEF or released API).');
        }
        else if (entry.state === 'classicAPI') {
            parts.push('CLASSIC BAdI — released for on-premise S/4HANA only. Acceptable for Private Cloud / on-prem ' +
                'developments; for S/4HANA Cloud Public Edition prefer the released RAP behavior.');
        }
        else if (entry.state === 'noAPI') {
            parts.push('NOT RELEASED — this BAdI is not part of the released API surface. Do not reference in generated code.');
        }
        return parts.join(' ');
    }
    renderLevelReasoning(entry) {
        const base = `${entry.name} (${entry.tadirObject}/${entry.objectType}) is classified by the SAP Cloudification ` +
            `Repository as state="${entry.state}" → Clean Core Level ${entry.level}. ` +
            `Application component: ${entry.applicationComponent} (module ${entry.module}).`;
        const tail = entry.successors.length > 0
            ? ` SAP-recommended successor${entry.successors.length > 1 ? 's' : ''}: ` +
                entry.successors.map(s => s.objectKey).join(', ') + '.'
            : '';
        return base + tail;
    }
}
exports.CloudificationCatalogProvider = CloudificationCatalogProvider;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultDataDir() {
    // __dirname at runtime is dist/src/providers/. Walk up three levels to
    // services/darkhorse-mcp/, then look for the data folder.
    //
    // We accept either of two layouts:
    //   1. services/darkhorse-mcp/data/cloudification/*.json  (preferred — local
    //      to the MCP package so it ships with the server)
    //   2. services/darkhorse-ingest/fixtures/cloudification/*.json  (the
    //      development location where the ingest CLI writes downloads)
    const mcpLocal = path.resolve(__dirname, '..', '..', '..', 'data', 'cloudification');
    if (fs.existsSync(mcpLocal))
        return mcpLocal;
    const ingestLocal = path.resolve(__dirname, '..', '..', '..', '..', 'darkhorse-ingest', 'fixtures', 'cloudification');
    return ingestLocal;
}
function loadJsonIfExists(filePath) {
    if (!fs.existsSync(filePath))
        return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
}
function sapToMerged(e, source) {
    const name = e.objectKey.toUpperCase();
    const state = (e.state ?? '').trim();
    const level = mapStateToLevel(state, source);
    const enhancementSpot = e.objectType === 'BADI_DEF' ? e.tadirObjName.toUpperCase() : null;
    const appComp = e.applicationComponent ?? '';
    const module = appComp.split('-')[0] ?? '';
    return {
        name,
        tadirObject: e.tadirObject,
        objectType: e.objectType,
        enhancementSpot,
        applicationComponent: appComp,
        module,
        state,
        level,
        source,
        successors: e.successors ?? []
    };
}
function mergedKey(m) {
    // We key by (objectType, name) so a CLAS and an INTF of the same name don't
    // collide, but the most common lookup path still hits a single bucket.
    return `${m.objectType}::${m.name}`;
}
function mapStateToLevel(state, source) {
    switch (state) {
        case 'released':
            // Released in the Cloud file → cloud-ready → Level A.
            // Released in PCE-only → on-prem stable but not cloud-ready → Level B.
            return source === 'cloud' ? 'A' : (source === 'pce' ? 'B' : 'B');
        case 'classicAPI':
            return 'B';
        case 'deprecated':
        case 'notToBeReleased':
        case 'notToBeReleasedStable':
            return 'C';
        case 'noAPI':
            return 'D';
        default:
            // Unknown state — default to B (released stable). Same default the
            // existing applyHeuristic uses for standard-namespace objects.
            return 'B';
    }
}
/**
 * Map SAP-native object type tags to the short, agent-facing type strings
 * the rest of DarkHorse uses. SAP uses both `tadirObject` (the TADIR row
 * type — CLAS, INTF, ENHS, BDEF, etc.) and `objectType` (a more granular
 * tag — BADI_DEF, CDS_STOB). We prefer the granular one when it adds info.
 */
function mapTadirToShortType(tadirObject, objectType) {
    // Special granular types take precedence
    if (objectType === 'BADI_DEF')
        return 'BADI';
    if (objectType === 'CDS_STOB')
        return 'CDS';
    if (objectType === 'BDEF')
        return 'BDEF';
    // Function modules that are BAPIs are still TADIR=FUNC; surface as BAPI when
    // the name carries the BAPI_ prefix.
    if (objectType === 'FUNC' || tadirObject === 'FUNC')
        return 'FUNC';
    // Otherwise fall back to TADIR.
    return tadirObject;
}
//# sourceMappingURL=CloudificationCatalogProvider.js.map