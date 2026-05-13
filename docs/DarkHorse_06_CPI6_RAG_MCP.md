# DarkHorse — CPI-6: RAG + MCP Intelligence Layer
## Agentic Architecture for 80-100% Code Generation Accuracy
> Immediate Priority | Confidential — Deloitte Internal

---

## Why This Exists

DarkHorse CPI-4 generates documents and code that are approximately 20% accurate
against Clean Core Level A standards. The root cause is not the LLM — it is the
absence of grounded SAP knowledge at generation time.

The LLM defaults to classic ABAP patterns because that is what dominates its
training data. Without a real-time knowledge source telling it:
- Which SAP exits actually exist
- Which CDS views are released for a given table
- What the correct EML syntax is for a RAP operation
- Which BAdIs are classified as Level A vs Level B

...it hallucates, guesses, and falls back to Tier D patterns.

CPI-6 fixes this permanently by introducing a RAG layer, an MCP server, and
specialized AI agents — each grounded in current SAP documentation.

---

## Target Outcome

| Metric | Current | Target After CPI-6 |
|--------|---------|-------------------|
| Code accuracy (Clean Core Level A/B) | ~20% | 80-100% |
| Hallucinated SAP exits/BAdIs | Frequent | Near zero |
| Direct SAP table SELECTs | Always | Never (CDS views only) |
| BAPI usage where EML exists | Always | Never |
| RAP BO generation | Never | Always for transactional |
| Application Log usage | Never | Always |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Knowledge Sources                      │
│                                                          │
│  SAP Business    SAP Help     SAP Clean    Deloitte     │
│  Accelerator     Portal       Core Guide   Templates    │
│  Hub (APIs,      (ABAP ref,   (Level A-D   (FDS/TDS     │
│  RAP BOs,        EML, RAP)    patterns)    styles)      │
│  CDS Views)                                             │
│                                                          │
│  SAP BAdI        SAP          SAP          Correction   │
│  Catalog         Cloudifi-    Community    Store        │
│  (released       cation       (patterns,   (developer   │
│  exits)          Repository   examples)    edits)       │
└──────────────────────────┬──────────────────────────────┘
                           │ periodic ingestion pipeline
                           ↓
┌─────────────────────────────────────────────────────────┐
│                     RAG Layer                            │
│              Azure AI Search (Vector DB)                 │
│                                                          │
│  Chunked + Embedded SAP Knowledge                        │
│  Indexed by: object type, RICEFW type, Clean Core level  │
│  Team-shared, enterprise-secured, Deloitte-managed       │
└──────────────────────────┬──────────────────────────────┘
                           │ search + retrieve
                           ↓
┌─────────────────────────────────────────────────────────┐
│                    MCP Server                            │
│           (DarkHorse Knowledge Service)                  │
│                                                          │
│  search_sap_apis(query)                                  │
│  check_clean_core_level(object_name)                     │
│  verify_badi(badi_name)                                  │
│  get_rap_pattern(scenario)                               │
│  get_cds_view(table_name)                                │
│  get_eml_syntax(operation)                               │
│  get_application_log_pattern()                           │
│  search_team_templates(ricefw_type)                      │
│  get_cbo_pattern(scenario)                               │
│  verify_exit_exists(exit_name, program_name)             │
└──────────────────────────┬──────────────────────────────┘
                           │ tools available to agents
                           ↓
┌─────────────────────────────────────────────────────────┐
│                  AI Agents Layer                         │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  SO Agent   │  │  FDS Agent  │  │  TDS Agent  │     │
│  │             │  │             │  │             │     │
│  │ Clean Core  │  │ Released    │  │ RAP pattern │     │
│  │ patterns    │  │ APIs, BAdI  │  │ EML syntax  │     │
│  │ arch tmpl   │  │ catalog     │  │ CDS views   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐                       │
│  │ Code Agent  │  │ Review      │                       │
│  │             │  │ Agent       │                       │
│  │ Verify all  │  │ Clean Core  │                       │
│  │ SAP refs    │  │ compliance  │                       │
│  │ before gen  │  │ checker     │                       │
│  └─────────────┘  └─────────────┘                       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────┐
│                DarkHorse Pipeline                        │
│         BR → SO → FDS → TDS → Code                     │
└──────────────────────────┬──────────────────────────────┘
                           │ developer edits feed back
                           ↓
┌─────────────────────────────────────────────────────────┐
│                 Correction Store                         │
│    Developer edits → high-weight RAG documents          │
│    Continuous accuracy improvement over time            │
└─────────────────────────────────────────────────────────┘
```

---

## What Each Agent Does Differently With MCP

### SO Agent (Solution Overview)
**Before MCP:** Guesses Clean Core levels based on LLM training data.
**After MCP:** Calls `check_clean_core_level()` for each proposed component.
Result: Accurate Level A/B/C/D assessment, no guessing.

### FDS Agent (Functional Design Spec)
**Before MCP:** References SAP tables and transactions generically.
**After MCP:** Calls `search_sap_apis()` to verify released APIs exist.
Calls `verify_badi()` to confirm BAdI names before documenting them.
Result: FDS references only real, released SAP objects.

### TDS Agent (Technical Design Spec)
**Before MCP:** Generates classic ABAP object lists (PROG, CLAS, FUGR).
**After MCP:** Calls `get_rap_pattern()` to determine correct RAP object structure.
Calls `get_cds_view()` to identify released views for data access.
Calls `get_cbo_pattern()` for custom persistent data requirements.
Result: TDS object list contains RAP behavior definitions, CDS views, CBOs.

### Code Agent (Code Generation)
**Before MCP:** Generates classic ABAP with direct table SELECTs and BAPIs.
**After MCP:**
- Calls `verify_exit_exists()` before referencing any user exit
- Calls `get_cds_view()` before every data access — never SELECTs SAP core tables
- Calls `get_eml_syntax()` for every write operation — never uses BAPIs on RAP objects
- Calls `get_application_log_pattern()` for all logging — never creates custom log tables
- Calls `get_rap_pattern()` for behavior class structure
Result: Code is Clean Core Level A/B compliant, no hallucinated exits.

### Review Agent (Post-generation)
**New agent — didn't exist before.**
After code generation, automatically scans for:
- Direct SELECTs on SAP core tables → flag as Level C
- CALL FUNCTION on unreleased FMs → flag and suggest alternative
- Implicit enhancements → flag as Level D
- Custom table inserts where CBO should be used → flag
Result: Developer gets a compliance report before accepting code.

---

## MCP Server — Tool Specifications

### Tool 1: search_sap_apis
```
Input:  { query: string, ricefw_type?: string, module?: string }
Output: { apis: Array<{ name, type, level, description, example }> }
Source: SAP Business Accelerator Hub (RAG indexed)
```

### Tool 2: check_clean_core_level
```
Input:  { object_name: string, object_type: string }
Output: { level: 'A'|'B'|'C'|'D', reasoning: string, alternatives?: string[] }
Source: SAP Cloudification Repository (RAG indexed)
```

### Tool 3: verify_badi
```
Input:  { badi_name: string, program?: string }
Output: { exists: boolean, level: string, parameters?: object, alternative?: string }
Source: SAP BAdI Catalog (RAG indexed)
Prevents: USEREXIT_ATP_QUANTITY hallucination
```

### Tool 4: get_rap_pattern
```
Input:  { scenario: string, object_type: string, operation: string }
Output: { pattern: string, code_template: string, required_objects: string[] }
Source: SAP RAP Guide + Community patterns (RAG indexed)
```

### Tool 5: get_cds_view
```
Input:  { sap_table: string, use_case?: string }
Output: { view_name: string, level: string, fields: string[], example: string }
Source: SAP API Hub CDS catalog (RAG indexed)
Prevents: Direct SELECT on VBAK, MARA, KNA1 etc.
```

### Tool 6: get_eml_syntax
```
Input:  { operation: 'CREATE'|'UPDATE'|'DELETE'|'READ', entity: string }
Output: { syntax: string, example: string, commit_required: boolean }
Source: SAP ABAP EML documentation (RAG indexed)
Replaces: BAPI_DELIVERYPROCESSING_EXEC and similar
```

### Tool 7: get_application_log_pattern
```
Input:  { use_case: string }
Output: { pattern: string, objects_needed: string[], example: string }
Source: SAP SLG1 documentation (RAG indexed)
Replaces: Custom log table creation
```

### Tool 8: get_cbo_pattern
```
Input:  { scenario: string, required_fields: string[] }
Output: { pattern: string, rap_structure: object, cds_template: string }
Source: SAP CBO documentation (RAG indexed)
Replaces: Custom Z-table with direct inserts
```

### Tool 9: verify_exit_exists
```
Input:  { exit_name: string, program_name?: string, exit_type: string }
Output: { exists: boolean, program: string, parameters: object, level: string }
Source: SAP exit catalog (RAG indexed)
Prevents: Hallucinated exit names
```

### Tool 10: search_team_templates
```
Input:  { ricefw_type: string, module?: string }
Output: { templates: Array<{ name, structure, example_sections }> }
Source: Deloitte team FDS/TDS Git repo (RAG indexed)
```

---

## RAG Layer — Document Sources & Ingestion

### Priority 1 — Immediate (Sprint 1-2)
| Source | Format | Access | Update Frequency |
|--------|--------|--------|-----------------|
| SAP Business Accelerator Hub | JSON API | Public | Monthly |
| SAP Clean Core Extensibility Guide | PDF | Public | Per SAP release |
| SAP ABAP RAP Programming Guide | HTML | Public | Per SAP release |
| SAP EML Reference | HTML | Public | Per SAP release |
| SAP Cloudification Repository | JSON API | SAP Portal | Quarterly |

### Priority 2 — Sprint 3-4
| Source | Format | Access | Update Frequency |
|--------|--------|--------|-----------------|
| SAP BAdI Catalog | SAP System export | SAP System | Per upgrade |
| SAP Community RAP examples | HTML scrape | Public | Ongoing |
| Deloitte FDS/TDS templates | Git repo | Internal | Per project |

### Priority 3 — Sprint 5-6
| Source | Format | Access | Update Frequency |
|--------|--------|--------|-----------------|
| Developer correction store | Auto-generated | Internal | Real-time |
| Project-specific patterns | Git repo | Internal | Per project |

### Ingestion Pipeline
```
Source document
    ↓
Document fetcher (scheduled, weekly)
    ↓
Chunker (500-1000 token chunks with overlap)
    ↓
Embedder (Azure OpenAI ada-002 or text-embedding-3)
    ↓
Azure AI Search index
    ↓
MCP Server queries index at agent call time
```

---

## Build Phases

### Sprint 1: MCP Server Scaffold + Verification Tools (2-3 sessions)
**Goal:** Eliminate hallucinated SAP references immediately.

Deliverables:
- MCP server project: `services/darkhorse-mcp/`
- Implement `verify_badi()` and `verify_exit_exists()` with static catalog
- Implement `check_clean_core_level()` with Cloudification Repository data
- Wire Code Agent to call verification tools before generating
- Test: Generate backorder code — no hallucinated exits

Files:
```
services/darkhorse-mcp/
├── index.ts              ← MCP server entry point
├── tools/
│   ├── VerifyBadi.ts
│   ├── VerifyExit.ts
│   ├── CheckCleanCoreLevel.ts
│   └── GetApplicationLogPattern.ts
├── catalog/
│   ├── badi-catalog.json         ← Static BAdI list (seed data)
│   ├── exit-catalog.json         ← Static exit list (seed data)
│   └── clean-core-objects.json   ← Cloudification Repository extract
└── package.json
```

### Sprint 2: RAG Layer — Azure AI Search Setup (3-4 sessions)
**Goal:** Replace static catalogs with live RAG-indexed knowledge.

Deliverables:
- Azure AI Search instance configured (Deloitte tenant)
- Document ingestion pipeline for SAP API Hub + Clean Core Guide
- Embedding pipeline using Azure OpenAI
- MCP tools updated to query Azure AI Search instead of static files
- DarkHorse settings: Azure AI Search endpoint + API key configuration

### Sprint 3: Code Agent MCP Integration (2-3 sessions)
**Goal:** Code generation uses MCP for all SAP references.

Deliverables:
- Code Agent calls `get_cds_view()` before every data access
- Code Agent calls `get_eml_syntax()` for all write operations
- Code Agent calls `get_rap_pattern()` for behavior class generation
- Code Agent calls `get_application_log_pattern()` for all logging
- Test: Finance Open Items report generates CDS-based code (not direct SELECT)

### Sprint 4: TDS Agent MCP Integration (2-3 sessions)
**Goal:** TDS object list is RAP-aligned, not classic ABAP.

Deliverables:
- TDS Agent calls `get_rap_pattern()` to determine object structure
- TDS Agent calls `get_cbo_pattern()` when persistent custom data needed
- TDS generates: BDEF, BBEH, CDS Projection View instead of PROG/FUGR
- Test: Backorder TDS generates RAP BO definition, not classic program list

### Sprint 5: SO + FDS Agent MCP Integration (1-2 sessions)
**Goal:** Full pipeline grounded in SAP knowledge.

Deliverables:
- SO Agent verifies proposed approaches via `check_clean_core_level()`
- FDS Agent verifies BAdI names via `verify_badi()`
- FDS Agent verifies transaction codes and SAP objects exist

### Sprint 6: Review Agent + Correction Store (2-3 sessions)
**Goal:** Post-generation compliance check + continuous learning.

Deliverables:
- New Review Agent: scans generated code for Clean Core violations
- Correction Store: when developer edits accepted code, delta stored in RAG
- Feedback loop: corrections indexed as high-weight documents
- Correction Store viewer in DarkHorse UI

### Sprint 7: Agent Marketplace (3-4 sessions)
**Goal:** Publish specialized agents powered by MCP knowledge.

Note: Agent Marketplace builds on top of the grounded MCP layer.
Agents in the marketplace are significantly more accurate because they
have access to verified SAP knowledge via MCP tools.

---

## Code Generation Rules After CPI-6

These rules replace the current system prompt in ObjectCodeGenerator.ts:

### MANDATORY — Level A (always try first)
- Data access: ONLY via released CDS views — call `get_cds_view()` for every table
- Write operations: ONLY via EML — call `get_eml_syntax()` for every operation
- Custom persistent data: ONLY via CBO — call `get_cbo_pattern()`
- Enhancements: ONLY via released BAdIs — call `verify_badi()` before referencing
- Logging: ALWAYS use SLG1 Application Log — call `get_application_log_pattern()`
- Scheduling: ALWAYS use Application Jobs (CL_APPL_LOG) not SM37 classic jobs
- Reporting: CDS-based analytical reports for read-only, RAP BO for transactional
- No Function Modules — use class methods
- No implicit enhancements — explicit, released extension points only

### ACCEPTABLE — Level B (when Level A not available)
- BAPIs: ONLY if no RAP BO exists for the SAP object — document why
- Classic BAdIs: ONLY if no released BAdI exists — document why
- ALV Grid (CL_GUI_ALV_GRID or CL_SALV_TABLE): acceptable for classic reports
- Standard ABAP without restricted objects

### PROHIBITED — Level C/D (never generate)
- Direct SELECT on SAP core tables (VBAK, MARA, KNA1 etc.)
- CALL FUNCTION on unreleased function modules
- Implicit enhancements (ENHANCEMENT without release)
- Core modifications
- Direct INSERT/UPDATE/DELETE on SAP standard tables
- Custom log tables (use SLG1 always)

---

## Technology Decisions

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Vector Database | Azure AI Search | Deloitte enterprise, data sovereignty, existing Azure tenant |
| Embedding Model | Azure OpenAI text-embedding-3-small | Same Azure tenant, no data leaves Deloitte |
| MCP Server | Node.js (same as DarkHorse) | No new runtime, easy to bundle |
| Document Fetcher | Node.js scheduled service | Runs as background service |
| Chunking Strategy | 500 tokens, 50 token overlap | Optimal for SAP technical documentation |
| Retrieval Strategy | Hybrid (vector + keyword) | Better for SAP object names and code patterns |

---

## Deployment Architecture

### Single Shared Instance (Recommended)

```
Deloitte Azure Tenant
├── Azure AI Search Instance (shared)
│   └── SAP Knowledge Index (team-shared)
├── Azure OpenAI (embeddings)
└── MCP Server (deployed as Azure Function or Container App)
        ↑
        │ HTTPS (authenticated)
        │
Developer Laptops
├── DarkHorse IDE
│   └── MCP Client (connects to shared Azure MCP Server)
└── Local LLM Proxy (MVP-5, unchanged)
```

**Key point:** The RAG index is shared. Every developer benefits from the same
SAP knowledge base. No developer needs to set up their own Azure AI Search.
One Deloitte admin maintains the index. Developers only need the MCP server URL
and an API key — configured once in DarkHorse settings.

---

## DarkHorse Settings for CPI-6

New settings added to darkhorse-pipeline:

```json
{
  "darkhorse.mcp.serverUrl": "https://darkhorse-mcp.deloitte.com/api",
  "darkhorse.mcp.apiKey": "stored in VS Code SecretStorage",
  "darkhorse.mcp.enabled": true,
  "darkhorse.rag.azureSearchEndpoint": "https://darkhorse-search.search.windows.net",
  "darkhorse.rag.azureSearchKey": "stored in VS Code SecretStorage",
  "darkhorse.rag.indexName": "sap-knowledge-v1"
}
```

---

## Session Start Prompt for CPI-6 Sprint 1

```
DarkHorse — SAP ABAP IDE. All MVP packages + CPI-4 complete.
Starting CPI-6 Sprint 1: MCP Server + Verification Tools.

Goal: Eliminate hallucinated SAP references from code generation.
First deliverable: MCP server with verify_badi() and verify_exit_exists() tools.

Key constraints:
- Node.js, TypeScript, CommonJS
- MCP server lives at services/darkhorse-mcp/
- Start with static JSON catalogs (no Azure yet)
- Wire into ObjectCodeGenerator.ts callProxy method
- Code Agent must call verify tools BEFORE generating any SAP reference

Start with services/darkhorse-mcp/index.ts scaffold.
Refer to DarkHorse_06_CPI6_RAG_MCP.md for full spec.
```

---

## Success Criteria

CPI-6 is complete when:
- [ ] Generated ABAP code uses CDS views for ALL SAP data access (zero direct SELECTs)
- [ ] Generated code uses EML for ALL write operations on RAP-managed objects
- [ ] Generated code uses Application Log (SLG1) — zero custom log tables
- [ ] Zero hallucinated BAdI or exit names in generated code
- [ ] TDS object list contains RAP BDEF/BBEH objects, not classic PROG/FUGR
- [ ] Review Agent flags any Clean Core violations post-generation
- [ ] Correction Store captures developer edits and feeds back to RAG
- [ ] All developers connect to single shared Azure AI Search instance
- [ ] Code accuracy assessed at 80%+ by SAP ABAP architect review
