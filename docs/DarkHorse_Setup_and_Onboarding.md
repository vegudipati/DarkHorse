# DarkHorse — Setup and Onboarding Guide

This document is the canonical setup reference for the DarkHorse SAP Clean Core
AI pipeline. It covers three audiences:

1. **Editor setup** — done **once per developer machine**
2. **Client onboarding** — done **once per client engagement**
3. **Per-pipeline workflow** — done **for every Business Requirement**

> Updated: 2026-05-22 — covers extension v0.7.9 (CPI-6 items 1–4 Phase A).

---

## 0. What DarkHorse actually does (1-minute primer)

DarkHorse is a VS Code extension + a set of local services that turn a written
Business Requirement (BR) into a deterministic, Clean-Core-compliant SAP
deliverable:

```
BR text  →  Solution Overview (Clean Core levels)  →  FDS (.docx)
                                                         ↓
                                                       TDS (.docx)
                                                         ↓
                                       ABAP / CDS / BDEF / SRVD / SRVB code
```

Every LLM call is **grounded** through the DarkHorse MCP server (real SAP
released-API knowledge, RAP/CDS patterns, Fiori templates, Adobe Forms,
SLG1 logging, BAdI catalog). Every generated object carries an audit
header with a 16-hex DarkHorse UID that is also appended to a tamper-evident
log file (`~/.darkhorse/ai-generation-log.jsonl`).

---

## 1. One-time editor setup

Do these once per developer laptop.

### 1.1 Pre-requisites

- **Windows 10/11** (Linux/Mac path is similar; commands below assume PowerShell)
- **Node.js 20+** installed and on PATH (`node --version` → `v20.x.x` or higher)
- **VS Code 1.85+**
- **Git** (for the DarkHorse repo)
- A working Anthropic Claude API key (Sonnet 4 or newer)

### 1.2 Clone the repo

```powershell
git clone https://github.com/<your-org>/DarkHorse.git "C:\99-AI Projects\DarkHorse"
cd "C:\99-AI Projects\DarkHorse"
```

### 1.3 Install + start the LLM proxy (Claude wrapper)

```powershell
cd "C:\99-AI Projects\DarkHorse\services\llm-proxy"
npm install
npm run build

# Set your Claude API key as an environment variable.
# Either in your PowerShell profile (persistent):
[Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY','sk-ant-...','User')
# Or for the current session only:
$env:ANTHROPIC_API_KEY = 'sk-ant-...'

# Launch the proxy
node dist\index.js
```

Expect to see:
```
[DarkHorse Proxy] Ready on 127.0.0.1:47291
```

Leave this terminal running.

### 1.4 Install + start the MCP knowledge server

```powershell
cd "C:\99-AI Projects\DarkHorse\services\darkhorse-mcp"
npm install
npm run build
node dist\index.js
```

Expect:
```
[DarkHorse MCP] Ready on 127.0.0.1:47292
[DarkHorse MCP] Tools: verify_badi, verify_exit, check_clean_core_level,
get_application_log_pattern, get_cds_view, get_eml_syntax, get_rap_pattern,
get_cbo_pattern, get_fiori_pattern, get_form_pattern, acknowledge_catalog
[DarkHorse MCP] KnowledgeProvider: static catalog only — AZURE_SEARCH_ENDPOINT/KEY not set
```

Leave this terminal running too.

### 1.5 (Optional, recommended) Build + start the RAG ingester once

```powershell
cd "C:\99-AI Projects\DarkHorse\services\darkhorse-ingest"
npm install
npm run build
node dist\index.js verify     # confirms 19/19 acceptance probes pass
```

The ingester populates the local in-memory RAG index from curated seed
fixtures (SAP API Hub + Clean Core Guide + Architecture Center). For live
Azure-backed RAG, see § 4.

### 1.6 Install the DarkHorse VS Code extension

```powershell
cd "C:\99-AI Projects\DarkHorse\extensions\darkhorse-pipeline"
npm install
npm run compile
npm run package
code --install-extension darkhorse-pipeline-0.7.9.vsix --force
```

Then **reload VS Code** (`Ctrl+Shift+P` → "Developer: Reload Window").

### 1.7 Editor settings — minimum to function

`Ctrl+,` opens Settings. Search "darkhorse" and set:

| Setting | Value | Why |
|---|---|---|
| `Darkhorse > Pipeline: Output Folder` | e.g. `C:\99-AI Projects\DarkHorse\output` | Where FDS/TDS .docx and ABAP .abap files land |
| `Darkhorse > Pipeline: Llm Proxy Port` | `47291` | Match the proxy's port |
| `Darkhorse > Mcp: Port` | `47292` | Match the MCP server's port |

Settings file location (for reference): `%APPDATA%\Code\User\settings.json`.

### 1.8 Smoke test

```
Ctrl+Shift+P → "DarkHorse: Verify AI Log Chain"
```
Expected: an info toast `"DarkHorse: AI log chain is intact (0 of 0 entries verified)."` and a blank
"DarkHorse Audit" output panel. This confirms the extension is wired up.

---

## 2. One-time per-client onboarding

Done once when starting work for a new client (UNFI, ACME, etc.).

### 2.1 Pick a folder for the client artifacts

Recommended structure — outside the workspace so it stays out of git:

```
C:\99-AI Projects\DarkHorse\GIT-IGNORE - Templates and Standards\
├─ unfi-standards.md                    ← Client development standards (Markdown)
├─ unfi-templates.json                  ← Heading-map config (JSON)
├─ RICEFWID_Description_FDS(Report).docx
├─ RICEFWID_Description_FDS(Enhancement).docx
├─ RICEFWID_Description_FDS(Conversions).docx
├─ RICEFWID_Description_FDS(Forms).docx
├─ RICEFWID_Description_FDS(Interfaces).docx
├─ RICEFWID_Description_TDS(Report).docx
├─ ...
└─ UNFI S4 Development-Coding Guidelines.docx
```

### 2.2 Set the client identity in VS Code settings

`Ctrl+,` → search "darkhorse client":

| Setting | Value |
|---|---|
| `Darkhorse > Client: Id` | `UNFI` (free-text client label) |
| `Darkhorse > Client: Standards File` | Absolute path to the standards `.md` (e.g. `...\unfi-standards.md`) |
| `Darkhorse > Client: Templates Config` | Absolute path to the templates JSON (e.g. `...\unfi-templates.json`) |

The standards and templates JSON do **not** need to exist yet — DarkHorse
creates / merges them in the next steps.

### 2.3 Create the client standards Markdown

```
Ctrl+Shift+P → "DarkHorse: Open Client Standards File"
```

If the file doesn't exist, DarkHorse creates it from a starter template
with 8 canonical sections (Naming Conventions / Authorization / Logging /
Error Handling / Transport / Testing / Performance / Code Review) and opens
it for editing. Edit each section with **your client's actual conventions**:

- Naming prefixes (e.g. UNFI uses `ZU_` for custom programs)
- Message class names
- SLG1 log object + standard subobjects
- Mandatory authorization objects per process area
- Transport naming convention
- Code-review signoff requirements

The file is **hot-reloaded** on save. The next pipeline run picks up
changes automatically — no extension restart.

### 2.4 Build the templates heading-map (one per client template)

For **each** of the client's FDS and TDS Word templates (UNFI has 10 — five
RICEFW types × two kinds):

```
Ctrl+Shift+P → "DarkHorse: Discover Template Headings"
```

The command will:

1. Open a file picker → choose the template `.docx`
2. Prompt for the RICEFW type → pick from `Report / Enhancement / Conversions / Forms / Interfaces`
3. Prompt for kind → pick `fds` or `tds`
4. Scan the document for Word heading-styled paragraphs
5. Auto-map headings against DarkHorse internal field names using fuzzy match
6. Write / merge the result into your configured `templatesConfig` JSON
7. Open the JSON for review

**Review the JSON.** Each heading shows up like:

```json
"Overview":         { "field": "businessBackground" },     ← auto-mapped
"Business Driver":  { "field": "businessDriver" },         ← auto-mapped
"Selection Screen": { },                                    ← needs manual mapping (table — Phase B)
"Some Custom Heading": { }                                  ← needs manual mapping
```

- Empty `{}` means the auto-mapper had no confident suggestion
- Fields you can map to: see § 2.5 for the canonical list
- Section headings you want DarkHorse to **leave alone** (cover page, TOC,
  signoff blocks) can be left empty — they stay as the template's instruction
  text

Save the file. Re-run **Discover** on the next template; it merges into the
same JSON.

### 2.5 Internal field name reference

#### FDS fields

| Field | Used for |
|---|---|
| `businessBackground` | Executive summary / Overview narrative |
| `businessDriver` | Why this is being done |
| `asIsProcess` | Current-state narrative |
| `toBeProcess` | Future-state narrative |
| `businessRisks` | Risks if NOT developed |
| `assumptions` | Assumptions list |
| `processOverview` | Process Description and Flow |
| `scope` | Combined In / Out of scope |
| `functionalRequirements` | FR list with priorities |
| `uiDesign` | UI design narrative (Fiori app description) |
| `inputOutputSpec` | Field-level input/output specification |
| `businessRules` | IF/THEN rules |
| `errorHandling` | Error handling narrative |
| `authorization` | Authorization objects + roles |
| `reportingRequirements` | Report-specific requirements |
| `openItems` | TBDs |
| `testScenarios` | Functional unit test scenarios |
| `performance` | Performance requirements |
| `dependencies` | Configuration / development / execution dependencies |
| `frequencyAndSchedule` | Job frequency + schedule |

#### TDS fields

| Field | Used for |
|---|---|
| `technicalApproach` | Architecture / design approach narrative |
| `designDecisions` | Key technical decisions with rationale |
| `abapObjectList` | List of ABAP/CDS/BDEF/SRVD objects to build |
| `dataDictionary` | Data model / tables / CDS views |
| `programLogic` | Pseudocode with SAP API calls |
| `interfaceDesign` | Integration design |
| `dbDesign` | Database design / performance |
| `errorHandling` | Error-handling implementation |
| `transportStrategy` | Transport plan |
| `testScenarios` | Unit test scenarios |
| `openItems` | TBDs |

### 2.6 (Optional) Convert the client coding-guidelines Word doc into the standards Markdown

If the client provided their guidelines as a Word document (e.g. `UNFI S4
Development-Coding Guidelines.docx`):

1. Open the Word doc → File → Save As → Markdown
   (or paste the content into the standards `.md` and reformat as ## sections)
2. Drop anything not directly actionable (history tables, cover pages, glossaries)
3. Keep concrete rules: naming, authorization, logging, error handling, transport,
   testing, performance, code review

Aim for a **focused** standards file (~500 lines max). Everything in this file
gets injected at the top of every LLM prompt — bigger files cost more tokens
and dilute the LLM's attention.

### 2.7 (Optional) Pre-warm catalog with known BAdIs/exits

If the client has known good BAdI / user-exit names that aren't in the default
DarkHorse seed catalog, you can pre-add them so the Code Agent verifier
treats them as valid from day 1:

```powershell
# Example — add USEREXIT_CHECK_VBAP for an SD enhancement
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:47292/catalog/acknowledge `
  -ContentType 'application/json' `
  -Body '{"category":"exit","name":"USEREXIT_CHECK_VBAP","module":"SD"}'
```

This writes to `services/darkhorse-mcp/catalog/exit-catalog.json`. The
acknowledge endpoint is also used at runtime when the developer
acknowledges a "not in catalog" finding via the Clean Core report and
clicks "Save & Regenerate."

---

## 3. Per-pipeline workflow

Done for every Business Requirement.

### 3.1 Pre-flight (~30 seconds)

1. Confirm the **llm-proxy** terminal shows "Ready on 127.0.0.1:47291"
2. Confirm the **MCP server** terminal shows "Ready on 127.0.0.1:47292"
3. Confirm VS Code shows the DarkHorse Pipeline activity-bar icon
4. Confirm `darkhorse.client.id` is set to the right client

### 3.2 Start the pipeline

```
Ctrl+Shift+P → "DarkHorse: Start BR → FDS → TDS → Code Pipeline"
```

Walk through:

1. **BR Intake** — paste the BR text, set RICEFW Type + Object Type + SAP Package
2. **Solution Overview** — review the Clean Core levels + cleanCoreAlignment table → Approve (or Reject + refine BR)
3. **FDS** — review the rendered Word doc (in your client's template if configured) → Approve
4. **TDS** — review the abapObjectList. Confirm it contains Fiori/RAP objects, not classic PROG/FUGR → Approve
5. **Code generation** — one object at a time:
   - Watch the Clean Core verifier report (top)
   - Watch the Review Agent report (bottom)
   - Acknowledge any "not in catalog" findings if you know they're real → "Save & Regenerate" persists them to the catalog
   - Level D blocks Accept — either acknowledge or reject + refine
   - Accept when satisfied → code is saved to the output folder + audit log entry minted

### 3.3 Post-pipeline housekeeping

After the developer edits the generated `.abap` files (typically to fix
something the LLM got wrong):

```
Ctrl+Shift+P → "DarkHorse: Capture Corrections"
```

This writes per-object `corrections/*.json` files containing the diff between
the AI output and the developer's final code. Local-only — not indexed
into a shared RAG. Future enhancement: opt-in indexing.

### 3.4 Audit-log verification (periodic / on demand)

```
Ctrl+Shift+P → "DarkHorse: Verify AI Log Chain"
```

Walks `~/.darkhorse/ai-generation-log.jsonl` and confirms every entry's
`prevHash` matches the SHA-256 of the previous line. Any break means the
log was edited outside DarkHorse — surface to your audit team immediately.

---

## 4. (Optional) Live Azure RAG backend

The default ships with mock embeddings + in-memory index. For production
RAG with real semantic search, provision:

| Resource | Purpose | Approx cost |
|---|---|---|
| Azure AI Search (Basic SKU) | Vector index | ~$75/mo |
| Azure OpenAI (`text-embedding-3-small` deployment) | Embeddings | Pay-per-token, negligible |

Set five environment variables before starting the MCP server + ingester:

```powershell
$env:AZURE_OPENAI_ENDPOINT             = 'https://<your-name>.openai.azure.com'
$env:AZURE_OPENAI_KEY                  = '<api key>'
$env:AZURE_OPENAI_EMBEDDING_DEPLOYMENT = 'text-embedding-3-small'
$env:AZURE_SEARCH_ENDPOINT             = 'https://<your-name>.search.windows.net'
$env:AZURE_SEARCH_KEY                  = '<admin key>'
```

Then one-time ingest:
```powershell
cd "C:\99-AI Projects\DarkHorse\services\darkhorse-ingest"
node dist\index.js ingest all
```

Expect log lines `Embedder: Azure OpenAI ...` and `Index: Azure AI Search ...`.
Restart the MCP server with the same env vars set — the startup banner now
reads `KnowledgeProvider: composite: Azure AI Search ... → static catalog`.

---

## 5. Operational cheat sheet

| Need | Command |
|---|---|
| Open client standards | `DarkHorse: Open Client Standards File` |
| Discover headings in a new template | `DarkHorse: Discover Template Headings` |
| Open templates config | `DarkHorse: Open Templates Config` |
| Start a fresh pipeline | `DarkHorse: Start BR → FDS → TDS → Code Pipeline` |
| Resume an interrupted pipeline | `DarkHorse: Resume Pipeline` |
| Restart code gen from object N | `DarkHorse: Reset Code Generation` |
| Wipe the current pipeline | `DarkHorse: Clear Current Pipeline` |
| Capture developer edits as corrections | `DarkHorse: Capture Corrections` |
| Verify the AI audit log chain | `DarkHorse: Verify AI Log Chain` |

---

## 6. Troubleshooting

### Pipeline crashes "Cannot find module 'docx'"
The .vsix didn't bundle node_modules. Repackage with `npm run package` (no
`--no-dependencies` flag) and reinstall.

### MCP server "Port 47292 is already in use"
A previous instance is still running. Find + kill:
```powershell
Get-NetTCPConnection -LocalPort 47292 -State Listen | Select OwningProcess
Stop-Process -Id <PID> -Force
```

### Pipeline shows "AI backend returned an error"
Check `~/.darkhorse/llm-audit.jsonl` for the actual reason. Common: network
blip (retry — auto-retry is in place since v0.7.2) or 401 (`ANTHROPIC_API_KEY`
not set or wrong).

### Code generation produces non-deterministic results
Confirm the llm-proxy was restarted after the `temperature=0` change. The
proxy banner should NOT mention temperature, but the code in
`services/llm-proxy/adapters/ClaudeAdapter.ts` has `temperature: 0` in the
request body.

### "DarkHorse: Open Client Standards File" does nothing
Reload VS Code. The command shipped in v0.7.6+. Open Developer Tools
(`Help → Toggle Developer Tools`) and watch the Console for
`[DarkHorse] openClientStandards: ...` lines.

### Templates config doesn't render
1. Confirm `darkhorse.client.templatesConfig` setting points at the JSON file
2. Confirm the JSON has the right RICEFW key (`Report` matches the state's
   `ricefwType` field — case-insensitive prefix match)
3. Open Developer Tools — the console will log `[DarkHorse] FDS rendered into
   client template: N sections filled, M unmapped, K missing` after each
   FDS / TDS run

### Verifier flags too many false positives
Edit the seed catalogs directly in `services/darkhorse-mcp/catalog/*.json`.
Restart MCP. Future enhancement (Sprint 6 follow-up): bulk import from a
curated list.

---

## 7. Where things live (filesystem reference)

| Path | What |
|---|---|
| `services/llm-proxy/` | Claude API wrapper (Node service, runs on :47291) |
| `services/darkhorse-mcp/` | Local knowledge MCP server (Node service, runs on :47292) |
| `services/darkhorse-ingest/` | RAG ingest CLI (one-shot, populates Azure AI Search) |
| `extensions/darkhorse-pipeline/` | VS Code extension (the actual UI) |
| `~/.darkhorse/ai-generation-log.jsonl` | Tamper-evident AI generation audit log |
| `~/.darkhorse/llm-audit.jsonl` | Per-call LLM proxy audit (no prompt text) |
| `<outputFolder>/*.abap` | Generated ABAP source |
| `<outputFolder>/*.docx` | Generated FDS + TDS documents |
| `<outputFolder>/corrections/*.json` | Captured developer edits |

---

If anything in this guide is wrong or out of date, raise a fix in the repo
or pass the correction to whoever maintains DarkHorse. The pipeline itself
captures audit trails for the AI-generated work — but this document is
hand-maintained.
