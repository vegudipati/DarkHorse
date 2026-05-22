/**
 * VerifyExit — adapter over a KnowledgeProvider for /tools/verify-exit.
 *
 * Sprint 2 session 4: delegates lookup to the injected provider.
 * See ../src/providers/KnowledgeProvider.ts for the provider contract.
 */
import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';
export type ExitType = 'CUSTOMER_EXIT' | 'USER_EXIT' | 'MENU_EXIT' | 'SCREEN_EXIT';
export interface VerifyExitInput {
    exit_name: string;
    program_name?: string;
    exit_type?: ExitType;
}
export interface VerifyExitOutput {
    exists: boolean;
    name: string;
    type: ExitType | null;
    level: 'A' | 'B' | 'C' | 'D' | null;
    module: string | null;
    program: string | null;
    include: string | null;
    enhancement: string | null;
    functionModule: string | null;
    description: string;
    alternative: string | null;
    source: string;
    catalogVersion: string;
}
export declare function verifyExit(input: VerifyExitInput, provider: KnowledgeProvider): Promise<VerifyExitOutput>;
//# sourceMappingURL=VerifyExit.d.ts.map