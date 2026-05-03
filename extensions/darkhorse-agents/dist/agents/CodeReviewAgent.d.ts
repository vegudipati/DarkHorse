/**
 * DarkHorse Agent — Code Review Agent
 *
 * Reads ABAP source code (from config.sapContext or via proxy),
 * calls the LLM proxy /review endpoint, and produces a structured report.
 *
 * This agent is READ-ONLY by default.
 * It never writes to SAP — it only produces a report.
 * Applying suggested fixes requires developer consent via ConsentGate.
 *
 * Output: AgentReport with findings array and optional patches.
 */
import { AgentConfig, AgentReport } from '../AgentOrchestrator';
export declare class CodeReviewAgent {
    private readonly config;
    constructor(config: AgentConfig);
    run(): Promise<AgentReport>;
    private getSourceCode;
    private callReviewEndpoint;
    private parseReviewJson;
    private mapFindings;
    private normalizeSeverity;
    private buildPatches;
}
