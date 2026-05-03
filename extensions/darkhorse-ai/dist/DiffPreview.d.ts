/**
 * DarkHorse AI Extension — Diff Preview
 *
 * Shows AI-generated ABAP code as a VS Code diff editor.
 * The developer must explicitly click "Accept" to insert the code.
 * Code is NEVER automatically inserted into the active editor.
 *
 * Two scenarios:
 *
 * A) Active editor has an open ABAP file:
 *    - Left side: current file content (original)
 *    - Right side: file content with generated code inserted at cursor
 *    - Developer reviews the diff and clicks Accept or Reject
 *
 * B) No active ABAP editor (panel opened independently):
 *    - Opens a read-only preview document with the generated code
 *    - Developer copies what they need manually
 *
 * Accept action:
 *    - Replaces the selected text (if any) or inserts at cursor position
 *    - Closes the diff editor
 *
 * Reject action:
 *    - Closes the diff editor
 *    - Active file is unchanged
 */
import * as vscode from 'vscode';
import { EditorContext } from './ContextCollector';
export declare class DiffPreview implements vscode.Disposable {
    private contentProvider;
    private providerRegistration;
    private disposables;
    constructor();
    /**
     * Show the generated code as a diff preview.
     * @param generatedCode  The raw code string returned by the LLM proxy
     * @param context        Editor context collected before the request was sent
     */
    show(generatedCode: string, context: EditorContext): Promise<void>;
    private showDiff;
    private showReadOnlyPreview;
    private applyCode;
    dispose(): void;
}
