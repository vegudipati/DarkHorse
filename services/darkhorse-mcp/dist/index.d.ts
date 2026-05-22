/**
 * DarkHorse MCP Knowledge Service
 *
 * HTTP server that exposes grounded SAP-knowledge tools so the SO/FDS/TDS/Code
 * agents can VERIFY every SAP reference before emitting it. Eliminates the
 * #1 root cause of low code-generation accuracy: hallucinated BAdIs / exits.
 *
 * Security model (CPI-6 Sprint 1):
 *   - Binds to 127.0.0.1 ONLY — never network-accessible
 *   - No authentication (loopback only — same model as llm-proxy)
 *   - No outbound network calls (Sprint 1 catalogs are local JSON)
 *   - No native npm modules
 *
 * Endpoints:
 *   GET  /health                              → liveness + tool list
 *   GET  /mcp/tools                           → MCP-style tool descriptor list
 *   POST /tools/verify-badi                   → VerifyBadi
 *   POST /tools/verify-exit                   → VerifyExit
 *   POST /tools/check-clean-core-level        → CheckCleanCoreLevel
 *   POST /tools/get-application-log-pattern   → GetApplicationLogPattern
 *
 * CPI-6 future-sprint upgrade points (do NOT implement now):
 *   - Replace static JSON catalogs with Azure AI Search queries (Sprint 2)
 *   - Implement full MCP protocol over HTTP+SSE for editor-side MCP clients
 *   - Add the remaining tools: get_rap_pattern, get_cds_view, get_eml_syntax,
 *     get_cbo_pattern, search_sap_apis, search_team_templates
 */
export {};
//# sourceMappingURL=index.d.ts.map