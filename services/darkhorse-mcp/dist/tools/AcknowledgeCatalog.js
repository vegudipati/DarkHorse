/**
 * AcknowledgeCatalog — persists a developer-acknowledged SAP object to the
 * seed catalog JSON so future sessions treat it as a known valid object.
 *
 * Sprint 3 follow-up: the post-generation Clean Core report lets the
 * developer mark "not in catalog" findings as valid, but those ack'd entries
 * were ephemeral. This tool writes them to disk so the next time the verifier
 * encounters the same name (in this or any later run), the static catalog
 * already knows about it.
 *
 * Categories supported in v1:
 *   - 'exit' -> appends to catalog/exit-catalog.json `exits` array
 *   - 'badi' -> appends to catalog/badi-catalog.json `badis` array
 *
 * Acknowledged entries are tagged developerAcknowledged=true so a future
 * "Remove acknowledgement" tool can find them, and so the catalog is
 * auditable (you can tell at a glance which entries came from real SAP
 * documentation vs developer self-acknowledgement).
 *
 * Defaults applied to acknowledged entries:
 *   - level: 'B'  (released, upgrade-stable — Clean Core compliant per doctrine)
 *   - exists: true
 *   - module: caller-provided or 'UNKNOWN'
 *   - description: "Developer-acknowledged ... (timestamp). Not yet verified
 *                   via SAP API Hub."
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgeCatalog = acknowledgeCatalog;
const fs = require("fs");
const path = require("path");
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function acknowledgeCatalog(input, catalogDir) {
    if (!input || !input.category) {
        throw new Error('acknowledge_catalog: category is required (exit | badi).');
    }
    if (input.category !== 'exit' && input.category !== 'badi') {
        throw new Error(`acknowledge_catalog: unknown category "${input.category}".`);
    }
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
        throw new Error('acknowledge_catalog: name is required and must be non-empty.');
    }
    const fileName = input.category === 'exit' ? 'exit-catalog.json' : 'badi-catalog.json';
    const arrayKey = input.category === 'exit' ? 'exits' : 'badis';
    const catalogPath = path.join(catalogDir, fileName);
    const normalised = input.name.trim().toUpperCase();
    const acknowledgedAt = new Date().toISOString();
    if (!fs.existsSync(catalogPath)) {
        throw new Error(`acknowledge_catalog: catalog not found at ${catalogPath}.`);
    }
    const raw = fs.readFileSync(catalogPath, 'utf-8');
    const data = JSON.parse(raw);
    const bucket = Array.isArray(data[arrayKey]) ? data[arrayKey] : [];
    // Check for existing entry (case-insensitive by name).
    const existing = bucket.find((e) => typeof e.name === 'string' && e.name.trim().toUpperCase() === normalised);
    if (existing) {
        return {
            category: input.category,
            name: existing.name,
            status: 'already-present',
            level: (existing.level === 'B' ? 'B' : 'B'), // narrow type
            developerAcknowledged: true,
            acknowledgedAt,
            catalogPath
        };
    }
    // Construct a new entry. Shape mirrors the existing schema for each category.
    const description = `Developer-acknowledged SAP ${input.category === 'exit' ? 'exit' : 'BAdI'} ` +
        `(${acknowledgedAt}). Confirmed by the developer as a real, released SAP ` +
        `object; not yet verified against the SAP Business Accelerator Hub. ` +
        `Treated as Level B (released, upgrade-stable) per Clean Core doctrine.` +
        (input.note ? ` Note: ${input.note}` : '');
    let newEntry;
    if (input.category === 'exit') {
        newEntry = {
            name: input.name.trim(),
            type: 'USER_EXIT',
            level: 'B',
            module: input.module ?? 'UNKNOWN',
            description,
            exists: true,
            developerAcknowledged: true,
            acknowledgedAt
        };
    }
    else {
        newEntry = {
            name: input.name.trim(),
            enhancementSpot: null,
            level: 'B',
            module: input.module ?? 'UNKNOWN',
            description,
            interface: null,
            exists: true,
            developerAcknowledged: true,
            acknowledgedAt
        };
    }
    bucket.push(newEntry);
    data[arrayKey] = bucket;
    // Update the _metadata totalEntries if present.
    if (data._metadata && typeof data._metadata === 'object') {
        if (typeof data._metadata.totalEntries === 'number') {
            data._metadata.totalEntries = bucket.length;
        }
        data._metadata.lastDeveloperAcknowledgementAt = acknowledgedAt;
    }
    // Atomic-ish write: write to a temp file then rename.
    const tmpPath = catalogPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, catalogPath);
    return {
        category: input.category,
        name: newEntry.name,
        status: 'added',
        level: 'B',
        developerAcknowledged: true,
        acknowledgedAt,
        catalogPath
    };
}
//# sourceMappingURL=AcknowledgeCatalog.js.map