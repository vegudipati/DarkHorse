# DarkHorse — CPI-4 Build Plan
## BR → FDS → TDS → Code Pipeline
> Confidential — Deloitte Internal | Updated post MVP-1 through MVP-7

---

## Overview

CPI-4 adds the most valuable AI capability in DarkHorse: a developer pastes a Business
Requirement or User Story, and DarkHorse drives a structured pipeline that produces:

1. A Functional Design Specification (.docx) saved to Git
2. A Technical Design Specification (.docx) saved to Git  
3. ABAP code — one object at a time, each reviewable before the next

Every stage has a human review gate. Nothing advances without developer approval.

---

## Prerequisites (Confirm Before Starting)

- [ ] MVP-1 through MVP-7 complete and committed to GitHub
- [ ] LLM Proxy running (MVP-5) — CPI-4 routes all LLM calls through it
- [ ] Git integration working (MVP-6) — CPI-4 commits .docx files to repo
- [ ] Claude API key configured in DarkHorse
- [ ] `docx` npm package available — we use this to generate .docx files
- [ ] At least one existing FDS or TDS document available for reference style

---

## Architecture

```
extensions/
└── darkhorse-pipeline/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── extension.ts              ← Entry point, registers all commands
        ├── BrIntakePanel.ts          ← Webview: paste BR, select RICEFW type
        ├── ReferenceDocLoader.ts     ← Reads existing .docx for style context
        ├── FdsGenerator.ts           ← LLM call → structured FDS content
        ├── TdsGenerator.ts           ← LLM call → structured TDS + object list
        ├── DocxWriter.ts             ← Converts structured content → .docx
        ├── FdsReviewPanel.ts         ← Webview: review/edit FDS, approve gate
        ├── TdsReviewPanel.ts         ← Webview: review/edit TDS, approve gate
        ├── ObjectCodeGenerator.ts    ← Iterates object list, generates code
        ├── PipelineTracker.ts        ← Sidebar: pipeline stage + artifact links
        └── PipelineGitHelper.ts      ← Auto-stages .docx to Git after approval
```

---

## Build Phases

| Phase | Files | Description | Est. Sessions |
|-------|-------|-------------|--------------|
| Phase 1 | package.json, tsconfig.json, extension.ts | Extension scaffold | 1 |
| Phase 2 | ReferenceDocLoader.ts, BrIntakePanel.ts | BR intake + reference docs | 1-2 |
| Phase 3 | FdsGenerator.ts, DocxWriter.ts, FdsReviewPanel.ts | FDS generation + review | 2 |
| Phase 4 | TdsGenerator.ts, TdsReviewPanel.ts | TDS generation + review | 2 |
| Phase 5 | ObjectCodeGenerator.ts | Code generation per object | 1-2 |
| Phase 6 | PipelineTracker.ts, PipelineGitHelper.ts | Status tracking + Git | 1 |

---

## Phase 1: Extension Scaffold

### package.json
```json
{
  "name": "darkhorse-pipeline",
  "displayName": "DarkHorse Pipeline",
  "description": "BR → FDS → TDS → Code pipeline for SAP RICEFW development",
  "version": "0.1.0",
  "publisher": "deloitte-darkhorse",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "darkhorse-pipeline",
        "title": "DarkHorse Pipeline",
        "icon": "resources/pipeline-icon.svg"
      }]
    },
    "views": {
      "darkhorse-pipeline": [{
        "id": "darkhorse.pipelineTracker",
        "name": "Pipeline Status"
      }]
    },
    "commands": [
      {
        "command": "darkhorse.pipeline.start",
        "title": "DarkHorse: Start BR → FDS → TDS → Code Pipeline"
      },
      {
        "command": "darkhorse.pipeline.loadReferenceDocs",
        "title": "DarkHorse: Load Reference Documents for This Project"
      },
      {
        "command": "darkhorse.pipeline.resumePipeline",
        "title": "DarkHorse: Resume Pipeline"
      }
    ],
    "configuration": {
      "title": "DarkHorse Pipeline",
      "properties": {
        "darkhorse.pipeline.outputFolder": {
          "type": "string",
          "default": "",
          "description": "Local folder where FDS and TDS .docx files are saved"
        },
        "darkhorse.pipeline.referenceDocsFolder": {
          "type": "string",
          "default": "",
          "description": "Folder containing existing FDS/TDS documents for style reference"
        },
        "darkhorse.pipeline.defaultPackage": {
          "type": "string",
          "default": "",
          "description": "Default SAP package for generated objects"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "vsce package --no-dependencies --allow-missing-repository"
  },
  "dependencies": {
    "docx": "^8.5.0",
    "mammoth": "^1.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "typescript": "^6.0.3"
  }
}
```

### Key npm packages
- `docx` — generates .docx files from structured content
- `mammoth` — reads existing .docx files to extract text for style reference

---

## Phase 2: BR Intake + Reference Doc Loader

### BrIntakePanel.ts — What it does
- Full webview form (same pattern as AddSystemPanel.ts from MVP-2)
- Fields: BR/User Story text area, RICEFW type selector, object type, SAP package
- Reference doc picker: shows .docx files from configured reference folder
- Submits structured data to FdsGenerator

### ReferenceDocLoader.ts — What it does
- Reads .docx files from the reference folder using `mammoth`
- Extracts plain text from each document
- Sends extracted text to LLM with instruction to identify:
  - Writing style (formal/semi-formal)
  - Section heading patterns
  - Terminology preferences
  - Table formats used
- Returns a `StyleContext` object used by FdsGenerator and TdsGenerator
- Documents are NEVER sent to LLM in full — only extracted style patterns

### StyleContext interface
```typescript
interface StyleContext {
  writingStyle: string;        // e.g. "formal, passive voice, present tense"
  terminologyMap: string[];    // e.g. ["use 'Z-program' not 'custom program'"]
  sectionPatterns: string[];   // observed section heading styles
  tableStyle: string;          // e.g. "headers bold, alternating row shading"
  examplePhrases: string[];    // characteristic phrases from reference docs
}
```

---

## Phase 3: FDS Generation + Review

### FdsGenerator.ts — LLM prompt strategy

The FDS generator makes ONE LLM call with this structure:

```
SYSTEM PROMPT:
You are a SAP functional consultant generating a Functional Design Specification.
Follow the exact 12-section structure provided.
Use the style context to match the team's writing conventions.
Return ONLY valid JSON matching the FdsDocument interface.
Do not include markdown, preamble, or explanation.

USER PROMPT:
Business Requirement:
{br_text}

RICEFW Type: {ricefw_type}
Object Type: {object_type}
SAP Package: {package}

Style Context:
{style_context}

Generate a complete FDS following this exact JSON structure:
{fds_template_json}
```

### FdsDocument interface
```typescript
interface FdsDocument {
  title: string;
  author: string;
  version: string;
  date: string;
  status: 'Draft' | 'Review' | 'Approved';
  ricefwType: string;
  brReference: string;
  sections: {
    businessBackground: string;
    scope: { inScope: string[]; outOfScope: string[] };
    processOverview: string;
    functionalRequirements: Array<{ id: string; description: string; priority: string }>;
    uiDesign: string;
    inputOutputSpec: string;
    businessRules: string[];
    errorHandling: string[];
    authorization: string;
    reportingRequirements: string;
    openItems: string[];
  };
}
```

### FdsReviewPanel.ts — What it shows
- All 12 sections displayed in a scrollable webview
- Each section has an Edit button — opens inline textarea
- Top status bar: Draft → Review → Approved
- "Open in Word" button — opens the .docx in Microsoft Word
- "Approve FDS →" button — only enabled when status = Approved
- Approval is the gate that triggers TDS generation

---

## Phase 4: TDS Generation + Review

### TdsGenerator.ts — LLM prompt strategy

Takes the APPROVED FdsDocument as input. Makes ONE LLM call:

```
SYSTEM PROMPT:
You are a SAP technical architect generating a Technical Design Specification.
Follow the exact 12-section structure provided.
Pay special attention to the ABAP Object List — this drives code generation.
Each object in the list must be specific enough to generate ABAP code from.
Return ONLY valid JSON matching the TdsDocument interface.

USER PROMPT:
Approved FDS:
{fds_document_json}

Style Context:
{style_context}

Generate a complete TDS. The ABAP Object List must include:
- Object type (PROG, CLAS, FUGR, ENHC, FORM, WFLO)
- Object name (SAP naming convention: Z prefix)
- Description
- Key logic points (3-5 bullet points per object)
```

### TdsDocument interface
```typescript
interface TdsDocument {
  title: string;
  author: string;
  version: string;
  date: string;
  status: 'Draft' | 'Review' | 'Approved';
  fdsReference: string;
  sections: {
    technicalApproach: string;
    designDecisions: string[];
    abapObjectList: Array<{
      sequence: number;
      objectType: string;      // PROG, CLAS, FUGR, ENHC etc.
      objectName: string;      // Z-prefixed SAP name
      description: string;
      keyLogic: string[];      // 3-5 bullet points
      dependencies: string[];
    }>;
    dataDictionary: string;
    programLogic: string;
    interfaceDesign: string;
    dbDesign: string;
    errorHandling: string;
    transportStrategy: string;
    testScenarios: Array<{ id: string; description: string; expected: string }>;
    openItems: string[];
  };
}
```

### TdsReviewPanel.ts — Key feature
- Shows ABAP Object List as an editable table
- Developer can reorder, add, or remove objects before approving
- This object list is what drives Phase 5 code generation
- "Approve TDS →" gate triggers ObjectCodeGenerator

---

## Phase 5: Object-by-Object Code Generation

### ObjectCodeGenerator.ts — How it works

```
For each object in TDS.abapObjectList (in sequence order):

  1. Show developer: "Ready to generate object N of M: {objectName}"
     with a "Generate" button and "Skip" button

  2. On Generate: LLM call with:
     - The specific object's keyLogic from TDS
     - Surrounding objects for context (prev/next)
     - Active SAP system info (package, transport)
     - ABAP coding standards system prompt (from MVP-5)

  3. Generated code shown as VS Code diff preview
     (reuses DiffPreview from MVP-5)

  4. Developer accepts → code saved to SAP via ADT (MVP-2)
     and assigned to transport (MVP-4)

  5. Move to next object
```

### LLM prompt for code generation
```
SYSTEM PROMPT:
You are an expert ABAP developer. Generate production-quality ABAP code.
Follow SAP naming conventions. Add meaningful comments.
Never generate DELETE FROM database table statements.
Never generate code that releases transports.
All database operations must check SY-SUBRC.

USER PROMPT:
Generate ABAP code for this object:

Object Type: {objectType}
Object Name: {objectName}
Description: {description}

Key Logic to implement:
{keyLogic}

Context from TDS:
- Previous object: {prevObject}
- Next object: {nextObject}
- SAP Package: {package}

Return ONLY the ABAP source code. No explanation. No markdown fences.
```

---

## Phase 6: Pipeline Tracker + Git Helper

### PipelineTracker.ts — Sidebar panel

Shows current pipeline state as a tree:

```
📋 Current Pipeline: ZSALES_REPORT
  ✅ BR Captured (2026-05-03)
  ✅ FDS Generated (2026-05-03) → [Open]
  ✅ FDS Approved (2026-05-03)
  ✅ TDS Generated (2026-05-03) → [Open]
  🔄 TDS Under Review
  ⏳ Code Generation (0/3 objects)
  ⏳ Git Commit
```

### PipelineGitHelper.ts — What it does
- After FDS approval: stages FDS .docx, prompts commit with message:
  `docs: Add FDS for {title} v{version}`
- After TDS approval: stages TDS .docx, prompts commit with message:
  `docs: Add TDS for {title} v{version}`
- After all objects generated: prompts commit with message:
  `feat: {objectNames} generated from TDS {tdsReference}`

---

## DocxWriter.ts — Document generation

Uses the `docx` npm library (same one we used for planning docs).

Key outputs:
- FDS .docx: professional formatting, Deloitte-ready
- TDS .docx: includes ABAP Object List as formatted table
- Both saved to `darkhorse.pipeline.outputFolder` config path
- File naming: `{OBJECTNAME}_FDS_v{VERSION}_{DATE}.docx`

---

## Security Rules for CPI-4

| Rule | Implementation |
|------|---------------|
| BR text PII scrubbing | Same PII scrubber as MVP-5 — strips SAP IDs, client numbers before LLM call |
| Reference docs stay local | mammoth extracts text locally — full doc never sent to LLM |
| Generated .docx local first | Saved to local workspace before Git commit — no cloud upload |
| Code generation via proxy | All LLM calls route through MVP-5 proxy — same audit logging |
| No auto-execution | Generated ABAP shown as diff preview — same ConsentGate pattern as MVP-7 |

---

## Test Scenarios

### End-to-end test (use this when CPI-4 is complete)

**Sample Business Requirement to paste:**
```
User Story: As a Finance user, I need a custom ABAP report (ZFIN_OPEN_ITEMS) 
that displays open customer line items from table KNA1 and BSID, filtered by 
company code and posting date range. The report should show: Customer number, 
Customer name, Document number, Posting date, Amount in local currency, 
and Due date. Output should be displayed using ALV Grid. The report needs 
authorization check for object F_BKPF_BUK (company code).
```

**Expected FDS outputs:**
- Section 2: Finance reporting background
- Section 5: At least 6 numbered functional requirements
- Section 10: Authorization object F_BKPF_BUK documented

**Expected TDS outputs:**
- ABAP Object List: at minimum PROG/ZFIN_OPEN_ITEMS
- Section 6: SELECT from KNA1 and BSID documented
- Section 9: SY-SUBRC checks documented

**Expected code outputs:**
- Valid ABAP program with REPORT statement
- SELECT from KNA1 and BSID
- ALV Grid display
- AUTHORITY-CHECK for F_BKPF_BUK

---

## Session Start Prompt for Monday

Paste this at the start of your first CPI-4 Claude Code session:

```
DarkHorse — SAP ABAP IDE. MVP-1 through MVP-7 complete.
GitHub: https://github.com/vegudipati/DarkHorse.git
Now building CPI-4: BR → FDS → TDS → Code Pipeline.

Key constraints from MVP build:
- Windows 10/11, Node.js v24, TypeScript 6
- No native npm modules (use VS Code SecretStorage not keytar)
- All extensions: vsce package --no-dependencies --allow-missing-repository
- CommonJS throughout (not ESM)
- All LLM calls go through existing LLM proxy from MVP-5 (localhost)
- Generated content always shown as preview — never auto-applied
- New extension: extensions/darkhorse-pipeline/

npm packages needed:
- docx (^8.5.0) — generate .docx files
- mammoth (^1.7.0) — read existing .docx for style reference

Build Phase 1 first:
1. Initialize extensions/darkhorse-pipeline with npm
2. Create package.json (see DarkHorse_02_MVP_Packages.md CPI-4 section)
3. Create tsconfig.json (same pattern as other extensions)
4. Create src/extension.ts scaffold

Start with npm init.
```

---

## Continuation Prompt (use when resuming across sessions)

```
Continuing DarkHorse CPI-4: BR → FDS → TDS → Code Pipeline.

Completed phases:
[ ] Phase 1: Extension scaffold
[ ] Phase 2: BrIntakePanel + ReferenceDocLoader
[ ] Phase 3: FdsGenerator + DocxWriter + FdsReviewPanel
[ ] Phase 4: TdsGenerator + TdsReviewPanel
[ ] Phase 5: ObjectCodeGenerator
[ ] Phase 6: PipelineTracker + PipelineGitHelper

Current status: [describe where you are]
Last file built: [filename]
Any errors: [paste errors if any]

Continue from here.
```
