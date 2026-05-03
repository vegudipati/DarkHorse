/**
 * DarkHorse LLM Proxy — Ollama Adapter
 * 
 * Calls a locally running Ollama instance for air-gapped / offline deployments.
 * No API key required — Ollama runs on the developer's machine.
 * 
 * Typical use cases:
 *   - High-security client engagements where no internet access is permitted
 *   - Offline development environments
 *   - Cost-sensitive scenarios where Claude API costs are a concern
 * 
 * Recommended models (set via DARKHORSE_OLLAMA_MODEL env var):
 *   - codellama:34b     — Best ABAP quality, needs ~20GB VRAM
 *   - codellama:13b     — Good quality, needs ~8GB VRAM
 *   - deepseek-coder:33b — Strong alternative for code tasks
 *   - llama3:8b         — Fastest, lower quality, good for explain tasks
 * 
 * Note: Ollama response quality for ABAP is lower than Claude.
 * This adapter is a functional fallback, not the primary backend.
 */

'use strict';

import { ILLMAdapter, GenerateRequest, GenerateResponse } from '../types';
import { AbapSystemPrompt } from '../AbapSystemPrompt';

const REQUEST_TIMEOUT_MS = 120_000;  // Ollama is slower — 2 minute timeout

export class OllamaAdapter implements ILLMAdapter {

  constructor(
    private readonly baseUrl: string,      // e.g. 'http://127.0.0.1:11434'
    private readonly model: string,         // e.g. 'codellama:34b'
    private readonly systemPromptOverride?: string
  ) {}

  // ---------------------------------------------------------------------------
  // ILLMAdapter implementation
  // ---------------------------------------------------------------------------

  async generateCode(request: GenerateRequest): Promise<GenerateResponse> {
    const systemPrompt  = this.systemPromptOverride || AbapSystemPrompt.get('generate');
    const userMessage   = this.buildGenerateUserMessage(request);
    const fullPrompt    = `${systemPrompt}\n\n${userMessage}`;

    return this.callOllama(fullPrompt);
  }

  async reviewCode(code: string): Promise<GenerateResponse> {
    const systemPrompt = AbapSystemPrompt.get('review');
    const fullPrompt   = `${systemPrompt}\n\nReview the following ABAP code:\n\n${code}`;

    return this.callOllama(fullPrompt);
  }

  async explainCode(code: string): Promise<GenerateResponse> {
    const systemPrompt = AbapSystemPrompt.get('explain');
    const fullPrompt   = `${systemPrompt}\n\nExplain the following ABAP code:\n\n${code}`;

    return this.callOllama(fullPrompt);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private buildGenerateUserMessage(request: GenerateRequest): string {
    const parts: string[] = [];

    if (request.objectType) {
      parts.push(`Object type: ${request.objectType}`);
    }
    if (request.objectName) {
      parts.push(`Object name: ${request.objectName}`);
    }
    if (request.context && request.context.trim().length > 0) {
      parts.push(`Existing code context:\n${request.context}`);
    }
    parts.push(`Request: ${request.prompt}`);

    return parts.join('\n\n');
  }

  private async callOllama(prompt: string): Promise<GenerateResponse> {
    // Ollama /api/generate endpoint — non-streaming (stream: false)
    const body = {
      model:  this.model,
      prompt: prompt,
      stream: false,
      options: {
        temperature:  0.2,  // Low temperature for code generation
        num_predict: 4096   // Max tokens to generate
      }
    };

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  controller.signal
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Ollama request timed out after 120 seconds. The model may be loading.');
      }
      throw new Error(
        `Cannot reach Ollama at ${this.baseUrl}. ` +
        'Make sure Ollama is running: open a terminal and run "ollama serve".'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Ollama model "${this.model}" not found. ` +
          `Pull it first: run "ollama pull ${this.model}" in a terminal.`
        );
      }
      throw new Error(`Ollama returned HTTP ${response.status}.`);
    }

    let data: OllamaResponse;
    try {
      data = await response.json() as OllamaResponse;
    } catch {
      throw new Error('Ollama returned an unparseable response.');
    }

    if (!data.response) {
      throw new Error('Ollama returned an empty response.');
    }

    // Ollama doesn't return separate input/output token counts in /api/generate
    // Use eval_count (output tokens) as the best available approximation
    const tokensUsed = (data.prompt_eval_count || 0) + (data.eval_count || 0);

    return {
      code:       data.response,
      model:      data.model || this.model,
      tokensUsed: tokensUsed
    };
  }
}

// ---------------------------------------------------------------------------
// Ollama API response shape
// ---------------------------------------------------------------------------

interface OllamaResponse {
  model:              string;
  response:           string;
  done:               boolean;
  prompt_eval_count?: number;
  eval_count?:        number;
}
