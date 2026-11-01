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

