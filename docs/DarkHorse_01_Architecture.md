# DarkHorse — Security-First Architecture
> SAP S/4HANA ABAP Development IDE | Version 1.0 | Confidential — Deloitte Internal

---

## 1. Executive Summary

DarkHorse is a VS Code-forked IDE purpose-built for SAP S/4HANA RICEFW development (Reports, Interfaces, Conversions, Enhancements, Forms, Workflows). It bridges modern developer tooling — AI assistance, Git integration, agent orchestration — with SAP's ABAP ecosystem.

**DarkHorse is designed to:**
- Replace Eclipse ADT as the primary ABAP development interface for Deloitte consulting teams
- Provide AI-assisted code generation, review, and explanation via a controlled LLM proxy
- Enforce security-first principles: no credential exposure, no uncontrolled data egress, no autonomous destructive actions
- Scale from 2-person teams to enterprise deployments with licensing
- Support SAP S/4HANA 1809 Private Cloud and above

---

## 2. Security Architecture (Priority #1)

Security is not a layer added on top of DarkHorse — it is the foundation every component is built upon.

### 2.1 Security Principles

| Principle | Implementation |
|-----------|---------------|
| **Zero Credential Exposure** | SAP passwords never stored in plaintext. Encrypted in Windows Credential Manager (DPAPI). Never transmitted in logs or telemetry. |
| **No Direct LLM Calls** | All AI requests route through DarkHorse Local Proxy (MVP) or enterprise API Gateway (CPI). Developer machine never calls Claude/OpenAI directly. |
| **No Autonomous Destructive Actions** | Agents cannot delete objects, release transports, or modify PRD. All destructive operations require explicit developer confirmation. |
| **Code Data Isolation** | ABAP source code sent to LLM is stripped of client-specific identifiers, system IDs, and business data before transmission. PII scrubbing is mandatory. |
| **Audit Logging** | Every SAP action, LLM call, and agent task is logged locally with timestamp, user, action type, and result. Logs are tamper-evident. |
| **Least Privilege** | DarkHorse connects to SAP using the developer's own credentials. No shared service accounts. No elevated access beyond what Eclipse would use. |
| **Input Validation** | All LLM-generated code is sandboxed and syntax-checked before it can be inserted into an editor. No direct execution of AI output. |
| **Transport Safety** | Transport creation and object assignment require explicit user action. DarkHorse cannot automatically release transports. |

### 2.2 Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| SAP credential theft | Critical | Windows Credential Manager, no plaintext storage, session tokens in memory only |
| ABAP code exfiltration to LLM | High | Local proxy with PII scrubber, data classification layer, opt-in transmission |
| Prompt injection via AI | High | System prompt hardening, output sandboxing, no auto-execution of LLM output |
| Autonomous agent overreach | High | Agent permission scoping, human-in-the-loop for all write operations |
| Man-in-the-middle on SAP ADT | Medium | TLS 1.2+ enforced, certificate pinning for SAP host |
| Malicious extension/plugin | Medium | Extension allow-listing, no marketplace in MVP, code-signed extensions only |
| Log data leakage | Medium | Logs stored locally, encrypted at rest, no cloud sync of logs |
| LLM output code injection | Medium | Syntax validation layer, AST scanning before code insertion |

### 2.3 LLM Proxy Architecture

The DarkHorse Local Proxy is a lightweight Node.js process that runs on the developer's machine and is the **sole gateway** for all AI communications.

- Listens on `localhost` only (`127.0.0.1`) — no external binding
- Receives code context from the editor, applies PII scrubber, forwards to LLM API
- Strips system identifiers (SID, client numbers, hostnames) from all outbound payloads
- Enforces rate limiting to prevent accidental runaway API costs
- In enterprise mode: replaced by Azure API Management or AWS API Gateway
- Supports pluggable backends: Claude API, Azure OpenAI, local Ollama instance

---

## 3. System Component Architecture

### 3.1 High-Level Component Map

| Layer | Component | Technology | Purpose |
|-------|-----------|-----------|---------|
| Presentation | DarkHorse Editor Shell | Electron + VS Code Fork | The IDE window, tabs, panels, menus |
| Presentation | ABAP Language Extension | VS Code Extension API + TextMate Grammar | Syntax highlighting, IntelliSense, error markers |
| Presentation | SAP Explorer Panel | React Webview | Tree view of SAP objects, packages, transports |
| Presentation | Agent Dashboard Panel | React Webview | Agent creation wizard, task monitor, report viewer |
| Business Logic | SAP ADT Connector | Node.js + REST Client | Connects to SAP ADT APIs for read/write/syntax check |
| Business Logic | Transport Manager | Node.js service | Create, list, assign objects to transports |
| Business Logic | LLM Proxy Service | Node.js Express | Routes AI calls, applies security filters |
| Business Logic | Agent Orchestrator | Node.js + subprocess | Spins up, manages, and tears down AI agents |
| Business Logic | Git Integration | Node.js + simple-git | Commit, pull, branch, push operations |
| Security | Credential Vault | Windows DPAPI via keytar | Encrypted storage of SAP credentials |
| Security | PII Scrubber | Node.js module | Strips sensitive data from LLM payloads |
| Security | Audit Logger | Node.js + local SQLite | Tamper-evident local audit trail |
| Data | Local Config Store | JSON + AES-256 encrypted file | User preferences, system landscape config |

### 3.2 Data Flow: ABAP Code Generation

```
Developer types prompt
        ↓
Editor captures active file context (program name, object type, surrounding code)
        ↓
PII Scrubber strips system IDs, client numbers, hostnames
        ↓
Sanitized payload → LLM Proxy (localhost:PORT)
        ↓
Proxy appends ABAP system prompt + safety guardrails
        ↓
LLM response received → AST syntax validator
        ↓
Code suggestion shown as DIFF PREVIEW (not auto-inserted)
        ↓
Developer reviews → Accept / Modify / Reject
        ↓
Accepted code saved locally → Developer manually triggers ADT upload
```

### 3.3 Data Flow: SAP ADT Connection

```
User selects SAP system from landscape config
        ↓
Credential Vault retrieves encrypted credentials via Windows DPAPI
        ↓
ADT Connector authenticates: CSRF token fetch + Basic Auth over HTTPS
        ↓
Session token held IN MEMORY ONLY — never written to disk
        ↓
All ADT calls use TLS 1.2 minimum with certificate validation
        ↓
Session expires and is cleared when DarkHorse closes or user logs out
```

### 3.4 Data Flow: Agent Task

```
Developer opens Agent Dashboard → clicks 'New Agent'
        ↓
Wizard collects: task description, scope, permissions, timeout
        ↓
Agent Orchestrator spawns subprocess with scoped context + tool access
        ↓
Agent works: reads code, calls LLM, produces report
        ↓  (NO write permissions by default)
Agent drops report into editor notification panel
        ↓
Developer reviews report → grants explicit consent to apply changes
        ↓
Agent applies changes as tracked diff → developer reviews and accepts
        ↓
Agent subprocess terminated, resources released
```

---

## 4. Technology Stack

| Category | Technology | Rationale |
|----------|-----------|-----------|
| IDE Shell | VS Code (Electron fork) | Proven, extensible. ABAP extensions already exist in community. |
| Editor Extensions | VS Code Extension API | Native integration, no custom protocol needed. |
| ABAP Grammar | TextMate Grammar (tm-language) | VS Code native syntax highlighting format. |
| SAP Connectivity | SAP ADT REST APIs | Same protocol Eclipse uses. Stable, documented, supports all RICEFW operations. |
| LLM Proxy | Node.js + Express | Lightweight, same runtime as VS Code, easy to bundle. |
| AI Backends | Claude API / Azure OpenAI / Ollama | Multi-backend via adapter pattern. Client chooses deployment model. |
| Agent Runtime | Node.js child_process | Subprocess isolation, no Docker required for MVP. |
| Git Integration | simple-git (npm) | Thin wrapper over git CLI. Reliable, well-maintained. |
| Credential Storage | keytar (npm) | Windows Credential Manager via DPAPI. Industry standard for Electron apps. |
| Audit Logging | better-sqlite3 (npm) | Local SQLite. No external dependency. Tamper-evident with row hashing. |
| UI Panels | React + Tailwind CSS | VS Code webview panels. |
| Build & Package | Electron Builder | Creates Windows .exe installer. Code signing ready. |
| Target OS | Windows 10/11 x64 | MVP target. Linux/Mac in CPI if needed. |

---

## 5. SAP ADT API Integration

DarkHorse uses SAP's ADT REST API — the same protocol Eclipse uses internally. No screen-scraping. No unofficial APIs.

| Feature | ADT Endpoint | Method | Notes |
|---------|-------------|--------|-------|
| Authentication | `/sap/bc/adt/core/discovery` | GET | Returns CSRF token and capability document |
| List Packages | `/sap/bc/adt/repository/nodestructure` | GET | Browse repository tree |
| Read ABAP Source | `/sap/bc/adt/programs/programs/{name}/source/main` | GET | Retrieve source code |
| Write ABAP Source | `/sap/bc/adt/programs/programs/{name}/source/main` | PUT | Save source code |
| Syntax Check | `/sap/bc/adt/checkruns` | POST | Returns syntax errors with line numbers |
| Create Transport | `/sap/bc/adt/cts/transports` | POST | Create new transport request |
| List Transports | `/sap/bc/adt/cts/transports` | GET | List available transports |
| Assign to Transport | `/sap/bc/adt/cts/transports/{id}/tasks` | POST | Add object to transport |
| Activate Object | `/sap/bc/adt/activation` | POST | Activate ABAP object after save |
| Search Objects | `/sap/bc/adt/repository/informationsystem/search` | GET | Search by name/type |

> All ADT calls require a valid `X-CSRF-Token` header. DarkHorse fetches this on session start and refreshes as needed. Sessions are maintained in memory and cleared on logout.

---

## 6. LLM Strategy

### 6.1 Recommended Configuration by Deployment

| Scenario | Recommended Model | Rationale |
|----------|------------------|-----------|
| Deloitte Internal (MVP) | Claude 3.5 Sonnet via Anthropic API + Local Proxy | Best ABAP code quality. Proxy ensures no direct client data exposure. |
| Client Engagement (Cloud) | Azure OpenAI GPT-4o via client's Azure tenant | Data stays in client's Azure subscription. Compliant with most enterprise policies. |
| Client Engagement (Air-gapped) | Ollama + CodeLlama 34B or Llama 3 locally | No internet required. Code never leaves the machine. |
| High Security Client | Private Azure OpenAI in client's VNet | Enterprise data residency. SOC2/ISO compliant by Azure's certifications. |

### 6.2 LLM Adapter Pattern

DarkHorse uses an adapter interface so it is not locked to any single AI provider. Switching backends requires only a config change, not a code change.

```
ILLMAdapter (interface)
├── generateCode(prompt, context)
├── reviewCode(code)
└── explainCode(code)

Implementations:
├── ClaudeAdapter       → Anthropic API via proxy
├── AzureOpenAIAdapter  → Azure OpenAI endpoint
└── OllamaAdapter       → Local Ollama REST API (no proxy needed — already local)
```

---

## 7. Compliance & Certification Readiness

| Framework | Relevant Controls | DarkHorse Implementation |
|-----------|------------------|--------------------------|
| SOC 2 Type II | CC6.1 Logical Access, CC6.6 Data Transmission, CC7.2 System Monitoring | Credential vault, TLS enforcement, audit logging, no plaintext credentials |
| ISO 27001 | A.9 Access Control, A.10 Cryptography, A.12 Operations Security | DPAPI encryption, AES-256 config, tamper-evident audit log |
| Deloitte InfoSec Policy | Data classification, client data handling, approved tool usage | PII scrubber, no uncontrolled data egress, proxy-only LLM access |
| GDPR (if applicable) | Data minimization, purpose limitation | Only code context sent to LLM, no personal data, opt-in telemetry |

> **Certification path:** Once MVP is stable and internally validated, engage Deloitte's Information Security team for a risk assessment. Target SOC 2 readiness review before any external client deployment.
