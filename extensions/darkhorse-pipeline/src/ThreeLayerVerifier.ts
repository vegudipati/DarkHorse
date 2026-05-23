/**
 * ThreeLayerVerifier — CPI-6 A1 pre-generation Clean Core layering check.
 *
 * Where CleanCoreVerifier scans GENERATED CODE for forbidden references,
 * this module scans the TDS abapObjectList BEFORE code generation runs and
 * flags entities whose layer set is incomplete relative to the SAP RAP
 * three-layer contract:
 *
 *   1. ZI_<Entity>      — Interface view  (DDLS, pure projection)
 *   2. ZC_<Entity>      — Consumption view (DDLS, carries @UI / @Search / @ObjectModel)
 *   3. ZBP_I_<Entity>   — Behavior projection class (CLAS, OPTIONAL for read-only)
 *   4. <BDEF for ZI_*>  — Behavior definition (BDEF, REQUIRED if transactional)
 *   5. ZUI_<Entity>     — Service definition (SRVD, expose ZC_<Entity>)
 *   6. ZUI_<Entity>_O4  — Service binding (SRVB, OData v4)
 *
 * The verifier returns a structured report the TDS panel can render. Any
 * service-bearing entity (anchored on the SRVD object whose name starts with
 * ZUI_) is checked. Missing layers produce findings with a suggested name
 * the developer can insert with one click.
 *
 * Cross-module rule: this file is DETERMINISTIC. It does not call MCP and
 * does not look at generated code. It only reads TDS metadata.
 */

'use strict';

import { AbapObject } from './PipelineStateManager';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LayerRole =
  | 'interface'         // ZI_*
  | 'consumption'       // ZC_*
  | 'behaviorProj'      // ZBP_I_*
  | 'behaviorDef'       // BDEF for ZI_*
  | 'serviceDef'        // ZUI_*
  | 'serviceBinding'    // ZUI_*_O4
  | 'dcl';              // DCLS access role for ZI_<stem>  (CPI-6 A3)

export interface MissingLayer {
  role:           LayerRole;
  /** Suggested SAP object type for the missing layer (DDLS, BDEF, SRVD, SRVB, CLAS). */
  objectType:     string;
  /** Suggested object name derived from the entity stem. */
  suggestedName:  string;
  /** Human-readable explanation of why this layer is needed. */
  rationale:      string;
  /** Whether the missing layer blocks code generation (currently false for all
   *  — A1 surfaces but does not gate. A future revision may promote to true). */
  blocking:       boolean;
}

export interface EntityCluster {
  /** Bare entity stem, e.g. "OTC_ROUTING_DETAIL". Derived from the SRVD or ZI_ name. */
  entity:        string;
  /** Whether the cluster is transactional (has writes / BDEF intent). */
  transactional: boolean;
  /** Layer name -> AbapObject that fills the role (if present). */
  present:       Partial<Record<LayerRole, AbapObject>>;
  /** Layers the developer still needs to add. */
  missing:       MissingLayer[];
}

export interface ThreeLayerReport {
  scannedAt:        string;
  /** Each service-bearing entity gets one cluster with its layer status. */
  clusters:         EntityCluster[];
  /** Aggregate count across all clusters. */
  totalMissing:     number;
  /** True when every cluster has the full required layer set. */
  pass:             boolean;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/** Matches a Z* CDS interface view, e.g. ZI_OTC_ROUTING_DETAIL. */
const RX_INTERFACE   = /^ZI_([A-Z][A-Z0-9_]*)$/i;
/** Matches a Z* CDS consumption view, e.g. ZC_OTC_ROUTING_DETAIL. */
const RX_CONSUMPTION = /^ZC_([A-Z][A-Z0-9_]*)$/i;
/** Matches a behavior projection class, e.g. ZBP_I_OTC_ROUTING_DETAIL. */
const RX_BEHAVIOR_P  = /^ZBP_I_([A-Z][A-Z0-9_]*)$/i;
/** Matches a service definition, e.g. ZUI_OTC_ROUTING_DETAIL. */
const RX_SERVICE_DEF = /^ZUI_([A-Z][A-Z0-9_]*)$/i;
/** Matches a service binding, e.g. ZUI_OTC_ROUTING_DETAIL_O4. */
const RX_SERVICE_BIND = /^ZUI_([A-Z][A-Z0-9_]*)_O4$/i;

function extractEntity(
  name: string,
  objectType: string
): { role: LayerRole | null; entity: string | null } {
  const trimmed = name.trim().toUpperCase();
  const type    = (objectType ?? '').trim().toUpperCase();
  // Order matters: SRVB (_O4 suffix) must be tested before SRVD because every
  // SRVB also matches the SRVD pattern.
  let m: RegExpExecArray | null;
  if ((m = RX_SERVICE_BIND.exec(trimmed))) return { role: 'serviceBinding', entity: m[1]! };
  if ((m = RX_SERVICE_DEF.exec(trimmed)))  return { role: 'serviceDef',     entity: m[1]! };
  if ((m = RX_BEHAVIOR_P.exec(trimmed)))   return { role: 'behaviorProj',   entity: m[1]! };
  // DCL roles conventionally share the name of the interface view they
  // protect (define role ZI_<stem>). Disambiguate using the object type
  // BEFORE the bare interface-pattern check, otherwise every DCLS would be
  // mis-classified as an interface view.
  if ((m = RX_INTERFACE.exec(trimmed))) {
    if (type === 'DCLS') return { role: 'dcl',       entity: m[1]! };
    return                     { role: 'interface', entity: m[1]! };
  }
  if ((m = RX_CONSUMPTION.exec(trimmed)))  return { role: 'consumption',    entity: m[1]! };
  return { role: null, entity: null };
}

/** True when the object is a BDEF and its body / dependencies reference a
 *  matching ZI_<entity>. */
function bdefBindsEntity(obj: AbapObject, entity: string): boolean {
  if ((obj.objectType ?? '').toUpperCase() !== 'BDEF') return false;
  const target = `ZI_${entity}`.toUpperCase();
  const corpus = [
    obj.objectName ?? '',
    obj.description ?? '',
    ...(obj.keyLogic ?? []),
    ...(obj.dependencies ?? [])
  ].join('\n').toUpperCase();
  return new RegExp(`\\b${target}\\b`).test(corpus);
}

/** Transactional intent: keyLogic / description mentions create / update / delete /
 *  insert / draft, OR a BDEF is present. */
const RX_WRITE_INTENT = /\b(create|insert|add|post|update|modify|change|amend|delete|remove|cancel|void|draft|save\s+new|generate\s+a\s+new)\b/i;
function detectTransactional(cluster: EntityCluster, all: AbapObject[]): boolean {
  if (cluster.present.behaviorDef) return true;
  for (const o of Object.values(cluster.present)) {
    if (!o) continue;
    const corpus = [
      o.description ?? '',
      ...(o.keyLogic ?? []),
      ...(o.dependencies ?? [])
    ].join('\n');
    if (RX_WRITE_INTENT.test(corpus)) return true;
  }
  for (const o of all) {
    if (bdefBindsEntity(o, cluster.entity)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cluster builder
// ---------------------------------------------------------------------------

function makeMissing(
  entity: string,
  role: LayerRole
): MissingLayer {
  switch (role) {
    case 'interface':
      return {
        role, objectType: 'DDLS',
        suggestedName: `ZI_${entity}`,
        rationale:
          'Interface view (ZI_*) is the bottom layer of the Clean Core three-layer ' +
          'pattern. It projects fields from the source table(s) with no UI metadata.',
        blocking: false
      };
    case 'consumption':
      return {
        role, objectType: 'DDLS',
        suggestedName: `ZC_${entity}`,
        rationale:
          'Consumption view (ZC_*) projects the interface view and carries @UI, ' +
          '@Search.searchable, @ObjectModel and field-level auth annotations. The ' +
          'service definition must expose this view, not the interface view.',
        blocking: false
      };
    case 'behaviorProj':
      return {
        role, objectType: 'CLAS',
        suggestedName: `ZBP_I_${entity}`,
        rationale:
          'Behavior projection class implements behavior characteristics declared ' +
          'in the behavior definition for transactional entities. Read-only ' +
          'entities may omit this.',
        blocking: false
      };
    case 'behaviorDef':
      return {
        role, objectType: 'BDEF',
        suggestedName: `ZI_${entity}`,
        rationale:
          'Behavior definition (BDEF) declares which RAP write operations the ' +
          'interface view supports. Transactional entities require this.',
        blocking: false
      };
    case 'serviceDef':
      return {
        role, objectType: 'SRVD',
        suggestedName: `ZUI_${entity}`,
        rationale:
          'Service definition (SRVD) exposes the consumption view to consumers.',
        blocking: false
      };
    case 'serviceBinding':
      return {
        role, objectType: 'SRVB',
        suggestedName: `ZUI_${entity}_O4`,
        rationale:
          'Service binding (SRVB) publishes the service definition as an OData ' +
          'v4 endpoint that Fiori Elements and external consumers can call.',
        blocking: false
      };
    case 'dcl':
      return {
        role, objectType: 'DCLS',
        suggestedName: `ZI_${entity}`,
        rationale:
          'Data Control Language (DCL) role enforces authorization on the ' +
          'interface view ZI_<entity>. Any CDS view exposed via SRVD must be ' +
          'protected by a matching DCL role; without it the service leaks data. ' +
          'The DCL role name conventionally matches the interface view name.',
        blocking: false
      };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function verifyThreeLayer(objects: ReadonlyArray<AbapObject>): ThreeLayerReport {
  const scannedAt = new Date().toISOString();

  // 1. Group objects by entity stem. Any of {interface, consumption, behaviorProj,
  //    serviceDef, serviceBinding} can anchor a cluster — typically the SRVD or
  //    the ZI_ view does. BDEF binding is resolved separately because its name
  //    is unconstrained (it's named after the interface view it binds).
  const clusters = new Map<string, EntityCluster>();
  const all = objects as AbapObject[];

  for (const obj of all) {
    const { role, entity } = extractEntity(obj.objectName ?? '', obj.objectType ?? '');
    if (!role || !entity) continue;

    let c = clusters.get(entity);
    if (!c) {
      c = { entity, transactional: false, present: {}, missing: [] };
      clusters.set(entity, c);
    }
    // First-wins per role — duplicates are TDS errors, not our problem to fix.
    if (!c.present[role]) {
      c.present[role] = obj;
    }
  }

  // 2. Hook up BDEF matches (named after the interface view).
  for (const c of clusters.values()) {
    for (const obj of all) {
      if (bdefBindsEntity(obj, c.entity)) {
        c.present.behaviorDef = obj;
        break;
      }
    }
  }

  // 3. Decide transactional for each cluster.
  for (const c of clusters.values()) {
    c.transactional = detectTransactional(c, all);
  }

  // 4. Compute missing layers. The required set differs by cluster shape:
  //    - Any cluster with EITHER interface, consumption, serviceDef, or
  //      serviceBinding present is treated as "service-bearing" and needs
  //      ZI_/ZC_/ZUI_/ZUI__O4 at minimum.
  //    - Transactional clusters additionally need BDEF + ZBP_I_*.
  for (const c of clusters.values()) {
    const isServiceBearing =
      Boolean(c.present.interface) ||
      Boolean(c.present.consumption) ||
      Boolean(c.present.serviceDef) ||
      Boolean(c.present.serviceBinding);
    if (!isServiceBearing) continue;

    const required: LayerRole[] = ['interface', 'consumption', 'serviceDef', 'serviceBinding', 'dcl'];
    if (c.transactional) {
      required.push('behaviorDef', 'behaviorProj');
    }

    for (const role of required) {
      if (!c.present[role]) {
        c.missing.push(makeMissing(c.entity, role));
      }
    }
  }

  const clusterList = Array.from(clusters.values())
    .filter(c => c.missing.length > 0 || Object.keys(c.present).length > 0);

  const totalMissing = clusterList.reduce((sum, c) => sum + c.missing.length, 0);

  return {
    scannedAt,
    clusters: clusterList,
    totalMissing,
    pass: totalMissing === 0
  };
}

// ---------------------------------------------------------------------------
// Human-readable rendering — used by the TDS panel modal
// ---------------------------------------------------------------------------

export function renderThreeLayerSummary(report: ThreeLayerReport): string {
  if (report.pass) {
    return 'Three-layer check: PASS — every service-bearing entity has all required layers.';
  }
  const blocks = report.clusters
    .filter(c => c.missing.length > 0)
    .map(c => {
      const present = Object.entries(c.present)
        .map(([role, obj]) => `${role}=${obj!.objectName}`)
        .join(', ');
      const missing = c.missing
        .map(m => `${m.role} (${m.objectType} ${m.suggestedName})`)
        .join(', ');
      return `  - ${c.entity} [${c.transactional ? 'transactional' : 'read-only'}]\n      Present: ${present || '(none)'}\n      Missing: ${missing}`;
    })
    .join('\n');
  return [
    `Three-layer check: ${report.totalMissing} missing layer(s) across ${report.clusters.filter(c => c.missing.length > 0).length} entity cluster(s).`,
    '',
    blocks
  ].join('\n');
}
