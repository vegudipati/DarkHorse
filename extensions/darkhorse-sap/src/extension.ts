import * as vscode from 'vscode';
import { AdtClient } from './adt/AdtClient';
import { AdtSession } from './adt/AdtSession';
import { CredentialVault } from './credentials/CredentialVault';
import { LandscapeManager, SapSystem } from './landscape/LandscapeManager';
import { SapExplorerProvider } from './explorer/SapExplorerProvider';
import { AbapDocumentProvider } from './providers/AbapDocumentProvider';
import { SapObjectItem } from './explorer/SapObjectItem';

let session: AdtSession = new AdtSession();
let client: AdtClient | undefined;
let explorerProvider: SapExplorerProvider;
let documentProvider: AbapDocumentProvider;

export async function activate(context: vscode.ExtensionContext) {

  // Initialize providers
  explorerProvider = new SapExplorerProvider();
  documentProvider = new AbapDocumentProvider();

  // Register SAP Explorer tree view
  vscode.window.registerTreeDataProvider('darkhorse.sapExplorer', explorerProvider);

  // Register ABAP virtual document provider
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      AbapDocumentProvider.SCHEME, documentProvider
    )
  );

  // Command: Add SAP System
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.addSystem', async () => {
      await addSystemWizard();
    })
  );

  // Command: Connect to System
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.connect', async () => {
      await connectToSystem();
    })
  );

  // Command: Disconnect
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.disconnect', () => {
      session.clear();
      client = undefined;
      documentProvider.clearClient();
      explorerProvider.clearConnection();
      vscode.window.showInformationMessage('DarkHorse: Disconnected from SAP.');
    })
  );

  // Command: Refresh Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.refreshExplorer', () => {
      explorerProvider.refresh();
    })
  );

  // Command: Open ABAP Object
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.openObject', async (item: SapObjectItem) => {
      await openAbapObject(item);
    })
  );

  // Command: Remove System
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.sap.removeSystem', async () => {
      await removeSystem();
    })
  );

  console.log('DarkHorse SAP Connector: activated');
}

async function addSystemWizard(): Promise<void> {
  const id = await vscode.window.showInputBox({
    prompt: 'System ID (short name, e.g. S4D)',
    placeHolder: 'S4D',
    validateInput: v => v && v.length > 0 ? null : 'System ID is required'
  });
  if (!id) { return; }

  const name = await vscode.window.showInputBox({
    prompt: 'Display Name (e.g. S/4HANA DEV)',
    placeHolder: 'S/4HANA DEV'
  });
  if (!name) { return; }

  const host = await vscode.window.showInputBox({
    prompt: 'SAP Host URL (e.g. https://sap-dev.company.com:44300)',
    placeHolder: 'https://your-sap-host:44300',
    validateInput: v => v && v.startsWith('http') ? null : 'Must start with https://'
  });
  if (!host) { return; }

  const client = await vscode.window.showInputBox({
    prompt: 'SAP Client (e.g. 100)',
    placeHolder: '100',
    value: '100'
  });
  if (!client) { return; }

  const username = await vscode.window.showInputBox({
    prompt: 'SAP Username',
    placeHolder: 'your-sap-user'
  });
  if (!username) { return; }

  const password = await vscode.window.showInputBox({
    prompt: 'SAP Password (stored in Windows Credential Manager)',
    password: true
  });
  if (!password) { return; }

  const system: SapSystem = { id, name, host, client, username, language: 'EN' };
  await LandscapeManager.addSystem(system);
  await CredentialVault.store(id, username, password);

  vscode.window.showInformationMessage(`DarkHorse: SAP System "${name}" added successfully.`);
}

async function connectToSystem(): Promise<void> {
  const systems = LandscapeManager.getSystems();

  if (systems.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'No SAP systems configured.',
      'Add System'
    );
    if (action === 'Add System') {
      await addSystemWizard();
    }
    return;
  }

  const picked = await vscode.window.showQuickPick(
    systems.map(s => ({ label: s.id, description: s.name, detail: s.host, system: s })),
    { placeHolder: 'Select SAP system to connect' }
  );
  if (!picked) { return; }

  const system = picked.system;
  const credentials = await CredentialVault.retrieve(system.id, system.username);

  if (!credentials) {
    vscode.window.showErrorMessage(`No credentials found for ${system.id}. Please re-add the system.`);
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Connecting to ${system.name}...`,
    cancellable: false
  }, async () => {
    try {
      session = new AdtSession();
      client = new AdtClient(system, session);
      await client.authenticate(credentials.password);
      await LandscapeManager.setActiveSystem(system.id);
      documentProvider.setClient(client);
      explorerProvider.setConnection(client, session, system.id);
      vscode.window.showInformationMessage(
        `DarkHorse: Connected to ${system.name} (${system.id}) as ${system.username}`
      );
    } catch (err: any) {
      session.clear();
      client = undefined;
      vscode.window.showErrorMessage(`Connection failed: ${err.message}`);
    }
  });
}

async function openAbapObject(item: SapObjectItem): Promise<void> {
  const uri = AbapDocumentProvider.buildUri(item.systemId, item.objectName);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function removeSystem(): Promise<void> {
  const systems = LandscapeManager.getSystems();
  if (systems.length === 0) {
    vscode.window.showInformationMessage('No SAP systems configured.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    systems.map(s => ({ label: s.id, description: s.name, system: s })),
    { placeHolder: 'Select system to remove' }
  );
  if (!picked) { return; }
  await LandscapeManager.removeSystem(picked.system.id);
  await CredentialVault.delete(picked.system.id, picked.system.username);
  vscode.window.showInformationMessage(`DarkHorse: System "${picked.label}" removed.`);
}

export function deactivate() {
  session.clear();
}