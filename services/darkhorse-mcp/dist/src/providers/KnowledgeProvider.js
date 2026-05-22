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
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=KnowledgeProvider.js.map