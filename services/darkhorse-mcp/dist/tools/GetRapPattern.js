/**
 * GetRapPattern — returns the canonical RAP layered structure for a scenario.
 *
 * Sprint 3 Session 1: the Code Agent calls this BEFORE deciding the object
 * list for a new transactional development. The returned `requiredObjects`
 * array drives what the TDS Agent generates (BDEF + BBEH + SRVD + CDS data
 * model, NOT classic PROG/FUGR).
 *
 * Embedded patterns cover the common scenarios. A future session can
 * augment with index-backed semantic lookup for less common patterns.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRapPattern = getRapPattern;
// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------
const CATALOG_VERSION = '1.0.0';
const PATTERNS = {
    TRANSACTIONAL: {
        pattern: 'Standard transactional RAP business object — CDS data model + managed BDEF + behavior implementation class + service definition + UI/OData binding. Level A target for any new custom BO that needs create/read/update/delete.',
        requiredObjects: [
            { role: 'CDS data model', type: 'DDLS', namingHint: 'ZI_<Entity>', notes: 'Interface view over the persistent table; defines fields, associations, annotations.' },
            { role: 'Behavior Definition', type: 'BDEF', namingHint: 'ZI_<Entity>', notes: 'Same name as the CDS; declares managed/unmanaged, CRUD operations, validations, determinations, locking strategy.' },
            { role: 'Behavior Pool', type: 'CLAS', namingHint: 'ZBP_I_<Entity>', notes: 'Implementation class for validations / determinations / actions referenced by the BDEF.' },
            { role: 'CDS Projection View', type: 'DDLS', namingHint: 'ZC_<Entity>', notes: 'Consumption-layer projection — what the service exposes.' },
            { role: 'Projection BDEF', type: 'BDEF', namingHint: 'ZC_<Entity>', notes: 'Behavior projection — derives from the underlying BDEF, controls what is exposed.' },
            { role: 'Service Definition', type: 'SRVD', namingHint: 'ZUI_<Entity>', notes: 'Exposes the projection CDS as an OData service.' },
            { role: 'Service Binding', type: 'SRVB', namingHint: 'ZUI_<Entity>_O4', notes: 'Concrete OData V4 binding — used by Fiori Elements UI.' }
        ],
        codeTemplate: [
            '" Managed BDEF skeleton — paste into ZI_<Entity>',
            'managed implementation in class zbp_i_<entity> unique;',
            'strict ( 2 );',
            'with draft;',
            '',
            'define behavior for ZI_<Entity> alias <Entity>',
            'persistent table z<entity>',
            'lock master',
            'authorization master ( instance )',
            'etag master last_changed_at',
            '{',
            '  create;',
            '  update;',
            '  delete;',
            '',
            '  field ( readonly, numbering : managed ) <entity>_uuid;',
            '  field ( mandatory ) field1, field2;',
            '',
            '  determination calculateTotal on modify { field field1, field2; }',
            '  validation     mandatoryFields  on save   { create; update; }',
            '',
            '  mapping for z<entity> { <entity>_uuid = uuid; field1 = field1; }',
            '}',
            ''
        ].join('\n')
    },
    READ_ONLY_ANALYTICAL: {
        pattern: 'Read-only analytical / reporting consumption — CDS-only stack, no BDEF needed. Level A target for any reporting requirement.',
        requiredObjects: [
            { role: 'Interface CDS', type: 'DDLS', namingHint: 'ZI_<ReportName>', notes: 'Interface view selecting from released I_* views — never from SAP standard tables directly.' },
            { role: 'Projection CDS', type: 'DDLS', namingHint: 'ZC_<ReportName>', notes: '@AnalyticsDetails annotations for filters, drill-downs, currency conversion.' },
            { role: 'Service Definition', type: 'SRVD', namingHint: 'ZUI_<ReportName>', notes: 'Exposes the projection as an analytical OData service.' },
            { role: 'Service Binding', type: 'SRVB', namingHint: 'ZUI_<ReportName>_O4' }
        ],
        codeTemplate: [
            '" Projection CDS skeleton — analytical query',
            '@AccessControl.authorizationCheck: #CHECK',
            '@Metadata.allowExtensions: true',
            '@Search.searchable: true',
            '@Analytics.query: true',
            'define view entity ZC_<ReportName>',
            '  provider contract analytical_query',
            '  as projection on ZI_<ReportName>',
            '{',
            '  @AnalyticsDetails.query.axis: #COLUMNS',
            '  key field1,',
            '  @DefaultAggregation: #SUM',
            '  amount',
            '}'
        ].join('\n')
    },
    DRAFT_ENABLED: {
        pattern: 'Transactional RAP BO with draft handling — autosave, in-progress edits, draft / active separation. Level A target when end users edit complex objects across multiple sessions.',
        requiredObjects: [
            { role: 'Active table', type: 'TABL', namingHint: 'Z<Entity>', notes: 'Persistent table for active instances.' },
            { role: 'Draft table', type: 'TABL', namingHint: 'Z<Entity>_D', notes: 'Separate persistent table for drafts (suffix _D conventional).' },
            { role: 'CDS data model', type: 'DDLS', namingHint: 'ZI_<Entity>' },
            { role: 'BDEF with draft', type: 'BDEF', namingHint: 'ZI_<Entity>', notes: 'declare "with draft;" and "draft table z<entity>_d".' },
            { role: 'Behavior Pool', type: 'CLAS', namingHint: 'ZBP_I_<Entity>' },
            { role: 'Projection CDS + BDEF', type: 'DDLS', namingHint: 'ZC_<Entity>' },
            { role: 'Service Def + Binding', type: 'SRVD', namingHint: 'ZUI_<Entity>' }
        ],
        codeTemplate: [
            '" Draft-enabled BDEF skeleton',
            'managed with additional save implementation in class zbp_i_<entity> unique;',
            'with draft;',
            '',
            'define behavior for ZI_<Entity> alias <Entity>',
            'persistent table z<entity>',
            'draft     table z<entity>_d',
            'lock master total etag last_changed_at',
            'authorization master ( instance )',
            'etag master last_changed_at',
            '{',
            '  create;',
            '  update;',
            '  delete;',
            '  draft action Edit;',
            '  draft action Activate optimized;',
            '  draft action Discard;',
            '  draft determine action Prepare;',
            '}'
        ].join('\n')
    },
    MANAGED: {
        pattern: 'Managed implementation type — the RAP framework handles persistence automatically based on the BDEF declarations. Default for new custom BOs. Sub-set of TRANSACTIONAL.',
        requiredObjects: [
            { role: 'CDS data model', type: 'DDLS', namingHint: 'ZI_<Entity>' },
            { role: 'Managed BDEF', type: 'BDEF', namingHint: 'ZI_<Entity>', notes: 'managed implementation in class zbp_i_<entity> unique;' },
            { role: 'Behavior Pool', type: 'CLAS', namingHint: 'ZBP_I_<Entity>' }
        ],
        codeTemplate: 'managed implementation in class zbp_i_<entity> unique;\nstrict ( 2 );\n\ndefine behavior for ZI_<Entity> alias <Entity>\npersistent table z<entity>\nlock master\n{ create; update; delete; }\n'
    },
    UNMANAGED: {
        pattern: 'Unmanaged implementation type — the developer provides the persistence logic. Use when wrapping a legacy persistence layer or a non-trivial transactional API that the framework cannot model directly.',
        requiredObjects: [
            { role: 'CDS data model', type: 'DDLS', namingHint: 'ZI_<Entity>' },
            { role: 'Unmanaged BDEF', type: 'BDEF', namingHint: 'ZI_<Entity>', notes: 'unmanaged implementation in class zbp_i_<entity> unique;' },
            { role: 'Behavior Pool', type: 'CLAS', namingHint: 'ZBP_I_<Entity>', notes: 'Implements FOR MODIFY, FOR READ, FOR LOCK, SAVE_MODIFIED.' }
        ],
        codeTemplate: 'unmanaged implementation in class zbp_i_<entity> unique;\nstrict ( 2 );\n\ndefine behavior for ZI_<Entity> alias <Entity>\nlock master\n{ create; update; delete; }\n'
    },
    PROJECTION: {
        pattern: 'Service projection over an existing interface BDEF — exposes a subset of fields / actions for a specific consumer. Use when the same underlying BO must serve multiple UIs with different field sets.',
        requiredObjects: [
            { role: 'Projection CDS', type: 'DDLS', namingHint: 'ZC_<Entity>', notes: 'projection on ZI_<Entity>' },
            { role: 'Projection BDEF', type: 'BDEF', namingHint: 'ZC_<Entity>', notes: 'projection; on ZI_<Entity>' },
            { role: 'Service Def', type: 'SRVD', namingHint: 'ZUI_<Entity>' },
            { role: 'Service Binding', type: 'SRVB', namingHint: 'ZUI_<Entity>_O4' }
        ],
        codeTemplate: 'projection;\nstrict ( 2 );\n\ndefine behavior for ZC_<Entity> alias <Entity>\nuse create;\nuse update;\nuse delete;\n'
    },
    EXTENSION: {
        pattern: 'Extension of a released SAP RAP BO via the released extension extension points. Level A target when extending standard SAP business objects (SalesOrder, PurchaseOrder, etc.). Custom fields go via Custom Fields & Logic (key user) or CDS extends. Never modify the SAP BDEF directly.',
        requiredObjects: [
            { role: 'CDS extend view', type: 'DDLS', namingHint: 'ZE_I_<SapEntity>', notes: 'extend view I_<SapEntity> with ZE_I_<SapEntity> { ... } — adds custom fields.' },
            { role: 'BDEF extension', type: 'BDEF', namingHint: 'ZE_<SapEntity>', notes: 'extension; on the SAP BDEF — adds custom validations/determinations.' },
            { role: 'Custom Behavior Pool', type: 'CLAS', namingHint: 'ZBP_E_<SapEntity>', notes: 'Implements only the added behavior.' }
        ],
        codeTemplate: 'extension;\nstrict ( 2 );\n\ndefine behavior for I_<SapEntity>\n{\n  determination myCustomDetermination on modify { field customField; }\n}\n'
    }
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function getRapPattern(input) {
    if (!input || typeof input.scenario !== 'string' || input.scenario.trim().length === 0) {
        throw new Error('get_rap_pattern: scenario is required (TRANSACTIONAL | READ_ONLY_ANALYTICAL | DRAFT_ENABLED | MANAGED | UNMANAGED | PROJECTION | EXTENSION).');
    }
    const scenario = input.scenario.trim().toUpperCase();
    const tpl = PATTERNS[scenario];
    if (!tpl) {
        throw new Error(`get_rap_pattern: unknown scenario "${input.scenario}". Known: ${Object.keys(PATTERNS).join(', ')}`);
    }
    return {
        scenario,
        pattern: tpl.pattern,
        requiredObjects: tpl.requiredObjects,
        codeTemplate: tpl.codeTemplate,
        cleanCoreLevel: 'A',
        source: 'embedded',
        catalogVersion: CATALOG_VERSION
    };
}
//# sourceMappingURL=GetRapPattern.js.map