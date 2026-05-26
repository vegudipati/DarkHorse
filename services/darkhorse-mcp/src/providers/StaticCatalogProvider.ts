/**
 * StaticCatalogProvider — KnowledgeProvider backed by the Sprint 1 JSON
 * catalogs under services/darkhorse-mcp/catalog/.
 *
 * Preserves Sprint 1 behavior exactly: same hallucination guards, same
 * heuristic fallbacks for unknown objects. The only behavioral change is
 * that lookups are async (the interface is Promise-returning so a
 * composite can mix this provider with the Azure-backed one).
 */

'use strict';

import fs   = require('fs');
import path = require('path');

import {
  KnowledgeProvider,
  BadiRecord,
  ExitRecord,
  ExitType,
  CleanCoreLevelRecord,
  CleanCoreLevel,
  CleanCoreAlternative
} from './KnowledgeProvider';

// ---------------------------------------------------------------------------
// Catalog raw shapes — match the JSON files we already ship.
// ---------------------------------------------------------------------------

interface BadiCatalogEntry {
  name:             string;
  enhancementSpot:  string | null;
  level:            CleanCoreLevel;
  module:           string;
  description:      string;
  interface:        string | null;
  exists?:          boolean;
  alternative?:     string;
}

interface BadiCatalog {
  _metadata: { schemaVersion: string };
  badis:     BadiCatalogEntry[];
}

interface ExitCatalogEntry {
  name:             string;
  type:             ExitType;
  level:            CleanCoreLevel;
  module:           string;
  enhancement?:     string;
  function_module?: string;
  include?:         string;
  program?:         string;
  description:      string;
  exists?:          boolean;
  alternative?:     string;
}

interface ExitCatalog {
  _metadata: { schemaVersion: string };
  exits:     ExitCatalogEntry[];
}

interface CleanCoreCatalogEntry {
  name:          string;
  type:          string;
  level:         CleanCoreLevel;
  module:        string;
  description:   string;
  reasoning?:    string;
  alternatives?: CleanCoreAlternative[];
}

interface CleanCoreCatalog {
  _metadata: { schemaVersion: string };
  objects:   CleanCoreCatalogEntry[];
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class StaticCatalogProvider implements KnowledgeProvider {

  public readonly id = 'static-catalog';

  private _badiCatalog:     BadiCatalog      | null = null;
  private _exitCatalog:     ExitCatalog      | null = null;
  private _ccCatalog:       CleanCoreCatalog | null = null;

  private _badiByName:  Map<string, BadiCatalogEntry>       | null = null;
  private _exitByName:  Map<string, ExitCatalogEntry[]>     | null = null;
  private _ccByKey:     Map<string, CleanCoreCatalogEntry>  | null = null;

  constructor(private readonly catalogDir: string = defaultCatalogDir()) {}

  /** Public accessor for catalog write tools that need to know where the
   *  seed JSON lives. */
  public getCatalogDir(): string {
    return this.catalogDir;
  }

  /** Invalidate all in-memory caches. Call after writing to a catalog JSON
   *  file so the next lookup re-reads it. */
  public reload(): void {
    this._badiCatalog = null;
    this._badiByName  = null;
    this._exitCatalog = null;
    this._exitByName  = null;
    this._ccCatalog   = null;
    this._ccByKey     = null;
  }

  // -------------------------------------------------------------------
  // verifyBadi
  // -------------------------------------------------------------------

  public async verifyBadi(name: string, _program?: string, _module?: string): Promise<BadiRecord | null> {
    if (!name?.trim()) return null;
    const { catalog, index } = this.getBadiIndex();
    const entry = index.get(name.trim().toUpperCase());

    // Provider semantics: null means "no opinion here, let the next provider
    // try". A downstream provider (Cloudification, then TerminalStub) supplies
    // a defensible fallback record. Static is intentionally narrow — only
    // returns positive matches from its curated catalog.
    if (!entry) return null;

    const exists = entry.exists !== false && entry.level !== 'D';
    return {
      exists,
      name:            entry.name,
      level:           entry.level,
      module:          entry.module,
      enhancementSpot: entry.enhancementSpot ?? null,
      interfaceName:   entry.interface ?? null,
      description:     entry.description,
      alternative:     entry.alternative ?? null,
      providerId:      this.id,
      catalogVersion:  catalog._metadata.schemaVersion
    };
  }

  // -------------------------------------------------------------------
  // verifyExit
  // -------------------------------------------------------------------

  public async verifyExit(
    name: string,
    programName?: string,
    _exitType?: ExitType
  ): Promise<ExitRecord | null> {
    if (!name?.trim()) return null;
    const { catalog, index } = this.getExitIndex();
    const matches = index.get(name.trim().toUpperCase());

    // Null on miss — TerminalStub at the end of the chain produces the
    // hallucination-guard message.
    if (!matches || matches.length === 0) return null;

    let entry = matches[0]!;
    if (matches.length > 1 && programName) {
      const wanted   = programName.trim().toUpperCase();
      const byProgram = matches.find(e => e.program && e.program.toUpperCase() === wanted);
      if (byProgram) entry = byProgram;
    }

    const exists = entry.exists !== false && entry.level !== 'D';
    return {
      exists,
      name:           entry.name,
      type:           entry.type,
      level:          entry.level,
      module:         entry.module,
      program:        entry.program ?? null,
      include:        entry.include ?? null,
      enhancement:    entry.enhancement ?? null,
      functionModule: entry.function_module ?? null,
      description:    entry.description,
      alternative:    entry.alternative ?? null,
      providerId:     this.id,
      catalogVersion: catalog._metadata.schemaVersion
    };
  }

  // -------------------------------------------------------------------
  // checkCleanCoreLevel — exact match + heuristic fallback (Sprint-1 logic)
  // -------------------------------------------------------------------

  public async checkCleanCoreLevel(name: string, type: string): Promise<CleanCoreLevelRecord | null> {
    if (!name?.trim() || !type?.trim()) return null;
    const { catalog, index } = this.getCcIndex();
    const key   = ccKey(type, name);
    const entry = index.get(key);

    if (entry) {
      return {
        level:          entry.level,
        name:           entry.name,
        type:           entry.type,
        module:         entry.module,
        reasoning:      entry.reasoning ?? entry.description,
        alternatives:   entry.alternatives ?? [],
        confidence:     'high',
        providerId:     this.id,
        catalogVersion: catalog._metadata.schemaVersion
      };
    }

    // No curated entry — fall through. The heuristic verdicts moved to
    // TerminalStubProvider (the last provider in the composite chain) so that
    // Cloudification gets a shot at returning the SAP-published level before
    // we resort to name-pattern guesses.
    return null;
  }

  // -------------------------------------------------------------------
  // Catalog loaders (cached after first call)
  // -------------------------------------------------------------------

  private getBadiIndex(): { catalog: BadiCatalog; index: Map<string, BadiCatalogEntry> } {
    if (this._badiCatalog && this._badiByName) {
      return { catalog: this._badiCatalog, index: this._badiByName };
    }
    const raw = fs.readFileSync(path.join(this.catalogDir, 'badi-catalog.json'), 'utf-8');
    this._badiCatalog = JSON.parse(raw) as BadiCatalog;
    this._badiByName = new Map();
    for (const e of this._badiCatalog.badis) {
      this._badiByName.set(e.name.trim().toUpperCase(), e);
    }
    return { catalog: this._badiCatalog, index: this._badiByName };
  }

  private getExitIndex(): { catalog: ExitCatalog; index: Map<string, ExitCatalogEntry[]> } {
    if (this._exitCatalog && this._exitByName) {
      return { catalog: this._exitCatalog, index: this._exitByName };
    }
    const raw = fs.readFileSync(path.join(this.catalogDir, 'exit-catalog.json'), 'utf-8');
    this._exitCatalog = JSON.parse(raw) as ExitCatalog;
    this._exitByName = new Map();
    for (const e of this._exitCatalog.exits) {
      const key = e.name.trim().toUpperCase();
      let bucket = this._exitByName.get(key);
      if (!bucket) { bucket = []; this._exitByName.set(key, bucket); }
      bucket.push(e);
    }
    return { catalog: this._exitCatalog, index: this._exitByName };
  }

  private getCcIndex(): { catalog: CleanCoreCatalog; index: Map<string, CleanCoreCatalogEntry> } {
    if (this._ccCatalog && this._ccByKey) {
      return { catalog: this._ccCatalog, index: this._ccByKey };
    }
    const raw = fs.readFileSync(path.join(this.catalogDir, 'clean-core-objects.json'), 'utf-8');
    this._ccCatalog = JSON.parse(raw) as CleanCoreCatalog;
    this._ccByKey = new Map();
    for (const e of this._ccCatalog.objects) {
      this._ccByKey.set(ccKey(e.type, e.name), e);
    }
    return { catalog: this._ccCatalog, index: this._ccByKey };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultCatalogDir(): string {
  // __dirname at runtime is dist/src/providers/, walk up three to the package
  // root (out of providers/, src/, dist/), then into catalog/.
  return path.resolve(__dirname, '..', '..', '..', 'catalog');
}

function ccKey(type: string, name: string): string {
  return `${type.trim().toUpperCase()}::${name.trim().toUpperCase()}`;
}
