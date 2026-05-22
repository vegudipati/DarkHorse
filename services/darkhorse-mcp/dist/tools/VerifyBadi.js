/**
 * VerifyBadi — adapter over a KnowledgeProvider for the /tools/verify-badi
 * endpoint.
 *
 * Sprint 1 loaded badi-catalog.json directly; Sprint 2 session 4 delegates
 * to the injected provider, which can be the static catalog, an Azure AI
 * Search-backed index, or a composite that tries Azure first and falls back
 * to static. This file is now pure input validation + response shaping.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBadi = verifyBadi;
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function verifyBadi(input, provider) {
    if (!input || typeof input.badi_name !== 'string' || input.badi_name.trim().length === 0) {
        throw new Error('verify_badi: badi_name is required and must be a non-empty string.');
    }
    const record = await provider.verifyBadi(input.badi_name, input.program, input.module);
    if (!record) {
        throw new Error('verify_badi: no provider produced a result for this BAdI.');
    }
    return {
        exists: record.exists,
        name: record.name,
        level: record.level,
        module: record.module,
        enhancementSpot: record.enhancementSpot,
        interfaceName: record.interfaceName,
        description: record.description,
        alternative: record.alternative,
        source: record.providerId,
        catalogVersion: record.catalogVersion
    };
}
//# sourceMappingURL=VerifyBadi.js.map