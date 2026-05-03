/**
 * DarkHorse Agent Extension — Report Viewer
 *
 * Renders an agent report in a VS Code webview panel.
 * Provides Accept / Reject buttons for any suggested code patches.
 * Accepting a patch routes through ConsentGate before applying.
 */
import * as vscode from 'vscode';
import { AgentReport } from './AgentOrchestrator';
import { ConsentGate } from './ConsentGate';
export declare class ReportViewer implements vscode.Disposable {
    private consentGate;
    private panel;
    private disposables;
    constructor(consentGate: ConsentGate);
    show(report: AgentReport): Promise<void>;
    private handleMessage;
    private applyPatch;
    private showPatchDiff;
    private getReportHtml;
    private findingHtml;
    private patchHtml;
    private escHtml;
    private generateNonce;
    dispose(): void;
}
