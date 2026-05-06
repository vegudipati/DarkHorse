import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PipelineStateManager } from './PipelineStateManager';

export interface StyleContext {
  writingStyle: string;
  terminologyNotes: string[];
  sectionPatterns: string[];
  examplePhrases: string[];
  documentCount: number;
  loadedFiles: string[];
}

export class ReferenceDocLoader {

  /**
   * Let developer pick a folder of reference .docx files.
   * Extracts text from each and builds a StyleContext via LLM.
   */
  public static async loadAndConfigure(
    context: vscode.ExtensionContext,
    stateManager: PipelineStateManager
  ): Promise<StyleContext | undefined> {

    // Step 1 — Pick reference docs folder
    const folderUri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Reference Documents Folder',
      title: 'Select folder containing existing FDS/TDS .docx files'
    });

    if (!folderUri || folderUri.length === 0) {
      return undefined;
    }

    const folderPath = folderUri[0].fsPath;

    // Step 2 — Find .docx files in folder
    const files = fs.readdirSync(folderPath)
      .filter(f => f.toLowerCase().endsWith('.docx'))
      .map(f => path.join(folderPath, f));

    if (files.length === 0) {
      vscode.window.showWarningMessage(
        'No .docx files found in selected folder. Please select a folder containing FDS or TDS documents.'
      );
      return undefined;
    }

    vscode.window.showInformationMessage(
      `DarkHorse: Found ${files.length} reference document(s). Extracting style...`
    );

    // Step 3 — Extract text from each .docx
    const extractedTexts: string[] = [];
    const loadedFiles: string[] = [];

    for (const filePath of files.slice(0, 5)) { // max 5 reference docs
      try {
        const text = await ReferenceDocLoader.extractTextFromDocx(filePath);
        if (text && text.length > 100) {
          // Only use first 2000 chars per doc — style not full content
          extractedTexts.push(text.substring(0, 2000));
          loadedFiles.push(path.basename(filePath));
        }
      } catch (err) {
        console.warn(`Could not read ${filePath}:`, err);
      }
    }

    if (extractedTexts.length === 0) {
      vscode.window.showWarningMessage(
        'Could not extract text from reference documents. Proceeding without style context.'
      );
      return undefined;
    }

    // Step 4 — Build style context via LLM
    const styleContext = await ReferenceDocLoader.analyzeStyle(
      extractedTexts,
      loadedFiles,
      stateManager
    );

    // Step 5 — Save to state and settings
    await stateManager.saveStyleContext(styleContext);
    await vscode.workspace.getConfiguration().update(
      'darkhorse.pipeline.referenceDocsFolder',
      folderPath,
      vscode.ConfigurationTarget.Global
    );

    return styleContext;
  }

  /**
   * Extract plain text from a .docx file using mammoth.
   */
  private static async extractTextFromDocx(filePath: string): Promise<string> {
    // mammoth is a CommonJS module
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value ?? '';
  }

  /**
   * Send extracted text samples to LLM to identify style patterns.
   * Only style/structure is extracted — NOT full document content.
   */
  private static async analyzeStyle(
    textSamples: string[],
    fileNames: string[],
    stateManager: PipelineStateManager
  ): Promise<StyleContext> {

    const config = vscode.workspace.getConfiguration();
    const proxyPort = config.get<number>('darkhorse.pipeline.llmProxyPort', 3100);

    const combinedSample = textSamples.join('\n\n---\n\n');

    const prompt = `Analyze the writing style of these SAP design documents and return a JSON object.
Focus ONLY on style patterns, not content.

Documents analyzed: ${fileNames.join(', ')}

Sample text:
${combinedSample}

Return ONLY this JSON structure, no other text:
{
  "writingStyle": "brief description of tone and voice",
  "terminologyNotes": ["term preference 1", "term preference 2"],
  "sectionPatterns": ["observed heading pattern 1", "observed heading pattern 2"],
  "examplePhrases": ["characteristic phrase 1", "characteristic phrase 2", "characteristic phrase 3"]
}`;

    try {
      const http = require('http');
      const payload = JSON.stringify({
        prompt,
        systemPrompt: 'You are a document style analyst. Return only valid JSON. No markdown, no explanation.',
        maxTokens: 500
      });

      const rawContent = await new Promise<string>((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port: proxyPort,
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
              resolve(parsed.code ?? parsed.content ?? '');
            } catch { resolve(data); }
          });
        });
        req.on('error', (err: any) => reject(err));
        req.write(payload);
        req.end();
      });

      const cleaned = rawContent.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        writingStyle: parsed.writingStyle ?? 'Professional, formal SAP consulting style',
        terminologyNotes: parsed.terminologyNotes ?? [],
        sectionPatterns: parsed.sectionPatterns ?? [],
        examplePhrases: parsed.examplePhrases ?? [],
        documentCount: textSamples.length,
        loadedFiles: fileNames
      };

    } catch (err) {
      // If LLM not available yet, return default style context
      console.warn('Style analysis via LLM failed, using defaults:', err);
      return {
        writingStyle: 'Professional, formal SAP consulting style. Use present tense. Be specific and concise.',
        terminologyNotes: [
          'Use "Z-object" for custom ABAP objects',
          'Use "transport request" not "transport",',
          'Use "business requirement" not "user story" in formal docs'
        ],
        sectionPatterns: [
          'Numbered sections (1., 1.1, 1.2)',
          'Bold section headings',
          'Tables for structured data'
        ],
        examplePhrases: [
          'The system shall...',
          'This document describes...',
          'As per the business requirement...'
        ],
        documentCount: 0,
        loadedFiles: []
      };
    }
  }

  /**
   * Get style context as a formatted string for LLM prompts.
   */
  public static formatStyleContext(styleContext: StyleContext): string {
    return `Writing Style: ${styleContext.writingStyle}
Terminology: ${styleContext.terminologyNotes.join('; ')}
Section Patterns: ${styleContext.sectionPatterns.join('; ')}
Example Phrases: ${styleContext.examplePhrases.join('; ')}`;
  }
}