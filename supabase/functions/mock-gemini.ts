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
    category: 'critical_salon',
    payload: {
      reviewDraft:
        'The staff was warm and attentive, but my service took too long as I waited 45 minutes past my appointment time. Also felt pricing was higher than expected.',
      wordCount: 33,
      sentiment: 'negative',
    },
  },
  'FIX-AI-NEG-CAFE': {
    id: 'FIX-AI-NEG-CAFE',
    category: 'critical_cafe',
    payload: {
      reviewDraft:
        'My beverage was cold, and counter service took too long during my visit.',
      wordCount: 13,
      sentiment: 'negative',
    },
  },
};

/**
 * Checks whether an MCQ option label contains a disjunction ("or", "/", "either"),
 * meaning selection of the label alone does not establish any single specific branch.
 */
export function isDisjunctiveOption(text: string): boolean {
  return /\bor\b|\/|\beither\b/i.test(text);
}

/**
 * Checks whether a text snippet contains an unambiguous, non-negated
 * affirmation that a beverage was cold.
 */
export function hasExplicitColdAffirmation(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!/\bcold\b/.test(lower)) return false;

  // Disjunctive uncertainty inside text: e.g. "cold or delayed", "cold / delayed"
  if (
    /\bcold\s+(?:or|\/)\s+delayed\b/.test(lower) ||
    /\bdelayed\s+(?:or|\/)\s+cold\b/.test(lower)
  ) {
    return false;
  }

  // Negation pattern: "not cold", "wasn't cold", "was not cold", "never cold", "isn't cold"
  if (
    /\b(?:not|wasn'?t|was\s+not|isn'?t|is\s+not|never|hardly|no)\s+(?:very\s+|too\s+|that\s+)?cold\b/.test(
      lower,
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Checks whether a text snippet contains an unambiguous, non-negated
 * affirmation of slow counter service or long wait times.
 */
export function hasExplicitSlowServiceAffirmation(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasSlowKeyword =
    /\b(?:slow|took\s+(?:too\s+|a\s+)?long|longer\s+than|long\s+wait|waited\s+(?:too\s+|a\s+)?long)\b/.test(
      lower,
    );
  if (!hasSlowKeyword) return false;

  // Disjunctive uncertainty inside text: e.g. "slow or mix-up", "slow / order mix-up"
  if (
    /\bslow\s+(?:or|\/)\s+(?:order\s+)?mix-up\b/.test(lower) ||
    /\bmix-up\s+(?:or|\/)\s+slow\b/.test(lower)
  ) {
    return false;
  }

  // Negation pattern: "not slow", "wasn't slow", "didn't take long", "did not take too long"
  if (
    /\b(?:not|wasn'?t|was\s+not|never|no)\s+(?:very\s+|too\s+|that\s+)?slow\b/.test(lower) ||
    /\b(?:didn'?t|did\s+not|never)\s+(?:take\s+(?:too\s+|a\s+)?long|have\s+to\s+wait)\b/.test(
      lower,
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Determine fixture from prompt text and headers
 */
export function resolveFixture(promptText: string, scenarioHeader?: string): GroundedFixture | null {
  if (scenarioHeader) {
    const key = scenarioHeader.toUpperCase();
    if (GROUNDED_FIXTURES[key]) return GROUNDED_FIXTURES[key]!;
    if (key === 'NEUTRAL' || key === 'NEU') return GROUNDED_FIXTURES['FIX-AI-NEU']!;
    if (key === 'NEGATIVE_CAFE' || key === 'NEG_CAFE' || key === 'CRITICAL_CAFE')
      return GROUNDED_FIXTURES['FIX-AI-NEG-CAFE']!;
    if (key === 'NEGATIVE' || key === 'CRITICAL' || key === 'NEG')
      return GROUNDED_FIXTURES['FIX-AI-NEG']!;
    if (key === 'POSITIVE' || key === 'POS') return GROUNDED_FIXTURES['FIX-AI-POS']!;
  }

  const lower = promptText.toLowerCase();

  // Explicit test scenario override
  if (lower.includes('fix-ai-neg-cafe')) {
    return GROUNDED_FIXTURES['FIX-AI-NEG-CAFE']!;
  }

  // 1. Identify Vertical Category
  const isCafe =
    lower.includes('category: "cafe"') ||
    lower.includes('vertical category: "cafe"') ||
    lower.includes('the daily roast cafe') ||
    lower.includes('roast') ||
    lower.includes('cafe') ||
    lower.includes('bistro');

  // 2. Extract structured customer inputs from <USER_INPUT> envelope if present
  let customerNote = '';
  const affirmedExperiences: string[] = [];

  const userInputMatch = promptText.match(/<USER_INPUT>([\s\S]*?)<\/USER_INPUT>/i);
  if (userInputMatch && userInputMatch[1]) {
    const userBlock = userInputMatch[1];
    // Extract optional customer note
    const noteMatch =
      userBlock.match(/Optional Customer Note:\s*"([^"]*)"/i) ||
      userBlock.match(/Optional Customer Note:\s*'([^']*)'/i) ||
      userBlock.match(/Optional Customer Note:\s*([^\r\n]+)/i);
    if (noteMatch && noteMatch[1]) {
      customerNote = noteMatch[1].trim();
    }

    // Extract affirmed experiences list
    const experiencesMatch = userBlock.match(
      /Affirmed Experiences:\s*([\s\S]*?)(?:Optional Customer Note:|$)/i,
    );
    if (experiencesMatch && experiencesMatch[1]) {
      const lines = experiencesMatch[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('-')) {
          affirmedExperiences.push(trimmed.replace(/^-\s*/, '').trim());
        }
      }
    }
  } else {
    // Plain text format without <USER_INPUT> (e.g. direct tests like "The Daily Roast Cafe: Beverage was cold, service took too long")
    const colonIndex = promptText.indexOf(':');
    if (colonIndex !== -1) {
      customerNote = promptText.substring(colonIndex + 1).trim();
    } else {
      customerNote = promptText.trim();
    }
  }

  // 3. Cafe Predicate Evaluation:
  if (isCafe) {
    // Disjunctive options ("Cold or delayed beverage", "Slow counter service or order mix-up")
    // do NOT independently establish that a specific alternative occurred.
    // Unambiguous customer affirmation must come from non-disjunctive option or explicit note.
    const hasUnambiguousColdOption = affirmedExperiences.some(
      (opt) => !isDisjunctiveOption(opt) && hasExplicitColdAffirmation(opt),
    );
    const hasAffirmedCold = hasExplicitColdAffirmation(customerNote) || hasUnambiguousColdOption;

    const hasUnambiguousSlowOption = affirmedExperiences.some(
      (opt) => !isDisjunctiveOption(opt) && hasExplicitSlowServiceAffirmation(opt),
    );
    const hasAffirmedSlowService =
      hasExplicitSlowServiceAffirmation(customerNote) || hasUnambiguousSlowOption;

    // Both cold beverage and slow service must be unambiguously affirmed to return FIX-AI-NEG-CAFE:
    if (hasAffirmedCold && hasAffirmedSlowService) {
      return GROUNDED_FIXTURES['FIX-AI-NEG-CAFE']!;
    }

    // Check whether the prompt contains any critical / negative café feedback:
    const hasCafeCriticisms =
      lower.includes('cold') ||
      lower.includes('delayed') ||
      lower.includes('slow') ||
      lower.includes('mix-up') ||
      lower.includes('crowded') ||
      lower.includes('noisy') ||
      lower.includes('stale') ||
      lower.includes('disappointed') ||
      lower.includes('bad') ||
      lower.includes('took too long') ||
      affirmedExperiences.some(
        (opt) =>
          /cold|delayed|slow|mix-up|crowded|noisy|stale|disappointed|bad/i.test(opt),
      );

    // If critical feedback was provided but specific facts are ambiguous, unsupported, or incomplete:
    // Fail closed with null (HTTP 422 UNPROCESSABLE_ENTITY). Never launder into false praise (FIX-AI-POS)!
    if (hasCafeCriticisms) {
      return null;
    }
  }

  // 4. Critical Salon Feedback:
  // Requires explicit salon context with appointment delay or pricing complaint
  const isSalon =
    lower.includes('salon') || lower.includes('luxe') || lower.includes('hair') || lower.includes('beauty');
  const hasSalonCriticalFacts =
    lower.includes('fix-ai-neg') ||
    lower.includes('waited 45 mins') ||
    lower.includes('appointment time') ||
    (isSalon &&
      (lower.includes('pricing was higher') ||
        (lower.includes('service took too long') && lower.includes('appointment'))));

  if (hasSalonCriticalFacts) {
    return GROUNDED_FIXTURES['FIX-AI-NEG']!;
  }

  // 5. Neutral Feedback
  if (
    lower.includes('fix-ai-neu') ||
    lower.includes('standard / satisfactory') ||
    lower.includes('ac was set a bit too cold')
  ) {
    return GROUNDED_FIXTURES['FIX-AI-NEU']!;
  }

  // 6. Default Positive Feedback
  return GROUNDED_FIXTURES['FIX-AI-POS']!;
}

/**
 * Wrap review payload in official Google Gemini REST API generateContent envelope
 */
export function buildGeminiResponseEnvelope(
  payload: ReviewDraftPayload,
  options?: { strictReviewDraftOnly?: boolean },
) {
  const candidateText = options?.strictReviewDraftOnly
    ? JSON.stringify({ reviewDraft: payload.reviewDraft })
    : JSON.stringify(payload);

  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: candidateText,
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

    req.on('end', async () => {
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

        // Check if prompt explicitly triggers generation deadline exceedance (>8000ms delay)
        if (promptText.includes('FIX-AI-DEADLINE')) {
          await new Promise((resolve) => setTimeout(resolve, 8500));
          res.statusCode = 504;
          res.end(
            JSON.stringify({
              error: {
                code: 504,
                message: 'Simulated Mock Gemini Exceeded Deadline (8500ms)',
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

        if (!fixture) {
          res.statusCode = 422;
          res.end(
            JSON.stringify({
              error: {
                code: 422,
                message:
                  'Mock Gemini Grounding: Prompt contains ungrounded or conflicting critical facts that cannot be mapped to a deterministic fixture safely.',
                status: 'UNPROCESSABLE_ENTITY',
              },
            }),
          );
          return;
        }

        res.statusCode = 200;

        if (isDirectGenerate) {
          // Direct response satisfying roadmap acceptance criteria: valid { reviewDraft: "..." } JSON
          res.end(JSON.stringify(fixture.payload));
        } else {
          // Standard Google Gemini REST format with candidates wrapper
          // If caller specifies responseSchema in generationConfig, honor strictly and return only reviewDraft
          const hasResponseSchema = Boolean(parsedBody?.generationConfig?.responseSchema);
          res.end(
            JSON.stringify(
              buildGeminiResponseEnvelope(fixture.payload, {
                strictReviewDraftOnly: hasResponseSchema,
              }),
            ),
          );
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
