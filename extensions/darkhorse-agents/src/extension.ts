/**
 * DarkHorse Agent Extension — Entry Point
 */

'use strict';

import * as vscode from 'vscode';
import { AgentOrchestrator } from './AgentOrchestrator';
import { AgentWizard }       from './AgentWizard';
import { AgentDashboard }    from './AgentDashboard';
import { ReportViewer }      from './ReportViewer';
import { ConsentGate }       from './ConsentGate';

let orchestrator: AgentOrchestrator | undefined;
let consentGate:  ConsentGate       | undefined;
let reportViewer: ReportViewer      | undefined;

export function activate(context: vscode.ExtensionContext): void {

  orchestrator = new AgentOrchestrator(context.extensionPath);
  consentGate  = new ConsentGate();
  reportViewer = new ReportViewer(consentGate);

  // Wire up report event: when an agent completes, show the report viewer
  orchestrator.on('agentReport', (_agentId: string, report) => {
    reportViewer!.show(report).catch(() => {});
    vscode.window.showInformationMessage(
      `DarkHorse Agent: ${_agentId} completed. Report is ready.`,
      'View Report'
    ).then(choice => {
      if (choice === 'View Report') {
        reportViewer!.show(report).catch(() => {});
      }
    });
  });

  // Wire up consent events
  orchestrator.on('consentRequired', (agentId: string, action) => {
    consentGate!.requestConsent(agentId, action).catch(() => {});
  });

  // ---- Command: New Agent ----
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.newAgent', async () => {
      const proxyUrl = getProxyUrl();
      if (!proxyUrl) {
        vscode.window.showErrorMessage(
          'DarkHorse AI proxy is not running. Start DarkHorse with a valid API key first.'
        );
        return;
      }

      const result = await AgentWizard.show(context.extensionUri, proxyUrl);
      if (result.cancelled) { return; }

      try {
        const agentId = await orchestrator!.spawn(result.config);
        vscode.window.showInformationMessage(
          `DarkHorse Agent: "${result.config.agentType}" started (${agentId}).`
        );

        // Open dashboard to show progress
        AgentDashboard.show(context.extensionUri, orchestrator!);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`DarkHorse Agent: Failed to start — ${msg}`);
      }
    })
  );

  // ---- Command: Open Agent Dashboard ----
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.openAgentDashboard', () => {
      AgentDashboard.show(context.extensionUri, orchestrator!);
    })
  );

  context.subscriptions.push(
    { dispose: () => { reportViewer?.dispose(); } }
  );
}

export function deactivate(): void {
  // Terminate all running agents on shutdown
  if (orchestrator) {
    for (const agent of orchestrator.getAllAgents()) {
      if (agent.status === 'running') {
        orchestrator.terminate(agent.config.agentId, 'cancelled');
      }
    }
  }
}

/**
 * Attempt to get the proxy URL from the darkhorse-ai extension's ProxyManager.
 * Falls back to default port if not accessible.
 */
function getProxyUrl(): string {
  // In a full integration, we'd use vscode.extensions.getExtension('darkhorse-ai')
  // and call its exported getProxyUrl(). For MVP-7, use the known default port.
  return 'http://127.0.0.1:47291';
}
