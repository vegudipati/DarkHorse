import * as keytar from 'keytar';

const SERVICE_NAME = 'DarkHorse-SAP';

export interface SapCredentials {
  username: string;
  password: string;
}

export class CredentialVault {

  /**
   * Store SAP credentials in Windows Credential Manager.
   * Credentials are encrypted via Windows DPAPI — never stored in plaintext.
   */
  public static async store(systemId: string, username: string, password: string): Promise<void> {
    const key = `${systemId}:${username}`;
    await keytar.setPassword(SERVICE_NAME, key, password);
  }

  /**
   * Retrieve credentials for a system. Returns null if not found.
   */
  public static async retrieve(systemId: string, username: string): Promise<SapCredentials | null> {
    const key = `${systemId}:${username}`;
    const password = await keytar.getPassword(SERVICE_NAME, key);
    if (!password) {
      return null;
    }
    return { username, password };
  }

  /**
   * Delete credentials for a system from Windows Credential Manager.
   */
  public static async delete(systemId: string, username: string): Promise<void> {
    const key = `${systemId}:${username}`;
    await keytar.deletePassword(SERVICE_NAME, key);
  }

  /**
   * Check if credentials exist for a system without retrieving the password.
   */
  public static async exists(systemId: string, username: string): Promise<boolean> {
    const key = `${systemId}:${username}`;
    const password = await keytar.getPassword(SERVICE_NAME, key);
    return password !== null;
  }
}