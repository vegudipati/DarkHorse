import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineStateManager, AbapObject } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { ReferenceDocLoader } from './ReferenceDocLoader';
import { DocxWriter, TdsDocument } from './DocxWriter';
import { FdsDocument } from './FdsGenerator';

export { TdsDocument };

export class TdsGenerator {

  public static async generate(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {

    const state = stateManager.getState();
    if (!state || !state.fdsContent) {
      vscode.window.showErrorMessage('DarkHorse: No approved FDS found. Please complete FDS first.');
      return;
    }

    await stateManager.updateStage('tds_generating');
    tracker.refresh();

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 47291);
    const outputFolder = config.get<string>('darkhorse.pipeline.outputFolder', '');

    if (!outputFolder) {
      vscode.window.showErrorMessage('DarkHorse: Output folder not configured.');
      return;
    }

    const fdsDoc = JSON.parse(state.fdsContent) as FdsDocument;
    const solutionOverview = state.solutionOverview;

    const styleContextObj = stateManager.getStyleContext() as any;
    const styleContext = styleContextObj
      ? ReferenceDocLoader.formatStyleContext(styleContextObj)
      : 'Professional, formal SAP consulting style.';

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'DarkHorse: Generating Technical Design Specification...',
      cancellable: false
    }, async () => {
      try {
        const prompt = TdsGenerator.buildPrompt(fdsDoc, state.ricefwType, styleContext);

        const rawContent = await TdsGenerator.callProxy(proxyPort, {
          prompt,
          systemPrompt: TdsGenerator.getSystemPrompt(),
          maxTokens: 4000,
          sessionId: `tds-${Date.now()}`
        });

        const tdsDoc = TdsGenerator.parseResponse(rawContent, state, fdsDoc, solutionOverview);

        // Extract ABAP objects from TDS
        const abapObjects: AbapObject[] = tdsDoc.sections.abapObjectList.map(obj => ({
          sequence: obj.sequence,
          objectType: obj.objectType,
          objectName: obj.objectName,
          description: obj.description,
          keyLogic: obj.keyLogic,
          dependencies: obj.dependencies,
          codeGenerated: false,
          codeAccepted: false
        }));

        // Write .docx
        const fileName = `${state.title.replace(/[^a-zA-Z0-9]/g, '_')}_TDS_v1_0.docx`;
        const filePath = path.join(outputFolder, fileName);
        await DocxWriter.writeTds(tdsDoc, filePath);

        // Save to state
        await stateManager.markTdsGenerated(JSON.stringify(tdsDoc), filePath, abapObjects);
        tracker.refresh();

        // Show TDS review panel
        const { TdsReviewPanel } = require('./TdsReviewPanel');
        await TdsReviewPanel.show(context, tdsDoc, filePath, stateManager, tracker);

      } catch (err: any) {
        await stateManager.updateStage('fds_approved');
        tracker.refresh();
        vscode.window.showErrorMessage(`DarkHorse: TDS generation failed — ${err.message}`);
      }
    });
  }

private static buildPrompt(
    fds: FdsDocument,
    ricefwType: string,
    styleContext: string
  ): string {

    const frList = fds.sections.functionalRequirements
      .map(fr => `${fr.id} [${fr.priority}]: ${fr.description}`)
      .join('\n');

    // Truncate to stay within 8000 char proxy limit
    const bgSummary = fds.sections.businessBackground.substring(0, 300);
    const frSummary = frList.length > 1500 ? frList.substring(0, 1500) + '...' : frList;
    const rulesSummary = fds.sections.businessRules.slice(0, 5).join('\n');
    const authSummary = fds.sections.authorization.substring(0, 200);

    return `Generate a detailed Technical Design Specification for this SAP ${ricefwType} development.

APPROVED FDS SUMMARY:
Title: ${fds.title}
RICEFW Type: ${fds.ricefwType}

Business Background:
${bgSummary}

Functional Requirements:
${frSummary}

Key Business Rules:
${rulesSummary}

Authorization:
${authSummary}

Style Guide:
${styleContext.substring(0, 300)}

CRITICAL REQUIREMENTS:
1. technicalApproach: 2-3 paragraphs, architecture approach, ABAP design patterns, key decisions
2. designDecisions: minimum 5 specific technical decisions with rationale
3. abapObjectList: each object needs 8-10 keyLogic steps as pseudocode with SAP table/field refs, all dependencies
4. dataDictionary: every SAP table used, key fields, any custom tables with field definitions
5. programLogic: pseudocode with SAP API calls, FM names, BAdI names
6. dbDesign: SELECT strategies, indexes, performance for data volumes
7. errorHandling: SY-SUBRC checks, SLG1 application log, message class and numbers
8. testScenarios: minimum 5 with exact input values and expected SY-SUBRC

Return ONLY valid JSON. No markdown. No explanation:
{
  "sections": {
    "technicalApproach": "string",
    "designDecisions": ["decision with rationale"],
    "abapObjectList": [
      {
        "sequence": 1,
        "objectType": "PROG",
        "objectName": "ZXXX_OBJECT_NAME",
        "description": "string",
        "keyLogic": ["Step 1: SELECT...", "Step 2: ..."],
        "dependencies": ["Table: KNA1", "FM: CONVERSION_EXIT_ALPHA_INPUT"]
      }
    ],
    "dataDictionary": "string",
    "programLogic": "string",
    "interfaceDesign": "N/A",
    "dbDesign": "string",
    "errorHandling": "string",
    "transportStrategy": "string",
    "testScenarios": [
      { "id": "TS-001", "description": "string", "expected": "SY-SUBRC = 0, output description" }
    ],
    "openItems": ["item"]
  }
}`;
  }

  private static getSystemPrompt(): string {
    return `You are a senior SAP S/4HANA technical architect at a Big 4 consulting firm with 15 years of ABAP development experience writing production-quality Technical Design Specifications.

Your TDS documents are known for:
- Writing pseudocode with exact SAP table/field references (SELECT MATNR WERKS FROM MARC WHERE...)
- Specifying exact ABAP class names, method names, parameter types
- Referencing SAP function modules by exact name (CONVERSION_EXIT_ALPHA_INPUT, REUSE_ALV_GRID_DISPLAY)
- Using proper ABAP data types (TYPE REF TO, TYPE TABLE OF, LIKE LINE OF)
- Specifying BAdI names, enhancement spots, user exit names
- Writing test scenarios with specific input values and expected SY-SUBRC values
- Naming custom tables with Z prefix following SAP naming conventions
- Being specific about transport strategy — Workbench vs Customizing, sequence

Return ONLY valid JSON. No markdown fences. No preamble. No explanation.`;
  }

  private static parseResponse(raw: string, state: any, fds: FdsDocument, solutionOverview?: any): TdsDocument {
    try {
      const cleaned = raw
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      // Handle case where response starts with { directly
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 && jsonEnd >= 0
        ? cleaned.substring(jsonStart, jsonEnd + 1)
        : cleaned;

      const parsed = JSON.parse(jsonStr);
      const sections = parsed.sections ?? parsed;

return {
        title: state.title,
        author: 'DarkHorse Pipeline',
        version: '1.0',
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric'
        }),
        status: 'Draft',
        fdsReference: `${fds.title} v${fds.version}`,
        solutionOverview: solutionOverview ? {
          summary: solutionOverview.solutionSummary ?? '',
          overallCleanCoreLevel: solutionOverview.overallCleanCoreLevel ?? 'B',
          level2Description: solutionOverview.level2Architecture?.description ?? '',
          level3Description: solutionOverview.level3Architecture?.description ?? '',
          cleanCoreAlignment: solutionOverview.cleanCoreAlignment ?? [],
          deviations: solutionOverview.deviations ?? [],
          errorHandlingApproach: solutionOverview.errorHandlingApproach ?? ''
        } : undefined,
        sections: {
          technicalApproach: sections.technicalApproach ?? '',
          designDecisions: Array.isArray(sections.designDecisions)
            ? sections.designDecisions
            : [],
          abapObjectList: (sections.abapObjectList ?? []).map((obj: any, idx: number) => ({
            sequence: obj.sequence ?? idx + 1,
            objectType: obj.objectType ?? 'PROG',
            objectName: obj.objectName ?? `ZOBJ_${idx + 1}`,
            description: obj.description ?? '',
            keyLogic: Array.isArray(obj.keyLogic) ? obj.keyLogic : [],
            dependencies: Array.isArray(obj.dependencies) ? obj.dependencies : []
          })),
          dataDictionary: sections.dataDictionary ?? '',
          programLogic: sections.programLogic ?? '',
          interfaceDesign: sections.interfaceDesign ?? 'N/A',
          dbDesign: sections.dbDesign ?? '',
          errorHandling: sections.errorHandling ?? '',
          transportStrategy: sections.transportStrategy ?? '',
          testScenarios: Array.isArray(sections.testScenarios)
            ? sections.testScenarios.map((t: any) => ({
                id: t.id ?? 'TS-001',
                description: t.description ?? '',
                expected: t.expected ?? ''
              }))
            : [],
          openItems: Array.isArray(sections.openItems) ? sections.openItems : []
        }
      };
    } catch (err) {
      // If JSON parse fails — return skeleton with raw content in technicalApproach
      return {
        title: state.title,
        author: 'DarkHorse Pipeline',
        version: '1.0',
        date: new Date().toLocaleDateString(),
        status: 'Draft',
        fdsReference: fds.title,
        sections: {
          technicalApproach: `PARSE ERROR — Raw LLM response below. Please regenerate.\n\n${raw.substring(0, 500)}`,
          designDecisions: [],
          abapObjectList: [],
          dataDictionary: '',
          programLogic: '',
          interfaceDesign: 'N/A',
          dbDesign: '',
          errorHandling: '',
          transportStrategy: '',
          testScenarios: [],
          openItems: ['NOTE: TDS parsing failed — regenerate to retry']
        }
      };
    }
  }

  private static callProxy(port: number, body: object): Promise<string> {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const payload = JSON.stringify(body);

      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };

      const req = http.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error ?? `Proxy error: ${res.statusCode}`));
              return;
            }
            resolve(parsed.code ?? parsed.content ?? '');
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', (err: any) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}