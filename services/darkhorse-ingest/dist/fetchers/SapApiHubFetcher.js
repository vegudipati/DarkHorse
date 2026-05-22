/**
 * SapApiHubFetcher — Sprint 2 session 1 fetcher for SAP Business Accelerator Hub.
 *
 * The SAP API Hub (api.sap.com) is a structured catalog of released SAP APIs:
 * CDS views, BAPIs, OData services, RAP services, etc. It is the canonical
 * answer to "does this CDS view exist?" and "is this BAPI released?".
 *
 * Sprint 2 strategy:
 *   - This fetcher is the FIRST real fetcher and intentionally ships with a
 *     local seed fixture (fixtures/sap-api-hub-seed.json) so the full ingest
 *     pipeline runs end-to-end with zero network dependency in code-first
 *     mode.
 *   - The live HTTP path is implemented but disabled unless the caller passes
 *     `{ live: true, baseUrl }`. The real endpoint shape on api.sap.com is
 *     documented as TODO since SAP rotates the catalog API URL; a future
 *     session will pin the production endpoint after Deloitte confirms.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SapApiHubFetcher = void 0;
const fs = require("fs");
const path = require("path");
// ---------------------------------------------------------------------------
// Fetcher implementation
// ---------------------------------------------------------------------------
class SapApiHubFetcher {
    options;
    id = 'SAP_API_HUB';
    label = 'SAP Business Accelerator Hub';
    constructor(options = {}) {
        this.options = options;
    }
    async fetch() {
        if (this.options.live) {
            return this.fetchLive();
        }
        return this.fetchFromFixture();
    }
    // -------------------------------------------------------------------
    // Fixture path — Sprint 2 session 1 default
    // -------------------------------------------------------------------
    fetchFromFixture() {
        // __dirname is dist/fetchers/ at runtime; walk up two to package root,
        // then into fixtures/ — same pattern as the darkhorse-mcp catalog files.
        const defaultFixture = path.resolve(__dirname, '..', '..', 'fixtures', 'sap-api-hub-seed.json');
        const fixturePath = this.options.fixturePath ?? defaultFixture;
        if (!fs.existsSync(fixturePath)) {
            throw new Error(`SapApiHubFetcher: seed fixture not found at ${fixturePath}`);
        }
        const raw = fs.readFileSync(fixturePath, 'utf-8');
        const seed = JSON.parse(raw);
        const fetchedAt = new Date().toISOString();
        return seed.entries.map(entry => this.toDocument(entry, fetchedAt));
    }
    // -------------------------------------------------------------------
    // Live path — wired but not the default for Sprint 2
    // -------------------------------------------------------------------
    async fetchLive() {
        if (!this.options.baseUrl) {
            throw new Error('SapApiHubFetcher: live=true requires baseUrl in options.');
        }
        // Node 20+ has native fetch.
        const url = `${this.options.baseUrl.replace(/\/+$/, '')}/catalog`;
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) {
            throw new Error(`SapApiHubFetcher: catalog request failed ${res.status} ${res.statusText}`);
        }
        const payload = await res.json();
        if (!payload.entries || !Array.isArray(payload.entries)) {
            throw new Error('SapApiHubFetcher: catalog response missing entries[] array.');
        }
        const fetchedAt = new Date().toISOString();
        return payload.entries.map(entry => this.toDocument(entry, fetchedAt));
    }
    // -------------------------------------------------------------------
    // Shared shaping
    // -------------------------------------------------------------------
    toDocument(entry, fetchedAt) {
        const id = `sap-api-hub/${entry.objectType.toLowerCase()}/${entry.name}`;
        // Body: include title + description + a structured "object summary" so
        // semantic search can hit on either name or use-case phrasing.
        const body = [
            `Name: ${entry.name}`,
            `Type: ${entry.objectType}`,
            entry.module ? `Module: ${entry.module}` : null,
            entry.cleanCoreLevel ? `Clean Core Level: ${entry.cleanCoreLevel}` : null,
            '',
            entry.title,
            '',
            entry.description
        ].filter(Boolean).join('\n');
        return {
            id,
            source: this.id,
            sourceUrl: entry.url,
            objectName: entry.name,
            objectType: entry.objectType,
            module: entry.module,
            cleanCoreLevel: entry.cleanCoreLevel,
            title: entry.title,
            body,
            metadata: entry.metadata ?? {},
            fetchedAt
        };
    }
}
exports.SapApiHubFetcher = SapApiHubFetcher;
//# sourceMappingURL=SapApiHubFetcher.js.map