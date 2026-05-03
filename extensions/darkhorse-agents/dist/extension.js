/**
 * DarkHorse Agent Extension — Entry Point
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
const AgentOrchestrator_1 = require("./AgentOrchestrator");
const AgentWizard_1 = require("./AgentWizard");
const AgentDashboard_1 = require("./AgentDashboard");
const ReportViewer_1 = require("./ReportViewer");
const ConsentGate_1 = require("./ConsentGate");
let orchestrator;
let consentGate;
let reportViewer;
function activate(context) {
    orchestrator = new AgentOrchestrator_1.AgentOrchestrator(context.extensionPath);
    consentGate = new ConsentGate_1.ConsentGate();
    reportViewer = new ReportViewer_1.ReportViewer(consentGate);
    // Wire up report event: when an agent completes, show the report viewer
    orchestrator.on('agentReport', (_agentId, report) => {
        reportViewer.show(report).catch(() => { });
        vscode.window.showInformationMessage(`DarkHorse Agent: ${_agentId} completed. Report is ready.`, 'View Report').then(choice => {
            if (choice === 'View Report') {
                reportViewer.show(report).catch(() => { });
            }
        });
    });
    // Wire up consent events
    orchestrator.on('consentRequired', (agentId, action) => {
        consentGate.requestConsent(agentId, action).catch(() => { });
    });
    // ---- Command: New Agent ----
    context.subscriptions.push(vscode.commands.registerCommand('darkhorse.newAgent', async () => {
        const proxyUrl = getProxyUrl();
        if (!proxyUrl) {
            vscode.window.showErrorMessage('DarkHorse AI proxy is not running. Start DarkHorse with a valid API key first.');
            return;
        }
        const result = await AgentWizard_1.AgentWizard.show(context.extensionUri, proxyUrl);
        if (result.cancelled) {
            return;
        }
        try {
            const agentId = await orchestrator.spawn(result.config);
            vscode.window.showInformationMessage(`DarkHorse Agent: "${result.config.agentType}" started (${agentId}).`);
            // Open dashboard to show progress
            AgentDashboard_1.AgentDashboard.show(context.extensionUri, orchestrator);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`DarkHorse Agent: Failed to start — ${msg}`);
        }
    }));
    // ---- Command: Open Agent Dashboard ----
    context.subscriptions.push(vscode.commands.registerCommand('darkhorse.openAgentDashboard', () => {
        AgentDashboard_1.AgentDashboard.show(context.extensionUri, orchestrator);
    }));
    context.subscriptions.push({ dispose: () => { reportViewer?.dispose(); } });
}
function deactivate() {
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
function getProxyUrl() {
    // In a full integration, we'd use vscode.extensions.getExtension('darkhorse-ai')
    // and call its exported getProxyUrl(). For MVP-7, use the known default port.
    return 'http://127.0.0.1:47291';
}
//# sourceMappingURL=extension.js.map