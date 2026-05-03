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
import { ConsentAction } from './AgentOrchestrator';
export declare class ConsentGate {
    private pending;
    /**
     * Request consent for a write action.
     * Resolves to true if approved, false if rejected or timed out.
     * This is called by agent tools before any write operation.
     */
    requestConsent(agentId: string, action: ConsentAction): Promise<boolean>;
    /**
     * Approve a pending consent request programmatically.
     * Called by ReportViewer when developer clicks "Apply".
     */
    approve(actionId: string): void;
    /**
     * Reject a pending consent request.
     * Called by ReportViewer when developer clicks "Reject".
     */
    reject(actionId: string): void;
    /**
     * Get all pending consent requests — shown in the Agent Dashboard.
     */
    getPending(): Array<{
        agentId: string;
        action: ConsentAction;
        requestedAt: Date;
    }>;
    /**
     * Reject all pending requests for a specific agent.
     * Called when an agent is cancelled or times out.
     */
    rejectAll(agentId: string): void;
    private showConsentPrompt;
}
