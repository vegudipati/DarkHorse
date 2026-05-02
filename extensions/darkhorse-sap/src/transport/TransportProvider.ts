import * as vscode from 'vscode';
import { TransportItem } from './TransportItem';
import { TransportClient, Transport } from './TransportClient';

export class TransportProvider implements vscode.TreeDataProvider<TransportItem> {

  private _onDidChangeTreeData = new vscode.EventEmitter<TransportItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: TransportClient | undefined;
  private transports: Transport[] = [];
  private connected: boolean = false;

  public setClient(client: TransportClient): void {
    this.client = client;
    this.connected = true;
    this.refresh();
  }

  public clearClient(): void {
    this.client = undefined;
    this.connected = false;
    this.transports = [];
    this.refresh();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TransportItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TransportItem): Promise<TransportItem[]> {
    if (!this.connected || !this.client) {
      return [new TransportItem(
        '', 'Not connected — connect to SAP first', 'D', 'K', '',  'object'
      )];
    }

    try {
      if (!element) {
        // Root — load all transports
        this.transports = await this.client.listTransports();

        if (this.transports.length === 0) {
          return [new TransportItem(
            '', 'No open transports found', 'D', 'K', '', 'object'
          )];
        }

        return this.transports.map(t => new TransportItem(
          t.id, t.description, t.status, t.transportType, t.owner, 'transport'
        ));
      }

      if (element.itemType === 'transport') {
        // Load objects in this transport
        const objects = await this.client.getTransportObjects(element.transportId);
        if (objects.length === 0) {
          return [new TransportItem('', 'No objects assigned', 'D', 'K', '', 'object')];
        }
        return objects.map(o => new TransportItem(
          o.objectName,
          `${o.objectType}: ${o.objectName}`,
          'D', 'K', '', 'object'
        ));
      }

      return [];

    } catch (err: any) {
      vscode.window.showErrorMessage(`Transport Manager error: ${err.message}`);
      return [];
    }
  }
}