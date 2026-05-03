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
exports.ConsentGate = void 0;
const vscode = __importStar(require("vscode"));
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
class ConsentGate {
    pending = new Map();
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Request consent for a write action.
     * Resolves to true if approved, false if rejected or timed out.
     * This is called by agent tools before any write operation.
     */
    async requestConsent(agentId, action) {
        return new Promise((resolve) => {
            const timeoutHandle = setTimeout(() => {
                const req = this.pending.get(action.actionId);
                if (req && req.status === 'pending') {
                    req.status = 'timed_out';
                    this.pending.delete(action.actionId);
                    resolve(false);
                    vscode.window.showWarningMessage(`DarkHorse Agent: Consent request for "${action.description}" timed out and was auto-rejected.`);
                }
            }, CONSENT_TIMEOUT_MS);
            const request = {
                actionId: action.actionId,
                agentId,
                action,
                status: 'pending',
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
    approve(actionId) {
        const request = this.pending.get(actionId);
        if (!request || request.status !== 'pending') {
            return;
        }
        clearTimeout(request.timeoutHandle);
        request.status = 'approved';
        this.pending.delete(actionId);
        request.resolve(true);
    }
    /**
     * Reject a pending consent request.
     * Called by ReportViewer when developer clicks "Reject".
     */
    reject(actionId) {
        const request = this.pending.get(actionId);
        if (!request || request.status !== 'pending') {
            return;
        }
        clearTimeout(request.timeoutHandle);
        request.status = 'rejected';
        this.pending.delete(actionId);
        request.resolve(false);
    }
    /**
     * Get all pending consent requests — shown in the Agent Dashboard.
     */
    getPending() {
        return Array.from(this.pending.values()).map(r => ({
            agentId: r.agentId,
            action: r.action,
            requestedAt: r.requestedAt
        }));
    }
    /**
     * Reject all pending requests for a specific agent.
     * Called when an agent is cancelled or times out.
     */
    rejectAll(agentId) {
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
    async showConsentPrompt(request) {
        const action = request.action;
        // Build a clear description of what the agent wants to do
        const detail = action.proposedCode
            ? `Object: ${action.objectName} (${action.objectType})\n\nProposed change:\n${action.proposedCode.slice(0, 200)}${action.proposedCode.length > 200 ? '…' : ''}`
            : `Object: ${action.objectName} (${action.objectType})`;
        const choice = await vscode.window.showInformationMessage(`DarkHorse Agent wants to: ${action.description}`, { modal: true, detail }, 'Approve', 'Reject');
        if (choice === 'Approve') {
            this.approve(request.actionId);
        }
        else {
            // Reject covers both 'Reject' click and dismissing the dialog
            this.reject(request.actionId);
        }
    }
}
exports.ConsentGate = ConsentGate;
//# sourceMappingURL=ConsentGate.js.map