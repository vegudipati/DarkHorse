/**
 * SapApiHubSearchFetcher — scrapes the SAP API Business Hub search pages
 * (api.sap.com/search?tab=...) using headless Chrome to discover ALL
 * published API artifacts: OData APIs, CDS Views, Integration Flows,
 * Events, Build artifacts, Analytics, Data Products.
 *
 * Why puppeteer (not plain HTTP):
 *   api.sap.com is an Angular SPA. The search results are rendered
 *   client-side via infinite scroll — plain HTTP only gets the empty shell.
 *
 * Extraction strategy:
 *   Rather than targeting CSS classes (which SAP rotates frequently), we
 *   harvest every <a href> whose path matches /api/<NAME>/ or
 *   /package/<PKG>/artifact/<ARTIFACT>. The service/artifact name is always
 *   encoded in the URL, making this robust across UI redesigns.
 *
 * Outputs:
 *   1. IngestDocument[] — one document per discovered artifact with title,
 *      description, type, and package. Feeds the vector index for semantic
 *      search ("which integration package handles vendor invoice posting?").
 *   2. fixtures/api-hub-search-discovery.json — structured catalog of ALL
 *      discovered items by category. The EdmxFetcher reads the "APIs" section
 *      to get a comprehensive OData service-name list.
 */

'use strict';

import fs   = require('fs');
import path = require('path');

import { IFetcher, IngestDocument, SourceId } from '../types';
import { discoverBrowser }                    from './BrowserDiscovery';

declare const document: any;
declare const window:   any;

// ---------------------------------------------------------------------------
// The nine search tabs the user provided
// ---------------------------------------------------------------------------

export const DEFAULT_SEARCH_URLS: Record<string, string> = {
  'APIs':               'https://api.sap.com/search?searchterm=&tab=APIs&$type=(%22API%22,%22API%20Package%22)',
  'CDS Views':          'https://api.sap.com/search?searchterm=&tab=CDS%20Views&$type=(%22CDS%20Package%22,%22CDS%20View%22)',
  'Integrations':       'https://api.sap.com/search?searchterm=&tab=Integrations&$type=(%22Integration%20Flow%22,%22Integration%20Package%22,%22Value%20Mapping%22)',
  'Events':             'https://api.sap.com/search?searchterm=&tab=Events&$type=(%22Event%20Object%22,%22SAP%20Event%20Package%22)',
  'VPUC':               'https://api.sap.com/search?searchterm=&tab=VPUC&$type=(%22Validated%20Partner%20Use%20Case%22)',
  'Build':              'https://api.sap.com/search?searchterm=&tab=Build&$type=(%22SAP%20Build%22,%22SAP%20Intelligent%20Business%20Process%20Management%22,%22SAP%20Process%20Automation%22,%22SAP%20Build%20Apps%22)',
  'Process Blueprints': 'https://api.sap.com/search?searchterm=&tab=Process%20Blueprints&$type=(%22Business%20Processes%22)',
  'Analytics':          'https://api.sap.com/search?searchterm=&tab=Analytics&$type=(%22SAP%20Analytics%20Cloud%22,%22SAP%20Datasphere%22,%22SAC%20Custom%20Chart%20Package%22)',
  'Data Products':      'https://api.sap.com/search?searchterm=&tab=Data%20Products&$type=(%22DataProduct%22)',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResultItem {
  id:          string;     // service/artifact name extracted from URL
  title:       string;
  type:        string;     // badge text: "OData V2", "CDS View", "Integration Flow", …
  category:    string;     // tab name: "APIs", "CDS Views", …
  detailUrl:   string;     // full href to the detail page
  description: string;
}

export interface ApiHubDiscoveryFile {
  _metadata: {
    fetchedAt:   string;
    totalItems:  number;
    categories:  string[];
  };
  byCategory: Record<string, SearchResultItem[]>;
  /** Flat list of OData service names (from "APIs" category) — for EdmxFetcher. */
  odataServiceNames: string[];
}

export interface SapApiHubSearchFetcherOptions {
  live?:           boolean;

  /** Map of category name → search URL. Defaults to DEFAULT_SEARCH_URLS. */
  searchUrls?:     Record<string, string>;

  /** Categories to scrape. Default: all keys in searchUrls. */
  categories?:     string[];

  /** Max items to collect per category (0 = unlimited). Default 0. */
  maxItemsPerCat?: number;

  /** Scroll increment in px. Default 800. */
  scrollStep?:     number;

  /** Ms to wait after each scroll for new content to load. Default 1200. */
  scrollWaitMs?:   number;

  /** Max scroll rounds per page (safety cap). Default 200. */
  maxScrolls?:     number;

  /** Per-page navigation timeout in ms. Default 60s. */
  pageTimeoutMs?:  number;

  /** Session cookie for api.sap.com (needed if search results are auth-gated). */
  cookie?:         string;

  /** Explicit browser executable. */
  chromePath?:     string;

  /** Override discovery output path. */
  discoveryPath?:  string;

  /** Override fixture path for fixture-mode replay. */
  fixturePath?:    string;

  verbose?:        boolean;
}

// ---------------------------------------------------------------------------
// Fixture file shape
// ---------------------------------------------------------------------------

interface SearchSeedFile {
  _metadata: { fetchedAt: string; notes: string };
  entries: Array<{
    id: string; title: string; type: string; category: string;
    detailUrl: string; description: string;
  }>;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export class SapApiHubSearchFetcher implements IFetcher {

  public readonly id:    SourceId = 'SAP_API_HUB_SEARCH';
  public readonly label: string   = 'SAP API Business Hub — full catalog search';

  constructor(private readonly options: SapApiHubSearchFetcherOptions = {}) {}

  public async fetch(): Promise<IngestDocument[]> {
    return this.options.live ? this.fetchLive() : this.fetchFromFixture();
  }

  // -------------------------------------------------------------------
  // Fixture path
  // -------------------------------------------------------------------

  private fetchFromFixture(): IngestDocument[] {
    const fixturePath = this.options.fixturePath ?? defaultFixturePath();
    if (!fs.existsSync(fixturePath)) return [];
    const seed = JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as SearchSeedFile;
    const fetchedAt = new Date().toISOString();
    return seed.entries.map(e => this.toDocument(e, fetchedAt));
  }

  // -------------------------------------------------------------------
  // Live puppeteer path
  // -------------------------------------------------------------------

  private async fetchLive(): Promise<IngestDocument[]> {
    const urls        = this.options.searchUrls ?? DEFAULT_SEARCH_URLS;
    const cats        = this.options.categories ?? Object.keys(urls);
    const maxItems    = this.options.maxItemsPerCat ?? 0;
    const verbose     = this.options.verbose ?? false;
    const timeoutMs   = this.options.pageTimeoutMs ?? 60_000;
    const scrollStep  = this.options.scrollStep  ?? 800;
    const scrollWait  = this.options.scrollWaitMs ?? 1_200;
    const maxScrolls  = this.options.maxScrolls   ?? 200;

    const browserInfo = discoverBrowser(this.options.chromePath);
    const puppeteer   = require('puppeteer-core') as typeof import('puppeteer-core');
    const browser     = await puppeteer.launch({
      executablePath: browserInfo.executablePath,
      headless:       true,
      args:           ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const allItems: SearchResultItem[]                 = [];
    const byCategory: Record<string, SearchResultItem[]> = {};
    const fetchedAt = new Date().toISOString();

    try {
      for (const category of cats) {
        const url = urls[category];
        if (!url) {
          if (verbose) process.stderr.write(`[SearchFetcher] No URL for category "${category}" — skipping.\n`);
          continue;
        }
        if (verbose) process.stderr.write(`[SearchFetcher] Category: ${category} → ${url}\n`);

        const page = await browser.newPage();
        try {
          // Inject auth cookie if provided.
          if (this.options.cookie) {
            await page.setExtraHTTPHeaders({ Cookie: this.options.cookie });
          }

          await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });

          // Wait for at least one result card to appear.
          try {
            await page.waitForFunction(
              () => document.querySelectorAll('a[href*="/api/"], a[href*="/package/"]').length > 0,
              { timeout: Math.min(timeoutMs, 30_000) }
            );
          } catch {
            if (verbose) process.stderr.write(`[SearchFetcher] No results detected for ${category} — page may require auth.\n`);
          }

          // Auto-scroll to trigger infinite scroll / "load more".
          const totalLoaded = await this.autoScroll(page, scrollStep, scrollWait, maxScrolls, maxItems, verbose);
          if (verbose) process.stderr.write(`[SearchFetcher] ${category}: scrolled, ~${totalLoaded} links visible.\n`);

          // Extract all result items from the fully-loaded page.
          const extracted: Array<{ href: string; title: string; typeBadge: string; description: string }> =
            await page.evaluate(extractResultLinks);

          const items: SearchResultItem[] = [];
          const seen = new Set<string>();
          for (const e of extracted) {
            const id = artifactIdFromUrl(e.href);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (maxItems > 0 && items.length >= maxItems) break;
            items.push({
              id,
              title:       e.title || id,
              type:        e.typeBadge,
              category,
              detailUrl:   e.href,
              description: e.description
            });
          }

          byCategory[category] = items;
          allItems.push(...items);

          if (verbose) {
            process.stderr.write(`[SearchFetcher] ${category}: ${items.length} items extracted.\n`);
          }
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }

    // Derive OData service names from the "APIs" category.
    const odataServiceNames = (byCategory['APIs'] ?? [])
      .map(i => i.id)
      .filter(id => /^API_/.test(id) || /SRV$/.test(id));

    // Write discovery JSON.
    const discovery: ApiHubDiscoveryFile = {
      _metadata: {
        fetchedAt,
        totalItems:  allItems.length,
        categories:  Object.keys(byCategory)
      },
      byCategory,
      odataServiceNames
    };
    const discPath = this.options.discoveryPath ?? defaultDiscoveryPath();
    fs.writeFileSync(discPath, JSON.stringify(discovery, null, 2), 'utf-8');
    if (verbose) {
      process.stderr.write(
        `[SearchFetcher] Discovery written: ${allItems.length} total items, ` +
        `${odataServiceNames.length} OData service names → ${discPath}\n`
      );
    }

    // Also write a seed fixture for fixture-mode replay.
    const seedPath = this.options.fixturePath ?? defaultFixturePath();
    const seed: SearchSeedFile = {
      _metadata: { fetchedAt, notes: 'Auto-generated by SapApiHubSearchFetcher live run.' },
      entries: allItems
    };
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf-8');

    return allItems.map(i => this.toDocument(i, fetchedAt));
  }

  // -------------------------------------------------------------------
  // Auto-scroll — triggers infinite scroll until no new items load.
  // -------------------------------------------------------------------

  private async autoScroll(
    page:      import('puppeteer-core').Page,
    step:      number,
    waitMs:    number,
    maxRounds: number,
    maxItems:  number,
    verbose:   boolean
  ): Promise<number> {
    let prevCount = 0;
    let staleRounds = 0;

    for (let round = 0; round < maxRounds; round++) {
      const count: number = await page.evaluate((): number =>
        document.querySelectorAll('a[href*="/api/"], a[href*="/package/"]').length
      );

      if (maxItems > 0 && count >= maxItems) break;

      if (count === prevCount) {
        staleRounds++;
        if (staleRounds >= 3) break;   // 3 consecutive no-change rounds → done
      } else {
        staleRounds = 0;
      }
      prevCount = count;

      await page.evaluate((s: number) => window.scrollBy(0, s), step);
      await sleep(waitMs);

      if (verbose && round % 10 === 0) {
        process.stderr.write(`[SearchFetcher] scroll round ${round}, ${count} links so far\n`);
      }
    }
    return prevCount;
  }

  // -------------------------------------------------------------------
  // Document shaping
  // -------------------------------------------------------------------

  private toDocument(item: SearchResultItem | SearchSeedFile['entries'][0], fetchedAt: string): IngestDocument {
    const id = `sap-api-hub-search/${item.category.replace(/\s+/g, '-').toLowerCase()}/${item.id}`;
    const body = [
      `Artifact: ${item.id}`,
      `Category: ${item.category}`,
      `Type: ${item.type}`,
      `Title: ${item.title}`,
      item.description ? `\n${item.description}` : ''
    ].filter(Boolean).join('\n');

    return {
      id,
      source:         this.id,
      sourceUrl:      item.detailUrl,
      objectName:     item.id,
      objectType:     'API_ARTIFACT',
      module:         null,
      cleanCoreLevel: 'A',
      title:          item.title,
      body,
      metadata:       { category: item.category, artifactType: item.type },
      fetchedAt
    };
  }
}

// ---------------------------------------------------------------------------
// In-page extractor — runs inside the browser context.
// Harvests every <a> whose href matches /api/<NAME> or /package/<PKG>/artifact/<ART>.
// Also tries to find a title and type badge in the surrounding card element.
// ---------------------------------------------------------------------------

function extractResultLinks(): Array<{ href: string; title: string; typeBadge: string; description: string }> {
  const out: Array<{ href: string; title: string; typeBadge: string; description: string }> = [];
  const seen = new Set<string>();

  const links = Array.from(document.querySelectorAll('a[href]')) as any[];
  for (const a of links) {
    const href: string = a.href ?? '';
    if (!href.includes('api.sap.com')) continue;
    if (!/\/(api|package)\//.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    // Walk up to the nearest card-like container.
    let card: any = a;
    for (let i = 0; i < 6; i++) {
      if (!card.parentElement) break;
      card = card.parentElement;
      const tag = card.tagName?.toLowerCase() ?? '';
      const cls = (card.className ?? '').toLowerCase();
      if (tag === 'article' || tag === 'li' || /card|result|row|item/.test(cls)) break;
    }

    const titleEl = card.querySelector('h1,h2,h3,h4,h5') ?? a;
    const title: string = (titleEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

    // Type badge — look for small label elements
    const badgeEl = card.querySelector('[class*="type"],[class*="badge"],[class*="tag"],[class*="label"]');
    const typeBadge: string = (badgeEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

    // Description — any <p> in the card
    const pEl = card.querySelector('p,[class*="desc"],[class*="summary"]');
    const description: string = (pEl?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

    out.push({ href, title, typeBadge, description });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the artifact/service ID from an api.sap.com URL.
 *  /api/API_SALES_ORDER_SRV/overview  → API_SALES_ORDER_SRV
 *  /package/SAPS4HANACloud/artifact/I_SalesOrder_2 → I_SalesOrder_2
 *  /package/SAPS4HANACloud            → SAPS4HANACloud */
function artifactIdFromUrl(url: string): string | null {
  let m: RegExpMatchArray | null;

  m = url.match(/\/api\/([^/?#]+)/);
  if (m && m[1] !== 'sap') return m[1];   // exclude /api/sap/ navigation links

  m = url.match(/\/artifact\/([^/?#]+)/);
  if (m) return m[1];

  m = url.match(/\/package\/([^/?#]+)/);
  if (m) return m[1];

  return null;
}

function defaultFixturePath(): string {
  return path.resolve(__dirname, '..', '..', 'fixtures', 'api-hub-search-seed.json');
}

function defaultDiscoveryPath(): string {
  return path.resolve(__dirname, '..', '..', 'fixtures', 'api-hub-search-discovery.json');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
