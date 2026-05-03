/**
 * DarkHorse Agent — Code Review Agent
 *
 * Reads ABAP source code (from config.sapContext or via proxy),
 * calls the LLM proxy /review endpoint, and produces a structured report.
 *
 * This agent is READ-ONLY by default.
 * It never writes to SAP — it only produces a report.
 * Applying suggested fixes requires developer consent via ConsentGate.
 *
 * Output: AgentReport with findings array and optional patches.
 */

'use strict';

import { AgentConfig, AgentReport, AgentFinding, AgentPatch } from '../AgentOrchestrator';
import { emitProgress } from '../AgentRuntime';

// Shape of the /review endpoint response
interface ReviewResponse {
  code: string;  // Contains JSON string from the review system prompt
  model: string;
  tokensUsed: number;
}

// Shape of the structured JSON inside the review response
interface ReviewJson {
  summary:       string;
  severity:      string;
  findings:      Array<{
    line?:       number;
    severity:    string;
    category:    string;
    message:     string;
    suggestion?: string;
  }>;
  positives:     string[];
  estimatedRisk: string;
}

export class CodeReviewAgent {

  constructor(private readonly config: AgentConfig) {}

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  public async run(): Promise<AgentReport> {
    emitProgress('Starting code review…');

    // Step 1: Get the source code to review
    const sourceCode = await this.getSourceCode();
    if (!sourceCode) {
      throw new Error(
        'No source code available to review. ' +
        'Open an ABAP file before launching the Code Review Agent.'
      );
    }

    emitProgress(`Reviewing ${this.config.scope.objectName || 'ABAP object'} (${sourceCode.length} chars)…`);

    // Step 2: Call the LLM proxy /review endpoint
    const reviewResult = await this.callReviewEndpoint(sourceCode);

    emitProgress('Parsing review findings…');

    // Step 3: Parse the structured JSON from the LLM response
    const reviewJson = this.parseReviewJson(reviewResult.code);

    // Step 4: Build patches for fixable findings (write_sap permission required)
    const patches = this.config.permissions.includes('write_sap')
      ? await this.buildPatches(sourceCode, reviewJson)
      : undefined;

    emitProgress('Code review complete.');

    // Step 5: Assemble the report
    const report: AgentReport = {
      agentId:     this.config.agentId,
      agentType:   'code_review',
      completedAt: new Date().toISOString(),
      summary:     reviewJson.summary,
      findings:    this.mapFindings(reviewJson),
      canApply:    !!patches && patches.length > 0,
      patches
    };

    return report;
  }

  // ---------------------------------------------------------------------------
  // Source code retrieval
  // ---------------------------------------------------------------------------

  private async getSourceCode(): Promise<string | null> {
    // Primary: source passed directly in config at spawn time
    if (this.config.sapContext?.objectSource) {
      return this.config.sapContext.objectSource;
    }

    // Fallback: no source available in MVP-7
    // In CPI-1: fetch directly from SAP ADT via a read-only proxy tool
    return null;
  }

  // ---------------------------------------------------------------------------
  // LLM proxy call
  // ---------------------------------------------------------------------------

  private async callReviewEndpoint(sourceCode: string): Promise<ReviewResponse> {
    const proxyUrl = this.config.proxyUrl;

    let response: Response;
    try {
      response = await fetch(`${proxyUrl}/review`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code:       sourceCode,
          objectName: this.config.scope.objectName || 'UNKNOWN',
          sessionId:  this.config.agentId
        })
      });
    } catch (err: unknown) {
      throw new Error(
        `Cannot reach LLM proxy at ${proxyUrl}. ` +
        'Make sure DarkHorse is running and the proxy is active.'
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      throw new Error(`LLM proxy /review failed: ${err.error || response.status}`);
    }

    return response.json() as Promise<ReviewResponse>;
  }

  // ---------------------------------------------------------------------------
  // Parse LLM response
  // ---------------------------------------------------------------------------

  private parseReviewJson(rawCode: string): ReviewJson {
    // The review system prompt instructs the LLM to return only JSON
    // Strip any accidental markdown fences
    const cleaned = rawCode
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned) as ReviewJson;
    } catch {
      // LLM didn't return valid JSON — wrap raw response as a single finding
      return {
        summary:       'Review completed — could not parse structured findings.',
        severity:      'low',
        findings:      [{
          severity:    'info',
          category:    'review',
          message:     rawCode.slice(0, 500),
          suggestion:  undefined
        }],
        positives:     [],
        estimatedRisk: 'unknown'
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Map to AgentFinding[]
  // ---------------------------------------------------------------------------

  private mapFindings(reviewJson: ReviewJson): AgentFinding[] {
    return reviewJson.findings.map(f => ({
      severity:   this.normalizeSeverity(f.severity),
      category:   f.category || 'general',
      line:       f.line,
      message:    f.message,
      suggestion: f.suggestion
    }));
  }

  private normalizeSeverity(s: string): AgentFinding['severity'] {
    const valid = ['critical', 'high', 'medium', 'low', 'info'];
    return valid.includes(s) ? s as AgentFinding['severity'] : 'info';
  }

  // ---------------------------------------------------------------------------
  // Build patches from fixable findings
  // Only generated when write_sap permission is granted
  // ---------------------------------------------------------------------------

  private async buildPatches(
    sourceCode: string,
    reviewJson: ReviewJson
  ): Promise<AgentPatch[]> {
    // Only attempt patches for high/critical findings that have a concrete suggestion
    const fixable = reviewJson.findings.filter(
      f => ['critical', 'high'].includes(f.severity) && f.suggestion
    );

    if (fixable.length === 0) { return []; }

    emitProgress(`Building ${fixable.length} suggested fix(es)…`);

    // For MVP-7: return one patch representing the full suggested rewrite
    // In CPI-3: use diff-based patching per finding
    const patches: AgentPatch[] = [];

    for (const finding of fixable.slice(0, 3)) {  // Cap at 3 patches per run
      patches.push({
        objectName:   this.config.scope.objectName || 'UNKNOWN',
        objectType:   this.config.scope.objectType || 'PROG',
        originalCode: sourceCode,
        proposedCode: sourceCode,  // MVP-7: placeholder — CPI-3 adds actual fix generation
        description:  finding.suggestion || finding.message
      });
    }

    return patches;
  }
}
