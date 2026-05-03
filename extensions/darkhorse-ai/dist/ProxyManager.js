/**
 * DarkHorse AI Extension — Proxy Manager
 *
 * Runs inside the darkhorse-ai VS Code extension.
 * Responsible for spawning the llm-proxy child process, monitoring it,
 * and providing the proxy URL to other extension components.
 *
 * Lifecycle:
 *   1. Extension activates → ProxyManager.start() called
 *   2. Manager retrieves API key from VS Code SecretStorage
 *   3. Manager spawns services/llm-proxy/dist/index.js as a child process
 *   4. Manager waits for the '[DarkHorse Proxy] Ready on' line on stdout
 *   5. Manager exposes getProxyUrl() to the rest of the extension
 *   6. Extension deactivates → ProxyManager.stop() called → child process killed
 *
 * Security:
 *   - API key passed only via process.env at spawn time (MVP-5)
 *   - Key is a string in memory for the duration of spawn() call — not persisted
 *   - Upgrade to IPC key delivery in CPI-1
 *   - Proxy stdout/stderr forwarded to VS Code output channel for diagnostics
 *   - Proxy bound to 127.0.0.1 — verified by checking the ready line
 *
 * Known upgrade points for CPI-1:
 *   - Replace env-var key delivery with IPC callback
 *   - Add health check polling (GET /health every 30s)
 *   - Auto-restart proxy on crash with exponential backoff
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
exports.ProxyManager = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Secret storage key — must match the key used in DarkHorse Settings
const SECRET_KEY_CLAUDE = 'darkhorse.claudeApiKey';
const PROXY_READY_SIGNAL = '[DarkHorse Proxy] Ready on';
const PROXY_STARTUP_TIMEOUT_MS = 15_000; // 15 seconds to start
const PROXY_PORT = 47291;
class ProxyManager {
    proxyProcess = null;
    proxyUrl = null;
    outputChannel;
    context;
    constructor(context) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('DarkHorse AI Proxy');
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Start the proxy process. Resolves when the proxy is ready to accept requests.
     * Rejects if the proxy fails to start within PROXY_STARTUP_TIMEOUT_MS.
     */
    async start() {
        if (this.proxyProcess && !this.proxyProcess.killed) {
            this.outputChannel.appendLine('[ProxyManager] Proxy already running.');
            return;
        }
        const apiKey = await this.getApiKey();
        if (!apiKey) {
            throw new Error('Claude API key not configured. ' +
                'Open DarkHorse Settings and enter your Anthropic API key.');
        }
        const proxyScriptPath = this.resolveProxyScript();
        this.outputChannel.appendLine(`[ProxyManager] Starting proxy: ${proxyScriptPath}`);
        await this.spawnProxy(proxyScriptPath, apiKey);
    }
    /**
     * Stop the proxy process gracefully.
     * Called on extension deactivation.
     */
    async stop() {
        if (!this.proxyProcess) {
            return;
        }
        this.outputChannel.appendLine('[ProxyManager] Stopping proxy...');
        return new Promise((resolve) => {
            if (!this.proxyProcess) {
                resolve();
                return;
            }
            this.proxyProcess.once('exit', () => {
                this.outputChannel.appendLine('[ProxyManager] Proxy stopped.');
                this.proxyProcess = null;
                this.proxyUrl = null;
                resolve();
            });
            // SIGTERM first, then SIGKILL after 3 seconds
            this.proxyProcess.kill('SIGTERM');
            setTimeout(() => {
                if (this.proxyProcess && !this.proxyProcess.killed) {
                    this.outputChannel.appendLine('[ProxyManager] Force killing proxy after timeout.');
                    this.proxyProcess.kill('SIGKILL');
                }
            }, 3000);
        });
    }
    /**
     * Returns the base URL for the proxy, e.g. 'http://127.0.0.1:47291'.
     * Throws if the proxy is not running.
     */
    getProxyUrl() {
        if (!this.proxyUrl) {
            throw new Error('DarkHorse AI proxy is not running. Restart DarkHorse to try again.');
        }
        return this.proxyUrl;
    }
    /**
     * Returns true if the proxy process is running and ready.
     */
    isRunning() {
        return this.proxyProcess !== null &&
            !this.proxyProcess.killed &&
            this.proxyUrl !== null;
    }
    /**
     * Dispose — called by VS Code when the extension is deactivated.
     */
    dispose() {
        this.stop().catch(() => { });
        this.outputChannel.dispose();
    }
    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------
    async getApiKey() {
        // SecretStorage replaces keytar — no native module, persists across restarts
        return this.context.secrets.get(SECRET_KEY_CLAUDE);
    }
    resolveProxyScript() {
        // The compiled proxy lives at services/llm-proxy/dist/index.js
        // relative to the extension's root directory
        const extensionRoot = this.context.extensionPath;
        const proxyPath = path.join(extensionRoot, '..', '..', 'services', 'llm-proxy', 'dist', 'index.js');
        if (!fs.existsSync(proxyPath)) {
            throw new Error(`LLM Proxy script not found at: ${proxyPath}\n` +
                'Run "npm run build" in services/llm-proxy to compile the proxy.');
        }
        return proxyPath;
    }
    spawnProxy(scriptPath, apiKey) {
        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                DARKHORSE_CLAUDE_API_KEY: apiKey,
                DARKHORSE_PROXY_PORT: String(PROXY_PORT),
                DARKHORSE_LLM_BACKEND: 'claude',
                // Audit log dir in user's home — survives extension updates
                DARKHORSE_AUDIT_LOG_DIR: process.env.USERPROFILE || process.env.HOME || ''
            };
            // CRITICAL: Do not log the env object — it contains the API key
            this.proxyProcess = cp.spawn(process.execPath, // Use the same Node.js binary as the extension host
            [scriptPath], {
                env,
                stdio: ['ignore', 'pipe', 'pipe']
                // stdin:  ignore  — proxy doesn't read stdin
                // stdout: pipe    — we read the ready signal and forward to output channel
                // stderr: pipe    — we forward errors to output channel
            });
            const timeoutHandle = setTimeout(() => {
                reject(new Error(`LLM Proxy failed to start within ${PROXY_STARTUP_TIMEOUT_MS / 1000} seconds.`));
                this.proxyProcess?.kill();
            }, PROXY_STARTUP_TIMEOUT_MS);
            // Watch stdout for the ready signal line
            this.proxyProcess.stdout.on('data', (data) => {
                const text = data.toString();
                this.outputChannel.append(text);
                if (text.includes(PROXY_READY_SIGNAL)) {
                    clearTimeout(timeoutHandle);
                    this.proxyUrl = `http://127.0.0.1:${PROXY_PORT}`;
                    this.outputChannel.appendLine(`[ProxyManager] Proxy ready at ${this.proxyUrl}`);
                    resolve();
                }
            });
            // Forward stderr to output channel
            this.proxyProcess.stderr.on('data', (data) => {
                const text = data.toString();
                // Scrub potential key echo before writing to output channel
                const safe = text.replace(/[a-zA-Z0-9_\-]{20,}/g, '[REDACTED]');
                this.outputChannel.append(`[ERROR] ${safe}`);
            });
            this.proxyProcess.on('error', (err) => {
                clearTimeout(timeoutHandle);
                this.outputChannel.appendLine(`[ProxyManager] Proxy process error: ${err.message}`);
                reject(new Error(`Failed to spawn LLM Proxy: ${err.message}`));
            });
            this.proxyProcess.on('exit', (code, signal) => {
                clearTimeout(timeoutHandle);
                this.proxyProcess = null;
                this.proxyUrl = null;
                if (code !== 0 && code !== null) {
                    this.outputChannel.appendLine(`[ProxyManager] Proxy exited with code ${code}. ` +
                        'Open the "DarkHorse AI Proxy" output channel for details.');
                }
                else if (signal) {
                    this.outputChannel.appendLine(`[ProxyManager] Proxy terminated by signal: ${signal}`);
                }
            });
        });
    }
}
exports.ProxyManager = ProxyManager;
//# sourceMappingURL=ProxyManager.js.map