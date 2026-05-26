/**
 * ArchitectureCenterFetcher — Sprint 2 session 3 fetcher for the SAP
 * Architecture Center (architecture.learning.sap.com).
 *
 * The Architecture Center publishes ~87 reference architectures spanning AI,
 * integration, app development, DevOps, and Clean Core. It is the canonical
 * source for "what is the approved pattern for X" in the SO/FDS/TDS agents.
 *
 * Why this fetcher is special:
 *   The site is a JS-rendered Docusaurus app. Plain HTTP fetchers receive an
 *   empty HTML shell — the actual content is hydrated client-side. Per the
 *   CPI-6 spec the live ingestion path MUST render pages via headless
 *   Chrome.
 *
 * Sprint 2 strategy:
 *   - Default path: load fixtures/architecture-center-seed.json — curated
 *     extracts of the 6 priority documents from the spec plus a small set
 *     of widely-referenced reference architectures.
 *   - Live path (live=true + urls): launches headless Chrome via
 *     puppeteer-core, navigates each /docs/ref-arch/<id> URL, waits for the
 *     content selector, extracts page text, returns one IngestDocument per
 *     architecture.
 *
 * Browser dependency:
 *   puppeteer-core requires a Chromium-based browser to be installed locally
 *   (we do NOT bundle Chrome). BrowserDiscovery resolves Chrome → Edge →
 *   CHROME_PATH env. The seed-fixture path requires no browser.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchitectureCenterFetcher = void 0;
const fs = require("fs");
const path = require("path");
const BrowserDiscovery_1 = require("./BrowserDiscovery");
// ---------------------------------------------------------------------------
// Fetcher implementation
// ---------------------------------------------------------------------------
class ArchitectureCenterFetcher {
    options;
    id = 'SAP_ARCHITECTURE_CENTER';
    label = 'SAP Architecture Center';
    constructor(options = {}) {
        this.options = options;
    }
    async fetch() {
        if (this.options.live) {
            return this.fetchLive();
        }
        return this.fetchFromFixture();
    }
    // -------------------------------------------------------------------
    // Fixture path
    // -------------------------------------------------------------------
    fetchFromFixture() {
        const defaultFixture = path.resolve(__dirname, '..', '..', 'fixtures', 'architecture-center-seed.json');
        const fixturePath = this.options.fixturePath ?? defaultFixture;
        if (!fs.existsSync(fixturePath)) {
            throw new Error(`ArchitectureCenterFetcher: seed fixture not found at ${fixturePath}`);
        }
        const raw = fs.readFileSync(fixturePath, 'utf-8');
        const seed = JSON.parse(raw);
        const fetchedAt = new Date().toISOString();
        return seed.entries.map(entry => this.toDocument(entry, fetchedAt));
    }
    // -------------------------------------------------------------------
    // Live Puppeteer path — wired, disabled by default
    // -------------------------------------------------------------------
    async fetchLive() {
        const browserInfo = (0, BrowserDiscovery_1.discoverBrowser)(this.options.chromePath);
        const contentSel = this.options.contentSelector ?? 'article, main, [class*="docMainContainer"]';
        const timeoutMs = this.options.pageTimeoutMs ?? 30_000;
        // Build the URL list — sitemap discovery + seed merge.
        let urls;
        if (this.options.discoverUrls) {
            const discovered = await this.discoverFromSitemap();
            const seed = this.options.urls ?? [];
            const merged = new Set([...discovered, ...seed]);
            urls = Array.from(merged);
            process.stderr.write(`[ArchitectureCenterFetcher] Sitemap: ${discovered.length} ref-arch URLs discovered; ` +
                `${urls.length} total after merging seed.\n`);
        }
        else {
            urls = this.options.urls ?? [];
        }
        if (urls.length === 0) {
            throw new Error('ArchitectureCenterFetcher: no URLs to scrape. ' +
                'Set discoverUrls=true or provide urls[] in options.');
        }
        // Lazy import puppeteer-core so the seed-fixture path doesn't pay the cost.
        const puppeteer = require('puppeteer-core');
        const browser = await puppeteer.launch({
            executablePath: browserInfo.executablePath,
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        });
        const docs = [];
        try {
            const fetchedAt = new Date().toISOString();
            for (const url of urls) {
                const page = await browser.newPage();
                try {
                    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
                    await page.waitForSelector(contentSel, { timeout: timeoutMs });
                    const extracted = await page.evaluate((sel) => {
                        const root = document.querySelector(sel);
                        if (!root)
                            return { title: document.title, text: '' };
                        const title = root.querySelector('h1')?.textContent?.trim()
                            || document.title.trim();
                        const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
                        return { title, text };
                    }, contentSel);
                    const patternId = patternIdFromUrl(url);
                    docs.push(this.toDocument({
                        patternId,
                        title: extracted.title || patternId,
                        module: null,
                        cleanCoreLevel: 'A',
                        description: extracted.text,
                        url,
                        metadata: { renderer: browserInfo.product }
                    }, fetchedAt));
                }
                finally {
                    await page.close();
                }
            }
        }
        finally {
            await browser.close();
        }
        return docs;
    }
    // -------------------------------------------------------------------
    // Sitemap discovery — plain HTTP, no headless browser needed.
    // Fetches sitemap.xml and extracts all /docs/ref-arch/* loc entries.
    // -------------------------------------------------------------------
    async discoverFromSitemap() {
        const sitemapUrl = this.options.sitemapUrl
            ?? 'https://architecture.learning.sap.com/sitemap.xml';
        const timeoutMs = this.options.sitemapTimeoutMs ?? 15_000;
        process.stderr.write(`[ArchitectureCenterFetcher] Fetching sitemap: ${sitemapUrl}\n`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let xml;
        try {
            const res = await fetch(sitemapUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'DarkHorse-Ingest/1.0', 'Accept': 'application/xml, text/xml, */*' }
            });
            if (!res.ok) {
                process.stderr.write(`[ArchitectureCenterFetcher] Sitemap fetch failed: HTTP ${res.status}. Falling back to seed URLs.\n`);
                return [];
            }
            xml = await res.text();
        }
        catch (err) {
            process.stderr.write(`[ArchitectureCenterFetcher] Sitemap fetch error: ${err?.message ?? err}. Falling back to seed URLs.\n`);
            return [];
        }
        finally {
            clearTimeout(timer);
        }
        // Extract <loc> values that match /docs/ref-arch/ paths.
        const locRe = /<loc>\s*(https?:\/\/[^<]+\/docs\/ref-arch\/[^<\s]+)\s*<\/loc>/gi;
        const urls = [];
        let m;
        while ((m = locRe.exec(xml)) !== null) {
            urls.push(m[1].trim());
        }
        return urls;
    }
    // -------------------------------------------------------------------
    // Shared shaping
    // -------------------------------------------------------------------
    toDocument(entry, fetchedAt) {
        const id = `sap-architecture-center/pattern/${entry.patternId}`;
        const body = [
            `Pattern: ${entry.patternId}`,
            entry.module ? `Domain: ${entry.module}` : null,
            entry.cleanCoreLevel ? `Clean Core Level: ${entry.cleanCoreLevel}` : null,
            '',
            entry.title,
            '',
            entry.description
        ].filter(Boolean).join('\n');
        return {
            id,
            source: this.id,
            sourceUrl: entry.url,
            objectName: entry.patternId,
            objectType: 'PATTERN',
            module: entry.module,
            cleanCoreLevel: entry.cleanCoreLevel,
            title: entry.title,
            body,
            metadata: entry.metadata ?? {},
            fetchedAt
        };
    }
}
exports.ArchitectureCenterFetcher = ArchitectureCenterFetcher;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function patternIdFromUrl(url) {
    // /docs/ref-arch/ca1d2a3e -> CA1D2A3E
    const m = url.match(/\/ref-arch\/([A-Za-z0-9_-]+)/);
    return (m?.[1] ?? 'UNKNOWN').toUpperCase().replace(/-/g, '_');
}
//# sourceMappingURL=ArchitectureCenterFetcher.js.map