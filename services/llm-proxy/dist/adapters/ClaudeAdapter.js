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
            // temperature=0 makes Claude greedy-decode: same prompt -> same output
            // (within the ~99% determinism Claude provides at the API level). This
            // is the single biggest lever for end-to-end pipeline reproducibility.
            // Sprint 3 follow-up after the user reported run-to-run variance in
            // ABAP object counts (3 vs 5 vs 6) for the same business requirement.
            temperature: 0,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage }
            ]
        };
        // Retry policy — up to 3 attempts total with 1s, 3s backoff between them.
        // Covers transient failures we see in corporate environments: fetch died
        // mid-flight (ECONNRESET / ECONNREFUSED / ETIMEDOUT), 5xx from Anthropic,
        // 529 overload. Auth (401) and rate-limit (429) and bad-input (4xx) are
        // NOT retried — they will keep failing the same way.
        const MAX_ATTEMPTS = 3;
        const BACKOFF_MS = [1_000, 3_000]; // length = MAX_ATTEMPTS - 1
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                return await this.attemptCallClaude(body);
            }
            catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                lastError = error;
                if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
                    throw error;
                }
                const waitMs = BACKOFF_MS[attempt - 1] ?? 3_000;
                process.stderr.write(`[DarkHorse Proxy] Claude call attempt ${attempt}/${MAX_ATTEMPTS} failed (${error.message}). ` +
                    `Retrying in ${waitMs}ms.\n`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
        // Unreachable, but TypeScript needs an explicit throw for typing.
        throw lastError ?? new Error('Claude API call failed after retries.');
    }
    async attemptCallClaude(body) {
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
                throw new Error(`Claude API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`);
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
            else if (status === 529) {
                throw new Error(`529 Claude API overloaded. Anthropic is rate-throttling.`);
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
// ---------------------------------------------------------------------------
// Retry classification — returns true for errors that are likely transient.
// Keep this conservative: we never retry auth, rate-limit, or programmer-error
// cases because those will fail the same way next time and waste cost.
// ---------------------------------------------------------------------------
function isRetryable(err) {
    const m = err.message.toLowerCase();
    // Network-layer failures (fetch died, TCP / TLS issues, DNS hiccups)
    if (m.includes('network error calling claude api'))
        return true;
    if (m.includes('econnreset'))
        return true;
    if (m.includes('econnrefused'))
        return true;
    if (m.includes('etimedout'))
        return true;
    if (m.includes('eai_again'))
        return true;
    if (m.includes('socket hang up'))
        return true;
    // Our own timeout wrapper
    if (m.includes('timed out after'))
        return true;
    // Anthropic transient HTTP codes
    if (m.includes('server error (500'))
        return true;
    if (m.includes('server error (502'))
        return true;
    if (m.includes('server error (503'))
        return true;
    if (m.includes('server error (504'))
        return true;
    if (m.includes('529 claude api overloaded'))
        return true;
    // 401 / 429 / 4xx (except 408/429 — but we deliberately skip even 429 since
    // Anthropic asks callers to back off, and the safer default is to surface
    // the error so the developer adjusts behaviour rather than burning quota).
    return false;
}
//# sourceMappingURL=ClaudeAdapter.js.map