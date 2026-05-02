"use strict";
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
const WelcomePanel_1 = require("./WelcomePanel");
const AuditLogger_1 = require("./AuditLogger");
let auditLogger;
function activate(context) {
    // Initialize audit logger
    auditLogger = new AuditLogger_1.AuditLogger(context);
    auditLogger.log('SYSTEM', 'DarkHorse activated');
    // Enforce telemetry off — always
    const config = vscode.workspace.getConfiguration();
    config.update('telemetry.telemetryLevel', 'off', vscode.ConfigurationTarget.Global);
    config.update('darkhorse.telemetry.enabled', false, vscode.ConfigurationTarget.Global);
    // Show welcome panel on first install
    const hasShownWelcome = context.globalState.get('darkhorse.welcomeShown');
    if (!hasShownWelcome) {
        WelcomePanel_1.WelcomePanel.show(context);
        context.globalState.update('darkhorse.welcomeShown', true);
    }
    // Register: Open Welcome command
    const welcomeCmd = vscode.commands.registerCommand('darkhorse.welcome', () => {
        WelcomePanel_1.WelcomePanel.show(context);
        auditLogger.log('COMMAND', 'darkhorse.welcome opened');
    });
    // Register: About command
    const aboutCmd = vscode.commands.registerCommand('darkhorse.about', () => {
        vscode.window.showInformationMessage('DarkHorse v0.1.0 — SAP S/4HANA ABAP Development IDE | Deloitte Internal | Security-First');
        auditLogger.log('COMMAND', 'darkhorse.about opened');
    });
    // Status bar item — always visible
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.text = '$(horse) DarkHorse';
    statusBar.tooltip = 'DarkHorse — SAP ABAP IDE | Click to open Welcome';
    statusBar.command = 'darkhorse.welcome';
    statusBar.show();
    context.subscriptions.push(welcomeCmd, aboutCmd, statusBar);
    console.log('DarkHorse: activated successfully');
}
function deactivate() {
    if (auditLogger) {
        auditLogger.log('SYSTEM', 'DarkHorse deactivated');
    }
}
//# sourceMappingURL=extension.js.map