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

'use strict';

import * as vscode from 'vscode';
import { EditorContext } from './ContextCollector';

// URI scheme for our virtual diff documents
const DIFF_SCHEME = 'darkhorse-diff';

export class DiffPreview implements vscode.Disposable {

  private contentProvider: DiffContentProvider;
  private providerRegistration: vscode.Disposable;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.contentProvider = new DiffContentProvider();
    this.providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
      DIFF_SCHEME,
      this.contentProvider
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Show the generated code as a diff preview.
   * @param generatedCode  The raw code string returned by the LLM proxy
   * @param context        Editor context collected before the request was sent
   */
  public async show(generatedCode: string, context: EditorContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor || context.languageId !== 'abap') {
      // Scenario B: no active ABAP editor — show read-only preview
      await this.showReadOnlyPreview(generatedCode, context);
      return;
    }

    // Scenario A: diff against the active file
    await this.showDiff(editor, generatedCode, context);
  }

  // ---------------------------------------------------------------------------
  // Scenario A: Diff view
  // ---------------------------------------------------------------------------

  private async showDiff(
    editor: vscode.TextEditor,
    generatedCode: string,
    context: EditorContext
  ): Promise<void> {
    const document    = editor.document;
    const originalText = document.getText();
    const cursorOffset = document.offsetAt(editor.selection.active);

    // Build the "proposed" document: original with generated code inserted
    let proposedText: string;
    if (context.selectedText) {
      // Replace the selection with generated code
      const selStart = document.offsetAt(editor.selection.start);
      const selEnd   = document.offsetAt(editor.selection.end);
      proposedText = originalText.slice(0, selStart) + generatedCode + originalText.slice(selEnd);
    } else {
      // Insert at cursor position
      proposedText = originalText.slice(0, cursorOffset) + '\n' + generatedCode + '\n' + originalText.slice(cursorOffset);
    }

    // Store both versions in the virtual document provider
    const originalUri = vscode.Uri.parse(`${DIFF_SCHEME}://original/${document.uri.fsPath || 'abap-source'}`);
    const proposedUri = vscode.Uri.parse(`${DIFF_SCHEME}://proposed/${document.uri.fsPath || 'abap-source'}`);

    this.contentProvider.set(originalUri.toString(), originalText);
    this.contentProvider.set(proposedUri.toString(), proposedText);

    // Open the diff editor
    const objectLabel = context.objectName || 'ABAP Object';
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `DarkHorse AI — ${objectLabel} (review changes)`,
      { preview: true }
    );

    // Show Accept / Reject buttons in a notification
    const choice = await vscode.window.showInformationMessage(
      'DarkHorse AI generated code. Accept to insert, Reject to discard.',
      { modal: false },
      'Accept',
      'Reject'
    );

    if (choice === 'Accept') {
      await this.applyCode(editor, generatedCode, context);
    }

    // Clean up virtual documents
    this.contentProvider.delete(originalUri.toString());
    this.contentProvider.delete(proposedUri.toString());

    // Close the diff editor tab
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }

  // ---------------------------------------------------------------------------
  // Scenario B: Read-only preview
  // ---------------------------------------------------------------------------

  private async showReadOnlyPreview(generatedCode: string, context: EditorContext): Promise<void> {
    const previewUri = vscode.Uri.parse(`${DIFF_SCHEME}://preview/generated.abap`);
    this.contentProvider.set(previewUri.toString(), generatedCode);

    const doc = await vscode.workspace.openTextDocument(previewUri);
    await vscode.window.showTextDocument(doc, {
      preview:    true,
      viewColumn: vscode.ViewColumn.Beside
    });

    const choice = await vscode.window.showInformationMessage(
      'No active ABAP editor. Copy the generated code from the preview tab.',
      'Open New ABAP File'
    );

    if (choice === 'Open New ABAP File') {
      const newDoc = await vscode.workspace.openTextDocument({
        language: 'abap',
        content:  generatedCode
      });
      await vscode.window.showTextDocument(newDoc);
    }
  }

  // ---------------------------------------------------------------------------
  // Apply accepted code to the real editor
  // ---------------------------------------------------------------------------

  private async applyCode(
    editor: vscode.TextEditor,
    generatedCode: string,
    context: EditorContext
  ): Promise<void> {
    await editor.edit((editBuilder) => {
      if (context.selectedText && !editor.selection.isEmpty) {
        // Replace selection
        editBuilder.replace(editor.selection, generatedCode);
      } else {
        // Insert at cursor, preceded by newline for clean separation
        const position = editor.selection.active;
        editBuilder.insert(position, '\n' + generatedCode + '\n');
      }
    });

    // Reveal the newly inserted code
    vscode.window.showInformationMessage('DarkHorse AI: Code inserted successfully.');
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  public dispose(): void {
    this.providerRegistration.dispose();
    this.contentProvider.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

// ---------------------------------------------------------------------------
// Virtual document content provider
// Holds in-memory content for the diff view's virtual URIs
// ---------------------------------------------------------------------------

class DiffContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable {

  private store = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this._onDidChange.event;

  public set(uri: string, content: string): void {
    this.store.set(uri, content);
    this._onDidChange.fire(vscode.Uri.parse(uri));
  }

  public delete(uri: string): void {
    this.store.delete(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.store.get(uri.toString()) || '';
  }

  public dispose(): void {
    this._onDidChange.dispose();
    this.store.clear();
  }
}
