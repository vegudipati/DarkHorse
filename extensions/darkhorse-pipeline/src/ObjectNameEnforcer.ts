/**
 * ObjectNameEnforcer — deterministic post-LLM check that the generated code's
 * declaration line uses the object name the TDS specified.
 *
 * Bug this fixes (CPI-6 B3): the LLM occasionally produces correct source
 * structure but uses an INVENTED object name in the declaration (e.g.
 * `define service RFC_DEST` when the TDS said `ZUI_OTC_ROUTING_DETAIL`).
 * That breaks every downstream object that references the service by name.
 *
 * For each object type we know the declaration syntax and run a regex that
 * captures the keyword and the name. If the captured name doesn't match
 * `obj.objectName`, we rewrite ONLY the name token.
 *
 * The implementation is conservative: it only touches the leading
 * declaration line(s). Internal references (e.g. CLASS ... IMPLEMENTATION)
 * are also normalised so that DEFINITION + IMPLEMENTATION names stay
 * consistent — but nothing else in the body is rewritten.
 *
 * Returns the rewritten code plus a summary the preview panel can surface.
 */

'use strict';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EnforceResult {
  code:     string;
  rewrites: Array<{
    where: string;            // human-readable e.g. "define service"
    from:  string;
    to:    string;
  }>;
}

// ---------------------------------------------------------------------------
// Per-object-type declaration patterns
// ---------------------------------------------------------------------------

interface DeclPattern {
  description: string;             // "define service" etc.
  rx:          RegExp;             // captures: (1) keyword block, (2) name
  replace:     (prefix: string, expected: string, rest: string) => string;
}

function patternsFor(objectType: string): DeclPattern[] {
  const t = objectType.trim().toUpperCase();
  const patterns: DeclPattern[] = [];

  if (t === 'PROG') {
    patterns.push({
      description: 'REPORT',
      rx:          /(\bREPORT\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'CLAS' || t === 'CLASS') {
    // Match BOTH definition + implementation declarations
    patterns.push({
      description: 'CLASS ... DEFINITION',
      rx:          /(\bCLASS\s+)([A-Za-z_][A-Za-z0-9_]*)(\s+DEFINITION\b)/i,
      replace:     (prefix, expected, rest) => `${prefix}${expected}${rest}`
    });
    patterns.push({
      description: 'CLASS ... IMPLEMENTATION',
      rx:          /(\bCLASS\s+)([A-Za-z_][A-Za-z0-9_]*)(\s+IMPLEMENTATION\b)/i,
      replace:     (prefix, expected, rest) => `${prefix}${expected}${rest}`
    });
    patterns.push({
      description: 'ENDCLASS comment alignment',
      rx:          /(\bENDCLASS\b\.\s*"\s*)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'INTF' || t === 'INTERFACE') {
    patterns.push({
      description: 'INTERFACE',
      rx:          /(\bINTERFACE\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'FUNC' || t === 'FUNCTION') {
    patterns.push({
      description: 'FUNCTION',
      rx:          /(\bFUNCTION\s+)([A-Za-z_][A-Za-z0-9_/]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'DDLS') {
    // CDS view: define view, define view entity
    patterns.push({
      description: 'define view',
      rx:          /(\bdefine\s+view\s+(?:entity\s+)?)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'BDEF') {
    patterns.push({
      description: 'define behavior for',
      rx:          /(\bdefine\s+behavior\s+for\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'SRVD') {
    patterns.push({
      description: 'define service',
      rx:          /(\bdefine\s+service\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'SRVB') {
    // Service bindings are declared in metadata-XML form in newer ABAP;
    // sometimes they appear as a binding statement.
    patterns.push({
      description: 'service binding name',
      rx:          /(\bbinding\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'TABL') {
    patterns.push({
      description: 'define table',
      rx:          /(\bdefine\s+table\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  if (t === 'DCLS' || t === 'DDLX') {
    patterns.push({
      description: 'define role / metadata extension',
      rx:          /(\bdefine\s+(?:role|metadata)\s+)([A-Za-z_][A-Za-z0-9_]*)/i,
      replace:     (prefix, expected) => `${prefix}${expected}`
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enforceObjectName(
  code:        string,
  objectName:  string,
  objectType:  string
): EnforceResult {

  const expected = objectName.trim();
  if (expected.length === 0) {
    return { code, rewrites: [] };
  }

  const patterns = patternsFor(objectType);
  if (patterns.length === 0) {
    return { code, rewrites: [] };
  }

  const rewrites: EnforceResult['rewrites'] = [];
  let working = code;

  for (const p of patterns) {
    const match = p.rx.exec(working);
    if (!match) continue;
    const found = match[2] ?? '';
    if (found.toUpperCase() === expected.toUpperCase()) continue;   // already correct
    // Preserve casing of the expected name as provided in the TDS
    working = working.replace(p.rx, (_full, prefix, _name, rest = '') =>
      p.replace(prefix, expected, rest)
    );
    rewrites.push({ where: p.description, from: found, to: expected });
  }

  return { code: working, rewrites };
}
