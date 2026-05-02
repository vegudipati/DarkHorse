import * as vscode from 'vscode';
import { AdtClient } from '../adt/AdtClient';

/**
 * Opens SAP ABAP objects as virtual documents in the VS Code editor.
 * URI scheme: abap://{systemId}/{programName}
 */
export class AbapDocumentProvider implements vscode.TextDocumentContentProvider {

  private client: AdtClient | undefined;
  private cache: Map<string, string> = new Map();

  public static readonly SCHEME = 'abap';

  public static buildUri(systemId: string, programName: string): vscode.Uri {
    return vscode.Uri.parse(`${AbapDocumentProvider.SCHEME}://${systemId}/${programName}`);
  }

  public static getProgramName(uri: vscode.Uri): string {
    return uri.path.replace(/^\//, '');
  }

  public setClient(client: AdtClient): void {
    this.client = client;
    this.cache.clear();
  }

  public clearClient(): void {
    this.client = undefined;
    this.cache.clear();
  }

  public invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this.client) {
      return '* DarkHorse: Not connected to SAP. Use DarkHorse SAP: Connect to System.';
    }

    const cacheKey = uri.toString();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const programName = AbapDocumentProvider.getProgramName(uri);

    try {
      const source = await this.client.readSource(programName);
      this.cache.set(cacheKey, source);
      return source;
    } catch (err: any) {
      return `* DarkHorse Error: Could not load ${programName}\n* ${err.message}`;
    }
  }
}