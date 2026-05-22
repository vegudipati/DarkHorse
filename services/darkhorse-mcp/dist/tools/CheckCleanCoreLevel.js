/**
 * CheckCleanCoreLevel — adapter over a KnowledgeProvider for the
 * /tools/check-clean-core-level endpoint.
 *
 * Sprint 2 session 4: delegates lookup to the injected provider. The static
 * provider keeps the Sprint-1 heuristic fallback (I_ prefix -> A, Z/Y
 * customer namespace -> C, etc.) for objects not present in the catalog.
 * The Azure provider returns null if not indexed so the composite can fall
 * through to the static heuristic.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCleanCoreLevel = checkCleanCoreLevel;
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function checkCleanCoreLevel(input, provider) {
    if (!input || typeof input.object_name !== 'string' || input.object_name.trim().length === 0) {
        throw new Error('check_clean_core_level: object_name is required and must be a non-empty string.');
    }
    if (typeof input.object_type !== 'string' || input.object_type.trim().length === 0) {
        throw new Error('check_clean_core_level: object_type is required and must be a non-empty string.');
    }
    const record = await provider.checkCleanCoreLevel(input.object_name, input.object_type);
    if (!record) {
        throw new Error('check_clean_core_level: no provider produced a result for this object.');
    }
    return {
        level: record.level,
        name: record.name,
        type: record.type,
        module: record.module,
        reasoning: record.reasoning,
        alternatives: record.alternatives,
        confidence: record.confidence,
        source: record.providerId,
        catalogVersion: record.catalogVersion
    };
}
//# sourceMappingURL=CheckCleanCoreLevel.js.map