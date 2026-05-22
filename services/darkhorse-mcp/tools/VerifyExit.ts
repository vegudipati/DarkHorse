/**
 * VerifyExit — adapter over a KnowledgeProvider for /tools/verify-exit.
 *
 * Sprint 2 session 4: delegates lookup to the injected provider.
 * See ../src/providers/KnowledgeProvider.ts for the provider contract.
 */

'use strict';

import { KnowledgeProvider } from '../src/providers/KnowledgeProvider';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExitType = 'CUSTOMER_EXIT' | 'USER_EXIT' | 'MENU_EXIT' | 'SCREEN_EXIT';

export interface VerifyExitInput {
  exit_name:     string;
  program_name?: string;
  exit_type?:    ExitType;
}

export interface VerifyExitOutput {
  exists:           boolean;
  name:             string;
  type:             ExitType | null;
  level:            'A' | 'B' | 'C' | 'D' | null;
  module:           string | null;
  program:          string | null;
  include:          string | null;
  enhancement:      string | null;
  functionModule:   string | null;
  description:      string;
  alternative:      string | null;
  source:           string;
  catalogVersion:   string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyExit(
  input: VerifyExitInput,
  provider: KnowledgeProvider
): Promise<VerifyExitOutput> {
  if (!input || typeof input.exit_name !== 'string' || input.exit_name.trim().length === 0) {
    throw new Error('verify_exit: exit_name is required and must be a non-empty string.');
  }

  const record = await provider.verifyExit(input.exit_name, input.program_name, input.exit_type);
  if (!record) {
    throw new Error('verify_exit: no provider produced a result for this exit.');
  }

  return {
    exists:         record.exists,
    name:           record.name,
    type:           record.type,
    level:          record.level,
    module:         record.module,
    program:        record.program,
    include:        record.include,
    enhancement:    record.enhancement,
    functionModule: record.functionModule,
    description:    record.description,
    alternative:    record.alternative,
    source:         record.providerId,
    catalogVersion: record.catalogVersion
  };
}
