/**
 * DarkHorse Agent Extension — Agent Wizard
 *
 * Webview-based questionnaire that collects agent configuration
 * from the developer before spawning an agent.
 *
 * Steps:
 *   1. Select agent type
 *   2. Describe the task
 *   3. Set scope (object name, package, or current file)
 *   4. Set permissions (read-only is default — write requires explicit opt-in)
 *   5. Set timeout
 *   6. Review and launch
 */
import * as vscode from 'vscode';
import { AgentConfig } from './AgentOrchestrator';
export interface WizardResult {
    config: AgentConfig;
    cancelled: boolean;
}
export declare class AgentWizard {
    private panel;
    private proxyUrl;
    private resolve;
    static readonly VIEW_TYPE = "darkhorse.agentWizard";
    static show(extensionUri: vscode.Uri, proxyUrl: string): Promise<WizardResult>;
    private constructor();
    private handleMessage;
    private handleLaunch;
    private sendActiveFileContext;
    private getHtml;
    private generateNonce;
}
