/**
 * ReusableCatalog — cross-pipeline registry of accepted SAP objects.
 *
 * When a developer accepts a generated object in any pipeline, an entry
 * lands here. The next time any pipeline asks the LLM to generate an
 * object with the same name, we offer reuse instead of regenerating.
 * This is the marketplace concept: built-once, reuse-everywhere.
 *
 * Persisted in globalState so it survives across workspaces. Keyed by a
 * stable 16-hex id so the same logical object can have multiple entries
 * (e.g. two pipelines built ZI_DELIVERY_HEADER with slightly different
 * field sets — both stay in the catalog, the developer picks).
 *
 * Matching strategy (v1): exact (name, type) match. This is the highest-
 * signal cheapest check and catches the obvious "the same object name
 * already exists" case. Semantic similarity matching (keyLogic overlap,
 * embedding-based) is a future iteration.
 *
 * Scope: only ACCEPTED objects are registered. Pending / rejected are
 * skipped — those by definition didn't pass the developer review.
 *
 * Storage shape:
 *   globalState['darkhorse.reusableCatalog.v1'] = Record<entryId, ReusableEntry>
 */

'use strict';

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Storage key + version
// ---------------------------------------------------------------------------

const CATALOG_KEY = 'darkhorse.reusableCatalog.v1';

function generateEntryId(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReusableEntryMetadata {
  /** PipelineId where this object was first generated + accepted. */
  sourcePipelineId:    string;
  /** Human-readable pipeline title (for display in QuickPicks). */
  sourcePipelineTitle: string;
  /** ISO timestamp of the accept event that registered this entry. */
  acceptedAt:          string;
  /** DarkHorse UID (16-hex) from the audit log when the object was generated. */
  darkhorseUid?:       string;
}

export interface ReusableEntry {
  /** Stable id for this catalog entry. Independent of objectName so multiple
   *  variants of the same object name can co-exist. */
  id:            string;
  objectName:    string;
  objectType:    string;
  description:   string;
  keyLogic:      string[];
  dependencies:  string[];
  /** The accepted source code (after header emission). */
  generatedCode: string;
  metadata:      ReusableEntryMetadata;
  /** How many times this entry has been reused across pipelines. */
  usageCount:    number;
}

export interface ReusableSummary {
  id:                  string;
  objectName:          string;
  objectType:          string;
  description:         string;
  sourcePipelineTitle: string;
  acceptedAt:          string;
  usageCount:          number;
}

// ---------------------------------------------------------------------------
// Catalog class
// ---------------------------------------------------------------------------

export class ReusableCatalog {

  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ------- Read -------------------------------------------------------------

  /** Returns every entry matching the given object name + type. Most-recent
   *  acceptance first. Empty array when nothing matches. */
  public find(objectName: string, objectType: string): ReusableEntry[] {
    const map = this.allEntries();
    const name = (objectName ?? '').trim().toUpperCase();
    const type = (objectType ?? '').trim().toUpperCase();
    const hits = Object.values(map)
      .filter((e): e is ReusableEntry => Boolean(e))
      .filter(e => e.objectName.trim().toUpperCase() === name &&
                   e.objectType.trim().toUpperCase() === type)
      .sort((a, b) => b.metadata.acceptedAt.localeCompare(a.metadata.acceptedAt));
    return hits;
  }

  public list(): ReusableSummary[] {
    const map = this.allEntries();
    return Object.values(map)
      .filter((e): e is ReusableEntry => Boolean(e))
      .map(e => ({
        id:                  e.id,
        objectName:          e.objectName,
        objectType:          e.objectType,
        description:         e.description,
        sourcePipelineTitle: e.metadata.sourcePipelineTitle,
        acceptedAt:          e.metadata.acceptedAt,
        usageCount:          e.usageCount ?? 0
      }))
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt));
  }

  public getById(id: string): ReusableEntry | undefined {
    return this.allEntries()[id];
  }

  // ------- Write ------------------------------------------------------------

  /** Add a new entry. If an entry with the SAME object name + type + code
   *  already exists, returns the existing entry id (no duplicate). */
  public async add(input: Omit<ReusableEntry, 'id' | 'usageCount'>): Promise<string> {
    const map = this.allEntries();
    // Dedup: same name + type + code hash = same logical entry.
    const existing = Object.values(map).find(e =>
      e &&
      e.objectName.trim().toUpperCase() === input.objectName.trim().toUpperCase() &&
      e.objectType.trim().toUpperCase() === input.objectType.trim().toUpperCase() &&
      e.generatedCode.trim() === input.generatedCode.trim()
    );
    if (existing) return existing.id;
    const id = generateEntryId();
    map[id] = {
      ...input,
      id,
      usageCount: 0
    };
    await this.context.globalState.update(CATALOG_KEY, map);
    return id;
  }

  /** Bump usageCount on the given entry. Used after a successful reuse. */
  public async bumpUsage(id: string): Promise<void> {
    const map = this.allEntries();
    const e = map[id];
    if (!e) return;
    e.usageCount = (e.usageCount ?? 0) + 1;
    map[id] = e;
    await this.context.globalState.update(CATALOG_KEY, map);
  }

  public async remove(id: string): Promise<void> {
    const map = this.allEntries();
    delete map[id];
    await this.context.globalState.update(CATALOG_KEY, map);
  }

  // ------- Internals --------------------------------------------------------

  private allEntries(): Record<string, ReusableEntry> {
    return this.context.globalState.get<Record<string, ReusableEntry>>(CATALOG_KEY) ?? {};
  }
}
