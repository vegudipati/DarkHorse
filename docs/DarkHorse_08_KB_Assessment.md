# DarkHorse — Knowledge Base Assessment

> Tracks completeness of every knowledge domain the MCP intelligence layer draws from.
> Update whenever a new source is ingested, a blocker is resolved, or counts change.

**Last updated:** 2026-05-26
**Assessed against:** S/4HANA on-premise + S/4HANA Cloud (PCE) published catalogs

---

## Coverage Table

| # | Knowledge Base | Total in SAP vs Loaded | 10% | 20% | 30% | 40% | 50% | 60% | 70% | 80% | 90% | 100% | Steps to reach 100% |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | **OData / REST / SOAP APIs** — name, description, protocol, deprecation, successors | ~5,230 published on SAP Hub vs **5,230 loaded** | | | | | | | | | | ● | Periodic re-run of `sap-api-hub-catalog`. Already complete. |
| 2 | **Integration Packages** — vendor, products, business process, SAP-certified flag | ~2,100 on SAP Hub vs **2,100 loaded** | | | | | | | | | | ● | Already complete. Refresh quarterly. |
| 3 | **Architecture Patterns** — full reference architecture text from SAP Architecture Center | ~87 ref-archs vs **~87 loaded** | | | | | | | | | | ● | Already complete. Sitemap auto-discovers additions. |
| 4 | **Clean Core Principles & Policy** — guide text, level rules, extensibility patterns | 1 SAP guide vs **1 loaded** | | | | | | | | | | ● | Re-ingest when SAP publishes a new guide version. |
| 5 | **CDS Views — names, descriptions, successors** — which view serves which domain | ~8,000 released S/4HANA views vs **7,566 loaded** (cloudification repo) | | | | | | | | | ● | | (1) Load PCE dataset (7,927 views — adds Cloud-only views); (2) Sync cloudification repo periodically from SAP/abap-atc-cr-cv-s4hc. |
| 6 | **Database Tables → Clean Core successor mapping** — which CDS view replaces which table | ~15,000 upgrade-relevant tables vs **11,404 loaded** | | | | | | | ● | | | | (1) Load PCE supplement (2,832 cloud tables); (2) Periodic GitHub sync from SAP/abap-atc-cr-cv-s4hc. |
| 7 | **BAdIs** — which BAdI to implement for which business event | ~5,000–6,000 in S/4HANA vs **1,206 loaded** (cloudification) | | ● | | | | | | | | | (1) Unlock `BADIEntities` on api.sap.com (requires XSUAA bearer token — same block as rows 8 & 9); (2) Alternatively parse from SE18 catalog export from a connected S/4HANA system. |
| 8 | **CDS View field schemas** — actual field names and types needed for code generation | ~7,566 views with schemas vs **~0 usable** (464 scraped but GUID-named, not ABAP name) | ● | | | | | | | | | | (1) Re-crawl help.sap.com targeting per-view detail pages where ABAP names appear in breadcrumbs; (2) Resolve XSUAA for EDMX binary download — one bearer token unlocks all 5,230 API field schemas. |
| 9 | **Enhancement Exits — classical** — user exits, customer exits, enhancement spots | ~5,000–8,000 in S/4HANA vs **13 curated** entries | ● | | | | | | | | | | Same XSUAA block as rows 7 & 8. Alternative: enumerate from SMOD/CMOD table export or SAP documentation scrape. |
| 10 | **ABAP Classes & Interfaces — released** — clean-core-compliant OO objects to use | ~20,000 released vs **1,718 classes + 1,313 interfaces loaded** (cloudification) | | ● | | | | | | | | | Load `objectClassifications_SAP.json` into vector index (currently in fixture only, not yet embedded). PCE adds 1,362 classes + 3,043 interfaces. |

---

## Source Inventory

| Source key | Fetcher | Live mode | Records loaded | Fixture path | Last run |
|---|---|---|---|---|---|
| `sap-api-hub-catalog` | `SapApiHubCatalogFetcher` | OData API + APIKey | 5,230 APIs + 2,100 packages | `fixtures/api-hub-catalog.json` | 2026-05-26 |
| `architecture-center` | `ArchitectureCenterFetcher` | Puppeteer + sitemap | ~87 patterns | `fixtures/architecture-center-seed.json` | 2026-05-26 |
| `clean-core-guide` | `CleanCoreGuideFetcher` | PDF parse | 1 guide | `fixtures/clean-core-guide-seed.json` | 2026-05-21 |
| `sap-api-hub` | `SapApiHubFetcher` | Fixture only | 13 curated entries | `fixtures/sap-api-hub-seed.json` | 2026-05-21 |
| `help-portal-cds` | `HelpPortalFetcher` | Puppeteer crawl | 501 pages, 464 with field tables | `fixtures/help-portal-cds-seed.json` | 2026-05-25 |
| `sap-api-hub-edmx` | `SapApiHubEdmxFetcher` | **BLOCKED** (XSUAA) | 0 | `fixtures/api-sap-hub-edmx.snapshot.json` | — |
| `sap-api-hub-search` | `SapApiHubSearchFetcher` | **BLOCKED** (XSUAA) | 0 | `fixtures/api-hub-search-seed.json` | — |
| Cloudification (MCP) | `CloudificationCatalogProvider` | GitHub snapshot | 34,675 objects | `fixtures/cloudification/*.json` | 2026-05-21 |

---

## The Single Biggest Unblock

Rows 7, 8, and 9 share the same root cause: **XSUAA auth on api.sap.com**.

The `BADIEntities`, `CdsViews`, and enhancement exit endpoints all require an authenticated session that goes beyond the public APIKey. One bearer token extracted from the browser's Network tab (any request to `catalog.svc` while logged in to api.sap.com) would unlock all three simultaneously.

**How to get the bearer token:**
1. Open `https://api.sap.com/search?searchterm=&tab=APIs` while logged in
2. F12 → Network tab → filter for `catalog.svc`
3. Click any matching request → Headers → copy `Authorization: Bearer <token>`
4. Set `DARKHORSE_API_HUB_BEARER=<token>` and re-run ingest

Token lifetime is typically 12–24 hours. Once obtained, a single run populates BAdIs, CDS schemas, and exits.

---

## Counts Reference

Derived from `fixtures/cloudification/objectReleaseInfoLatest.json` (S/4HANA on-prem):

| Object type | Count in cloudification repo | Loaded in KB |
|---|---|---|
| TABL (transparent tables) | 11,404 | ✅ 11,404 |
| CDS_STOB (CDS views) | 7,566 | ✅ 7,566 (names/successors only) |
| DTEL (data elements) | 5,463 | ❌ not yet embedded |
| INTF (interfaces) | 3,278 | ⚠️ in fixture, not in vector index |
| TTYP (table types) | 2,462 | ❌ not yet embedded |
| CLAS (classes) | 1,448 | ⚠️ in fixture, not in vector index |
| BADI_DEF (BAdIs) | 1,206 | ✅ 1,206 via CloudificationCatalogProvider |
| BDEF (RAP behavior defs) | 311 | ⚠️ in fixture, not in vector index |
| FUNC (function modules) | 368 | ⚠️ in fixture, not in vector index |

PCE (S/4HANA Cloud) adds: 7,927 CDS views, 1,063 BAdIs, 376 BDEFs, 25,022 DTELs — **not yet merged**.

---

## Improvement Roadmap

| Priority | Action | Rows improved | Effort |
|---|---|---|---|
| 🔴 High | Obtain XSUAA bearer token from browser | 7, 8, 9 | 10 min |
| 🔴 High | Re-crawl help.sap.com to per-view pages (fix ABAP name extraction) | 8 | 2–3 hr compute |
| 🟡 Medium | Load PCE cloudification dataset into vector index | 5, 6, 10 | 1 hr dev |
| 🟡 Medium | Embed cloudification INTF/CLAS/BDEF into vector index (currently fixture-only) | 10 | 1 hr dev |
| 🟢 Low | Periodic re-run of `sap-api-hub-catalog` (quarterly) | 1, 2 | 5 min |
| 🟢 Low | Periodic GitHub sync of SAP/abap-atc-cr-cv-s4hc | 5, 6, 7 | 30 min |
