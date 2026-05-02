# DarkHorse — 7 MVP Build Packages + 4 CPI Plans
> Engineering Roadmap | Confidential — Deloitte Internal

---

## Roadmap Overview

| Package | Name | Focus | Est. Sessions |
|---------|------|-------|--------------|
| **MVP-1** | Foundation Shell | VS Code fork, Windows build pipeline, branding | 3–4 |
| **MVP-2** | SAP ADT Connector | SAP login, credential vault, object browser, source read/write | 4–5 |
| **MVP-3** | ABAP Language Support | Syntax highlighting, IntelliSense, error markers from ADT | 3–4 |
| **MVP-4** | Transport Manager | Create, list, assign objects to transports from IDE | 2–3 |
| **MVP-5** | LLM Proxy + AI Code Gen | Local proxy, PII scrubber, AI code generation panel | 4–5 |
| **MVP-6** | Git Integration | Commit, pull, branch, push ABAP code to GitHub | 2–3 |
| **MVP-7** | Agent Orchestrator | Agent wizard, subprocess runtime, code review agent | 4–5 |
| **CPI-1** | Enterprise Security Layer | Azure/AWS gateway, Vault integration, SSO, audit dashboard | 5–6 |
| **CPI-2** | UI5/Fiori Support | Fiori project scaffold, UI5 linting, deploy to SAP BTP | 5–6 |
| **CPI-3** | Multi-LLM + Agent Marketplace | Ollama local models, agent templates, agent sharing | 4–5 |
| **CPI-4** | BR → FDS → TDS → Code Pipeline | Requirement intake, AI-generated FDS/TDS (.docx), object-by-object code generation | 5–6 |

> Each MVP package produces a **working, testable build**. "Sessions" = Claude conversation sessions needed, optimized for the $75/month token budget.

---

## MVP-1: Foundation Shell

### Objective
Fork VS Code, brand it as DarkHorse, configure the Windows build pipeline, and produce a signed `.exe` installer that launches a custom-branded IDE window.

### Deliverables
- [ ] Forked VS Code repository on your GitHub org
- [ ] Custom branding: DarkHorse name, icon, splash screen, dark color theme
- [ ] Windows build pipeline: npm build + Electron Builder producing `.exe`
- [ ] Code signing configuration (self-signed for MVP, DigiCert-ready for production)
- [ ] VS Code marketplace disabled (security: no arbitrary extension install)
- [ ] DarkHorse extension host: loads only allow-listed extensions
- [ ] Basic settings UI: user preferences, theme, font size

### Test Criteria
- [ ] `DarkHorse.exe` installs on Windows 10/11 without errors
- [ ] Launches with correct branding — no VS Code references visible to user
- [ ] Cannot install extensions from VS Code marketplace
- [ ] Settings panel opens and saves preferences

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `package.json` | Fork identity: name, version, description changed to DarkHorse |
| `product.json` | App name, icons, URLs, telemetry disabled |
| `src/vs/workbench/browser/parts/titlebar/` | Custom title bar with DarkHorse branding |
| `build/darkhorse-build.js` | Electron Builder config for Windows `.exe` |
| `extensions/darkhorse-core/` | Core extension: command palette entries, settings schema |
| `resources/darkhorse/` | Icons, splash screen, Windows installer assets |

### Security Actions
- Disable VS Code telemetry (`crashReporter`, `telemetry.enableTelemetry = false`)
- Remove VS Code marketplace endpoint from `product.json`
- Add extension allow-list enforcement in extension host

---

## MVP-2: SAP ADT Connector

### Objective
Build the SAP connection layer: secure credential storage, ADT authentication, SAP object browser panel, and source code read/write.

### Deliverables
- [ ] System Landscape Config: Add/edit/delete SAP systems (DEV only for MVP)
- [ ] Credential Vault: SAP username/password stored in Windows Credential Manager via `keytar`
- [ ] ADT Authentication: CSRF token fetch, Basic Auth, session management
- [ ] SAP Explorer Panel: Tree view of packages, programs, function groups, classes
- [ ] Open Source: Double-click object opens ABAP source in editor tab
- [ ] Save Source: `Ctrl+S` saves source back to SAP via ADT PUT
- [ ] Object search: Quick search by program/class/FM name

### Test Criteria
- [ ] Connect to SAP S/4HANA 1809 DEV system with valid credentials
- [ ] Credentials survive DarkHorse restart (stored in Windows Credential Manager)
- [ ] Browse package hierarchy in SAP Explorer panel
- [ ] Open an ABAP program — source appears in editor with correct content
- [ ] Edit source and save — verify change in SAP (via SE38 or ADT)
- [ ] Wrong password shows clear error, does not crash

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-sap/src/adt/AdtClient.ts` | Core ADT REST client: auth, CSRF, GET/PUT source |
| `extensions/darkhorse-sap/src/adt/AdtSession.ts` | Session lifecycle: login, refresh, logout, memory-only token |
| `extensions/darkhorse-sap/src/credentials/CredentialVault.ts` | keytar wrapper: store, retrieve, delete SAP credentials |
| `extensions/darkhorse-sap/src/landscape/LandscapeManager.ts` | SAP system config: add/edit/remove systems, encrypted JSON |
| `extensions/darkhorse-sap/src/explorer/SapExplorerProvider.ts` | VS Code TreeDataProvider: SAP object tree in sidebar |
| `extensions/darkhorse-sap/src/explorer/SapObjectItem.ts` | Tree node model: package, program, class, function group |
| `extensions/darkhorse-sap/src/providers/AbapDocumentProvider.ts` | Opens SAP objects as virtual files in editor |
| `extensions/darkhorse-sap/package.json` | Extension manifest: commands, views, configuration schema |

### Security Actions
- `keytar` stores credentials encrypted via Windows DPAPI — never plaintext
- SAP session token held in memory only — cleared on extension deactivate
- All ADT requests use TLS — reject self-signed certs (configurable for dev)
- Audit log entry for every SAP connect/disconnect event

---

## MVP-3: ABAP Language Support

### Objective
Provide a first-class ABAP editing experience: syntax highlighting, keyword completion, ADT-powered syntax checking with inline error markers.

### Deliverables
- [ ] ABAP TextMate grammar: syntax highlighting for keywords, strings, comments, types
- [ ] ABAP language configuration: bracket matching, comment toggling, auto-indent
- [ ] Snippet library: common ABAP patterns (SELECT, LOOP, METHOD, CLASS, etc.)
- [ ] ADT Syntax Check: on-save syntax validation via ADT `checkruns` API
- [ ] Inline error markers: red squiggles with error messages in Problems panel
- [ ] Basic IntelliSense: keyword suggestions, snippet triggers

### Test Criteria
- [ ] ABAP keywords (`DATA`, `SELECT`, `ENDLOOP`, etc.) highlighted correctly
- [ ] Save a program with a syntax error — red squiggle appears on correct line
- [ ] Hover over error squiggle shows SAP's error message
- [ ] Problems panel lists all syntax errors in the file
- [ ] Fix error, save again — squiggle disappears
- [ ] Type `sel` — SELECT snippet appears in IntelliSense

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-abap/syntaxes/abap.tmLanguage.json` | TextMate grammar: full ABAP keyword set, string/comment rules |
| `extensions/darkhorse-abap/language-configuration.json` | Bracket pairs, comment syntax, indentation rules |
| `extensions/darkhorse-abap/snippets/abap.code-snippets` | 50+ ABAP code snippets for common patterns |
| `extensions/darkhorse-abap/src/diagnostics/SyntaxChecker.ts` | Calls ADT checkruns on save, parses XML into VS Code diagnostics |
| `extensions/darkhorse-abap/src/diagnostics/DiagnosticsProvider.ts` | Manages DiagnosticCollection, maps ADT errors to line/column |
| `extensions/darkhorse-abap/src/completion/AbapCompletionProvider.ts` | VS Code CompletionItemProvider: keywords + snippet triggers |

---

## MVP-4: Transport Manager

### Objective
Allow developers to create SAP Transport Requests, view existing transports, and assign ABAP objects to transports directly from DarkHorse.

### Deliverables
- [ ] Transport panel in sidebar: list all open transports for logged-in user
- [ ] Create Transport: form with description, type (Workbench/Customizing)
- [ ] Assign to Transport: right-click SAP object in Explorer to assign
- [ ] View Transport contents: expand transport to see assigned objects
- [ ] Transport status indicator: open / released / locked
- [ ] **NO release transport from DarkHorse** (security: must be done in STMS)

### Test Criteria
- [ ] Transport panel shows all open transports for logged-in user
- [ ] Create new transport — appears in SAP (verify in SE01/STMS)
- [ ] Assign object to transport — verify in SE01
- [ ] Transport panel refreshes after object assignment
- [ ] Released transports shown as read-only (cannot assign to them)

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-sap/src/transport/TransportClient.ts` | ADT calls: list, create, assign objects to transports |
| `extensions/darkhorse-sap/src/transport/TransportProvider.ts` | VS Code TreeDataProvider for transport panel |
| `extensions/darkhorse-sap/src/transport/TransportItem.ts` | Tree node model: transport, task, object |
| `extensions/darkhorse-sap/src/transport/TransportWebview.ts` | Create transport form: description, type, category |
| `extensions/darkhorse-sap/src/commands/transportCommands.ts` | Command handlers: createTransport, assignToTransport, refresh |

---

## MVP-5: LLM Proxy + AI Code Generation

### Objective
Build the local LLM proxy service and the AI code generation panel. Developers can prompt for ABAP code, review it, and insert it into the editor after approval.

### Deliverables
- [ ] DarkHorse Local Proxy: Node.js Express server on `localhost`, launched by the IDE
- [ ] PII Scrubber: strips system IDs, client numbers, hostnames from outbound payloads
- [ ] Rate Limiter: max requests/minute to prevent runaway API costs
- [ ] Claude Adapter: connects to Anthropic API via proxy
- [ ] AI Panel: chat-style interface for code generation prompts
- [ ] Context Awareness: AI panel knows the active file type and surrounding code
- [ ] Diff Preview: generated code shown as diff — **not auto-inserted**
- [ ] Accept/Reject: developer accepts or rejects each suggestion
- [ ] ABAP System Prompt: hardcoded guardrails for safe ABAP generation

### Test Criteria
- [ ] Local proxy starts when DarkHorse launches, stops when it closes
- [ ] Prompt "write a SELECT statement for table MARA" — valid ABAP returned
- [ ] Generated code appears as diff preview, not inserted automatically
- [ ] Accept inserts code at cursor; Reject closes preview
- [ ] System IDs in active file are NOT present in the LLM payload (verify in proxy logs)
- [ ] Exceeding rate limit shows friendly error, does not crash

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `services/llm-proxy/index.ts` | Express server: routes, middleware, startup/shutdown |
| `services/llm-proxy/PiiScrubber.ts` | Strips SAP identifiers from payloads |
| `services/llm-proxy/RateLimiter.ts` | Token bucket rate limiter: configurable per-user limits |
| `services/llm-proxy/adapters/ClaudeAdapter.ts` | Anthropic API client: model config, prompt formatting |
| `services/llm-proxy/adapters/OllamaAdapter.ts` | Local Ollama REST client for offline deployments |
| `services/llm-proxy/AbapSystemPrompt.ts` | Hardcoded ABAP guardrails: coding standards, safety rules |
| `extensions/darkhorse-ai/src/AiPanel.ts` | VS Code Webview: chat UI for code generation |
| `extensions/darkhorse-ai/src/DiffPreview.ts` | Shows generated code as VS Code diff editor before insertion |
| `extensions/darkhorse-ai/src/ContextCollector.ts` | Gathers active file, selection, object type for AI context |

### Security Actions
- Proxy binds to `127.0.0.1` only — not accessible from network
- PII scrubber tested against known SAP identifier patterns before first use
- API key stored in Windows Credential Manager, not in config files
- Audit log entry for every LLM call: timestamp, prompt hash, token count

---

## MVP-6: Git Integration

### Objective
Enable developers to commit, pull, push, and branch ABAP code in GitHub directly from DarkHorse. ABAP source is exported to local `.abap` files, committed via Git, then re-importable.

### Deliverables
- [ ] Git panel in sidebar: current branch, changed files, commit history
- [ ] Clone repository: connect to GitHub org/repo
- [ ] Export ABAP object to file: saves source as `.abap` file in local workspace
- [ ] Stage and commit: select files, write commit message, commit
- [ ] Push to remote: push to GitHub
- [ ] Pull/fetch: pull changes from remote
- [ ] Branch management: create, switch, list branches
- [ ] Diff view: compare local file with SAP source

### Test Criteria
- [ ] Clone a GitHub repo — appears in DarkHorse file explorer
- [ ] Export ABAP program to `.abap` file in workspace
- [ ] Stage file, write commit message, commit — appears in GitHub
- [ ] Switch branches — file system updates correctly
- [ ] Pull remote changes — local files updated

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-git/src/GitService.ts` | simple-git wrapper: clone, commit, push, pull, branch |
| `extensions/darkhorse-git/src/GitPanelProvider.ts` | TreeDataProvider: changed files, branches, commit history |
| `extensions/darkhorse-git/src/AbapExporter.ts` | Exports SAP object source to `.abap` file in workspace |
| `extensions/darkhorse-git/src/commands/gitCommands.ts` | Command handlers: stage, commit, push, pull, branch ops |
| `extensions/darkhorse-git/src/GitCredentials.ts` | GitHub PAT stored in Windows Credential Manager |

---

## MVP-7: Agent Orchestrator

### Objective
Build the agent creation wizard, subprocess-based agent runtime, and the code review agent. Agents are scoped, human-in-the-loop, and cannot perform write operations without explicit developer consent.

### Deliverables
- [ ] Agent Dashboard panel: list of active/completed agents, task status
- [ ] Agent Creation Wizard: questionnaire-driven UI (task, scope, permissions, timeout)
- [ ] Agent Runtime: Node.js `child_process` spawner with scoped context and tool list
- [ ] Code Review Agent: first agent — reviews code, drops report
- [ ] Report Viewer: agent report in notification panel with apply/reject
- [ ] Consent Gate: all write actions require explicit developer approval
- [ ] Agent Timeout: auto-terminate agents that exceed time limit
- [ ] Agent Logs: per-agent log visible in dashboard

### Test Criteria
- [ ] Open Agent Dashboard — empty state shows "No active agents"
- [ ] Run wizard for Code Review Agent — wizard collects task, scope, timeout
- [ ] Agent spawns, reviews an ABAP program, drops report in ~30–60 seconds
- [ ] Notification appears: "Code Review complete. View Report."
- [ ] Report shows findings with line references
- [ ] Click "Apply Fixes" — diff preview shown, not auto-applied
- [ ] Accept diff — code updated. Reject — code unchanged.
- [ ] Completed agent shown in dashboard history, subprocess confirmed terminated

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-agents/src/AgentOrchestrator.ts` | Spawns/tracks/terminates agent subprocesses. Enforces permission scoping. |
| `extensions/darkhorse-agents/src/AgentWizard.ts` | Webview wizard: collects task config, validates input, launches agent |
| `extensions/darkhorse-agents/src/AgentRuntime.ts` | Child process entry point: receives context, runs agent loop, emits results |
| `extensions/darkhorse-agents/src/agents/CodeReviewAgent.ts` | Reads code, calls LLM for review, formats structured report |
| `extensions/darkhorse-agents/src/AgentDashboard.ts` | Webview: active agents, task status, per-agent logs |
| `extensions/darkhorse-agents/src/ReportViewer.ts` | Renders report, Accept/Reject/Dismiss actions → diff preview |
| `extensions/darkhorse-agents/src/ConsentGate.ts` | Intercepts all write tool calls, requires developer confirmation |
| `extensions/darkhorse-agents/src/tools/ReadSapTool.ts` | Agent tool: read SAP object source (no write permission by default) |
| `extensions/darkhorse-agents/src/tools/LlmCallTool.ts` | Agent tool: call LLM via proxy (same PII scrubber as direct calls) |

### Security Actions
- Agent subprocess runs with minimum permissions — no SAP write access by default
- ConsentGate is not bypassable: write tools return "awaiting consent" until approved
- Agent timeout enforced via process kill — no hung agents
- All agent LLM calls go through the same proxy and PII scrubber
- Agent subprocess cannot access Windows Credential Manager directly

---

## CPI-1: Enterprise Security Layer

### Objective
Replace the local proxy with an enterprise API gateway, add Azure Key Vault / HashiCorp Vault integration, implement SSO (Azure AD), and add an audit dashboard.

### Key Deliverables
- [ ] Azure API Management or AWS API Gateway replacing local proxy
- [ ] Azure AD SSO / SAML authentication for DarkHorse login
- [ ] Azure Key Vault or HashiCorp Vault for credential storage (replacing keytar)
- [ ] Centralized audit dashboard: web UI showing all team activity
- [ ] Role-based access: Admin, Developer, Reviewer roles
- [ ] Compliance report export: PDF audit report for SOC2/ISO reviews

---

## CPI-2: UI5 / Fiori Development Support

### Objective
Extend DarkHorse to support SAP UI5 and Fiori application development alongside ABAP, including project scaffolding, UI5 linting, and deployment to SAP BTP.

### Key Deliverables
- [ ] Fiori project scaffold wizard: creates standard UI5 app structure
- [ ] UI5 language support: XML view/fragment highlighting, i18n support
- [ ] UI5 linting: ESLint with UI5 ruleset
- [ ] Deploy to SAP BTP: `cf push` integration via Cloud Foundry CLI
- [ ] AI assistance for UI5: generate XML views and controller JS from prompts

---

## CPI-3: Multi-LLM Support + Agent Marketplace

### Objective
Add support for local Ollama models, create an agent template library, and allow teams to share custom agents.

### Key Deliverables
- [ ] Ollama integration: connect to locally running models (CodeLlama, Llama 3, Mistral)
- [ ] Model selector UI: switch between Claude, Azure OpenAI, Ollama per task
- [ ] Agent template library: pre-built agents for common SAP tasks
- [ ] Agent sharing: export/import agent definitions as JSON
- [ ] Performance benchmarking: compare LLM outputs across models for ABAP quality

---

## CPI-4: BR → FDS → TDS → Code Pipeline

### Objective
Enable developers to paste a Business Requirement or User Story into DarkHorse and have it drive a structured, AI-assisted pipeline that produces a Functional Design Specification (FDS), a Technical Design Specification (TDS), and then ABAP code — one object at a time, with human review and edit gates at every stage.

### Design Principles
- **Human-in-the-loop at every gate** — no stage advances without developer review and explicit approval
- **Documents are first-class artifacts** — FDS and TDS are saved as `.docx` files to the Git repo
- **Reference-aware generation** — at project start, developer provides existing FDS/TDS docs from the repo; DarkHorse uses these to match team's writing style and terminology
- **Traceable** — every requirement in the BR maps to a numbered item in the FDS, which maps to an object in the TDS, which maps to generated code
- **Incremental automation** — pipeline starts manual/gated; as DarkHorse matures, gates can be made automatic

### Pipeline Flow

```
Developer pastes Business Requirement / User Story
        ↓
[GATE 1] Developer reviews BR — confirms scope before FDS generation
        ↓
DarkHorse generates FDS (.docx) using BR + reference docs for style
        ↓
[GATE 2] Developer reviews and edits FDS in Word → approves
        ↓
DarkHorse generates TDS (.docx) using approved FDS + reference docs
        ↓
[GATE 3] Developer reviews and edits TDS in Word → approves
        ↓
DarkHorse reads ABAP Object List from TDS → presents object-by-object plan
        ↓
[GATE 4] Developer confirms object list and order
        ↓
For each ABAP object:
  → DarkHorse generates code using TDS section for that object
  → Shows diff preview in editor
  → Developer reviews, edits, accepts
  → Code saved to SAP via ADT + assigned to transport
        ↓
All objects complete → Developer commits FDS, TDS, and .abap files to Git
```

### Deliverables
- [ ] **BR Intake Panel** — VS Code Webview: paste area for BR/User Story text, project context fields (RICEFW type, target object type, package), reference document picker (pulls from Git repo)
- [ ] **Reference Doc Loader** — reads existing `.docx` FDS/TDS files from Git repo at project start; extracts style, terminology, and section patterns for LLM context
- [ ] **FDS Generator** — LLM call (via proxy) with BR + reference style context; produces structured FDS following standard template; outputs `.docx` via docx library
- [ ] **FDS Review Panel** — displays generated FDS sections in DarkHorse for inline review; "Open in Word" button; "Approve FDS" gate button
- [ ] **TDS Generator** — LLM call with approved FDS + reference style context; produces TDS following standard template; outputs `.docx`; extracts ABAP Object List as structured JSON
- [ ] **TDS Review Panel** — displays TDS sections and parsed ABAP Object List; "Open in Word" button; "Approve TDS" gate button
- [ ] **Object-by-Object Code Generator** — iterates ABAP Object List from TDS; for each object calls LLM with the relevant TDS section; shows diff preview; developer accepts before moving to next
- [ ] **Pipeline Status Tracker** — sidebar panel showing current pipeline stage, completed stages, and links to generated artifacts
- [ ] **Git Auto-Commit for Docs** — after FDS and TDS approval, auto-stages `.docx` files and prompts developer to commit with pre-filled message

### FDS Template Structure (Default)

| # | Section | Notes |
|---|---------|-------|
| 1 | Document Header | Title, Author, Version, Date, Status, BR/Story reference |
| 2 | Business Background & Objectives | Why this is being built |
| 3 | Scope | In-scope / Out-of-scope |
| 4 | Business Process Overview | Narrative of the process |
| 5 | Functional Requirements | Numbered, traceable to User Story |
| 6 | User Interface / Screen Design | If applicable |
| 7 | Input / Output Specifications | Fields, formats, sources |
| 8 | Business Rules & Validations | Logic rules, edge cases |
| 9 | Error Handling & Messages | User-facing error text |
| 10 | Authorization & Security Considerations | Roles, auth objects |
| 11 | Reporting Requirements | If applicable |
| 12 | Open Items / Assumptions / Dependencies | Parking lot |

### TDS Template Structure (Default)

| # | Section | Notes |
|---|---------|-------|
| 1 | Document Header | Title, Author, Version, Date, Status, FDS reference + version |
| 2 | Reference to FDS | Document link, version, key decisions from FDS |
| 3 | Technical Approach & Design Decisions | Architecture choices, patterns used |
| 4 | ABAP Object List | Program, Class, FM, Enhancement — one row per object with type and description |
| 5 | Data Dictionary Objects | Tables, Structures, Data Elements, Domains |
| 6 | Program Logic | Pseudocode per object, keyed to Object List row number |
| 7 | Interface / Integration Design | RFC, BAPI, IDoc, REST — if applicable |
| 8 | Database Design & Performance | Table access strategy, indexes, volume considerations |
| 9 | Error Handling & Logging | Technical error handling approach, application log |
| 10 | Transport Strategy | Which objects go in which transport, sequence |
| 11 | Unit Test Scenarios | Test case per object, expected inputs/outputs |
| 12 | Open Items / Assumptions / Dependencies | Parking lot |

### Key Files

| File / Directory | Purpose |
|-----------------|---------|
| `extensions/darkhorse-pipeline/src/BrIntakePanel.ts` | Webview: BR/User Story paste area, project context, reference doc picker |
| `extensions/darkhorse-pipeline/src/ReferenceDocLoader.ts` | Reads existing .docx FDS/TDS from Git repo, extracts style context for LLM |
| `extensions/darkhorse-pipeline/src/FdsGenerator.ts` | LLM call → structured FDS content; maps to FDS template sections |
| `extensions/darkhorse-pipeline/src/TdsGenerator.ts` | LLM call → structured TDS content; extracts ABAP Object List as JSON |
| `extensions/darkhorse-pipeline/src/DocxWriter.ts` | Converts generated FDS/TDS content to formatted .docx using docx library |
| `extensions/darkhorse-pipeline/src/FdsReviewPanel.ts` | Webview: section-by-section FDS review, edit, approve gate |
| `extensions/darkhorse-pipeline/src/TdsReviewPanel.ts` | Webview: TDS review, ABAP Object List confirmation, approve gate |
| `extensions/darkhorse-pipeline/src/ObjectCodeGenerator.ts` | Iterates Object List; calls LLM per object; triggers DiffPreview for each |
| `extensions/darkhorse-pipeline/src/PipelineTracker.ts` | Sidebar panel: pipeline stage status, artifact links, gate history |
| `extensions/darkhorse-pipeline/src/PipelineGitHelper.ts` | Stages and commits .docx artifacts to Git repo after approval |
| `extensions/darkhorse-pipeline/templates/fds-template.json` | Default FDS section definitions; overridable per project |
| `extensions/darkhorse-pipeline/templates/tds-template.json` | Default TDS section definitions; overridable per project |

### Test Criteria
- [ ] Paste a sample User Story → BR Intake Panel captures it correctly
- [ ] FDS generated with all 12 sections populated and traceable to BR
- [ ] FDS saved as `.docx` to configured Git repo folder
- [ ] Developer edits FDS in Word, re-imports — edits are preserved before TDS generation
- [ ] TDS generated from approved FDS with all 12 sections populated
- [ ] ABAP Object List correctly parsed from TDS as structured data
- [ ] Code generated for first object — diff preview shown, not auto-inserted
- [ ] Accept code → saved to SAP via ADT, assigned to transport
- [ ] Second object generated after first is accepted
- [ ] Pipeline Tracker shows correct stage throughout
- [ ] FDS and TDS `.docx` files committed to Git after approval

### Security Actions
- All LLM calls go through existing proxy + PII scrubber — same rules as MVP-5
- Reference documents loaded locally from Git repo — never sent to LLM in full; only style/structure extracted
- Generated `.docx` files saved to local workspace first, then committed via Git — no cloud upload
- BR text treated as potentially sensitive — scrubbed of client identifiers before LLM transmission

### Future Automation (Post-CPI-4 Stabilization)
- Gate 1–4 can be made automatic once team trusts output quality
- Jira integration: pull User Stories directly instead of paste (planned for later)
- One-shot pipeline mode: BR → FDS → TDS → all objects generated in sequence with single approval
- Template mapping: map default FDS/TDS sections to Deloitte's official engagement templates
