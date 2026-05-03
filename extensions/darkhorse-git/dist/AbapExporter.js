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
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbapExporter = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Map SAP object type codes to folder names and file extensions
const OBJECT_TYPE_MAP = {
    'PROG': { folder: 'programs', ext: 'prog' },
    'CLAS': { folder: 'classes', ext: 'clas' },
    'INTF': { folder: 'interfaces', ext: 'intf' },
    'FUGR': { folder: 'function-groups', ext: 'fugr' },
    'FUNC': { folder: 'function-groups', ext: 'func' },
    'INCL': { folder: 'includes', ext: 'incl' },
    'TABL': { folder: 'tables', ext: 'tabl' },
    'DTEL': { folder: 'data-elements', ext: 'dtel' },
    'DOMA': { folder: 'domains', ext: 'doma' },
    'MSAG': { folder: 'message-classes', ext: 'msag' },
    'ENHO': { folder: 'enhancements', ext: 'enho' },
    'DDLS': { folder: 'cds-views', ext: 'ddls' }
};
const DEFAULT_TYPE_MAP = { folder: 'other', ext: 'abap' };
class AbapExporter {
    /**
     * Export the currently active ABAP editor document to the client repo.
     *
     * @param repoRoot   Absolute path to the client Git repo root
     * @param meta       Optional metadata to write alongside the source file
     */
    async exportActiveEditor(repoRoot, meta) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error('No active editor. Open an ABAP file in DarkHorse first.');
        }
        if (editor.document.languageId !== 'abap') {
            throw new Error('Active file is not an ABAP file. Switch to an ABAP editor tab.');
        }
        const sourceCode = editor.document.getText();
        const { objectType, objectName } = this.extractObjectInfo(editor.document.uri);
        if (!objectName) {
            throw new Error('Could not determine SAP object name from the active file. ' +
                'Make sure you opened the file from the SAP Explorer panel.');
        }
        return this.exportToRepo(repoRoot, objectName, objectType || 'PROG', sourceCode, meta);
    }
    /**
     * Export a named ABAP object with provided source code.
     * Used by the SAP Explorer right-click context menu.
     */
    async exportObject(repoRoot, objectName, objectType, sourceCode, meta, functionGroupName // Required when objectType is FUNC
    ) {
        return this.exportToRepo(repoRoot, objectName, objectType, sourceCode, meta, functionGroupName);
    }
    // ---------------------------------------------------------------------------
    // Core export logic
    // ---------------------------------------------------------------------------
    async exportToRepo(repoRoot, objectName, objectType, sourceCode, meta, functionGroupName) {
        if (!fs.existsSync(repoRoot)) {
            throw new Error(`Repo root does not exist: ${repoRoot}`);
        }
        const typeConfig = OBJECT_TYPE_MAP[objectType] || DEFAULT_TYPE_MAP;
        // Build the target directory path
        let targetDir;
        if (objectType === 'FUNC' && functionGroupName) {
            // Function modules nest inside their function group folder
            targetDir = path.join(repoRoot, 'src', typeConfig.folder, functionGroupName.toUpperCase());
        }
        else {
            targetDir = path.join(repoRoot, 'src', typeConfig.folder);
        }
        // Ensure directory exists
        fs.mkdirSync(targetDir, { recursive: true });
        // Build file name: OBJECTNAME.type.abap
        const fileName = `${objectName.toUpperCase()}.${typeConfig.ext}.abap`;
        const filePath = path.join(targetDir, fileName);
        const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
        // Write source code
        fs.writeFileSync(filePath, sourceCode, { encoding: 'utf8' });
        // Write companion metadata JSON
        const fullMeta = {
            objectName: objectName.toUpperCase(),
            objectType: objectType,
            packageName: meta?.packageName,
            transportNo: meta?.transportNo,
            exportedAt: new Date().toISOString(),
            exportedBy: meta?.exportedBy,
            sapSystem: 'SAP_SYSTEM' // Always scrubbed — never store actual SID
        };
        const metaFileName = `${objectName.toUpperCase()}.${typeConfig.ext}.json`;
        const metaFilePath = path.join(targetDir, metaFileName);
        fs.writeFileSync(metaFilePath, JSON.stringify(fullMeta, null, 2), { encoding: 'utf8' });
        return {
            filePath,
            relativePath,
            objectName: objectName.toUpperCase(),
            objectType,
            repoRoot
        };
    }
    // ---------------------------------------------------------------------------
    // Object info extraction (mirrors ContextCollector logic)
    // ---------------------------------------------------------------------------
    extractObjectInfo(uri) {
        if (uri.scheme === 'abap') {
            const parts = uri.path.split('/').filter(Boolean);
            if (parts.length >= 3) {
                const typeMap = {
                    'programs': 'PROG',
                    'classes': 'CLAS',
                    'interfaces': 'INTF',
                    'functiongroups': 'FUGR',
                    'includes': 'INCL'
                };
                return {
                    objectType: typeMap[parts[0]] || 'PROG',
                    objectName: parts[2]
                };
            }
        }
        const filename = uri.path.split('/').pop() || '';
        if (filename.endsWith('.abap')) {
            const base = filename.replace(/\.abap$/, '');
            const parts = base.split('.');
            if (parts.length >= 2) {
                const extToType = {
                    'clas': 'CLAS', 'intf': 'INTF',
                    'fugr': 'FUGR', 'prog': 'PROG', 'incl': 'INCL'
                };
                return {
                    objectType: extToType[parts[parts.length - 1]] || 'PROG',
                    objectName: parts[0]
                };
            }
            return { objectType: 'PROG', objectName: base };
        }
        return {};
    }
    // ---------------------------------------------------------------------------
    // Utility: resolve the expected file path for an object without exporting
    // ---------------------------------------------------------------------------
    resolveFilePath(repoRoot, objectName, objectType, functionGroupName) {
        const typeConfig = OBJECT_TYPE_MAP[objectType] || DEFAULT_TYPE_MAP;
        let targetDir;
        if (objectType === 'FUNC' && functionGroupName) {
            targetDir = path.join(repoRoot, 'src', typeConfig.folder, functionGroupName.toUpperCase());
        }
        else {
            targetDir = path.join(repoRoot, 'src', typeConfig.folder);
        }
        return path.join(targetDir, `${objectName.toUpperCase()}.${typeConfig.ext}.abap`);
    }
}
exports.AbapExporter = AbapExporter;
//# sourceMappingURL=AbapExporter.js.map