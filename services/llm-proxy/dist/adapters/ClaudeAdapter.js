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
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeAdapter = void 0;
const AbapSystemPrompt_1 = require("../AbapSystemPrompt");
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8000;
const API_VERSION = '2023-06-01';
// Timeout for API calls: 60 seconds
// Long enough for complex code generation, short enough to avoid hanging the proxy
const REQUEST_TIMEOUT_MS = 120_000;
class ClaudeAdapter {
    apiKey;
    systemPromptOverride;
    constructor(apiKey, systemPromptOverride // used for testing
    ) {
        this.apiKey = apiKey;
        this.systemPromptOverride = systemPromptOverride;
    }
    // ---------------------------------------------------------------------------
    // ILLMAdapter implementation
    // ---------------------------------------------------------------------------
    async generateCode(request) {
        const userMessage = this.buildGenerateUserMessage(request);
        const systemPrompt = this.systemPromptOverride || AbapSystemPrompt_1.AbapSystemPrompt.get('generate');
        return this.callClaude(systemPrompt, userMessage);
    }
    async reviewCode(code) {
        const userMessage = `Review the following ABAP code:\n\n${code}`;
        const systemPrompt = AbapSystemPrompt_1.AbapSystemPrompt.get('review');
        return this.callClaude(systemPrompt, userMessage);
    }
    async explainCode(code) {
        const userMessage = `Explain the following ABAP code:\n\n${code}`;
        const systemPrompt = AbapSystemPrompt_1.AbapSystemPrompt.get('explain');
        return this.callClaude(systemPrompt, userMessage);
    }
    // ---------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------
    buildGenerateUserMessage(request) {
        const parts = [];
        // Object type and name give the model context about what structure to generate
        if (request.objectType) {
            parts.push(`Object type: ${request.objectType}`);
        }
        if (request.objectName) {
            parts.push(`Object name: ${request.objectName}`);
        }
        // Surrounding code from the active editor — model uses this to match style
        if (request.context && request.context.trim().length > 0) {
            parts.push(`Existing code context:\n${request.context}`);
        }
        // The developer's actual prompt — always last so it takes precedence
        parts.push(`Request: ${request.prompt}`);
        return parts.join('\n\n');
    }
    async callClaude(systemPrompt, userMessage) {
        const body = {
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage }
            ]
        };
        // AbortController for request timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(CLAUDE_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': API_VERSION
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        }
        catch (err) {
            clearTimeout(timeoutId);
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error('Claude API request timed out after 60 seconds.');
            }
            throw new Error(`Network error calling Claude API: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            clearTimeout(timeoutId);
        }
        if (!response.ok) {
            // Read body for error detail but do NOT log it — may contain diagnostic info
            // that reveals something about the account. Surface only the status code.
            const status = response.status;
            if (status === 401) {
                throw new Error(`401 Unauthorized`);
            }
            else if (status === 429) {
                throw new Error(`429 Rate limit exceeded by Claude API. Try again shortly.`);
            }
            else if (status >= 500) {
                throw new Error(`Claude API server error (${status}). Anthropic may be experiencing issues.`);
            }
            else {
                throw new Error(`Claude API returned HTTP ${status}.`);
            }
        }
        let data;
        try {
            data = await response.json();
        }
        catch {
            throw new Error('Claude API returned an unparseable response.');
        }
        // Extract the text content from the first content block
        const textBlock = data.content?.find(b => b.type === 'text');
        if (!textBlock || !textBlock.text) {
            throw new Error('Claude API returned a response with no text content.');
        }
        return {
            code: textBlock.text,
            model: data.model || MODEL,
            tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        };
    }
}
exports.ClaudeAdapter = ClaudeAdapter;
//# sourceMappingURL=ClaudeAdapter.js.map