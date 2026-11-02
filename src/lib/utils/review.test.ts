import { describe, it, expect } from 'vitest';
import {
  countWords,
  getWordCountGuidance,
  RECOMMENDED_MAX_WORD_COUNT,
} from './review';

describe('Review Utilities (M4-T06 / SCR-CUST-07)', () => {
  describe('countWords', () => {
    it('returns 0 for null, undefined, or empty string', () => {
      expect(countWords(null)).toBe(0);
      expect(countWords(undefined)).toBe(0);
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
      expect(countWords('\t\n\r\n')).toBe(0);
    });

    it('returns 0 for non-string inputs', () => {
      // @ts-expect-error test invalid runtime inputs
      expect(countWords(123)).toBe(0);
      // @ts-expect-error test invalid runtime inputs
      expect(countWords({})).toBe(0);
      // @ts-expect-error test invalid runtime inputs
      expect(countWords([])).toBe(0);
    });

    it('counts single words', () => {
      expect(countWords('Masterful')).toBe(1);
      expect(countWords('  Masterful  ')).toBe(1);
    });

    it('handles multiple consecutive spaces and whitespace varieties', () => {
      expect(countWords('Great   haircut    and   friendly    staff.')).toBe(5);
      expect(countWords('Great\thaircut\nand\r\nfriendly\n\nstaff.')).toBe(5);
    });

    it('correctly handles emojis and Unicode surrogate pairs', () => {
      expect(countWords('Loved the haircut 💇‍♂️ and coffee ☕️ today!')).toBe(8);
      expect(countWords('✨ Highly recommended salon! ✨')).toBe(5);
    });

    it('correctly counts 49 words (< 50 words ceiling)', () => {
      const words49 = Array.from({ length: 49 }, (_, i) => `word${i + 1}`).join(' ');
      expect(countWords(words49)).toBe(49);
      expect(countWords(words49)).toBeLessThanOrEqual(RECOMMENDED_MAX_WORD_COUNT);
    });

    it('correctly counts 50 words and beyond without truncation', () => {
      const words50 = Array.from({ length: 50 }, (_, i) => `word${i + 1}`).join(' ');
      expect(countWords(words50)).toBe(50);

      const words100 = Array.from({ length: 100 }, (_, i) => `word${i + 1}`).join(' ');
      expect(countWords(words100)).toBe(100);
    });

    it('handles multilingual text (Devanagari / Hindi)', () => {
      expect(countWords('बहुत बढ़िया सर्विस और दोस्ताना माहौल')).toBe(6);
    });
  });

  describe('getWordCountGuidance', () => {
    it('returns 0 words label when empty', () => {
      const guidance = getWordCountGuidance('');
      expect(guidance.count).toBe(0);
      expect(guidance.isWithinRecommended).toBe(true);
      expect(guidance.label).toBe('0 words');
      expect(guidance.advisoryText).toBeUndefined();
    });

    it('indicates within recommended bound when <= 49 words', () => {
      const draft = 'Had an amazing haircut today. Stylist paid great attention to detail.';
      const guidance = getWordCountGuidance(draft);
      expect(guidance.count).toBe(11);
      expect(guidance.isWithinRecommended).toBe(true);
      expect(guidance.label).toContain('11 words');
      expect(guidance.label).toContain('< 50 words');
      expect(guidance.advisoryText).toBeUndefined();
    });

    it('indicates advisory notice when >= 50 words without truncating', () => {
      const words55 = Array.from({ length: 55 }, (_, i) => `experience${i + 1}`).join(' ');
      const guidance = getWordCountGuidance(words55);
      expect(guidance.count).toBe(55);
      expect(guidance.isWithinRecommended).toBe(false);
      expect(guidance.label).toBe('55 words');
      expect(guidance.advisoryText).toContain('under 50 words');
    });
  });
});
