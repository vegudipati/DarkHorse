/**
 * DarkHorse Agent Runtime — Child Process Entry Point
 *
 * This file runs as a standalone Node.js child process spawned by AgentOrchestrator.
 * It receives the AgentConfig via stdin, executes the agent, and emits
 * JSON events to stdout for the orchestrator to process.
 *
 * Communication protocol:
 *   stdin:  one JSON object (AgentConfig) — read once at startup
 *   stdout: one JSON event object per line — streamed during execution
 *   stderr: raw log lines — written to per-agent log file by orchestrator
 *
 * Event types emitted to stdout:
 *   { type: 'progress', message: '...' }
 *   { type: 'report',   report: AgentReport }
 *   { type: 'error',    message: '...' }
 *   { type: 'consent_required', action: ConsentAction }
 *
 * Security constraints:
 *   - No access to VS Code APIs (this is a plain Node.js process)
 *   - No access to Windows Credential Manager
 *   - All LLM calls go through the proxy URL from config
 *   - All SAP reads go through the proxy — no direct ADT calls
 *   - Write operations emit consent_required and wait for orchestrator response
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitProgress = emitProgress;
exports.emitReport = emitReport;
exports.emitError = emitError;
const CodeReviewAgent_1 = require("./agents/CodeReviewAgent");
// ---------------------------------------------------------------------------
// Read config from stdin
// ---------------------------------------------------------------------------
async function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
    });
}
// ---------------------------------------------------------------------------
// Emit events to stdout (one JSON per line)
// ---------------------------------------------------------------------------
function emitProgress(message) {
    process.stdout.write(JSON.stringify({ type: 'progress', message }) + '\n');
}
function emitReport(report) {
    process.stdout.write(JSON.stringify({ type: 'report', report }) + '\n');
}
function emitError(message) {
    process.stdout.write(JSON.stringify({ type: 'error', message }) + '\n');
}
const AGENT_REGISTRY = {
    'code_review': CodeReviewAgent_1.CodeReviewAgent,
    // 'documentation':  DocumentationAgent,  — added in CPI-3
    // 'impact_analysis': ImpactAnalysisAgent, — added in CPI-3
};
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    let config;
    try {
        const raw = await readStdin();
        config = JSON.parse(raw);
    }
    catch (err) {
        emitError('Failed to parse agent config from stdin: ' + String(err));
        process.exit(1);
    }
    process.stderr.write(`[AgentRuntime] Starting agent: ${config.agentId} (${config.agentType})\n`);
    const AgentClass = AGENT_REGISTRY[config.agentType];
    if (!AgentClass) {
        emitError(`Unknown agent type: ${config.agentType}. Supported: ${Object.keys(AGENT_REGISTRY).join(', ')}`);
        process.exit(1);
    }
    try {
        const agent = new AgentClass(config);
        const report = await agent.run();
        emitReport(report);
        process.exit(0);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[AgentRuntime] Agent failed: ${message}\n`);
        emitError(message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=AgentRuntime.js.map