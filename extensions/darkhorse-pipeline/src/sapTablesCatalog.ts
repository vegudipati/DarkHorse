/**
 * Shared set of SAP standard tables that the pipeline scans for.
 *
 * Both CleanCoreVerifier (post-generation) and CodeAgentGrounder
 * (pre-generation) consume this set. Single source of truth — extend here
 * when a new module's tables become relevant.
 */

'use strict';

export const SAP_STANDARD_TABLES = new Set<string>([
  // SD
  'VBAK', 'VBAP', 'VBEP', 'VBKD', 'VBPA', 'VBUK', 'VBUP', 'VBRK', 'VBRP', 'LIKP', 'LIPS',
  // MM — purchasing & inventory
  'EKKO', 'EKPO', 'EKPV', 'EKKN', 'EBAN', 'EBKN', 'EINA', 'EINE', 'EORD',
  'MARA', 'MARC', 'MARD', 'MAKT', 'MBEW', 'MSEG', 'MKPF', 'MARM',
  // FI
  'BKPF', 'BSEG', 'BSID', 'BSAD', 'BSIK', 'BSAK', 'GLT0', 'SKAT', 'SKA1', 'SKB1',
  // Partners
  'KNA1', 'KNB1', 'KNVV', 'KNVP', 'LFA1', 'LFB1', 'LFM1',
  // Org / config
  'T001', 'T001L', 'T001W', 'T024', 'T024D', 'T024L',
  // HR
  'PA0000', 'PA0001', 'PA0002', 'PA0006',
  // Equipment / PM
  'EQUI', 'EQUZ', 'EQKT', 'ILOA',
  // Application Log (listed so the scanner can tag them as A correctly)
  'BALHDR', 'BALDAT', 'BALOBJ'
]);
