/**
 * DarkHorse AI Extension — Entry Point
 *
 * Activated when DarkHorse launches (activationEvents: onStartupFinished).
 *
 * Responsibilities:
 *   1. Start the LLM proxy via ProxyManager
 *   2. Register the 'darkhorse.openAiPanel' command
 *   3. Register the 'darkhorse.setApiKey' command (settings)
 *   4. Register the 'darkhorse.showAuditLog' command
 *   5. Clean up on deactivation
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ProxyManager_1 = require("./ProxyManager");
const AiPanel_1 = require("./AiPanel");
let proxyManager;
// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------
async function activate(context) {
    // Start the proxy — non-fatal if it fails (developer may not have API key yet)
    proxyManager = new ProxyManager_1.ProxyManager(context);
    context.subscriptions.push(proxyManager);
    try {
        await proxyManager.start();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Don't block activation — developer may need to set API key first
        vscode.window.showWarningMessage(`DarkHorse AI: Proxy did not start — ${message}. ` +
            'Use "DarkHorse: Set API Key" to configure.');
    }
    // ---- Command: Open AI Panel ----
    context.subscriptions.push(vscode.commands.registerCommand('darkhorse.openAiPanel', () => {
        if (!proxyManager) {
            return;
        }
        AiPanel_1.AiPanel.show(context.extensionUri, proxyManager);
    }));
    // ---- Command: Set API Key ----
    context.subscriptions.push(vscode.commands.registerCommand('darkhorse.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            placeHolder: 'sk-ant-...',
            password: true, // Masks input
            ignoreFocusOut: true
        });
        if (!key) {
            return;
        }
        if (!key.startsWith('sk-ant-')) {
            vscode.window.showErrorMessage('That does not look like a valid Anthropic API key (should start with sk-ant-).');
            return;
        }
        // Store in VS Code SecretStorage — encrypted, never in plaintext
        await context.secrets.store('darkhorse.claudeApiKey', key);
        vscode.window.showInformationMessage('DarkHorse AI: API key saved.');
        // Restart the proxy with the new key
        if (proxyManager) {
            await proxyManager.stop();
            try {
                await proxyManager.start();
                vscode.window.showInformationMessage('DarkHorse AI: Proxy restarted successfully.');
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`DarkHorse AI: Proxy restart failed — ${msg}`);
            }
        }
    }));
    // ---- Command: Show Audit Log ----
    context.subscriptions.push(vscode.commands.registerCommand('darkhorse.showAuditLog', async () => {
        const os = require('os');
        const path = require('path');
        const logPath = path.join(os.homedir(), '.darkhorse', 'llm-audit.jsonl');
        const uri = vscode.Uri.file(logPath);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        }
        catch {
            vscode.window.showWarningMessage('DarkHorse AI: No audit log found yet. Make at least one AI request first.');
        }
    }));
    // ---- Status bar item ----
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'darkhorse.openAiPanel';
    statusBar.text = proxyManager.isRunning() ? '$(sparkle) DH AI' : '$(warning) DH AI';
    statusBar.tooltip = proxyManager.isRunning()
        ? 'DarkHorse AI is ready'
        : 'DarkHorse AI proxy is not running. Click to open panel.';
    statusBar.show();
    context.subscriptions.push(statusBar);
}
// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------
async function deactivate() {
    if (proxyManager) {
        await proxyManager.stop();
    }
}
//# sourceMappingURL=extension.js.map