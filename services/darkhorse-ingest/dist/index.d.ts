/**
 * darkhorse-ingest CLI — Sprint 2 session 1.
 *
 * Usage:
 *   node dist/index.js ingest sap-api-hub [--snapshot data/sap-api-hub.snapshot.json]
 *   node dist/index.js verify [--snapshot data/sap-api-hub.snapshot.json]
 *
 * `ingest` runs the full fetch → chunk → embed → index pipeline against
 * one source and (optionally) writes a JSON snapshot of the index.
 *
 * `verify` loads the snapshot (or runs an in-memory ingest if none given)
 * and probes the index with the Sprint-1 Code-Agent failure modes
 * (USEREXIT_ATP_QUANTITY, VBAK → I_SalesOrder, etc.). Acts as the Sprint-2
 * session-1 acceptance test.
 */
export {};
//# sourceMappingURL=index.d.ts.map