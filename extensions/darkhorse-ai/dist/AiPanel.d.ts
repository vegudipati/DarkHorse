/**
 * DarkHorse AI Extension — AI Panel
 *
 * VS Code Webview panel providing a chat-style interface for ABAP code generation.
 *
 * Flow:
 *   1. Developer opens panel via command palette or sidebar button
 *   2. ContextCollector gathers active file info (object type, name, selection)
 *   3. Developer types a prompt and submits
 *   4. AiPanel POSTs to the local proxy /generate endpoint
 *   5. Response is passed to DiffPreview for developer review
 *   6. Developer accepts or rejects — code is never auto-inserted
 *
 * Security:
 *   - All LLM calls go through ProxyManager.getProxyUrl() — never direct
 *   - No API key in this file — proxy handles authentication
 *   - Webview has no internet access (localResourceRoots restricted)
 *   - Content Security Policy set on every webview render
 */
import * as vscode from 'vscode';
import { ProxyManager } from './ProxyManager';
export declare class AiPanel implements vscode.Disposable {
    static readonly VIEW_TYPE = "darkhorse.aiPanel";
    private static instance;
    private panel;
    private disposables;
    private proxyManager;
    private contextCollector;
    private diffPreview;
    private currentSessionId;
    static show(extensionUri: vscode.Uri, proxyManager: ProxyManager): AiPanel;
    private constructor();
    private handleWebviewMessage;
    private handleGenerate;
    private pushContextToWebview;
    private postMessage;
    private getWebviewHtml;
    private generateSessionId;
    private generateNonce;
    dispose(): void;
}
