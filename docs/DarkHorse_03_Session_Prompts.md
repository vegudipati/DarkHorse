# DarkHorse — Session Build Prompts
> Token-Optimized Prompts for Each Build Session | Confidential — Deloitte Internal

---

## How to Use This Document

Each build session starts a **new Claude conversation**. Paste the relevant prompt at the start of that session. This carries just enough context without burning tokens re-explaining the full project.

| Situation | What to Do |
|-----------|-----------|
| Starting a new MVP package | Paste the **Session Start Prompt** for that package |
| Continuing a package next day | Paste the **Continuation Prompt** + brief status of what's done |
| Debugging in a session | Stay in same session, share error output directly |
| Starting next package after finishing prior one | Paste next package's Start Prompt — no need to re-explain previous packages |
| Session getting long (15+ exchanges) | Save code, start new session with Continuation Prompt |

### Token Budget Rules
- Paste **only the relevant error + the specific file** when debugging — not the entire codebase
- For large files (200+ lines): ask Claude to "build the class structure first, then we add methods"
- Reference this doc's section numbers instead of re-explaining architecture
- Paste error message + the 2–3 lines of code around the failure only

---

## MVP-1: Foundation Shell

### Session Start Prompt
```
We are building DarkHorse — a VS Code fork for SAP S/4HANA ABAP development.
You are writing all code; I am reviewing and testing on Windows 10/11.
Security is top priority. Today's task: MVP-1 Foundation Shell.

Deliverables (build one at a time, explain each):
1. Fork VS Code repo on my GitHub — provide exact git commands
2. product.json changes: DarkHorse branding, marketplace disabled, telemetry off
3. Electron Builder config for Windows .exe (build/darkhorse-build.js)
4. Extension allow-list enforcement in extension host
5. Basic settings schema in extensions/darkhorse-core/

Security rules:
- Disable all VS Code telemetry (crashReporter + telemetry settings)
- Remove marketplace endpoint from product.json
- No external calls except what we explicitly build

Start with step 1.
```

### Continuation Prompt
```
Continuing DarkHorse MVP-1 Foundation Shell.

Completed: [paste what is done]
Remaining: [paste what is left from deliverables list]

Current state of [filename]:
[paste relevant file content]

Continue from here.
```

---

## MVP-2: SAP ADT Connector

### Session Start Prompt
```
DarkHorse — VS Code fork for SAP ABAP development. 
MVP-1 complete: VS Code fork, Windows .exe build, marketplace disabled, telemetry off.
Now building MVP-2: SAP ADT Connector.

Stack: TypeScript, VS Code Extension API, keytar (Windows Credential Manager), SAP ADT REST APIs.
Target: SAP S/4HANA 1809 Private Cloud, DEV system only.

Deliverables (one file at a time):
1. AdtClient.ts — CSRF token fetch, Basic Auth, GET/PUT source over HTTPS (TLS 1.2+)
2. AdtSession.ts — session lifecycle, memory-only token storage, clear on logout
3. CredentialVault.ts — keytar wrapper, Windows Credential Manager only, no plaintext
4. LandscapeManager.ts — SAP system config stored as AES-256 encrypted JSON
5. SapExplorerProvider.ts — VS Code TreeDataProvider: packages, programs, classes in sidebar
6. AbapDocumentProvider.ts — opens SAP objects as virtual files in editor

Security rules:
- Credentials ONLY in Windows Credential Manager via keytar
- Session token in memory only — never written to disk
- All ADT requests TLS only
- Audit log entry for every connect/disconnect

Start with AdtClient.ts.
```

### Continuation Prompt
```
Continuing DarkHorse MVP-2 SAP ADT Connector.

Completed: [e.g., AdtClient.ts, AdtSession.ts, CredentialVault.ts]
Remaining: [e.g., LandscapeManager.ts, SapExplorerProvider.ts, AbapDocumentProvider.ts]

Current state of [filename if relevant]:
[paste file content]

Continue from here.
```

---

## MVP-3: ABAP Language Support

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE on VS Code. MVP-1 and MVP-2 complete.
Building MVP-3: ABAP Language Support.

Deliverables (one file at a time):
1. abap.tmLanguage.json — TextMate grammar: all ABAP keywords, strings, comments, types, operators
2. language-configuration.json — bracket matching, comment toggling (", *), auto-indent rules
3. abap.code-snippets — 20 most common ABAP patterns (SELECT, LOOP AT, METHOD, CLASS, etc.)
4. SyntaxChecker.ts — calls ADT /sap/bc/adt/checkruns on file save, parses XML response into VS Code diagnostics
5. DiagnosticsProvider.ts — manages DiagnosticCollection, maps ADT errors to correct line/column
6. AbapCompletionProvider.ts — keyword suggestions + snippet triggers

The ADT syntax check endpoint returns XML with error line numbers and messages.
Parse that XML and show red squiggles in editor with hover messages.

Start with abap.tmLanguage.json.
```

### Continuation Prompt
```
Continuing DarkHorse MVP-3 ABAP Language Support.

Completed: [paste what is done]
Remaining: [paste what remains]

[Paste any relevant file or error if debugging]

Continue from here.
```

---

## MVP-4: Transport Manager

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE on VS Code. MVP-1/2/3 complete.
Building MVP-4: Transport Manager.

SAP ADT is already connected (AdtClient.ts exists and works).
ADT transport endpoints:
- GET /sap/bc/adt/cts/transports — list transports
- POST /sap/bc/adt/cts/transports — create transport
- POST /sap/bc/adt/cts/transports/{id}/tasks — assign object to transport

Deliverables (one file at a time):
1. TransportClient.ts — ADT calls for list/create transports and assign objects. Reuse AdtClient session.
2. TransportProvider.ts — VS Code TreeDataProvider for transport sidebar panel
3. TransportItem.ts — tree node model: transport, task, assigned object
4. TransportWebview.ts — webview form: create transport (description, type: Workbench/Customizing)
5. transportCommands.ts — command handlers: createTransport, assignToTransport, refreshTransports

Security rule: NO release transport action. Transport release stays in STMS only.
Released transports must appear as read-only in the panel.

Start with TransportClient.ts.
```

---

## MVP-5: LLM Proxy + AI Code Generation

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE on VS Code. MVP-1/2/3/4 complete.
Building MVP-5: LLM Proxy + AI Code Generation.

Architecture:
- DarkHorse spawns a Node.js Express server on 127.0.0.1 ONLY when it starts
- All LLM calls from the editor go through this proxy — never direct
- Proxy applies PII scrubber before forwarding to Claude API
- PII scrubber strips: SAP system IDs (SIDs), client numbers, hostnames, IP addresses

Deliverables (one file at a time):
1. services/llm-proxy/index.ts — Express server, localhost-only binding, graceful shutdown
2. PiiScrubber.ts — regex patterns for SAP identifiers, configurable strip rules
3. RateLimiter.ts — token bucket: configurable max requests/minute
4. ClaudeAdapter.ts — Anthropic API client, model: claude-sonnet-4-20250514, response parsing
5. OllamaAdapter.ts — local Ollama REST client for offline deployments
6. AbapSystemPrompt.ts — hardcoded system prompt: ABAP coding standards + no-delete safety rules
7. AiPanel.ts — VS Code Webview: chat UI, context-aware (knows active file + object type)
8. DiffPreview.ts — shows generated code as VS Code diff editor, NOT auto-inserted
9. ContextCollector.ts — gathers active file content, selection, ABAP object type for AI context

Security rules:
- Proxy ONLY binds to 127.0.0.1 — reject any external binding attempt
- Claude API key stored in Windows Credential Manager via keytar — never in config files
- Every LLM call logged: timestamp, prompt hash (not content), token count
- Generated code shown as diff preview — developer must explicitly accept

Start with services/llm-proxy/index.ts.
```

### Continuation Prompt
```
Continuing DarkHorse MVP-5 LLM Proxy + AI Code Generation.

Completed: [paste what is done]
Remaining: [paste what remains]
LLM Proxy is running on: [port number if known]

[Paste any relevant file or error]

Continue from here.
```

---

## MVP-6: Git Integration

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE on VS Code. MVP-1 through MVP-5 complete.
Building MVP-6: Git Integration.

Approach: ABAP source is exported from SAP to .abap files in a local workspace folder,
then committed via Git to GitHub. We use the simple-git npm package.

Deliverables (one file at a time):
1. GitService.ts — simple-git wrapper: clone, stage, commit, push, pull, createBranch, switchBranch, listBranches
2. AbapExporter.ts — exports currently open SAP object source to .abap file in configured workspace folder
3. GitPanelProvider.ts — VS Code TreeDataProvider: changed files, current branch, recent 10 commits
4. GitCredentials.ts — GitHub PAT stored in Windows Credential Manager via keytar
5. gitCommands.ts — VS Code command handlers for all git operations with user-friendly dialogs

The workspace folder is configurable in DarkHorse settings.
File naming convention: {OBJECT_TYPE}_{OBJECT_NAME}.abap (e.g., PROG_ZTEST_REPORT.abap)

Start with GitService.ts.
```

---

## MVP-7: Agent Orchestrator

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE on VS Code. MVP-1 through MVP-6 complete.
Building MVP-7: Agent Orchestrator.

Architecture:
- Agents are Node.js child_process subprocesses — no Docker
- Agents have READ-ONLY access to SAP by default
- All write operations blocked by ConsentGate until developer explicitly approves
- Agents call LLM via the existing LLM Proxy (MVP-5) — same PII scrubber applies
- First agent to build: Code Review Agent

Deliverables (one file at a time):
1. AgentOrchestrator.ts — spawns/tracks/kills agent subprocesses, enforces permission scoping, timeout enforcement
2. ConsentGate.ts — intercepts ALL write tool calls, returns "awaiting_consent" status until developer approves via UI
3. AgentWizard.ts — VS Code Webview wizard: collects task description, scope (file/package), timeout, permissions
4. AgentRuntime.ts — child process entry point: receives scoped context, runs agent loop, emits structured results
5. CodeReviewAgent.ts — reads ABAP code via ReadSapTool, calls LLM, produces structured JSON review report
6. AgentDashboard.ts — VS Code Webview: list active/completed agents, status indicators, per-agent log viewer
7. ReportViewer.ts — renders agent report in editor panel, Accept/Reject buttons trigger DiffPreview (from MVP-5)
8. tools/ReadSapTool.ts — agent tool: read SAP object source (read-only, uses ADT GET)
9. tools/LlmCallTool.ts — agent tool: call LLM via proxy on localhost (routes through PII scrubber)

Security rules:
- Agent subprocess cannot access Windows Credential Manager
- ConsentGate cannot be bypassed — write tools MUST block until consent received
- Process kill on timeout — no hung agents
- Agent subprocess gets a READ-ONLY copy of SAP session context

Start with AgentOrchestrator.ts.
```

### Continuation Prompt
```
Continuing DarkHorse MVP-7 Agent Orchestrator.

Completed: [paste what is done]
Remaining: [paste what remains]

Agent subprocess communication method: [IPC/stdin-stdout — confirm what was decided]

[Paste any relevant file or error]

Continue from here.
```

---

## CPI-1: Enterprise Security Layer

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE. All 7 MVP packages complete and tested.
Starting CPI-1: Enterprise Security Layer.

Goal: Replace local proxy with enterprise gateway, add Azure AD SSO, 
replace keytar with Azure Key Vault, build centralized audit dashboard.

Confirm before starting:
1. Azure subscription available? Y/N
2. Azure AD tenant configured? Y/N
3. Azure Key Vault instance created? Y/N

Once confirmed, we will plan CPI-1 build order together.
```

---

## CPI-2: UI5 / Fiori Support

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE. All 7 MVP packages complete. CPI-1 complete.
Starting CPI-2: UI5 / Fiori Development Support.

Goal: Add Fiori project scaffolding, UI5 XML view support, ESLint with UI5 rules,
and deployment to SAP BTP via Cloud Foundry CLI.

Confirm before starting:
1. SAP BTP subaccount available for testing? Y/N
2. Cloud Foundry CLI installed on test machine? Y/N
3. SAP UI5 version target (1.x or 2.x)?

Once confirmed, we plan CPI-2 build order together.
```

---

## CPI-3: Multi-LLM + Agent Marketplace

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE. All 7 MVP packages complete. CPI-1 and CPI-2 complete.
Starting CPI-3: Multi-LLM Support + Agent Marketplace.

Goal: Add Ollama local model support, model selector UI, agent template library,
agent sharing via JSON export/import.

Confirm before starting:
1. Ollama installed and running on test machine? Y/N
2. Which local models to test with? (CodeLlama, Llama 3, Mistral, other)

Once confirmed, we plan CPI-3 build order together.
```

---

## CPI-4: BR → FDS → TDS → Code Pipeline

### Session Start Prompt
```
DarkHorse — SAP ABAP IDE. All 7 MVP packages complete. CPI-1, CPI-2, CPI-3 complete.
Starting CPI-4: Business Requirement → FDS → TDS → Code Pipeline.

Goal: Developer pastes a Business Requirement or User Story into DarkHorse.
DarkHorse drives a structured AI-assisted pipeline:
  BR → Functional Design Spec (FDS .docx) → Technical Design Spec (TDS .docx) → ABAP Code (object by object)

Key design rules:
- Human review gate at EVERY stage — nothing advances without developer approval
- FDS and TDS saved as .docx files to the Git repo (using docx npm library)
- Reference documents: at project start, developer points DarkHorse to existing FDS/TDS .docx
  files in the repo — these are used to match team writing style and terminology
- Code generated one ABAP object at a time — each object reviewable before next begins
- All LLM calls go through existing LLM Proxy (MVP-5) — same PII scrubber rules apply

FDS template: 12 sections (see DarkHorse_02_MVP_Packages.md CPI-4 for full list)
TDS template: 12 sections (see DarkHorse_02_MVP_Packages.md CPI-4 for full list)

Build order (one file at a time):
1. ReferenceDocLoader.ts — reads existing .docx FDS/TDS from Git repo, extracts style/terminology for LLM context
2. BrIntakePanel.ts — Webview: BR paste area, RICEFW type selector, reference doc picker
3. FdsGenerator.ts — LLM call with BR + reference context → structured FDS content mapped to 12 sections
4. DocxWriter.ts — converts FDS/TDS structured content to formatted .docx using docx npm library
5. FdsReviewPanel.ts — Webview: section-by-section FDS display, edit fields, Approve gate button
6. TdsGenerator.ts — LLM call with approved FDS + reference context → TDS content + ABAP Object List as JSON
7. TdsReviewPanel.ts — Webview: TDS review, Object List confirmation table, Approve gate button
8. ObjectCodeGenerator.ts — iterates ABAP Object List; LLM call per object using TDS section; triggers DiffPreview
9. PipelineTracker.ts — sidebar panel showing pipeline stage, artifact links, gate history
10. PipelineGitHelper.ts — auto-stages .docx artifacts and prompts commit after each approval

Security rules:
- BR text scrubbed of client identifiers before LLM call (same PII scrubber as MVP-5)
- Reference docs loaded locally — only style/structure extracted, never full doc sent to LLM
- Generated .docx saved to local workspace first, then committed via Git — never cloud-uploaded

Start with ReferenceDocLoader.ts.
```

### Continuation Prompt
```
Continuing DarkHorse CPI-4 BR → FDS → TDS → Code Pipeline.

Completed: [paste what is done]
Remaining: [paste what remains]

Pipeline config:
- Reference docs loaded from: [repo path]
- FDS template: default 12-section (or custom if applicable)
- TDS template: default 12-section (or custom if applicable)

[Paste any relevant file or error]

Continue from here.
```

### Project Setup Prompt (Run Once Per New Engagement)
```
DarkHorse CPI-4 — New Project Setup.

I am starting a new SAP engagement and need to configure the BR → FDS → TDS → Code pipeline.

Actions needed:
1. Reference documents folder in this Git repo: [path]
2. Reference FDS documents available: [list filenames]
3. Reference TDS documents available: [list filenames]
4. Primary RICEFW type for this engagement: [Report / Interface / Conversion / Enhancement / Form / Workflow]
5. Default ABAP package for generated objects: [package name]
6. Default transport: [transport number or 'create new']

Load the reference documents and confirm style extraction is complete before we begin the first BR.
```
