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

  /** Override the curated service-name list. Each entry is a service name
   *  like 'API_SALES_ORDER_SRV' — the fetcher tries
   *  https://api.sap.com/api/<name>/$metadata for each. Defaults to a
   *  hand-curated SD/MM/FI/PP set (DEFAULT_SERVICE_NAMES). */
  serviceNames?:   string[];

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

  /** Authentication. api.sap.com gates EDMX downloads behind a login wall —
   *  anonymous requests get back the SPA landing page (HTML), not XML.
   *  Provide ONE of:
   *    - apiKey      → adds `APIKey: <key>` header (api.sap.com personal API key)
   *    - bearerToken → adds `Authorization: Bearer <token>` (OAuth2)
   *    - cookie      → adds `Cookie: <verbatim cookie string>` (session-based)
   *  When more than one is set, all are sent. */
  apiKey?:         string;
  bearerToken?:    string;
  cookie?:         string;

  /** Diagnostic mode: fetch the first service only, print full headers and
   *  the first 500 chars of the body, then exit. Used to iterate on auth
   *  config without scraping 500 services blind. */
  diagnose?:       boolean;

  verbose?:        boolean;
}

/**
 * Curated starter list of well-known released S/4HANA Cloud OData services.
 * Covers SD / MM / FI / PP / Master Data / BP — the modules our test pipelines
 * exercise. Override via options.serviceNames or
 * DARKHORSE_API_HUB_EDMX_SERVICES env var. Each name maps to a documented
 * api.sap.com package and its $metadata URL.
 */
export const DEFAULT_SERVICE_NAMES: string[] = [
  // Sales — OTC
  'API_SALES_ORDER_SRV',
  'API_SALES_ORDER_SIMULATION_SRV',
  'API_BILLING_DOCUMENT_SRV',
  'API_SALES_QUOTATION_SRV',
  'API_SALES_CONTRACT_SRV',
  // Logistics — outbound delivery
  'API_OUTBOUND_DELIVERY_SRV',
  'API_OUTBOUND_DELIVERY_V2_SRV',
  // Purchasing — PTP
  'API_PURCHASEORDER_PROCESS_SRV',
  'API_PURCHASEREQ_PROCESS_SRV',
  'API_PURCHASECONTRACT_PROCESS_SRV',
  'API_SUPPLIERINVOICE_PROCESS_SRV',
  // Inventory + material movement
  'API_MATERIAL_DOCUMENT_SRV',
  'API_PHYSICAL_INVENTORY_DOC_SRV',
  // Master data
  'API_PRODUCT_SRV',
  'API_BUSINESS_PARTNER',
  'API_CUSTOMER_MATERIAL_SRV',
  // Finance — FI
  'API_JOURNALENTRYITEMBASIC_SRV',
  'API_OPLACCTGDOCITEMCUBE_SRV',
  'API_ACCOUNTINGDOCUMENT_SRV',
  // Production planning
  'API_PRODUCTION_ORDER_SRV',
  'API_PROCESS_ORDER_SRV',
  // Supplier & sourcing
  'API_SUPPLIERQUOTATION_PROCESS_SRV',
  // Pricing
  'API_SLSPRCGCNDNRECD_SRV',
  // Plant & operations
  'API_PLANT_SRV'
];

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
    const timeoutMs   = this.options.pageTimeoutMs ?? 20_000;
    const rateLimitMs = this.options.rateLimitMs ?? 500;
    const verbose     = this.options.verbose ?? false;
    const maxServices = this.options.maxServices ?? 0;
    const diagnose    = this.options.diagnose ?? false;

    const authHeaders = this.buildAuthHeaders();
    if (verbose) {
      const used = Object.keys(authHeaders);
      process.stderr.write(
        used.length === 0
          ? `[EdmxFetcher] WARNING: no auth headers configured. api.sap.com gates EDMX behind login — expect HTML responses.\n`
          : `[EdmxFetcher] Auth headers: ${used.join(', ')}\n`
      );
    }

    // Service list. api.sap.com's OData catalog endpoint (.../catalog.svc/APIs)
    // returns SPA HTML rather than queryable data, so we don't try to discover
    // services from it. Instead, walk a curated list (override via env or
    // options) and hit each service's /$metadata directly.
    let queue = (this.options.serviceNames && this.options.serviceNames.length > 0
      ? this.options.serviceNames
      : DEFAULT_SERVICE_NAMES).slice();

    if (maxServices > 0 && queue.length > maxServices) queue = queue.slice(0, maxServices);
    if (diagnose) queue = queue.slice(0, 1);

    if (verbose) {
      process.stderr.write(
        `[EdmxFetcher] ${queue.length} service${queue.length === 1 ? '' : 's'} in queue` +
        (diagnose ? ' (diagnose mode — first service only)\n' : '\n')
      );
    }

    const docs: IngestDocument[] = [];
    const allEntries: EdmxSnapshotEntry[] = [];

    const seenChkpt = loadCheckpointSeen(this.options.checkpointPath);
    const checkpointFd = this.options.checkpointPath
      ? fs.openSync(this.options.checkpointPath, 'a')
      : null;

    const fetchedAt = new Date().toISOString();

    try {
      let idx = 0;
      for (const serviceName of queue) {
        idx += 1;
        if (seenChkpt.has(serviceName)) {
          if (verbose) process.stderr.write(`[EdmxFetcher] (${idx}/${queue.length}) ${serviceName} — skipped (checkpointed)\n`);
          continue;
        }

        const edmxUrl = `https://api.sap.com/odata/1.0/catalog.svc/APIContent.APIs('${encodeURIComponent(serviceName)}')/$value?type=EDMX&attachment=true`;
        if (verbose) process.stderr.write(`[EdmxFetcher] (${idx}/${queue.length}) ${serviceName} ← ${edmxUrl}\n`);

        try {
          const fetchRes = await fetchWithDiagnostics(edmxUrl, timeoutMs, authHeaders);

          if (diagnose) {
            process.stderr.write(`[EdmxFetcher] diagnose — HTTP ${fetchRes.status} ${fetchRes.statusText}\n`);
            process.stderr.write(`[EdmxFetcher] diagnose — content-type: ${fetchRes.contentType ?? '(none)'}\n`);
            process.stderr.write(`[EdmxFetcher] diagnose — body[0..500]:\n${fetchRes.text.slice(0, 500)}\n---\n`);
          }

          if (!looksLikeEdmx(fetchRes.text)) {
            const reason = fetchRes.text.slice(0, 120).replace(/\s+/g, ' ');
            throw new Error(`Response is not EDMX XML (got ${fetchRes.contentType ?? 'unknown content-type'}): ${reason}`);
          }

          const entities = parseEdmx(fetchRes.text);
          for (const ent of entities) {
            const entry: EdmxSnapshotEntry = {
              viewName:    ent.name,
              serviceName,
              serviceUrl:  `https://api.sap.com/api/${serviceName}`,
              edmxUrl,
              fields:      ent.fields,
              fetchedAt
            };
            allEntries.push(entry);
            docs.push(this.snapshotEntryToDocument(entry));
          }

          if (verbose) process.stderr.write(`[EdmxFetcher]     parsed ${entities.length} entity types\n`);

          if (checkpointFd != null) {
            fs.writeSync(
              checkpointFd,
              JSON.stringify({
                serviceName,
                entityCount: entities.length,
                fetchedAt:   new Date().toISOString()
              }) + '\n'
            );
          }
        } catch (err: any) {
          if (verbose) process.stderr.write(`[EdmxFetcher] FAILED ${serviceName}: ${err?.message ?? err}\n`);
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
        sourceVersion:  'sap-api-hub-edmx-v2-direct',
        fetchedAt,
        catalogBaseUrl: 'https://api.sap.com/odata/1.0/catalog.svc/APIContent.APIs',
        serviceCount:   queue.length,
        entityCount:    allEntries.length,
        notes:          'Auto-generated by SapApiHubEdmxFetcher (direct /$metadata mode). Re-run to refresh.'
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
  // Auth header builder
  //
  // api.sap.com gates EDMX behind login. We support three concurrent
  // mechanisms so users with different account types can pick whichever
  // their org supports:
  //   - APIKey header (api.sap.com personal API key — simplest)
  //   - Authorization: Bearer <token> (OAuth2)
  //   - Cookie: <verbatim> (session-based, extracted from browser)
  // -------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.options.apiKey)      headers['APIKey']        = this.options.apiKey;
    if (this.options.bearerToken) headers['Authorization'] = `Bearer ${this.options.bearerToken}`;
    if (this.options.cookie)      headers['Cookie']        = this.options.cookie;
    return headers;
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

interface FetchDiagnostic {
  status:      number;
  statusText:  string;
  contentType: string | null;
  text:        string;
}

async function fetchWithDiagnostics(
  url: string,
  timeoutMs: number,
  authHeaders: Record<string, string>
): Promise<FetchDiagnostic> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'DarkHorse-Ingest/1.0',
        'Accept':     'application/xml, application/atom+xml, */*',
        ...authHeaders
      }
    });
    const text = await res.text();
    return {
      status:      res.status,
      statusText:  res.statusText,
      contentType: res.headers.get('content-type'),
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeEdmx(text: string): boolean {
  return /<\s*[a-zA-Z0-9_-]*:?(edmx:)?Edmx\b/i.test(text) ||
         /<\s*Schema\b[^>]*\bNamespace=/i.test(text);
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
