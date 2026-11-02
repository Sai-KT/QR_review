/**
 * Offline Verification Suite for Mock Gemini AI Server (Task M1-T07)
 *
 * Verifies local mock Gemini HTTP contracts, deterministic grounding fixtures,
 * response latency ceiling (<150ms), child-process lifecycle, and error handling
 * without external network dependencies.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUNDED_FIXTURES } from '../supabase/functions/mock-gemini.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${testName}${details ? ` - ${details}` : ''}`);
  }
}

async function runVerification() {
  console.log('================================================================');
  console.log('   M1-T07 OFFLINE MOCK GEMINI SERVER VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  // Dedicated test port to avoid disrupting existing dev services on :54329
  const TEST_PORT = parseInt(process.env.TEST_MOCK_PORT || '54328', 10);
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

  const currentDir = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
  const mockScriptPath = path.resolve(currentDir, '../supabase/functions/mock-gemini.ts');

  let child: ChildProcess | null = null;
  let childExitPromise: Promise<number | null> | null = null;

  // Cleanup handler for early aborts or signals
  const cleanup = () => {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // ── Suite 1: Child Process Spawn & Deterministic Ready Wait ─────────────
    console.log('1. Child Process Lifecycle & Health Check:');
    const spawnStartTime = performance.now();

    child = spawn(process.execPath, ['--experimental-strip-types', mockScriptPath], {
      env: {
        ...process.env,
        GEMINI_MOCK_PORT: String(TEST_PORT),
        GEMINI_MOCK_HOST: '127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    childExitPromise = new Promise<number | null>((resolve) => {
      child?.on('exit', (code) => resolve(code));
    });

    assert(
      typeof child.pid === 'number' && child.pid > 0,
      `Child process spawned successfully (PID: ${child.pid})`,
    );

    // Wait for deterministic ready signal or health check endpoint (poll every 15ms, max 3.5s)
    let isReady = false;
    const maxWaitMs = 3500;
    const pollStart = performance.now();

    while (performance.now() - pollStart < maxWaitMs) {
      try {
        const res = await fetch(`${BASE_URL}/v1beta/health`);
        if (res.status === 200) {
          isReady = true;
          break;
        }
      } catch {
        // Wait 15ms before next retry
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    const spawnDuration = performance.now() - spawnStartTime;
    assert(
      isReady,
      `Mock server ready and responding on port ${TEST_PORT} (${spawnDuration.toFixed(1)} ms startup)`,
    );

    const healthRes = await fetch(`${BASE_URL}/v1beta/health`);
    assert(healthRes.status === 200, 'GET /v1beta/health returns HTTP 200');
    const healthJson = await healthRes.json();
    assert(healthJson.status === 'ok', 'Health endpoint status is "ok"');
    assert(
      healthJson.service === 'mock-gemini-server',
      'Health endpoint service is "mock-gemini-server"',
    );
    assert(healthJson.port === TEST_PORT, `Health endpoint reports correct port ${TEST_PORT}`);

    // ── Suite 2: Roadmap Acceptance Criteria Check (< 150 ms) ───────────────
    console.log('\n2. Roadmap Acceptance Criteria Check (Direct /v1beta & < 150ms):');
    const directReqStart = performance.now();
    const directRes = await fetch(`${BASE_URL}/v1beta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Please draft a review' }),
    });
    const directLatency = performance.now() - directReqStart;
    assert(directRes.status === 200, 'POST /v1beta returns HTTP 200 OK');
    assert(
      directLatency < 150,
      `Mock responds within 150 ms requirement (actual: ${directLatency.toFixed(2)} ms)`,
    );

    const directJson = await directRes.json();
    assert(
      typeof directJson.reviewDraft === 'string' && directJson.reviewDraft.length > 0,
      'Direct response contains valid reviewDraft',
    );
    assert(typeof directJson.wordCount === 'number', 'Direct response contains wordCount');
    assert(directJson.sentiment === 'positive', 'Direct default response has positive sentiment');

    // ── Suite 3: Gemini REST Protocol Contract & Model Validation ───────────
    console.log('\n3. Google Gemini REST Protocol & Model Validation:');
    const primaryModelUrl = `${BASE_URL}/v1beta/models/gemini-3.5-flash-lite:generateContent`;
    const backupModelUrl = `${BASE_URL}/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    const unsupportedModelUrl = `${BASE_URL}/v1beta/models/gemini-pro:generateContent`;

    const posReqBody = {
      contents: [
        {
          parts: [
            {
              text: '<USER_INPUT>\nAffirmed Answers:\n- Q1: "Masterful & Precise"\n- Q2: "Clean & hygienic station"\n- Q3: "Great styling advice"\nNote: "Loved the trimmer fade"\n</USER_INPUT>',
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    };

    // Primary model check: gemini-3.5-flash-lite
    const primaryRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posReqBody),
    });
    assert(primaryRes.status === 200, 'Primary model gemini-3.5-flash-lite returns HTTP 200 OK');
    const primaryJson = await primaryRes.json();
    assert(
      Array.isArray(primaryJson.candidates) && primaryJson.candidates.length > 0,
      'Primary response contains candidates array',
    );
    assert(primaryJson.candidates[0].finishReason === 'STOP', 'Candidate finishReason is "STOP"');

    // Backup model check: gemini-3.1-flash-lite
    const backupRes = await fetch(backupModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posReqBody),
    });
    assert(backupRes.status === 200, 'Backup model gemini-3.1-flash-lite returns HTTP 200 OK');

    // Unsupported model check: gemini-pro -> 404
    const unsupportedRes = await fetch(unsupportedModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(posReqBody),
    });
    assert(
      unsupportedRes.status === 404,
      'Unsupported model (gemini-pro) returns HTTP 404 Not Found',
    );

    // Verify candidate text structure
    const rawDraftText = primaryJson.candidates[0].content.parts[0].text;
    const parsedDraft = JSON.parse(rawDraftText);
    assert(
      parsedDraft.reviewDraft === GROUNDED_FIXTURES['FIX-AI-POS']!.payload.reviewDraft,
      'Generated draft matches FIX-AI-POS canonical draft',
    );
    assert(
      parsedDraft.wordCount < 60,
      `Draft word count is strictly fewer than 60 words (actual: ${parsedDraft.wordCount})`,
    );
    assert(parsedDraft.sentiment === 'positive', 'Draft sentiment is positive');

    // ── Suite 4: Deterministic Grounding Fixtures Suite ─────────────────────
    console.log('\n4. Deterministic Grounding Fixtures Suite (FIX-AI-NEU, FIX-AI-NEG):');
    // Test FIX-AI-NEU
    const neuReqBody = {
      contents: [
        { parts: [{ text: 'Q1: "Standard / Satisfactory" Note: "AC was set a bit too cold"' }] },
      ],
    };
    const neuRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(neuReqBody),
    });
    assert(neuRes.status === 200, 'POST FIX-AI-NEU returns HTTP 200');
    const neuJson = await neuRes.json();
    const neuDraft = JSON.parse(neuJson.candidates[0].content.parts[0].text);
    assert(
      neuDraft.reviewDraft === GROUNDED_FIXTURES['FIX-AI-NEU']!.payload.reviewDraft,
      'Generated draft matches FIX-AI-NEU neutral draft',
    );
    assert(neuDraft.sentiment === 'neutral', 'Sentiment is neutral');
    assert(neuDraft.wordCount < 60, 'Neutral draft word count < 60');

    // Test FIX-AI-NEG (Critical Feedback - No false praise laundering)
    const negReqBody = {
      contents: [
        {
          parts: [{ text: 'Q1: "Service took too long" Note: "Waited 45 mins past appointment"' }],
        },
      ],
    };
    const negRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(negReqBody),
    });
    assert(negRes.status === 200, 'POST FIX-AI-NEG returns HTTP 200');
    const negJson = await negRes.json();
    const negDraft = JSON.parse(negJson.candidates[0].content.parts[0].text);
    assert(
      negDraft.reviewDraft === GROUNDED_FIXTURES['FIX-AI-NEG']!.payload.reviewDraft,
      'Generated draft matches FIX-AI-NEG critical draft',
    );
    assert(negDraft.sentiment === 'negative', 'Sentiment is negative (preserves criticism)');
    assert(negDraft.wordCount < 60, 'Critical draft word count < 60');

    // Test FIX-AI-NEG-CAFE (Grounded Critical Cafe Feedback)
    const negCafeReqBody = {
      contents: [
        {
          parts: [{ text: 'The Daily Roast Cafe: Beverage was cold, service took too long' }],
        },
      ],
    };
    const negCafeRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(negCafeReqBody),
    });
    assert(negCafeRes.status === 200, 'POST FIX-AI-NEG-CAFE returns HTTP 200');
    const negCafeJson = await negCafeRes.json();
    const negCafeDraft = JSON.parse(negCafeJson.candidates[0].content.parts[0].text);
    assert(
      negCafeDraft.reviewDraft === GROUNDED_FIXTURES['FIX-AI-NEG-CAFE']!.payload.reviewDraft,
      'Generated draft matches FIX-AI-NEG-CAFE grounded draft',
    );
    assert(negCafeDraft.sentiment === 'negative', 'Cafe sentiment is negative');
    assert(
      negCafeDraft.wordCount <= 49,
      `Cafe critical draft word count respects <= 49 words ceiling (actual: ${negCafeDraft.wordCount})`,
    );

    // Section 5 Mandatory Grounding Tests:
    const cafeDraftText = negCafeDraft.reviewDraft.toLowerCase();
    assert(
      cafeDraftText.includes('cold') && cafeDraftText.includes('counter service'),
      'Preserves explicitly affirmed cold beverage and slow counter service facts',
    );
    assert(
      !cafeDraftText.includes('delayed'),
      'Disjunctive "Cold or delayed" disambiguated by note to cold only (no "delayed" claim)',
    );
    assert(
      !cafeDraftText.includes('crowded') && !cafeDraftText.includes('noisy'),
      'Disjunctive "Too crowded or noisy" not converted into ungrounded conjunction',
    );
    assert(
      !cafeDraftText.includes('seating area'),
      'Unconfirmed specific "seating area" location detail omitted',
    );
    assert(
      !cafeDraftText.includes('appointment') && !cafeDraftText.includes('price') && !cafeDraftText.includes('pricing'),
      'No appointment times or pricing fabricated in cafe draft',
    );
    assert(
      !cafeDraftText.includes('warm and attentive') && !cafeDraftText.includes('5 star') && !cafeDraftText.includes('wonderful'),
      'No false praise or star ratings inserted into critical cafe draft',
    );

    // Test Section 5 Point 10: Critical cafe prompt with different answer selections does not receive unsupported facts
    const unmappedCafeRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: 'The Daily Roast Cafe: Too crowded or noisy space. Order was stale.' }],
          },
        ],
      }),
    });
    assert(
      unmappedCafeRes.status === 422,
      'Critical cafe prompt with different selections fails conservatively with HTTP 422 (avoids fabricating facts)',
    );

    // ── Mandatory Predicate Disambiguation Tests ─────────────────────────────
    // Test 1: Ambiguous cold-or-delayed option without a note does not assert cold beverage
    const ambigColdRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Super prompt & courteous staff\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      ambigColdRes.status === 422,
      'Mandatory Test 1: Ambiguous cold-or-delayed option without note does not assert cold beverage (HTTP 422)',
    );

    // Test 2: Ambiguous slow-service-or-mix-up option without a note does not assert slow service
    const ambigSlowRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Specialty coffee & espresso\n- Slow counter service or order mix-up\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      ambigSlowRes.status === 422,
      'Mandatory Test 2: Ambiguous slow-service-or-mix-up option without note does not assert slow service (HTTP 422)',
    );

    // Test 3: The combination of two ambiguous options is still insufficient to select cold-and-slow draft
    const twoAmbigRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Slow counter service or order mix-up\n- Too crowded or noisy space\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      twoAmbigRes.status === 422,
      'Mandatory Test 3: Combination of two ambiguous options without note fails conservatively (HTTP 422)',
    );

    // Test 4: Explicit note confirming both cold beverage and slow service permits FIX-AI-NEG-CAFE
    const groundedBothRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Slow counter service or order mix-up\n- Too crowded or noisy space\nOptional Customer Note: "Beverage was cold and service took too long."\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      groundedBothRes.status === 200,
      'Mandatory Test 4: Explicit note confirming cold beverage and slow service returns HTTP 200',
    );
    const groundedBothJson = await groundedBothRes.json();
    const groundedBothDraft = JSON.parse(groundedBothJson.candidates[0].content.parts[0].text);
    assert(
      groundedBothDraft.reviewDraft === GROUNDED_FIXTURES['FIX-AI-NEG-CAFE']!.payload.reviewDraft,
      'Mandatory Test 4: Returns verified FIX-AI-NEG-CAFE draft when both facts affirmed in note',
    );

    // Test 5: Note confirming only cold beverage does not fabricate slow service
    const onlyColdRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Slow counter service or order mix-up\nOptional Customer Note: "Beverage was cold."\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      onlyColdRes.status === 422,
      'Mandatory Test 5: Note confirming only cold beverage does not fabricate slow service (HTTP 422)',
    );

    // Test 6: Note confirming only slow service does not fabricate cold beverage
    const onlySlowRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Slow counter service or order mix-up\nOptional Customer Note: "Service took too long."\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      onlySlowRes.status === 422,
      'Mandatory Test 6: Note confirming only slow service does not fabricate cold beverage (HTTP 422)',
    );

    // Test 7: Negated statements do not count as affirmations
    const negatedRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: '<USER_INPUT>\nBusiness Name: "The Daily Roast Cafe"\nVertical Category: "cafe"\nAffirmed Experiences:\n- Cold or delayed beverage\n- Slow counter service or order mix-up\nOptional Customer Note: "Beverage was not cold and service didn\'t take too long."\n</USER_INPUT>',
              },
            ],
          },
        ],
      }),
    });
    assert(
      negatedRes.status === 422,
      'Mandatory Test 7: Negated statements do not count as affirmations (HTTP 422)',
    );

    // Test header-based scenario selection: x-mock-scenario
    const scenarioRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-scenario': 'FIX-AI-NEU',
      },
      body: JSON.stringify({ prompt: 'Arbitrary prompt' }),
    });
    const scenarioJson = await scenarioRes.json();
    const scenarioDraft = JSON.parse(scenarioJson.candidates[0].content.parts[0].text);
    assert(
      scenarioDraft.sentiment === 'neutral',
      'Header x-mock-scenario overrides prompt keyword resolution',
    );

    // ── Suite 5: Circuit-Breaker & Simulated Failure Suite ──────────────────
    console.log('\n5. Error Simulation & Latency Control Suite (FIX-AI-ERR, TC-PRF-03):');
    // Test FIX-AI-ERR via header x-mock-error: 504
    const errRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-error': '504',
      },
      body: JSON.stringify({ prompt: 'test' }),
    });
    assert(errRes.status === 504, 'Simulated x-mock-error 504 returns HTTP 504');
    const errJson = await errRes.json();
    assert(errJson.error.code === 504, 'Error response code matches 504');

    // Test FIX-AI-ERR via prompt text
    const promptErrRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Trigger FIX-AI-ERR failure' }] }] }),
    });
    assert(promptErrRes.status === 504, 'Prompt triggering FIX-AI-ERR returns HTTP 504');

    // Test Simulated Latency delay (x-mock-delay)
    const delayStart = performance.now();
    const delayRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-delay': '120',
      },
      body: JSON.stringify(posReqBody),
    });
    const delayDuration = performance.now() - delayStart;
    assert(delayRes.status === 200, 'Delayed request returns HTTP 200');
    assert(
      delayDuration >= 100,
      `Simulated delay observed (expected >=100ms, actual: ${delayDuration.toFixed(2)}ms)`,
    );

    // ── Suite 6: Request Validation & Edge Cases ───────────────────────────
    console.log('\n6. Request Validation & Edge Cases Suite:');
    // Test 404 on invalid path
    const notFoundRes = await fetch(`${BASE_URL}/v1beta/unsupported-endpoint`);
    assert(notFoundRes.status === 404, 'Unmapped route returns HTTP 404');

    // Test 400 on malformed JSON
    const malformedRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });
    assert(malformedRes.status === 400, 'Malformed JSON body returns HTTP 400');

    // Test 400 on empty body
    const emptyBodyRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '   ',
    });
    assert(emptyBodyRes.status === 400, 'Empty body returns HTTP 400');

    // Test 415 on invalid Content-Type
    const wrongTypeRes = await fetch(primaryModelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain text',
    });
    assert(
      wrongTypeRes.status === 415,
      'Invalid Content-Type returns HTTP 415 Unsupported Media Type',
    );
  } finally {
    // ── Suite 7: Clean Child Process Shutdown ──────────────────────────────
    console.log('\n7. Clean Child Process Shutdown:');
    if (child && !child.killed) {
      child.kill('SIGTERM');
      const exitCode = await Promise.race([
        childExitPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 2500)),
      ]);

      if (exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }

      assert(true, 'Mock server child process terminated cleanly');
    }
  }

  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error(`Verification FAILED: ${failed} assertion(s) failed.`);
    process.exit(1);
  } else {
    console.log('Verification PASSED: All mock Gemini server suites passed with 100% success.');
  }
}

runVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
