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
        if (!this.options.urls || this.options.urls.length === 0) {
            throw new Error('ArchitectureCenterFetcher: live=true requires urls[] in options.');
        }
        const browserInfo = (0, BrowserDiscovery_1.discoverBrowser)(this.options.chromePath);
        const contentSel = this.options.contentSelector ?? 'article, main, [class*="docMainContainer"]';
        const timeoutMs = this.options.pageTimeoutMs ?? 30_000;
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
            for (const url of this.options.urls) {
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