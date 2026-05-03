/**
 * DarkHorse Agent Extension — Agent Orchestrator
 *
 * Spawns, tracks, and terminates agent subprocesses.
 * Each agent runs as an isolated Node.js child process with a scoped
 * context and a restricted tool list.
 *
 * Security rules enforced here:
 *   - Agents start with READ-ONLY permissions by default
 *   - Write permissions must be explicitly granted per-agent at creation time
 *   - Agent subprocess cannot access VS Code SecretStorage or Credential Vault
 *   - All LLM calls from agents go through the same proxy + PII scrubber
 *   - Agent timeout is enforced with process.kill — no hung agents
 *   - ConsentGate intercepts every write tool call before execution
 *
 * Agent lifecycle:
 *   CREATED → RUNNING → COMPLETED | FAILED | TIMED_OUT | CANCELLED
 */
import * as cp from 'child_process';
import { EventEmitter } from 'events';
export type AgentStatus = 'created' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
export type AgentPermission = 'read_sap' | 'write_sap' | 'call_llm' | 'read_files';
export interface AgentConfig {
    agentId: string;
    agentType: string;
    taskDescription: string;
    scope: {
        objectName?: string;
        packageName?: string;
        objectType?: string;
    };
    permissions: AgentPermission[];
    timeoutMs: number;
    proxyUrl: string;
    sapContext?: {
        systemUrl: string;
        objectSource?: string;
    };
}
export interface AgentRecord {
    config: AgentConfig;
    status: AgentStatus;
    startedAt: Date;
    completedAt?: Date;
    report?: AgentReport;
    errorMessage?: string;
    process?: cp.ChildProcess;
    timeoutHandle?: ReturnType<typeof setTimeout>;
}
export interface AgentReport {
    agentId: string;
    agentType: string;
    completedAt: string;
    summary: string;
    findings: AgentFinding[];
    canApply: boolean;
    patches?: AgentPatch[];
}
export interface AgentFinding {
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    line?: number;
    message: string;
    suggestion?: string;
}
export interface AgentPatch {
    objectName: string;
    objectType: string;
    originalCode: string;
    proposedCode: string;
    description: string;
}
export declare class AgentOrchestrator extends EventEmitter {
    private agents;
    private agentScriptPath;
    constructor(extensionPath: string);
    /**
     * Spawn a new agent subprocess.
     * Returns the agentId immediately — progress comes via events.
     */
    spawn(config: AgentConfig): Promise<string>;
    /**
     * Terminate a running agent.
     */
    terminate(agentId: string, reason?: AgentStatus): void;
    /**
     * Get current status of all agents.
     */
    getAllAgents(): AgentRecord[];
    getAgent(agentId: string): AgentRecord | undefined;
    /**
     * Clear completed/failed agents from the list.
     */
    clearCompleted(): void;
    /**
     * Return the path of the per-agent log file.
     */
    getAgentLogPath(agentId: string): string;
    /**
     * Process streamed JSON lines from agent stdout.
     * Agent emits one JSON object per line.
     */
    private processAgentOutput;
    private handleAgentEvent;
    private validateConfig;
    static generateId(agentType: string): string;
}
export interface ConsentAction {
    actionId: string;
    description: string;
    objectName: string;
    objectType: string;
    proposedCode?: string;
}
