import * as vscode from 'vscode';
import { SyntaxChecker } from './diagnostics/SyntaxChecker';
import { AbapCompletionProvider } from './completion/AbapCompletionProvider';

let syntaxChecker: SyntaxChecker;

export function activate(context: vscode.ExtensionContext) {

  syntaxChecker = new SyntaxChecker();

  // Register ABAP completion provider
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: 'abap' },
      new AbapCompletionProvider(),
      ' ', '.', '>'
    )
  );

  // Run syntax check on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration();
      const checkOnSave = config.get<boolean>('darkhorse.abap.syntaxCheckOnSave', true);
      if (checkOnSave && document.languageId === 'abap') {
        await syntaxChecker.check(document);
      }
    })
  );

  // Run syntax check on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (document) => {
      if (document.languageId === 'abap') {
        await syntaxChecker.check(document);
      }
    })
  );

  // Clear diagnostics when file is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      syntaxChecker.clear(document);
    })
  );

  // Manual syntax check command
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.abap.checkSyntax', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'abap') {
        vscode.window.showWarningMessage('DarkHorse: Open an ABAP file first.');
        return;
      }
      await syntaxChecker.check(editor.document);
      vscode.window.showInformationMessage('DarkHorse ABAP: Syntax check complete.');
    })
  );

  // Check all open ABAP documents on activation
  vscode.workspace.textDocuments.forEach(async (doc) => {
    if (doc.languageId === 'abap') {
      await syntaxChecker.check(doc);
    }
  });

  context.subscriptions.push(syntaxChecker.getDiagnosticCollection());

  console.log('DarkHorse ABAP Language Support: activated');
}

export function deactivate() {
  syntaxChecker?.dispose();
}