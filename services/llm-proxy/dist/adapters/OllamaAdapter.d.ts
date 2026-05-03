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
import { ILLMAdapter, GenerateRequest, GenerateResponse } from '../types';
export declare class OllamaAdapter implements ILLMAdapter {
    private readonly baseUrl;
    private readonly model;
    private readonly systemPromptOverride?;
    constructor(baseUrl: string, // e.g. 'http://127.0.0.1:11434'
    model: string, // e.g. 'codellama:34b'
    systemPromptOverride?: string | undefined);
    generateCode(request: GenerateRequest): Promise<GenerateResponse>;
    reviewCode(code: string): Promise<GenerateResponse>;
    explainCode(code: string): Promise<GenerateResponse>;
    private buildGenerateUserMessage;
    private callOllama;
}
//# sourceMappingURL=OllamaAdapter.d.ts.map