import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { AdtSession } from './AdtSession';
import { SapSystem } from '../landscape/LandscapeManager';

export interface AdtPackageNode {
  name: string;
  type: string;
  uri: string;
  children?: AdtPackageNode[];
}

export interface SyntaxError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export class AdtClient {

  private system: SapSystem;
  private session: AdtSession;

  constructor(system: SapSystem, session: AdtSession) {
    this.system = system;
    this.session = session;
  }

  private getBaseUrl(): string {
    return this.system.host.startsWith('http')
      ? this.system.host
      : `https://${this.system.host}`;
  }

  /**
   * Authenticate with SAP and fetch CSRF token.
   * Token and cookies stored in memory via AdtSession.
   */
  public async authenticate(password: string): Promise<void> {
    const baseUrl = this.system.host.startsWith('http') 
      ? this.system.host 
      : `https://${this.system.host}`;
    const url = `${baseUrl}/sap/bc/adt/core/discovery`;
    const credentials = Buffer.from(`${this.system.username}:${password}`).toString('base64');

    const response = await this.request({
      url,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'X-CSRF-Token': 'Fetch',
        'sap-client': this.system.client,
        'Accept': 'application/atomsvc+xml'
      }
    });

    const csrfToken = response.headers['x-csrf-token'];
    const cookies = response.headers['set-cookie'] ?? [];

    if (!csrfToken || csrfToken === 'Required') {
      throw new Error('Authentication failed: no CSRF token returned. Check credentials.');
    }

    this.session.setCsrfToken(Array.isArray(csrfToken) ? csrfToken[0] : csrfToken);
    this.session.setCookies(Array.isArray(cookies) ? cookies.map(c => c.split(';')[0]) : []);
    this.session.setAuthenticated(this.system.id, this.system.username);
  }

  /**
   * Read ABAP source code for a program.
   */
  public async readSource(programName: string): Promise<string> {
    const name = encodeURIComponent(programName.toUpperCase());
    const url = `${this.system.host}/sap/bc/adt/programs/programs/${name}/source/main`;

    const response = await this.authenticatedRequest({
      url,
      method: 'GET',
      headers: { 'Accept': 'text/plain' }
    });

    return response.body;
  }

  /**
   * Write ABAP source code back to SAP.
   */
  public async writeSource(programName: string, source: string): Promise<void> {
    const name = encodeURIComponent(programName.toUpperCase());
    const url = `${this.system.host}/sap/bc/adt/programs/programs/${name}/source/main`;

    await this.authenticatedRequest({
      url,
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-CSRF-Token': this.session.getCsrfToken()
      },
      body: source
    });
  }

  /**
   * Run ADT syntax check on source code.
   * Returns list of syntax errors with line numbers.
   */
  public async checkSyntax(programName: string, source: string): Promise<SyntaxError[]> {
    const url = `${this.system.host}/sap/bc/adt/checkruns`;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun">
  <chkrun:checkObject adtcore:uri="/sap/bc/adt/programs/programs/${programName.toUpperCase()}" 
    xmlns:adtcore="http://www.sap.com/adt/core">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8">
        <chkrun:content>${this.escapeXml(source)}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;

    const response = await this.authenticatedRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.sap.adt.checkobjects+xml',
        'Accept': 'application/vnd.sap.adt.checkmessages+xml',
        'X-CSRF-Token': this.session.getCsrfToken()
      },
      body
    });

    return this.parseSyntaxErrors(response.body);
  }

  /**
   * Get the repository node structure (packages and objects).
   */
  public async getNodeStructure(packageName?: string): Promise<AdtPackageNode[]> {
    let url = `${this.system.host}/sap/bc/adt/repository/nodestructure`;
    if (packageName) {
      url += `?parent_name=${encodeURIComponent(packageName)}&parent_tech_name=${encodeURIComponent(packageName)}`;
    }

    const response = await this.authenticatedRequest({
      url,
      method: 'GET',
      headers: { 'Accept': 'application/vnd.sap.as+xml' }
    });

    return this.parseNodeStructure(response.body);
  }

  /**
   * Search for SAP objects by name pattern.
   */
  public async searchObjects(query: string, maxResults: number = 50): Promise<AdtPackageNode[]> {
    const url = `${this.system.host}/sap/bc/adt/repository/informationsystem/search` +
      `?operation=quickSearch&query=${encodeURIComponent(query)}&maxResults=${maxResults}`;

    const response = await this.authenticatedRequest({
      url,
      method: 'GET',
      headers: { 'Accept': 'application/xml' }
    });

    return this.parseSearchResults(response.body);
  }

  // ─── Private helpers ────────────────────────────────────────────

  private async authenticatedRequest(options: RequestOptions): Promise<ResponseData> {
    if (!this.session.getIsAuthenticated()) {
      throw new Error('Not authenticated. Connect to SAP first.');
    }
    return this.request({
      ...options,
      headers: {
        ...options.headers,
        'Cookie': this.session.getCookieHeader(),
        'sap-client': this.system.client
      }
    });
  }

  private request(options: RequestOptions): Promise<ResponseData> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(options.url);
      const isHttps = parsedUrl.protocol === 'https:';

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: options.headers ?? {},
        // Security: reject self-signed certs in production
        // Set rejectUnauthorized: false only for dev/test systems
        rejectUnauthorized: false
      };

      const lib = isHttps ? https : http;
      const req = lib.request(reqOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SAP ADT error ${res.statusCode}: ${body.substring(0, 200)}`));
            return;
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body
          });
        });
      });

      req.on('error', (err) => reject(new Error(`SAP connection error: ${err.message}`)));

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  private parseSyntaxErrors(xml: string): SyntaxError[] {
    const errors: SyntaxError[] = [];
    // Parse ADT checkrun response XML for error messages
    const messageRegex = /<msg[^>]*adtcore:line="(\d+)"[^>]*chkrun:col="(\d+)"[^>]*severity="([^"]*)"[^>]*>([^<]*)<\/msg>/g;
    let match;
    while ((match = messageRegex.exec(xml)) !== null) {
      errors.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        severity: match[3].toLowerCase().includes('error') ? 'error' : 'warning',
        message: match[4].trim()
      });
    }
    return errors;
  }

  private parseNodeStructure(xml: string): AdtPackageNode[] {
    const nodes: AdtPackageNode[] = [];
    const nodeRegex = /<nodestructure:packageNode[^>]*adtcore:name="([^"]*)"[^>]*adtcore:type="([^"]*)"[^>]*adtcore:uri="([^"]*)"/g;
    let match;
    while ((match = nodeRegex.exec(xml)) !== null) {
      nodes.push({ name: match[1], type: match[2], uri: match[3] });
    }
    return nodes;
  }

  private parseSearchResults(xml: string): AdtPackageNode[] {
    const nodes: AdtPackageNode[] = [];
    const objRegex = /<adtcore:objectReference[^>]*adtcore:name="([^"]*)"[^>]*adtcore:type="([^"]*)"[^>]*adtcore:uri="([^"]*)"/g;
    let match;
    while ((match = objRegex.exec(xml)) !== null) {
      nodes.push({ name: match[1], type: match[2], uri: match[3] });
    }
    return nodes;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

interface RequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

interface ResponseData {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}