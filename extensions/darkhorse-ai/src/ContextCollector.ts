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

import * as vscode from 'vscode';

export interface EditorContext {
  objectType?:   string;   // 'PROG' | 'CLAS' | 'FUGR' | 'TABL' | 'INTF' etc.
  objectName?:   string;   // SAP object name — will be PII-scrubbed by proxy
  sourceCode?:   string;   // Surrounding code window or selection
  selectedText?: string;   // Raw selection, if any
  languageId:    string;   // VS Code language ID — 'abap' expected
  cursorLine:    number;   // 0-based line number of cursor
}

// Lines of code to capture above and below the cursor
const CONTEXT_WINDOW_LINES = 50;

// SAP object type code map — derived from ADT URI path segments
const ADT_PATH_TO_TYPE: Record<string, string> = {
  'programs':          'PROG',
  'classes':           'CLAS',
  'interfaces':        'INTF',
  'functiongroups':    'FUGR',
  'includes':          'INCL',
  'tableDefinitions':  'TABL',
  'datadefinitions':   'DDLS',   // CDS view
  'enhancementimpls':  'ENHO',
  'messageClasses':    'MSAG'
};

export class ContextCollector {

  /**
   * Collect context from the currently active text editor.
   * Returns a minimal context object — all fields are optional
   * except languageId and cursorLine.
   */
  public collect(): EditorContext {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      return { languageId: 'unknown', cursorLine: 0 };
    }

    const document    = editor.document;
    const languageId  = document.languageId;
    const cursorLine  = editor.selection.active.line;
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

  private getSelectedText(editor: vscode.TextEditor): string {
    const selection = editor.selection;
    if (selection.isEmpty) {
      return '';
    }
    return editor.document.getText(selection);
  }

  private getContextWindow(document: vscode.TextDocument, cursorLine: number): string {
    const totalLines = document.lineCount;
    const startLine  = Math.max(0, cursorLine - CONTEXT_WINDOW_LINES);
    const endLine    = Math.min(totalLines - 1, cursorLine + CONTEXT_WINDOW_LINES);

    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, document.lineAt(endLine).text.length)
    );

    return document.getText(range);
  }

  private extractObjectInfo(uri: vscode.Uri): { objectType?: string; objectName?: string } {
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
        const extToType: Record<string, string> = {
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
