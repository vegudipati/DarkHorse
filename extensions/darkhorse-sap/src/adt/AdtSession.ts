/**
 * AdtSession holds the active SAP session state IN MEMORY ONLY.
 * Nothing here is ever written to disk.
 * Session is cleared on disconnect or extension deactivation.
 */
export class AdtSession {

  private csrfToken: string = '';
  private cookies: string[] = [];
  private isAuthenticated: boolean = false;
  private systemId: string = '';
  private username: string = '';
  private connectedAt: Date | undefined;

  public setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  public getCsrfToken(): string {
    return this.csrfToken;
  }

  public setCookies(cookies: string[]): void {
    this.cookies = cookies;
  }

  public getCookies(): string[] {
    return this.cookies;
  }

  public getCookieHeader(): string {
    return this.cookies.join('; ');
  }

  public setAuthenticated(systemId: string, username: string): void {
    this.isAuthenticated = true;
    this.systemId = systemId;
    this.username = username;
    this.connectedAt = new Date();
  }

  public getIsAuthenticated(): boolean {
    return this.isAuthenticated;
  }

  public getSystemId(): string {
    return this.systemId;
  }

  public getUsername(): string {
    return this.username;
  }

  /**
   * Clear all session data from memory.
   * Called on disconnect or extension deactivation.
   */
  public clear(): void {
    this.csrfToken = '';
    this.cookies = [];
    this.isAuthenticated = false;
    this.systemId = '';
    this.username = '';
    this.connectedAt = undefined;
  }

  public getSummary(): string {
    if (!this.isAuthenticated) {
      return 'Not connected';
    }
    return `Connected to ${this.systemId} as ${this.username} since ${this.connectedAt?.toLocaleTimeString()}`;
  }
}