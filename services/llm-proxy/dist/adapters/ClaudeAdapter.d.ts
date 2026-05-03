/**
 * DarkHorse LLM Proxy — Claude Adapter
 *
 * Calls the Anthropic Claude API for code generation, review, and explanation.
 * Uses Node.js native fetch (available Node 18+, required Node 24 per DarkHorse spec).
 * No Anthropic SDK dependency — raw HTTP keeps the proxy dependency footprint minimal.
 *
 * Security:
 *   - API key received via constructor, sourced from process.env at startup
 *   - Key is NEVER logged, never included in error messages surfaced to the developer
 *   - All requests go directly to api.anthropic.com — no intermediate routing
 *   - Response streaming not used in MVP-5 — full response before returning to caller
 *     (Streaming added in CPI-1 for better UX on long generations)
 */
import { ILLMAdapter, GenerateRequest, GenerateResponse } from '../types';
export declare class ClaudeAdapter implements ILLMAdapter {
    private readonly apiKey;
    private readonly systemPromptOverride?;
    constructor(apiKey: string, systemPromptOverride?: string | undefined);
    generateCode(request: GenerateRequest): Promise<GenerateResponse>;
    reviewCode(code: string): Promise<GenerateResponse>;
    explainCode(code: string): Promise<GenerateResponse>;
    private buildGenerateUserMessage;
    private callClaude;
}
//# sourceMappingURL=ClaudeAdapter.d.ts.map