/**
 * DarkHorse Agent Extension — Agent Dashboard
 *
 * Webview panel showing all active and completed agents,
 * their status, progress messages, and report summaries.
 *
 * Auto-refreshes every 3 seconds while agents are running.
 * Shows "View Report" button when an agent completes.
 */
import * as vscode from 'vscode';
import { AgentOrchestrator } from './AgentOrchestrator';
export declare class AgentDashboard implements vscode.Disposable {
    private orchestrator;
    static readonly VIEW_TYPE = "darkhorse.agentDashboard";
    private static instance;
    private panel;
    private disposables;
    private refreshTimer;
    static show(extensionUri: vscode.Uri, orchestrator: AgentOrchestrator): AgentDashboard;
    private constructor();
    private handleMessage;
    private openAgentLog;
    private pushUpdate;
    private hasRunningAgents;
    private getHtml;
    private generateNonce;
    dispose(): void;
}
