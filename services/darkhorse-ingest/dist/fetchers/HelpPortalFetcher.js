/**
 * HelpPortalFetcher — scrapes help.sap.com CDS view reference pages for
 * per-view field metadata.
 *
 * Why this fetcher exists:
 *   The Cloudification Repository tells us a view EXISTS and what state it's
 *   in. It does NOT tell us which fields the view exposes. When the Code
 *   Agent generates a SELECT against I_OutboundDelivery, it still guesses
 *   field names from training data — producing hallucinations like `ktokk`
 *   on I_Supplier (a KNA1/LFA1 field that doesn't exist on the released
 *   business-partner views) or invented LIKP columns in Z wrappers.
 *
 *   This fetcher fixes the gap by pulling the field table from each view's
 *   help-portal reference page. Output JSON feeds a CdsFieldCatalogProvider
 *   that surfaces fields[] in the get_cds_view tool response.
 *
 * Why help.sap.com (not api.sap.com or an EDMX bulk dump):
 *   - help.sap.com is the canonical SAP-published reference. Every released
 *     CDS view has a page.
 *   - api.sap.com is also SPA but is organized by API service, not by
 *     individual view — would require navigating service → entity, ~similar
 *     scraping cost.
 *   - EDMX bulk dumps require S-user authentication and aren't published as
 *     a public artefact.
 *
 * Site rendering:
 *   help.sap.com is a JS-rendered SPA. Plain HTTP fetchers receive an empty
 *   shell. The live path uses puppeteer-core via BrowserDiscovery, same as
 *   ArchitectureCenterFetcher.
 *
 * Input shape:
 *   The fetcher takes an explicit list of {viewName, url} pairs in options.
 *   URL discovery (mapping view name → help-portal URL automatically) is a
 *   follow-up task — discovery is a separate concern from extraction, and
 *   getting extraction right on a small curated list first is the right
 *   sequence.
 *
 *   Curation source for the initial list: pull the top-N most-frequently
 *   needed I_* CDS views from the cloudification fixture + the views named
 *   in the most-failing pipelines (OTC backorder, PTP PO enhancement, ZOTC
 *   routing report).
 *
 * Output shape:
 *   One IngestDocument per view, with:
 *     - title:       the view's human label from the help page
 *     - body:        a human-readable summary + the rendered field table
 *     - metadata.fields: structured field array (the actual value the MCP
 *                   provider consumes)
 *     - metadata.fieldsJson: same array serialized so the JSON-on-disk
 *                   fixture round-trips without losing field structure
 *                   through DocumentChunk -> EmbeddedChunk -> SearchHit.
 *
 * Robustness:
 *   The help-portal HTML changes shape periodically. The extractor tries
 *   several selectors in priority order and degrades gracefully — a view
 *   with no extractable table still produces a document carrying the page
 *   title and full text body, so the LLM has SOMETHING to ground against
 *   even when our parser misses.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelpPortalFetcher = void 0;
const fs = require("fs");
const path = require("path");
const BrowserDiscovery_1 = require("./BrowserDiscovery");
// ---------------------------------------------------------------------------
// Fetcher implementation
// ---------------------------------------------------------------------------
class HelpPortalFetcher {
    options;
    id = 'SAP_HELP_PORTAL_CDS';
    label = 'SAP Help Portal — released CDS views';
    constructor(options = {}) {
        this.options = options;
    }
    async fetch() {
        return this.options.live
            ? this.fetchLive()
            : this.fetchFromFixture();
    }
    // -------------------------------------------------------------------
    // Fixture path
    // -------------------------------------------------------------------
    fetchFromFixture() {
        const defaultFixture = path.resolve(__dirname, '..', '..', 'fixtures', 'help-portal-cds-seed.json');
        const fixturePath = this.options.fixturePath ?? defaultFixture;
        if (!fs.existsSync(fixturePath)) {
            // Empty fixture is fine pre-first-run; just emit nothing rather than
            // throw so `ingest all` doesn't break on a fresh checkout.
            return [];
        }
        const raw = fs.readFileSync(fixturePath, 'utf-8');
        const seed = JSON.parse(raw);
        const fetchedAt = new Date().toISOString();
        return seed.entries.map(entry => this.toDocumentFromSeed(entry, fetchedAt));
    }
    // -------------------------------------------------------------------
    // Live puppeteer path
    // -------------------------------------------------------------------
    async fetchLive() {
        const targets = this.options.targets ?? [];
        if (targets.length === 0) {
            throw new Error('HelpPortalFetcher: live=true requires targets[] in options.');
        }
        const browserInfo = (0, BrowserDiscovery_1.discoverBrowser)(this.options.chromePath);
        const contentSel = this.options.contentSelector
            ?? 'article, main, [class*="markdown"], [class*="content"]';
        const timeoutMs = this.options.pageTimeoutMs ?? 45_000;
        const rateLimitMs = this.options.rateLimitMs ?? 1500;
        const verbose = this.options.verbose ?? false;
        const puppeteer = require('puppeteer-core');
        const browser = await puppeteer.launch({
            executablePath: browserInfo.executablePath,
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage']
        });
        const docs = [];
        const fetchedAt = new Date().toISOString();
        // Open a checkpoint stream if the caller asked for one. JSON-lines format —
        // one extract per line — so interrupted runs can resume by reading the
        // file, filtering already-completed view names, and re-running with the
        // remaining targets.
        const checkpointFd = this.options.checkpointPath
            ? fs.openSync(this.options.checkpointPath, 'a')
            : null;
        try {
            let idx = 0;
            for (const target of targets) {
                idx += 1;
                const page = await browser.newPage();
                try {
                    if (verbose) {
                        process.stderr.write(`[HelpPortalFetcher] (${idx}/${targets.length}) ${target.viewName} <- ${target.url}\n`);
                    }
                    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: timeoutMs });
                    // Try the primary selector but tolerate timeout — the portal often
                    // hydrates content asynchronously and the wait is best-effort.
                    try {
                        await page.waitForSelector(contentSel, { timeout: Math.min(timeoutMs, 20_000) });
                    }
                    catch {
                        /* fall through and try the extractor anyway */
                    }
                    const extract = await page.evaluate(extractViewFromPage, contentSel, target.viewName);
                    // Compose IngestDocument from the extract
                    docs.push(this.toDocumentFromExtract({
                        viewName: target.viewName,
                        pageTitle: extract.pageTitle || target.viewName,
                        pageUrl: target.url,
                        fields: extract.fields,
                        bodyText: extract.bodyText,
                        hasFields: extract.fields.length > 0
                    }, target, fetchedAt));
                    if (checkpointFd != null) {
                        fs.writeSync(checkpointFd, JSON.stringify({
                            viewName: target.viewName,
                            url: target.url,
                            title: extract.pageTitle,
                            fields: extract.fields,
                            hasFields: extract.fields.length > 0,
                            fetchedAt: new Date().toISOString()
                        }) + '\n');
                    }
                }
                catch (err) {
                    // A single-page failure must not break a long ingest. Emit a stub
                    // document so the user can see which views failed; the checkpoint
                    // file is appended only on success so a rerun retries this view.
                    if (verbose) {
                        process.stderr.write(`[HelpPortalFetcher] FAILED ${target.viewName}: ${err?.message ?? err}\n`);
                    }
                    docs.push(this.toFailureDocument(target, err?.message ?? String(err), fetchedAt));
                }
                finally {
                    await page.close();
                }
                if (rateLimitMs > 0 && idx < targets.length) {
                    await sleep(rateLimitMs);
                }
            }
        }
        finally {
            if (checkpointFd != null)
                fs.closeSync(checkpointFd);
            await browser.close();
        }
        return docs;
    }
    // -------------------------------------------------------------------
    // Document shaping
    // -------------------------------------------------------------------
    toDocumentFromExtract(extract, target, fetchedAt) {
        const id = `sap-help-portal-cds/view/${extract.viewName}`;
        const body = renderBody(extract);
        return {
            id,
            source: this.id,
            sourceUrl: extract.pageUrl,
            objectName: extract.viewName,
            objectType: 'CDS',
            module: target.module ?? null,
            cleanCoreLevel: 'A', // released views on help.sap.com are Level A by construction
            title: extract.pageTitle,
            body,
            metadata: {
                fieldCount: extract.fields.length,
                fieldsJson: JSON.stringify(extract.fields),
                hasFields: extract.hasFields,
                notes: target.notes ?? ''
            },
            fetchedAt
        };
    }
    toFailureDocument(target, errorMessage, fetchedAt) {
        const id = `sap-help-portal-cds/view-failed/${target.viewName}`;
        return {
            id,
            source: this.id,
            sourceUrl: target.url,
            objectName: target.viewName,
            objectType: 'CDS',
            module: target.module ?? null,
            cleanCoreLevel: 'A',
            title: `${target.viewName} (fetch failed)`,
            body: [
                `View: ${target.viewName}`,
                `URL: ${target.url}`,
                `Status: fetch failed — ${errorMessage}`,
                ``,
                `This is a placeholder document so the missing view is visible in the index.`,
                `Re-run the fetcher to retry. If the failure persists, the help-portal URL may have changed.`
            ].join('\n'),
            metadata: {
                fieldCount: 0,
                fieldsJson: '[]',
                hasFields: false,
                fetchFailed: true,
                errorMessage
            },
            fetchedAt
        };
    }
    toDocumentFromSeed(entry, fetchedAt) {
        const id = `sap-help-portal-cds/view/${entry.viewName}`;
        const body = renderBody({
            viewName: entry.viewName,
            pageTitle: entry.title,
            pageUrl: entry.url ?? '',
            fields: entry.fields,
            bodyText: entry.description,
            hasFields: entry.fields.length > 0
        });
        return {
            id,
            source: this.id,
            sourceUrl: entry.url,
            objectName: entry.viewName,
            objectType: 'CDS',
            module: entry.module,
            cleanCoreLevel: entry.cleanCoreLevel,
            title: entry.title,
            body,
            metadata: {
                fieldCount: entry.fields.length,
                fieldsJson: JSON.stringify(entry.fields),
                hasFields: entry.fields.length > 0,
                ...(entry.metadata ?? {})
            },
            fetchedAt
        };
    }
}
exports.HelpPortalFetcher = HelpPortalFetcher;
// ---------------------------------------------------------------------------
// In-page extractor — runs inside the headless browser context.
//
// Strategy: prefer the first <table> whose header row contains column names
// matching ABAP field-table conventions ("Field", "Name", "Element", "Type",
// "Description"). Fall back to any table that has at least 3 columns and 2
// rows. If no table is found, return an empty fields array; the caller still
// captures the page body text.
// ---------------------------------------------------------------------------
// `extractViewFromPage` runs INSIDE the browser, so it cannot reference any
// imports or outer-scope helpers. Everything it needs is inlined.
function extractViewFromPage(contentSelector, viewName) {
    const root = document.querySelector(contentSelector) ?? document.body;
    if (!root)
        return { pageTitle: document.title || viewName, fields: [], bodyText: '' };
    const pageTitle = (root.querySelector('h1')?.textContent?.trim()) ||
        (document.querySelector('h1')?.textContent?.trim()) ||
        (document.title || viewName);
    // Collect candidate tables in document order.
    const tables = Array.from(root.querySelectorAll('table'));
    let chosen = null;
    let chosenScore = 0;
    for (const t of tables) {
        const score = scoreTable(t);
        if (score > chosenScore) {
            chosen = t;
            chosenScore = score;
        }
    }
    const fields = chosen ? extractTableRows(chosen) : [];
    // bodyText: concatenated visible text up to 12K chars (chunker takes it from there).
    const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = text.length > 12_000 ? text.slice(0, 12_000) : text;
    return { pageTitle, fields, bodyText };
    // ----- inline helpers (must stay inside the page.evaluate body) -----
    function scoreTable(tbl) {
        const headers = Array.from(tbl.querySelectorAll('thead th, tr:first-child th, tr:first-child td'))
            .map((h) => (h.textContent ?? '').trim().toLowerCase());
        const rows = tbl.querySelectorAll('tbody tr, tr').length;
        if (rows < 2 || headers.length < 2)
            return 0;
        const isFieldName = headers.some((h) => /\b(field|element|name|attribute)\b/.test(h));
        const isType = headers.some((h) => /\b(type|data\s*type|element\s*type)\b/.test(h));
        const isDescription = headers.some((h) => /\b(description|short text|label|use|purpose)\b/.test(h));
        // Heuristic score — a table that looks like an ABAP field reference wins.
        let s = rows;
        if (isFieldName)
            s += 50;
        if (isType)
            s += 30;
        if (isDescription)
            s += 20;
        // Strong negative for tables that look like nav / TOC.
        if (headers.length === 1)
            s -= 100;
        return s;
    }
    function extractTableRows(tbl) {
        const headerCells = Array.from(tbl.querySelectorAll('thead th, tr:first-child th, tr:first-child td'))
            .map((h) => (h.textContent ?? '').trim().toLowerCase());
        const headerIdx = (re) => headerCells.findIndex((h) => re.test(h));
        const nameIdx = headerIdx(/\b(field|element|name|attribute)\b/);
        const typeIdx = headerIdx(/\b(type|data\s*type|element\s*type)\b/);
        const lengthIdx = headerIdx(/\b(length|len)\b/);
        const keyIdx = headerIdx(/\b(key)\b/);
        const descriptionIdx = headerIdx(/\b(description|short text|label|use|purpose)\b/);
        const assocIdx = headerIdx(/\b(association|navigation|relation)\b/);
        // tbody rows only; skip the header row.
        const rows = Array.from(tbl.querySelectorAll('tbody tr'));
        const dataRows = rows.length > 0
            ? rows
            : Array.from(tbl.querySelectorAll('tr')).slice(1);
        const out = [];
        for (const r of dataRows) {
            const cells = Array.from(r.querySelectorAll('td'));
            if (cells.length === 0)
                continue;
            const cellText = (i) => i >= 0 && i < cells.length ? (cells[i].textContent ?? '').trim() : '';
            const name = nameIdx >= 0 ? cellText(nameIdx) : cellText(0);
            if (!name || /^[\s\-_]+$/.test(name))
                continue;
            out.push({
                name,
                type: typeIdx >= 0 ? (cellText(typeIdx) || null) : null,
                length: lengthIdx >= 0 ? (cellText(lengthIdx) || null) : null,
                isKey: keyIdx >= 0 ? /yes|x|true|key/i.test(cellText(keyIdx)) : false,
                association: assocIdx >= 0 ? (cellText(assocIdx) || null) : null,
                description: descriptionIdx >= 0 ? cellText(descriptionIdx) : ''
            });
        }
        return out;
    }
}
// ---------------------------------------------------------------------------
// Body renderer — produces the human-readable prompt block. The MCP
// provider also reads metadata.fieldsJson to get the structured array.
// ---------------------------------------------------------------------------
function renderBody(extract) {
    const head = [
        `View: ${extract.viewName}`,
        `Title: ${extract.pageTitle}`,
        `Source: help.sap.com (${extract.pageUrl})`,
        ``
    ].join('\n');
    if (!extract.hasFields || extract.fields.length === 0) {
        return head +
            `Field table could not be extracted from the help-portal page. ` +
            `Page body excerpt follows; the agent should fall back to released-API ` +
            `metadata or schema doc if a precise field list is required.\n\n` +
            extract.bodyText.slice(0, 4000);
    }
    // Mini-table of fields — markdown-ish so the LLM parses it cleanly.
    const lines = [
        `Fields (${extract.fields.length} total):`,
        `| Name | Type | Key | Description |`,
        `| --- | --- | --- | --- |`
    ];
    for (const f of extract.fields) {
        const type = [f.type, f.length].filter(Boolean).join(' ').trim() || '—';
        const key = f.isKey ? 'KEY' : '';
        const desc = (f.description || '').replace(/\|/g, '/').slice(0, 120);
        lines.push(`| ${f.name} | ${type} | ${key} | ${desc} |`);
    }
    return head + lines.join('\n');
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=HelpPortalFetcher.js.map