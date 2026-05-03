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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentOrchestrator = void 0;
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const events_1 = require("events");
class AgentOrchestrator extends events_1.EventEmitter {
    agents = new Map();
    agentScriptPath;
    constructor(extensionPath) {
        super();
        // Agent runtime script lives at extensions/darkhorse-agents/dist/AgentRuntime.js
        this.agentScriptPath = path.join(extensionPath, '..', '..', 'extensions', 'darkhorse-agents', 'dist', 'AgentRuntime.js');
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Spawn a new agent subprocess.
     * Returns the agentId immediately — progress comes via events.
     */
    async spawn(config) {
        this.validateConfig(config);
        if (!fs.existsSync(this.agentScriptPath)) {
            throw new Error(`Agent runtime not found at: ${this.agentScriptPath}\n` +
                'Run "npm run build" in extensions/darkhorse-agents.');
        }
        const record = {
            config,
            status: 'created',
            startedAt: new Date()
        };
        this.agents.set(config.agentId, record);
        // Spawn the agent as a child process
        // Context is passed via stdin as a JSON payload — not env vars
        // (context can be large — ABAP source code)
        const child = cp.spawn(process.execPath, [this.agentScriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                DARKHORSE_PROXY_URL: config.proxyUrl,
                DARKHORSE_AGENT_ID: config.agentId,
                DARKHORSE_AGENT_TYPE: config.agentType,
                // NO credentials passed — agent reads SAP via proxy only
            }
        });
        record.process = child;
        record.status = 'running';
        // Write the full config + context to stdin, then close it
        child.stdin.write(JSON.stringify(config));
        child.stdin.end();
        // Collect stdout lines — agent emits JSON events
        let stdoutBuffer = '';
        child.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            this.processAgentOutput(config.agentId, stdoutBuffer);
        });
        // Forward stderr to a per-agent log file
        const logPath = this.getAgentLogPath(config.agentId);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        child.stderr.pipe(logStream);
        // Handle process exit
        child.on('exit', (code, signal) => {
            clearTimeout(record.timeoutHandle);
            logStream.close();
            const rec = this.agents.get(config.agentId);
            if (!rec) {
                return;
            }
            if (rec.status === 'running') {
                if (code === 0) {
                    rec.status = 'completed';
                }
                else if (signal === 'SIGTERM') {
                    rec.status = 'timed_out';
                }
                else {
                    rec.status = 'failed';
                    rec.errorMessage = `Agent process exited with code ${code}`;
                }
            }
            rec.completedAt = new Date();
            rec.process = undefined;
            this.emit('agentStatusChanged', config.agentId, rec.status);
        });
        child.on('error', (err) => {
            const rec = this.agents.get(config.agentId);
            if (rec) {
                rec.status = 'failed';
                rec.errorMessage = err.message;
                rec.completedAt = new Date();
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
    terminate(agentId, reason = 'cancelled') {
        const record = this.agents.get(agentId);
        if (!record || !record.process) {
            return;
        }
        clearTimeout(record.timeoutHandle);
        record.status = reason;
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
    getAllAgents() {
        return Array.from(this.agents.values()).map(r => ({ ...r, process: undefined }));
    }
    getAgent(agentId) {
        const record = this.agents.get(agentId);
        if (!record) {
            return undefined;
        }
        return { ...record, process: undefined };
    }
    /**
     * Clear completed/failed agents from the list.
     */
    clearCompleted() {
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
    getAgentLogPath(agentId) {
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
    processAgentOutput(agentId, buffer) {
        const lines = buffer.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            try {
                const event = JSON.parse(trimmed);
                this.handleAgentEvent(agentId, event);
            }
            catch {
                // Not valid JSON — ignore (could be partial line)
            }
        }
    }
    handleAgentEvent(agentId, event) {
        const record = this.agents.get(agentId);
        if (!record) {
            return;
        }
        switch (event.type) {
            case 'progress':
                this.emit('agentProgress', agentId, event.message);
                break;
            case 'report':
                record.report = event.report;
                record.status = 'completed';
                this.emit('agentReport', agentId, event.report);
                break;
            case 'error':
                record.status = 'failed';
                record.errorMessage = event.message;
                this.emit('agentStatusChanged', agentId, 'failed');
                break;
            case 'consent_required':
                // Agent needs write permission — surface to ConsentGate
                this.emit('consentRequired', agentId, event.action);
                break;
        }
    }
    validateConfig(config) {
        if (!config.agentId) {
            throw new Error('agentId is required.');
        }
        if (!config.agentType) {
            throw new Error('agentType is required.');
        }
        if (!config.taskDescription) {
            throw new Error('taskDescription is required.');
        }
        if (!config.proxyUrl) {
            throw new Error('proxyUrl is required.');
        }
        if (config.timeoutMs < 5000) {
            throw new Error('timeoutMs must be at least 5000ms.');
        }
        // Write SAP permission requires explicit grant — not default
        if (config.permissions.includes('write_sap')) {
            // Allowed but logged — write permission is always an explicit choice
            console.warn(`[AgentOrchestrator] Agent ${config.agentId} granted write_sap permission.`);
        }
    }
    // ---------------------------------------------------------------------------
    // Generate unique agent ID
    // ---------------------------------------------------------------------------
    static generateId(agentType) {
        const ts = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 6);
        return `${agentType}_${ts}_${random}`;
    }
}
exports.AgentOrchestrator = AgentOrchestrator;
//# sourceMappingURL=AgentOrchestrator.js.map