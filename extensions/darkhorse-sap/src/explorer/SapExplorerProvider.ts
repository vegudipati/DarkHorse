import * as vscode from 'vscode';
import { SapObjectItem, SapObjectType } from './SapObjectItem';
import { AdtClient } from '../adt/AdtClient';
import { AdtSession } from '../adt/AdtSession';

export class SapExplorerProvider implements vscode.TreeDataProvider<SapObjectItem> {

  private _onDidChangeTreeData = new vscode.EventEmitter<SapObjectItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: AdtClient | undefined;
  private session: AdtSession | undefined;
  private systemId: string = '';
  private connected: boolean = false;

  public setConnection(client: AdtClient, session: AdtSession, systemId: string): void {
    this.client = client;
    this.session = session;
    this.systemId = systemId;
    this.connected = true;
    this.refresh();
  }

  public clearConnection(): void {
    this.client = undefined;
    this.session = undefined;
    this.systemId = '';
    this.connected = false;
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SapObjectItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SapObjectItem): Promise<SapObjectItem[]> {
    if (!this.connected || !this.client) {
      return [
        new SapObjectItem(
          'Not connected — use DarkHorse SAP: Connect to System',
          'UNKNOWN', '', '', '',
          vscode.TreeItemCollapsibleState.None
        )
      ];
    }

    try {
      if (!element) {
        // Root level — show the connected system
        const item = new SapObjectItem(
          `${this.systemId} (Connected)`,
          'SYSTEM', this.systemId, this.systemId, '',
          vscode.TreeItemCollapsibleState.Expanded
        );
        return [item];
      }

      if (element.objectType === 'SYSTEM') {
        // Top-level packages
        const nodes = await this.client.getNodeStructure();
        return nodes.map(n => new SapObjectItem(
          n.name,
          SapObjectItem.typeFromAdtType(n.type),
          n.name,
          this.systemId,
          n.uri,
          vscode.TreeItemCollapsibleState.Collapsed
        ));
      }

      if (element.objectType === 'PACKAGE') {
        // Children of a package
        const nodes = await this.client.getNodeStructure(element.objectName);
        return nodes.map(n => new SapObjectItem(
          n.name,
          SapObjectItem.typeFromAdtType(n.type),
          n.name,
          this.systemId,
          n.uri,
          n.type === 'DEVC/K'
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None
        ));
      }

      return [];

    } catch (err: any) {
      vscode.window.showErrorMessage(`SAP Explorer error: ${err.message}`);
      return [];
    }
  }
}