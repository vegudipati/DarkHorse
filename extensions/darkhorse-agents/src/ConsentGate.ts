/**
 * DarkHorse Agent Extension — Consent Gate
 *
 * Intercepts every write tool call from an agent and requires
 * explicit developer confirmation before proceeding.
 *
 * This is NOT bypassable:
 *   - Write tools return 'awaiting_consent' until approved
 *   - Approval is per-action, not per-agent (each write needs its own consent)
 *   - Rejected actions are logged and the agent is notified
 *   - Timeout on consent: if developer doesn't respond in 5 minutes,
 *     the action is auto-rejected
 *
 * Security principle: agents are assistants, not autonomous actors.
 * A human must be in the loop for every state change in SAP.
 */

'use strict';

import * as vscode from 'vscode';
import { ConsentAction } from './AgentOrchestrator';

type ConsentStatus = 'pending' | 'approved' | 'rejected' | 'timed_out';

interface ConsentRequest {
  actionId:    string;
  agentId:     string;
  action:      ConsentAction;
  status:      ConsentStatus;
  requestedAt: Date;
  resolve:     (approved: boolean) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes

export class ConsentGate {

  private pending = new Map<string, ConsentRequest>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Request consent for a write action.
   * Resolves to true if approved, false if rejected or timed out.
   * This is called by agent tools before any write operation.
   */
  public async requestConsent(agentId: string, action: ConsentAction): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        const req = this.pending.get(action.actionId);
        if (req && req.status === 'pending') {
          req.status = 'timed_out';
          this.pending.delete(action.actionId);
          resolve(false);
          vscode.window.showWarningMessage(
            `DarkHorse Agent: Consent request for "${action.description}" timed out and was auto-rejected.`
          );
        }
      }, CONSENT_TIMEOUT_MS);

      const request: ConsentRequest = {
        actionId:    action.actionId,
        agentId,
        action,
        status:      'pending',
        requestedAt: new Date(),
        resolve,
        timeoutHandle
      };

      this.pending.set(action.actionId, request);

      // Surface the consent request to the developer
      this.showConsentPrompt(request);
    });
  }

  /**
   * Approve a pending consent request programmatically.
   * Called by ReportViewer when developer clicks "Apply".
   */
  public approve(actionId: string): void {
    const request = this.pending.get(actionId);
    if (!request || request.status !== 'pending') { return; }

    clearTimeout(request.timeoutHandle);
    request.status = 'approved';
    this.pending.delete(actionId);
    request.resolve(true);
  }

  /**
   * Reject a pending consent request.
   * Called by ReportViewer when developer clicks "Reject".
   */
  public reject(actionId: string): void {
    const request = this.pending.get(actionId);
    if (!request || request.status !== 'pending') { return; }

    clearTimeout(request.timeoutHandle);
    request.status = 'rejected';
    this.pending.delete(actionId);
    request.resolve(false);
  }

  /**
   * Get all pending consent requests — shown in the Agent Dashboard.
   */
  public getPending(): Array<{ agentId: string; action: ConsentAction; requestedAt: Date }> {
    return Array.from(this.pending.values()).map(r => ({
      agentId:     r.agentId,
      action:      r.action,
      requestedAt: r.requestedAt
    }));
  }

  /**
   * Reject all pending requests for a specific agent.
   * Called when an agent is cancelled or times out.
   */
  public rejectAll(agentId: string): void {
    for (const [actionId, request] of this.pending.entries()) {
      if (request.agentId === agentId) {
        clearTimeout(request.timeoutHandle);
        request.status = 'rejected';
        this.pending.delete(actionId);
        request.resolve(false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async showConsentPrompt(request: ConsentRequest): Promise<void> {
    const action = request.action;

    // Build a clear description of what the agent wants to do
    const detail = action.proposedCode
      ? `Object: ${action.objectName} (${action.objectType})\n\nProposed change:\n${action.proposedCode.slice(0, 200)}${action.proposedCode.length > 200 ? '…' : ''}`
      : `Object: ${action.objectName} (${action.objectType})`;

    const choice = await vscode.window.showInformationMessage(
      `DarkHorse Agent wants to: ${action.description}`,
      { modal: true, detail },
      'Approve',
      'Reject'
    );

    if (choice === 'Approve') {
      this.approve(request.actionId);
    } else {
      // Reject covers both 'Reject' click and dismissing the dialog
      this.reject(request.actionId);
    }
  }
}
