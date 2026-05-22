/**
 * GetApplicationLogPattern — returns SAP SLG1 / Application Log code patterns.
 *
 * Primary purpose (CPI-6 Sprint 1): force the Code Agent to use SLG1
 * Application Log for ALL logging instead of inventing custom Z-tables
 * (a Level C/D anti-pattern that currently dominates generated code).
 *
 * The tool returns a ready-to-paste ABAP snippet for the requested use case,
 * the standard log object/subobject pair (or recommends a custom object name
 * registered via SLG0), and the related SAP function modules.
 *
 * Patterns embedded inline because the set is small, stable, and well-known.
 * Sprint 2 may relocate these to a RAG-indexed pattern store.
 */

'use strict';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GetApplicationLogPatternInput {
  use_case?:  string;
  object?:    string;
  subobject?: string;
}

export interface ApplicationLogPattern {
  patternId:        string;
  description:      string;
  logObject:        string;
  logSubobject:     string;
  registration:     string;     // how to register the custom log object via SLG0
  objectsNeeded:    string[];   // function modules / classes referenced
  example:          string;     // ready-to-paste ABAP snippet
  cleanCoreLevel:   'A' | 'B';
}

export interface GetApplicationLogPatternOutput {
  pattern:           ApplicationLogPattern;
  matchedBy:         'use_case' | 'object' | 'default';
  availablePatterns: string[];
  source:            'embedded';
  catalogVersion:    string;
}

// ---------------------------------------------------------------------------
// Pattern library — small, finite, well-known
// ---------------------------------------------------------------------------

const CATALOG_VERSION = '1.0.0';

const PATTERNS: Record<string, ApplicationLogPattern> = {

  GENERIC: {
    patternId:    'GENERIC',
    description:
      'Generic Application Log pattern using class CL_BALI_LOG / CL_BAL. Suitable for any custom development that needs to write progress, errors, and successes to SLG1.',
    logObject:    'Z_DARKHORSE',
    logSubobject: 'Z_GENERIC',
    registration:
      'Register the custom log object once in transaction SLG0: ' +
      'Object = Z_DARKHORSE (or your team prefix), Subobject = Z_GENERIC (one per business scenario).',
    objectsNeeded: [
      'BAL_LOG_CREATE',
      'BAL_LOG_MSG_ADD',
      'BAL_DB_SAVE',
      'BAL_DSP_LOG_DISPLAY'
    ],
    cleanCoreLevel: 'A',
    example: [
      '" --- SLG1 Application Log: create, populate, save, display ---',
      'DATA: lt_log_handle TYPE bal_t_logh,',
      '      ls_log        TYPE bal_s_log,',
      '      lv_log_handle TYPE balloghndl,',
      '      ls_msg        TYPE bal_s_msg.',
      '',
      'ls_log-object     = \'Z_DARKHORSE\'.',
      'ls_log-subobject  = \'Z_GENERIC\'.',
      'ls_log-aldate     = sy-datum.',
      'ls_log-altime     = sy-uzeit.',
      'ls_log-aluser     = sy-uname.',
      'ls_log-altcode    = sy-tcode.',
      'ls_log-alprog     = sy-repid.',
      '',
      'CALL FUNCTION \'BAL_LOG_CREATE\'',
      '  EXPORTING  i_s_log      = ls_log',
      '  IMPORTING  e_log_handle = lv_log_handle.',
      '',
      'ls_msg-msgty = \'E\'.   " S / I / W / E / A',
      'ls_msg-msgid = \'ZDH\'.',
      'ls_msg-msgno = \'001\'.',
      'ls_msg-msgv1 = \'Backorder ATP check failed\'.',
      '',
      'CALL FUNCTION \'BAL_LOG_MSG_ADD\'',
      '  EXPORTING  i_log_handle = lv_log_handle',
      '             i_s_msg      = ls_msg.',
      '',
      'APPEND lv_log_handle TO lt_log_handle.',
      '',
      'CALL FUNCTION \'BAL_DB_SAVE\'',
      '  EXPORTING  i_save_all   = abap_true',
      '             i_t_log_handle = lt_log_handle.',
      ''
    ].join('\n')
  },

  BACKORDER: {
    patternId:    'BACKORDER',
    description:
      'Application Log pattern for backorder / ATP processing. Logs ATP check results, reservation conflicts, and schedule line updates to SLG1.',
    logObject:    'Z_DARKHORSE',
    logSubobject: 'Z_BACKORDER',
    registration:
      'Register in SLG0: Object = Z_DARKHORSE, Subobject = Z_BACKORDER. ' +
      'Use the GENERIC code snippet structure, substituting the subobject value.',
    objectsNeeded: [
      'BAL_LOG_CREATE',
      'BAL_LOG_MSG_ADD',
      'BAL_DB_SAVE'
    ],
    cleanCoreLevel: 'A',
    example: [
      '" Backorder-specific Application Log entry',
      'DATA: lv_log_handle TYPE balloghndl,',
      '      ls_log        TYPE bal_s_log,',
      '      ls_msg        TYPE bal_s_msg.',
      '',
      'ls_log-object    = \'Z_DARKHORSE\'.',
      'ls_log-subobject = \'Z_BACKORDER\'.',
      'ls_log-extnumber = |Backorder { iv_sales_order } / { iv_item }|.',
      '',
      'CALL FUNCTION \'BAL_LOG_CREATE\'',
      '  EXPORTING  i_s_log      = ls_log',
      '  IMPORTING  e_log_handle = lv_log_handle.',
      '',
      'ls_msg-msgty = \'W\'.',
      'ls_msg-msgid = \'ZDH\'.',
      'ls_msg-msgno = \'010\'.',
      'ls_msg-msgv1 = iv_sales_order.',
      'ls_msg-msgv2 = iv_item.',
      'ls_msg-msgv3 = |confirmed_qty={ lv_conf_qty }|.',
      '',
      'CALL FUNCTION \'BAL_LOG_MSG_ADD\'',
      '  EXPORTING  i_log_handle = lv_log_handle',
      '             i_s_msg      = ls_msg.',
      '',
      'CALL FUNCTION \'BAL_DB_SAVE\'',
      '  EXPORTING  i_save_all   = abap_true.'
    ].join('\n')
  },

  RAP_BEHAVIOR: {
    patternId:    'RAP_BEHAVIOR',
    description:
      'Application Log pattern for use inside a RAP behavior implementation class. Captures EML failures, validation results, and determination outcomes against SLG1.',
    logObject:    'Z_DARKHORSE',
    logSubobject: 'Z_RAP',
    registration:
      'Register in SLG0: Object = Z_DARKHORSE, Subobject = Z_RAP. ' +
      'Inject the log handle via a controller instance variable rather than recreating per method call.',
    objectsNeeded: [
      'CL_BALI_LOG',
      'CL_BAL_FACTORY',
      'BAL_LOG_CREATE',
      'BAL_DB_SAVE'
    ],
    cleanCoreLevel: 'A',
    example: [
      '" Inside a RAP behavior validation/determination — write to SLG1 on failure',
      'METHOD validate_quantity.',
      '  READ ENTITIES OF z_i_sales_order IN LOCAL MODE',
      '    ENTITY salesorderitem',
      '    FIELDS ( requested_quantity )',
      '    WITH CORRESPONDING #( keys )',
      '    RESULT DATA(items).',
      '',
      '  LOOP AT items INTO DATA(item).',
      '    IF item-requested_quantity <= 0.',
      '      APPEND VALUE #( %tky = item-%tky',
      '                      %msg = new_message(',
      '                        id       = \'ZDH\'',
      '                        number   = \'020\'',
      '                        severity = if_abap_behv_message=>severity-error',
      '                        v1       = item-salesorder ) )',
      '             TO reported-salesorderitem.',
      '      log_to_slg1( iv_msgno = \'020\' iv_v1 = item-salesorder ).',
      '    ENDIF.',
      '  ENDLOOP.',
      'ENDMETHOD.'
    ].join('\n')
  },

  BATCH_JOB: {
    patternId:    'BATCH_JOB',
    description:
      'Application Log pattern for Application Jobs (the Level A replacement for classic SM37 jobs). Logs job progress to SLG1 with reference to the job key.',
    logObject:    'Z_DARKHORSE',
    logSubobject: 'Z_BATCH',
    registration:
      'Register in SLG0: Object = Z_DARKHORSE, Subobject = Z_BATCH. ' +
      'Use Application Job framework (CL_APJ_RT_API) — NOT classic SM37 / JOB_OPEN.',
    objectsNeeded: [
      'CL_APJ_RT_API',
      'BAL_LOG_CREATE',
      'BAL_DB_SAVE'
    ],
    cleanCoreLevel: 'A',
    example: [
      '" In an Application Job class implementing IF_APJ_RT_RUN',
      'METHOD if_apj_rt_run~run.',
      '  DATA(lo_log) = NEW lcl_log( object = \'Z_DARKHORSE\' subobject = \'Z_BATCH\' ).',
      '  lo_log->info( |Job started for variant { iv_param_variant }| ).',
      '',
      '  TRY.',
      '      process_records( ).',
      '      lo_log->info( \'Job completed successfully\' ).',
      '    CATCH cx_root INTO DATA(lx).',
      '      lo_log->error( lx->get_text( ) ).',
      '  ENDTRY.',
      '',
      '  lo_log->save( ).',
      'ENDMETHOD.'
    ].join('\n')
  }
};

const USE_CASE_KEYWORDS: Array<{ pattern: string; keywords: string[] }> = [
  { pattern: 'BACKORDER',    keywords: ['backorder', 'atp', 'reservation', 'schedule line', 'confirmation'] },
  { pattern: 'RAP_BEHAVIOR', keywords: ['rap', 'behavior', 'eml', 'validation', 'determination'] },
  { pattern: 'BATCH_JOB',    keywords: ['batch', 'job', 'application job', 'background', 'scheduled', 'apj'] }
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getApplicationLogPattern(input: GetApplicationLogPatternInput): GetApplicationLogPatternOutput {
  const availablePatterns = Object.keys(PATTERNS);

  // Direct lookup by use case ID (case-insensitive)
  if (input?.use_case) {
    const direct = PATTERNS[input.use_case.trim().toUpperCase()];
    if (direct) {
      return {
        pattern:           direct,
        matchedBy:         'use_case',
        availablePatterns,
        source:            'embedded',
        catalogVersion:    CATALOG_VERSION
      };
    }

    // Keyword match
    const haystack = input.use_case.toLowerCase();
    for (const entry of USE_CASE_KEYWORDS) {
      if (entry.keywords.some(k => haystack.includes(k))) {
        return {
          pattern:           PATTERNS[entry.pattern]!,
          matchedBy:         'use_case',
          availablePatterns,
          source:            'embedded',
          catalogVersion:    CATALOG_VERSION
        };
      }
    }
  }

  // Optional object/subobject hint — Sprint 1 keeps this simple: just return GENERIC
  // with the caller's object/subobject if provided
  if (input?.object) {
    const generic = { ...PATTERNS.GENERIC! };
    generic.logObject    = input.object;
    generic.logSubobject = input.subobject || generic.logSubobject;
    return {
      pattern:           generic,
      matchedBy:         'object',
      availablePatterns,
      source:            'embedded',
      catalogVersion:    CATALOG_VERSION
    };
  }

  return {
    pattern:           PATTERNS.GENERIC!,
    matchedBy:         'default',
    availablePatterns,
    source:            'embedded',
    catalogVersion:    CATALOG_VERSION
  };
}
