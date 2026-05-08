import * as vscode from 'vscode';
import { PipelineStateManager, AbapObject } from './PipelineStateManager';
import { PipelineTracker } from './PipelineTracker';
import { TdsDocument } from './DocxWriter';

export class ObjectCodeGenerator {

  public static async generate(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<void> {

    const state = stateManager.getState();
    if (!state || !state.tdsContent) {
      vscode.window.showErrorMessage('DarkHorse: No approved TDS found.');
      return;
    }

    const tdsDoc = JSON.parse(state.tdsContent) as TdsDocument;
    const objects = state.abapObjects;

    if (!objects || objects.length === 0) {
      vscode.window.showErrorMessage('DarkHorse: No ABAP objects found in TDS.');
      return;
    }

    await stateManager.updateStage('code_generating');
    tracker.refresh();

    // Process objects starting from current index
    const startIndex = state.currentObjectIndex;
    for (let i = startIndex; i < objects.length; i++) {
      const obj = objects[i];
      const accepted = await ObjectCodeGenerator.generateObject(
        i, obj, tdsDoc, stateManager, tracker
      );

      // If developer skipped or closed — stop and let them resume later
      if (accepted === undefined) {
        vscode.window.showInformationMessage(
          `DarkHorse: Code generation paused at object ${i + 1}. ` +
          'Use "Resume Pipeline" to continue.'
        );
        return;
      }

      // Mark complete BEFORE showing any further UI
      await stateManager.markObjectComplete(i, accepted);
      await stateManager.setState(stateManager.getState()!);
      tracker.refresh();

      vscode.window.showInformationMessage(
        accepted
          ? `DarkHorse: ${obj.objectName} accepted ✓`
          : `DarkHorse: ${obj.objectName} rejected — skipping.`
      );
    }

    // All objects complete
    vscode.window.showInformationMessage(
      `🎉 DarkHorse: Pipeline complete! ` +
      `${objects.filter(o => o.codeAccepted).length} of ${objects.length} objects generated and accepted.`
    );
    tracker.refresh();
  }

  /**
   * Generate code for a single ABAP object.
   * Shows a confirmation dialog, calls LLM, shows diff preview.
   * Returns true if accepted, false if rejected, undefined if skipped/cancelled.
   */
  private static async generateObject(
    index: number,
    obj: AbapObject,
    tdsDoc: TdsDocument,
    stateManager: PipelineStateManager,
    tracker: PipelineTracker
  ): Promise<boolean | undefined> {

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 47291);
    const totalObjects = stateManager.getState()?.abapObjects.length ?? 1;

    // Step 1 — Generate code immediately without confirmation dialog
    let generatedCode = '';

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `DarkHorse: Generating ${obj.objectName} (${index + 1} of ${totalObjects})...`,
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Calling AI...' });
      try {
        const prompt = ObjectCodeGenerator.buildPrompt(obj, tdsDoc, index);
        generatedCode = await ObjectCodeGenerator.callProxy(proxyPort, {
          prompt,
          systemPrompt: ObjectCodeGenerator.getSystemPrompt(),
          maxTokens: 2000,
          sessionId: `code-${obj.objectName}-${Date.now()}`
        });
        progress.report({ message: 'Done.' });
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `DarkHorse: Code generation failed for ${obj.objectName} — ${err.message}`
        );
        generatedCode = '';
      }
    });

    if (!generatedCode) {
      return false;
    }

    // Clean up code
    generatedCode = generatedCode
      .replace(/```abap/gi, '')
      .replace(/```/g, '')
      .trim();

    // Step 2 — Show preview panel and wait for accept/reject
    const accepted = await ObjectCodeGenerator.showDiffPreview(obj, generatedCode, stateManager);
    return accepted;
  }

  /**
   * Show generated code as a diff preview in VS Code.
   * Developer reviews and accepts or rejects.
   */
  private static async showDiffPreview(
    obj: AbapObject,
    generatedCode: string,
    stateManager: PipelineStateManager
  ): Promise<boolean> {

    return new Promise(async (resolve) => {
      // Write generated code to a temp virtual document
      const scheme = 'darkhorse-generated';

      // Create a simple webview to show the code with Accept/Reject
      const panel = vscode.window.createWebviewPanel(
        'darkhorseCodePreview',
        `Generated: ${obj.objectName}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = ObjectCodeGenerator.getPreviewHtml(
        obj, generatedCode
      );

      let resolved = false;

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'accept') {
          resolved = true;

          // Copy to clipboard first
          await vscode.env.clipboard.writeText(generatedCode);

          // Save state immediately before any other async operations
          const currentState = stateManager.getState();
          if (currentState) {
            const objIndex = currentState.abapObjects.findIndex(
              o => o.objectName === obj.objectName
            );
            if (objIndex >= 0) {
              currentState.abapObjects[objIndex].codeGenerated = true;
              currentState.abapObjects[objIndex].codeAccepted = true;
              currentState.currentObjectIndex = objIndex + 1;
              if (currentState.currentObjectIndex >= currentState.abapObjects.length) {
                currentState.currentStage = 'complete';
              }
              await stateManager.setState(currentState);
            }
          }

          panel.dispose();

          // Save to .abap file and offer Git commit
          const config = vscode.workspace.getConfiguration();
          const outputFolder = config.get<string>('darkhorse.pipeline.outputFolder', '');
          if (outputFolder) {
            try {
              const { PipelineGitHelper } = require('./PipelineGitHelper');
              const filePath = await PipelineGitHelper.saveCodeToFile(
                obj.objectName,
                obj.objectType,
                generatedCode,
                outputFolder
              );
              vscode.window.showInformationMessage(
                `DarkHorse: ${obj.objectName} ✓ Saved to ${filePath}`
              );
              setTimeout(async () => {
                try {
                  await PipelineGitHelper.commitCode(filePath, obj.objectName, stateManager);
                } catch { }
              }, 1000);
            } catch {
              vscode.window.showInformationMessage(
                `DarkHorse: ${obj.objectName} code copied to clipboard.`
              );
            }
          }

          resolve(true);
        } else if (message.command === 'reject') {
          resolved = true;
          panel.dispose();
          resolve(false);
        }
      });

      panel.onDidDispose(() => {
        if (!resolved) {
          resolve(false);
        }
      });
    });
  }

  private static buildPrompt(
    obj: AbapObject,
    tds: TdsDocument,
    index: number
  ): string {
    const prevObj = index > 0
      ? tds.sections.abapObjectList[index - 1]
      : null;
    const nextObj = index < tds.sections.abapObjectList.length - 1
      ? tds.sections.abapObjectList[index + 1]
      : null;

    return `Generate complete, production-ready ABAP code for this SAP object.

Object Details:
- Type: ${obj.objectType}
- Name: ${obj.objectName}
- Description: ${obj.description}

Key Logic to implement:
${obj.keyLogic.map((l, i) => `${i + 1}. ${l}`).join('\n')}

Dependencies:
${obj.dependencies.join(', ') || 'None specified'}

Context:
- Previous object: ${prevObj ? `${prevObj.objectName} (${prevObj.objectType})` : 'None'}
- Next object: ${nextObj ? `${nextObj.objectName} (${nextObj.objectType})` : 'None'}
- Technical approach: ${tds.sections.technicalApproach}
- Database strategy: ${tds.sections.dbDesign}

Return ONLY the complete ABAP source code. No explanation. No markdown fences.
Start with REPORT ${obj.objectName}. or CLASS ${obj.objectName} DEFINITION. as appropriate.`;
  }

  private static getSystemPrompt(): string {
    return `You are an expert SAP ABAP developer with 15 years of experience.
Generate complete, production-ready ABAP code following these rules:
- Always check SY-SUBRC after database operations
- Use ALV Grid (CL_SALV_TABLE) for report output
- Add meaningful inline comments
- Use AUTHORITY-CHECK where authorization objects are mentioned
- Follow SAP naming conventions (Z prefix for custom objects)
- Never use SELECT * — always specify fields
- Never generate code that deletes from database tables without WHERE clause
- Never generate code that releases transports
- Always add error handling for CALL FUNCTION statements
Return ONLY the ABAP source code. No markdown. No explanation.`;
  }

  private static getPreviewHtml(obj: AbapObject, code: string): string {
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const lineCount = code.split('\n').length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
    }
    .header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-left h2 { color: #58a6ff; font-size: 16px; }
    .header-left p { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .header-actions { display: flex; gap: 10px; }
    button {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
    }
    .btn-accept { background: #238636; color: #fff; }
    .btn-accept:hover { background: #2ea043; }
    .btn-reject { background: #da3633; color: #fff; }
    .btn-reject:hover { background: #f85149; }
    .meta-bar {
      background: #1c2128;
      border-bottom: 1px solid #30363d;
      padding: 10px 24px;
      display: flex;
      gap: 24px;
      font-size: 12px;
      color: #8b949e;
    }
    .meta-bar span { color: #58a6ff; font-weight: 600; }
    .code-container {
      padding: 24px;
      overflow: auto;
    }
    pre {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 20px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.6;
      color: #e6edf3;
      white-space: pre-wrap;
      word-wrap: break-word;
      counter-reset: line;
    }
    .note {
      background: #1f3a5f;
      border: 1px solid #1f6feb;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 12px;
      color: #79c0ff;
      margin: 0 24px 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h2>💻 Generated Code — ${obj.objectName}</h2>
      <p>${obj.objectType} | ${obj.description}</p>
    </div>
    <div class="header-actions">
      <button class="btn-reject" onclick="reject()">✗ Reject</button>
      <button class="btn-accept" onclick="accept()">✓ Accept & Copy to Clipboard</button>
    </div>
  </div>

  <div class="meta-bar">
    <div>Object: <span>${obj.objectName}</span></div>
    <div>Type: <span>${obj.objectType}</span></div>
    <div>Lines: <span>${lineCount}</span></div>
  </div>

  <div class="note">
    📋 Accepting will copy the code to your clipboard. 
    Paste it into SAP ADT, SE38, or the DarkHorse ABAP editor.
    The code has NOT been automatically saved to SAP.
  </div>

  <div class="code-container">
    <pre>${escapedCode}</pre>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function accept() { vscode.postMessage({ command: 'accept' }); }
    function reject() { vscode.postMessage({ command: 'reject' }); }
  </script>
</body>
</html>`;
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
        timeout: 120000  // 2 minutes for code generation
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

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Code generation timed out after 2 minutes. Try again.'));
      });

      req.on('error', (err: any) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}