/**
 * DarkHorse MCP Knowledge Service
 *
 * HTTP server that exposes grounded SAP-knowledge tools so the SO/FDS/TDS/Code
 * agents can VERIFY every SAP reference before emitting it. Eliminates the
 * #1 root cause of low code-generation accuracy: hallucinated BAdIs / exits.
 *
 * Security model (CPI-6 Sprint 1):
 *   - Binds to 127.0.0.1 ONLY — never network-accessible
 *   - No authentication (loopback only — same model as llm-proxy)
 *   - No outbound network calls (Sprint 1 catalogs are local JSON)
 *   - No native npm modules
 *
 * Endpoints:
 *   GET  /health                              → liveness + tool list
 *   GET  /mcp/tools                           → MCP-style tool descriptor list
 *   POST /tools/verify-badi                   → VerifyBadi
 *   POST /tools/verify-exit                   → VerifyExit
 *   POST /tools/check-clean-core-level        → CheckCleanCoreLevel
 *   POST /tools/get-application-log-pattern   → GetApplicationLogPattern
 *
 * CPI-6 future-sprint upgrade points (do NOT implement now):
 *   - Replace static JSON catalogs with Azure AI Search queries (Sprint 2)
 *   - Implement full MCP protocol over HTTP+SSE for editor-side MCP clients
 *   - Add the remaining tools: get_rap_pattern, get_cds_view, get_eml_syntax,
 *     get_cbo_pattern, search_sap_apis, search_team_templates
 */

'use strict';

import express = require('express');
import http    = require('http');

import { verifyBadi,                VerifyBadiInput }                from './tools/VerifyBadi';
import { verifyExit,                VerifyExitInput }                from './tools/VerifyExit';
import { checkCleanCoreLevel,       CheckCleanCoreLevelInput }       from './tools/CheckCleanCoreLevel';
import { getApplicationLogPattern,  GetApplicationLogPatternInput }  from './tools/GetApplicationLogPattern';
import { getCdsView,                GetCdsViewInput }                from './tools/GetCdsView';
import { getEmlSyntax,              GetEmlSyntaxInput }              from './tools/GetEmlSyntax';
import { getRapPattern,             GetRapPatternInput }             from './tools/GetRapPattern';
import { acknowledgeCatalog,        AcknowledgeCatalogInput }        from './tools/AcknowledgeCatalog';

import { KnowledgeProvider }            from './src/providers/KnowledgeProvider';
import { StaticCatalogProvider }        from './src/providers/StaticCatalogProvider';
import { AzureSearchKnowledgeProvider } from './src/providers/AzureSearchKnowledgeProvider';
import { CompositeKnowledgeProvider }   from './src/providers/CompositeKnowledgeProvider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MCP_HOST = '127.0.0.1';
const MCP_PORT = parseInt(process.env.DARKHORSE_MCP_PORT || '47292', 10);

const SERVICE_NAME    = 'darkhorse-mcp';
const SERVICE_VERSION = '0.6.0';

// ---------------------------------------------------------------------------
// KnowledgeProvider selection — read env vars at startup. Same logic as the
// darkhorse-ingest CLI: if Azure AI Search is configured we use the composite
// (Azure-first, static fallback); otherwise we use the static catalog alone.
// ---------------------------------------------------------------------------

function buildKnowledgeProvider(): {
  provider:       KnowledgeProvider;
  staticProvider: StaticCatalogProvider;
  reason:         string;
} {
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const searchKey      = process.env.AZURE_SEARCH_KEY;
  const indexName      = process.env.DARKHORSE_RAG_INDEX_NAME ?? 'darkhorse-sap-knowledge-v1';

  const staticProvider = new StaticCatalogProvider();

  if (searchEndpoint && searchKey) {
    const azureProvider = new AzureSearchKnowledgeProvider({
      endpoint: searchEndpoint,
      apiKey:   searchKey,
      indexName
    });
    return {
      provider:       new CompositeKnowledgeProvider([azureProvider, staticProvider]),
      staticProvider,
      reason:         `composite: Azure AI Search (${indexName}) → static catalog`
    };
  }
  return {
    provider:       staticProvider,
    staticProvider,
    reason:         'static catalog only — AZURE_SEARCH_ENDPOINT/KEY not set'
  };
}

// ---------------------------------------------------------------------------
// MCP tool descriptors — returned by GET /mcp/tools so agents can introspect
// the catalog of available knowledge tools without having to hardcode names.
// ---------------------------------------------------------------------------

interface ToolDescriptor {
  name:        string;
  endpoint:    string;
  description: string;
  inputSchema: object;
}

const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name:        'verify_badi',
    endpoint:    '/tools/verify-badi',
    description:
      'Verify a BAdI exists in the SAP BAdI catalog and return its Clean Core level, ' +
      'enhancement spot, interface name, and recommended alternative if the BAdI is ' +
      'classic-only or hallucinated.',
    inputSchema: {
      type: 'object',
      required: ['badi_name'],
      properties: {
        badi_name: { type: 'string', description: 'BAdI name (e.g. ME_PROCESS_PO_CUST)' },
        program:   { type: 'string', description: 'Optional program context' },
        module:    { type: 'string', description: 'Optional SAP module (SD/MM/FI/...)' }
      }
    }
  },
  {
    name:        'verify_exit',
    endpoint:    '/tools/verify-exit',
    description:
      'Verify a customer exit / user exit exists. Catches LLM-hallucinated exit names ' +
      '(USEREXIT_ATP_QUANTITY etc.) and returns the correct BAdI/RAP alternative.',
    inputSchema: {
      type: 'object',
      required: ['exit_name'],
      properties: {
        exit_name:    { type: 'string', description: 'Exit name (e.g. USEREXIT_SAVE_DOCUMENT_PREPARE)' },
        program_name: { type: 'string', description: 'Optional program context for disambiguation' },
        exit_type:    {
          type: 'string',
          enum: ['CUSTOMER_EXIT', 'USER_EXIT', 'MENU_EXIT', 'SCREEN_EXIT'],
          description: 'Optional exit type filter'
        }
      }
    }
  },
  {
    name:        'check_clean_core_level',
    endpoint:    '/tools/check-clean-core-level',
    description:
      'Classify an SAP object against Clean Core Levels A-D. Returns the level, ' +
      'reasoning, and Level A/B alternatives the agent should use instead.',
    inputSchema: {
      type: 'object',
      required: ['object_name', 'object_type'],
      properties: {
        object_name: { type: 'string', description: 'SAP object name (e.g. VBAK, MARA, BAPI_SALESORDER_CREATEFROMDAT2)' },
        object_type: {
          type: 'string',
          enum: ['TABL', 'VIEW', 'CDS', 'FUNC', 'BAPI', 'CLAS', 'PROG', 'TRAN', 'BDEF', 'DDLS'],
          description: 'SAP object type'
        }
      }
    }
  },
  {
    name:        'get_application_log_pattern',
    endpoint:    '/tools/get-application-log-pattern',
    description:
      'Return an SLG1 Application Log pattern (ABAP snippet, log object, required FMs) ' +
      'for a given use case. Replaces ad-hoc custom log tables — always Level A.',
    inputSchema: {
      type: 'object',
      properties: {
        use_case:  { type: 'string', description: 'Use case keyword or pattern ID (BACKORDER, RAP_BEHAVIOR, BATCH_JOB, GENERIC)' },
        object:    { type: 'string', description: 'Optional custom log object name' },
        subobject: { type: 'string', description: 'Optional custom log subobject name' }
      }
    }
  },
  {
    name:        'get_cds_view',
    endpoint:    '/tools/get-cds-view',
    description:
      'Given a SAP standard table name, return the released CDS interface view that should ' +
      'be used instead of a direct SELECT. Powers the Code Agent\'s pre-generation grounding ' +
      'for any FROM <sap_table> reference.',
    inputSchema: {
      type: 'object',
      required: ['sap_table'],
      properties: {
        sap_table: { type: 'string', description: 'SAP standard table name (VBAK, MARA, KNA1, ...).' },
        use_case:  { type: 'string', description: 'Optional use case hint to refine the example SELECT.' }
      }
    }
  },
  {
    name:        'get_eml_syntax',
    endpoint:    '/tools/get-eml-syntax',
    description:
      'Return ABAP EML syntax for CREATE / UPDATE / DELETE / READ on a RAP-managed entity. ' +
      'Replaces classic BAPI / direct table writes with the Level A pattern.',
    inputSchema: {
      type: 'object',
      required: ['operation', 'entity'],
      properties: {
        operation: { type: 'string', enum: ['CREATE','UPDATE','DELETE','READ'], description: 'EML operation type.' },
        entity:    { type: 'string', description: 'Name of the RAP entity / BDEF alias.' }
      }
    }
  },
  {
    name:        'get_rap_pattern',
    endpoint:    '/tools/get-rap-pattern',
    description:
      'Return the canonical RAP layered structure (CDS data model, BDEF, behavior pool, ' +
      'projection, SRVD, SRVB) for a scenario. Drives the TDS object list for transactional ' +
      'developments — replaces classic PROG/FUGR generation.',
    inputSchema: {
      type: 'object',
      required: ['scenario'],
      properties: {
        scenario: {
          type: 'string',
          enum: ['TRANSACTIONAL','READ_ONLY_ANALYTICAL','DRAFT_ENABLED','MANAGED','UNMANAGED','PROJECTION','EXTENSION'],
          description: 'Target RAP scenario.'
        },
        object_type: { type: 'string', description: 'Reserved for future use.' },
        operation:   { type: 'string', description: 'Reserved for future use.' }
      }
    }
  },
  {
    name:        'acknowledge_catalog',
    endpoint:    '/catalog/acknowledge',
    description:
      'Persist a developer-acknowledged SAP exit or BAdI to the static seed catalog so future ' +
      'runs of the Clean Core verifier treat it as a known valid Level B object. Called from the ' +
      'code-preview "Regenerate with acknowledgements" flow.',
    inputSchema: {
      type: 'object',
      required: ['category', 'name'],
      properties: {
        category: { type: 'string', enum: ['exit', 'badi'], description: 'Catalog to write to.' },
        name:     { type: 'string', description: 'SAP object name (USEREXIT_CHECK_VBAP, BADI_*, etc.).' },
        module:   { type: 'string', description: 'Optional SAP module context.' },
        note:     { type: 'string', description: 'Optional free-text note explaining the acknowledgement.' }
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Build Express app
// ---------------------------------------------------------------------------

function buildApp(
  provider: KnowledgeProvider,
  staticProvider: StaticCatalogProvider,
  providerReason: string
): express.Application {

  const app = express();
  app.use(express.json({ limit: '128kb' }));

  // -------------------------------------------------------------------
  // GET /health — parent extension polls this to confirm server is up
  // -------------------------------------------------------------------
  app.get('/health', (_req: express.Request, res: express.Response) => {
    res.json({
      status:           'ok',
      service:          SERVICE_NAME,
      version:          SERVICE_VERSION,
      pid:              process.pid,
      uptime:           process.uptime(),
      tools:            TOOL_DESCRIPTORS.map(t => t.name),
      knowledgeProvider: { id: provider.id, reason: providerReason }
    });
  });

  // -------------------------------------------------------------------
  // GET /mcp/tools — MCP-style tool descriptor list
  // -------------------------------------------------------------------
  app.get('/mcp/tools', (_req: express.Request, res: express.Response) => {
    res.json({
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      tools:   TOOL_DESCRIPTORS
    });
  });

  // -------------------------------------------------------------------
  // Tool endpoints — each delegates to the corresponding pure-function
  // module and wraps the result/error in a uniform JSON envelope.
  // -------------------------------------------------------------------

  app.post('/tools/verify-badi', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'verify_badi', () =>
      verifyBadi(req.body as VerifyBadiInput, provider));
  });

  app.post('/tools/verify-exit', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'verify_exit', () =>
      verifyExit(req.body as VerifyExitInput, provider));
  });

  app.post('/tools/check-clean-core-level', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'check_clean_core_level', () =>
      checkCleanCoreLevel(req.body as CheckCleanCoreLevelInput, provider));
  });

  // GetApplicationLogPattern stays embedded (no RAG benefit, small finite set)
  app.post('/tools/get-application-log-pattern', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'get_application_log_pattern', () =>
      getApplicationLogPattern(req.body as GetApplicationLogPatternInput));
  });

  // Sprint 3 Session 1 — three new tools for pre-generation grounding
  app.post('/tools/get-cds-view', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'get_cds_view', () =>
      getCdsView(req.body as GetCdsViewInput, provider));
  });

  app.post('/tools/get-eml-syntax', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'get_eml_syntax', () =>
      getEmlSyntax(req.body as GetEmlSyntaxInput));
  });

  app.post('/tools/get-rap-pattern', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'get_rap_pattern', () =>
      getRapPattern(req.body as GetRapPatternInput));
  });

  // Sprint 3 — persist a developer-acknowledged SAP object to the seed catalog
  // so future runs treat it as known valid. After writing, the static provider
  // reloads its catalogs so the very next lookup sees the new entry.
  app.post('/catalog/acknowledge', (req: express.Request, res: express.Response) => {
    runTool(req, res, 'acknowledge_catalog', () => {
      const result = acknowledgeCatalog(
        req.body as AcknowledgeCatalogInput,
        staticProvider.getCatalogDir()
      );
      staticProvider.reload();
      return result;
    });
  });

  // -------------------------------------------------------------------
  // 404 + error handlers
  // -------------------------------------------------------------------
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({
      ok:    false,
      error: 'Unknown MCP endpoint. GET /mcp/tools for the tool list.'
    });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    process.stderr.write(`[DarkHorse MCP] Unhandled error: ${err.message}\n`);
    res.status(500).json({ ok: false, error: 'Internal MCP server error.' });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Uniform tool dispatch — wraps the tool function in a single JSON envelope
// shape: { ok, tool, data, error?, durationMs }
// ---------------------------------------------------------------------------
async function runTool(
  _req:  express.Request,
  res:   express.Response,
  name:  string,
  exec:  () => unknown | Promise<unknown>
): Promise<void> {
  const startMs = Date.now();

  try {
    const data = await exec();
    res.json({
      ok:         true,
      tool:       name,
      data,
      durationMs: Date.now() - startMs
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Input-validation errors carry a recognizable "tool_name: " prefix —
    // surface them as 400. Anything else is treated as an internal 500.
    const isValidationError = message.startsWith(`${name}:`);
    const status            = isValidationError ? 400 : 500;

    if (!isValidationError) {
      process.stderr.write(`[DarkHorse MCP] ${name} failed: ${message}\n`);
    }

    res.status(status).json({
      ok:         false,
      tool:       name,
      error:      message,
      durationMs: Date.now() - startMs
    });
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function setupShutdownHandlers(server: http.Server): void {
  const shutdown = (signal: string) => {
    process.stdout.write(`[DarkHorse MCP] Received ${signal}. Shutting down.\n`);

    server.close(() => {
      process.stdout.write('[DarkHorse MCP] Server closed. Exiting.\n');
      process.exit(0);
    });

    setTimeout(() => {
      process.stderr.write('[DarkHorse MCP] Forced exit after timeout.\n');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('disconnect', () => shutdown('parent-disconnect'));
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------
function validateEnvironment(): void {
  if (isNaN(MCP_PORT) || MCP_PORT < 1024 || MCP_PORT > 65535) {
    process.stderr.write(
      `[DarkHorse MCP] FATAL: Invalid port ${MCP_PORT}. Must be 1024-65535.\n`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  validateEnvironment();

  const { provider, staticProvider, reason } = buildKnowledgeProvider();

  const app    = buildApp(provider, staticProvider, reason);
  const server = http.createServer(app);

  setupShutdownHandlers(server);

  server.listen(MCP_PORT, MCP_HOST, () => {
    process.stdout.write(`[DarkHorse MCP] Ready on ${MCP_HOST}:${MCP_PORT}\n`);
    process.stdout.write(
      `[DarkHorse MCP] Tools: ${TOOL_DESCRIPTORS.map(t => t.name).join(', ')}\n`
    );
    process.stdout.write(`[DarkHorse MCP] KnowledgeProvider: ${reason}\n`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[DarkHorse MCP] FATAL: Port ${MCP_PORT} is already in use.\n`
      );
    } else {
      process.stderr.write(`[DarkHorse MCP] FATAL: Server error: ${err.message}\n`);
    }
    process.exit(1);
  });
}

main().catch((err: Error) => {
  process.stderr.write(`[DarkHorse MCP] FATAL startup error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
