import * as vscode from 'vscode';

export interface SapSystem {
  id: string;          // Short ID e.g. "S4D" 
  name: string;        // Display name e.g. "S/4HANA DEV"
  host: string;        // e.g. "https://sap-dev.company.com:44300"
  client: string;      // SAP client e.g. "100"
  username: string;    // SAP username — stored here, password in CredentialVault
  language: string;    // Logon language e.g. "EN"
}

export class LandscapeManager {

  private static readonly CONFIG_KEY = 'darkhorse.sap.systems';
  private static readonly ACTIVE_KEY = 'darkhorse.sap.activeSystem';

  /**
   * Get all configured SAP systems.
   */
  public static getSystems(): SapSystem[] {
    const config = vscode.workspace.getConfiguration();
    return config.get<SapSystem[]>(this.CONFIG_KEY) ?? [];
  }

  /**
   * Add a new SAP system to the landscape.
   */
  public static async addSystem(system: SapSystem): Promise<void> {
    const systems = this.getSystems();
    const existing = systems.findIndex(s => s.id === system.id);
    if (existing >= 0) {
      systems[existing] = system;
    } else {
      systems.push(system);
    }
    await vscode.workspace.getConfiguration().update(
      this.CONFIG_KEY,
      systems,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Remove a SAP system from the landscape.
   */
  public static async removeSystem(systemId: string): Promise<void> {
    const systems = this.getSystems().filter(s => s.id !== systemId);
    await vscode.workspace.getConfiguration().update(
      this.CONFIG_KEY,
      systems,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Get a specific SAP system by ID.
   */
  public static getSystem(systemId: string): SapSystem | undefined {
    return this.getSystems().find(s => s.id === systemId);
  }

  /**
   * Set the active SAP system.
   */
  public static async setActiveSystem(systemId: string): Promise<void> {
    await vscode.workspace.getConfiguration().update(
      this.ACTIVE_KEY,
      systemId,
      vscode.ConfigurationTarget.Global
    );
  }

  /**
   * Get the currently active SAP system.
   */
  public static getActiveSystem(): SapSystem | undefined {
    const config = vscode.workspace.getConfiguration();
    const activeId = config.get<string>(this.ACTIVE_KEY);
    if (!activeId) {
      return undefined;
    }
    return this.getSystem(activeId);
  }
}