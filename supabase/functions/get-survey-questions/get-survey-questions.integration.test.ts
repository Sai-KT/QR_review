import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  handleGetSurveyQuestions,
  SUCCESS_CACHE_CONTROL,
  type SurveyQuestionsSuccessResponse,
} from './index';
import { handleFeedbackSubmission } from '../submit-feedback/index';
import { computeSurveyVersion, verifySubmissionToken } from '../_shared/crypto';

// ============================================================================
// Live Integration Setup
// ============================================================================

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL_PUBLISHABLE_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const TEST_SIGNING_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('M3-T02: Live PostgreSQL Integration & Cross-Task Suite', () => {
  let supabase: SupabaseClient;
  let anonClient: SupabaseClient;

  beforeAll(() => {
    process.env['SUPABASE_URL'] = LOCAL_SUPABASE_URL;
    process.env['SUBMISSION_SIGNING_SECRET'] = TEST_SIGNING_SECRET;

    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    anonClient = createClient(LOCAL_SUPABASE_URL, LOCAL_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Live Reference Data Integrity (Work Package B & C)                    */
  /* ------------------------------------------------------------------------ */

  it('INT-01: verifies seeded salon reference data contains 3 active questions with 4 options each', async () => {
    const { data: questions, error } = await supabase
      .from('survey_questions')
      .select(`
        id,
        category_id,
        question_text,
        display_order,
        is_active,
        survey_options (
          id,
          option_text,
          emoji_anchor,
          sentiment_label,
          is_neutral_na,
          display_order,
          is_active
        )
      `)
      .eq('category_id', 'salon')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    expect(error).toBeNull();
    expect(questions).toHaveLength(3);

    for (let i = 0; i < questions!.length; i++) {
      const q = questions![i]!;
      expect(q.display_order).toBe(i + 1);
      expect(q.category_id).toBe('salon');
      expect(q.survey_options).toHaveLength(4);

      // Verify exactly 1 N/A option per question
      const naOpts = q.survey_options.filter((o) => o.is_neutral_na);
      expect(naOpts).toHaveLength(1);
      expect(naOpts[0]!.sentiment_label).toBe('neutral');
    }
  });

  it('INT-02: verifies seeded cafe reference data contains 3 active questions with 4 options each', async () => {
    const { data: questions, error } = await supabase
      .from('survey_questions')
      .select(`
        id,
        category_id,
        display_order,
        is_active,
        survey_options (
          id,
          is_neutral_na,
          sentiment_label
        )
      `)
      .eq('category_id', 'cafe')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    expect(error).toBeNull();
    expect(questions).toHaveLength(3);

    for (let i = 0; i < questions!.length; i++) {
      const q = questions![i]!;
      expect(q.display_order).toBe(i + 1);
      expect(q.survey_options).toHaveLength(4);
      const naOpts = q.survey_options.filter((o) => o.is_neutral_na);
      expect(naOpts).toHaveLength(1);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Full Live Pipeline Execution via handleGetSurveyQuestions             */
  /* ------------------------------------------------------------------------ */

  it('INT-03: executes full handleGetSurveyQuestions for salon against live database', async () => {
    const req = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon`,
      {
        method: 'GET',
        headers: {
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
      },
    );

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(SUCCESS_CACHE_CONTROL);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const body = (await res.json()) as SurveyQuestionsSuccessResponse;
    expect(body.categoryId).toBe('salon');
    expect(body.questions).toHaveLength(3);

    expect(body.questions[0]!.displayOrder).toBe(1);
    expect(body.questions[1]!.displayOrder).toBe(2);
    expect(body.questions[2]!.displayOrder).toBe(3);

    // Verify option sorting and neutral N/A presence
    for (const q of body.questions) {
      expect(q.options).toHaveLength(4);
      const na = q.options.find((o) => o.isNeutralNa);
      expect(na).toBeDefined();
      expect(na?.sentiment).toBe('neutral');
    }
  });

  it('INT-04: executes full handleGetSurveyQuestions for cafe against live database', async () => {
    const req = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe`,
      {
        method: 'GET',
        headers: {
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
      },
    );

    const res = await handleGetSurveyQuestions(req, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as SurveyQuestionsSuccessResponse;
    expect(body.categoryId).toBe('cafe');
    expect(body.questions).toHaveLength(3);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. PostgreSQL Security & RLS Permission Boundaries                      */
  /* ------------------------------------------------------------------------ */

  it('INT-05: verifies anonymous client has read-only access and cannot mutate survey_questions', async () => {
    // 1. SELECT should succeed through RLS
    const { data: readData, error: readErr } = await anonClient
      .from('survey_questions')
      .select('id, question_text')
      .eq('category_id', 'salon')
      .limit(1);

    expect(readErr).toBeNull();
    expect(readData).toHaveLength(1);

    // 2. INSERT should be rejected with permission denied (SQLSTATE 42501)
    const { error: insertErr } = await anonClient
      .from('survey_questions')
      .insert({
        category_id: 'salon',
        question_text: 'Unauthorized question insertion attempt',
        display_order: 1,
      });

    expect(insertErr).not.toBeNull();
    expect(insertErr?.message).toContain('permission denied');

    // 3. DELETE should be rejected
    const { error: deleteErr } = await anonClient
      .from('survey_questions')
      .delete()
      .eq('id', readData![0]!.id);

    expect(deleteErr).not.toBeNull();
    expect(deleteErr?.message).toContain('permission denied');
  });

  it('INT-06: verifies anonymous client cannot mutate survey_options', async () => {
    const { error: insertErr } = await anonClient
      .from('survey_options')
      .insert({
        question_id: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
        option_text: 'Unauthorized option insertion attempt',
      });

    expect(insertErr).not.toBeNull();
    expect(insertErr?.message).toContain('permission denied');
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Cross-Task Compatibility with M3-T03 (Feedback Submission & Version) */
  /* ------------------------------------------------------------------------ */

  it('INT-07: verifies M3-T02 questions and options are accepted by M3-T03 submit-feedback', async () => {
    // 1. Fetch salon questions via M3-T02 handler
    const qReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );

    const qRes = await handleGetSurveyQuestions(qReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(qRes.status).toBe(200);
    const qBody = (await qRes.json()) as SurveyQuestionsSuccessResponse;

    // Pick option 1 for Q1, option 1 for Q2, option 1 for Q3
    const selectedOptions = qBody.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[0]!.id,
    }));

    expect(selectedOptions).toHaveLength(3);

    // 2. Submit survey feedback to M3-T03 for Luxe Studio Unisex Salon (luxe000001)
    const sessionUuid = crypto.randomUUID();
    const subReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          publicQrId: 'luxe000001',
          sessionUuid,
          responses: selectedOptions,
          optionalNote: 'Integration test survey submission note.',
        }),
      },
    );

    const subRes = await handleFeedbackSubmission(
      subReq,
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(subRes.status).toBe(201);
    const subBody = await subRes.json();
    expect(subBody.responseId).toBeDefined();
    expect(subBody.submissionToken).toBeDefined();

    // 3. Verify survey version consistency
    const questionIds = qBody.questions.map((q) => q.id);
    const expectedSurveyVersion = computeSurveyVersion(questionIds);

    // Verify token can be verified using the computed surveyVersion
    const tokenResult = verifySubmissionToken(
      subBody.submissionToken,
      'b0000000-0000-4000-8000-000000000001', // Luxe Studio business_id
      sessionUuid,
      expectedSurveyVersion,
      TEST_SIGNING_SECRET,
    );

    expect(tokenResult.valid).toBe(true);
    expect(tokenResult.responseId).toBe(subBody.responseId);
  });

  it('INT-08: verifies M3-T03 rejects cross-question option substitution', async () => {
    // Retrieve salon questions
    const qReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const qRes = await handleGetSurveyQuestions(qReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    const qBody = (await qRes.json()) as SurveyQuestionsSuccessResponse;

    // Substitute option from question 1 (option 2) into question 2
    const corruptedOptions = [
      { questionId: qBody.questions[0]!.id, optionId: qBody.questions[0]!.options[0]!.id },
      { questionId: qBody.questions[1]!.id, optionId: qBody.questions[0]!.options[1]!.id }, // Mismatched!
      { questionId: qBody.questions[2]!.id, optionId: qBody.questions[2]!.options[0]!.id },
    ];

    const subReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          publicQrId: 'luxe000001',
          sessionUuid: crypto.randomUUID(),
          responses: corruptedOptions,
        }),
      },
    );

    const subRes = await handleFeedbackSubmission(
      subReq,
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(subRes.status).toBe(400);
    const errBody = await subRes.json();
    expect(errBody.error.code).toBe('ERR_INVALID_PAYLOAD');
    expect(errBody.error.message).toContain('does not belong to question');
  });

  it('INT-09: verifies M3-T03 rejects wrong-category questions (cafe questions submitted for salon)', async () => {
    // Retrieve cafe questions
    const qReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const qRes = await handleGetSurveyQuestions(qReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    const qBody = (await qRes.json()) as SurveyQuestionsSuccessResponse;

    // Selected options belong to cafe category
    const cafeOptions = qBody.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[0]!.id,
    }));

    // Attempt to submit for salon business Luxe Studio (luxe000001)
    const subReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: LOCAL_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          publicQrId: 'luxe000001',
          sessionUuid: crypto.randomUUID(),
          responses: cafeOptions,
        }),
      },
    );

    const subRes = await handleFeedbackSubmission(
      subReq,
      supabase,
      TEST_SIGNING_SECRET,
    );

    expect(subRes.status).toBe(400);
    const errBody = await subRes.json();
    expect(errBody.error.code).toBe('ERR_INVALID_PAYLOAD');
    expect(errBody.error.message).toContain('is not an active question for category salon');
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Question Replacement & Stale-Cache Simulation (Section 2 & 3)        */
  /* ------------------------------------------------------------------------ */

  it('INT-10: executes question replacement lifecycle, verifies cache/version divergence and records stale submission failure', async () => {
    const CAFE_QR_ID = 'daily00001';
    const ORIGINAL_Q2_ID = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'; // Cafe Question 2
    const REPLACEMENT_Q2_ID = '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b88';
    const REPLACEMENT_OPT_PREFIX = '1a2b3c4d-8888-4000-8000';

    // Step 1: Retrieve Questionnaire A (Original active cafe survey)
    const qReqA = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const qResA = await handleGetSurveyQuestions(qReqA, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(qResA.status).toBe(200);
    const bodyA = (await qResA.json()) as SurveyQuestionsSuccessResponse;

    expect(bodyA.questions).toHaveLength(3);
    expect(bodyA.questions[1]!.id).toBe(ORIGINAL_Q2_ID);
    const surveyVersionA = bodyA.surveyVersion;
    expect(surveyVersionA).toBeDefined();

    // Step 2: Emulate cached copy of Questionnaire A
    // (A patron has loaded this questionnaire before question replacement occurred)
    const cachedSelectionsA = bodyA.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[0]!.id,
    }));

    try {
      // Step 3: Replace Question 2 with a new published question in PostgreSQL
      // 3a. Insert new replacement question with is_active = false initially to avoid partial index collision
      const { error: insQErr } = await supabase.from('survey_questions').insert({
        id: REPLACEMENT_Q2_ID,
        category_id: 'cafe',
        question_text: 'How was the food and beverage presentation and temperature?',
        display_order: 2,
        is_active: false,
      });
      expect(insQErr).toBeNull();

      // 3b. Insert 4 options for replacement question (including 1 neutral N/A option)
      const replacementOptions = [
        {
          id: `${REPLACEMENT_OPT_PREFIX}-000000000001`,
          question_id: REPLACEMENT_Q2_ID,
          option_text: 'Artfully presented & perfect temperature',
          emoji_anchor: '☕',
          sentiment_label: 'positive',
          is_neutral_na: false,
          is_active: true,
          display_order: 1,
        },
        {
          id: `${REPLACEMENT_OPT_PREFIX}-000000000002`,
          question_id: REPLACEMENT_Q2_ID,
          option_text: 'Standard presentation & good taste',
          emoji_anchor: '👍',
          sentiment_label: 'positive',
          is_neutral_na: false,
          is_active: true,
          display_order: 2,
        },
        {
          id: `${REPLACEMENT_OPT_PREFIX}-000000000003`,
          question_id: REPLACEMENT_Q2_ID,
          option_text: 'Lukewarm / sloppy presentation',
          emoji_anchor: '⏳',
          sentiment_label: 'negative',
          is_neutral_na: false,
          is_active: true,
          display_order: 3,
        },
        {
          id: `${REPLACEMENT_OPT_PREFIX}-000000000004`,
          question_id: REPLACEMENT_Q2_ID,
          option_text: 'Not applicable / Not sure',
          emoji_anchor: '🤷',
          sentiment_label: 'neutral',
          is_neutral_na: true,
          is_active: true,
          display_order: 4,
        },
      ];
      const { error: insOptErr } = await supabase.from('survey_options').insert(replacementOptions);
      expect(insOptErr).toBeNull();

      // 3c. Atomically soft-retire old Question 2 and activate replacement Question 2
      const { error: deactErr } = await supabase
        .from('survey_questions')
        .update({ is_active: false })
        .eq('id', ORIGINAL_Q2_ID);
      expect(deactErr).toBeNull();

      const { error: actErr } = await supabase
        .from('survey_questions')
        .update({ is_active: true })
        .eq('id', REPLACEMENT_Q2_ID);
      expect(actErr).toBeNull();

      // Step 4: Verify fresh M3-T02 retrieval returns Questionnaire B
      const qReqB = new Request(
        `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe`,
        {
          method: 'GET',
          headers: { apikey: LOCAL_PUBLISHABLE_KEY },
        },
      );
      const qResB = await handleGetSurveyQuestions(qReqB, {
        supabaseClient: supabase,
        expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      });
      expect(qResB.status).toBe(200);
      const bodyB = (await qResB.json()) as SurveyQuestionsSuccessResponse;

      expect(bodyB.questions).toHaveLength(3);
      expect(bodyB.questions[1]!.id).toBe(REPLACEMENT_Q2_ID);
      expect(bodyB.questions[1]!.questionText).toBe(
        'How was the food and beverage presentation and temperature?',
      );
      const surveyVersionB = bodyB.surveyVersion;

      // Survey version must diverge from Questionnaire A
      expect(surveyVersionB).not.toBe(surveyVersionA);

      // Step 5: Verify the cached copy's behavior:
      // The cached copy held by client A contains question ORIGINAL_Q2_ID, which is now is_active = FALSE.

      // Step 6 & 7: Submit the previously cached Questionnaire A selections through M3-T03
      const subReqA = new Request(
        `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: LOCAL_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            publicQrId: CAFE_QR_ID,
            sessionUuid: crypto.randomUUID(),
            responses: cachedSelectionsA,
            optionalNote: 'Submitting stale cached survey.',
          }),
        },
      );

      const subResA = await handleFeedbackSubmission(subReqA, supabase, TEST_SIGNING_SECRET);

      // RECORDED FAILURE EVIDENCE:
      // M3-T03 server-side validation strictly rejects the submission because Question 2 is no longer active
      expect(subResA.status).toBe(400);
      const errBodyA = await subResA.json();
      expect(errBodyA.error.code).toBe('ERR_INVALID_PAYLOAD');
      expect(errBodyA.error.message).toContain(
        `Question ${ORIGINAL_Q2_ID} is not an active question for category cafe`,
      );

      // In contrast, submitting fresh Questionnaire B selections succeeds
      const freshSelectionsB = bodyB.questions.map((q) => ({
        questionId: q.id,
        optionId: q.options[0]!.id,
      }));
      const subReqB = new Request(
        `${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: LOCAL_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            publicQrId: CAFE_QR_ID,
            sessionUuid: crypto.randomUUID(),
            responses: freshSelectionsB,
            optionalNote: 'Submitting fresh survey questionnaire B.',
          }),
        },
      );
      const subResB = await handleFeedbackSubmission(subReqB, supabase, TEST_SIGNING_SECRET);
      expect(subResB.status).toBe(201);

      // Step 8: Verify what adding ?v= changes and what it does not change
      // Adding ?v=bypasses CDN cache key:
      const qReqWithV = new Request(
        `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe&v=2`,
        {
          method: 'GET',
          headers: { apikey: LOCAL_PUBLISHABLE_KEY },
        },
      );
      const qResWithV = await handleGetSurveyQuestions(qReqWithV, {
        supabaseClient: supabase,
        expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      });
      expect(qResWithV.status).toBe(200);
      const bodyWithV = (await qResWithV.json()) as SurveyQuestionsSuccessResponse;
      expect(bodyWithV.questions[1]!.id).toBe(REPLACEMENT_Q2_ID);

      // Adding ?v=old_version does NOT resurrect retired question A
      const qReqWithOldV = new Request(
        `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe&v=1`,
        {
          method: 'GET',
          headers: { apikey: LOCAL_PUBLISHABLE_KEY },
        },
      );
      const qResWithOldV = await handleGetSurveyQuestions(qReqWithOldV, {
        supabaseClient: supabase,
        expectedApiKey: LOCAL_PUBLISHABLE_KEY,
      });
      expect(qResWithOldV.status).toBe(200);
      const bodyWithOldV = (await qResWithOldV.json()) as SurveyQuestionsSuccessResponse;
      // It still returns active Questionnaire B, confirming ?v= cannot expose inactive questions
      expect(bodyWithOldV.questions[1]!.id).toBe(REPLACEMENT_Q2_ID);
    } finally {
      // Clean up & fully restore PostgreSQL reference data to original baseline
      await supabase
        .from('survey_questions')
        .update({ is_active: false })
        .eq('id', REPLACEMENT_Q2_ID);

      await supabase
        .from('survey_questions')
        .update({ is_active: true })
        .eq('id', ORIGINAL_Q2_ID);

      await supabase
        .from('survey_options')
        .delete()
        .eq('question_id', REPLACEMENT_Q2_ID);

      await supabase
        .from('survey_questions')
        .delete()
        .eq('id', REPLACEMENT_Q2_ID);
    }
  });

  it('INT-11: verifies version parameter ?v= validation and security boundaries', async () => {
    // 1. Valid alphanumeric version succeeds
    const validReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=cafe&v=v2_20261101`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const validRes = await handleGetSurveyQuestions(validReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(validRes.status).toBe(200);

    // 2. Malformed version containing spaces / special characters fails with HTTP 400 ERR_INVALID_VERSION
    const badReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon&v=invalid%20version!@#$`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const badRes = await handleGetSurveyQuestions(badReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(badRes.status).toBe(400);
    const badBody = await badRes.json();
    expect(badBody.error.code).toBe('ERR_INVALID_VERSION');

    // 3. Path traversal attack attempt fails with HTTP 400 ERR_INVALID_VERSION
    const traversalReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon&v=../../admin`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const traversalRes = await handleGetSurveyQuestions(traversalReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(traversalRes.status).toBe(400);

    // 4. Overly long string (>32 chars) fails with HTTP 400 ERR_INVALID_VERSION
    const longReq = new Request(
      `${LOCAL_SUPABASE_URL}/functions/v1/get-survey-questions?categoryId=salon&v=this_version_string_is_much_longer_than_thirty_two_characters`,
      {
        method: 'GET',
        headers: { apikey: LOCAL_PUBLISHABLE_KEY },
      },
    );
    const longRes = await handleGetSurveyQuestions(longReq, {
      supabaseClient: supabase,
      expectedApiKey: LOCAL_PUBLISHABLE_KEY,
    });
    expect(longRes.status).toBe(400);
  });
});
