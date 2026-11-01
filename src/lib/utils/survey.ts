import type { SurveyQuestionDto } from '../api/survey';

/**
 * Validates questionnaire integrity according to M3-T02 / M3-T06 invariants:
 * - Exactly 3 questions
 * - Distinct question IDs
 * - Non-empty question text
 * - Each question has at least 2 active options
 * - Exactly one neutral N/A option per question
 * - Distinct option IDs across all questions
 */
export function validateQuestionnaire(questions: SurveyQuestionDto[]): boolean {
  if (!Array.isArray(questions) || questions.length !== 3) {
    return false;
  }

  const questionIds = new Set<string>();
  const optionIds = new Set<string>();

  for (const q of questions) {
    if (!q.id || typeof q.id !== 'string' || questionIds.has(q.id)) {
      return false;
    }
    questionIds.add(q.id);

    if (!q.questionText || typeof q.questionText !== 'string' || !q.questionText.trim()) {
      return false;
    }

    if (!Array.isArray(q.options) || q.options.length < 2) {
      return false;
    }

    const naOptions = q.options.filter((opt) => opt.isNeutralNa === true);
    if (naOptions.length !== 1) {
      return false;
    }

    for (const opt of q.options) {
      if (!opt.id || typeof opt.id !== 'string' || optionIds.has(opt.id)) {
        return false;
      }
      optionIds.add(opt.id);
    }
  }

  return true;
}

/**
 * Safely caps customer note text to at most `maxUnits` UTF-16 code units (default 150)
 * without ever splitting a UTF-16 surrogate pair (which would produce an invalid/unpaired surrogate
 * that crashes JSON/PostgreSQL serialization) or leaving a dangling Zero-Width Joiner (ZWJ).
 *
 * Boundary handling:
 * - If truncating at maxUnits splits an emoji surrogate pair (e.g. 149 ASCII + 2-unit emoji),
 *   the orphaned high surrogate is safely dropped, yielding 149 valid units.
 * - If truncating leaves a trailing Zero-Width Joiner (\u200D), it is dropped cleanly.
 * - Always preserves valid Unicode and never exceeds maxUnits.
 */
export function truncateCustomerNote(text?: string | null, maxUnits = 150): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sliced = text.length <= maxUnits ? text : text.slice(0, maxUnits);

  // If the last UTF-16 code unit is a high surrogate (0xD800 - 0xDBFF),
  // truncation split a surrogate pair. Drop the orphaned high surrogate.
  if (sliced.length > 0) {
    const lastCode = sliced.charCodeAt(sliced.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      sliced = sliced.slice(0, -1);
    }
  }

  // If truncation left a trailing Zero-Width Joiner (\u200D), strip it
  if (sliced.endsWith('\u200D')) {
    sliced = sliced.slice(0, -1);
    // Re-check in case stripping ZWJ exposed a high surrogate
    if (sliced.length > 0) {
      const lastCode = sliced.charCodeAt(sliced.length - 1);
      if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
        sliced = sliced.slice(0, -1);
      }
    }
  }

  return sliced;
}


