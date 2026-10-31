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
});
