/**
 * DarkHorse LLM Proxy Service
 *
 * Runs as a standalone Node.js child process spawned by the darkhorse-ai extension.
 * Binds to 127.0.0.1 ONLY — never accessible from the network.
 *
 * Security constraints (MVP-5):
 *   - API key received via process.env.DARKHORSE_CLAUDE_API_KEY at spawn time
 *   - Key never written to disk or logged
 *   - All outbound payloads pass through PII scrubber before forwarding
 *   - Rate limiting: global token bucket, single counter
 *   - Audit log: append-only .jsonl flat file (upgrades to SQLite in CPI-1)
 *
 * Known upgrade points for CPI-1:
 *   - Replace env-var API key delivery with IPC callback to parent extension
 *   - Replace token bucket with per-user rate limiting
 *   - Replace .jsonl audit log with SQLite (better-sqlite3 once native modules resolved)
 *   - Replace local proxy with Azure API Management / AWS API Gateway
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const PiiScrubber_1 = require("./PiiScrubber");
const RateLimiter_1 = require("./RateLimiter");
const ClaudeAdapter_1 = require("./adapters/ClaudeAdapter");
const OllamaAdapter_1 = require("./adapters/OllamaAdapter");
const AbapSystemPrompt_1 = require("./AbapSystemPrompt");
const AuditLogger_1 = require("./AuditLogger");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = parseInt(process.env.DARKHORSE_PROXY_PORT || '47291', 10);
const API_KEY = process.env.DARKHORSE_CLAUDE_API_KEY || '';
const BACKEND = (process.env.DARKHORSE_LLM_BACKEND || 'claude');
// Audit log written to user's home dir so it survives restarts
const AUDIT_LOG_PATH = path.join(process.env.DARKHORSE_AUDIT_LOG_DIR || os.homedir(), '.darkhorse', 'llm-audit.jsonl');
// Rate limit: 20 requests per minute, bucket refills continuously
const RATE_LIMIT_MAX_TOKENS = 20;
const RATE_LIMIT_REFILL_RATE = 20 / 60; // tokens per second
// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------
function validateEnvironment() {
    if (BACKEND === 'claude' && !API_KEY) {
        // Write to stderr — parent extension reads stderr for error detection
        process.stderr.write('[DarkHorse Proxy] FATAL: DARKHORSE_CLAUDE_API_KEY is not set. ' +
            'Store your API key via DarkHorse Settings before using AI features.\n');
        process.exit(1);
    }
    if (isNaN(PROXY_PORT) || PROXY_PORT < 1024 || PROXY_PORT > 65535) {
        process.stderr.write(`[DarkHorse Proxy] FATAL: Invalid port ${PROXY_PORT}. Must be 1024-65535.\n`);
        process.exit(1);
    }
}
// ---------------------------------------------------------------------------
// Audit log directory bootstrap
// ---------------------------------------------------------------------------
function ensureAuditLogDir() {
    const dir = path.dirname(AUDIT_LOG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
// ---------------------------------------------------------------------------
// Build Express app
// ---------------------------------------------------------------------------
function buildApp(adapter, scrubber, rateLimiter, auditLogger) {
    const app = express();
    app.use(express.json({ limit: '512kb' }));
    // ------------------------------------------------------------------
    // Health check — parent extension polls this to confirm proxy is up
    // ------------------------------------------------------------------
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            backend: BACKEND,
            pid: process.pid,
            uptime: process.uptime()
        });
    });
    // ------------------------------------------------------------------
    // POST /generate  — main code generation endpoint
    //
    // Request body (GenerateRequest):
    //   {
    //     prompt:      string   — developer's natural language prompt
    //     context?:    string   — surrounding ABAP code from active editor
    //     objectType?: string   — 'PROG' | 'CLAS' | 'FUGR' | 'TABL' etc.
    //     objectName?: string   — SAP object name (will be scrubbed)
    //     sessionId?:  string   — opaque ID for correlating audit entries
    //   }
    //
    // Response body (GenerateResponse):
    //   {
    //     code:         string   — generated ABAP code block
    //     explanation?: string   — optional plain-text explanation
    //     model:        string   — model name used
    //     tokensUsed:   number
    //   }
    // ------------------------------------------------------------------
    app.post('/generate', async (req, res) => {
        const startMs = Date.now();
        // 1. Rate limit check — checked before any processing to fail fast
        if (!rateLimiter.tryConsume()) {
            auditLogger.log({
                event: 'rate_limit_exceeded',
                sessionId: req.body?.sessionId,
                outcome: 'blocked'
            });
            res.status(429).json({
                error: 'Rate limit exceeded. Please wait a moment before sending another request.',
                retryAfterSeconds: rateLimiter.secondsUntilNextToken()
            });
            return;
        }
        // 2. Basic request validation
        const body = req.body;
        if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
            res.status(400).json({ error: 'prompt is required and must be a non-empty string.' });
            return;
        }
        if (body.prompt.length > 8000) {
            res.status(400).json({ error: 'prompt exceeds maximum length of 8000 characters.' });
            return;
        }
        // 3. PII scrubbing — strip SAP system IDs, client numbers, hostnames
        //    from BOTH the prompt and the context before they leave this machine
        const cleanPrompt = scrubber.scrub(body.prompt);
        const cleanContext = body.context ? scrubber.scrub(body.context) : undefined;
        // 4. Build the full request to forward to the LLM adapter
        const generateRequest = {
            prompt: cleanPrompt,
            context: cleanContext,
            objectType: body.objectType,
            objectName: body.objectName ? scrubber.scrub(body.objectName) : undefined,
            sessionId: body.sessionId
        };
        // 5. Call the adapter (Claude or Ollama)
        let response;
        try {
            response = await adapter.generateCode(generateRequest);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            auditLogger.log({
                event: 'generate_error',
                sessionId: body.sessionId,
                errorMessage: message,
                durationMs: Date.now() - startMs,
                outcome: 'error'
            });
            // Surface a clean error — never leak the raw upstream message (may contain key info)
            const isAuthError = message.toLowerCase().includes('401') ||
                message.toLowerCase().includes('unauthorized') ||
                message.toLowerCase().includes('api key');
            if (isAuthError) {
                res.status(502).json({
                    error: 'AI backend authentication failed. Check your API key in DarkHorse Settings.'
                });
            }
            else {
                res.status(502).json({
                    error: 'AI backend returned an error. Check the DarkHorse proxy log for details.'
                });
            }
            return;
        }
        // 6. Audit log — record prompt hash (not raw prompt), token count, duration
        //    We hash the prompt so we can correlate entries without storing content
        const promptHash = hashString(body.prompt);
        auditLogger.log({
            event: 'generate_success',
            sessionId: body.sessionId,
            promptHash,
            model: response.model,
            tokensUsed: response.tokensUsed,
            durationMs: Date.now() - startMs,
            outcome: 'success'
        });
        res.json(response);
    });
    // ------------------------------------------------------------------
    // POST /review  — code review endpoint
    //
    // Lighter-weight than /generate — takes ABAP code, returns review report
    // as structured JSON (findings array). Used by MVP-7 CodeReviewAgent.
    // ------------------------------------------------------------------
    app.post('/review', async (req, res) => {
        const startMs = Date.now();
        if (!rateLimiter.tryConsume()) {
            res.status(429).json({ error: 'Rate limit exceeded.' });
            return;
        }
        const body = req.body;
        if (!body.code || typeof body.code !== 'string') {
            res.status(400).json({ error: 'code is required.' });
            return;
        }
        const cleanCode = scrubber.scrub(body.code);
        let response;
        try {
            response = await adapter.reviewCode(cleanCode);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            auditLogger.log({
                event: 'review_error',
                sessionId: body.sessionId,
                errorMessage: message,
                durationMs: Date.now() - startMs,
                outcome: 'error'
            });
            res.status(502).json({ error: 'AI backend returned an error during code review.' });
            return;
        }
        auditLogger.log({
            event: 'review_success',
            sessionId: body.sessionId,
            model: response.model,
            tokensUsed: response.tokensUsed,
            durationMs: Date.now() - startMs,
            outcome: 'success'
        });
        res.json(response);
    });
    // ------------------------------------------------------------------
    // POST /explain  — explain ABAP code in plain English
    // ------------------------------------------------------------------
    app.post('/explain', async (req, res) => {
        const startMs = Date.now();
        if (!rateLimiter.tryConsume()) {
            res.status(429).json({ error: 'Rate limit exceeded.' });
            return;
        }
        const body = req.body;
        if (!body.code || typeof body.code !== 'string') {
            res.status(400).json({ error: 'code is required.' });
            return;
        }
        const cleanCode = scrubber.scrub(body.code);
        let response;
        try {
            response = await adapter.explainCode(cleanCode);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            auditLogger.log({
                event: 'explain_error',
                sessionId: body.sessionId,
                errorMessage: message,
                durationMs: Date.now() - startMs,
                outcome: 'error'
            });
            res.status(502).json({ error: 'AI backend returned an error during code explanation.' });
            return;
        }
        auditLogger.log({
            event: 'explain_success',
            sessionId: body.sessionId,
            model: response.model,
            tokensUsed: response.tokensUsed,
            durationMs: Date.now() - startMs,
            outcome: 'success'
        });
        res.json(response);
    });
    // ------------------------------------------------------------------
    // Catch-all 404
    // ------------------------------------------------------------------
    app.use((_req, res) => {
        res.status(404).json({ error: 'Unknown proxy endpoint.' });
    });
    // ------------------------------------------------------------------
    // Global error handler — last-resort, should not normally be reached
    // ------------------------------------------------------------------
    app.use((err, _req, res, _next) => {
        process.stderr.write(`[DarkHorse Proxy] Unhandled error: ${err.message}\n`);
        res.status(500).json({ error: 'Internal proxy error.' });
    });
    return app;
}
// ---------------------------------------------------------------------------
// Simple non-cryptographic string hash for audit log prompt correlation.
// We deliberately do NOT use crypto.createHash here — we want something that
// produces a stable short identifier, not a security hash. The purpose is
// purely to let a developer correlate audit entries without storing content.
// ---------------------------------------------------------------------------
function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function setupShutdownHandlers(server, auditLogger) {
    const shutdown = (signal) => {
        process.stdout.write(`[DarkHorse Proxy] Received ${signal}. Shutting down.\n`);
        auditLogger.log({ event: 'proxy_stop', signal, outcome: 'shutdown' });
        server.close(() => {
            process.stdout.write('[DarkHorse Proxy] Server closed. Exiting.\n');
            process.exit(0);
        });
        // Force exit after 5 s if connections are hanging
        setTimeout(() => {
            process.stderr.write('[DarkHorse Proxy] Forced exit after timeout.\n');
            process.exit(1);
        }, 5000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // Parent extension dying closes the IPC channel — detect and shut down
    process.on('disconnect', () => shutdown('parent-disconnect'));
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    validateEnvironment();
    ensureAuditLogDir();
    const scrubber = new PiiScrubber_1.PiiScrubber();
    const rateLimiter = new RateLimiter_1.RateLimiter(RATE_LIMIT_MAX_TOKENS, RATE_LIMIT_REFILL_RATE);
    const auditLogger = new AuditLogger_1.AuditLogger(AUDIT_LOG_PATH);
    const systemPrompt = AbapSystemPrompt_1.AbapSystemPrompt.get();
    // Select backend adapter based on env var
    let adapter;
    if (BACKEND === 'ollama') {
        const ollamaUrl = process.env.DARKHORSE_OLLAMA_URL || 'http://127.0.0.1:11434';
        const ollamaModel = process.env.DARKHORSE_OLLAMA_MODEL || 'codellama:34b';
        adapter = new OllamaAdapter_1.OllamaAdapter(ollamaUrl, ollamaModel, systemPrompt);
        process.stdout.write(`[DarkHorse Proxy] Using Ollama backend at ${ollamaUrl}, model: ${ollamaModel}\n`);
    }
    else {
        // Default: Claude
        adapter = new ClaudeAdapter_1.ClaudeAdapter(API_KEY, systemPrompt);
        process.stdout.write('[DarkHorse Proxy] Using Claude backend.\n');
    }
    const app = buildApp(adapter, scrubber, rateLimiter, auditLogger);
    const server = http.createServer(app);
    setupShutdownHandlers(server, auditLogger);
    // Bind to loopback ONLY — critical security requirement
    server.listen(PROXY_PORT, PROXY_HOST, () => {
        // Write the ready signal to stdout — parent extension reads this line
        // to know the proxy is up before sending requests.
        process.stdout.write(`[DarkHorse Proxy] Ready on ${PROXY_HOST}:${PROXY_PORT}\n`);
        auditLogger.log({
            event: 'proxy_start',
            port: PROXY_PORT,
            backend: BACKEND,
            outcome: 'started'
        });
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            process.stderr.write(`[DarkHorse Proxy] FATAL: Port ${PROXY_PORT} is already in use. ` +
                'Another DarkHorse instance may be running.\n');
        }
        else {
            process.stderr.write(`[DarkHorse Proxy] FATAL: Server error: ${err.message}\n`);
        }
        process.exit(1);
    });
}
main().catch((err) => {
    process.stderr.write(`[DarkHorse Proxy] FATAL startup error: ${err.message}\n${err.stack}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map