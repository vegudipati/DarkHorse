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
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PiiScrubber = void 0;
class PiiScrubber {
    rules;
    constructor() {
        this.rules = this.buildRules();
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Returns a copy of `input` with all matched SAP identifiers replaced.
     * The original string is never modified.
     */
    scrub(input) {
        if (!input || typeof input !== 'string') {
            return input;
        }
        let result = input;
        for (const rule of this.rules) {
            result = result.replace(rule.pattern, rule.replacement);
        }
        return result;
    }
    /**
     * Returns the list of active rules — useful for testing and audit.
     */
    getRuleNames() {
        return this.rules.map(r => r.name);
    }
    // ---------------------------------------------------------------------------
    // Rule definitions
    // ---------------------------------------------------------------------------
    buildRules() {
        return [
            // ------------------------------------------------------------------
            // SAP connection URLs
            // Matches: https://sapdev01.corp.local:8000/sap/bc/adt/...
            // Replacement: placeholder URL that keeps the path structure for context
            // ------------------------------------------------------------------
            {
                name: 'sap_url',
                pattern: /https?:\/\/[a-zA-Z0-9\-_.]+(?::\d+)?\/sap\//gi,
                replacement: 'https://SAP_HOST/sap/'
            },
            // ------------------------------------------------------------------
            // IPv4 addresses
            // Matches: 192.168.1.100, 10.0.0.1 etc.
            // ------------------------------------------------------------------
            {
                name: 'ipv4_address',
                pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
                replacement: 'IP_ADDR'
            },
            // ------------------------------------------------------------------
            // SAP hostnames — common naming patterns in enterprise environments
            // Matches: sapdev01, s4h-prd, sap-dev-01, saperp.corp.local
            // Does NOT match: table names, variable names (requires word boundary + SAP prefix)
            // ------------------------------------------------------------------
            {
                name: 'sap_hostname',
                pattern: /\b(?:sap|s4h|s4p|erp|ecc|hana|nw|abap)[a-z0-9\-_]{0,20}(?:\.[a-z][a-z0-9\-.]{2,})+\b/gi,
                replacement: 'SAP_HOST'
            },
            // ------------------------------------------------------------------
            // SAP RFC destinations — uppercase 3-32 char strings matching RFC naming
            // Matches: SAPDEV_RFC, PRD_CLNT100, S4H_DEV_001
            // Anchored to avoid catching ABAP variable names
            // ------------------------------------------------------------------
            {
                name: 'rfc_destination',
                pattern: /\b[A-Z]{2,3}[_\-][A-Z0-9_\-]{3,28}\b(?=\s*(?:"|'|,|\)|\s))/g,
                replacement: 'RFC_DEST'
            },
            // ------------------------------------------------------------------
            // SAP Client numbers in connection context
            // Matches: CLIENT=100, MANDT = '200', client 800
            // ------------------------------------------------------------------
            {
                name: 'sap_client_kv',
                pattern: /\b(?:client|mandt|mandant)\s*[=:]\s*['"]?\d{3}['"]?/gi,
                replacement: 'CLIENT=CLIENT_NO'
            },
            // ------------------------------------------------------------------
            // SAP System IDs in connection context
            // Matches: SID=PRD, SYSID = 'DEV', system S4P
            // This is more targeted than scrubbing all 3-letter uppercase words
            // ------------------------------------------------------------------
            {
                name: 'sap_sid_kv',
                pattern: /\b(?:sysid|sid|system_id|system)\s*[=:]\s*['"]?[A-Z][A-Z0-9]{2}['"]?/gi,
                replacement: 'SYSID=SID'
            },
            // ------------------------------------------------------------------
            // SAP user IDs in connection/auth context
            // Matches: user=S0012345678, username: 'JDOE', USER = 'BSMITH'
            // ------------------------------------------------------------------
            {
                name: 'sap_user_kv',
                pattern: /\b(?:user(?:name)?|benutzer)\s*[=:]\s*['"]?[A-Za-z][A-Za-z0-9_\-.]{2,15}['"]?/gi,
                replacement: 'USER=SAP_USER'
            },
            // ------------------------------------------------------------------
            // SAP passwords — belt-and-suspenders, should never appear in code
            // but catch them if someone pastes a connection string
            // ------------------------------------------------------------------
            {
                name: 'sap_password_kv',
                pattern: /\b(?:password|passwd|passwort|pwd)\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/gi,
                replacement: 'PASSWORD=REDACTED'
            },
            // ------------------------------------------------------------------
            // SAP instance numbers in connection strings
            // Matches: SYSNR=00, instance 01, nr=10
            // ------------------------------------------------------------------
            {
                name: 'sap_instance_kv',
                pattern: /\b(?:sysnr|instance_?(?:no|number)|nr)\s*[=:]\s*['"]?\d{2}['"]?/gi,
                replacement: 'SYSNR=NR'
            },
            // ------------------------------------------------------------------
            // SAP message server / application server hostnames
            // Matches: ashost=sapdev01, mshost=sap-ms.corp.local
            // ------------------------------------------------------------------
            {
                name: 'sap_server_kv',
                pattern: /\b(?:ashost|mshost|gwhost|message_?server)\s*[=:]\s*['"]?[a-zA-Z0-9\-_.]+['"]?/gi,
                replacement: 'HOST=SAP_HOST'
            },
            // ------------------------------------------------------------------
            // Transport request numbers
            // Matches: DEVK900123, S4PK000456 — 3 char SID + K + 6 digits
            // ------------------------------------------------------------------
            {
                name: 'transport_number',
                pattern: /\b[A-Z][A-Z0-9]{2}K\d{6}\b/g,
                replacement: 'TRANSPORT_NO'
            },
            // ------------------------------------------------------------------
            // SAP object technical names that include the client SID as a prefix
            // e.g. program names like ZPRD_MYPROG, ZDEV_REPORT
            // Only scrub the SID prefix portion, not the whole name
            // Pattern: Z or Y programs starting with apparent SID prefix
            // ------------------------------------------------------------------
            {
                name: 'object_sid_prefix',
                pattern: /\b([ZY])(?:PRD|QAS|QAT|SBX|TST|PPD|DEV|UAT)_/gi,
                replacement: '$1SID_'
            }
        ];
    }
}
exports.PiiScrubber = PiiScrubber;
//# sourceMappingURL=PiiScrubber.js.map