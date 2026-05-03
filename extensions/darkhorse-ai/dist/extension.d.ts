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
import * as vscode from 'vscode';
export declare function activate(context: vscode.ExtensionContext): Promise<void>;
export declare function deactivate(): Promise<void>;
