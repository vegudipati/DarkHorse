/**
 * DarkHorse LLM Proxy — PII Scrubber
 *
 * Strips SAP-specific identifiers from any string before it is forwarded
 * to an LLM backend. This is a defense-in-depth measure — the developer
 * should not be sending raw production data, but we scrub regardless.
 *
 * What gets scrubbed:
 *   - SAP System IDs (SID): 3-character codes like PRD, QAS, DEV, S4P etc.
 *   - SAP Client numbers: 3-digit codes like 100, 200, 800
 *   - SAP hostnames: patterns like sapdev01, s4h-prd.corp.local
 *   - SAP instance numbers: 2-digit codes like 00, 01, 10
 *   - ABAP user IDs: patterns matching SAP user naming conventions
 *   - Connection strings: anything that looks like a SAP URL or RFC destination
 *   - IP addresses: IPv4 only (IPv6 patterns are too broad)
 *
 * What is NOT scrubbed:
 *   - ABAP source code structure, keywords, syntax
 *   - Table/field names (these are SAP standard, not client-specific)
 *   - Error messages from ADT (already stripped of system info by SAP)
 *
 * Design notes:
 *   - Patterns are applied in order — more specific before more general
 *   - Replacements use fixed placeholder strings, not redaction markers,
 *     so the LLM can still generate syntactically valid ABAP
 *   - False positive rate is acceptable: over-scrubbing is safer than under-scrubbing
 *   - All patterns compiled at construction time for performance
 */
export declare class PiiScrubber {
    private readonly rules;
    constructor();
    /**
     * Returns a copy of `input` with all matched SAP identifiers replaced.
     * The original string is never modified.
     */
    scrub(input: string): string;
    /**
     * Returns the list of active rules — useful for testing and audit.
     */
    getRuleNames(): string[];
    private buildRules;
}
//# sourceMappingURL=PiiScrubber.d.ts.map