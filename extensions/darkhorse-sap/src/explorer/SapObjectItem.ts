import * as vscode from 'vscode';

export type SapObjectType = 'SYSTEM' | 'PACKAGE' | 'PROGRAM' | 'CLASS' | 'FUNCTION_GROUP' | 'FUNCTION_MODULE' | 'INCLUDE' | 'TABLE' | 'UNKNOWN';

export class SapObjectItem extends vscode.TreeItem {

  public readonly objectType: SapObjectType;
  public readonly objectName: string;
  public readonly systemId: string;
  public readonly uri: string;

  constructor(
    label: string,
    objectType: SapObjectType,
    objectName: string,
    systemId: string,
    uri: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    this.objectType = objectType;
    this.objectName = objectName;
    this.systemId = systemId;
    this.uri = uri;

    this.tooltip = `${objectType}: ${objectName}`;
    this.iconPath = this.getIcon();
    this.contextValue = objectType.toLowerCase();

    // Only leaf nodes (programs, classes, FMs) are openable
    if (this.isOpenable()) {
      this.command = {
        command: 'darkhorse.sap.openObject',
        title: 'Open ABAP Object',
        arguments: [this]
      };
    }
  }

  private isOpenable(): boolean {
    return ['PROGRAM', 'CLASS', 'FUNCTION_MODULE', 'INCLUDE'].includes(this.objectType);
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.objectType) {
      case 'SYSTEM':        return new vscode.ThemeIcon('server');
      case 'PACKAGE':       return new vscode.ThemeIcon('package');
      case 'PROGRAM':       return new vscode.ThemeIcon('file-code');
      case 'CLASS':         return new vscode.ThemeIcon('symbol-class');
      case 'FUNCTION_GROUP':return new vscode.ThemeIcon('symbol-namespace');
      case 'FUNCTION_MODULE':return new vscode.ThemeIcon('symbol-method');
      case 'INCLUDE':       return new vscode.ThemeIcon('file');
      case 'TABLE':         return new vscode.ThemeIcon('database');
      default:              return new vscode.ThemeIcon('circle-outline');
    }
  }

  public static typeFromAdtType(adtType: string): SapObjectType {
    const map: Record<string, SapObjectType> = {
      'DEVC/K': 'PACKAGE',
      'PROG/P': 'PROGRAM',
      'PROG/I': 'INCLUDE',
      'CLAS/OC': 'CLASS',
      'FUGR/F': 'FUNCTION_GROUP',
      'FUGR/FF': 'FUNCTION_MODULE',
      'TABL/DT': 'TABLE',
    };
    return map[adtType] ?? 'UNKNOWN';
  }
}