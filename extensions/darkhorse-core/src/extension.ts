import * as vscode from 'vscode';
import { WelcomePanel } from './WelcomePanel';
import { AuditLogger } from './AuditLogger';

let auditLogger: AuditLogger;

export function activate(context: vscode.ExtensionContext) {

  // Initialize audit logger
  auditLogger = new AuditLogger(context);
  auditLogger.log('SYSTEM', 'DarkHorse activated');

  // Enforce telemetry off — always
  const config = vscode.workspace.getConfiguration();
  config.update('telemetry.telemetryLevel', 'off', vscode.ConfigurationTarget.Global);
  config.update('darkhorse.telemetry.enabled', false, vscode.ConfigurationTarget.Global);

  // Show welcome panel on first install
  const hasShownWelcome = context.globalState.get<boolean>('darkhorse.welcomeShown');
  if (!hasShownWelcome) {
    WelcomePanel.show(context);
    context.globalState.update('darkhorse.welcomeShown', true);
  }

  // Register: Open Welcome command
  const welcomeCmd = vscode.commands.registerCommand('darkhorse.welcome', () => {
    WelcomePanel.show(context);
    auditLogger.log('COMMAND', 'darkhorse.welcome opened');
  });

  // Register: About command
  const aboutCmd = vscode.commands.registerCommand('darkhorse.about', () => {
    vscode.window.showInformationMessage(
      'DarkHorse v0.1.0 — SAP S/4HANA ABAP Development IDE | Deloitte Internal | Security-First'
    );
    auditLogger.log('COMMAND', 'darkhorse.about opened');
  });

  // Status bar item — always visible
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, 100
  );
  statusBar.text = '$(horse) DarkHorse';
  statusBar.tooltip = 'DarkHorse — SAP ABAP IDE | Click to open Welcome';
  statusBar.command = 'darkhorse.welcome';
  statusBar.show();

  context.subscriptions.push(welcomeCmd, aboutCmd, statusBar);

  console.log('DarkHorse: activated successfully');
}

export function deactivate() {
  if (auditLogger) {
    auditLogger.log('SYSTEM', 'DarkHorse deactivated');
  }
}