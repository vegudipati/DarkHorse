/**
 * GetEmlSyntax — returns ABAP EML (Entity Manipulation Language) syntax for
 * CREATE / UPDATE / DELETE / READ operations on a RAP-managed entity.
 *
 * Sprint 3 Session 1: this tool is what the Code Agent calls BEFORE
 * emitting any write operation on a sales order / purchase order / etc.
 * The result steers generation away from legacy BAPIs (Level B) toward
 * EML (Level A).
 *
 * Embedded templates — the syntax shapes are small, stable, and well-known.
 * Substitutes the caller's entity name into the template. No RAG roundtrip
 * required.
 */

'use strict';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EmlOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'READ';

export interface GetEmlSyntaxInput {
  operation:  EmlOperation | string;
  entity:     string;
}

export interface GetEmlSyntaxOutput {
  operation:        EmlOperation;
  entity:           string;
  syntax:           string;
  example:          string;
  commitRequired:   boolean;
  cleanCoreLevel:   'A';
  rationale:        string;
  /** What legacy approach the agent should NOT generate instead. */
  doNotUse:         string;
  source:           'embedded';
  catalogVersion:   string;
}

// ---------------------------------------------------------------------------
// Templates — one per operation
// ---------------------------------------------------------------------------

const CATALOG_VERSION = '1.0.0';

interface EmlTemplate {
  syntax:         string;
  rationale:      string;
  doNotUse:       string;
  commitRequired: boolean;
  exampleBuilder: (entity: string) => string;
}

const TEMPLATES: Record<EmlOperation, EmlTemplate> = {

  CREATE: {
    syntax:    'MODIFY ENTITIES OF <bdef> ENTITY <entity> CREATE FIELDS ( ... ) WITH VALUE #( ... ).',
    rationale:
      'CREATE EML against the released RAP Behavior Definition is Level A. It replaces the classic ' +
      'BAPI_*_CREATEFROMDAT* family — those are Level B and acceptable only when a released BDEF is ' +
      'unavailable for the target object.',
    doNotUse:
      'Do NOT generate CALL FUNCTION \'BAPI_*_CREATEFROMDAT*\' when a released RAP BDEF exists. ' +
      'Do NOT generate direct INSERT statements on SAP standard tables — that is Level C.',
    commitRequired: true,
    exampleBuilder: (entity: string) => [
      '" Level A CREATE via EML',
      `MODIFY ENTITIES OF ${entity}`,
      `  ENTITY ${entity}`,
      '    CREATE FIELDS ( field1 field2 field3 )',
      '    WITH VALUE #( ( %cid     = \'cid_1\'',
      '                    field1   = lv_field1',
      '                    field2   = lv_field2',
      '                    field3   = lv_field3 ) )',
      '    MAPPED   DATA(ls_mapped)',
      '    FAILED   DATA(ls_failed)',
      '    REPORTED DATA(ls_reported).',
      '',
      '" Persist',
      'COMMIT ENTITIES RESPONSE OF',
      `  ${entity}`,
      '  FAILED   DATA(ls_commit_failed)',
      '  REPORTED DATA(ls_commit_reported).'
    ].join('\n')
  },

  UPDATE: {
    syntax:    'MODIFY ENTITIES OF <bdef> ENTITY <entity> UPDATE FIELDS ( ... ) WITH VALUE #( ( %key = ... ) ).',
    rationale:
      'UPDATE EML against the released RAP Behavior Definition is Level A. It replaces classic ' +
      'BAPI_*_CHANGE / SAVE FMs and direct UPDATE on SAP standard tables.',
    doNotUse:
      'Do NOT generate CALL FUNCTION \'BAPI_*_CHANGE\' when a released RAP BDEF exists. ' +
      'Do NOT generate UPDATE statements on SAP standard tables.',
    commitRequired: true,
    exampleBuilder: (entity: string) => [
      '" Level A UPDATE via EML',
      `MODIFY ENTITIES OF ${entity}`,
      `  ENTITY ${entity}`,
      '    UPDATE FIELDS ( field2 )',
      `    WITH VALUE #( ( %key-keyfield = lv_key`,
      '                    field2        = lv_new_value ) )',
      '    FAILED   DATA(ls_failed)',
      '    REPORTED DATA(ls_reported).',
      '',
      'COMMIT ENTITIES RESPONSE OF',
      `  ${entity}`,
      '  FAILED   DATA(ls_commit_failed).'
    ].join('\n')
  },

  DELETE: {
    syntax:    'MODIFY ENTITIES OF <bdef> ENTITY <entity> DELETE FROM VALUE #( ( %key = ... ) ).',
    rationale:
      'DELETE EML against the released RAP Behavior Definition is Level A. It enforces the ' +
      'behavior\'s deletion safeguards (associations, dependent items) automatically.',
    doNotUse:
      'Do NOT generate DELETE statements on SAP standard tables. ' +
      'Do NOT call BAPI_*_DELETE when a released RAP BDEF exists.',
    commitRequired: true,
    exampleBuilder: (entity: string) => [
      '" Level A DELETE via EML',
      `MODIFY ENTITIES OF ${entity}`,
      `  ENTITY ${entity}`,
      `    DELETE FROM VALUE #( ( %key-keyfield = lv_key ) )`,
      '    FAILED   DATA(ls_failed)',
      '    REPORTED DATA(ls_reported).',
      '',
      'COMMIT ENTITIES.'
    ].join('\n')
  },

  READ: {
    syntax:    'READ ENTITIES OF <bdef> ENTITY <entity> [BY \\_assoc] ALL FIELDS WITH VALUE #( ( %key = ... ) ).',
    rationale:
      'READ EML returns RAP-managed data with consistent transactional state and association ' +
      'traversal. Equivalent to a SELECT but participates in the active transaction buffer.',
    doNotUse:
      'For pure read-only reporting where no transactional buffer is involved, a SELECT FROM ' +
      '<I_*_CDSView> is also Level A and usually simpler. Use READ EML when the read participates ' +
      'in an ongoing RAP transaction.',
    commitRequired: false,
    exampleBuilder: (entity: string) => [
      '" Level A READ via EML (joins active RAP buffer if any)',
      `READ ENTITIES OF ${entity}`,
      `  ENTITY ${entity}`,
      '    ALL FIELDS',
      `    WITH VALUE #( ( %key-keyfield = lv_key ) )`,
      '    RESULT DATA(lt_rows)',
      '    FAILED DATA(ls_failed)',
      '    REPORTED DATA(ls_reported).'
    ].join('\n')
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getEmlSyntax(input: GetEmlSyntaxInput): GetEmlSyntaxOutput {
  if (!input || typeof input.operation !== 'string' || input.operation.trim().length === 0) {
    throw new Error('get_eml_syntax: operation is required (CREATE | UPDATE | DELETE | READ).');
  }
  if (typeof input.entity !== 'string' || input.entity.trim().length === 0) {
    throw new Error('get_eml_syntax: entity is required and must be a non-empty string.');
  }

  const opUpper = input.operation.trim().toUpperCase() as EmlOperation;
  const template = TEMPLATES[opUpper];
  if (!template) {
    throw new Error(`get_eml_syntax: operation must be one of CREATE, UPDATE, DELETE, READ. Got "${input.operation}".`);
  }

  const entity = input.entity.trim();
  return {
    operation:      opUpper,
    entity,
    syntax:         template.syntax,
    example:        template.exampleBuilder(entity),
    commitRequired: template.commitRequired,
    cleanCoreLevel: 'A',
    rationale:      template.rationale,
    doNotUse:       template.doNotUse,
    source:         'embedded',
    catalogVersion: CATALOG_VERSION
  };
}
