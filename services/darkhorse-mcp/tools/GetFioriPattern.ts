/**
 * GetFioriPattern — returns the canonical Fiori Elements pattern for a UI
 * scenario, biased to the 80% case (Fiori Elements templates over Freestyle
 * UI5).
 *
 * Item-2 default policy (per Deloitte standard):
 *   - Fiori Elements is the DEFAULT for ~80% of enterprise UI scenarios.
 *   - Freestyle UI5 is the EXCEPTION, used only when:
 *       * Custom controls or animations outside Fiori templates
 *       * Third-party library integrations (D3.js, Leaflet, etc.)
 *       * Guided multi-step wizards beyond standard process flow
 *       * Consumer-grade experiences beyond enterprise norms
 *   - Selection by decision tree:
 *       Can the app be expressed via CDS annotations? -> Fiori Elements
 *       Need custom controls / third-party integrations? -> Freestyle UI5
 *       Standard business process w/ some customization? -> FE + extensions
 *
 * Five Fiori Elements templates are exposed:
 *   list_report          — tabular data with filter bar
 *   object_page          — single-object detail / edit
 *   analytical_list_page — analytical / KPI report with chart + table
 *   overview_page        — dashboard with multiple cards
 *   worklist             — task-style inbox/processing
 *
 * Plus freestyle_ui5 as an explicit exception scenario.
 *
 * Embedded pattern. The 6 templates are stable; a future session can fetch
 * fresh manifest snippets from the SAP Architecture Center if needed.
 */

'use strict';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FioriScenario =
  | 'LIST_REPORT'
  | 'OBJECT_PAGE'
  | 'ANALYTICAL_LIST_PAGE'
  | 'OVERVIEW_PAGE'
  | 'WORKLIST'
  | 'FREESTYLE_UI5';

export interface GetFioriPatternInput {
  scenario:     FioriScenario | string;
  entity_hint?: string;          // optional entity name to substitute in templates
}

export interface FioriObject {
  role:        string;
  type:        string;     // 'DDLS' | 'BDEF' | 'CLAS' | 'SRVD' | 'SRVB' | 'UI5_APP'
  namingHint:  string;
  notes?:      string;
}

export interface GetFioriPatternOutput {
  scenario:        FioriScenario;
  pattern:         string;             // human-readable description
  whenToUse:       string;             // decision criteria
  requiredObjects: FioriObject[];      // drives the TDS abapObjectList
  cdsAnnotations:  string;             // sample @UI annotations to paste
  manifestSnippet: string;             // sample webapp/manifest.json template
  cleanCoreLevel:  'A' | 'B';
  source:          'embedded';
  catalogVersion:  string;
}

// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------

const CATALOG_VERSION = '1.0.0';

const COMMON_OBJECTS: (entity: string) => FioriObject[] = (entity) => ([
  { role: 'Interface CDS',     type: 'DDLS', namingHint: `ZI_${entity}`,
    notes: 'Data model layer; @ObjectModel + key fields + associations.' },
  { role: 'Projection CDS',    type: 'DDLS', namingHint: `ZC_${entity}`,
    notes: 'Consumption layer; @UI annotations and field-level metadata live here.' },
  { role: 'Projection BDEF',   type: 'BDEF', namingHint: `ZC_${entity}`,
    notes: '"projection;" on the interface BDEF; controls what the service exposes.' },
  { role: 'Service Definition', type: 'SRVD', namingHint: `ZUI_${entity}`,
    notes: 'Exposes the projection CDS as an OData V4 service.' },
  { role: 'Service Binding',   type: 'SRVB', namingHint: `ZUI_${entity}_O4`,
    notes: 'OData V4 binding consumed by Fiori Elements.' }
]);

const LR_ANNOTATIONS = (entity: string) => [
  `// Paste into ZC_${entity}:`,
  `@UI.headerInfo: { typeName: '${entity}', typeNamePlural: '${entity}s' }`,
  `@UI.lineItem: [`,
  `  { position: 10, label: 'Key' },          // -> key field`,
  `  { position: 20, label: 'Description' },  // -> description field`,
  `  { position: 30, label: 'Status' }`,
  `]`,
  `@UI.selectionField: [`,
  `  { position: 10 },  // -> filterable key field`,
  `  { position: 20 }`,
  `]`
].join('\n');

const OP_ANNOTATIONS = (entity: string) => [
  `// Paste into ZC_${entity}:`,
  `@UI.headerInfo: {`,
  `  typeName: '${entity}',`,
  `  typeNamePlural: '${entity}s',`,
  `  title: { type: #STANDARD, value: 'Description' }`,
  `}`,
  `@UI.facet: [`,
  `  { id: 'GeneralInfo',  type: #IDENTIFICATION_REFERENCE, label: 'General', position: 10 },`,
  `  { id: 'AdminData',    type: #FIELDGROUP_REFERENCE,     targetQualifier: 'AdminData', label: 'Admin', position: 20 }`,
  `]`,
  `@UI.identification: [`,
  `  { position: 10, label: 'Description' },`,
  `  { position: 20, label: 'Status' }`,
  `]`
].join('\n');

const ALP_ANNOTATIONS = (entity: string) => [
  `// Paste into ZC_${entity}:`,
  `@Analytics.query: true`,
  `@AccessControl.authorizationCheck: #CHECK`,
  `define view entity ZC_${entity}`,
  `  provider contract analytical_query`,
  `  as projection on ZI_${entity}`,
  `{`,
  `  @AnalyticsDetails.query.axis: #ROWS`,
  `  key dimension_field,`,
  `  @AnalyticsDetails.query.axis: #COLUMNS`,
  `  @DefaultAggregation: #SUM`,
  `  numeric_measure`,
  `}`
].join('\n');

const MANIFEST_FE = (template: 'lr' | 'op' | 'alp' | 'ovp' | 'wl') => {
  const templateName = {
    lr:  'sap.fe.templates.ListReport',
    op:  'sap.fe.templates.ObjectPage',
    alp: 'sap.fe.templates.AnalyticalListPage',
    ovp: 'sap.fe.templates.OverviewPage',
    wl:  'sap.fe.templates.Worklist'
  }[template];
  return [
    `{`,
    `  "sap.app": {`,
    `    "id": "z.darkhorse.app",`,
    `    "type": "application",`,
    `    "dataSources": {`,
    `      "mainService": {`,
    `        "uri": "/sap/opu/odata4/sap/ZUI_<ENTITY>_O4/srvd/sap/ZUI_<ENTITY>/0001/",`,
    `        "type": "OData",`,
    `        "settings": { "odataVersion": "4.0" }`,
    `      }`,
    `    }`,
    `  },`,
    `  "sap.ui5": {`,
    `    "routing": {`,
    `      "routes": [`,
    `        { "pattern": ":?query:", "name": "Main", "target": "Main" }`,
    `      ],`,
    `      "targets": {`,
    `        "Main": {`,
    `          "type": "Component",`,
    `          "id": "Main",`,
    `          "name": "${templateName}",`,
    `          "options": {`,
    `            "settings": { "contextPath": "/<Entity>" }`,
    `          }`,
    `        }`,
    `      }`,
    `    }`,
    `  }`,
    `}`
  ].join('\n');
};

interface FioriTemplate {
  pattern:         string;
  whenToUse:       string;
  buildObjects:    (entity: string) => FioriObject[];
  cdsAnnotations:  (entity: string) => string;
  manifestSnippet: () => string;
  cleanCoreLevel:  'A' | 'B';
}

const TEMPLATES: Record<FioriScenario, FioriTemplate> = {

  LIST_REPORT: {
    pattern:
      'Fiori Elements List Report (LR) — the canonical pattern for tabular data with a ' +
      'filter bar at top and a results table below. Default UI for any "show me a list of X" ' +
      'requirement. Drill-down to Object Page is the standard navigation.',
    whenToUse:
      'Use when the BR is "show / search / filter a list of business objects" and the developer ' +
      'has CDS-modeled data. ~70% of CRUD apps land here.',
    buildObjects:    (e) => [
      ...COMMON_OBJECTS(e),
      { role: 'UI5 application',   type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_lr`,
        notes: 'Fiori Elements List Report app. manifest.json points at sap.fe.templates.ListReport.' }
    ],
    cdsAnnotations:  LR_ANNOTATIONS,
    manifestSnippet: () => MANIFEST_FE('lr'),
    cleanCoreLevel:  'A'
  },

  OBJECT_PAGE: {
    pattern:
      'Fiori Elements Object Page (OP) — single-object detail / edit / create view. ' +
      'Used WITH a List Report for the parent and a Object Page for the detail navigation. ' +
      'Supports headers, facets (sections), and identifications (fields).',
    whenToUse:
      'Use for the detail / edit screen of a single business object. Almost always pairs ' +
      'with a List Report.',
    buildObjects:    (e) => [
      ...COMMON_OBJECTS(e),
      { role: 'UI5 application',   type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_op`,
        notes: 'Fiori Elements Object Page. Hosted with the matching List Report.' }
    ],
    cdsAnnotations:  OP_ANNOTATIONS,
    manifestSnippet: () => MANIFEST_FE('op'),
    cleanCoreLevel:  'A'
  },

  ANALYTICAL_LIST_PAGE: {
    pattern:
      'Fiori Elements Analytical List Page (ALP) — analytical / KPI report with chart on top, ' +
      'filter bar, and analytical table below. Uses RAP analytical_query provider contract on ' +
      'the CDS projection. THIS REPLACES CLASSIC ALV REPORTS for any new analytical work.',
    whenToUse:
      'Use whenever the BR says "report", "analysis", "trend", "KPI dashboard with filters", ' +
      'or "drill-down by dimension". Default for new reports — CL_SALV_TABLE classic ALV is ' +
      'Level B fallback only when a Fiori-capable backend is unavailable.',
    buildObjects:    (e) => [
      ...COMMON_OBJECTS(e),
      { role: 'UI5 application',   type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_alp`,
        notes: 'Fiori Elements Analytical List Page. Reads from the @Analytics.query CDS.' }
    ],
    cdsAnnotations:  ALP_ANNOTATIONS,
    manifestSnippet: () => MANIFEST_FE('alp'),
    cleanCoreLevel:  'A'
  },

  OVERVIEW_PAGE: {
    pattern:
      'Fiori Elements Overview Page (OVP) — card-based dashboard. Each card is backed by a ' +
      'separate CDS view (often analytical). Used as a launchpad-style landing page.',
    whenToUse:
      'Use when the BR is "dashboard" / "executive summary" / "land at multiple KPIs". ' +
      'Multiple analytical CDS views feed the cards.',
    buildObjects:    (e) => [
      { role: 'Card CDS views',     type: 'DDLS',    namingHint: `ZC_${e}_<KPI>`,
        notes: 'One CDS view per card. Each typically @Analytics.query + chart annotations.' },
      { role: 'Service Definition', type: 'SRVD',    namingHint: `ZUI_${e}_OVP` },
      { role: 'Service Binding',    type: 'SRVB',    namingHint: `ZUI_${e}_OVP_O4` },
      { role: 'UI5 OVP application',type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_ovp`,
        notes: 'manifest.json points at sap.fe.templates.OverviewPage with N card targets.' }
    ],
    cdsAnnotations:  () =>
      '// Each OVP card needs its own CDS view with @UI.chart or @UI.lineItem annotations.\n' +
      '// See the LR / ALP examples above for the per-card pattern.',
    manifestSnippet: () => MANIFEST_FE('ovp'),
    cleanCoreLevel:  'A'
  },

  WORKLIST: {
    pattern:
      'Fiori Elements Worklist — task-style inbox where each row is an actionable item ' +
      '(approve / reject / process). Built on the same LR foundation but with @UI.lineItem ' +
      'actions per row.',
    whenToUse:
      'Use when the BR is "approval workflow" / "task inbox" / "process pending items". ' +
      'Pairs with a behavior definition that exposes action methods.',
    buildObjects:    (e) => [
      ...COMMON_OBJECTS(e),
      { role: 'UI5 worklist app',   type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_wl`,
        notes: 'Manifest -> sap.fe.templates.Worklist. Actions on @UI.lineItem trigger BDEF actions.' }
    ],
    cdsAnnotations:  LR_ANNOTATIONS,
    manifestSnippet: () => MANIFEST_FE('wl'),
    cleanCoreLevel:  'A'
  },

  FREESTYLE_UI5: {
    pattern:
      'Freestyle SAPUI5 — full UI5 application coded against the OData service. Exception ' +
      'pattern only. Loses the automatic Fiori-Elements benefits (smart filter bar, list-page ' +
      'flexibility, side-effect handling, draft handling) — those have to be rebuilt manually.',
    whenToUse:
      'Use ONLY when ONE of these holds, and the FDS must explicitly justify why: ' +
      '(a) custom controls / animations outside Fiori templates, ' +
      '(b) third-party library integrations such as D3.js, Leaflet, custom chart libraries, ' +
      '(c) guided multi-step wizards beyond standard process flow, ' +
      '(d) consumer-grade UX beyond enterprise norms. ' +
      'For 80% of enterprise apps, one of the Fiori Elements templates fits better.',
    buildObjects:    (e) => [
      { role: 'Interface CDS',      type: 'DDLS',    namingHint: `ZI_${e}` },
      { role: 'Service Definition', type: 'SRVD',    namingHint: `ZUI_${e}` },
      { role: 'Service Binding',    type: 'SRVB',    namingHint: `ZUI_${e}_O4` },
      { role: 'UI5 application',    type: 'UI5_APP', namingHint: `z_${e.toLowerCase()}_fs`,
        notes: 'Freestyle UI5. manifest.json declares custom views and routes; controllers ' +
               'live under webapp/controller. Document the justification per the whenToUse rule.' }
    ],
    cdsAnnotations:  () =>
      '// Freestyle UI5 reads OData directly; @UI annotations are optional but recommended ' +
      'so the same service can be reused by Fiori Elements consumers in the future.',
    manifestSnippet:
      () => [
        `{`,
        `  "sap.app": { "id": "z.darkhorse.freestyle.app", "type": "application" },`,
        `  "sap.ui5": {`,
        `    "rootView": {`,
        `      "viewName": "z.darkhorse.freestyle.view.App",`,
        `      "type": "XML",`,
        `      "id": "app"`,
        `    },`,
        `    "routing": {`,
        `      "config": { "routerClass": "sap.m.routing.Router", "viewType": "XML", ... },`,
        `      "routes": [ ... ],`,
        `      "targets": { ... }`,
        `    }`,
        `  }`,
        `}`
      ].join('\n'),
    cleanCoreLevel: 'B'
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getFioriPattern(input: GetFioriPatternInput): GetFioriPatternOutput {
  if (!input || typeof input.scenario !== 'string' || input.scenario.trim().length === 0) {
    throw new Error('get_fiori_pattern: scenario is required (LIST_REPORT | OBJECT_PAGE | ANALYTICAL_LIST_PAGE | OVERVIEW_PAGE | WORKLIST | FREESTYLE_UI5).');
  }
  const scenario = input.scenario.trim().toUpperCase() as FioriScenario;
  const tpl = TEMPLATES[scenario];
  if (!tpl) {
    throw new Error(`get_fiori_pattern: unknown scenario "${input.scenario}". Known: ${Object.keys(TEMPLATES).join(', ')}`);
  }
  const entity = (input.entity_hint ?? '').replace(/[^A-Za-z0-9_]+/g, '').slice(0, 30) || 'YourEntity';
  return {
    scenario,
    pattern:         tpl.pattern,
    whenToUse:       tpl.whenToUse,
    requiredObjects: tpl.buildObjects(entity),
    cdsAnnotations:  tpl.cdsAnnotations(entity),
    manifestSnippet: tpl.manifestSnippet(),
    cleanCoreLevel:  tpl.cleanCoreLevel,
    source:          'embedded',
    catalogVersion:  CATALOG_VERSION
  };
}
