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
export {};
//# sourceMappingURL=index.d.ts.map