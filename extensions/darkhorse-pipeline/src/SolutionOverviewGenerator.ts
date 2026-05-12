import * as vscode from 'vscode';
import { PipelineStateManager, SolutionOverview } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';

export class SolutionOverviewGenerator {

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

    await stateManager.updateStage('solution_overview_generating');
    tracker.refresh();

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 47291);

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'DarkHorse: Generating Solution Overview & Clean Core Assessment...',
      cancellable: false
    }, async () => {
      try {
        const prompt = SolutionOverviewGenerator.buildPrompt(
          state.brText, state.ricefwType, state.objectType, state.sapPackage
        );

        const rawContent = await SolutionOverviewGenerator.callProxy(proxyPort, {
          prompt,
          systemPrompt: SolutionOverviewGenerator.getSystemPrompt(),
          maxTokens: 3000,
          sessionId: `solution-${Date.now()}`
        });

        const overview = SolutionOverviewGenerator.parseResponse(rawContent, state);
        await stateManager.markSolutionOverviewGenerated(overview);
        tracker.refresh();

        // Show review panel
        const { SolutionOverviewPanel } = require('./SolutionOverviewPanel');
        await SolutionOverviewPanel.show(context, overview, stateManager, tracker);

      } catch (err: any) {
        await stateManager.updateStage('br_captured');
        tracker.refresh();
        vscode.window.showErrorMessage(
          `DarkHorse: Solution Overview generation failed — ${err.message}`
        );
      }
    });
  }

  private static buildPrompt(
    brText: string,
    ricefwType: string,
    objectType: string,
    sapPackage: string
  ): string {
    return `Analyze this SAP ${ricefwType} Business Requirement and generate a Solution Overview with Clean Core compliance assessment.

BUSINESS REQUIREMENT:
${brText.substring(0, 2000)}

RICEFW TYPE: ${ricefwType}
PRIMARY OBJECT TYPE: ${objectType}
SAP PACKAGE: ${sapPackage || 'Z-package TBD'}

CLEAN CORE LEVELS (SAP 2025 A-D Model):
- Level A: Released APIs only — RAP, CDS Views (released), released BAdIs, Key User tools, OData via RAP, BTP/CAP side-by-side
- Level B: Classic APIs — BAPIs, classic BAdIs (nominated as stable), user exits, ALV Grid (CL_GUI_ALV_GRID), standard ABAP without restricted objects, IDocs
- Level C: Internal SAP objects — not released, not nominated as stable, direct SELECT on unreleased SAP tables, unreleased FMs/classes
- Level D: NOT RECOMMENDED — core modifications, implicit enhancements, direct write to SAP core tables, noAPI objects

DELOITTE MANDATE: All solutions MUST target Level A or B. Level C requires written justification. Level D is prohibited — pipeline will be blocked.

Return ONLY this exact JSON structure. No markdown. No explanation:
{
  "solutionSummary": "2-3 paragraph narrative of what is being built and why",
  "solutionDetails": "RICEFW type, complexity, affected modules, key stakeholders",
  "affectedModules": ["FI", "MM", "SD"],
  "complexity": "Medium",
  "level2Architecture": {
    "description": "WHAT the solution does — systems involved, data flow direction",
    "systems": [
      { "name": "SAP S/4HANA", "role": "Source system — generates and sends data" },
      { "name": "Target System", "role": "Receives and processes data" }
    ],
    "flows": [
      {
        "from": "SAP S/4HANA",
        "to": "Target System",
        "protocol": "IDoc/BAPI/REST/File",
        "description": "What data flows and what triggers it"
      }
    ],
    "triggerPoint": "Which SAP process/transaction/event triggers this solution"
  },
  "level3Architecture": {
    "description": "HOW the solution is technically implemented",
    "components": [
      {
        "name": "ZREPORT_NAME",
        "type": "ABAP Program / BAdI / CDS View / RAP Entity",
        "detail": "Specific technical approach — which APIs, which tables accessed how, which frameworks"
      }
    ]
  },
  "cleanCoreAlignment": [
    {
      "component": "Component name",
      "approach": "Technical approach used",
      "level": "A",
      "reasoning": "Why this is Level A — specific released API or extension point referenced"
    }
  ],
  "overallCleanCoreLevel": "B",
  "deviations": [],
  "errorHandlingApproach": "Overall error handling strategy — SLG1 application log, message classes, retry approach, alerting mechanism"
}`;
  }

  private static getSystemPrompt(): string {
    return `You are a senior SAP S/4HANA solution architect at Deloitte with deep expertise in Clean Core extensibility.

Your role is to analyze business requirements and propose solutions that maximize Clean Core compliance using the SAP 2025 A-D extensibility model.

RULES:
1. Always prefer Level A (RAP, released APIs, released BAdIs, CDS Views) over Level B
2. Level B (classic BAPIs, user exits, classic BAdIs, ALV) is acceptable when Level A is not feasible
3. Flag Level C immediately in deviations array with specific risk description
4. Flag Level D immediately — this BLOCKS the pipeline
5. For reports: prefer CDS-based analytical reports (Level A) over classic ALV programs (Level B)
6. For enhancements: prefer released BAdIs (Level A) over classic user exits (Level B)
7. For interfaces: prefer OData/REST (Level A) over IDocs (Level B) over RFCs to unreleased FMs (Level C)
8. Never recommend direct SELECT on SAP core tables without a released CDS View wrapper
9. The overallCleanCoreLevel must be the LOWEST level among all components
10. Be specific about which released APIs are being used — reference SAP API names

Return ONLY valid JSON. No markdown. No preamble.`;
  }

  private static parseResponse(raw: string, state: any): SolutionOverview {
    try {
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        solutionSummary: parsed.solutionSummary ?? '',
        solutionDetails: parsed.solutionDetails ?? '',
        affectedModules: parsed.affectedModules ?? [],
        complexity: parsed.complexity ?? 'Medium',
        level2Architecture: parsed.level2Architecture ?? {
          description: '',
          systems: [],
          flows: [],
          triggerPoint: ''
        },
        level3Architecture: parsed.level3Architecture ?? {
          description: '',
          components: []
        },
        cleanCoreAlignment: parsed.cleanCoreAlignment ?? [],
        overallCleanCoreLevel: parsed.overallCleanCoreLevel ?? 'B',
        deviations: parsed.deviations ?? [],
        errorHandlingApproach: parsed.errorHandlingApproach ?? ''
      };
    } catch {
      return {
        solutionSummary: raw,
        solutionDetails: '',
        affectedModules: [],
        complexity: 'Medium',
        level2Architecture: {
          description: 'Could not parse architecture — review raw content',
          systems: [],
          flows: [],
          triggerPoint: ''
        },
        level3Architecture: { description: '', components: [] },
        cleanCoreAlignment: [],
        overallCleanCoreLevel: 'B',
        deviations: [],
        errorHandlingApproach: ''
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
        },
        timeout: 120000
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
          } catch { resolve(data); }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Solution Overview generation timed out. Try again.'));
      });
      req.on('error', (err: any) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}