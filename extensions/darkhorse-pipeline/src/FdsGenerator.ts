import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineStateManager } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { ReferenceDocLoader } from './ReferenceDocLoader';
import { DocxWriter } from './DocxWriter';

export interface FdsSection {
  businessBackground: string;
  scope: { inScope: string[]; outOfScope: string[] };
  processOverview: string;
  functionalRequirements: Array<{
    id: string;
    description: string;
    priority: 'High' | 'Medium' | 'Low';
  }>;
  uiDesign: string;
  inputOutputSpec: string;
  businessRules: string[];
  errorHandling: string[];
  authorization: string;
  reportingRequirements: string;
  openItems: string[];
}

export interface FdsDocument {
  title: string;
  author: string;
  version: string;
  date: string;
  status: 'Draft' | 'Review' | 'Approved';
  ricefwType: string;
  brReference: string;
  sections: FdsSection;
}

export class FdsGenerator {

  public static async generate(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {

    const state = stateManager.getState();
    if (!state) {
      vscode.window.showErrorMessage('DarkHorse: No active pipeline state found.');
      return;
    }

    await stateManager.updateStage('fds_generating');
    tracker.refresh();

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 47291);
    const outputFolder = config.get<string>('darkhorse.pipeline.outputFolder', '');

    if (!outputFolder) {
      vscode.window.showErrorMessage(
        'DarkHorse: Output folder not configured. Please set darkhorse.pipeline.outputFolder.'
      );
      return;
    }

    // Get style context if available
    const styleContextObj = stateManager.getStyleContext() as any;
    const styleContext = styleContextObj
      ? ReferenceDocLoader.formatStyleContext(styleContextObj)
      : 'Professional, formal SAP consulting style. Use present tense. Be specific.';

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'DarkHorse: Generating Functional Design Specification...',
      cancellable: false
    }, async () => {
      try {
        // Build FDS prompt
        const prompt = FdsGenerator.buildPrompt(state.brText, state.ricefwType,
          state.objectType, state.sapPackage, styleContext);

        // Call LLM proxy
        const rawContent = await FdsGenerator.callProxy(proxyPort, {
          prompt,
          systemPrompt: FdsGenerator.getSystemPrompt(),
          maxTokens: 4000,
          sessionId: `fds-${Date.now()}`
        });

        // Parse JSON response
        const fdsDoc = FdsGenerator.parseResponse(rawContent, state);

        // Generate .docx file
        const fileName = `${state.title.replace(/[^a-zA-Z0-9]/g, '_')}_FDS_v1_0.docx`;
        const filePath = path.join(outputFolder, fileName);
        await DocxWriter.writeFds(fdsDoc, filePath);

        // Save to state
        await stateManager.markFdsGenerated(JSON.stringify(fdsDoc), filePath);
        tracker.refresh();

        // Show review panel
        const { FdsReviewPanel } = require('./FdsReviewPanel');
        await FdsReviewPanel.show(context, fdsDoc, filePath, stateManager, tracker);

      } catch (err: any) {
        await stateManager.updateStage('br_captured');
        tracker.refresh();
        vscode.window.showErrorMessage(`DarkHorse: FDS generation failed — ${err.message}`);
      }
    });
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
            // Proxy returns { code, explanation, model, tokensUsed }
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

  private static buildPrompt(
    brText: string,
    ricefwType: string,
    objectType: string,
    sapPackage: string,
    styleContext: string
  ): string {
    return `Generate a detailed, professional Functional Design Specification for this SAP ${ricefwType} development. This document will be reviewed by senior SAP consultants and must be production-quality.

BUSINESS REQUIREMENT:
${brText}

TECHNICAL CONTEXT:
- RICEFW Type: ${ricefwType}
- Primary Object Type: ${objectType}  
- SAP Package: ${sapPackage || 'Z-package TBD'}

STYLE GUIDE:
${styleContext}

CRITICAL REQUIREMENTS FOR EACH SECTION:
1. businessBackground: 2-3 paragraphs. Include: which SAP module is affected, current business pain point, business value of this development, impacted business roles/departments.
2. scope.inScope: minimum 6 specific items with SAP object/transaction references
3. scope.outOfScope: minimum 4 items that explicitly limit scope
4. processOverview: detailed narrative (3-4 paragraphs) of the end-to-end business process, referencing specific SAP transactions (e.g. VA01, ME21N, MIRO), organizational units, and data flows
5. functionalRequirements: minimum 8 requirements, each with specific SAP field names, table names, transaction codes where relevant. Include acceptance criteria in the description.
6. uiDesign: describe exact screen layout, ALV columns with field names, selection screen fields with technical names (e.g. WERKS, BUKRS, MATNR), mandatory/optional flags
7. inputOutputSpec: list every input field with technical name, SAP table source, data type, length. List every output field similarly.
8. businessRules: minimum 6 rules written as specific IF/THEN conditions referencing SAP fields (e.g. "If MARC-MMSTA = 'Z1' then reject order with reason ZQ")
9. errorHandling: minimum 5 error scenarios with exact error message text and handling procedure
10. authorization: list specific SAP authorization objects (e.g. S_TCODE, F_BKPF_BUK), activity codes, and required business roles
11. reportingRequirements: if report — list all ALV columns, subtotals, sort criteria, export formats
12. openItems: list real assumptions about SAP configuration, master data, and dependencies

Return ONLY a valid JSON object. No markdown. No explanation. No preamble:
{
  "sections": {
    "businessBackground": "string",
    "scope": {
      "inScope": ["item 1", "item 2"],
      "outOfScope": ["item 1", "item 2"]
    },
    "processOverview": "string",
    "functionalRequirements": [
      { "id": "FR-001", "description": "string with SAP field references and acceptance criteria", "priority": "High" }
    ],
    "uiDesign": "string with field technical names",
    "inputOutputSpec": "string with table/field references",
    "businessRules": ["IF condition THEN action with SAP field references"],
    "errorHandling": ["Error scenario: message text and handling"],
    "authorization": "string with authorization objects and roles",
    "reportingRequirements": "string",
    "openItems": ["assumption or dependency"]
  }
}`;
  }

  private static getSystemPrompt(): string {
    return `You are a senior SAP S/4HANA functional consultant at a Big 4 consulting firm with 15 years of experience writing production-quality Functional Design Specifications for RICEFW objects.

Your FDS documents are known for:
- Referencing exact SAP table names (VBRK, VBRP, LIKP, KNA1, MARA, MARC, etc.)
- Referencing exact SAP transaction codes (VA01, ME21N, MIRO, SE38, STMS, etc.)
- Referencing exact SAP field names with structure prefix (VBRK-VBELN, MARC-MMSTA, MARA-MATNR)
- Writing business rules as precise IF/THEN conditions
- Specifying selection screen fields with technical names
- Including authorization objects (S_TCODE, F_BKPF_BUK, S_DEVELOP, M_MSEG_BWA)
- Being specific about error messages and handling procedures
- Minimum 8 functional requirements with acceptance criteria
- Never writing vague statements like "the system should handle errors appropriately"

Return ONLY valid JSON matching the exact structure requested. No markdown fences. No preamble. No explanation.`;
  }

  private static parseResponse(raw: string, state: any): FdsDocument {
    
    try {
      // Clean up response
      const cleaned = raw
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

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
        ricefwType: state.ricefwType,
        brReference: state.title,
        sections: {
          businessBackground: sections.businessBackground ?? '',
          scope: sections.scope ?? { inScope: [], outOfScope: [] },
          processOverview: sections.processOverview ?? '',
          functionalRequirements: sections.functionalRequirements ?? [],
          uiDesign: sections.uiDesign ?? 'N/A',
          inputOutputSpec: sections.inputOutputSpec ?? '',
          businessRules: sections.businessRules ?? [],
          errorHandling: sections.errorHandling ?? [],
          authorization: sections.authorization ?? '',
          reportingRequirements: sections.reportingRequirements ?? 'N/A',
          openItems: sections.openItems ?? []
        }
      };
    } catch (err) {
      // If JSON parse fails return a skeleton with raw content
      return {
        title: state.title,
        author: 'DarkHorse Pipeline',
        version: '1.0',
        date: new Date().toLocaleDateString(),
        status: 'Draft',
        ricefwType: state.ricefwType,
        brReference: state.title,
        sections: {
          businessBackground: raw,
          scope: { inScope: [], outOfScope: [] },
          processOverview: '',
          functionalRequirements: [],
          uiDesign: 'N/A',
          inputOutputSpec: '',
          businessRules: [],
          errorHandling: [],
          authorization: '',
          reportingRequirements: 'N/A',
          openItems: ['NOTE: FDS parsing failed — review raw content above']
        }
      };
    }
  }
}