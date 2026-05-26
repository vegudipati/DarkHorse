/**
 * darkhorse-ingest CLI — Sprint 2 session 1.
 *
 * Usage:
 *   node dist/index.js ingest sap-api-hub [--snapshot data/sap-api-hub.snapshot.json]
 *   node dist/index.js verify [--snapshot data/sap-api-hub.snapshot.json]
 *
 * `ingest` runs the full fetch → chunk → embed → index pipeline against
 * one source and (optionally) writes a JSON snapshot of the index.
 *
 * `verify` loads the snapshot (or runs an in-memory ingest if none given)
 * and probes the index with the Sprint-1 Code-Agent failure modes
 * (USEREXIT_ATP_QUANTITY, VBAK → I_SalesOrder, etc.). Acts as the Sprint-2
 * session-1 acceptance test.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const Pipeline_1 = require("./Pipeline");
const SapApiHubFetcher_1 = require("./fetchers/SapApiHubFetcher");
const SapApiHubEdmxFetcher_1 = require("./fetchers/SapApiHubEdmxFetcher");
const CleanCoreGuideFetcher_1 = require("./fetchers/CleanCoreGuideFetcher");
const ArchitectureCenterFetcher_1 = require("./fetchers/ArchitectureCenterFetcher");
const HelpPortalFetcher_1 = require("./fetchers/HelpPortalFetcher");
const SapApiHubSearchFetcher_1 = require("./fetchers/SapApiHubSearchFetcher");
const SapApiHubCatalogFetcher_1 = require("./fetchers/SapApiHubCatalogFetcher");
const TokenChunker_1 = require("./chunker/TokenChunker");
const MockEmbedder_1 = require("./embedders/MockEmbedder");
const AzureOpenAiEmbedder_1 = require("./embedders/AzureOpenAiEmbedder");
const InMemoryVectorIndex_1 = require("./indexes/InMemoryVectorIndex");
const AzureAiSearchVectorIndex_1 = require("./indexes/AzureAiSearchVectorIndex");
const KNOWN_SOURCES = [
    'sap-api-hub',
    'sap-api-hub-edmx',
    'sap-api-hub-search',
    'sap-api-hub-catalog',
    'clean-core-guide',
    'architecture-center',
    'help-portal-cds'
];
function buildFetcher(source) {
    switch (source) {
        case 'sap-api-hub': return new SapApiHubFetcher_1.SapApiHubFetcher({ live: false });
        case 'sap-api-hub-edmx': return buildEdmxFetcher();
        case 'sap-api-hub-search': return buildApiHubSearchFetcher();
        case 'sap-api-hub-catalog': return buildApiHubCatalogFetcher();
        case 'clean-core-guide': return new CleanCoreGuideFetcher_1.CleanCoreGuideFetcher({ live: false });
        case 'architecture-center': return buildArchitectureCenterFetcher();
        case 'help-portal-cds': return buildHelpPortalFetcher();
        default:
            throw new Error(`Unknown source "${source}". Known sources: ${KNOWN_SOURCES.join(', ')}`);
    }
}
/**
 * EdmxFetcher builder — honours env vars:
 *   - DARKHORSE_API_HUB_EDMX_LIVE=true|1            live download from api.sap.com
 *   - DARKHORSE_API_HUB_EDMX_SERVICES=A,B,C         override service-name list
 *                                                  (default = curated SD/MM/FI/PP set)
 *   - DARKHORSE_API_HUB_EDMX_MAX=N                  limit services per run (0 = unlimited)
 *   - DARKHORSE_API_HUB_EDMX_CHECKPOINT=<path>      resume-from-checkpoint JSONL
 *   - DARKHORSE_API_HUB_EDMX_RATE_MS=N              ms between EDMX downloads (default 500)
 *   - DARKHORSE_API_HUB_EDMX_DIAGNOSE=true|1        fetch the first service only +
 *                                                  print full response diagnostics
 *
 *  Authentication (api.sap.com gates EDMX behind login). Provide at least one:
 *   - DARKHORSE_API_HUB_API_KEY=<key>               api.sap.com personal API key
 *   - DARKHORSE_API_HUB_BEARER=<token>              OAuth2 access token
 *   - DARKHORSE_API_HUB_COOKIE=<verbatim>           browser-extracted session cookie
 */
function buildEdmxFetcher() {
    const live = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_API_HUB_EDMX_LIVE ?? '').toLowerCase());
    if (!live) {
        return new SapApiHubEdmxFetcher_1.SapApiHubEdmxFetcher({ live: false });
    }
    const servicesRaw = process.env.DARKHORSE_API_HUB_EDMX_SERVICES;
    const serviceNames = servicesRaw
        ? servicesRaw.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
    const max = parseInt(process.env.DARKHORSE_API_HUB_EDMX_MAX ?? '0', 10);
    const rateMs = parseInt(process.env.DARKHORSE_API_HUB_EDMX_RATE_MS ?? '500', 10);
    const diagnose = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_API_HUB_EDMX_DIAGNOSE ?? '').toLowerCase());
    return new SapApiHubEdmxFetcher_1.SapApiHubEdmxFetcher({
        live: true,
        serviceNames,
        maxServices: isFinite(max) && max > 0 ? max : 0,
        rateLimitMs: isFinite(rateMs) && rateMs >= 0 ? rateMs : 500,
        checkpointPath: process.env.DARKHORSE_API_HUB_EDMX_CHECKPOINT,
        apiKey: process.env.DARKHORSE_API_HUB_API_KEY,
        bearerToken: process.env.DARKHORSE_API_HUB_BEARER,
        cookie: process.env.DARKHORSE_API_HUB_COOKIE,
        diagnose,
        verbose: true
    });
}
/**
 * SapApiHubSearchFetcher builder — honours env vars:
 *   - DARKHORSE_API_HUB_SEARCH_LIVE=true|1    live headless-Chrome scrape
 *   - DARKHORSE_API_HUB_SEARCH_CATS=A,B,C     comma-separated category names
 *                                             (default: all 9 tabs)
 *   - DARKHORSE_API_HUB_SEARCH_MAX=N          max items per category (0=all)
 *   - DARKHORSE_API_HUB_COOKIE=<cookie>       session cookie (if auth required)
 *   - DARKHORSE_CHROME_PATH=<exe>             browser override
 *
 * Output: fixtures/api-hub-search-discovery.json (structured catalog) +
 *         fixtures/api-hub-search-seed.json (fixture for replay).
 */
function buildApiHubSearchFetcher() {
    const live = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_API_HUB_SEARCH_LIVE ?? '').toLowerCase());
    if (!live) {
        return new SapApiHubSearchFetcher_1.SapApiHubSearchFetcher({ live: false });
    }
    const catsRaw = process.env.DARKHORSE_API_HUB_SEARCH_CATS;
    const categories = catsRaw
        ? catsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
    const maxRaw = parseInt(process.env.DARKHORSE_API_HUB_SEARCH_MAX ?? '0', 10);
    const maxItemsPerCat = isFinite(maxRaw) && maxRaw >= 0 ? maxRaw : 0;
    return new SapApiHubSearchFetcher_1.SapApiHubSearchFetcher({
        live: true,
        searchUrls: SapApiHubSearchFetcher_1.DEFAULT_SEARCH_URLS,
        categories,
        maxItemsPerCat,
        cookie: process.env.DARKHORSE_API_HUB_COOKIE,
        chromePath: process.env.DARKHORSE_CHROME_PATH,
        verbose: true
    });
}
/**
 * SapApiHubCatalogFetcher builder — honours env vars:
 *   - DARKHORSE_API_HUB_APIKEY=<key>              required for live mode
 *   - DARKHORSE_API_HUB_CATALOG_LIVE=true|1       enable live OData paging
 *   - DARKHORSE_API_HUB_CATALOG_SETS=APIs,ContentPackages  subset (default both)
 *   - DARKHORSE_API_HUB_CATALOG_MAX=N             max records per set (0=all)
 *
 * Output: fixtures/api-hub-catalog.json (raw catalog snapshot for replay).
 */
function buildApiHubCatalogFetcher() {
    const live = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_API_HUB_CATALOG_LIVE ?? '').toLowerCase());
    const apiKey = process.env.DARKHORSE_API_HUB_APIKEY ?? '';
    if (live && !apiKey) {
        throw new Error('DARKHORSE_API_HUB_APIKEY is required for sap-api-hub-catalog live mode.');
    }
    const setsRaw = process.env.DARKHORSE_API_HUB_CATALOG_SETS;
    const entitySets = setsRaw
        ? setsRaw.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
    const maxRaw = parseInt(process.env.DARKHORSE_API_HUB_CATALOG_MAX ?? '0', 10);
    const maxRecs = isFinite(maxRaw) && maxRaw >= 0 ? maxRaw : 0;
    return new SapApiHubCatalogFetcher_1.SapApiHubCatalogFetcher({
        apiKey,
        live,
        entitySets,
        maxRecords: maxRecs,
        verbose: true
    });
}
/**
 * HelpPortalFetcher builder — honours env vars:
 *   - DARKHORSE_HELP_PORTAL_LIVE=true|1            switch from fixture to live
 *   - DARKHORSE_HELP_PORTAL_TARGETS=<absolute path> read view targets from a
 *                                                 JSON file (see fixtures/
 *                                                 help-portal-targets.json)
 *   - DARKHORSE_HELP_PORTAL_CHECKPOINT=<path>      JSON-lines progress log
 *   - DARKHORSE_CHROME_PATH=<exe>                  browser override (also read
 *                                                 by BrowserDiscovery)
 *
 * Fixture mode is the default so `ingest all` works on a fresh checkout
 * without a browser.
 */
/**
 * HelpPortalFetcher builder — honours env vars:
 *   - DARKHORSE_HELP_PORTAL_LIVE=true|1          enable live scraping
 *
 *  Crawl mode (recommended):
 *   - DARKHORSE_HELP_PORTAL_ROOT_URL=<url>        root index page to crawl
 *     e.g. https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/<ver>/<guid>.html
 *     Discovers all child pages under the same product/version prefix,
 *     extracts CDS field tables, writes results to the seed fixture.
 *   - DARKHORSE_HELP_PORTAL_MAX_PAGES=N           page cap (default 500)
 *   - DARKHORSE_HELP_PORTAL_MAX_DEPTH=N           crawl depth (default 3)
 *
 *  Flat-targets mode (manual list):
 *   - DARKHORSE_HELP_PORTAL_TARGETS=<path>        JSON file { "targets": [...] }
 *
 *  Shared:
 *   - DARKHORSE_HELP_PORTAL_CHECKPOINT=<path>     resume JSONL log
 *   - DARKHORSE_CHROME_PATH=<exe>                 browser override
 */
function buildHelpPortalFetcher() {
    const fs = require('fs');
    const live = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_HELP_PORTAL_LIVE ?? '').toLowerCase());
    if (!live) {
        return new HelpPortalFetcher_1.HelpPortalFetcher({ live: false });
    }
    // Crawl mode — preferred when ROOT_URL is set.
    const rootUrl = process.env.DARKHORSE_HELP_PORTAL_ROOT_URL;
    if (rootUrl) {
        const maxPages = parseInt(process.env.DARKHORSE_HELP_PORTAL_MAX_PAGES ?? '500', 10);
        const maxDepth = parseInt(process.env.DARKHORSE_HELP_PORTAL_MAX_DEPTH ?? '3', 10);
        return new HelpPortalFetcher_1.HelpPortalFetcher({
            live: true,
            crawlRootUrl: rootUrl,
            maxCrawlPages: isFinite(maxPages) && maxPages > 0 ? maxPages : 500,
            maxCrawlDepth: isFinite(maxDepth) && maxDepth > 0 ? maxDepth : 3,
            chromePath: process.env.DARKHORSE_CHROME_PATH,
            checkpointPath: process.env.DARKHORSE_HELP_PORTAL_CHECKPOINT,
            verbose: true
        });
    }
    // Flat-targets mode — legacy, requires explicit targets JSON.
    const targetsPath = process.env.DARKHORSE_HELP_PORTAL_TARGETS;
    if (!targetsPath) {
        throw new Error('help-portal-cds live=true requires either DARKHORSE_HELP_PORTAL_ROOT_URL ' +
            '(crawl mode) or DARKHORSE_HELP_PORTAL_TARGETS (flat list mode).');
    }
    if (!fs.existsSync(targetsPath)) {
        throw new Error(`help-portal-cds: targets file not found at ${targetsPath}`);
    }
    const parsed = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
    if (!parsed.targets || !Array.isArray(parsed.targets) || parsed.targets.length === 0) {
        throw new Error(`help-portal-cds: targets file ${targetsPath} must contain a non-empty targets[] array.`);
    }
    return new HelpPortalFetcher_1.HelpPortalFetcher({
        live: true,
        targets: parsed.targets,
        chromePath: process.env.DARKHORSE_CHROME_PATH,
        checkpointPath: process.env.DARKHORSE_HELP_PORTAL_CHECKPOINT,
        verbose: true
    });
}
/**
 * ArchitectureCenterFetcher builder — honours env vars:
 *   - DARKHORSE_ARCH_CENTER_LIVE=true|1     live headless-Chrome scrape
 *   - DARKHORSE_ARCH_CENTER_URLS_FILE=<p>   JSON file with extra URL list
 *                                           { "urls": ["https://..."] }
 *   - DARKHORSE_CHROME_PATH=<exe>           override browser executable
 *
 * Default URL list: extracted from the existing seed fixture so a live run
 * re-scrapes exactly the 9 priority reference architectures. Add more by
 * pointing DARKHORSE_ARCH_CENTER_URLS_FILE at a JSON file with a "urls" array.
 */
function buildArchitectureCenterFetcher() {
    const fs = require('fs');
    const path = require('path');
    const live = ['1', 'true', 'yes'].includes((process.env.DARKHORSE_ARCH_CENTER_LIVE ?? '').toLowerCase());
    if (!live) {
        return new ArchitectureCenterFetcher_1.ArchitectureCenterFetcher({ live: false });
    }
    // Seed URLs: merged from fixture + optional URLS_FILE. These are used as
    // fallback if sitemap discovery returns nothing, and to fill any gaps.
    const seedPath = path.resolve(__dirname, '..', 'fixtures', 'architecture-center-seed.json');
    const seedUrls = [];
    if (fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        for (const e of seed.entries ?? []) {
            if (e.url)
                seedUrls.push(e.url);
        }
    }
    const extraFile = process.env.DARKHORSE_ARCH_CENTER_URLS_FILE;
    if (extraFile) {
        if (!fs.existsSync(extraFile)) {
            throw new Error(`architecture-center: DARKHORSE_ARCH_CENTER_URLS_FILE not found at ${extraFile}`);
        }
        const extra = JSON.parse(fs.readFileSync(extraFile, 'utf-8'));
        for (const u of extra.urls ?? []) {
            if (u)
                seedUrls.push(u);
        }
    }
    return new ArchitectureCenterFetcher_1.ArchitectureCenterFetcher({
        live: true,
        discoverUrls: true, // fetch sitemap.xml → all /docs/ref-arch/* URLs
        urls: seedUrls, // merged as fallback / gap-filler
        chromePath: process.env.DARKHORSE_CHROME_PATH
    });
}
function selectBackends(snapshotPath) {
    const reasons = [];
    const aoiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const aoiKey = process.env.AZURE_OPENAI_KEY;
    const aoiDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
    const azureOpenAiReady = Boolean(aoiEndpoint && aoiKey && aoiDeployment);
    const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
    const searchKey = process.env.AZURE_SEARCH_KEY;
    const indexName = process.env.DARKHORSE_RAG_INDEX_NAME ?? 'darkhorse-sap-knowledge-v1';
    const azureSearchReady = Boolean(searchEndpoint && searchKey);
    let embedder;
    let embedderKind;
    if (azureOpenAiReady) {
        embedder = new AzureOpenAiEmbedder_1.AzureOpenAiEmbedder({
            endpoint: aoiEndpoint,
            apiKey: aoiKey,
            embeddingDeployment: aoiDeployment
        });
        embedderKind = 'azure-openai';
        reasons.push(`Embedder: Azure OpenAI (deployment=${aoiDeployment})`);
    }
    else {
        embedder = new MockEmbedder_1.MockEmbedder();
        embedderKind = 'mock';
        reasons.push('Embedder: MockEmbedder — AZURE_OPENAI_ENDPOINT/KEY/EMBEDDING_DEPLOYMENT not set');
    }
    let index;
    let indexKind;
    if (azureSearchReady) {
        index = new AzureAiSearchVectorIndex_1.AzureAiSearchVectorIndex({
            endpoint: searchEndpoint,
            apiKey: searchKey,
            indexName,
            dimensions: 1536
        });
        indexKind = 'azure-ai-search';
        reasons.push(`Index: Azure AI Search (index=${indexName})`);
    }
    else {
        index = new InMemoryVectorIndex_1.InMemoryVectorIndex({ snapshotPath });
        indexKind = 'in-memory';
        reasons.push('Index: InMemoryVectorIndex — AZURE_SEARCH_ENDPOINT/KEY not set');
    }
    return { embedder, index, embedderKind, indexKind, reasons };
}
function parseArgs(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
        return { command: 'help' };
    }
    const command = args[0];
    if (command !== 'ingest' && command !== 'verify' && command !== 'refresh') {
        throw new Error(`Unknown command "${command}". Try: ingest | verify | refresh | help`);
    }
    const out = { command };
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--snapshot') {
            out.snapshot = args[++i];
        }
        else if (a === '--source') {
            out.refreshSource = args[++i];
        }
        else if (!a.startsWith('--') && command === 'ingest' && !out.source) {
            out.source = a;
        }
        else if (!a.startsWith('--') && command === 'refresh' && !out.refreshSource) {
            out.refreshSource = a;
        }
        else {
            throw new Error(`Unexpected argument "${a}".`);
        }
    }
    if (command === 'ingest' && !out.source) {
        throw new Error('ingest: source argument required, e.g. `ingest sap-api-hub`');
    }
    if (command === 'refresh' && !out.refreshSource) {
        out.refreshSource = 'all'; // default to refreshing every external source we know
    }
    return out;
}
// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function runIngest(source, snapshotPath) {
    const chunker = new TokenChunker_1.TokenChunker();
    const backends = selectBackends(snapshotPath);
    const sourcesToRun = source === 'all' ? KNOWN_SOURCES : [source];
    const summaries = [];
    for (const s of sourcesToRun) {
        const fetcher = buildFetcher(s);
        const summary = await new Pipeline_1.Pipeline({
            fetcher, chunker,
            embedder: backends.embedder,
            index: backends.index
        }).ingest();
        summaries.push(summary);
    }
    // Only the in-memory index supports snapshot persist. Azure persists naturally.
    if (snapshotPath && backends.indexKind === 'in-memory') {
        backends.index.persist(snapshotPath);
    }
    const stats = await backends.index.stats();
    process.stdout.write(JSON.stringify({
        backends: backends.reasons,
        summaries,
        stats
    }, null, 2) + '\n');
}
async function runVerify(snapshotPath) {
    // If no snapshot AND no Azure backend, do a quick in-memory ingest of every
    // known source so verify always has something to probe.
    const chunker = new TokenChunker_1.TokenChunker();
    const backends = selectBackends(snapshotPath);
    const shouldSeedInMemory = !snapshotPath && backends.indexKind === 'in-memory';
    if (shouldSeedInMemory) {
        for (const s of KNOWN_SOURCES) {
            const fetcher = buildFetcher(s);
            await new Pipeline_1.Pipeline({
                fetcher, chunker,
                embedder: backends.embedder,
                index: backends.index
            }).ingest();
        }
    }
    const index = backends.index;
    // Acceptance probes — Sprint-1 failure modes plus Sprint-2 session-2
    // Clean Core pattern lookups. Each probe expects either a hit or a
    // confirmed miss (for known LLM hallucinations).
    const probes = [
        // Sprint-1 — SAP API Hub entries
        { name: 'I_SalesOrder exists', objectName: 'I_SalesOrder', expectFound: true },
        { name: 'ATP_CUST_BADI exists', objectName: 'ATP_CUST_BADI', expectFound: true },
        { name: 'BADI_SD_SALES_BASIC exists', objectName: 'BADI_SD_SALES_BASIC', expectFound: true },
        { name: 'I_SalesOrderTP exists', objectName: 'I_SalesOrderTP', expectFound: true },
        { name: 'USEREXIT_ATP_QUANTITY absent', objectName: 'USEREXIT_ATP_QUANTITY', expectFound: false },
        // Sprint-2 session-2 — Clean Core Extensibility Guide patterns
        { name: 'LEVEL_A_DEFINITION pattern', objectName: 'LEVEL_A_DEFINITION', expectFound: true },
        { name: 'LEVEL_D_DEFINITION pattern', objectName: 'LEVEL_D_DEFINITION', expectFound: true },
        { name: 'RAP_TRANSACTIONAL pattern', objectName: 'RAP_TRANSACTIONAL', expectFound: true },
        { name: 'CDS_READ_ACCESS pattern', objectName: 'CDS_READ_ACCESS', expectFound: true },
        { name: 'SLG1_LOGGING pattern', objectName: 'SLG1_LOGGING', expectFound: true },
        { name: 'CBO_CUSTOM_PERSISTENT pattern', objectName: 'CBO_CUSTOM_PERSISTENT', expectFound: true },
        { name: 'NONEXISTENT_RULE absent', objectName: 'NONEXISTENT_RULE', expectFound: false },
        // Sprint-2 session-3 — Architecture Center reference architectures
        { name: 'AGENTIC_AI_AGENTS arch', objectName: 'AGENTIC_AI_AGENTS', expectFound: true },
        { name: 'GENAI_BTP arch', objectName: 'GENAI_BTP', expectFound: true },
        { name: 'A2A_INTEGRATION arch', objectName: 'A2A_INTEGRATION', expectFound: true },
        { name: 'DEVOPS_BTP arch', objectName: 'DEVOPS_BTP', expectFound: true },
        { name: 'NETWEAVER_TRANSITION arch', objectName: 'NETWEAVER_TRANSITION', expectFound: true },
        { name: 'BUILD_PROCESS_AUTOMATION arch', objectName: 'BUILD_PROCESS_AUTOMATION', expectFound: true },
        { name: 'RAP_ON_S4HANA arch', objectName: 'RAP_ON_S4HANA', expectFound: true }
    ];
    const results = [];
    for (const probe of probes) {
        const hits = await index.lookupByName(probe.objectName);
        const found = hits.length > 0;
        results.push({
            probe: probe.name,
            pass: found === probe.expectFound,
            hits: hits.length,
            topHit: hits[0]?.chunk?.title
        });
    }
    const stats = await index.stats();
    const allPass = results.every(r => r.pass);
    process.stdout.write(JSON.stringify({
        verdict: allPass ? 'PASS' : 'FAIL',
        backends: backends.reasons,
        stats,
        probes: results
    }, null, 2) + '\n');
    if (!allPass) {
        process.exitCode = 1;
    }
}
const CLOUDIFICATION_BASE_URL = process.env.DARKHORSE_CLOUDIFICATION_BASE_URL ??
    'https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src';
const CLOUDIFICATION_FILES = [
    {
        filename: 'objectReleaseInfoLatest.json',
        url: `${CLOUDIFICATION_BASE_URL}/objectReleaseInfoLatest.json`,
        arrayKey: 'objectReleaseInfo'
    },
    {
        filename: 'objectReleaseInfo_PCELatest.json',
        url: `${CLOUDIFICATION_BASE_URL}/objectReleaseInfo_PCELatest.json`,
        arrayKey: 'objectReleaseInfo'
    },
    {
        filename: 'objectClassifications_SAP.json',
        url: `${CLOUDIFICATION_BASE_URL}/objectClassifications_SAP.json`,
        arrayKey: 'objectClassifications'
    }
];
async function runRefresh(refreshSource) {
    const fs = require('fs');
    const path = require('path');
    if (refreshSource !== 'cloudification' && refreshSource !== 'all') {
        throw new Error(`Unknown refresh source "${refreshSource}". Known: cloudification | all`);
    }
    // __dirname is dist/ at runtime → walk up to package root → fixtures/cloudification.
    const outDir = path.resolve(__dirname, '..', 'fixtures', 'cloudification');
    fs.mkdirSync(outDir, { recursive: true });
    const results = [];
    for (const spec of CLOUDIFICATION_FILES) {
        const target = path.join(outDir, spec.filename);
        // Count entries in the existing file (if any) so we can report a delta.
        let countBefore = null;
        if (fs.existsSync(target)) {
            try {
                const before = JSON.parse(fs.readFileSync(target, 'utf-8'));
                countBefore = Array.isArray(before[spec.arrayKey]) ? before[spec.arrayKey].length : null;
            }
            catch {
                // Existing file is unreadable — treat as "no previous count".
                countBefore = null;
            }
        }
        const start = Date.now();
        process.stdout.write(`refresh: GET ${spec.url}\n`);
        const res = await fetch(spec.url);
        if (!res.ok) {
            throw new Error(`refresh: ${spec.filename} → HTTP ${res.status} ${res.statusText}`);
        }
        const text = await res.text();
        // Validate JSON before clobbering existing file so a corrupt response
        // doesn't wipe out a previously good snapshot.
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (err) {
            throw new Error(`refresh: ${spec.filename} returned invalid JSON — ${err.message}`);
        }
        const list = parsed[spec.arrayKey];
        if (!Array.isArray(list)) {
            throw new Error(`refresh: ${spec.filename} missing expected "${spec.arrayKey}" array`);
        }
        fs.writeFileSync(target, text);
        const countAfter = list.length;
        results.push({
            filename: spec.filename,
            url: spec.url,
            bytesDownloaded: Buffer.byteLength(text),
            countBefore,
            countAfter,
            delta: countBefore == null ? null : countAfter - countBefore,
            durationMs: Date.now() - start
        });
    }
    const totalAfter = results.reduce((acc, r) => acc + r.countAfter, 0);
    const totalBefore = results.reduce((acc, r) => acc + (r.countBefore ?? 0), 0);
    const totalBytes = results.reduce((acc, r) => acc + r.bytesDownloaded, 0);
    process.stdout.write(JSON.stringify({
        refreshSource,
        outDir,
        files: results,
        summary: {
            filesRefreshed: results.length,
            totalEntriesBefore: totalBefore,
            totalEntriesAfter: totalAfter,
            totalDelta: totalAfter - totalBefore,
            totalBytes
        },
        nextStep: 'Files written. If your git status shows the JSON files changed, review with ' +
            '`git diff --stat services/darkhorse-ingest/fixtures/cloudification/` and commit with ' +
            'a message like "data: refresh SAP cloudification snapshot YYYY-MM-DD".'
    }, null, 2) + '\n');
}
function printHelp() {
    process.stdout.write(`darkhorse-ingest — Sprint 2 RAG ingestion pipeline.

Commands:
  ingest <source> [--snapshot <path>]
      Run fetch → chunk → embed → index for <source>.
      Sources: sap-api-hub | sap-api-hub-edmx | clean-core-guide
             | architecture-center | help-portal-cds | all

      sap-api-hub-edmx — bulk field metadata from api.sap.com $metadata XML.
      Walks a curated SD/MM/FI/PP service-name list and downloads each
      service's $metadata directly (the OData catalog endpoint at
      api.sap.com/odata/1.0/catalog.svc returns SPA HTML, not real data).

      api.sap.com gates EDMX behind login — provide ONE of these auth vars:
        DARKHORSE_API_HUB_API_KEY=<key>         personal API key
        DARKHORSE_API_HUB_BEARER=<token>        OAuth2 bearer
        DARKHORSE_API_HUB_COOKIE=<cookie>       browser session cookie

      Run env vars:
        DARKHORSE_API_HUB_EDMX_LIVE=true        (default: false → fixture only)
        DARKHORSE_API_HUB_EDMX_DIAGNOSE=true    fetch ONE service + print full
                                                response details (use to iterate
                                                on auth before scraping all)
        DARKHORSE_API_HUB_EDMX_SERVICES=A,B,C   override the curated list
        DARKHORSE_API_HUB_EDMX_MAX=N            limit services per run
        DARKHORSE_API_HUB_EDMX_CHECKPOINT=<jsonl-resume-log>
        DARKHORSE_API_HUB_EDMX_RATE_MS=500      ms between downloads
      Optional --snapshot writes a JSON snapshot for the verify command
      and later sessions.

      sap-api-hub-catalog — full catalog via OData API (no browser needed).
      Pages through 5,230 APIs and 2,100 integration packages using an API key.
      Writes fixtures/api-hub-catalog.json for offline replay.
        DARKHORSE_API_HUB_APIKEY=<key>          required for live mode
        DARKHORSE_API_HUB_CATALOG_LIVE=true     enable live paging
        DARKHORSE_API_HUB_CATALOG_SETS=APIs,ContentPackages  subset
        DARKHORSE_API_HUB_CATALOG_MAX=N         cap records per set

      sap-api-hub-search — full catalog scrape via the 9 search tabs.
      Discovers ALL APIs, CDS Views, Integration Flows, Events, etc.
      Writes fixtures/api-hub-search-discovery.json (OData service names
      feed directly into the EdmxFetcher for bulk field-schema download).
        DARKHORSE_API_HUB_SEARCH_LIVE=true      enable live scrape
        DARKHORSE_API_HUB_SEARCH_CATS=APIs,CDS Views  specific tabs only
        DARKHORSE_API_HUB_SEARCH_MAX=N          cap items per category
        DARKHORSE_API_HUB_COOKIE=<cookie>       session cookie (if needed)
        DARKHORSE_CHROME_PATH=<exe>             browser override

      architecture-center env vars (only needed for live mode):
        DARKHORSE_ARCH_CENTER_LIVE=true          headless-Chrome scrape of ALL
                                                 ref-archs (auto-discovered from
                                                 sitemap.xml, ~87 pages)
        DARKHORSE_ARCH_CENTER_URLS_FILE=<path>   extra URLs JSON { "urls": [...] }
        DARKHORSE_CHROME_PATH=<optional browser exe override>
        Seed URLs from fixtures/architecture-center-seed.json fill any
        sitemap gaps.

      help-portal-cds env vars (only needed for live mode):
        DARKHORSE_HELP_PORTAL_LIVE=true
        DARKHORSE_HELP_PORTAL_ROOT_URL=<url>     crawl from this index page
                                                 (recommended — auto-discovers
                                                 all CDS view child pages)
        DARKHORSE_HELP_PORTAL_MAX_PAGES=500      page cap for crawl
        DARKHORSE_HELP_PORTAL_MAX_DEPTH=3        crawl depth cap
        DARKHORSE_HELP_PORTAL_TARGETS=<path>     flat list mode (legacy)
        DARKHORSE_HELP_PORTAL_CHECKPOINT=<path>  resume JSONL log
        DARKHORSE_CHROME_PATH=<optional browser exe override>

  verify [--snapshot <path>]
      Probe the index with known SAP references and report pass/fail.
      If no snapshot is given, an in-memory ingest runs first.

  refresh [<source> | --source <source>]
      Re-download canonical external data sources to fixtures/.
      Sources: cloudification (SAP/abap-atc-cr-cv-s4hc JSONs) | all (default).
      Prints an entry-count delta so you can decide whether to commit.
      Override the base URL via DARKHORSE_CLOUDIFICATION_BASE_URL.

  help
      Show this message.

Backend selection (env vars, all optional):
  AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_EMBEDDING_DEPLOYMENT
      If all three are set, embeddings are generated by Azure OpenAI.
      Otherwise the MockEmbedder is used (deterministic, non-semantic).
  AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY
      If both are set, vectors are stored in Azure AI Search.
      Otherwise the InMemoryVectorIndex is used.
  DARKHORSE_RAG_INDEX_NAME
      Azure AI Search index name. Default: darkhorse-sap-knowledge-v1.
`);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    let parsed;
    try {
        parsed = parseArgs(process.argv);
    }
    catch (err) {
        process.stderr.write(`darkhorse-ingest: ${err.message}\n`);
        process.stderr.write('Try `darkhorse-ingest help` for usage.\n');
        process.exit(1);
    }
    switch (parsed.command) {
        case 'help':
            printHelp();
            return;
        case 'ingest':
            await runIngest(parsed.source, parsed.snapshot);
            return;
        case 'verify':
            await runVerify(parsed.snapshot);
            return;
        case 'refresh':
            await runRefresh(parsed.refreshSource);
            return;
    }
}
main().catch((err) => {
    process.stderr.write(`darkhorse-ingest: FATAL ${err.message}\n${err.stack ?? ''}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map