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
export interface EditorContext {
    objectType?: string;
    objectName?: string;
    sourceCode?: string;
    selectedText?: string;
    languageId: string;
    cursorLine: number;
}
export declare class ContextCollector {
    /**
     * Collect context from the currently active text editor.
     * Returns a minimal context object — all fields are optional
     * except languageId and cursorLine.
     */
    collect(): EditorContext;
    private getSelectedText;
    private getContextWindow;
    private extractObjectInfo;
}
