/**
 * GetCboPattern — returns the canonical Custom Business Object pattern.
 *
 * Use when the FDS calls for NEW persistent custom data — fields that don't
 * map to any released SAP table. The pattern replaces the old habit of
 * "create a Z-table and INSERT directly into it" (Level C) with a fully
 * RAP-managed Custom Business Object (Level A): persistent table + CDS
 * interface + managed BDEF + behavior pool + projection + service binding.
 *
 * Sprint 4 — primary use case is the TDS Agent. When the FDS says "store
 * audit trail / approval status / custom backorder header", the TDS object
 * list should be the CBO 7-piece structure, not a classic Z-table + report.
 *
 * Embedded pattern. The structure is small and stable; a future session can
 * augment with index-backed lookup for richer scenario-specific guidance.
 */

'use strict';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GetCboPatternInput {
  scenario:         string;          // free-text description, e.g. "backorder log header"
  required_fields?: string[];        // optional, used to shape the example DDL
}

export interface CboObject {
  role:        string;
  type:        string;     // 'TABL', 'DDLS', 'BDEF', 'CLAS', 'SRVD', 'SRVB'
  namingHint:  string;
  notes?:      string;
}

export interface GetCboPatternOutput {
  scenario:        string;
  pattern:         string;             // human-readable description
  requiredObjects: CboObject[];        // drives the TDS object list
  ddlTemplate:     string;             // sample persistent table + CDS shape
  bdefTemplate:    string;             // managed BDEF skeleton
  cleanCoreLevel:  'A';
  rationale:       string;
  doNotUse:        string;
  source:          'embedded';
  catalogVersion:  string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const CATALOG_VERSION = '1.0.0';

const REQUIRED_OBJECTS: CboObject[] = [
  { role: 'Persistent table',     type: 'TABL', namingHint: 'Z<Entity>',
    notes: 'Customer-namespace transparent table that holds the CBO\'s data. UUID key recommended.' },
  { role: 'Interface CDS view',   type: 'DDLS', namingHint: 'ZI_<Entity>',
    notes: 'Layered over Z<Entity>. Defines fields, associations, annotations.' },
  { role: 'Managed BDEF',         type: 'BDEF', namingHint: 'ZI_<Entity>',
    notes: 'Declares CRUD, validations, determinations. "managed implementation in class ZBP_I_<Entity> unique;".' },
  { role: 'Behavior Pool class',  type: 'CLAS', namingHint: 'ZBP_I_<Entity>',
    notes: 'Hosts validation / determination / action method implementations.' },
  { role: 'Projection CDS view',  type: 'DDLS', namingHint: 'ZC_<Entity>',
    notes: 'Consumption-layer projection over ZI_<Entity>. UI annotations live here.' },
  { role: 'Projection BDEF',      type: 'BDEF', namingHint: 'ZC_<Entity>',
    notes: '"projection;" on top of the interface BDEF — controls what the service exposes.' },
  { role: 'Service Definition',   type: 'SRVD', namingHint: 'ZUI_<Entity>',
    notes: 'Exposes the projection CDS as an OData service.' },
  { role: 'Service Binding',      type: 'SRVB', namingHint: 'ZUI_<Entity>_O4',
    notes: 'OData V4 binding consumed by Fiori Elements.' }
];

function buildDdlTemplate(entityHint: string, fields: string[]): string {
  const fieldDecls = fields.length > 0
    ? fields.map(f => `  ${f.toLowerCase()}      TYPE char80,`).join('\n')
    : `  attribute_1      TYPE char80,\n  attribute_2      TYPE int4,`;
  return [
    `" Persistent table — paste into Z${entityHint}`,
    `@EndUserText.label   : '${entityHint} (Custom Business Object)'`,
    `@AbapCatalog.enhancement.category   : #EXTENSIBLE_ANY`,
    `define table z${entityHint.toLowerCase()} {`,
    `  key client         : abap.clnt not null;`,
    `  key ${entityHint.toLowerCase()}_uuid : sysuuid_x16 not null;`,
    fieldDecls,
    `  last_changed_at    : abp_lastchange_tstmpl;`,
    `  created_by         : abp_creation_user;`,
    `  created_at         : abp_creation_tstmpl;`,
    `  local_last_changed_by : abp_locinst_lastchange_user;`,
    `  local_last_changed_at : abp_locinst_lastchange_tstmpl;`,
    `}`
  ].join('\n');
}

function buildBdefTemplate(entityHint: string): string {
  return [
    `" Managed BDEF — paste into ZI_${entityHint}`,
    `managed implementation in class zbp_i_${entityHint.toLowerCase()} unique;`,
    `strict ( 2 );`,
    `with draft;`,
    ``,
    `define behavior for ZI_${entityHint} alias ${entityHint}`,
    `persistent table z${entityHint.toLowerCase()}`,
    `lock master`,
    `authorization master ( instance )`,
    `etag master last_changed_at`,
    `{`,
    `  create;`,
    `  update;`,
    `  delete;`,
    ``,
    `  field ( readonly, numbering : managed ) ${entityHint.toLowerCase()}_uuid;`,
    `  field ( mandatory ) attribute_1;`,
    ``,
    `  determination calculate_audit_fields on save { create; update; }`,
    `  validation    check_mandatory          on save { create; update; }`,
    ``,
    `  mapping for z${entityHint.toLowerCase()} {`,
    `    ${entityHint.toLowerCase()}_uuid = ${entityHint.toLowerCase()}_uuid;`,
    `  }`,
    `}`
  ].join('\n');
}

export function getCboPattern(input: GetCboPatternInput): GetCboPatternOutput {
  if (!input || typeof input.scenario !== 'string' || input.scenario.trim().length === 0) {
    throw new Error('get_cbo_pattern: scenario is required.');
  }

  // Derive a tidy entity hint from the free-text scenario (alphanumeric, PascalCase-ish).
  const entityHint = input.scenario
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('')
    .slice(0, 30) || 'CustomEntity';

  return {
    scenario:        input.scenario,
    pattern:
      'Custom Business Object (CBO) — the Level A pattern for net-new persistent ' +
      'custom data on S/4HANA Cloud and Private editions. Wraps a Z-table in a fully ' +
      'RAP-managed stack so it participates in the standard transactional lifecycle, ' +
      'inherits the authorization model, gets a generated OData service, and is ' +
      'consumable from Fiori Elements without further code.',
    requiredObjects: REQUIRED_OBJECTS,
    ddlTemplate:     buildDdlTemplate(entityHint, input.required_fields ?? []),
    bdefTemplate:    buildBdefTemplate(entityHint),
    cleanCoreLevel:  'A',
    rationale:
      'Direct INSERT/UPDATE/DELETE on a Z-table is Level C and breaks Cloud compatibility — ' +
      'it bypasses the standard transactional lifecycle, authorization checks, and audit. ' +
      'A CBO encodes the same data as a managed RAP business object: Level A, upgrade-safe, ' +
      'transactional, with a free OData service.',
    doNotUse:
      'Do NOT generate a Z-table plus a SAP-classic program that does INSERT INTO ztab. ' +
      'Do NOT generate a custom log table when the SLG1 Application Log already covers ' +
      'the use case (see get_application_log_pattern). Do NOT add a CBO when a released ' +
      'SAP CDS view + RAP BDEF already exposes the data you need.',
    source:          'embedded',
    catalogVersion:  CATALOG_VERSION
  };
}
