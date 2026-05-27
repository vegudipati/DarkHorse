'use strict';

/**
 * TdsPostCodeAgent — fills in TDS sections that can only be written AFTER code
 * generation: program logic, CDS view definitions, BDEF specs, unit test cases,
 * and a Mermaid call/dependency diagram showing how all objects connect.
 *
 * The TDS is authored before code exists, so these sections are necessarily
 * skeleton/template text. After all objects are accepted this agent runs a
 * single focused LLM call that reads the actual generated code and back-fills:
 *
 *   programLogic    — detailed processing flow, CDS view field structures,
 *                     BDEF method signatures, EML operations, error handling flow
 *   testScenarios   — concrete unit test cases derived from the actual code
 *   designDecisions — additional decisions visible in the implementation
 *   dataDictionary  — actual table/view fields referenced in the code
 *
 * Called from ObjectCodeGenerator.generate() after all objects complete.
 */

import * as vscode from 'vscode';
import { PipelineStateManager } from './PipelineStateManager';
import { TdsDocument } from './DocxWriter';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runTdsPostCodeAgent(
  stateManager: PipelineStateManager,
  tracker: { refresh(): void }
): Promise<void> {
  const state = stateManager.getState();
  if (!state?.tdsContent) return;

  const accepted = (state.abapObjects ?? []).filter(o => o.codeAccepted && o.generatedCode);
  if (accepted.length === 0) return;

  const proxyPort = vscode.workspace.getConfiguration()
    .get<number>('darkhorse.pipeline.llmProxyPort', 47291);

  vscode.window.showInformationMessage(
    'DarkHorse: Updating TDS with implementation details…'
  );

  let tdsDoc: TdsDocument;
  try {
    tdsDoc = JSON.parse(state.tdsContent) as TdsDocument;
  } catch {
    return;
  }

  // Build code context — one block per accepted object
  const codeContext = accepted.map(obj => [
    `### ${obj.objectType}: ${obj.objectName}`,
    obj.description ? `> ${obj.description}` : '',
    `\`\`\`abap`,
    obj.generatedCode ?? '',
    `\`\`\``
  ].filter(Boolean).join('\n')).join('\n\n');

  // Existing TDS skeleton for context
  const existingTds = [
    `Technical Approach: ${tdsDoc.sections.technicalApproach ?? ''}`,
    `Program Logic (current): ${tdsDoc.sections.programLogic ?? '(empty)'}`,
    `Data Dictionary (current): ${tdsDoc.sections.dataDictionary ?? '(empty)'}`,
    `Design Decisions (current): ${(tdsDoc.sections.designDecisions ?? []).join('; ') || '(empty)'}`,
    `Test Scenarios (current count): ${(tdsDoc.sections.testScenarios ?? []).length}`,
    `Objects: ${accepted.map(o => `${o.objectType}/${o.objectName}`).join(', ')}`
  ].join('\n');

  const prompt = buildPrompt(existingTds, codeContext, accepted.length);

  let raw: string;
  try {
    raw = await callProxy(proxyPort, {
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens:    3500,
      sessionId:    `tds-postcode-${Date.now()}`
    });
  } catch (err: any) {
    vscode.window.showWarningMessage(
      `DarkHorse: TDS post-code update failed (${err?.message ?? err}). TDS remains as-is.`
    );
    return;
  }

  const updates = parseResponse(raw);
  if (!updates) {
    vscode.window.showWarningMessage(
      'DarkHorse: TDS post-code update — could not parse LLM response. TDS remains as-is.'
    );
    return;
  }

  // Merge updates into existing TDS document
  if (updates.programLogic)    tdsDoc.sections.programLogic    = updates.programLogic;
  if (updates.dataDictionary)  tdsDoc.sections.dataDictionary  = updates.dataDictionary;
  if (updates.interfaceDesign) tdsDoc.sections.interfaceDesign = updates.interfaceDesign;

  if (updates.designDecisions?.length) {
    // Append new decisions; keep originals that aren't duplicated
    const existing = new Set((tdsDoc.sections.designDecisions ?? []).map(s => s.trim().toLowerCase()));
    const fresh = updates.designDecisions.filter(d => !existing.has(d.trim().toLowerCase()));
    tdsDoc.sections.designDecisions = [...(tdsDoc.sections.designDecisions ?? []), ...fresh];
  }

  if (updates.testScenarios?.length) {
    tdsDoc.sections.testScenarios = updates.testScenarios;
  }

  // Persist updated TDS content without changing pipeline stage or object index
  try {
    const live = stateManager.getState()!;
    live.tdsContent = JSON.stringify(tdsDoc);
    await stateManager.setState(live);

    const { refreshTdsAndReport } = require('./TdsRefresher');
    await refreshTdsAndReport(stateManager);

    tracker.refresh();
    vscode.window.showInformationMessage(
      'DarkHorse: TDS updated ✓ — program logic, CDS definitions, and test cases filled in.'
    );

    // Save and show the solution diagram if the LLM produced one
    if (updates.solutionDiagram) {
      const fs   = require('fs');
      const path = require('path');
      const tdsDir = state.tdsFilePath
        ? path.dirname(state.tdsFilePath)
        : undefined;

      if (tdsDir) {
        const diagramPath = path.join(tdsDir, 'solution-diagram.md');
        const md = [
          '# Solution Architecture Diagram',
          '',
          '> Auto-generated by DarkHorse after code generation.',
          '> Open with a Mermaid preview extension (e.g. "Markdown Preview Mermaid Support").',
          '',
          '```mermaid',
          updates.solutionDiagram.trim(),
          '```'
        ].join('\n');
        fs.writeFileSync(diagramPath, md, 'utf-8');
      }

      // Show interactive diagram in a VS Code webview
      const { SolutionDiagramPanel } = require('./SolutionDiagramPanel');
      SolutionDiagramPanel.show(
        updates.solutionDiagram,
        tdsDoc.title ?? 'Solution'
      );
    }
  } catch (err: any) {
    vscode.window.showWarningMessage(
      `DarkHorse: TDS post-code update — docx re-render failed (${err?.message ?? err}).`
    );
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(existingTds: string, codeContext: string, objectCount: number): string {
  return `\
## Existing TDS Summary
${existingTds}

## Generated ABAP Code (${objectCount} object${objectCount !== 1 ? 's' : ''} accepted)
${codeContext}

## Task
The TDS above was written before code generation. Now that the code exists, fill in these sections with SPECIFIC details derived from the actual code above. Do NOT invent anything not visible in the code.

Return a JSON object with these keys (omit a key if you have nothing substantive to add):

\`\`\`json
{
  "programLogic": "<DETAILED processing flow. For each class: list every method with its signature, purpose, and processing steps. For each CDS view: list the entity name, key fields, associations, and selected fields. For each BDEF: list filter methods, validation methods, actions, and their triggers. Include EML MODIFY / READ operations with entity names. 3-8 paragraphs minimum.>",

  "dataDictionary": "<For every Z-table, ZI_ view, ZC_ view, or BDEF referenced in the code: name, object type (TABL/DDLS/BDEF), key fields, important non-key fields, purpose. One entry per object.>",

  "interfaceDesign": "<OData service bindings, SRVD/SRVB object names if present, exposed entities, key operations (GET/POST/PATCH). If no OData service, write N/A.>",

  "designDecisions": [
    "<Decision 1 visible in the code, e.g. 'Validation uses BAdI implementation class rather than ABAP function module to ensure Clean Core compliance'>",
    "<Decision 2>",
    "..."
  ],

  "testScenarios": [
    {
      "id": "TS-001",
      "description": "<specific test: class name, method being tested, input scenario>",
      "expected": "<specific assertion: what the method should return or raise>"
    },
    {
      "id": "TS-002",
      "description": "...",
      "expected": "..."
    }
  ],

  "solutionDiagram": "<Mermaid flowchart LR source — NO backtick fences, content starts with 'flowchart LR'. Show every generated object as a node. Use labeled arrows: 'calls' when a class instantiates/invokes another, 'implements' for BAdI/interface impl, 'reads' for SELECT/EML READ, 'writes' for INSERT/MODIFY/DELETE, 'projects' for CDS projection, 'defines' for BDEF to impl class. Group SAP standard objects in subgraph SAP_STD[SAP Standard], custom Z objects in subgraph CUSTOM[Custom Development]. Node syntax: Id[Label newline Type] for custom, Id([Label newline Standard]) for SAP standard.>"
}
\`\`\`

Rules:
- testScenarios must have at least 5 entries covering: happy path, validation failure, edge case, error handling, and one negative test.
- Every class method present in the code must appear in at least one testScenario.
- programLogic must reference actual method names, field names, and class names from the code — no placeholders.
- solutionDiagram MUST be valid Mermaid syntax. No backtick fences inside the value. Use \\n for newlines in node labels.
- Respond with ONLY the JSON object — no markdown wrapper, no explanation.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface TdsUpdates {
  programLogic?:    string;
  dataDictionary?:  string;
  interfaceDesign?: string;
  designDecisions?: string[];
  testScenarios?:   Array<{ id: string; description: string; expected: string }>;
  /** Mermaid flowchart source (no backtick fences) showing call/use relationships. */
  solutionDiagram?: string;
}

function parseResponse(raw: string): TdsUpdates | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (fence) cleaned = fence[1].trim();

  // Find outermost { }
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as TdsUpdates;
    // Basic validation
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM proxy call (same pattern as TdsGenerator / ObjectCodeGenerator)
// ---------------------------------------------------------------------------

function callProxy(port: number, body: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const http    = require('http');
    const payload = JSON.stringify(body);

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path:    '/generate',
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.content ?? parsed.text ?? data);
          } catch {
            resolve(data);
          }
        });
      }
    );

    req.setTimeout(300_000, () => { req.destroy(); reject(new Error('TdsPostCodeAgent: LLM proxy timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You are a senior SAP S/4HANA technical architect completing a Technical Design Specification (TDS) after ABAP code generation.

Your job is to read the generated ABAP code and extract precise technical documentation for the TDS sections that were left as skeleton/template during the design phase.

Key principles:
- Be SPECIFIC: use actual class names, method names, field names, and object names from the code.
- Do NOT invent content not present in the code.
- For CDS views: extract the entity name, key fields, associations, and selected fields from the DDLS source.
- For ABAP classes: extract every METHOD signature and its purpose.
- For BAdI implementations: extract the interface name, implemented methods, and their validation/processing logic.
- For test classes: extract test methods and map them to test scenarios.
- programLogic should read like a developer walkthrough — enough detail that a new developer can understand the full processing flow without reading the code.
- testScenarios must be executable: specify the class under test, the method, the input, and the expected outcome.

Output format: valid JSON only, no markdown.`;
