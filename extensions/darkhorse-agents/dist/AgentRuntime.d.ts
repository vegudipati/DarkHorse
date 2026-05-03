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
import { AgentReport } from './AgentOrchestrator';
export declare function emitProgress(message: string): void;
export declare function emitReport(report: AgentReport): void;
export declare function emitError(message: string): void;
