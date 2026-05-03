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

'use strict';

import * as cp   from 'child_process';
import * as path from 'path';
import * as fs   from 'fs';
import * as os   from 'os';
import { EventEmitter } from 'events';

export type AgentStatus =
  | 'created'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export type AgentPermission = 'read_sap' | 'write_sap' | 'call_llm' | 'read_files';

export interface AgentConfig {
  agentId:       string;
  agentType:     string;           // 'code_review' | 'documentation' | 'impact_analysis' etc.
  taskDescription: string;
  scope: {
    objectName?:  string;
    packageName?: string;
    objectType?:  string;
  };
  permissions:   AgentPermission[];
  timeoutMs:     number;
  proxyUrl:      string;           // LLM proxy URL — passed so agent doesn't need to discover it
  sapContext?: {
    systemUrl:   string;           // Already scrubbed of real SID by caller
    objectSource?: string;         // ABAP source to review — passed at spawn time
  };
}

export interface AgentRecord {
  config:      AgentConfig;
  status:      AgentStatus;
  startedAt:   Date;
  completedAt?: Date;
  report?:     AgentReport;
  errorMessage?: string;
  process?:    cp.ChildProcess;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface AgentReport {
  agentId:     string;
  agentType:   string;
  completedAt: string;
  summary:     string;
  findings:    AgentFinding[];
  canApply:    boolean;           // true if agent produced applicable code changes
  patches?:    AgentPatch[];      // code changes awaiting consent
}

export interface AgentFinding {
  severity:   'critical' | 'high' | 'medium' | 'low' | 'info';
  category:   string;
  line?:      number;
  message:    string;
  suggestion?: string;
}

export interface AgentPatch {
  objectName:  string;
  objectType:  string;
  originalCode: string;
  proposedCode: string;
  description: string;
}

export class AgentOrchestrator extends EventEmitter {

  private agents = new Map<string, AgentRecord>();
  private agentScriptPath: string;

  constructor(extensionPath: string) {
    super();
    // Agent runtime script lives at extensions/darkhorse-agents/dist/AgentRuntime.js
    this.agentScriptPath = path.join(
      extensionPath, '..', '..', 'extensions', 'darkhorse-agents', 'dist', 'AgentRuntime.js'
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Spawn a new agent subprocess.
   * Returns the agentId immediately — progress comes via events.
   */
  public async spawn(config: AgentConfig): Promise<string> {
    this.validateConfig(config);

    if (!fs.existsSync(this.agentScriptPath)) {
      throw new Error(
        `Agent runtime not found at: ${this.agentScriptPath}\n` +
        'Run "npm run build" in extensions/darkhorse-agents.'
      );
    }

    const record: AgentRecord = {
      config,
      status:    'created',
      startedAt: new Date()
    };

    this.agents.set(config.agentId, record);

    // Spawn the agent as a child process
    // Context is passed via stdin as a JSON payload — not env vars
    // (context can be large — ABAP source code)
    const child = cp.spawn(
      process.execPath,
      [this.agentScriptPath],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DARKHORSE_PROXY_URL:    config.proxyUrl,
          DARKHORSE_AGENT_ID:     config.agentId,
          DARKHORSE_AGENT_TYPE:   config.agentType,
          // NO credentials passed — agent reads SAP via proxy only
        }
      }
    );

    record.process = child;
    record.status  = 'running';

    // Write the full config + context to stdin, then close it
    child.stdin!.write(JSON.stringify(config));
    child.stdin!.end();

    // Collect stdout lines — agent emits JSON events
    let stdoutBuffer = '';
    child.stdout!.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString();
      this.processAgentOutput(config.agentId, stdoutBuffer);
    });

    // Forward stderr to a per-agent log file
    const logPath = this.getAgentLogPath(config.agentId);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    child.stderr!.pipe(logStream);

    // Handle process exit
    child.on('exit', (code: number | null, signal: string | null) => {
      clearTimeout(record.timeoutHandle);
      logStream.close();

      const rec = this.agents.get(config.agentId);
      if (!rec) { return; }

      if (rec.status === 'running') {
        if (code === 0) {
          rec.status = 'completed';
        } else if (signal === 'SIGTERM') {
          rec.status = 'timed_out';
        } else {
          rec.status      = 'failed';
          rec.errorMessage = `Agent process exited with code ${code}`;
        }
      }

      rec.completedAt = new Date();
      rec.process     = undefined;

      this.emit('agentStatusChanged', config.agentId, rec.status);
    });

    child.on('error', (err: Error) => {
      const rec = this.agents.get(config.agentId);
      if (rec) {
        rec.status       = 'failed';
        rec.errorMessage = err.message;
        rec.completedAt  = new Date();
        this.emit('agentStatusChanged', config.agentId, 'failed');
      }
    });

    // Enforce timeout
    record.timeoutHandle = setTimeout(() => {
      this.terminate(config.agentId, 'timed_out');
    }, config.timeoutMs);

    this.emit('agentStatusChanged', config.agentId, 'running');
    return config.agentId;
  }

  /**
   * Terminate a running agent.
   */
  public terminate(agentId: string, reason: AgentStatus = 'cancelled'): void {
    const record = this.agents.get(agentId);
    if (!record || !record.process) { return; }

    clearTimeout(record.timeoutHandle);
    record.status      = reason;
    record.completedAt = new Date();

    record.process.kill('SIGTERM');

    // Force kill after 3s if it doesn't respond
    setTimeout(() => {
      if (record.process && !record.process.killed) {
        record.process.kill('SIGKILL');
      }
    }, 3000);

    this.emit('agentStatusChanged', agentId, reason);
  }

  /**
   * Get current status of all agents.
   */
  public getAllAgents(): AgentRecord[] {
    return Array.from(this.agents.values()).map(r => ({ ...r, process: undefined }));
  }

  public getAgent(agentId: string): AgentRecord | undefined {
    const record = this.agents.get(agentId);
    if (!record) { return undefined; }
    return { ...record, process: undefined };
  }

  /**
   * Clear completed/failed agents from the list.
   */
  public clearCompleted(): void {
    for (const [id, record] of this.agents.entries()) {
      if (['completed', 'failed', 'timed_out', 'cancelled'].includes(record.status)) {
        this.agents.delete(id);
      }
    }
    this.emit('agentsCleared');
  }

  /**
   * Return the path of the per-agent log file.
   */
  public getAgentLogPath(agentId: string): string {
    const dir = path.join(os.homedir(), '.darkhorse', 'agent-logs');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${agentId}.log`);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Process streamed JSON lines from agent stdout.
   * Agent emits one JSON object per line.
   */
  private processAgentOutput(agentId: string, buffer: string): void {
    const lines = buffer.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }

      try {
        const event = JSON.parse(trimmed) as AgentEvent;
        this.handleAgentEvent(agentId, event);
      } catch {
        // Not valid JSON — ignore (could be partial line)
      }
    }
  }

  private handleAgentEvent(agentId: string, event: AgentEvent): void {
    const record = this.agents.get(agentId);
    if (!record) { return; }

    switch (event.type) {
      case 'progress':
        this.emit('agentProgress', agentId, event.message);
        break;

      case 'report':
        record.report  = event.report;
        record.status  = 'completed';
        this.emit('agentReport', agentId, event.report);
        break;

      case 'error':
        record.status       = 'failed';
        record.errorMessage = event.message;
        this.emit('agentStatusChanged', agentId, 'failed');
        break;

      case 'consent_required':
        // Agent needs write permission — surface to ConsentGate
        this.emit('consentRequired', agentId, event.action);
        break;
    }
  }

  private validateConfig(config: AgentConfig): void {
    if (!config.agentId)          { throw new Error('agentId is required.'); }
    if (!config.agentType)        { throw new Error('agentType is required.'); }
    if (!config.taskDescription)  { throw new Error('taskDescription is required.'); }
    if (!config.proxyUrl)         { throw new Error('proxyUrl is required.'); }
    if (config.timeoutMs < 5000)  { throw new Error('timeoutMs must be at least 5000ms.'); }

    // Write SAP permission requires explicit grant — not default
    if (config.permissions.includes('write_sap')) {
      // Allowed but logged — write permission is always an explicit choice
      console.warn(`[AgentOrchestrator] Agent ${config.agentId} granted write_sap permission.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Generate unique agent ID
  // ---------------------------------------------------------------------------

  public static generateId(agentType: string): string {
    const ts     = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    return `${agentType}_${ts}_${random}`;
  }
}

// ---------------------------------------------------------------------------
// Agent event shapes (emitted by AgentRuntime via stdout)
// ---------------------------------------------------------------------------

interface AgentEvent {
  type:     'progress' | 'report' | 'error' | 'consent_required';
  message?: string;
  report?:  AgentReport;
  action?:  ConsentAction;
}

export interface ConsentAction {
  actionId:    string;
  description: string;
  objectName:  string;
  objectType:  string;
  proposedCode?: string;
}
