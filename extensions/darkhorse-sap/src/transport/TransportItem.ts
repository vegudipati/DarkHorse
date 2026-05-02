import * as vscode from 'vscode';

export type TransportStatus = 'D' | 'L' | 'R';  // D=Modifiable, L=Released, R=Released

export type TransportType = 'K' | 'W' | 'C';    // K=Workbench, W=Workbench, C=Customizing

export class TransportItem extends vscode.TreeItem {

  public readonly transportId: string;
  public readonly status: TransportStatus;
  public readonly transportType: TransportType;
  public readonly description: string;
  public readonly owner: string;
  public readonly itemType: 'transport' | 'object';

  constructor(
    transportId: string,
    description: string,
    status: TransportStatus,
    transportType: TransportType,
    owner: string,
    itemType: 'transport' | 'object' = 'transport'
  ) {
    const label = itemType === 'transport'
      ? `${transportId} — ${description}`
      : description;

    super(
      label,
      itemType === 'transport'
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.transportId = transportId;
    this.description = description;
    this.status = status;
    this.transportType = transportType;
    this.owner = owner;
    this.itemType = itemType;

    this.tooltip = this.getTooltip();
    this.iconPath = this.getIcon();
    this.contextValue = this.getContextValue();
  }

  public isModifiable(): boolean {
    return this.status === 'D';
  }

  private getTooltip(): string {
    if (this.itemType === 'object') {
      return this.description;
    }
    const statusText = this.status === 'D' ? 'Modifiable' :
                       this.status === 'L' ? 'Released' : 'Released';
    const typeText = this.transportType === 'C' ? 'Customizing' : 'Workbench';
    return `${this.transportId}\nType: ${typeText}\nStatus: ${statusText}\nOwner: ${this.owner}`;
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.itemType === 'object') {
      return new vscode.ThemeIcon('file-code');
    }
    switch (this.status) {
      case 'D': return new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.green'));
      case 'L': return new vscode.ThemeIcon('lock', new vscode.ThemeColor('charts.gray'));
      default:  return new vscode.ThemeIcon('package');
    }
  }

  private getContextValue(): string {
    if (this.itemType === 'object') { return 'transportObject'; }
    return this.status === 'D' ? 'transportModifiable' : 'transportReleased';
  }

  public static statusLabel(status: TransportStatus): string {
    switch (status) {
      case 'D': return 'Modifiable';
      case 'L': return 'Released';
      case 'R': return 'Released';
      default:  return 'Unknown';
    }
  }
}