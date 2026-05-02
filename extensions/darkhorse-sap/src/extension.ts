import * as vscode from 'vscode';
import { AdtClient } from './adt/AdtClient';
import { AdtSession } from './adt/AdtSession';
import { CredentialVault } from './credentials/CredentialVault';
import { LandscapeManager, SapSystem } from './landscape/LandscapeManager';
import { SapExplorerProvider } from './explorer/SapExplorerProvider';
import { AbapDocumentProvider } from './providers/AbapDocumentProvider';
import { SapObjectItem } from './explorer/SapObjectItem';
import { AddSystemPanel } from './landscape/AddSystemPanel';
import { TransportClient } from './transport/TransportClient';
import { TransportProvider } from './transport/TransportProvider';
import { registerTransportCommands } from './commands/transportCommands';

let session: AdtSession = new AdtSession();
let client: AdtClient | undefined;
let explorerProvider: SapExplorerProvider;
let documentProvider: AbapDocumentProvider;
let transportClient: TransportClient | undefined;
let transportProvider: TransportProvider;

export async function activate(context: vscode.ExtensionContext) {

  // Initialize credential vault with VS Code secret storage
  CredentialVault.initialize(context.secrets);

  // Initialize providers
  explorerProvider = new SapExplorerProvider();
  documentProvider = new AbapDocumentProvider();

  // Initialize transport provider
  transportProvider = new TransportProvider();
  vscode.window.registerTreeDataProvider('darkhorse.transportView', transportProvider);

  // Register transport commands
  registerTransportCommands(
    context,
    () => transportClient,
    transportProvider
  );

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
      transportClient = undefined;
      transportProvider.clearClient();
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
  const data = await AddSystemPanel.show();
  if (!data) { return; }

  const system: SapSystem = {
    id: data.id,
    name: data.name,
    host: data.host,
    client: data.client,
    username: data.username,
    language: data.language
  };

  await LandscapeManager.addSystem(system);
  await CredentialVault.store(data.id, data.username, data.password);
  vscode.window.showInformationMessage(
    `DarkHorse: SAP System "${data.name}" (${data.id}) added successfully.`
  );
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
      transportClient = new TransportClient(system, session, client);
      transportProvider.setClient(transportClient);
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