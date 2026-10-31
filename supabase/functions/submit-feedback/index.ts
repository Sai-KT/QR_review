/**
 * Edge Function: submit-feedback (API-PUB-04)
 *
 * Task: M3-T03 — Survey Feedback Submission & HMAC Token Issuer
 * Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M3-T03
 *   - docs/API_SPEC.md (v1.2) §7.3, §8.1, §8.2, §17, §18
 *   - docs/ARCHITECTURE.md (v1.1) §9.2
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.5 (survey_responses), §5.6 (analytics_events)
 *   - docs/SECURITY.md (v1.1) §7, Gate M0-11 (Cryptographic Submission Binding)
 *   - docs/TEST_PLAN.md (v1.1) TC-API-11, TC-API-12, TC-SEC-03
 *
 * Capabilities:
 *   - Public anonymous feedback submission gateway (verify_jwt = false)
 *   - Validates publicQrId, sessionUuid, exactly 3 category-matching MCQs, and optional note (<= 150 chars)
 *   - Rejects notes > 150 characters with HTTP 422 Unprocessable Content
 *   - Resolves trusted server-side business identity and vertical category
 *   - Rejects inactive or suspended businesses with HTTP 403 ERR_BUSINESS_SUSPENDED
 *   - Validates question and option relationships and rejects soft-retired options (M0-07 & M0-08)
 *   - Excludes neutral N/A options from affirmed_facts_snapshot
 *   - Derives deterministic sentiment and flags all-N/A responses for M0-16 abstention
 *   - Atomic persistence into public.survey_responses with session idempotency
 *   - Ingests server-owned EVENT_SURVEY_COMPLETED into public.analytics_events
 *   - Mints HMAC-SHA256 submissionToken bound to responseId, businessId, sessionUuid, and surveyVersion
 *   - Enforces 10-minute (600s) token lifetime without indefinite renewal on replay
 */

import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import {
  computeSurveyVersion,
  getSigningSecret,
  signSubmissionToken,
  SUBMISSION_TOKEN_TTL_SECONDS,
} from '../_shared/crypto.ts';

// ============================================================================
// CORS & Security Headers
// ============================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

// ============================================================================
// Canonical Error Handling
// ============================================================================

export interface CanonicalErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    retryable: boolean;
  };
}

export function buildErrorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  correlationId?: string,
): Response {
  const corrId =
    correlationId ??
    `corr_${createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)}`;

  const body: CanonicalErrorResponse = {
    error: {
      code,
      message,
      correlationId: corrId,
      retryable,
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// Zod Request Validation Schema
// ============================================================================

export const ResponseItemSchema = z.object({
  questionId: z.string().uuid({ message: 'questionId must be a valid UUID' }),
  optionId: z.string().uuid({ message: 'optionId must be a valid UUID' }),
});

export const SubmitFeedbackPayloadSchema = z.object({
  publicQrId: z
    .string({ required_error: 'publicQrId is required' })
    .trim()
    .regex(/^[a-z0-9]{10}$/, {
      message: 'publicQrId must be exactly 10 lowercase alphanumeric characters',
    }),
  sessionUuid: z
    .string({ required_error: 'sessionUuid is required' })
    .uuid({ message: 'sessionUuid must be a valid UUID' }),
  responses: z
    .array(ResponseItemSchema)
    .length(3, { message: 'responses must contain exactly three question answers' }),
  optionalNote: z.string().nullable().optional(),
});

export type SubmitFeedbackPayload = z.infer<typeof SubmitFeedbackPayloadSchema>;

// ============================================================================
// Sentiment Derivation Types & Utilities
// ============================================================================

export interface SentimentCalculationResult {
  averageScore: number | null;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  naCount: number;
  applicableCount: number;
}

export function calculateSentiment(
  options: Array<{ sentiment_label: string; is_neutral_na: boolean }>,
): SentimentCalculationResult {
  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;
  let naCount = 0;
  let scoreSum = 0;

  for (const opt of options) {
    if (opt.is_neutral_na) {
      naCount++;
    } else {
      if (opt.sentiment_label === 'positive') {
        positiveCount++;
        scoreSum += 1.0;
      } else if (opt.sentiment_label === 'negative') {
        negativeCount++;
        scoreSum -= 1.0;
      } else {
        neutralCount++;
        scoreSum += 0.0;
      }
    }
  }

  const applicableCount = positiveCount + neutralCount + negativeCount;
  const averageScore =
    applicableCount > 0
      ? Math.round((scoreSum / applicableCount) * 100) / 100
      : null;

  return {
    averageScore,
    positiveCount,
    neutralCount,
    negativeCount,
    naCount,
    applicableCount,
  };
}

// ============================================================================
// Core Database Interfaces
// ============================================================================

interface BusinessRecord {
  id: string;
  category_id: string;
  account_status: string;
  is_active: boolean;
}

interface QuestionRecord {
  id: string;
  display_order: number;
  category_id: string;
  is_active: boolean;
}

interface OptionRecord {
  id: string;
  question_id: string;
  option_text: string;
  sentiment_label: string;
  is_neutral_na: boolean;
  is_active: boolean;
  display_order: number;
}

interface ExistingSurveyResponse {
  id: string;
  selected_options: Array<{ questionId: string; optionId: string }>;
  optional_note: string | null;
  created_at: string;
}

// ============================================================================
// Handler Execution Pipeline
// ============================================================================

export async function handleFeedbackSubmission(
  req: Request,
  injectedClient?: SupabaseClient,
  customSecret?: string,
): Promise<Response> {
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. HTTP Method Guard
  if (req.method !== 'POST') {
    return buildErrorResponse(
      405,
      'ERR_METHOD_NOT_ALLOWED',
      `HTTP method ${req.method} is not supported. Use POST.`,
    );
  }

  // 3. Pre-Validate Cryptographic Configuration (Fail Closed Early)
  try {
    getSigningSecret(customSecret);
  } catch {
    return buildErrorResponse(
      500,
      'ERR_INTERNAL_ERROR',
      'Cryptographic service configuration is invalid or uninitialized.',
      false,
    );
  }

  // 4. Parse & Validate Request Body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return buildErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Malformed JSON request body.',
    );
  }

  const parseResult = SubmitFeedbackPayloadSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    const message = firstIssue?.message ?? 'Validation failed for request body';
    return buildErrorResponse(400, 'ERR_INVALID_PAYLOAD', message);
  }

  const { publicQrId, sessionUuid, responses } = parseResult.data;
  const rawOptionalNote = parseResult.data.optionalNote ?? null;

  // 5. Note Length Boundary Check (HTTP 422 on > 150 characters per ROADMAP M3-T03)
  // Preserves exact raw character count (supports multi-byte characters and emoji)
  let normalizedNote: string | null = null;
  if (rawOptionalNote !== null && rawOptionalNote !== undefined) {
    const trimmed = rawOptionalNote.trim();
    if (trimmed.length > 150) {
      return buildErrorResponse(
        422,
        'ERR_NOTE_TOO_LONG',
        `Optional note length (${trimmed.length} characters) exceeds maximum limit of 150 characters.`,
      );
    }
    normalizedNote = trimmed.length > 0 ? trimmed : null;
  }

  // 6. Ensure Unique Question Responses (No Duplicate Question Answers)
  const submittedQuestionIds = responses.map((r) => r.questionId);
  const uniqueQuestionCount = new Set(submittedQuestionIds).size;
  if (uniqueQuestionCount !== 3) {
    return buildErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'Responses must contain answers for three distinct questions without duplicates.',
    );
  }

  // 7. Instantiate Supabase Database Client
  let supabase: SupabaseClient;
  if (injectedClient) {
    supabase = injectedClient;
  } else {
    const supabaseUrl =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_URL')
        : process.env['SUPABASE_URL'];
    const serviceRoleKey =
      typeof Deno !== 'undefined'
        ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        : process.env['SUPABASE_SERVICE_ROLE_KEY'];

    if (!supabaseUrl || !serviceRoleKey) {
      return buildErrorResponse(
        500,
        'ERR_INTERNAL_ERROR',
        'Database connection environment is unconfigured.',
      );
    }

    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  // 8. Resolve Business Identity Server-Side
  const { data: businessData, error: bizError } = await supabase
    .from('businesses')
    .select('id, category_id, account_status, is_active')
    .eq('public_qr_id', publicQrId)
    .maybeSingle<BusinessRecord>();

  if (bizError) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to resolve business metadata.',
      true,
    );
  }

  if (!businessData) {
    return buildErrorResponse(
      404,
      'ERR_QR_NOT_FOUND',
      'The requested QR identifier does not exist or has been removed.',
    );
  }

  // 9. Merchant Eligibility Check
  if (
    !businessData.is_active ||
    businessData.account_status === 'suspended'
  ) {
    return buildErrorResponse(
      403,
      'ERR_BUSINESS_SUSPENDED',
      'Feedback collection for this business is currently unavailable.',
    );
  }

  const businessId = businessData.id;
  const categoryId = businessData.category_id;

  // 10. Survey Integrity: Validate Active Questions for this Category
  const { data: activeQuestions, error: qError } = await supabase
    .from('survey_questions')
    .select('id, display_order, category_id, is_active')
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (qError) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to retrieve category questionnaire.',
      true,
    );
  }

  if (!activeQuestions || activeQuestions.length !== 3) {
    return buildErrorResponse(
      500,
      'ERR_INCOMPLETE_SURVEY',
      'The active questionnaire for this category is incomplete or misconfigured.',
    );
  }

  const activeQuestionMap = new Map<string, QuestionRecord>();
  for (const q of activeQuestions as QuestionRecord[]) {
    activeQuestionMap.set(q.id, q);
  }

  // Verify each submitted question exists in the active question set
  for (const qId of submittedQuestionIds) {
    if (!activeQuestionMap.has(qId)) {
      return buildErrorResponse(
        400,
        'ERR_INVALID_PAYLOAD',
        `Question ${qId} is not an active question for category ${categoryId}.`,
      );
    }
  }

  // 11. Survey Integrity: Validate Options & Relations
  const submittedOptionIds = responses.map((r) => r.optionId);
  const { data: optionRecords, error: optError } = await supabase
    .from('survey_options')
    .select('id, question_id, option_text, sentiment_label, is_neutral_na, is_active, display_order')
    .in('id', submittedOptionIds);

  if (optError) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to validate survey option relationships.',
      true,
    );
  }

  if (!optionRecords || optionRecords.length !== 3) {
    return buildErrorResponse(
      400,
      'ERR_INVALID_PAYLOAD',
      'One or more submitted option identifiers are invalid or not found.',
    );
  }

  const optionMap = new Map<string, OptionRecord>();
  for (const opt of optionRecords as OptionRecord[]) {
    optionMap.set(opt.id, opt);
  }

  // Verify that each option matches the question and is currently active
  for (const resp of responses) {
    const opt = optionMap.get(resp.optionId);
    if (!opt) {
      return buildErrorResponse(
        400,
        'ERR_INVALID_PAYLOAD',
        `Option ${resp.optionId} was not found.`,
      );
    }

    if (opt.question_id !== resp.questionId) {
      return buildErrorResponse(
        400,
        'ERR_INVALID_PAYLOAD',
        `Option ${resp.optionId} does not belong to question ${resp.questionId}.`,
      );
    }

    if (!opt.is_active) {
      return buildErrorResponse(
        400,
        'ERR_INVALID_PAYLOAD',
        `Option ${resp.optionId} is retired and no longer active.`,
      );
    }
  }

  // 12. Derive Survey Version & Affirmed Facts Snapshot
  // Order-independent canonical survey version derived directly from the validated questions
  const surveyVersion = computeSurveyVersion(submittedQuestionIds);

  // Collect options in submitted order
  const resolvedOptions = responses.map((r) => optionMap.get(r.optionId)!);

  // Exclude neutral N/A choices from affirmed_facts_snapshot
  const affirmedFactsSnapshot = resolvedOptions
    .filter((opt) => !opt.is_neutral_na)
    .map((opt) => opt.option_text);

  // Derive sentiment score (validated internally; not stored in a new schema column)
  calculateSentiment(resolvedOptions);

  // 13. Atomic Persistence & Session Idempotency
  // Pre-check if response already exists for this (business_id, session_uuid)
  const { data: existingResponse, error: existingError } = await supabase
    .from('survey_responses')
    .select('id, selected_options, optional_note, created_at')
    .eq('business_id', businessId)
    .eq('session_uuid', sessionUuid)
    .maybeSingle<ExistingSurveyResponse>();

  if (existingError) {
    return buildErrorResponse(
      500,
      'ERR_DATABASE_ERROR',
      'Failed to check submission idempotency state.',
      true,
    );
  }

  let finalResponseId: string;
  let finalCreatedAtEpoch: number;

  if (existingResponse) {
    // A response already exists for this session! Check for conflicting payloads
    const existingOptions = existingResponse.selected_options;
    const existingNote = existingResponse.optional_note ?? null;

    // Normalize option comparison (order-independent set of questionId:optionId)
    const existingSet = new Set(
      Array.isArray(existingOptions)
        ? existingOptions.map((o: { questionId?: string; question_id?: string; optionId?: string; option_id?: string }) =>
            `${o.questionId ?? o.question_id}:${o.optionId ?? o.option_id}`)
        : [],
    );
    const submittedSet = new Set(
      responses.map((r) => `${r.questionId}:${r.optionId}`),
    );

    let setsMatch = existingSet.size === submittedSet.size;
    if (setsMatch) {
      for (const pair of submittedSet) {
        if (!existingSet.has(pair)) {
          setsMatch = false;
          break;
        }
      }
    }

    const notesMatch = existingNote === normalizedNote;

    if (!setsMatch || !notesMatch) {
      return buildErrorResponse(
        409,
        'ERR_IDEMPOTENCY_CONFLICT',
        'A survey submission already exists for this session with different responses or note.',
      );
    }

    // Valid retry: check if the original 10-minute token window has elapsed
    const originalCreatedAtTime = new Date(existingResponse.created_at).getTime();
    finalCreatedAtEpoch = Math.floor(originalCreatedAtTime / 1000);
    const originalExpiryEpoch = finalCreatedAtEpoch + SUBMISSION_TOKEN_TTL_SECONDS;
    const nowEpoch = Math.floor(Date.now() / 1000);

    if (nowEpoch >= originalExpiryEpoch) {
      return buildErrorResponse(
        410,
        'ERR_SUBMISSION_EXPIRED',
        'The survey submission session has expired and cannot be renewed.',
      );
    }

    finalResponseId = existingResponse.id;
  } else {
    // New submission: perform database insert
    const insertPayload = {
      business_id: businessId,
      category_id: categoryId,
      selected_options: responses,
      affirmed_facts_snapshot: affirmedFactsSnapshot,
      optional_note: normalizedNote,
      session_uuid: sessionUuid,
    };

    const { data: insertedData, error: insertError } = await supabase
      .from('survey_responses')
      .insert(insertPayload)
      .select('id, created_at')
      .single<{ id: string; created_at: string }>();

    if (insertError) {
      // Handle PostgreSQL 23505 Unique Constraint Violation (concurrent insertion race)
      if (insertError.code === '23505') {
        const { data: raceRow, error: raceError } = await supabase
          .from('survey_responses')
          .select('id, selected_options, optional_note, created_at')
          .eq('business_id', businessId)
          .eq('session_uuid', sessionUuid)
          .single<ExistingSurveyResponse>();

        if (raceError || !raceRow) {
          return buildErrorResponse(
            500,
            'ERR_DATABASE_ERROR',
            'Failed to resolve concurrent submission race.',
            true,
          );
        }

        finalResponseId = raceRow.id;
        finalCreatedAtEpoch = Math.floor(
          new Date(raceRow.created_at).getTime() / 1000,
        );
      } else {
        return buildErrorResponse(
          500,
          'ERR_DATABASE_ERROR',
          'Failed to record survey feedback.',
          true,
        );
      }
    } else {
      finalResponseId = insertedData.id;
      finalCreatedAtEpoch = Math.floor(
        new Date(insertedData.created_at).getTime() / 1000,
      );

      // 14. Server-Owned Analytics Telemetry: Ingest EVENT_SURVEY_COMPLETED
      const dedupKey = createHash('sha256')
        .update(
          `${businessId}:EVENT_SURVEY_COMPLETED:${sessionUuid}:${Math.floor(Date.now() / 3600000)}`,
        )
        .digest('hex');

      await supabase
        .from('analytics_events')
        .insert({
          business_id: businessId,
          event_name: 'EVENT_SURVEY_COMPLETED',
          session_uuid: sessionUuid,
          user_agent_category: 'mobile',
          deduplication_key: dedupKey,
        })
        .select('id')
        .maybeSingle(); // Silently handle deduplication conflict without breaking survey response
    }
  }

  // 15. Mint Signed HMAC Submission Token Bound to Persisted Record
  const submissionToken = signSubmissionToken({
    responseId: finalResponseId,
    businessId,
    sessionUuid,
    surveyVersion,
    exp: finalCreatedAtEpoch + SUBMISSION_TOKEN_TTL_SECONDS,
    secret: customSecret,
  });

  // 16. Return Success Response (HTTP 201 Created)
  const successBody = {
    status: 'recorded',
    responseId: finalResponseId,
    submissionToken,
  };

  return new Response(JSON.stringify(successBody), {
    status: 201,
    headers: {
      ...CORS_HEADERS,
      ...NO_CACHE_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

// ============================================================================
// Deno Edge Runtime Entrypoint
// ============================================================================

if (typeof Deno !== 'undefined' && 'serve' in Deno) {
  // @ts-expect-error Deno serve global in Edge Runtime
  Deno.serve(async (req: Request) => {
    return handleFeedbackSubmission(req);
  });
}

