/**
 * CleanCoreGuideFetcher — Sprint 2 session 2 fetcher for the SAP Clean Core
 * Extensibility Guide.
 *
 * The Clean Core Extensibility Guide is published by SAP as a PDF that
 * defines the Level A-D extensibility model and the canonical patterns
 * for ABAP development on S/4HANA Cloud and Private editions. It is the
 * authoritative source for `check_clean_core_level` reasoning.
 *
 * Sprint 2 strategy:
 *   - Default path: load fixtures/clean-core-guide-seed.json — a curated
 *     extract of the canonical rules (Level A/B/C/D definitions, RAP / CDS /
 *     SLG1 / APJ / BAdI / CBO patterns). Each rule becomes one IngestDocument
 *     of objectType='PATTERN' so the index can be queried by patternId.
 *   - Live path (live=true + pdfUrl): downloads the PDF, parses it via
 *     pdf-parse, splits on heading-style markers ("Level A", "Level B",
 *     numbered sections) into pattern-sized documents. The live path stays
 *     disabled until a Deloitte-pinned PDF URL is in scope.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CleanCoreGuideFetcher = void 0;
const fs = require("fs");
const path = require("path");
// ---------------------------------------------------------------------------
// Fetcher implementation
// ---------------------------------------------------------------------------
class CleanCoreGuideFetcher {
    options;
    id = 'SAP_CLEAN_CORE_GUIDE';
    label = 'SAP Clean Core Extensibility Guide';
    constructor(options = {}) {
        this.options = options;
    }
    async fetch() {
        if (this.options.live) {
            return this.fetchLivePdf();
        }
        return this.fetchFromFixture();
    }
    // -------------------------------------------------------------------
    // Fixture path — Sprint 2 default
    // -------------------------------------------------------------------
    fetchFromFixture() {
        const defaultFixture = path.resolve(__dirname, '..', '..', 'fixtures', 'clean-core-guide-seed.json');
        const fixturePath = this.options.fixturePath ?? defaultFixture;
        if (!fs.existsSync(fixturePath)) {
            throw new Error(`CleanCoreGuideFetcher: seed fixture not found at ${fixturePath}`);
        }
        const raw = fs.readFileSync(fixturePath, 'utf-8');
        const seed = JSON.parse(raw);
        const fetchedAt = new Date().toISOString();
        return seed.entries.map(entry => this.toDocument(entry, fetchedAt));
    }
    // -------------------------------------------------------------------
    // Live PDF path — wired, disabled by default
    // -------------------------------------------------------------------
    async fetchLivePdf() {
        if (!this.options.pdfUrl) {
            throw new Error('CleanCoreGuideFetcher: live=true requires pdfUrl in options.');
        }
        const res = await fetch(this.options.pdfUrl);
        if (!res.ok) {
            throw new Error(`CleanCoreGuideFetcher: PDF fetch failed ${res.status} ${res.statusText}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        // Lazy import so the fixture path doesn't require pdf-parse to load.
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buf);
        return this.splitParsedPdf(parsed.text);
    }
    // -------------------------------------------------------------------
    // PDF splitting — heuristic, refined as we see real PDF layouts
    // -------------------------------------------------------------------
    splitParsedPdf(text) {
        // Sprint 2 heuristic: split on lines that look like section headings.
        // The Clean Core Guide uses "Level A", "Level B", "Pattern: <name>",
        // and numbered headings ("1. Released APIs", "2.3 RAP Behavior").
        const HEADING_RX = /^(?:Level [ABCD]\b.*|Pattern:.*|\d+(?:\.\d+)*\s+[A-Z].*)$/m;
        const lines = text.split(/\r?\n/);
        const sections = [];
        let current = null;
        for (const raw of lines) {
            const line = raw.trim();
            if (line.length === 0) {
                if (current)
                    current.body.push('');
                continue;
            }
            if (HEADING_RX.test(line)) {
                if (current)
                    sections.push(current);
                current = { heading: line, body: [] };
            }
            else if (current) {
                current.body.push(line);
            }
        }
        if (current)
            sections.push(current);
        const fetchedAt = new Date().toISOString();
        return sections
            .filter(s => s.body.join(' ').trim().length > 40) // discard heading-only sections
            .map((s, idx) => {
            const patternId = normalisePatternId(s.heading) || `SECTION_${idx + 1}`;
            const inferredLevel = inferLevelFromHeading(s.heading);
            return this.toDocument({
                patternId,
                title: s.heading,
                module: null,
                cleanCoreLevel: inferredLevel,
                description: s.body.join('\n').trim(),
                url: this.options.pdfUrl ?? null,
                metadata: { sectionOrdinal: idx }
            }, fetchedAt);
        });
    }
    // -------------------------------------------------------------------
    // Shared shaping
    // -------------------------------------------------------------------
    toDocument(entry, fetchedAt) {
        const id = `sap-clean-core-guide/pattern/${entry.patternId}`;
        const body = [
            `Pattern: ${entry.patternId}`,
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
            objectName: entry.patternId,
            objectType: 'PATTERN',
            module: entry.module,
            cleanCoreLevel: entry.cleanCoreLevel,
            title: entry.title,
            body,
            metadata: entry.metadata ?? {},
            fetchedAt
        };
    }
}
exports.CleanCoreGuideFetcher = CleanCoreGuideFetcher;
// ---------------------------------------------------------------------------
// Heuristic helpers for the live PDF path
// ---------------------------------------------------------------------------
function normalisePatternId(heading) {
    const cleaned = heading
        .replace(/^Pattern:\s*/i, '')
        .replace(/^Level\s+([ABCD])\b.*$/i, 'LEVEL_$1_DEFINITION')
        .replace(/^\d+(?:\.\d+)*\s+/, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned.slice(0, 80);
}
function inferLevelFromHeading(heading) {
    const m = heading.match(/Level\s+([ABCD])\b/i);
    if (!m)
        return null;
    return (m[1].toUpperCase());
}
//# sourceMappingURL=CleanCoreGuideFetcher.js.map