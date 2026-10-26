/**
 * Local Mock Google Gemini Flash AI Server
 *
 * Task: M1-T07 — Supabase CLI Local Emulation & Mock Gemini Deno Server Setup
 * Port: 54329 (default, avoiding collision with Supabase Studio on :54323)
 * Base Path: /v1beta
 *
 * Runtime: Dual-compatible with Node.js 20+ (node --experimental-strip-types)
 * and Deno 1.35+/2.x (deno run --allow-net). Uses built-in node:http with zero dependencies.
 */

import http from 'node:http';

export interface ReviewDraftPayload {
  reviewDraft: string;
  wordCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface GroundedFixture {
  id: string;
  category: string;
  payload: ReviewDraftPayload;
}

/**
 * Canonical Grounded AI Test Fixtures from docs/TEST_PLAN.md §14 and docs/API_SPEC.md §9.3
 */
export const GROUNDED_FIXTURES: Record<string, GroundedFixture> = {
  'FIX-AI-POS': {
    id: 'FIX-AI-POS',
    category: 'positive_salon',
    payload: {
      reviewDraft:
        'Had a masterful and precise service today. The station was clean and hygienic, and I received great styling advice. Loved the trimmer fade.',
      wordCount: 24,
      sentiment: 'positive',
    },
  },
  'FIX-AI-NEU': {
    id: 'FIX-AI-NEU',
    category: 'neutral_salon',
    payload: {
      reviewDraft:
        'My visit was satisfactory and the station was clean. The ambience was calm and relaxing, although the AC was set a bit too cold during my service.',
      wordCount: 28,
      sentiment: 'neutral',
    },
  },
  'FIX-AI-NEG': {
    id: 'FIX-AI-NEG',
    category: 'critical_feedback',
    payload: {
      reviewDraft:
        'The staff was warm and attentive, but my service took too long as I waited 45 minutes past my appointment time. Also felt pricing was higher than expected.',
      wordCount: 33,
      sentiment: 'negative',
    },
  },
};

/**
 * Determine fixture from prompt text and headers
 */
export function resolveFixture(promptText: string, scenarioHeader?: string): GroundedFixture {
  if (scenarioHeader) {
    const key = scenarioHeader.toUpperCase();
    if (GROUNDED_FIXTURES[key]) return GROUNDED_FIXTURES[key]!;
    if (key === 'NEUTRAL' || key === 'NEU') return GROUNDED_FIXTURES['FIX-AI-NEU']!;
    if (key === 'NEGATIVE' || key === 'CRITICAL' || key === 'NEG')
      return GROUNDED_FIXTURES['FIX-AI-NEG']!;
    if (key === 'POSITIVE' || key === 'POS') return GROUNDED_FIXTURES['FIX-AI-POS']!;
  }

  const lower = promptText.toLowerCase();
  if (
    lower.includes('fix-ai-neg') ||
    lower.includes('service took too long') ||
    lower.includes('waited 45 mins') ||
    lower.includes('pricing was higher than expected')
  ) {
    return GROUNDED_FIXTURES['FIX-AI-NEG']!;
  }

  if (
    lower.includes('fix-ai-neu') ||
    lower.includes('standard / satisfactory') ||
    lower.includes('ac was set a bit too cold')
  ) {
    return GROUNDED_FIXTURES['FIX-AI-NEU']!;
  }

  return GROUNDED_FIXTURES['FIX-AI-POS']!;
}

/**
 * Wrap review payload in official Google Gemini REST API generateContent envelope
 */
export function buildGeminiResponseEnvelope(payload: ReviewDraftPayload) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify(payload),
            },
          ],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 124,
      candidatesTokenCount: payload.wordCount,
      totalTokenCount: 124 + payload.wordCount,
    },
  };
}

/**
 * Create HTTP request handler
 */
export function createRequestHandler() {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method ?? 'GET';

    // Set standard CORS & security headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-mock-scenario, x-mock-delay, x-mock-error',
    );
    res.setHeader('Content-Type', 'application/json');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Health check endpoint
    if (pathname === '/' || pathname === '/v1beta/health' || pathname === '/health') {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'mock-gemini-server',
          port: req.socket.localPort ?? 54329,
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        }),
      );
      return;
    }

    // Check for simulated network delay (TC-PRF-03)
    const delayHeader = req.headers['x-mock-delay'];
    const delayMs = delayHeader ? parseInt(String(delayHeader), 10) : 0;
    if (delayMs > 0 && !isNaN(delayMs)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Check for simulated error trigger (TC-API-09 / FIX-AI-ERR)
    const errorHeader = req.headers['x-mock-error'];
    if (errorHeader) {
      const statusCode = parseInt(String(errorHeader), 10) || 500;
      res.statusCode = statusCode;
      res.end(
        JSON.stringify({
          error: {
            code: statusCode,
            message: `Simulated Mock Gemini Error: HTTP ${statusCode}`,
            status: statusCode === 504 ? 'DEADLINE_EXCEEDED' : 'INTERNAL',
          },
        }),
      );
      return;
    }

    // Gemini REST Generation Endpoint: POST /v1beta/models/:model:generateContent
    const geminiModelMatch = pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
    const isGeminiGenerateContent = method === 'POST' && Boolean(geminiModelMatch);

    // Direct Acceptance Endpoint: POST /v1beta or POST /v1beta/generate
    const isDirectGenerate =
      method === 'POST' && (pathname === '/v1beta' || pathname === '/v1beta/generate');

    if (!isGeminiGenerateContent && !isDirectGenerate) {
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          error: {
            code: 404,
            message: `Mock endpoint not found: ${method} ${pathname}`,
            status: 'NOT_FOUND',
          },
        }),
      );
      return;
    }

    // Supported model verification for Gemini REST endpoint
    const SUPPORTED_MODELS = new Set(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
    if (isGeminiGenerateContent && geminiModelMatch) {
      const requestedModel = geminiModelMatch[1] ?? '';
      if (!SUPPORTED_MODELS.has(requestedModel)) {
        res.statusCode = 404;
        res.end(
          JSON.stringify({
            error: {
              code: 404,
              message: `Model '${requestedModel}' not found. Supported models: ${Array.from(SUPPORTED_MODELS).join(', ')}`,
              status: 'NOT_FOUND',
            },
          }),
        );
        return;
      }
    }

    // Validate Content-Type for POST generation requests
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
      res.statusCode = 415;
      res.end(
        JSON.stringify({
          error: {
            code: 415,
            message: 'Unsupported Media Type: Content-Type must be application/json',
            status: 'INVALID_ARGUMENT',
          },
        }),
      );
      return;
    }

    // Read POST body
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        if (!body.trim()) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: {
                code: 400,
                message: 'Request body must not be empty',
                status: 'INVALID_ARGUMENT',
              },
            }),
          );
          return;
        }

        let promptText = '';
        const parsedBody = JSON.parse(body);
        if (typeof parsedBody === 'object' && parsedBody !== null) {
          // Extract text from Gemini format { contents: [{ parts: [{ text: "..." }] }] }
          const parts = parsedBody.contents?.[0]?.parts;
          if (Array.isArray(parts)) {
            promptText = parts.map((p: { text?: string }) => p.text ?? '').join(' ');
          } else if (typeof parsedBody.prompt === 'string') {
            promptText = parsedBody.prompt;
          } else {
            promptText = JSON.stringify(parsedBody);
          }
        }

        // Check if prompt explicitly triggers error fixture
        if (promptText.includes('FIX-AI-ERR')) {
          res.statusCode = 504;
          res.end(
            JSON.stringify({
              error: {
                code: 504,
                message: 'Simulated Mock Gemini Timeout (FIX-AI-ERR)',
                status: 'DEADLINE_EXCEEDED',
              },
            }),
          );
          return;
        }

        const scenarioHeader = req.headers['x-mock-scenario']
          ? String(req.headers['x-mock-scenario'])
          : undefined;
        const fixture = resolveFixture(promptText, scenarioHeader);

        res.statusCode = 200;

        if (isDirectGenerate) {
          // Direct response satisfying roadmap acceptance criteria: valid { reviewDraft: "..." } JSON
          res.end(JSON.stringify(fixture.payload));
        } else {
          // Standard Google Gemini REST format with candidates wrapper
          res.end(JSON.stringify(buildGeminiResponseEnvelope(fixture.payload)));
        }
      } catch (err) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: {
              code: 400,
              message: `Malformed JSON request body: ${err instanceof Error ? err.message : String(err)}`,
              status: 'INVALID_ARGUMENT',
            },
          }),
        );
      }
    });
  };
}

/**
 * Start mock server on specified port and host
 */
export function startMockServer(
  port: number = parseInt(process.env.GEMINI_MOCK_PORT || process.env.PORT || '54329', 10),
  host: string = process.env.GEMINI_MOCK_HOST || process.env.HOST || '127.0.0.1',
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(createRequestHandler());

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

// Auto-run if executed directly as entrypoint
const isDirectExecution =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]) &&
  Boolean(
    process.argv[1].replace(/\\/g, '/').endsWith('/mock-gemini.ts') ||
    process.argv[1] === import.meta.filename,
  );

if (isDirectExecution) {
  const targetPort = parseInt(process.env.GEMINI_MOCK_PORT || process.env.PORT || '54329', 10);
  const targetHost = process.env.GEMINI_MOCK_HOST || process.env.HOST || '127.0.0.1';

  startMockServer(targetPort, targetHost)
    .then((server) => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : targetPort;
      console.log(
        `[mock-gemini] Mock Gemini AI server listening on http://${targetHost}:${actualPort}/v1beta (PID: ${process.pid})`,
      );
      console.log(`[mock-gemini] Ready for offline Edge Function testing (API-PUB-03 / TC-AI-01).`);
    })
    .catch((err) => {
      console.error(`[mock-gemini] Failed to start server:`, err);
      process.exit(1);
    });
}
