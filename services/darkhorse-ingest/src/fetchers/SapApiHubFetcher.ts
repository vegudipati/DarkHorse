/**
 * SapApiHubFetcher — Sprint 2 session 1 fetcher for SAP Business Accelerator Hub.
 *
 * The SAP API Hub (api.sap.com) is a structured catalog of released SAP APIs:
 * CDS views, BAPIs, OData services, RAP services, etc. It is the canonical
 * answer to "does this CDS view exist?" and "is this BAPI released?".
 *
 * Sprint 2 strategy:
 *   - This fetcher is the FIRST real fetcher and intentionally ships with a
 *     local seed fixture (fixtures/sap-api-hub-seed.json) so the full ingest
 *     pipeline runs end-to-end with zero network dependency in code-first
 *     mode.
 *   - The live HTTP path is implemented but disabled unless the caller passes
 *     `{ live: true, baseUrl }`. The real endpoint shape on api.sap.com is
 *     documented as TODO since SAP rotates the catalog API URL; a future
 *     session will pin the production endpoint after Deloitte confirms.
 */

'use strict';

import fs   = require('fs');
import path = require('path');

import {
  IFetcher,
  IngestDocument,
  SourceId,
  SapObjectType,
  CleanCoreLevel
} from '../types';

// ---------------------------------------------------------------------------
// Public types — fetcher options
// ---------------------------------------------------------------------------

export interface SapApiHubFetcherOptions {
  /** When true, the fetcher hits the live SAP API Hub catalog endpoint.
   *  When false (default for Sprint 2), it loads from the local seed fixture. */
  live?:         boolean;

  /** Base URL for the SAP API Hub catalog. Required when live=true.
   *  TODO: pin this in a later session once Deloitte confirms the exact
   *        public endpoint. */
  baseUrl?:      string;

  /** Override fixture path for tests. */
  fixturePath?:  string;
}

// ---------------------------------------------------------------------------
// Seed fixture schema — matches fixtures/sap-api-hub-seed.json
// ---------------------------------------------------------------------------

interface SapApiHubSeedEntry {
  name:           string;
  objectType:     SapObjectType;
  module:         string | null;
  cleanCoreLevel: CleanCoreLevel | null;
  title:          string;
  description:    string;
  url:            string | null;
  /** Free-form metadata that is propagated onto every chunk. */
  metadata?:      Record<string, string | number | boolean>;
}

interface SapApiHubSeedFile {
  _metadata: {
    sourceVersion: string;
    fetchedAt:     string;
    notes:         string;
  };
  entries:    SapApiHubSeedEntry[];
}

// ---------------------------------------------------------------------------
// Fetcher implementation
// ---------------------------------------------------------------------------

export class SapApiHubFetcher implements IFetcher {

  public readonly id:    SourceId = 'SAP_API_HUB';
  public readonly label: string   = 'SAP Business Accelerator Hub';

  constructor(private readonly options: SapApiHubFetcherOptions = {}) {}

  public async fetch(): Promise<IngestDocument[]> {
    if (this.options.live) {
      return this.fetchLive();
    }
    return this.fetchFromFixture();
  }

  // -------------------------------------------------------------------
  // Fixture path — Sprint 2 session 1 default
  // -------------------------------------------------------------------

  private fetchFromFixture(): IngestDocument[] {
    // __dirname is dist/fetchers/ at runtime; walk up two to package root,
    // then into fixtures/ — same pattern as the darkhorse-mcp catalog files.
    const defaultFixture = path.resolve(__dirname, '..', '..', 'fixtures', 'sap-api-hub-seed.json');
    const fixturePath    = this.options.fixturePath ?? defaultFixture;

    if (!fs.existsSync(fixturePath)) {
      throw new Error(`SapApiHubFetcher: seed fixture not found at ${fixturePath}`);
    }

    const raw  = fs.readFileSync(fixturePath, 'utf-8');
    const seed = JSON.parse(raw) as SapApiHubSeedFile;

    const fetchedAt = new Date().toISOString();

    return seed.entries.map(entry => this.toDocument(entry, fetchedAt));
  }

  // -------------------------------------------------------------------
  // Live path — wired but not the default for Sprint 2
  // -------------------------------------------------------------------

  private async fetchLive(): Promise<IngestDocument[]> {
    if (!this.options.baseUrl) {
      throw new Error('SapApiHubFetcher: live=true requires baseUrl in options.');
    }

    // Node 20+ has native fetch.
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/catalog`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      throw new Error(`SapApiHubFetcher: catalog request failed ${res.status} ${res.statusText}`);
    }
    const payload = await res.json() as { entries?: SapApiHubSeedEntry[] };
    if (!payload.entries || !Array.isArray(payload.entries)) {
      throw new Error('SapApiHubFetcher: catalog response missing entries[] array.');
    }

    const fetchedAt = new Date().toISOString();
    return payload.entries.map(entry => this.toDocument(entry, fetchedAt));
  }

  // -------------------------------------------------------------------
  // Shared shaping
  // -------------------------------------------------------------------

  private toDocument(entry: SapApiHubSeedEntry, fetchedAt: string): IngestDocument {
    const id = `sap-api-hub/${entry.objectType.toLowerCase()}/${entry.name}`;

    // Body: include title + description + a structured "object summary" so
    // semantic search can hit on either name or use-case phrasing.
    const body = [
      `Name: ${entry.name}`,
      `Type: ${entry.objectType}`,
      entry.module ? `Module: ${entry.module}` : null,
      entry.cleanCoreLevel ? `Clean Core Level: ${entry.cleanCoreLevel}` : null,
      '',
      entry.title,
      '',
      entry.description
    ].filter(Boolean).join('\n');

    return {
      id,
      source:         this.id,
      sourceUrl:      entry.url,
      objectName:     entry.name,
      objectType:     entry.objectType,
      module:         entry.module,
      cleanCoreLevel: entry.cleanCoreLevel,
      title:          entry.title,
      body,
      metadata:       entry.metadata ?? {},
      fetchedAt
    };
  }
}
