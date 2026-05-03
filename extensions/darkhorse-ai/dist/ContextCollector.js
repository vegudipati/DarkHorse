/**
 * DarkHorse AI Extension — Context Collector
 *
 * Gathers context from the active VS Code editor to send alongside
 * the developer's prompt. Better context = better generated code.
 *
 * What it collects:
 *   - Active file language ID (must be 'abap' to proceed)
 *   - ABAP object type derived from file URI scheme (abap://) or filename
 *   - ABAP object name from the URI or filename
 *   - Selected text (if any) — used as focused context
 *   - Surrounding code window (±50 lines around cursor) — not the whole file
 *
 * What it deliberately does NOT collect:
 *   - The full file content (could be thousands of lines — wastes tokens)
 *   - File system path (may contain system/client info — scrubbed anyway but avoid)
 *   - Any open files other than the active one
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
exports.ContextCollector = void 0;
const vscode = __importStar(require("vscode"));
// Lines of code to capture above and below the cursor
const CONTEXT_WINDOW_LINES = 50;
// SAP object type code map — derived from ADT URI path segments
const ADT_PATH_TO_TYPE = {
    'programs': 'PROG',
    'classes': 'CLAS',
    'interfaces': 'INTF',
    'functiongroups': 'FUGR',
    'includes': 'INCL',
    'tableDefinitions': 'TABL',
    'datadefinitions': 'DDLS', // CDS view
    'enhancementimpls': 'ENHO',
    'messageClasses': 'MSAG'
};
class ContextCollector {
    /**
     * Collect context from the currently active text editor.
     * Returns a minimal context object — all fields are optional
     * except languageId and cursorLine.
     */
    collect() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return { languageId: 'unknown', cursorLine: 0 };
        }
        const document = editor.document;
        const languageId = document.languageId;
        const cursorLine = editor.selection.active.line;
        const selectedText = this.getSelectedText(editor);
        const { objectType, objectName } = this.extractObjectInfo(document.uri);
        // If there's a selection, use it as the context window
        // Otherwise capture a window around the cursor
        const sourceCode = selectedText
            ? selectedText
            : this.getContextWindow(document, cursorLine);
        return {
            objectType,
            objectName,
            sourceCode,
            selectedText: selectedText || undefined,
            languageId,
            cursorLine
        };
    }
    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------
    getSelectedText(editor) {
        const selection = editor.selection;
        if (selection.isEmpty) {
            return '';
        }
        return editor.document.getText(selection);
    }
    getContextWindow(document, cursorLine) {
        const totalLines = document.lineCount;
        const startLine = Math.max(0, cursorLine - CONTEXT_WINDOW_LINES);
        const endLine = Math.min(totalLines - 1, cursorLine + CONTEXT_WINDOW_LINES);
        const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, document.lineAt(endLine).text.length));
        return document.getText(range);
    }
    extractObjectInfo(uri) {
        // ADT virtual file URIs look like:
        //   abap://programs/programs/ZMYPROGRAM/source/main
        //   abap://classes/classes/ZCL_MYCLASS/source/main
        if (uri.scheme === 'abap') {
            const parts = uri.path.split('/').filter(Boolean);
            // parts[0] = object type path segment, parts[1] = type again, parts[2] = object name
            if (parts.length >= 3) {
                const objectType = ADT_PATH_TO_TYPE[parts[0]] || parts[0].toUpperCase();
                const objectName = parts[2];
                return { objectType, objectName };
            }
        }
        // Fallback: derive from filename for locally saved .abap files
        // e.g. ZMYREPORT.abap, ZCL_MYCLASS.clas.abap
        const filename = uri.path.split('/').pop() || '';
        if (filename.endsWith('.abap')) {
            const base = filename.replace(/\.abap$/, '');
            // Check for double-extension: ZCL_FOO.clas.abap
            const parts = base.split('.');
            if (parts.length >= 2) {
                const ext = parts[parts.length - 1].toUpperCase();
                const extToType = {
                    'CLAS': 'CLAS',
                    'INTF': 'INTF',
                    'FUGR': 'FUGR',
                    'PROG': 'PROG',
                    'INCL': 'INCL'
                };
                return {
                    objectType: extToType[ext] || 'PROG',
                    objectName: parts[0]
                };
            }
            // Single extension: treat as program
            return { objectType: 'PROG', objectName: base };
        }
        return {};
    }
}
exports.ContextCollector = ContextCollector;
//# sourceMappingURL=ContextCollector.js.map