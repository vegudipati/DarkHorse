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
    return `Generate a complete Functional Design Specification for this SAP ${ricefwType} development.

Business Requirement:
${brText}

Technical Context:
- RICEFW Type: ${ricefwType}
- Primary Object Type: ${objectType}
- SAP Package: ${sapPackage || 'Z-package TBD'}

Style Guide:
${styleContext}

Return ONLY a valid JSON object matching this exact structure. No markdown, no explanation:
{
  "sections": {
    "businessBackground": "string - why this is being built",
    "scope": {
      "inScope": ["item 1", "item 2"],
      "outOfScope": ["item 1", "item 2"]
    },
    "processOverview": "string - narrative of the business process",
    "functionalRequirements": [
      { "id": "FR-001", "description": "string", "priority": "High" }
    ],
    "uiDesign": "string - screen/report layout description or N/A",
    "inputOutputSpec": "string - input fields, output fields, data sources",
    "businessRules": ["rule 1", "rule 2"],
    "errorHandling": ["error scenario 1", "error scenario 2"],
    "authorization": "string - authorization objects and roles required",
    "reportingRequirements": "string - reporting needs or N/A",
    "openItems": ["assumption 1", "dependency 1"]
  }
}`;
  }

  private static getSystemPrompt(): string {
    return `You are a senior SAP functional consultant with 15 years of experience writing 
Functional Design Specifications for SAP S/4HANA RICEFW objects.
Generate comprehensive, professional FDS documents.
Always include at least 5 functional requirements numbered FR-001, FR-002, etc.
Be specific about SAP tables, transaction codes, and technical details where relevant.
Return ONLY valid JSON. No markdown code fences. No explanation text.`;
  }

  private static parseResponse(raw: string, state: any): FdsDocument {
    try {
      // Clean up response
      const cleaned = raw
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

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