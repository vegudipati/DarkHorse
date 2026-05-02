import * as vscode from 'vscode';

/**
 * CredentialVault uses VS Code's built-in SecretStorage API.
 * On Windows, this is backed by Windows Credential Manager (DPAPI).
 * No native modules required. No plaintext storage.
 */
export class CredentialVault {

  private static secrets: vscode.SecretStorage | undefined;

  /**
   * Must be called once during extension activation with context.secrets
   */
  public static initialize(secrets: vscode.SecretStorage): void {
    CredentialVault.secrets = secrets;
  }

  public static async store(systemId: string, username: string, password: string): Promise<void> {
    if (!CredentialVault.secrets) {
      throw new Error('CredentialVault not initialized');
    }
    const key = `darkhorse-sap:${systemId}:${username}`;
    await CredentialVault.secrets.store(key, password);
  }

  public static async retrieve(systemId: string, username: string): Promise<{ username: string; password: string } | null> {
    if (!CredentialVault.secrets) {
      throw new Error('CredentialVault not initialized');
    }
    const key = `darkhorse-sap:${systemId}:${username}`;
    const password = await CredentialVault.secrets.get(key);
    if (!password) {
      return null;
    }
    return { username, password };
  }

  public static async delete(systemId: string, username: string): Promise<void> {
    if (!CredentialVault.secrets) {
      throw new Error('CredentialVault not initialized');
    }
    const key = `darkhorse-sap:${systemId}:${username}`;
    await CredentialVault.secrets.delete(key);
  }

  public static async exists(systemId: string, username: string): Promise<boolean> {
    if (!CredentialVault.secrets) {
      return false;
    }
    const key = `darkhorse-sap:${systemId}:${username}`;
    const password = await CredentialVault.secrets.get(key);
    return password !== undefined;
  }
}