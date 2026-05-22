import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineStateManager, AbapObject } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { ReferenceDocLoader } from './ReferenceDocLoader';
import { DocxWriter, TdsDocument } from './DocxWriter';
import { FdsDocument } from './FdsGenerator';
import { resolveMcpPort } from './CleanCoreVerifier';
import {
  groundFdsForTds,
  renderTdsGroundingForPrompt,
  TdsGroundingContext
} from './TdsAgentGrounder';
import { renderStandardsForPrompt } from './StandardsLoader';
import { resolveTemplate }           from './TemplateConfig';
import { renderIntoTemplateFile }    from './TemplateRenderer';

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
    }, async (progress) => {
      try {
        // CPI-6 Sprint 4 — ground the TDS Agent BEFORE generation. The grounder
        // analyzes the FDS and queries MCP for the right RAP / CBO / CDS / SLG1
        // patterns, then injects them into the user prompt so the TDS picks
        // the correct object types instead of defaulting to classic PROG/FUGR.
        progress.report({ message: 'Grounding via MCP...' });
        let groundingContext: TdsGroundingContext | undefined;
        try {
          groundingContext = await groundFdsForTds(fdsDoc, state.ricefwType, resolveMcpPort());
        } catch (err: any) {
          console.error('DarkHorse: TdsAgentGrounder threw:', err?.message ?? err);
        }

        progress.report({ message: 'Calling AI...' });
        const prompt = TdsGenerator.buildPrompt(fdsDoc, state.ricefwType, styleContext, groundingContext);

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

        const tpl = resolveTemplate(state.ricefwType, 'tds');
        if (tpl) {
          try {
            const fields = TdsGenerator.flattenForTemplate(tdsDoc);
            const result = renderIntoTemplateFile(tpl, fields, filePath);
            console.log(
              `[DarkHorse] TDS rendered into client template: ${result.replacedCount} sections filled, ` +
              `${result.unmappedFields.length} fields unmapped, ${result.missingHeadings.length} headings missing data`
            );
          } catch (err: any) {
            vscode.window.showWarningMessage(
              `DarkHorse: Client TDS template render failed — falling back to generic format. ${err?.message ?? err}`
            );
            await DocxWriter.writeTds(tdsDoc, filePath);
          }
        } else {
          await DocxWriter.writeTds(tdsDoc, filePath);
        }

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
    styleContext: string,
    groundingContext?: TdsGroundingContext
  ): string {

    const frList = fds.sections.functionalRequirements
      .map(fr => `${fr.id} [${fr.priority}]: ${fr.description}`)
      .join('\n');

    // Truncate to stay within 8000 char proxy limit
    const bgSummary = fds.sections.businessBackground.substring(0, 300);
    const frSummary = frList.length > 1500 ? frList.substring(0, 1500) + '...' : frList;
    const rulesSummary = fds.sections.businessRules.slice(0, 5).join('\n');
    const authSummary = fds.sections.authorization.substring(0, 200);

    const groundingBlock = groundingContext
      ? renderTdsGroundingForPrompt(groundingContext)
      : '';
    const groundingSection = groundingBlock ? `\n\n${groundingBlock}\n` : '';

    const standardsBlock   = renderStandardsForPrompt();
    const standardsSection = standardsBlock ? `${standardsBlock}\n\n` : '';

    return `${standardsSection}Generate a detailed Technical Design Specification for this SAP ${ricefwType} development.

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
${groundingSection}
CRITICAL REQUIREMENTS:
1. technicalApproach: 2-3 paragraphs. If the grounding section identifies a RAP pattern, the approach MUST describe a RAP layered implementation (CDS + BDEF + behavior pool + projection + SRVD + SRVB). Only fall back to classic PROG/FUGR when no RAP/CDS path applies (e.g. pure batch utility with no business object).
2. designDecisions: minimum 5 specific technical decisions with rationale
3. abapObjectList: objectType values MUST come from the grounding section when one was provided — typical RAP set is { DDLS, BDEF, CLAS, SRVD, SRVB } for transactional / DDLS-only for analytical / the full CBO 7-piece set for new custom persistent data. Use PROG / FUGR / TABL only as a last resort and only when nothing in the grounding applies.
4. dataDictionary: when reading SAP standard tables, reference the released CDS view named in the grounding (e.g. I_SalesOrder instead of VBAK) — do NOT propose direct SELECTs.
5. programLogic: pseudocode with SAP API calls. For RAP behavior implementations write EML pseudocode (READ ENTITIES OF, MODIFY ENTITIES OF). For analytical views write CDS projection pseudocode.
6. dbDesign: explain CDS view selection, key associations, performance considerations. Never recommend direct table SELECTs when a released CDS view exists.
7. errorHandling: SY-SUBRC checks, SLG1 Application Log usage (object Z_DARKHORSE + subobject per scenario), message class and numbers. Never propose a custom Z log table.
8. testScenarios: minimum 5 with exact input values and expected SY-SUBRC

Return ONLY valid JSON. No markdown. No explanation:
{
  "sections": {
    "technicalApproach": "string",
    "designDecisions": ["decision with rationale"],
    "abapObjectList": [
      {
        "sequence": 1,
        "objectType": "BDEF",
        "objectName": "ZI_<Entity>",
        "description": "Managed RAP Behavior Definition for the custom BO",
        "keyLogic": ["Step 1: define CRUD operations", "Step 2: declare validations / determinations"],
        "dependencies": ["CDS: ZI_<Entity>", "Class: ZBP_I_<Entity>"]
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
    return `You are a senior SAP S/4HANA technical architect at a Big 4 consulting firm with 15 years of experience writing Clean Core compliant Technical Design Specifications for the RAP-era SAP stack.

The user prompt MAY include a "## Grounded SAP knowledge for TDS object planning (CPI-6 Sprint 4)" section. If present, that section is AUTHORITATIVE for choosing object types in the abapObjectList. You MUST use the SAP object types it lists (DDLS, BDEF, CLAS, SRVD, SRVB, TABL for CBOs) and the CDS view names it provides for SAP standard table reads.

# CPI-6 step (B) — proposed Z wrapper CDS views

When the grounding section proposes a Z CDS view because no released view exists for a SAP standard table (heading reads "Read access for <TABLE> -> propose ZI_<TABLE> (wrapper DDLS)"):

1. **You MUST add the proposed view as a SEPARATE DDLS object in the abapObjectList**, with its own sequence number, BEFORE the program that consumes it.
2. **The keyLogic for the wrapper DDLS object must list "paste the DDL template from the grounding" and "populate the SELECT field list from inputOutputSpec".**
3. **The dependencies for the consuming program must reference the wrapper DDLS name** (e.g. "DDLS: ZI_VBAK"), NOT the underlying SAP table.
4. **All keyLogic steps in the consuming program that read the SAP table MUST reference the wrapper view name**, not the table.

Example: if the grounding proposes ZI_VBAK as a wrapper for VBAK, the abapObjectList should look like:
[
  { sequence: 1, objectType: "DDLS", objectName: "ZI_VBAK", description: "Wrapper CDS view over VBAK — Level B; selected fields driven by the FDS", keyLogic: ["Paste the DDL template from the grounding section.", "List only the fields the consuming report needs: VBELN, VKORG, KUNNR, NETWR, ERDAT."], dependencies: ["Table: VBAK (Level C — direct SELECT prohibited; this view is the contract)"] },
  { sequence: 2, objectType: "PROG", objectName: "ZSALES_REPORT", description: "Sales order report", keyLogic: ["SELECT * FROM ZI_VBAK ..."], dependencies: ["DDLS: ZI_VBAK"] }
]


# UI policy — Fiori Elements default (80/20 rule)

- Any user-facing object MUST be modeled as a Fiori Elements app. abapObjectList for a UI-bearing object includes: the data-model CDS (DDLS), the projection CDS (DDLS), the projection BDEF (BDEF), the SRVD, the SRVB, and a "UI5 application" entry pointing at sap.fe.templates.<Template>.
- Template selection: List Report (tabular browse), Object Page (single-item detail), Analytical List Page (reports/KPIs — REPLACES classic ALV), Overview Page (dashboard), Worklist (approval inbox).
- Freestyle SAPUI5 is the EXCEPTION (~20%) — only when custom controls, third-party libraries (D3/Leaflet), guided wizards, or consumer-grade UX are required. The technicalApproach MUST document the justification.
- Print / interactive forms MUST be modeled as SAP Adobe Forms (form interface + form layout + driver class). NEVER propose Smart Forms or SAPscript for new development; Smart Forms can be retained only for parity with existing legacy stacks.
- Classic ABAP UI (CL_SALV_TABLE / CL_GUI_ALV_GRID / CALL SCREEN / WRITE statements) is a Level B fallback. Use only when the grounding section indicates no Fiori path is feasible AND document why in designDecisions.

# Default object-type policy (apply when the grounding section is silent or absent)

- TRANSACTIONAL business object on S/4HANA Cloud / Private edition:
  abapObjectList = [
    DDLS  ZI_<Entity>             — interface CDS view (data model layer),
    BDEF  ZI_<Entity>             — managed Behavior Definition,
    CLAS  ZBP_I_<Entity>          — behavior pool implementation,
    DDLS  ZC_<Entity>             — projection CDS view (consumption layer),
    BDEF  ZC_<Entity>             — projection BDEF,
    SRVD  ZUI_<Entity>            — Service Definition,
    SRVB  ZUI_<Entity>_O4         — OData V4 Service Binding.
  ]
  NOT a single PROG with INSERTs.

- READ-ONLY ANALYTICAL / report exposed as a Fiori analytical app:
  abapObjectList = [
    DDLS  ZI_<Report>             — interface CDS,
    DDLS  ZC_<Report>             — projection CDS with @Analytics annotations,
    SRVD  ZUI_<Report>            — Service Definition,
    SRVB  ZUI_<Report>_O4         — Service Binding.
  ]
  NOT a single PROG with SELECT and CL_SALV_TABLE — only fall back to classic ALV when the FDS explicitly requires a SE38 / SA38 launch (no Fiori UI).

- New PERSISTENT CUSTOM DATA (CBO):
  abapObjectList = [
    TABL  Z<Entity>               — transparent table,
    DDLS  ZI_<Entity>             — interface CDS,
    BDEF  ZI_<Entity>             — managed BDEF,
    CLAS  ZBP_I_<Entity>          — behavior pool,
    DDLS  ZC_<Entity>             — projection CDS,
    BDEF  ZC_<Entity>             — projection BDEF,
    SRVD  ZUI_<Entity>,
    SRVB  ZUI_<Entity>_O4.
  ]
  NOT just a TABL with direct INSERT.

- All logging: SLG1 Application Log via BAL_LOG_CREATE / BAL_LOG_MSG_ADD / BAL_DB_SAVE.
  NEVER design a custom Z log table.

# Few-shot example — Backorder enhancement TDS (transactional)

WRONG abapObjectList (classic):
[
  { sequence:1, objectType:"PROG", objectName:"ZBACKORDER_PROCESS",  description:"Main program" },
  { sequence:2, objectType:"FUGR", objectName:"ZBACKORDER_UTILS",    description:"Helper FMs" },
  { sequence:3, objectType:"TABL", objectName:"ZBACKORDER_LOG",      description:"Log table" }
]

CORRECT abapObjectList (Clean Core Level A):
[
  { sequence:1, objectType:"DDLS", objectName:"ZI_BackorderEnh",     description:"Interface CDS over backorder header" },
  { sequence:2, objectType:"BDEF", objectName:"ZI_BackorderEnh",     description:"Managed BDEF with create/update/delete + validations" },
  { sequence:3, objectType:"CLAS", objectName:"ZBP_I_BACKORDERENH",  description:"Behavior pool — ATP determinations and validations" },
  { sequence:4, objectType:"DDLS", objectName:"ZC_BackorderEnh",     description:"Projection CDS with UI annotations" },
  { sequence:5, objectType:"BDEF", objectName:"ZC_BackorderEnh",     description:"Projection BDEF" },
  { sequence:6, objectType:"SRVD", objectName:"ZUI_BackorderEnh",    description:"Service Definition for OData exposure" },
  { sequence:7, objectType:"SRVB", objectName:"ZUI_BackorderEnh_O4", description:"OData V4 Service Binding for Fiori Elements" }
]

# Naming conventions
- CDS interface views: ZI_<Entity>
- CDS projection views: ZC_<Entity>
- Behavior pool classes: ZBP_I_<Entity> (interface), ZBP_C_<Entity> (consumption-rare)
- Service Definitions: ZUI_<Entity>
- Service Bindings: ZUI_<Entity>_O4 (OData V4) or ZUI_<Entity>_O2 (OData V2 — only when legacy clients require it)
- CBO transparent tables: Z<Entity>

Return ONLY valid JSON. No markdown fences. No preamble. No explanation.`;
  }

  /**
   * Flatten a TdsDocument into a string-only map for the template renderer.
   * Field names match the keys used in templates-config heading mappings.
   */
  private static flattenForTemplate(tds: TdsDocument): Record<string, string> {
    const s: any = tds.sections ?? {};
    const renderObjects = (arr: any[] | undefined): string =>
      (arr ?? []).map((o, idx) => {
        const seq   = o.sequence ?? (idx + 1);
        const type  = o.objectType ?? '?';
        const name  = o.objectName ?? '?';
        const desc  = o.description ?? '';
        const logic = Array.isArray(o.keyLogic) ? o.keyLogic.map((l: string, i: number) => `  ${i + 1}. ${l}`).join('\n') : '';
        const deps  = Array.isArray(o.dependencies) ? o.dependencies.join(', ') : '';
        return `#${seq} [${type}] ${name} — ${desc}\nDependencies: ${deps}\n${logic}`;
      }).join('\n\n');

    const renderTests = (arr: any[] | undefined): string =>
      (arr ?? []).map((t: any) =>
        `${t.id ?? ''}: ${t.description ?? ''} (expected: ${t.expected ?? ''})`
      ).join('\n');

    return {
      technicalApproach: s.technicalApproach ?? '',
      designDecisions:   Array.isArray(s.designDecisions) ? s.designDecisions.join('\n') : (s.designDecisions ?? ''),
      abapObjectList:    renderObjects(s.abapObjectList),
      dataDictionary:    s.dataDictionary ?? '',
      programLogic:      s.programLogic ?? '',
      interfaceDesign:   s.interfaceDesign ?? '',
      dbDesign:          s.dbDesign ?? '',
      errorHandling:     s.errorHandling ?? '',
      transportStrategy: s.transportStrategy ?? '',
      testScenarios:     renderTests(s.testScenarios),
      openItems:         Array.isArray(s.openItems) ? s.openItems.join('\n') : (s.openItems ?? '')
    };
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