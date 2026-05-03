/**
 * DarkHorse LLM Proxy — Audit Logger
 *
 * Append-only .jsonl flat file logger.
 * One JSON object per line. ISO 8601 timestamp added automatically.
 *
 * Design:
 *   - Uses fs.appendFileSync — synchronous to guarantee ordering under load
 *   - Each entry is a single line — trivially grep-able and parseable
 *   - No rotation in MVP-5 (file grows unbounded — acceptable for single-dev use)
 *   - Log rotation and export added in CPI-1 with the audit dashboard
 *
 * Tamper-evidence approach (MVP-5 tier):
 *   - Append-only mode — entries cannot be overwritten
 *   - Each entry includes a running sequence number so gaps are detectable
 *   - CPI-1 will add row hashing for stronger tamper evidence
 *
 * Upgrade points for CPI-1:
 *   - Replace flat file with SQLite (better-sqlite3, once native modules resolved)
 *   - Add log rotation (daily or size-based)
 *   - Add HMAC row hashing for tamper-evident chain
 *   - Add central log shipping for team audit dashboards
 */
import { AuditEntry } from './types';
export declare class AuditLogger {
    private sequence;
    private readonly logPath;
    constructor(logPath: string);
    /**
     * Append an audit entry to the log file.
     * Adds timestamp and sequence number automatically.
     * Silent on failure — logging must never crash the proxy.
     */
    log(entry: Omit<AuditEntry, 'timestamp'>): void;
    /**
     * Returns the path of the current log file — surfaced in the AI panel UI.
     */
    getLogPath(): string;
    /**
     * Returns the current sequence number — useful for health checks.
     */
    getSequence(): number;
    private ensureDirectoryExists;
}
//# sourceMappingURL=AuditLogger.d.ts.map