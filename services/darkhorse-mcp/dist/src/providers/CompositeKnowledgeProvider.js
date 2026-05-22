/**
 * CompositeKnowledgeProvider — Azure-first with static-catalog fallback.
 *
 * Tries each provider in order. The first one that returns a non-null record
 * wins. If a provider throws (e.g. Azure is misconfigured, rate-limited, or
 * unreachable), the composite logs and moves on — same fail-open pattern the
 * darkhorse-pipeline CleanCoreVerifier uses for the MCP-down case.
 *
 * Special case for verifyBadi/verifyExit: the static provider returns a
 * "not found" record (exists=false) rather than null when the catalog has
 * no entry. That is still a valid answer (it triggers the agent's
 * hallucination guard), so we accept it. The composite only falls through
 * when a provider returns *null*.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeKnowledgeProvider = void 0;
class CompositeKnowledgeProvider {
    providers;
    id;
    constructor(providers) {
        this.providers = providers;
        if (providers.length === 0) {
            throw new Error('CompositeKnowledgeProvider: at least one provider is required.');
        }
        this.id = `composite[${providers.map(p => p.id).join('|')}]`;
    }
    async verifyBadi(name, program, module) {
        return this.firstOk(p => p.verifyBadi(name, program, module));
    }
    async verifyExit(name, programName, exitType) {
        return this.firstOk(p => p.verifyExit(name, programName, exitType));
    }
    async checkCleanCoreLevel(name, type) {
        return this.firstOk(p => p.checkCleanCoreLevel(name, type));
    }
    async firstOk(call) {
        for (const p of this.providers) {
            try {
                const result = await call(p);
                if (result !== null && result !== undefined) {
                    return result;
                }
            }
            catch (err) {
                process.stderr.write(`[DarkHorse MCP] Provider ${p.id} failed (will fall through): ${err?.message ?? err}\n`);
            }
        }
        return null;
    }
}
exports.CompositeKnowledgeProvider = CompositeKnowledgeProvider;
//# sourceMappingURL=CompositeKnowledgeProvider.js.map