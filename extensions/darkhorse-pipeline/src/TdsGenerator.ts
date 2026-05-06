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

        const tdsDoc = TdsGenerator.parseResponse(rawContent, state, fdsDoc);

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
      .map(fr => `${fr.id}: ${fr.description}`)
      .join('\n');

    return `Generate a complete Technical Design Specification for this SAP ${ricefwType} development.

Approved Functional Design Specification:
Title: ${fds.title}
RICEFW Type: ${fds.ricefwType}

Business Background:
${fds.sections.businessBackground}

Functional Requirements:
${frList}

Business Rules:
${fds.sections.businessRules.join('\n')}

Authorization:
${fds.sections.authorization}

Style Guide:
${styleContext}

Return ONLY a valid JSON object. No markdown, no explanation:
{
  "sections": {
    "technicalApproach": "string - overall technical approach and architecture",
    "designDecisions": ["decision 1", "decision 2"],
    "abapObjectList": [
      {
        "sequence": 1,
        "objectType": "PROG",
        "objectName": "ZFIN_OPEN_ITEMS",
        "description": "string",
        "keyLogic": [
          "Step 1: ...",
          "Step 2: ...",
          "Step 3: ..."
        ],
        "dependencies": ["table KNA1", "table BSID"]
      }
    ],
    "dataDictionary": "string - tables, structures, data elements used",
    "programLogic": "string - overall program flow description",
    "interfaceDesign": "string - RFC, BAPI, IDoc, REST integrations or N/A",
    "dbDesign": "string - database access strategy, indexes, performance considerations",
    "errorHandling": "string - technical error handling approach",
    "transportStrategy": "string - transport request strategy",
    "testScenarios": [
      { "id": "TS-001", "description": "string", "expected": "string" }
    ],
    "openItems": ["item 1", "item 2"]
  }
}`;
  }

  private static getSystemPrompt(): string {
    return `You are a senior SAP technical architect with 15 years of experience writing 
Technical Design Specifications for SAP S/4HANA RICEFW objects.
Generate comprehensive, production-ready TDS documents.
The ABAP Object List must be specific and complete — each object must have enough detail to generate ABAP code from.
Object names must follow SAP naming conventions with Z prefix.
Always include at least 3 test scenarios.
Return ONLY valid JSON. No markdown code fences. No explanation text.`;
  }

  private static parseResponse(raw: string, state: any, fds: FdsDocument): TdsDocument {
    try {
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
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
        sections: {
          technicalApproach: sections.technicalApproach ?? '',
          designDecisions: sections.designDecisions ?? [],
          abapObjectList: (sections.abapObjectList ?? []).map((obj: any, idx: number) => ({
            sequence: obj.sequence ?? idx + 1,
            objectType: obj.objectType ?? 'PROG',
            objectName: obj.objectName ?? `ZOBJ_${idx + 1}`,
            description: obj.description ?? '',
            keyLogic: obj.keyLogic ?? [],
            dependencies: obj.dependencies ?? []
          })),
          dataDictionary: sections.dataDictionary ?? '',
          programLogic: sections.programLogic ?? '',
          interfaceDesign: sections.interfaceDesign ?? 'N/A',
          dbDesign: sections.dbDesign ?? '',
          errorHandling: sections.errorHandling ?? '',
          transportStrategy: sections.transportStrategy ?? '',
          testScenarios: sections.testScenarios ?? [],
          openItems: sections.openItems ?? []
        }
      };
    } catch {
      return {
        title: state.title,
        author: 'DarkHorse Pipeline',
        version: '1.0',
        date: new Date().toLocaleDateString(),
        status: 'Draft',
        fdsReference: fds.title,
        sections: {
          technicalApproach: raw,
          designDecisions: [],
          abapObjectList: [],
          dataDictionary: '',
          programLogic: '',
          interfaceDesign: 'N/A',
          dbDesign: '',
          errorHandling: '',
          transportStrategy: '',
          testScenarios: [],
          openItems: ['NOTE: TDS parsing failed — review raw content above']
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