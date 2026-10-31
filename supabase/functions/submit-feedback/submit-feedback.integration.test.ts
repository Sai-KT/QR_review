import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleFeedbackSubmission } from './index';
import {
  verifySubmissionToken,
  computeSurveyVersion,
} from '../_shared/crypto';

// Local Supabase configuration
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// 32 bytes (256-bit) cryptographically strong test signing secret in 64 hex characters
const TEST_SIGNING_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('submit-feedback Real PostgreSQL Integration Suite (Gate B)', () => {
  let supabase: SupabaseClient;

  // Real reference data fixtures from 20261030030000_reference_data.sql
  const realSalonQrId = 'luxe000001'; // Luxe Studio Unisex Salon
  const realSuspendedQrId = 'susp000001'; // Suspended Parlour

  const realQ1 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c';
  const realOpt1 = '1a2b3c4d-0001-4000-8000-000000000001'; // Masterful & Precise

  const realQ2 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d';
  const realOpt2 = '1a2b3c4d-0002-4000-8000-000000000002'; // Clean & hygienic station

  const realQ3 = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e';
  const realOpt3 = '1a2b3c4d-0003-4000-8000-000000000001'; // Great styling advice
  const realOpt3Alt = '1a2b3c4d-0003-4000-8000-000000000002'; // Calm & relaxing ambience

  const createdSessionUuids: string[] = [];

  beforeAll(() => {
    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  });

  afterAll(async () => {
    // Clean up test feedback records created during integration tests
    if (createdSessionUuids.length > 0) {
      await supabase
        .from('survey_responses')
        .delete()
        .in('session_uuid', createdSessionUuids);

      await supabase
        .from('analytics_events')
        .delete()
        .in('session_uuid', createdSessionUuids);
    }
  });

  function makeRequest(body: unknown): Request {
    return new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'test-publishable-key',
        },
        body: JSON.stringify(body),
      },
    );
  }

  /* ------------------------------------------------------------------------ */
  /* 1. Real PostgreSQL Persistence & Server-Owned Analytics Telemetry       */
  /* ------------------------------------------------------------------------ */

  it('persists authentic survey feedback and server-owned analytics event to PostgreSQL', async () => {
    const sessionUuid = crypto.randomUUID();
    createdSessionUuids.push(sessionUuid);

    const payload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
      optionalNote: 'Loved the haircut and styling!',
    };

    const res = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('recorded');
    expect(typeof body.responseId).toBe('string');
    expect(typeof body.submissionToken).toBe('string');

    // Query real PostgreSQL survey_responses table directly
    const { data: dbResponse, error: dbError } = await supabase
      .from('survey_responses')
      .select('id, business_id, category_id, selected_options, affirmed_facts_snapshot, optional_note, session_uuid')
      .eq('id', body.responseId)
      .single();

    expect(dbError).toBeNull();
    expect(dbResponse).toBeDefined();
    expect(dbResponse.category_id).toBe('salon');
    expect(dbResponse.optional_note).toBe('Loved the haircut and styling!');
    expect(dbResponse.session_uuid).toBe(sessionUuid);
    expect(dbResponse.affirmed_facts_snapshot).toContain('Masterful & Precise');
    expect(dbResponse.affirmed_facts_snapshot).toContain('Clean & hygienic station');
    expect(dbResponse.affirmed_facts_snapshot).toContain('Great styling advice');

    // Query real PostgreSQL analytics_events table directly
    const { data: dbEvents, error: eventError } = await supabase
      .from('analytics_events')
      .select('id, event_name, session_uuid, business_id')
      .eq('session_uuid', sessionUuid);

    expect(eventError).toBeNull();
    expect(dbEvents).toBeDefined();
    expect(dbEvents.length).toBe(1);
    expect(dbEvents[0].event_name).toBe('EVENT_SURVEY_COMPLETED');
    expect(dbEvents[0].business_id).toBe(dbResponse.business_id);

    // Verify cryptographic token signature against persisted identifiers
    const expectedSurveyVersion = computeSurveyVersion([realQ1, realQ2, realQ3]);
    const verification = verifySubmissionToken(
      body.submissionToken,
      dbResponse.business_id,
      sessionUuid,
      expectedSurveyVersion,
      TEST_SIGNING_SECRET,
    );

    expect(verification.valid).toBe(true);
    expect(verification.responseId).toBe(body.responseId);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Real Database Atomic Idempotency & Conflicting Payload Protection      */
  /* ------------------------------------------------------------------------ */

  it('returns existing record on identical retry without inserting duplicate rows', async () => {
    const sessionUuid = crypto.randomUUID();
    createdSessionUuids.push(sessionUuid);

    const payload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
      optionalNote: 'Clean station, great hospitality.',
    };

    // First request
    const res1 = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );
    expect(res1.status).toBe(201);
    const body1 = await res1.json();

    // Second request (identical retry)
    const res2 = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );
    expect(res2.status).toBe(201);
    const body2 = await res2.json();

    expect(body2.responseId).toBe(body1.responseId);
    expect(body2.status).toBe('recorded');

    // Verify exactly ONE row exists in PostgreSQL for this sessionUuid
    const { count: responseCount } = await supabase
      .from('survey_responses')
      .select('id', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);

    expect(responseCount).toBe(1);

    // Verify exactly ONE event exists in analytics_events (no duplicate telemetry)
    const { count: eventCount } = await supabase
      .from('analytics_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);

    expect(eventCount).toBe(1);
  });

  it('rejects conflicting payload with same sessionUuid with HTTP 409 ERR_IDEMPOTENCY_CONFLICT', async () => {
    const sessionUuid = crypto.randomUUID();
    createdSessionUuids.push(sessionUuid);

    const initialPayload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
      optionalNote: 'Initial note',
    };

    const conflictingPayload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3Alt }, // Changed Option!
      ],
      optionalNote: 'Conflicting note',
    };

    const res1 = await handleFeedbackSubmission(
      makeRequest(initialPayload),
      supabase,
      TEST_SIGNING_SECRET,
    );
    expect(res1.status).toBe(201);

    const res2 = await handleFeedbackSubmission(
      makeRequest(conflictingPayload),
      supabase,
      TEST_SIGNING_SECRET,
    );
    expect(res2.status).toBe(409);
    const errBody = await res2.json();
    expect(errBody.error.code).toBe('ERR_IDEMPOTENCY_CONFLICT');
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Live High-Concurrency Race Condition Testing                           */
  /* ------------------------------------------------------------------------ */

  it('handles 5 concurrent simultaneous duplicate submissions atomically via PostgreSQL unique index', async () => {
    const sessionUuid = crypto.randomUUID();
    createdSessionUuids.push(sessionUuid);

    const payload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
      optionalNote: 'Concurrent stress test note',
    };

    // Dispatch 5 concurrent requests simultaneously
    const requests = Array.from({ length: 5 }, () =>
      handleFeedbackSubmission(makeRequest(payload), supabase, TEST_SIGNING_SECRET),
    );

    const responses = await Promise.all(requests);

    // All 5 requests must resolve successfully (HTTP 201) with the same responseId
    const responseBodies = await Promise.all(responses.map((r) => r.json()));
    const responseIds = new Set(responseBodies.map((b) => b.responseId));

    for (const res of responses) {
      expect(res.status).toBe(201);
    }
    expect(responseIds.size).toBe(1); // Exactly one consistent responseId

    // Assert that PostgreSQL enforced atomic uniqueness: exactly 1 row created
    const { count } = await supabase
      .from('survey_responses')
      .select('id', { count: 'exact', head: true })
      .eq('session_uuid', sessionUuid);

    expect(count).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Survey Version Integrity & Question Replacement (Founder Section 6)    */
  /* ------------------------------------------------------------------------ */

  it('reconstructs survey version from persisted response and maintains validity across question replacement', async () => {
    const sessionUuid = crypto.randomUUID();
    createdSessionUuids.push(sessionUuid);

    const payload = {
      publicQrId: realSalonQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
      optionalNote: 'Testing survey version integrity across replacement',
    };

    const res = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    // 1. Fetch persisted response from PostgreSQL
    const { data: persistedRow } = await supabase
      .from('survey_responses')
      .select('business_id, session_uuid, selected_options')
      .eq('id', body.responseId)
      .single();

    // 2. Reconstruct survey version strictly from persisted selected_options
    interface PersistedSelectedOption {
      questionId?: string;
      question_id?: string;
    }
    const persistedOptions = (persistedRow.selected_options ??
      []) as PersistedSelectedOption[];
    const persistedQuestionIds = persistedOptions.map(
      (item) => item.questionId ?? item.question_id ?? '',
    );
    const reconstructedVersion = computeSurveyVersion(persistedQuestionIds);

    // 3. Verify token succeeds with reconstructed version
    const verificationBefore = verifySubmissionToken(
      body.submissionToken,
      persistedRow.business_id,
      persistedRow.session_uuid,
      reconstructedVersion,
      TEST_SIGNING_SECRET,
    );
    expect(verificationBefore.valid).toBe(true);

    // 4. Simulate real question replacement (Founder Decision M0-07):
    // Soft-retire realQ1 and activate a replacement Q1_v2 for slot 1
    const replacementQId = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b99';
    const replacementOptId = '1a2b3c4d-0001-4000-8000-000000000099';

    // Step A: Soft-retire realQ1
    await supabase
      .from('survey_questions')
      .update({ is_active: false })
      .eq('id', realQ1);

    // Step B: Insert active replacement question in slot 1
    await supabase
      .from('survey_questions')
      .insert({
        id: replacementQId,
        category_id: 'salon',
        question_text: 'How was your styling and treatment today?',
        display_order: 1,
        is_active: true,
      });

    // Step C: Insert active option for replacement question
    await supabase
      .from('survey_options')
      .insert({
        id: replacementOptId,
        question_id: replacementQId,
        option_text: 'Top Tier Service',
        sentiment_label: 'positive',
        is_neutral_na: false,
        is_active: true,
        display_order: 1,
      });

    try {
      // 5. Verify the previously issued token remains 100% valid with its reconstructed version!
      // (Even though realQ1 is now soft-retired and Q1_v2 is active!)
      const verificationAfter = verifySubmissionToken(
        body.submissionToken,
        persistedRow.business_id,
        persistedRow.session_uuid,
        reconstructedVersion,
        TEST_SIGNING_SECRET,
      );
      expect(verificationAfter.valid).toBe(true);

      // 6. Verify that a new submission attempting to use the now-retired realQ1 is rejected (HTTP 400 ERR_INVALID_PAYLOAD)
      const newSessionUuid = crypto.randomUUID();
      createdSessionUuids.push(newSessionUuid);

      const newSubmissionRes = await handleFeedbackSubmission(
        makeRequest({
          publicQrId: realSalonQrId,
          sessionUuid: newSessionUuid,
          responses: [
            { questionId: realQ1, optionId: realOpt1 }, // Attempting to answer retired realQ1!
            { questionId: realQ2, optionId: realOpt2 },
            { questionId: realQ3, optionId: realOpt3 },
          ],
        }),
        supabase,
        TEST_SIGNING_SECRET,
      );

      expect(newSubmissionRes.status).toBe(400);
      const newErr = await newSubmissionRes.json();
      expect(newErr.error.code).toBe('ERR_INVALID_PAYLOAD');

      // 7. Verify that a new submission using the new replacement question succeeds with the new survey version!
      const validNewSubmissionRes = await handleFeedbackSubmission(
        makeRequest({
          publicQrId: realSalonQrId,
          sessionUuid: newSessionUuid,
          responses: [
            { questionId: replacementQId, optionId: replacementOptId }, // New Q1_v2!
            { questionId: realQ2, optionId: realOpt2 },
            { questionId: realQ3, optionId: realOpt3 },
          ],
          optionalNote: 'New survey version submission',
        }),
        supabase,
        TEST_SIGNING_SECRET,
      );

      expect(validNewSubmissionRes.status).toBe(201);
      const validNewBody = await validNewSubmissionRes.json();
      expect(validNewBody.status).toBe('recorded');

      // The new submission token is bound to the new survey version
      const newExpectedVersion = computeSurveyVersion([
        replacementQId,
        realQ2,
        realQ3,
      ]);
      expect(newExpectedVersion).not.toBe(reconstructedVersion); // Different versions!

      const newVerification = verifySubmissionToken(
        validNewBody.submissionToken,
        persistedRow.business_id,
        newSessionUuid,
        newExpectedVersion,
        TEST_SIGNING_SECRET,
      );
      expect(newVerification.valid).toBe(true);
    } finally {
      // Clean up replacement question and option, and restore original Q1
      await supabase.from('survey_options').delete().eq('id', replacementOptId);
      await supabase.from('survey_questions').delete().eq('id', replacementQId);
      await supabase
        .from('survey_questions')
        .update({ is_active: true })
        .eq('id', realQ1);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Business Status Guards against Live PostgreSQL                         */
  /* ------------------------------------------------------------------------ */

  it('rejects submission for suspended merchant with HTTP 403 ERR_BUSINESS_SUSPENDED', async () => {
    const sessionUuid = crypto.randomUUID();
    const payload = {
      publicQrId: realSuspendedQrId,
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
    };

    const res = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_BUSINESS_SUSPENDED');
  });

  it('rejects non-existent publicQrId with HTTP 404 ERR_QR_NOT_FOUND', async () => {
    const sessionUuid = crypto.randomUUID();
    const payload = {
      publicQrId: 'notexist01',
      sessionUuid,
      responses: [
        { questionId: realQ1, optionId: realOpt1 },
        { questionId: realQ2, optionId: realOpt2 },
        { questionId: realQ3, optionId: realOpt3 },
      ],
    };

    const res = await handleFeedbackSubmission(
      makeRequest(payload),
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_QR_NOT_FOUND');
  });
});
