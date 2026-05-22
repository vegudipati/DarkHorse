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
const CleanCoreGuideFetcher_1 = require("./fetchers/CleanCoreGuideFetcher");
const ArchitectureCenterFetcher_1 = require("./fetchers/ArchitectureCenterFetcher");
const TokenChunker_1 = require("./chunker/TokenChunker");
const MockEmbedder_1 = require("./embedders/MockEmbedder");
const AzureOpenAiEmbedder_1 = require("./embedders/AzureOpenAiEmbedder");
const InMemoryVectorIndex_1 = require("./indexes/InMemoryVectorIndex");
const AzureAiSearchVectorIndex_1 = require("./indexes/AzureAiSearchVectorIndex");
const KNOWN_SOURCES = [
    'sap-api-hub',
    'clean-core-guide',
    'architecture-center'
];
function buildFetcher(source) {
    switch (source) {
        case 'sap-api-hub': return new SapApiHubFetcher_1.SapApiHubFetcher({ live: false });
        case 'clean-core-guide': return new CleanCoreGuideFetcher_1.CleanCoreGuideFetcher({ live: false });
        case 'architecture-center': return new ArchitectureCenterFetcher_1.ArchitectureCenterFetcher({ live: false });
        default:
            throw new Error(`Unknown source "${source}". Known sources: ${KNOWN_SOURCES.join(', ')}`);
    }
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
    if (command !== 'ingest' && command !== 'verify') {
        throw new Error(`Unknown command "${command}". Try: ingest | verify | help`);
    }
    const out = { command };
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === '--snapshot') {
            out.snapshot = args[++i];
        }
        else if (!a.startsWith('--') && command === 'ingest' && !out.source) {
            out.source = a;
        }
        else {
            throw new Error(`Unexpected argument "${a}".`);
        }
    }
    if (command === 'ingest' && !out.source) {
        throw new Error('ingest: source argument required, e.g. `ingest sap-api-hub`');
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
function printHelp() {
    process.stdout.write(`darkhorse-ingest — Sprint 2 RAG ingestion pipeline.

Commands:
  ingest <source> [--snapshot <path>]
      Run fetch → chunk → embed → index for <source>.
      Sources: sap-api-hub | clean-core-guide | architecture-center | all
      Optional --snapshot writes a JSON snapshot for the verify command
      and later sessions.

  verify [--snapshot <path>]
      Probe the index with known SAP references and report pass/fail.
      If no snapshot is given, an in-memory ingest runs first.

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
    }
}
main().catch((err) => {
    process.stderr.write(`darkhorse-ingest: FATAL ${err.message}\n${err.stack ?? ''}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map