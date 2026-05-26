/**
 * TerminalStubProvider — last-resort provider that always returns a
 * "not found" envelope rather than null.
 *
 * Sits at the end of the composite chain. When every upstream provider
 * (curated static catalog, SAP cloudification, Azure AI Search) returned
 * null for a query, this provider produces the deterministic stub the MCP
 * tools and the LLM-facing grounders rely on. Keeping the stub here (rather
 * than inside any single data provider) lets the upstream providers cleanly
 * signal "I don't have this" with null, so a downstream provider with the
 * data can win.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalStubProvider = void 0;
class TerminalStubProvider {
    id = 'terminal-stub';
    catalogVersion = 'stub-1';
    async verifyBadi(name, _program, _module) {
        return {
            exists: false,
            name,
            level: null,
            module: null,
            enhancementSpot: null,
            interfaceName: null,
            description: 'BAdI not found in any DarkHorse knowledge source (curated catalog, SAP Cloudification Repository, ' +
                'or Azure AI Search). This is a STRONG signal that the BAdI does not exist — LLM-hallucinated ' +
                'BAdI names are a known failure mode. Do NOT reference this BAdI in generated code without manual ' +
                'verification in SE18/SE19. Consider whether a released alternative (RAP behavior on a BDEF, or a ' +
                'different BAdI for the same scenario) should be used instead.',
            alternative: null,
            providerId: this.id,
            catalogVersion: this.catalogVersion
        };
    }
    async verifyExit(name, _programName, _exitType) {
        return {
            exists: false,
            name,
            type: null,
            level: null,
            module: null,
            program: null,
            include: null,
            enhancement: null,
            functionModule: null,
            description: 'Exit not found in any DarkHorse knowledge source. This is a STRONG signal that the exit does not ' +
                'exist — LLM-hallucinated exit names (USEREXIT_ATP_QUANTITY, USEREXIT_DELIVERY_CHECK, etc.) are a ' +
                'known failure mode. Do NOT reference this exit in generated code without manual SMOD/SE38 ' +
                'verification. The correct extension point is almost always a released BAdI.',
            alternative: null,
            providerId: this.id,
            catalogVersion: this.catalogVersion
        };
    }
    async checkCleanCoreLevel(name, type) {
        const upperName = name.trim().toUpperCase();
        const upperType = type.trim().toUpperCase();
        const base = {
            name,
            type: upperType,
            module: null,
            alternatives: [],
            providerId: this.id,
            catalogVersion: this.catalogVersion
        };
        // Level A — modern released APIs (heuristics by naming convention).
        if (upperType === 'CDS' && /^I_[A-Z]/.test(upperName)) {
            return { ...base, level: 'A',
                reasoning: 'CDS interface view (I_*) — released interface views follow SAP\'s Clean Core API contract and are Level A by convention.',
                confidence: 'medium' };
        }
        if (upperType === 'BDEF' || (upperType === 'DDLS' && /^I_[A-Z]/.test(upperName)) || /TP$/.test(upperName)) {
            return { ...base, level: 'A',
                reasoning: 'RAP Behavior Definition / projection — RAP is the Level A target for transactional operations; EML against this BDEF is the cloud-ready write path.',
                confidence: 'medium' };
        }
        // Customer namespace — defaults to C, with refactor guidance.
        if (/^[ZY]/.test(upperName)) {
            return { ...base, level: 'C',
                reasoning: 'Customer namespace (Z*/Y*) object. Custom objects are acceptable only when implemented as released-API consumers (Level A) or RAP-managed CBO (Level A). Direct custom-table reads/writes are Level C — refactor to a CBO with CDS + RAP behavior.',
                confidence: 'low' };
        }
        // Direct table access — TABL itself is Level B as a released SAP object,
        // but the ACTION of a direct SELECT bypasses the released-API contract
        // and is Level C. The verifier auto-fix step rewrites the FROM clause
        // when a CDS alternative is known.
        if (upperType === 'TABL') {
            return { ...base, level: 'C',
                reasoning: `${upperName} is a standard SAP table — the TABLE itself is Clean Core (Level B as a SAP-released object). ` +
                    `What gets flagged here is the ACTION of a direct SELECT ${upperName.toLowerCase()} bypassing the released-API contract, ` +
                    `which is Level C. Two fixes: (1) replace the SELECT with the released I_* CDS interface view from the SAP Business ` +
                    `Accelerator Hub if one exists; (2) if no released view exists, ask the TDS Agent to include a Z wrapper view ` +
                    `(ZI_${upperName}) as a separate DDLS object and SELECT from that.`,
                confidence: 'medium' };
        }
        // Classic SAP-released BAPI — Level B. Upgrade-stable; calling a BAPI
        // does NOT violate Clean Core. Level A target is the released RAP BDEF
        // when one exists.
        if (upperType === 'BAPI' || /^BAPI_/.test(upperName)) {
            return { ...base, level: 'B',
                reasoning: 'Classic SAP-released BAPI — Level B. BAPIs are upgrade-stable, supported, and treated as released APIs by SAP. Calling a BAPI does NOT violate Clean Core. ' +
                    'When a released RAP Behavior Definition (BDEF) exists for the same operation, EML against the BDEF is the Level A modernization target.',
                confidence: 'medium' };
        }
        if (upperType === 'FUNC' || upperType === 'RFM') {
            return { ...base, level: 'B',
                reasoning: 'Standard SAP function module — Level B by default. Released, upgrade-stable, supported. Does not violate Clean Core. ' +
                    'If a released RAP/CDS/OData equivalent exists in the SAP Business Accelerator Hub, use it for new code (Level A).',
                confidence: 'medium' };
        }
        // IDocs / IDoc segments — Level B integration.
        if (upperType === 'IDOC' || upperType === 'IDOC_BAS' || /^IDOC_/.test(upperName) || /^E1_/.test(upperName)) {
            return { ...base, level: 'B',
                reasoning: 'Standard SAP IDoc / IDoc segment — Level B. Released integration interface; modernization path is SAP Event Mesh + business events (Level A) for new async integrations.',
                confidence: 'medium' };
        }
        // Standard transactions — Level B.
        if (upperType === 'TRAN') {
            return { ...base, level: 'B',
                reasoning: 'Standard SAP transaction code — Level B. Released and supported. Calling via CALL TRANSACTION / SUBMIT is upgrade-stable. Prefer released RAP/OData service for new development.',
                confidence: 'medium' };
        }
        // Standard framework classes (CL_*, CX_*).
        if (upperType === 'CLAS' && /^(CL_|CX_)/.test(upperName)) {
            return { ...base, level: 'B',
                reasoning: 'Standard SAP framework class — Level B. Released framework classes (CL_BAL_*, CL_SALV_*, CL_GUI_*, etc.) are supported and upgrade-stable.',
                confidence: 'medium' };
        }
        // Standard programs / reports.
        if (upperType === 'PROG') {
            return { ...base, level: 'B',
                reasoning: 'Standard SAP program — Level B. SUBMIT-ing a released report is upgrade-stable and supported.',
                confidence: 'low' };
        }
        // Default — standard SAP namespace, Level B with low confidence. The "not
        // found in any source" message is added so the agent knows this is a
        // heuristic verdict, not a positive catalog hit.
        return { ...base, level: 'B',
            reasoning: `${upperName} appears to be in the standard SAP namespace but was not found in any DarkHorse knowledge source ` +
                `(curated catalog, SAP Cloudification Repository, Azure AI Search). Defaulting to Level B (released, upgrade-stable) ` +
                `with low confidence. Verify against the SAP Business Accelerator Hub for the canonical level and any Level A ` +
                `modernization alternatives.`,
            confidence: 'low' };
    }
}
exports.TerminalStubProvider = TerminalStubProvider;
//# sourceMappingURL=TerminalStubProvider.js.map