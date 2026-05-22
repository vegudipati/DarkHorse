/**
 * VerifyBadi — adapter over a KnowledgeProvider for the /tools/verify-badi
 * endpoint.
 *
 * Sprint 1 loaded badi-catalog.json directly; Sprint 2 session 4 delegates
 * to the injected provider, which can be the static catalog, an Azure AI
 * Search-backed index, or a composite that tries Azure first and falls back
 * to static. This file is now pure input validation + response shaping.
 */
import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';
export interface VerifyBadiInput {
    badi_name: string;
    program?: string;
    module?: string;
}
export interface VerifyBadiOutput {
    exists: boolean;
    name: string;
    level: 'A' | 'B' | 'C' | 'D' | null;
    module: string | null;
    enhancementSpot: string | null;
    interfaceName: string | null;
    description: string;
    alternative: string | null;
    source: string;
    catalogVersion: string;
}
export declare function verifyBadi(input: VerifyBadiInput, provider: KnowledgeProvider): Promise<VerifyBadiOutput>;
//# sourceMappingURL=VerifyBadi.d.ts.map