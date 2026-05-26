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
import { KnowledgeProvider, BadiRecord, ExitRecord, ExitType, CleanCoreLevelRecord } from './KnowledgeProvider';
export interface CloudificationProviderOptions {
    /** Override the directory containing the three cloudification JSON files. */
    dataDir?: string;
    /** When true, log load stats to stderr at construction. Default false. */
    verbose?: boolean;
}
export declare class CloudificationCatalogProvider implements KnowledgeProvider {
    private readonly options;
    readonly id = "sap-cloudification";
    /** Schema version of the underlying upstream data — bumped when the SAP
     *  format changes. We expose this so MCP tool responses can carry it. */
    readonly catalogVersion = "sap-cloudification-2026-05";
    private _byName;
    private _byTypeAndName;
    private _badiByName;
    private _badiByEnhancementSpot;
    constructor(options?: CloudificationProviderOptions);
    verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null>;
    verifyExit(_name: string, _programName?: string, _exitType?: ExitType): Promise<ExitRecord | null>;
    checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
    private getCleanCoreIndexes;
    private getBadiIndexes;
    private ensureLoaded;
    private renderBadiDescription;
    private renderLevelReasoning;
}
//# sourceMappingURL=CloudificationCatalogProvider.d.ts.map