/**
 * KnowledgeProvider — abstraction over the data source backing the MCP tools.
 *
 * Sprint 1 hard-wired the tool functions to the static JSON catalogs under
 * catalog/. Sprint 2 session 4 introduces this provider layer so the same
 * tools can be backed by:
 *
 *   - StaticCatalogProvider          — the original catalog JSON files
 *   - AzureSearchKnowledgeProvider   — queries the RAG index in Azure AI Search
 *   - CompositeKnowledgeProvider     — Azure-first with static fallback
 *                                      (the "fail-open" pattern used elsewhere)
 *
 * The interface is intentionally narrow: three typed lookups, one per Sprint-1
 * tool. Tools become thin adapters that call the provider and shape the
 * response — no JSON loading logic in the tool layer.
 */

'use strict';

// ---------------------------------------------------------------------------
// Shared types — same field set as Sprint 1 tool outputs, minus the "source"
// envelope (the provider stamps that itself).
// ---------------------------------------------------------------------------

export type CleanCoreLevel = 'A' | 'B' | 'C' | 'D';

export interface BadiRecord {
  exists:           boolean;
  name:             string;
  level:            CleanCoreLevel | null;
  module:           string | null;
  enhancementSpot:  string | null;
  interfaceName:    string | null;
  description:      string;
  alternative:      string | null;
  /** Which provider produced this record. */
  providerId:       string;
  catalogVersion:   string;
}

export type ExitType = 'CUSTOMER_EXIT' | 'USER_EXIT' | 'MENU_EXIT' | 'SCREEN_EXIT';

export interface ExitRecord {
  exists:           boolean;
  name:             string;
  type:             ExitType | null;
  level:            CleanCoreLevel | null;
  module:           string | null;
  program:          string | null;
  include:          string | null;
  enhancement:      string | null;
  functionModule:   string | null;
  description:      string;
  alternative:      string | null;
  providerId:       string;
  catalogVersion:   string;
}

export interface CleanCoreAlternative {
  name:   string;
  type:   string;
  level:  CleanCoreLevel;
  notes?: string;
}

export interface CleanCoreLevelRecord {
  level:          CleanCoreLevel;
  name:           string;
  type:           string;
  module:         string | null;
  reasoning:      string;
  alternatives:   CleanCoreAlternative[];
  confidence:     'high' | 'medium' | 'low';
  providerId:     string;
  catalogVersion: string;
}

// ---------------------------------------------------------------------------
// Provider interface — one method per tool. Each may return null to signal
// "not found here" so a composite can fall through to the next provider.
// ---------------------------------------------------------------------------

export interface KnowledgeProvider {
  readonly id: string;

  verifyBadi(name: string, program?: string, module?: string): Promise<BadiRecord | null>;

  verifyExit(name: string, programName?: string, exitType?: ExitType): Promise<ExitRecord | null>;

  checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null>;
}
