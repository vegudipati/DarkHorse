'use strict';

/**
 * SapApiHubCatalogFetcher — pages through the SAP API Hub OData catalog API
 * using an APIKey (no browser / no XSUAA required).
 *
 * Entity sets covered (as of 2026):
 *   APIContent.APIs          — 5,230+ OData/REST/SOAP services
 *   ContentPackages          — 2,100+ integration packages
 *
 * XSUAA-gated sets (BADIEntities, CdsViews, Events, DataProducts) are NOT
 * accessible with the API key and remain out of scope for this fetcher.
 *
 * Usage (env vars):
 *   DARKHORSE_API_HUB_APIKEY=<key>       required for live mode
 *   DARKHORSE_API_HUB_CATALOG_LIVE=true  enable live paging (default fixture)
 *   DARKHORSE_API_HUB_CATALOG_SETS=APIs,ContentPackages  subset (default both)
 */

import fs   = require('fs');
import path = require('path');

import { IFetcher, IngestDocument, SourceId } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SapApiHubCatalogFetcherOptions {
  apiKey:       string;
  live?:        boolean;
  /** Which entity sets to page. Default: ['APIs', 'ContentPackages'] */
  entitySets?:  Array<'APIs' | 'ContentPackages'>;
  /** Records per OData page. Default 100. */
  pageSize?:    number;
  /** Ms between page requests (rate-limit courtesy). Default 150. */
  delayMs?:     number;
  /** Max records per entity set (0 = all). Default 0. */
  maxRecords?:  number;
  /** Override output fixture path. */
  fixturePath?: string;
  verbose?:     boolean;
}

// Raw shapes returned by the catalog OData API
interface RawApiEntry {
  Name:                string;
  ID:                  string;
  Title:               string | null;
  ShortText:           string | null;
  Description:         string | null;
  ServiceCode:         string | null;   // 'ODATAV4' | 'ODATAV2' | 'REST' | 'SOAP' | …
  State:               string | null;   // 'ACTIVE' | 'DEPRECATED'
  Deprecated:          boolean | null;
  Successors:          string | null;
  BusinessObjects:     string | null;
  ParentTechnicalName: string | null;
  Version:             string | null;
}

interface RawPackageEntry {
  TechnicalName:     string;
  DisplayName:       string | null;
  ShortText:         string | null;
  Description:       string | null;
  Category:          string | null;   // 'Integration' | 'Content' | …
  Vendor:            string | null;
  OrgName:           string | null;
  BusinessProcess:   string | null;
  Products:          string | null;
  SupportedPlatforms: string | null;
  CertifiedBySap:    string | null;
  PartnerContent:    string | null;
  Version:           string | null;
}

interface CatalogFixture {
  _metadata: { fetchedAt: string; apiCount: number; packageCount: number };
  apis:      RawApiEntry[];
  packages:  RawPackageEntry[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export class SapApiHubCatalogFetcher implements IFetcher {

  public readonly id:    SourceId = 'SAP_API_HUB_CATALOG';
  public readonly label: string   = 'SAP API Hub — OData catalog API (APIs + ContentPackages)';

  private readonly BASE = 'https://api.sap.com/odata/1.0/catalog.svc';

  constructor(private readonly opts: SapApiHubCatalogFetcherOptions) {}

  public async fetch(): Promise<IngestDocument[]> {
    return this.opts.live ? this.fetchLive() : this.fetchFromFixture();
  }

  // -------------------------------------------------------------------
  // Fixture replay
  // -------------------------------------------------------------------

  private fetchFromFixture(): IngestDocument[] {
    const fp = this.opts.fixturePath ?? defaultFixturePath();
    if (!fs.existsSync(fp)) return [];
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as CatalogFixture;
    const fetchedAt = new Date().toISOString();
    return [
      ...raw.apis.map(e => this.apiToDocument(e, fetchedAt)),
      ...raw.packages.map(e => this.packageToDocument(e, fetchedAt))
    ];
  }

  // -------------------------------------------------------------------
  // Live paging
  // -------------------------------------------------------------------

  private async fetchLive(): Promise<IngestDocument[]> {
    const sets      = this.opts.entitySets ?? ['APIs', 'ContentPackages'];
    const pageSize  = this.opts.pageSize  ?? 100;
    const delayMs   = this.opts.delayMs   ?? 150;
    const maxRecs   = this.opts.maxRecords ?? 0;
    const verbose   = this.opts.verbose   ?? false;
    const fetchedAt = new Date().toISOString();

    const apis:     RawApiEntry[]     = [];
    const packages: RawPackageEntry[] = [];

    if (sets.includes('APIs')) {
      await this.pageAll<RawApiEntry>(
        'APIContent.APIs',
        pageSize, delayMs, maxRecs, verbose,
        rec => apis.push(rec)
      );
    }

    if (sets.includes('ContentPackages')) {
      await this.pageAll<RawPackageEntry>(
        'ContentPackages',
        pageSize, delayMs, maxRecs, verbose,
        rec => packages.push(rec)
      );
    }

    // Persist fixture for offline replay
    const fixture: CatalogFixture = {
      _metadata: { fetchedAt, apiCount: apis.length, packageCount: packages.length },
      apis,
      packages
    };
    const fp = this.opts.fixturePath ?? defaultFixturePath();
    fs.writeFileSync(fp, JSON.stringify(fixture, null, 2), 'utf-8');

    if (verbose) {
      process.stderr.write(
        `[CatalogFetcher] Done — ${apis.length} APIs, ${packages.length} packages → ${fp}\n`
      );
    }

    return [
      ...apis.map(e => this.apiToDocument(e, fetchedAt)),
      ...packages.map(e => this.packageToDocument(e, fetchedAt))
    ];
  }

  // -------------------------------------------------------------------
  // Generic OData v2 pager
  // -------------------------------------------------------------------

  private async pageAll<T>(
    entitySet: string,
    pageSize:  number,
    delayMs:   number,
    maxRecs:   number,
    verbose:   boolean,
    onRecord:  (rec: T) => void
  ): Promise<void> {
    let skip  = 0;
    let total = -1;

    while (true) {
      const url =
        `${this.BASE}/${entitySet}` +
        `?$top=${pageSize}&$skip=${skip}&$inlinecount=allpages&$format=json`;

      const res = await fetch(url, {
        headers: { APIKey: this.opts.apiKey, Accept: 'application/json' }
      });

      if (!res.ok) {
        process.stderr.write(
          `[CatalogFetcher] ${entitySet} page (skip=${skip}) HTTP ${res.status} — stopping.\n`
        );
        break;
      }

      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) {
        process.stderr.write(
          `[CatalogFetcher] ${entitySet} page (skip=${skip}) returned non-JSON (auth redirect?) — stopping.\n`
        );
        break;
      }

      const json = await res.json() as { d: { __count?: string; results: T[] } };
      const results = json.d?.results ?? [];

      if (total === -1 && json.d?.__count) {
        total = parseInt(json.d.__count, 10);
        if (verbose) process.stderr.write(`[CatalogFetcher] ${entitySet}: ${total} total records.\n`);
      }

      for (const rec of results) onRecord(rec);

      skip += results.length;

      if (verbose && skip % 500 === 0) {
        process.stderr.write(`[CatalogFetcher] ${entitySet}: ${skip}/${total ?? '?'} fetched…\n`);
      }

      if (results.length < pageSize) break;              // last page
      if (maxRecs > 0 && skip >= maxRecs) break;         // cap reached

      if (delayMs > 0) await sleep(delayMs);
    }
  }

  // -------------------------------------------------------------------
  // Document shaping — APIs
  // -------------------------------------------------------------------

  private apiToDocument(e: RawApiEntry, fetchedAt: string): IngestDocument {
    const name = e.Name || e.ID;
    const lines: string[] = [
      `Service: ${name}`,
      e.ServiceCode  ? `Protocol: ${e.ServiceCode}` : null,
      e.State        ? `State: ${e.State}` : null,
      e.Deprecated   ? `Deprecated: true` : null,
      e.Version      ? `Version: ${e.Version}` : null,
      e.ParentTechnicalName ? `Package: ${e.ParentTechnicalName}` : null,
      e.BusinessObjects ? `Business Objects: ${e.BusinessObjects}` : null,
      e.Successors   ? `Successors: ${e.Successors}` : null,
      '',
      e.Title        ? e.Title : null,
      e.ShortText    ? e.ShortText : null,
      e.Description  ? stripHtml(e.Description) : null
    ].filter((l): l is string => l !== null);

    return {
      id:             `sap-api-hub-catalog/api/${name}`,
      source:         this.id,
      sourceUrl:      `https://api.sap.com/api/${name}/overview`,
      objectName:     name,
      objectType:     'API_ARTIFACT',
      module:         null,
      cleanCoreLevel: 'A',
      title:          e.Title || name,
      body:           lines.join('\n'),
      metadata: {
        serviceCode:  e.ServiceCode ?? '',
        state:        e.State ?? '',
        deprecated:   e.Deprecated ?? false,
        version:      e.Version ?? '',
        successors:   e.Successors ?? '',
      },
      fetchedAt
    };
  }

  // -------------------------------------------------------------------
  // Document shaping — ContentPackages
  // -------------------------------------------------------------------

  private packageToDocument(e: RawPackageEntry, fetchedAt: string): IngestDocument {
    const name = e.TechnicalName;
    const lines: string[] = [
      `Package: ${name}`,
      e.Category          ? `Category: ${e.Category}` : null,
      e.Vendor            ? `Vendor: ${e.Vendor}` : null,
      e.SupportedPlatforms ? `Platforms: ${e.SupportedPlatforms}` : null,
      e.Products          ? `Products: ${e.Products}` : null,
      e.BusinessProcess   ? `Business Process: ${e.BusinessProcess}` : null,
      e.CertifiedBySap === 'true' ? 'SAP Certified: true' : null,
      '',
      e.DisplayName       ? e.DisplayName : null,
      e.ShortText         ? e.ShortText : null,
      e.Description       ? stripHtml(e.Description) : null
    ].filter((l): l is string => l !== null);

    return {
      id:             `sap-api-hub-catalog/package/${name}`,
      source:         this.id,
      sourceUrl:      `https://api.sap.com/package/${name}`,
      objectName:     name,
      objectType:     'API_ARTIFACT',
      module:         null,
      cleanCoreLevel: 'A',
      title:          e.DisplayName || name,
      body:           lines.join('\n'),
      metadata: {
        category:       e.Category ?? '',
        vendor:         e.Vendor ?? '',
        certifiedBySap: e.CertifiedBySap === 'true',
        partnerContent: e.PartnerContent === 'true',
      },
      fetchedAt
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFixturePath(): string {
  return path.resolve(__dirname, '..', '..', 'fixtures', 'api-hub-catalog.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Strip HTML tags from description strings. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
