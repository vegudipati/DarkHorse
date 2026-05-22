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
export type AckCategory = 'exit' | 'badi';
export interface AcknowledgeCatalogInput {
    category: AckCategory;
    name: string;
    module?: string;
    /** Optional context describing why the developer acknowledged this. */
    note?: string;
}
export interface AcknowledgeCatalogOutput {
    category: AckCategory;
    name: string;
    status: 'added' | 'already-present';
    level: 'B';
    developerAcknowledged: true;
    acknowledgedAt: string;
    catalogPath: string;
}
export declare function acknowledgeCatalog(input: AcknowledgeCatalogInput, catalogDir: string): AcknowledgeCatalogOutput;
//# sourceMappingURL=AcknowledgeCatalog.d.ts.map