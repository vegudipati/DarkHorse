/**
 * DarkHorse Git Extension — ABAP Exporter
 *
 * Exports ABAP source code from the active editor (or SAP ADT)
 * into a structured local file system layout inside the client Git repo.
 *
 * Repo folder structure mirrors SAP object types:
 *
 *   <client-repo>/
 *   └── src/
 *       ├── programs/          PROG — reports, executable programs
 *       ├── classes/           CLAS — ABAP OO classes
 *       ├── interfaces/        INTF — ABAP interfaces
 *       ├── function-groups/   FUGR — function modules grouped by function group
 *       │   └── <FGRP_NAME>/
 *       │       ├── <FGRP_NAME>.fugr.abap       function group main include
 *       │       └── <FM_NAME>.func.abap          individual function modules
 *       ├── includes/          INCL — include programs
 *       ├── tables/            TABL — transparent table definitions (DDL)
 *       ├── data-elements/     DTEL — data elements
 *       ├── domains/           DOMA — domains
 *       ├── message-classes/   MSAG — message classes
 *       ├── enhancements/      ENHO — enhancement implementations
 *       └── cds-views/         DDLS — CDS view definitions
 *
 * File naming:
 *   - Programs:   ZMYREPORT.prog.abap
 *   - Classes:    ZCL_MYCLASS.clas.abap
 *   - Interfaces: ZIF_MYINTF.intf.abap
 *   - Includes:   ZMYINCLUDE.incl.abap
 *   - FMs:        ZFUNCTION_NAME.func.abap (inside function-groups/<FGRP>/)
 *
 * Each exported file also gets a companion metadata file:
 *   ZMYREPORT.prog.json — object type, package, transport, export timestamp
 */
export interface ExportResult {
    filePath: string;
    relativePath: string;
    objectName: string;
    objectType: string;
    repoRoot: string;
}
export interface AbapObjectMeta {
    objectName: string;
    objectType: string;
    packageName?: string;
    transportNo?: string;
    exportedAt: string;
    exportedBy?: string;
    sapSystem?: string;
}
export declare class AbapExporter {
    /**
     * Export the currently active ABAP editor document to the client repo.
     *
     * @param repoRoot   Absolute path to the client Git repo root
     * @param meta       Optional metadata to write alongside the source file
     */
    exportActiveEditor(repoRoot: string, meta?: Partial<AbapObjectMeta>): Promise<ExportResult>;
    /**
     * Export a named ABAP object with provided source code.
     * Used by the SAP Explorer right-click context menu.
     */
    exportObject(repoRoot: string, objectName: string, objectType: string, sourceCode: string, meta?: Partial<AbapObjectMeta>, functionGroupName?: string): Promise<ExportResult>;
    private exportToRepo;
    private extractObjectInfo;
    resolveFilePath(repoRoot: string, objectName: string, objectType: string, functionGroupName?: string): string;
}
