# DarkHorse 09 - Azure Deployment Architecture

Status: recommendation (2026-10-23). Not yet implemented.

## 1. Decision: Azure over GCP
- KB code is already Azure: `AzureOpenAiEmbedder`, `AzureAiSearchVectorIndex`, `AZURE_SEARCH_*` env in the MCP server.
- SAP / Deloitte clients are mostly Microsoft shops (Entra ID, private networking, Azure OpenAI already approved).
- Azure OpenAI keeps data in the client's tenant (see 01_Architecture section 6.1).
- GCP would only win on Gemini/Vertex quality, which does not justify rewriting embedder + index + re-ingesting.

## 2. Target architecture

```
DarkHorse Editor (VS Code fork, dev machines)
   | HTTPS + Entra ID token
   v
Azure API Management (auth, rate limits, audit)
   +-> Agent service  (Container Apps)  <- extensions/darkhorse-agents + pipeline logic
   +-> MCP server     (Container Apps)  <- services/darkhorse-mcp
   +-> LLM proxy      (Container Apps)  <- services/llm-proxy (scrubbing)
            |
            v
   Azure OpenAI / Foundry   chat model + text-embedding-3
   Azure AI Search          hybrid vector+keyword KB index (+ semantic ranker)
   Cosmos DB                memory: sessions, project context
   Blob Storage             raw SAP docs, Clean Core PDFs, generated artifacts
   Key Vault + Managed ID   no secrets in config
   App Insights             telemetry

Ingest (Container Apps Job, scheduled): fetchers -> chunk -> embed -> AI Search
```

## 3. RAG sources
Pipeline: `services/darkhorse-ingest` (IFetcher -> IChunker -> IEmbedder -> IVectorIndex).

| Source | Fetcher | Notes |
|--------|---------|-------|
| SAP API Business Hub (catalog, search, EDMX) | SapApiHub* | released API / OData metadata |
| Clean Core Guide (PDF) | CleanCoreGuideFetcher | store PDFs in Blob |
| SAP Architecture Center | ArchitectureCenterFetcher | puppeteer-core, needs headless browser in the job image |
| SAP Help Portal | HelpPortalFetcher | |

- Runs as a scheduled Container Apps Job (nightly/weekly), not inside the always-on services.
- Raw fetched content cached in Blob; vectors + metadata in AI Search index `darkhorse-sap-knowledge-v1`.
- Index metadata filters: object type, released-API status (C1), S/4 version, source.
- Second index for long-term memory (approved patterns, past reviews).
- Coverage gaps tracked in `DarkHorse_08_KB_Assessment.md`.

## 4. MCP server
- Deployed as its own Container App (`services/darkhorse-mcp`), min replicas 1 (editor sessions are interactive), internal ingress behind APIM.
- Reads `AZURE_SEARCH_ENDPOINT`, `DARKHORSE_RAG_INDEX_NAME`, port `DARKHORSE_MCP_PORT` (default 47292).
- Move from `AZURE_SEARCH_KEY` to managed identity (Search Index Data Reader role).
- Editor connects to the APIM URL instead of localhost.
- Stateless: scale out freely; memory lives in Cosmos, not in the process.

## 5. Clean Core accuracy loop
1. Retrieve (hybrid + semantic rank, filtered to released APIs).
2. Generate with citations to retrieved chunks.
3. Validate against released-API list / ATC Clean Core checks.
4. Retry on violations; log failures for KB gap analysis.

## 6. Deployment steps
1. Bicep/Terraform per environment: OpenAI (chat + embeddings), AI Search S1 + semantic ranker, Cosmos, Storage, Key Vault, ACR, Container Apps env, APIM.
2. Dockerfile per service (mcp, llm-proxy, agents, ingest job); push to ACR.
3. GitHub Actions: build, push, `az containerapp update`; scheduled ingest job.
4. Entra ID app registration; APIM validates JWT; services use managed identity.
5. Editor config: endpoint per client, ship `.vsix` with configurable URL.
6. Per-client mode: same template in client subscription; high-security adds VNet + Private Endpoints, no public access.

## 7. Cost (dev / small team)
~USD 300-800/month: AI Search S1 (~250), Container Apps (~50-150, scale to zero for non-MCP), Azure OpenAI usage-based.

## 8. Open decisions
- Central multi-tenant Deloitte instance vs per-client deployment.
- Chat model per available Azure OpenAI quota (GPT-4o in doc; check newer / Claude on Foundry via adapter).
