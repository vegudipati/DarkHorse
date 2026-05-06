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
import * as vscode from 'vscode';
export declare class ProxyManager implements vscode.Disposable {
    private proxyProcess;
    private proxyUrl;
    private outputChannel;
    private context;
    constructor(context: vscode.ExtensionContext);
    /**
     * Start the proxy process. Resolves when the proxy is ready to accept requests.
     * Rejects if the proxy fails to start within PROXY_STARTUP_TIMEOUT_MS.
     */
    start(): Promise<void>;
    /**
     * Stop the proxy process gracefully.
     * Called on extension deactivation.
     */
    private startupTimeout;
    stop(): Promise<void>;
    /**
     * Returns the base URL for the proxy, e.g. 'http://127.0.0.1:47291'.
     * Throws if the proxy is not running.
     */
    getProxyUrl(): string;
    /**
     * Returns true if the proxy process is running and ready.
     */
    isRunning(): boolean;
    /**
     * Dispose — called by VS Code when the extension is deactivated.
     */
    dispose(): void;
    private getApiKey;
    private resolveProxyScript;
    private spawnProxy;
}
