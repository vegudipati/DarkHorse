# DarkHorse Progress Log

> Running log of shipped work and pipeline. Update whenever we ship or change what's queued.

**Last updated:** 2026-05-26
**Current version:** v0.7.37 (ingest)
**Branch state:** clean, pushed to `origin/main`

---

## In Progress

- **EDMX live run** — EDMX binary download still requires XSUAA auth (APIKey unlocks catalog list but not `/$value` download). BTP trial path or bearer token still needed.

## Pipeline (Not Started)
- **LearningPortalFetcher** — lowest priority.
- **Sprint 7 — Agent Marketplace** — per `docs/DarkHorse_06_CPI6_RAG_MCP.md` §Sprint 7.
- **help-portal-cds re-crawl** — current 501-page crawl has GUID-based viewNames, not ABAP technical names. Needs a re-crawl targeting per-view detail pages where ABAP names appear in breadcrumbs.

---

## Completed

### CPI-6 Sprints — RAG + MCP Intelligence Layer

Spec: `docs/DarkHorse_06_CPI6_RAG_MCP.md`.

| Sprint | Summary |
|---|---|
| **1** | `services/darkhorse-mcp/` scaffold; tools `verify_badi`, `verify_exit`, `check_clean_core_level`, `get_application_log_pattern`. Post-gen Clean Core verifier wired into `ObjectCodeGenerator.ts`, fail-open when MCP unreachable. |
| **2** | `services/darkhorse-ingest/` with `IFetcher`/`IChunker`/`IEmbedder`/`IVectorIndex`. Fetchers: SAP API Hub, Clean Core Guide (pdf-parse), Architecture Center (puppeteer-core). AzureOpenAi embedder + AzureAiSearch index. `KnowledgeProvider` abstraction (static + Azure + composite) in MCP. |
| **3** | Code Agent grounded via MCP. New tools: `get_cds_view`, `get_eml_syntax`, `get_rap_pattern`. `CodeAgentGrounder.ts` calls MCP in parallel before generation. |
| **4** | TDS Agent grounded. New tool `get_cbo_pattern`. `TdsAgentGrounder.ts` renders grounding block; system prompt rewritten for explicit object-type policy. |
| **5** | SO + FDS Agents grounded. `SoAgentGrounder.ts` / `FdsAgentGrounder.ts` detect BAdI / exit name candidates and pre-verify via MCP. Full pipeline now grounded end-to-end. |
| **6** | Independent `ReviewAgent.ts` (LLM critic, runs parallel with verifier). Auto-rewrite for direct SAP-table SELECTs; auto-create `ZI_<TABLE>` wrappers when no released CDS view exists. Correction Store captures developer edits as `corrections/<obj>.correction.json` (local only, not yet indexed). |
| **7** | _Pending — Agent Marketplace._ |

### B-series — Code-generation correctness

| Tag | Version | Summary |
|---|---|---|
| B1–B5 | v0.7.14 | Pipeline code-gen correctness pass (bundled fix). |

### A-series — Clean Core depth & fidelity hardening

| Tag | Version | Summary |
|---|---|---|
| A1 | v0.7.15 (fix v0.7.22) | Three-layer Clean Core enforcement; require full layer set only when service intent is explicit. |
| A2 | v0.7.16 | Flag missing consumption-layer annotations on `ZI_*` interface views. |
| A3 | v0.7.17 | Authorization depth — DCL layer + `AUTHORITY-CHECK` rule. |
| A4 | v0.7.18 | HANA push-down rules + grounding. |
| A5 | v0.7.19 | ABAP Unit test enforcement + scaffolding. |
| A6 | v0.7.20 | ABAP Cloud / BTP cloud-readiness verifier + grounding. |
| A7 | v0.7.21 | abapGit-layout output writer. |
| A8 | v0.7.32 | Enhancement-scenario grounding + classic-enhancement verifier. |
| A9 | v0.7.33 (fix v0.7.34) | FDS-fidelity anchors. |
| A10 | v0.7.33 | Completeness detector. |
| A11 | v0.7.34 | Fidelity verifier. |

### Pipeline UX

| Version | Summary |
|---|---|
| v0.7.23 | Auto-fill missing Clean Core layers on every TDS. |
| v0.7.24 | Auto-fill at TDS approval time too — no more modal. |
| v0.7.25 | Don't force every entity into a full service stack. |
| v0.7.26 | Refresh TDS `.docx` + emit generation report after Approve/Accept. |
| v0.7.27 | Selective regen — regenerate one object without re-running the pipeline. |
| v0.7.28 | Multi-pipeline — concurrent BRs with switch/delete + status bar. |
| v0.7.29 | Reusable-objects marketplace — cross-pipeline catalog. |
| v0.7.30 | Pipeline tracker shows all pipelines as collapsible roots. |
| v0.7.31 | Start pipeline from RICEFW/RTM JSON intake. |

### Reliability

| Version | Summary |
|---|---|
| v0.7.35 | Hard absolute timeouts on LLM proxy + MCP calls. |
| v0.7.36 | Architecture Center live mode — `DARKHORSE_ARCH_CENTER_LIVE=true` scrapes 9 priority ref-archs via headless Chrome; optional extra URLs via `DARKHORSE_ARCH_CENTER_URLS_FILE`. |

### Knowledge-base expansion

| Date | Summary |
|---|---|
| 2026-05-25 | **MCP catalog: 38 → ~66K entries.** Wired SAP's official Cloudification Repository (github.com/SAP/abap-atc-cr-cv-s4hc) — 1,337 BAdIs, 7,566 CDS views, 311 BDEFs, 11,404 tables with successor recommendations. New `CloudificationCatalogProvider` + `TerminalStubProvider`. Chain: Static (curated) → Cloudification (comprehensive) → Azure (optional) → Terminal (heuristic). Smoke test confirms LIKP/LIPS/KNVV now return correct successors (I_DELIVERYDOCUMENT etc.) — the exact tables the ZOTC routing report unnecessarily wrapped in Z views. |
| 2026-05-25 | **End-to-end verified:** existing grounders + verifier consume `alternatives[]` already — Cloudification successors flow through `get_cds_view` and `check_clean_core_level` with zero code changes. **MCP server restart required** to activate. |
| 2026-05-25 | **Committed (`c9c3e31`):** MCP-side providers + `darkhorse-ingest refresh` CLI subcommand. **Committed (`511075e`):** 24 MB of vendored SAP cloudification JSON snapshot. |
| 2026-05-26 | **HelpPortalFetcher + CDS field catalog committed.** New puppeteer-core scraper for help.sap.com CDS reference pages. New `CdsFieldCatalogProvider` exposes per-view field arrays. `get_cds_view` tool now returns `fieldsDetail[]`. CodeAgentGrounder + TdsAgentGrounder render field tables in their prompt blocks. |
| 2026-05-26 | **SapApiHubEdmxFetcher committed.** Bulk field-metadata via direct `$metadata` download — curated 25-service SD/MM/FI/PP list (`DEFAULT_SERVICE_NAMES`), no catalog discovery (api.sap.com OData catalog endpoint returns SPA HTML). Auth support: `APIKey` / `Bearer` / `Cookie` headers. Diagnose mode fetches one service + prints full response for auth iteration. Env vars: `DARKHORSE_API_HUB_API_KEY`, `DARKHORSE_API_HUB_BEARER`, `DARKHORSE_API_HUB_COOKIE`, `DARKHORSE_API_HUB_EDMX_DIAGNOSE`. |
| 2026-05-26 | **SapApiHubSearchFetcher committed (v0.7.36).** Headless-Chrome scraper for all 9 api.sap.com search tabs (APIs, CDS Views, Integrations, Events, VPUC, Build, Process Blueprints, Analytics, Data Products). Link-href extraction robust to SPA class-name churn. Requires session auth — superseded by catalog API approach for APIs/Packages. |
| 2026-05-26 | **SapApiHubCatalogFetcher committed (v0.7.37).** No browser required — pages through `APIContent.APIs` (5,230) and `ContentPackages` (2,100) via OData catalog API + APIKey. Full 7,330-document catalog fetched in 33s; snapshot committed to `fixtures/api-hub-catalog.json` for instant offline replay. Fields include ServiceCode, State, Deprecated, Successors, BusinessObjects per API and Vendor, BusinessProcess, Products, CertifiedBySap per package. |

---

## Conventions

- **One-line per ship.** Add a row to the relevant table when bumping the extension version.
- **Move queued items up.** When an item starts, move it from _Pipeline_ to _In Progress_; when it ships, move it down to _Completed_.
- **Date format:** `YYYY-MM-DD`.
- **Source of truth for sprint design** stays in `docs/DarkHorse_06_CPI6_RAG_MCP.md`. This file tracks *status*, not *design*.
