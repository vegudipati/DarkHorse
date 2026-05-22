/**
 * uiIntentDetect — shared UI / form intent detection used by all 4 grounders.
 *
 * Returns the most likely Fiori Elements scenario and/or form pattern given a
 * corpus of BR / SO / FDS / TDS text. Keeps the heuristics in one place so
 * SO/FDS/TDS/Code grounders all classify identically.
 */

'use strict';

export type FioriScenarioGuess =
  | 'LIST_REPORT'
  | 'OBJECT_PAGE'
  | 'ANALYTICAL_LIST_PAGE'
  | 'OVERVIEW_PAGE'
  | 'WORKLIST'
  | 'FREESTYLE_UI5';

export type FormScenarioGuess =
  | 'PRINT_FORM'
  | 'INTERACTIVE_FORM'
  | 'SMART_FORM';

const RX_LIST     = /\b(list|browse|search|filter|catalog|inventory\s+of|all\s+(?:orders|customers|materials|invoices))\b/i;
const RX_OBJECT   = /\b(detail\s+(?:page|view|screen)|object\s+page|edit\s+(?:a|an|the)|maintain\s+a)\b/i;
const RX_ANALYT   = /\b(analytical|kpi|dashboard\s+report|trend(?:s|ing)?|aggregate|drill[-\s]?down|by\s+(?:plant|company|customer|vendor|product|region)|chart|fiscal\s+year|year[-\s]?over[-\s]?year)\b/i;
const RX_OVP      = /\b(dashboard|overview\s+page|executive\s+summary|home\s+page|landing\s+page|multiple\s+kpis|kpi\s+cards)\b/i;
const RX_WORKLIST = /\b(worklist|task\s+(?:inbox|list)|approval\s+(?:workflow|inbox)|pending\s+(?:items|approvals)|process\s+the\s+items)\b/i;
const RX_FREESTYLE= /\b(custom\s+control|d3\.js|d3\s+chart|leaflet|map\s+visuali[sz]ation|multi[-\s]?step\s+wizard|consumer[-\s]?grade)\b/i;

const RX_PRINT_FORM       = /\b(print\s+form|output\s+document|invoice\s+form|delivery\s+note|order\s+confirmation|payslip|letter\s+output|pdf\s+output)\b/i;
const RX_INTERACTIVE_FORM = /\b(interactive\s+(?:form|pdf)|fillable\s+pdf|offline\s+(?:form|data\s+capture))\b/i;
const RX_SMART_FORM       = /\b(smart\s*forms?)\b/i;

// Generic "there is a UI/report/form here" signal — used as a cheap gate
// before deeper classification.
export function hasUiOrFormIntent(corpus: string): boolean {
  return /\b(ui|fiori|ui5|screen|dialog|list|report|dashboard|kpi|form|pdf|print|worklist)\b/i.test(corpus);
}

export function detectFioriScenario(corpus: string, ricefwType: string): FioriScenarioGuess | null {
  // Specific scenarios first so the more general LIST_REPORT match doesn't
  // swallow analytical / overview / worklist intents.
  if (RX_FREESTYLE.test(corpus))  return 'FREESTYLE_UI5';
  if (RX_WORKLIST.test(corpus))   return 'WORKLIST';
  if (RX_OVP.test(corpus))        return 'OVERVIEW_PAGE';
  if (RX_ANALYT.test(corpus))     return 'ANALYTICAL_LIST_PAGE';
  if (RX_OBJECT.test(corpus))     return 'OBJECT_PAGE';
  if (RX_LIST.test(corpus))       return 'LIST_REPORT';

  // RICEFW-type bias for the catch-all case
  if (/^report\b/i.test(ricefwType)) return 'ANALYTICAL_LIST_PAGE';
  if (/^enhancement\b/i.test(ricefwType)) return null;   // no UI implied
  return null;
}

export function detectFormScenario(corpus: string): FormScenarioGuess | null {
  if (RX_INTERACTIVE_FORM.test(corpus)) return 'INTERACTIVE_FORM';
  if (RX_SMART_FORM.test(corpus))       return 'SMART_FORM';
  if (RX_PRINT_FORM.test(corpus))       return 'PRINT_FORM';
  return null;
}
