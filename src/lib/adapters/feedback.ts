/**
 * Customer Feedback & Survey Question DTO Adapters
 *
 * Source: docs/API_SPEC.md (v1.2) §7, §8, §11.5, §16.1; docs/DATABASE_SCHEMA.md (v1.1) §5.3, §5.4, §5.5, §9.1
 *
 * Maps between PostgreSQL survey tables and frontend domain models.
 * Enforces privacy boundaries:
 * - Scrubbed notes (purged_at set) are redacted to null
 * - Optional notes are length-capped to 150 characters (Founder Decision M0-01)
 * - Raw review drafts are never stored in or mapped from the database
 */

import type {
  SurveyQuestionRow,
  SurveyOptionRow,
  SurveyResponseRow,
  Json,
} from '../../types/database';
import type {
  SurveyQuestion,
  SurveyOption,
  CustomerFeedback,
  CustomerFeedbackSubmission,
  BusinessCategoryType,
  SelectedSurveyOption,
  AffirmedFact,
  FeedbackNoteStatus,
} from '../../types/domain';

export type { FeedbackNoteStatus };

/**
 * Maps a raw survey_options row to the frontend SurveyOption domain model.
 */
export function toSurveyOptionDto(row: SurveyOptionRow): SurveyOption {
  return {
    id: row.id,
    questionId: row.question_id,
    optionText: row.option_text,
    emojiAnchor: row.emoji_anchor,
    sentimentLabel: row.sentiment_label,
    isNeutralNa: row.is_neutral_na,
    isActive: row.is_active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
  };
}

/**
 * Maps a raw survey_questions row and its optional child options to SurveyQuestion.
 */
export function toSurveyQuestionDto(
  row: SurveyQuestionRow,
  options?: SurveyOptionRow[],
): SurveyQuestion {
  return {
    id: row.id,
    categoryId: row.category_id as BusinessCategoryType,
    questionText: row.question_text,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    options: options ? options.map(toSurveyOptionDto) : undefined,
  };
}

/**
 * Safely parses and narrows selected options JSON from survey_responses row.
 * Handles both camelCase and database snake_case structures without unsafe casting.
 */
function parseSelectedOptions(json: Json): SelectedSurveyOption[] {
  let raw: unknown = json;
  if (typeof json === 'string') {
    try {
      raw = JSON.parse(json);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const result: SelectedSurveyOption[] = [];
  for (const item of raw) {
    if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>;
      const qId = rec.questionId ?? rec.question_id;
      const oId = rec.optionId ?? rec.option_id;

      if (typeof qId === 'string' && typeof oId === 'string') {
        result.push({
          questionId: qId,
          optionId: oId,
        });
      }
    }
  }

  return result;
}

/**
 * Safely parses and narrows affirmed facts snapshot JSON from survey_responses row.
 */
function parseAffirmedFacts(json: Json): AffirmedFact[] {
  let raw: unknown = json;
  if (typeof json === 'string') {
    try {
      raw = JSON.parse(json);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const result: AffirmedFact[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed !== '') {
        result.push({
          questionId: '',
          optionText: trimmed,
          sentimentLabel: 'positive',
        });
      }
    } else if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>;
      const qId = String(rec.questionId ?? rec.question_id ?? '');
      const text = rec.optionText ?? rec.option_text;
      const sentiment = (rec.sentimentLabel ??
        rec.sentiment_label ??
        'positive') as AffirmedFact['sentimentLabel'];

      if (typeof text === 'string' && text.trim() !== '') {
        result.push({
          questionId: qId,
          optionText: text.trim(),
          sentimentLabel: sentiment,
        });
      }
    }
  }

  return result;
}

/**
 * Maps a raw PostgreSQL survey_responses row to CustomerFeedback DTO.
 *
 * PRIVACY SAFEGUARDS (Founder Decision M0-01 / DPDPA 2023):
 * 1. Case A (Retained Note): If row is <= 30 days old and optional_note is present,
 *    noteStatus is 'RETAINED' and optionalNote is preserved.
 * 2. Case B (Physically Purged Note): If purged_at is populated, noteStatus is 'PURGED',
 *    optionalNote is strictly set to null, and authoritative purgedAt is preserved.
 * 3. Case C (No Note Submitted): If optional_note is null/empty and purged_at is null,
 *    noteStatus is 'NONE'. Never invents a purge event merely because the response is old.
 * 4. Case D (Expired Note Awaiting Cleanup): If row contains optional_note but is > 30 days old,
 *    noteStatus is 'EXPIRED', optionalNote is immediately redacted to null (never kept in client memory),
 *    and purgedAt remains null (preserving authoritative database truth).
 * 5. Never returns or reconstructs final customer reviews or raw drafts.
 */
export function toFeedbackDto(row: SurveyResponseRow): CustomerFeedback {
  const hasPurgedAt = Boolean(row.purged_at);
  const rawNote = typeof row.optional_note === 'string' ? row.optional_note.trim() : null;
  const hasRawNote = Boolean(rawNote && rawNote.length > 0);

  // Time-controlled boundary calculation (30 days = 30 * 24 * 60 * 60 * 1000 ms)
  const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
  const isPastRetentionWindow = !isNaN(createdMs)
    ? Date.now() - createdMs > 30 * 24 * 60 * 60 * 1000
    : false;

  let noteStatus: FeedbackNoteStatus;
  let optionalNote: string | null;

  if (hasPurgedAt) {
    // Case B: Physically purged note (authoritative DB purge timestamp present)
    // Conservatively suppress any inconsistent legacy raw note text
    noteStatus = 'PURGED';
    optionalNote = null;
  } else if (!hasRawNote) {
    // Case C: No note submitted (optional_note is null/empty and purged_at is null)
    // Never invent a purge event merely because the response is old
    noteStatus = 'NONE';
    optionalNote = null;
  } else if (isPastRetentionWindow) {
    // Case D: Expired note awaiting database cleanup
    // Note existed, but retention ceiling (> 30 days) passed. Immediately redact from client state.
    noteStatus = 'EXPIRED';
    optionalNote = null;
  } else {
    // Case A: Retained note
    // Note exists and retention deadline has not passed.
    noteStatus = 'RETAINED';
    optionalNote = row.optional_note;
  }

  return {
    id: row.id,
    businessId: row.business_id,
    categoryId: row.category_id as BusinessCategoryType,
    selectedOptions: parseSelectedOptions(row.selected_options),
    affirmedFactsSnapshot: parseAffirmedFacts(row.affirmed_facts_snapshot),
    optionalNote,
    sessionUuid: row.session_uuid,
    purgedAt: row.purged_at ?? null, // Authoritative DB timestamp; NEVER synthetic!
    noteStatus,
    createdAt: row.created_at,
    authenticityConfirmed: Boolean(row.authenticity_confirmed),
  };
}

/**
 * Backward-compatible alias for toFeedbackDto.
 */
export const toCustomerFeedbackDto = toFeedbackDto;

/**
 * Converts a frontend CustomerFeedbackSubmission into the API-PUB-04 wire payload.
 * Truncates optionalNote to the mandatory 150-character ceiling if exceeded.
 */
export function toFeedbackSubmissionPayload(submission: CustomerFeedbackSubmission): {
  business_id: string;
  category_id: string;
  session_uuid: string;
  selected_options: Json;
  optional_note: string | null;
  authenticity_confirmed: boolean;
} {
  const sanitizedNote = submission.optionalNote
    ? submission.optionalNote.trim().slice(0, 150)
    : null;

  return {
    business_id: submission.businessId,
    category_id: submission.categoryId,
    session_uuid: submission.sessionUuid,
    selected_options: submission.responses as unknown as Json,
    optional_note: sanitizedNote,
    authenticity_confirmed: Boolean(submission.authenticityConfirmed),
  };
}

export type {
  SurveyQuestion,
  SurveyOption,
  CustomerFeedback,
  CustomerFeedbackSubmission,
  SelectedSurveyOption,
  AffirmedFact,
};

