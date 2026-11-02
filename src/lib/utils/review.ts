/**
 * Review Draft Utility Functions (M4-T06 / SCR-CUST-07)
 *
 * Specifications:
 *   - docs/UI_UX.md (v1.1) §7.7 (SCR-CUST-07)
 *   - docs/PRD.md (v1.1) FR-CUST-005, FR-CUST-006, FR-AI-003
 *   - docs/TEST_PLAN.md (v1.1) TC-CUST-12, TC-CUST-13, TC-AI-08
 *
 * Provides resilient word counting, length guidance, and advisory status
 * for patron-edited customer review suggestions.
 */

/**
 * Recommended upper bound for generated and edited reviews.
 * Target is strictly fewer than 50 words (< 50 words ceiling: 49 words).
 */
export const RECOMMENDED_MAX_WORD_COUNT = 49;

/**
 * Calculates the exact word count of a string by splitting across whitespace tokens.
 *
 * Edge cases handled:
 * - null, undefined, non-string, or empty string returns 0.
 * - Leading, trailing, and multiple consecutive whitespace characters (spaces, tabs, newlines, CRLF).
 * - Unicode characters, emojis, and multiline drafts without corrupting tokens.
 * - Does NOT silently truncate text.
 */
export function countWords(text?: string | null): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export interface WordCountGuidance {
  /** Current count of words in the text */
  count: number;
  /** Whether the word count is within the recommended concise bound (<= 49 words) */
  isWithinRecommended: boolean;
  /** Short badge label for visual UI */
  label: string;
  /** Gentle advisory message when text exceeds recommended concise length */
  advisoryText?: string;
}

/**
 * Computes advisory guidance for the customer-facing word counter.
 * The guidance is strictly informational: customers retain full editorial freedom
 * and are never prevented or truncated from writing longer reviews.
 */
export function getWordCountGuidance(text?: string | null): WordCountGuidance {
  const count = countWords(text);
  const isWithinRecommended = count <= RECOMMENDED_MAX_WORD_COUNT;

  if (count === 0) {
    return {
      count: 0,
      isWithinRecommended: true,
      label: '0 words',
    };
  }

  if (isWithinRecommended) {
    return {
      count,
      isWithinRecommended: true,
      label: `${count} words (recommended: < 50 words)`,
    };
  }

  return {
    count,
    isWithinRecommended: false,
    label: `${count} words`,
    advisoryText:
      'Concise reviews under 50 words are easiest for customers to read quickly on Google Maps.',
  };
}

