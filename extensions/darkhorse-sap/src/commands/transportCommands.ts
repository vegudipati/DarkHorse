import * as vscode from 'vscode';
import { TransportClient } from '../transport/TransportClient';
import { TransportProvider } from '../transport/TransportProvider';
import { TransportItem } from '../transport/TransportItem';
import { CreateTransportPanel } from '../transport/CreateTransportPanel';
import { SapObjectItem } from '../explorer/SapObjectItem';

export function registerTransportCommands(
  context: vscode.ExtensionContext,
  getTransportClient: () => TransportClient | undefined,
  transportProvider: TransportProvider
): void {

  // Command: Create Transport
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.transport.create', async () => {
      const client = getTransportClient();
      if (!client) {
        vscode.window.showWarningMessage('DarkHorse: Connect to SAP first.');
        return;
      }

      const data = await CreateTransportPanel.show();
      if (!data) { return; }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Creating transport...',
        cancellable: false
      }, async () => {
        try {
          const transportId = await client.createTransport(data.description, data.type);
          transportProvider.refresh();
          vscode.window.showInformationMessage(
            `DarkHorse: Transport ${transportId} created successfully.`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to create transport: ${err.message}`);
        }
      });
    })
  );

  // Command: Refresh Transports
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.transport.refresh', () => {
      transportProvider.refresh();
    })
  );

  // Command: Assign Object to Transport
  context.subscriptions.push(
    vscode.commands.registerCommand('darkhorse.transport.assignObject',
      async (item: SapObjectItem) => {
        const client = getTransportClient();
        if (!client) {
          vscode.window.showWarningMessage('DarkHorse: Connect to SAP first.');
          return;
        }

        // Get list of open transports for picker
        let transports;
        try {
          transports = await client.listTransports();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Could not load transports: ${err.message}`);
          return;
        }

        const openTransports = transports.filter(t => t.status === 'D');
        if (openTransports.length === 0) {
          const action = await vscode.window.showWarningMessage(
            'No open transports found. Create one first.',
            'Create Transport'
          );
          if (action === 'Create Transport') {
            await vscode.commands.executeCommand('darkhorse.transport.create');
          }
          return;
        }

        const picked = await vscode.window.showQuickPick(
          openTransports.map(t => ({
            label: t.id,
            description: t.description,
            transport: t
          })),
          { placeHolder: `Assign ${item.objectName} to transport` }
        );
        if (!picked) { return; }

        try {
          await client.assignObjectToTransport(
            picked.transport.id,
            item.objectType,
            item.objectName,
            item.uri
          );
          transportProvider.refresh();
          vscode.window.showInformationMessage(
            `DarkHorse: ${item.objectName} assigned to ${picked.transport.id}`
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to assign object: ${err.message}`);
        }
      }
    )
  );
}