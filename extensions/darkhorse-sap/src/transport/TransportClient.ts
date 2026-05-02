import { AdtClient } from '../adt/AdtClient';
import { AdtSession } from '../adt/AdtSession';
import { SapSystem } from '../landscape/LandscapeManager';
import { TransportStatus, TransportType } from './TransportItem';

export interface Transport {
  id: string;
  description: string;
  status: TransportStatus;
  transportType: TransportType;
  owner: string;
  objects?: TransportObject[];
}

export interface TransportObject {
  objectType: string;
  objectName: string;
  uri: string;
}

export class TransportClient {

  private system: SapSystem;
  private session: AdtSession;
  private adtClient: AdtClient;

  constructor(system: SapSystem, session: AdtSession, adtClient: AdtClient) {
    this.system = system;
    this.session = session;
    this.adtClient = adtClient;
  }

  private getBaseUrl(): string {
    return this.system.host.startsWith('http')
      ? this.system.host
      : `https://${this.system.host}`;
  }

  /**
   * List all open (modifiable) transports for the logged-in user.
   */
  public async listTransports(): Promise<Transport[]> {
    const url = `${this.getBaseUrl()}/sap/bc/adt/cts/transports` +
      `?target=&user=${encodeURIComponent(this.session.getUsername())}&category=&status=D`;

    const response = await this.adtClient.rawRequest({
      url,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.sap.adt.cts.transports.v2+xml',
        'Cookie': this.session.getCookieHeader(),
        'sap-client': this.system.client
      }
    });

    return this.parseTransports(response.body);
  }

  /**
   * Get objects assigned to a specific transport.
   */
  public async getTransportObjects(transportId: string): Promise<TransportObject[]> {
    const url = `${this.getBaseUrl()}/sap/bc/adt/cts/transports/${transportId}`;

    const response = await this.adtClient.rawRequest({
      url,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.sap.adt.cts.transports.v2+xml',
        'Cookie': this.session.getCookieHeader(),
        'sap-client': this.system.client
      }
    });

    return this.parseTransportObjects(response.body);
  }

  /**
   * Create a new transport request.
   * Returns the new transport ID.
   */
  public async createTransport(description: string, type: 'workbench' | 'customizing'): Promise<string> {
    const url = `${this.getBaseUrl()}/sap/bc/adt/cts/transports`;
    const category = type === 'workbench' ? 'SYST' : 'CUST';

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<cts:abapTransport category="${category}" target="" 
  xmlns:cts="http://www.sap.com/cts/adt"
  xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef/>
  <cts:description>${this.escapeXml(description)}</cts:description>
</cts:abapTransport>`;

    const response = await this.adtClient.rawRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.sap.adt.cts.transports.v1+xml',
        'Accept': 'text/plain',
        'X-CSRF-Token': this.session.getCsrfToken(),
        'Cookie': this.session.getCookieHeader(),
        'sap-client': this.system.client
      },
      body
    });

    // SAP returns the transport ID in the Location header or response body
    const location = response.headers['location'];
    if (location) {
      const parts = (Array.isArray(location) ? location[0] : location).split('/');
      return parts[parts.length - 1];
    }

    // Fallback: parse from body
    const match = response.body.match(/([A-Z]{3}K\d{6})/);
    return match ? match[1] : response.body.trim();
  }

  /**
   * Assign an ABAP object to a transport.
   * NOTE: DarkHorse never releases transports — that stays in STMS.
   */
  public async assignObjectToTransport(
    transportId: string,
    objectType: string,
    objectName: string,
    objectUri: string
  ): Promise<void> {
    const url = `${this.getBaseUrl()}/sap/bc/adt/cts/transports/${transportId}/tasks`;

    const body = `<?xml version="1.0" encoding="UTF-8"?>
<cts:abapTransportObject 
  xmlns:cts="http://www.sap.com/cts/adt"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:uri="${this.escapeXml(objectUri)}"
  adtcore:type="${this.escapeXml(objectType)}"
  adtcore:name="${this.escapeXml(objectName.toUpperCase())}"/>`;

    await this.adtClient.rawRequest({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.sap.adt.cts.transportobjects.v1+xml',
        'X-CSRF-Token': this.session.getCsrfToken(),
        'Cookie': this.session.getCookieHeader(),
        'sap-client': this.system.client
      },
      body
    });
  }

  // ─── Parsers ────────────────────────────────────────────────────

  private parseTransports(xml: string): Transport[] {
    const transports: Transport[] = [];
    const regex = /<cts:workbenchRequest[^>]*cts:category="([^"]*)"[^>]*adtcore:name="([^"]*)"[^>]*cts:status="([^"]*)"[^>]*cts:owner="([^"]*)"[^>]*>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const descMatch = xml.substring(match.index).match(/<cts:description>([^<]*)<\/cts:description>/);
      transports.push({
        id: match[2],
        description: descMatch ? descMatch[1] : '',
        status: (match[3] as TransportStatus) ?? 'D',
        transportType: (match[1] as TransportType) ?? 'K',
        owner: match[4]
      });
    }
    return transports;
  }

  private parseTransportObjects(xml: string): TransportObject[] {
    const objects: TransportObject[] = [];
    const regex = /<adtcore:objectReference[^>]*adtcore:type="([^"]*)"[^>]*adtcore:name="([^"]*)"[^>]*adtcore:uri="([^"]*)"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      objects.push({
        objectType: match[1],
        objectName: match[2],
        uri: match[3]
      });
    }
    return objects;
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