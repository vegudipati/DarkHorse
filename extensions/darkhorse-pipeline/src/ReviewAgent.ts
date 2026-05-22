/**
 * ReviewAgent — CPI-6 Sprint 6 independent post-generation critic.
 *
 * This is a SECOND LLM pass that critiques the generated ABAP code against
 * the TDS spec and the grounded SAP knowledge. The Clean Core verifier
 * (CleanCoreVerifier.ts) is deterministic regex + MCP catalog lookups —
 * it catches structural violations (direct VBAK SELECT, hallucinated
 * USEREXIT_*). The Review Agent catches the things a regex cannot:
 *
 *   - Missing AUTHORITY-CHECK when the TDS declared auth objects
 *   - SELECT statements without proper field lists
 *   - EML usage that omits COMMIT ENTITIES or mishandles MAPPED/FAILED
 *   - Message-class / message-number errors
 *   - Code that does not match the TDS keyLogic
 *   - Performance smells (nested SELECT inside LOOP, missing INDEX)
 *
 * Calls the existing llm-proxy at the same port the rest of the pipeline
 * uses (default 47291). Requests JSON output via a strict system prompt;
 * if the response is not parseable, returns an empty report so the panel
 * does not break.
 *
 * Fails-soft on EVERY error path: the Review Agent is advisory; a bad
 * review must never block a generation cycle.
 */

'use strict';

import * as vscode from 'vscode';
import { AbapObject } from './PipelineStateManager';

const http = require('http');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReviewSeverity = 'critical' | 'major' | 'minor' | 'info';

export type ReviewCategory =
  | 'authorization'
  | 'performance'
  | 'correctness'
  | 'clean-core'
  | 'error-handling'
  | 'tds-mismatch'
  | 'maintainability';

export interface ReviewFinding {
  severity:    ReviewSeverity;
  category:    ReviewCategory | string;
  /** Line range or short snippet pointing at the issue. */
  location:    string;
  description: string;
  /** What the reviewer suggests doing about it. */
  suggestion:  string;
}

export interface ReviewReport {
  scannedAt:        string;
  /** True when the agent could not run (proxy down, parse failed, etc.).
   *  The preview hides the panel in this case. */
  unavailable:      boolean;
  notes:            string[];     // operator-visible diagnostics
  findings:         ReviewFinding[];
  /** Top-level summary the reviewer wrote. One sentence. */
  summary:          string;
  /** Counts pre-aggregated for the verdict chip. */
  counts: {
    critical: number;
    major:    number;
    minor:    number;
    info:     number;
  };
}

// ---------------------------------------------------------------------------
// HTTP helper — POST to llm-proxy /generate
// ---------------------------------------------------------------------------

function callProxy(port: number, body: object, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/generate',
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error ?? `Proxy error: ${res.statusCode}`));
              return;
            }
            resolve(parsed.code ?? parsed.content ?? '');
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Review proxy timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// System prompt for the reviewer
// ---------------------------------------------------------------------------

function reviewSystemPrompt(): string {
  return `You are a SENIOR SAP S/4HANA code reviewer at a Big 4 consulting firm with 15 years of experience auditing Clean Core ABAP for production deployment.

You are reviewing ABAP code that another developer (an AI generator) wrote against a Technical Design Specification. Your job is to find issues that a regex-based verifier would miss — judgment calls and subtle defects.

Focus your review on:
- AUTHORIZATION: is AUTHORITY-CHECK in place for every authorization object the TDS named? Does it use the right activity codes (01/02/03/06)?
- CORRECTNESS: does the code actually implement the keyLogic from the TDS, or does it deviate? Are SY-SUBRC checks present after every database / function-module call?
- ERROR HANDLING: are errors written to SLG1 Application Log (object Z_DARKHORSE, scenario subobject) — not to custom log tables? Are message classes and message numbers consistent and meaningful?
- CLEAN CORE: subtle issues the regex verifier may miss — e.g. SELECT FROM a CDS view but with a hard-coded client, or EML CREATE without COMMIT ENTITIES, or RAP behavior class that calls a BAPI internally.
- PERFORMANCE: nested SELECT inside LOOP AT, SELECT * (always specify fields), missing FOR ALL ENTRIES guards, JOIN where ASSOCIATIONS would be cheaper.
- TDS MISMATCH: does the code add steps not in the TDS? Does it omit declared dependencies?
- MAINTAINABILITY: hard-coded constants that should be table-driven, magic numbers, missing comments where the logic is non-obvious.

You DO NOT need to repeat findings the Clean Core verifier already catches (direct VBAK SELECT, USEREXIT_ATP_QUANTITY hallucination, BAPI vs EML choice). Focus on what only a human reviewer would notice.

Severity levels:
- critical = will cause incorrect business behavior or security issue. Must be fixed before acceptance.
- major   = strongly violates SAP best practice; should be fixed.
- minor   = style or maintainability issue; nice-to-fix.
- info    = observation worth noting; no action required.

Output STRICTLY this JSON shape — no markdown, no preamble:
{
  "summary": "one sentence overall assessment",
  "findings": [
    {
      "severity":    "critical|major|minor|info",
      "category":    "authorization|performance|correctness|clean-core|error-handling|tds-mismatch|maintainability",
      "location":    "line N or short ABAP snippet quoting the offending code",
      "description": "what is wrong",
      "suggestion":  "what to change"
    }
  ]
}

If you genuinely have no findings, return findings: [] with a positive summary. Be specific. Avoid generic advice.`;
}

// ---------------------------------------------------------------------------
// User prompt — what gets fed to the reviewer
// ---------------------------------------------------------------------------

function reviewUserPrompt(obj: AbapObject, code: string): string {
  const keyLogic = (obj.keyLogic ?? []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  const deps     = (obj.dependencies ?? []).join(', ') || '(none specified)';
  const codeBlock = code.length > 12_000 ? code.slice(0, 12_000) + '\n... (truncated for review)' : code;

  return `Please review the following ABAP code against its Technical Design Specification.

# Technical Design Spec
- Object type: ${obj.objectType}
- Object name: ${obj.objectName}
- Description: ${obj.description}
- Dependencies: ${deps}
- Required keyLogic steps:
${keyLogic}

# Generated ABAP code
\`\`\`abap
${codeBlock}
\`\`\`

Return ONLY the JSON object specified in the system prompt.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseReviewResponse(raw: string): { summary: string; findings: ReviewFinding[] } | null {
  if (!raw) return null;

  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: any;
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { return null; }

  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];

  const findings: ReviewFinding[] = rawFindings.map((f: any) => ({
    severity:    normaliseSeverity(f.severity),
    category:    typeof f.category    === 'string' ? f.category.trim().toLowerCase() : 'maintainability',
    location:    typeof f.location    === 'string' ? f.location.trim()                : '',
    description: typeof f.description === 'string' ? f.description.trim()             : '',
    suggestion:  typeof f.suggestion  === 'string' ? f.suggestion.trim()              : ''
  })).filter((f: ReviewFinding) => f.description.length > 0);

  return { summary, findings };
}

function normaliseSeverity(s: unknown): ReviewSeverity {
  if (typeof s !== 'string') return 'minor';
  const u = s.trim().toLowerCase();
  if (u === 'critical' || u === 'major' || u === 'minor' || u === 'info') return u;
  if (u === 'high'   || u === 'blocker') return 'critical';
  if (u === 'medium' || u === 'warning') return 'major';
  if (u === 'low'    || u === 'note')    return 'minor';
  return 'minor';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function reviewGeneratedCode(
  obj: AbapObject,
  code: string,
  proxyPort?: number
): Promise<ReviewReport> {

  const scannedAt = new Date().toISOString();
  const empty: ReviewReport = {
    scannedAt,
    unavailable: true,
    notes:       [],
    findings:    [],
    summary:     '',
    counts:      { critical: 0, major: 0, minor: 0, info: 0 }
  };

  if (!code || code.trim().length === 0) {
    return { ...empty, unavailable: false, summary: 'No code to review.' };
  }

  const port = proxyPort ?? vscode.workspace.getConfiguration()
    .get<number>('darkhorse.pipeline.llmProxyPort', 47291);

  let raw = '';
  try {
    raw = await callProxy(port, {
      prompt:       reviewUserPrompt(obj, code),
      systemPrompt: reviewSystemPrompt(),
      maxTokens:    3000,
      sessionId:    `review-${obj.objectName}-${Date.now()}`
    });
  } catch (err: any) {
    return { ...empty, notes: [`Review LLM proxy unavailable: ${err?.message ?? err}`] };
  }

  const parsed = parseReviewResponse(raw);
  if (!parsed) {
    return { ...empty, notes: ['Review response could not be parsed as JSON.'] };
  }

  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of parsed.findings) counts[f.severity] += 1;

  // Stable ordering — worst first, then category, then alphabetical description
  const sevRank: Record<ReviewSeverity, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  parsed.findings.sort((a, b) => {
    if (a.severity !== b.severity) return sevRank[a.severity] - sevRank[b.severity];
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.description.localeCompare(b.description);
  });

  return {
    scannedAt,
    unavailable: false,
    notes:       [],
    findings:    parsed.findings,
    summary:     parsed.summary || (parsed.findings.length === 0
                                       ? 'Reviewer raised no findings.'
                                       : `Reviewer raised ${parsed.findings.length} finding(s).`),
    counts
  };
}
