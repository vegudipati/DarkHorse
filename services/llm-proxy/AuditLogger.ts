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

'use strict';

import fs = require('fs');
import path = require('path');
import { AuditEntry } from './types';

export class AuditLogger {

  private sequence: number = 0;
  private readonly logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
    this.ensureDirectoryExists();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Append an audit entry to the log file.
   * Adds timestamp and sequence number automatically.
   * Silent on failure — logging must never crash the proxy.
   */
  public log(entry: Omit<AuditEntry, 'timestamp'>): void {
    try {
      this.sequence += 1;

      const fullEntry: AuditEntry & { seq: number } = {
        timestamp: new Date().toISOString(),
        seq: this.sequence,
        ...entry
      };

      // Single line, newline-terminated — the .jsonl contract
      const line = JSON.stringify(fullEntry) + '\n';
      fs.appendFileSync(this.logPath, line, { encoding: 'utf8' });

    } catch (err) {
      // Audit log failure must never crash the proxy.
      // Write to stderr so the parent extension can surface it if needed.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[DarkHorse Proxy] Audit log write failed: ${message}\n`);
    }
  }

  /**
   * Returns the path of the current log file — surfaced in the AI panel UI.
   */
  public getLogPath(): string {
    return this.logPath;
  }

  /**
   * Returns the current sequence number — useful for health checks.
   */
  public getSequence(): number {
    return this.sequence;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
