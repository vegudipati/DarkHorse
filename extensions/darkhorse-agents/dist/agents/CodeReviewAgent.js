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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeReviewAgent = void 0;
const AgentRuntime_1 = require("../AgentRuntime");
class CodeReviewAgent {
    config;
    constructor(config) {
        this.config = config;
    }
    // ---------------------------------------------------------------------------
    // Main entry point
    // ---------------------------------------------------------------------------
    async run() {
        (0, AgentRuntime_1.emitProgress)('Starting code review…');
        // Step 1: Get the source code to review
        const sourceCode = await this.getSourceCode();
        if (!sourceCode) {
            throw new Error('No source code available to review. ' +
                'Open an ABAP file before launching the Code Review Agent.');
        }
        (0, AgentRuntime_1.emitProgress)(`Reviewing ${this.config.scope.objectName || 'ABAP object'} (${sourceCode.length} chars)…`);
        // Step 2: Call the LLM proxy /review endpoint
        const reviewResult = await this.callReviewEndpoint(sourceCode);
        (0, AgentRuntime_1.emitProgress)('Parsing review findings…');
        // Step 3: Parse the structured JSON from the LLM response
        const reviewJson = this.parseReviewJson(reviewResult.code);
        // Step 4: Build patches for fixable findings (write_sap permission required)
        const patches = this.config.permissions.includes('write_sap')
            ? await this.buildPatches(sourceCode, reviewJson)
            : undefined;
        (0, AgentRuntime_1.emitProgress)('Code review complete.');
        // Step 5: Assemble the report
        const report = {
            agentId: this.config.agentId,
            agentType: 'code_review',
            completedAt: new Date().toISOString(),
            summary: reviewJson.summary,
            findings: this.mapFindings(reviewJson),
            canApply: !!patches && patches.length > 0,
            patches
        };
        return report;
    }
    // ---------------------------------------------------------------------------
    // Source code retrieval
    // ---------------------------------------------------------------------------
    async getSourceCode() {
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
    async callReviewEndpoint(sourceCode) {
        const proxyUrl = this.config.proxyUrl;
        let response;
        try {
            response = await fetch(`${proxyUrl}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: sourceCode,
                    objectName: this.config.scope.objectName || 'UNKNOWN',
                    sessionId: this.config.agentId
                })
            });
        }
        catch (err) {
            throw new Error(`Cannot reach LLM proxy at ${proxyUrl}. ` +
                'Make sure DarkHorse is running and the proxy is active.');
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(`LLM proxy /review failed: ${err.error || response.status}`);
        }
        return response.json();
    }
    // ---------------------------------------------------------------------------
    // Parse LLM response
    // ---------------------------------------------------------------------------
    parseReviewJson(rawCode) {
        // The review system prompt instructs the LLM to return only JSON
        // Strip any accidental markdown fences
        const cleaned = rawCode
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
        try {
            return JSON.parse(cleaned);
        }
        catch {
            // LLM didn't return valid JSON — wrap raw response as a single finding
            return {
                summary: 'Review completed — could not parse structured findings.',
                severity: 'low',
                findings: [{
                        severity: 'info',
                        category: 'review',
                        message: rawCode.slice(0, 500),
                        suggestion: undefined
                    }],
                positives: [],
                estimatedRisk: 'unknown'
            };
        }
    }
    // ---------------------------------------------------------------------------
    // Map to AgentFinding[]
    // ---------------------------------------------------------------------------
    mapFindings(reviewJson) {
        return reviewJson.findings.map(f => ({
            severity: this.normalizeSeverity(f.severity),
            category: f.category || 'general',
            line: f.line,
            message: f.message,
            suggestion: f.suggestion
        }));
    }
    normalizeSeverity(s) {
        const valid = ['critical', 'high', 'medium', 'low', 'info'];
        return valid.includes(s) ? s : 'info';
    }
    // ---------------------------------------------------------------------------
    // Build patches from fixable findings
    // Only generated when write_sap permission is granted
    // ---------------------------------------------------------------------------
    async buildPatches(sourceCode, reviewJson) {
        // Only attempt patches for high/critical findings that have a concrete suggestion
        const fixable = reviewJson.findings.filter(f => ['critical', 'high'].includes(f.severity) && f.suggestion);
        if (fixable.length === 0) {
            return [];
        }
        (0, AgentRuntime_1.emitProgress)(`Building ${fixable.length} suggested fix(es)…`);
        // For MVP-7: return one patch representing the full suggested rewrite
        // In CPI-3: use diff-based patching per finding
        const patches = [];
        for (const finding of fixable.slice(0, 3)) { // Cap at 3 patches per run
            patches.push({
                objectName: this.config.scope.objectName || 'UNKNOWN',
                objectType: this.config.scope.objectType || 'PROG',
                originalCode: sourceCode,
                proposedCode: sourceCode, // MVP-7: placeholder — CPI-3 adds actual fix generation
                description: finding.suggestion || finding.message
            });
        }
        return patches;
    }
}
exports.CodeReviewAgent = CodeReviewAgent;
//# sourceMappingURL=CodeReviewAgent.js.map