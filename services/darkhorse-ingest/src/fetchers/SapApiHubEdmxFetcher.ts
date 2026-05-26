/**
 * SapApiHubEdmxFetcher — bulk field-metadata fetcher via api.sap.com EDMX.
 *
 * The user's pain point: a per-CDS-view scraper against help.sap.com requires
 * manual URL collection (no clean view-name → URL mapping). EDMX bypasses that
 * entirely.
 *
 * Each released SAP OData service publishes a $metadata XML document
 * (Entity Data Model XML, "EDMX") containing the field schemas of every
 * entity it exposes — CDS views included. ~500 services × ~10-30 entities
 * each ≈ 7K+ entity schemas in a single bulk download, versus 7K+ separate
 * help-portal page scrapes.
 *
 * The fetcher is the inverse of HelpPortalFetcher:
 *   HelpPortalFetcher:  one help page  -> one CDS view's fields
 *   SapApiHubEdmxFetcher: one EDMX file -> many CDS views' fields
 *
 * Pipeline:
 *   1. List services from api.sap.com OData catalog (paged).
 *   2. For each service, download its EDMX via one of several known URL
 *      patterns (the catalog provides the canonical link but we keep
 *      fallbacks in case the schema changes).
 *   3. Parse the EDMX to extract EntityType blocks → field arrays.
 *   4. Emit one IngestDocument per entity, keyed by its TypeName so the
 *      CdsFieldCatalogProvider can index it.
 *
 * EDMX parsing strategy:
 *   We use regex extraction rather than a full XML parser. CSDL (the schema
 *   inside EDMX) has a predictable structure — EntityType blocks are
 *   well-delimited and their Property children are flat (no nested tags
 *   that confuse regex matching). Trade-off: simpler dependency footprint
 *   (no @xmldom/xmldom, no fast-xml-parser) at the cost of accepting a
 *   small set of CSDL edge cases (function imports, complex types) being
 *   skipped. For field-grounding purposes, EntityType + Property is the
 *   only thing the grounder cares about.
 *
 * Live mode requires network. Set DARKHORSE_API_HUB_EDMX_LIVE=true. Fixture
 * mode (default) emits zero documents — the result of a live run is
 * persisted to fixtures/api-sap-hub-edmx.snapshot.json and consumed by the
 * MCP CdsFieldCatalogProvider on next restart.
 *
 * No authentication: api.sap.com's public-facing OData catalog is
 * unauthenticated. Authenticated sandbox testing of individual APIs is a
 * separate concern (S-user creds) and isn't required for metadata
 * download.
 */

'use strict';

import fs   = require('fs');
import path = require('path');

import {
  IFetcher,
  IngestDocument,
  SourceId
} from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Field metadata for a single EntityType property. Matches
 *  HelpPortalFetcher.CdsFieldSchema so both fetchers feed the same
 *  CdsFieldCatalogProvider without translation. */
export interface EdmxFieldSchema {
  name:           string;
  type:           string | null;     // Edm.String / Edm.Int32 / ...
  length:         string | null;     // MaxLength when present
  isKey:          boolean;
  association:    string | null;     // NavigationProperty Relationship target (best-effort)
  description:    string;            // sap:label / sap:quickinfo annotation
}

export interface EdmxEntityExtract {
  viewName:       string;            // EntityType Name (e.g. 'I_OutboundDeliveryType')
  serviceName:    string;            // owning service (e.g. 'API_SALES_ORDER_SRV')
  serviceUrl:     string;            // service descriptor URL we fetched from
  edmxUrl:        string;            // $metadata URL we downloaded
  fields:         EdmxFieldSchema[];
  entityCount:    number;            // total entities in the same EDMX (debug)
}

export interface SapApiHubEdmxFetcherOptions {
  live?:           boolean;

  /** Base URL of the OData catalog. Defaults to the public one. */
  catalogBaseUrl?: string;

  /** Comma-separated service-name filter — only fetch EDMX for these services.
   *  Useful for incremental runs / debugging. When unset, fetches every
   *  service the catalog returns. */
  serviceFilter?:  string[];

  /** Per-EDMX timeout in ms. Default 20s. */
  pageTimeoutMs?:  number;

  /** Milliseconds between EDMX downloads to be polite to api.sap.com.
   *  Default 500ms. */
  rateLimitMs?:    number;

  /** Maximum number of services to fetch in one run. 0 = unlimited.
   *  Useful for incremental ingests. Default 0. */
  maxServices?:    number;

  /** Optional checkpoint file path. JSON-lines progress log so interrupted
   *  runs can resume by skipping services already in the file. */
  checkpointPath?: string;

  /** Override fixture path for tests / replay. */
  fixturePath?:    string;

  verbose?:        boolean;
}

// ---------------------------------------------------------------------------
// Fixture file shape — output of a live run, input to fixture-mode reruns.
// ---------------------------------------------------------------------------

interface EdmxSnapshotEntry {
  viewName:    string;
  serviceName: string;
  serviceUrl:  string;
  edmxUrl:     string;
  fields:      EdmxFieldSchema[];
  fetchedAt:   string;
}

interface EdmxSnapshotFile {
  _metadata: {
    sourceVersion:  string;
    fetchedAt:      string;
    catalogBaseUrl: string;
    serviceCount:   number;
    entityCount:    number;
    notes:          string;
  };
  entries: EdmxSnapshotEntry[];
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

const DEFAULT_CATALOG_BASE = 'https://api.sap.com/odata/1.0/catalog.svc';

export class SapApiHubEdmxFetcher implements IFetcher {

  public readonly id:    SourceId = 'SAP_API_HUB';
  public readonly label: string   = 'SAP API Hub — EDMX bulk metadata';

  constructor(private readonly options: SapApiHubEdmxFetcherOptions = {}) {}

  public async fetch(): Promise<IngestDocument[]> {
    return this.options.live
      ? this.fetchLive()
      : this.fetchFromFixture();
  }

  // -------------------------------------------------------------------
  // Fixture path
  // -------------------------------------------------------------------

  private fetchFromFixture(): IngestDocument[] {
    const defaultFixture = path.resolve(
      __dirname, '..', '..', 'fixtures', 'api-sap-hub-edmx.snapshot.json'
    );
    const fixturePath = this.options.fixturePath ?? defaultFixture;

    if (!fs.existsSync(fixturePath)) {
      // Pre-first-run state — empty result, not an error.
      return [];
    }

    const raw  = fs.readFileSync(fixturePath, 'utf-8');
    const snap = JSON.parse(raw) as EdmxSnapshotFile;

    return snap.entries.map(entry => this.snapshotEntryToDocument(entry));
  }

  // -------------------------------------------------------------------
  // Live path — discovery + bulk download + parse
  // -------------------------------------------------------------------

  private async fetchLive(): Promise<IngestDocument[]> {
    const catalogBase = (this.options.catalogBaseUrl ?? DEFAULT_CATALOG_BASE).replace(/\/+$/, '');
    const timeoutMs   = this.options.pageTimeoutMs ?? 20_000;
    const rateLimitMs = this.options.rateLimitMs ?? 500;
    const verbose     = this.options.verbose ?? false;
    const maxServices = this.options.maxServices ?? 0;

    // 1. Discover services. The OData catalog at api.sap.com publishes an
    //    APIs entity set containing released APIs. We page through it with
    //    $top/$skip so we don't hit a single huge response.
    if (verbose) process.stderr.write(`[EdmxFetcher] Discovering services from ${catalogBase}\n`);
    const services = await this.listServices(catalogBase, timeoutMs, verbose);

    let queue = services.filter(s => isOdataServiceLikely(s));
    if (this.options.serviceFilter && this.options.serviceFilter.length > 0) {
      const allow = new Set(this.options.serviceFilter.map(n => n.trim().toUpperCase()));
      queue = queue.filter(s => allow.has(s.name.trim().toUpperCase()));
    }
    if (maxServices > 0 && queue.length > maxServices) {
      queue = queue.slice(0, maxServices);
    }

    if (verbose) {
      process.stderr.write(
        `[EdmxFetcher] ${services.length} services in catalog, ${queue.length} after OData/filter prune\n`
      );
    }

    // 2. For each service, download EDMX, parse entities.
    const docs: IngestDocument[] = [];
    const allEntries: EdmxSnapshotEntry[] = [];

    const seenChkpt = loadCheckpointSeen(this.options.checkpointPath);
    const checkpointFd = this.options.checkpointPath
      ? fs.openSync(this.options.checkpointPath, 'a')
      : null;

    const fetchedAt = new Date().toISOString();

    try {
      let idx = 0;
      for (const service of queue) {
        idx += 1;
        if (seenChkpt.has(service.name)) {
          if (verbose) process.stderr.write(`[EdmxFetcher] (${idx}/${queue.length}) ${service.name} — skipped (checkpointed)\n`);
          continue;
        }

        if (verbose) process.stderr.write(`[EdmxFetcher] (${idx}/${queue.length}) ${service.name}\n`);

        try {
          const edmxText = await this.downloadEdmx(service, timeoutMs);
          const entities = parseEdmx(edmxText);

          for (const ent of entities) {
            const entry: EdmxSnapshotEntry = {
              viewName:    ent.name,
              serviceName: service.name,
              serviceUrl:  service.detailUrl,
              edmxUrl:     service.edmxUrl ?? '',
              fields:      ent.fields,
              fetchedAt
            };
            allEntries.push(entry);
            docs.push(this.snapshotEntryToDocument(entry));
          }

          if (checkpointFd != null) {
            fs.writeSync(
              checkpointFd,
              JSON.stringify({
                serviceName: service.name,
                entityCount: entities.length,
                fetchedAt:   new Date().toISOString()
              }) + '\n'
            );
          }
        } catch (err: any) {
          if (verbose) process.stderr.write(`[EdmxFetcher] FAILED ${service.name}: ${err?.message ?? err}\n`);
          // Per-service failure is non-fatal — keep going.
        }

        if (rateLimitMs > 0 && idx < queue.length) {
          await sleep(rateLimitMs);
        }
      }
    } finally {
      if (checkpointFd != null) fs.closeSync(checkpointFd);
    }

    // 3. Persist the snapshot so the CdsFieldCatalogProvider can read it.
    const snapshotPath = path.resolve(
      __dirname, '..', '..', 'fixtures', 'api-sap-hub-edmx.snapshot.json'
    );
    const snap: EdmxSnapshotFile = {
      _metadata: {
        sourceVersion:  'sap-api-hub-edmx-v1',
        fetchedAt,
        catalogBaseUrl: catalogBase,
        serviceCount:   queue.length,
        entityCount:    allEntries.length,
        notes:          'Auto-generated by SapApiHubEdmxFetcher live run. Re-run to refresh.'
      },
      entries: allEntries
    };
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(snap, null, 2));

    if (verbose) {
      process.stderr.write(
        `[EdmxFetcher] Wrote ${allEntries.length} entities across ${queue.length} services -> ${snapshotPath}\n`
      );
    }

    return docs;
  }

  // -------------------------------------------------------------------
  // Catalog discovery — list services from the OData catalog with paging.
  //
  // The schema of api.sap.com's OData catalog is documented at
  // $metadata; we treat the response defensively because property names
  // have changed historically (Title vs Name, Path vs DetailURL, etc.).
  // -------------------------------------------------------------------

  private async listServices(
    catalogBase: string,
    timeoutMs: number,
    verbose: boolean
  ): Promise<ServiceRef[]> {
    const pageSize = 200;
    const out: ServiceRef[] = [];

    for (let skip = 0; ; skip += pageSize) {
      const url = `${catalogBase}/APIs?$top=${pageSize}&$skip=${skip}&$format=json`;
      const page = await fetchJsonWithTimeout(url, timeoutMs);

      // OData v1 typically nests under d.results. Accept either shape.
      const arr: any[] =
        Array.isArray(page?.d?.results) ? page.d.results :
        Array.isArray(page?.value)      ? page.value :
        Array.isArray(page)             ? page :
        [];

      if (arr.length === 0) break;

      for (const row of arr) {
        const name  = (row?.Name ?? row?.Title ?? row?.ID ?? '').toString().trim();
        const detailUrl = (row?.DetailURL ?? row?.url ?? '').toString();
        // The EDMX url may be a sibling property OR a path off the service.
        // Try both shapes — defensive.
        const edmxCandidate =
          (row?.EDMXLink as string | undefined) ??
          (row?.Specifications?.find?.((s: any) => /edmx/i.test(s?.Type ?? ''))?.URL as string | undefined);
        if (!name) continue;
        out.push({
          name,
          detailUrl,
          contentType: (row?.ContentType ?? '').toString(),
          edmxUrl: edmxCandidate
        });
      }

      if (verbose) process.stderr.write(`[EdmxFetcher] catalog page +${arr.length} (total ${out.length})\n`);
      if (arr.length < pageSize) break;
    }
    return out;
  }

  // -------------------------------------------------------------------
  // EDMX download — try the catalog-supplied URL first, then known
  // fallback patterns. Returns the raw XML text.
  // -------------------------------------------------------------------

  private async downloadEdmx(service: ServiceRef, timeoutMs: number): Promise<string> {
    const candidates: string[] = [];
    if (service.edmxUrl) candidates.push(service.edmxUrl);
    // Conventional pattern: /api/<NAME>/$metadata
    candidates.push(`https://api.sap.com/api/${encodeURIComponent(service.name)}/$metadata`);
    // Alternative path observed historically:
    candidates.push(`https://api.sap.com/api/${encodeURIComponent(service.name)}/odata/spec`);

    let lastErr: Error | null = null;
    for (const url of candidates) {
      try {
        const text = await fetchTextWithTimeout(url, timeoutMs);
        if (looksLikeEdmx(text)) return text;
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastErr ?? new Error(`EDMX not found for service ${service.name}`);
  }

  // -------------------------------------------------------------------
  // Document shaping
  // -------------------------------------------------------------------

  private snapshotEntryToDocument(entry: EdmxSnapshotEntry): IngestDocument {
    const id = `sap-api-hub-edmx/entity/${entry.viewName}`;

    const head = [
      `EntityType: ${entry.viewName}`,
      `Owning service: ${entry.serviceName}`,
      `EDMX: ${entry.edmxUrl}`,
      ``
    ].join('\n');

    const tableLines: string[] = [
      `Fields (${entry.fields.length} total):`,
      `| Name | Type | Key | Description |`,
      `| --- | --- | --- | --- |`
    ];
    for (const f of entry.fields) {
      const type = [f.type, f.length].filter(Boolean).join(' ').trim() || '—';
      const key  = f.isKey ? 'KEY' : '';
      const desc = (f.description || '').replace(/\|/g, '/').slice(0, 120);
      tableLines.push(`| ${f.name} | ${type} | ${key} | ${desc} |`);
    }

    return {
      id,
      source:         this.id,
      sourceUrl:      entry.edmxUrl,
      objectName:     entry.viewName,
      objectType:     'CDS',
      module:         null,
      cleanCoreLevel: 'A',
      title:          `${entry.viewName} (${entry.serviceName})`,
      body:           head + tableLines.join('\n'),
      metadata: {
        fieldCount:    entry.fields.length,
        fieldsJson:    JSON.stringify(entry.fields),
        hasFields:     entry.fields.length > 0,
        serviceName:   entry.serviceName
      },
      fetchedAt: entry.fetchedAt
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ServiceRef {
  name:        string;
  detailUrl:   string;
  contentType: string;
  edmxUrl?:    string;
}

// ---------------------------------------------------------------------------
// EDMX parser — regex-based extraction of EntityType + Property nodes.
// Intentionally permissive: tolerates namespace prefixes and ignores
// FunctionImport / ComplexType / Action since the grounder doesn't need them.
// ---------------------------------------------------------------------------

interface ParsedEntity {
  name:   string;
  fields: EdmxFieldSchema[];
}

export function parseEdmx(xml: string): ParsedEntity[] {
  if (!xml || typeof xml !== 'string') return [];

  // Match <EntityType ...>...</EntityType> blocks. The optional namespace
  // prefix (e.g. <edm:EntityType>) is captured with `(?:[a-zA-Z0-9_-]+:)?`.
  const entityRx = /<(?:[a-zA-Z0-9_-]+:)?EntityType\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?EntityType>/g;

  const entities: ParsedEntity[] = [];
  let m: RegExpExecArray | null;
  while ((m = entityRx.exec(xml)) !== null) {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const name  = attrFrom(attrs, 'Name');
    if (!name) continue;

    // Collect Key/PropertyRef names first so each Property knows whether it is a key.
    const keyNames = new Set<string>();
    const keyBlockRx = /<(?:[a-zA-Z0-9_-]+:)?Key\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Key>/g;
    let km: RegExpExecArray | null;
    while ((km = keyBlockRx.exec(inner)) !== null) {
      const keyInner = km[1] ?? '';
      const refRx = /<(?:[a-zA-Z0-9_-]+:)?PropertyRef\b([^/>]*)\/?>/g;
      let rm: RegExpExecArray | null;
      while ((rm = refRx.exec(keyInner)) !== null) {
        const n = attrFrom(rm[1] ?? '', 'Name');
        if (n) keyNames.add(n);
      }
    }

    // Each Property is a self-closing or paired tag.
    const fields: EdmxFieldSchema[] = [];
    const propRx = /<(?:[a-zA-Z0-9_-]+:)?Property\b([^>/]*)(?:\/>|>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?Property>)/g;
    let pm: RegExpExecArray | null;
    while ((pm = propRx.exec(inner)) !== null) {
      const propAttrs = pm[1] ?? '';
      const propName  = attrFrom(propAttrs, 'Name');
      if (!propName) continue;
      fields.push({
        name:        propName,
        type:        attrFrom(propAttrs, 'Type'),
        length:      attrFrom(propAttrs, 'MaxLength'),
        isKey:       keyNames.has(propName),
        association: null,
        description: attrFrom(propAttrs, 'sap:label') || attrFrom(propAttrs, 'sap:quickinfo') || ''
      });
    }

    // NavigationProperty — capture target relationship as `association`.
    const navRx = /<(?:[a-zA-Z0-9_-]+:)?NavigationProperty\b([^>/]*)\/?>/g;
    let nm: RegExpExecArray | null;
    while ((nm = navRx.exec(inner)) !== null) {
      const a = nm[1] ?? '';
      const navName  = attrFrom(a, 'Name');
      const rel      = attrFrom(a, 'Relationship') || attrFrom(a, 'ToRole');
      if (!navName || !rel) continue;
      fields.push({
        name:        navName,
        type:        'Association',
        length:      null,
        isKey:       false,
        association: rel,
        description: ''
      });
    }

    entities.push({ name, fields });
  }
  return entities;
}

function attrFrom(attrStr: string, attrName: string): string | null {
  // Escape the attribute name for regex (colon, slash) in case of sap:label etc.
  const esc = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${esc}\\s*=\\s*"([^"]*)"`);
  const m  = attrStr.match(rx);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// HTTP helpers — Node 20+ native fetch with absolute timeout
// ---------------------------------------------------------------------------

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const text = await fetchTextWithTimeout(url, timeoutMs, { Accept: 'application/json' });
  return JSON.parse(text);
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'DarkHorse-Ingest/1.0', ...extraHeaders }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeEdmx(text: string): boolean {
  return /<\s*[a-zA-Z0-9_-]*:?(edmx:)?Edmx\b/i.test(text) ||
         /<\s*Schema\b[^>]*\bNamespace=/i.test(text);
}

function isOdataServiceLikely(s: ServiceRef): boolean {
  // ContentType heuristic — only services that publish OData have EDMX worth
  // pulling. Unknown / empty contentType is allowed (catalogs occasionally
  // omit it); we'd rather attempt and fail than skip.
  if (!s.contentType) return true;
  return /odata/i.test(s.contentType);
}

function loadCheckpointSeen(checkpointPath: string | undefined): Set<string> {
  const seen = new Set<string>();
  if (!checkpointPath || !fs.existsSync(checkpointPath)) return seen;
  const text = fs.readFileSync(checkpointPath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.serviceName) seen.add(obj.serviceName);
    } catch {
      /* skip malformed line */
    }
  }
  return seen;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
