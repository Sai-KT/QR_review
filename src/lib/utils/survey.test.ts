import { describe, it, expect } from 'vitest';
import { validateQuestionnaire, truncateCustomerNote } from './survey';
import type { SurveyQuestionDto } from '../api/survey';

describe('Survey Integrity Validator (validateQuestionnaire)', () => {
  const validQuestions: SurveyQuestionDto[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      displayOrder: 1,
      questionText: 'Question 1',
      options: [
        { id: 'opt-1-a', optionText: 'A', emojiAnchor: '👍', sentiment: 'positive', isNeutralNa: false },
        { id: 'opt-1-na', optionText: 'N/A', emojiAnchor: '⚪', sentiment: 'neutral', isNeutralNa: true },
      ],
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      displayOrder: 2,
      questionText: 'Question 2',
      options: [
        { id: 'opt-2-a', optionText: 'B', emojiAnchor: '👍', sentiment: 'positive', isNeutralNa: false },
        { id: 'opt-2-na', optionText: 'N/A', emojiAnchor: '⚪', sentiment: 'neutral', isNeutralNa: true },
      ],
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      displayOrder: 3,
      questionText: 'Question 3',
      options: [
        { id: 'opt-3-a', optionText: 'C', emojiAnchor: '👍', sentiment: 'positive', isNeutralNa: false },
        { id: 'opt-3-na', optionText: 'N/A', emojiAnchor: '⚪', sentiment: 'neutral', isNeutralNa: true },
      ],
    },
  ];

  it('accepts valid 3-question survey with exactly 1 N/A option per question', () => {
    expect(validateQuestionnaire(validQuestions)).toBe(true);
  });

  it('rejects questionnaires with fewer than 3 questions', () => {
    expect(validateQuestionnaire(validQuestions.slice(0, 2))).toBe(false);
  });

  it('rejects questionnaires with more than 3 questions', () => {
    const extra = [...validQuestions, { ...validQuestions[0]!, id: '44444444-4444-4444-8444-444444444444' }];
    expect(validateQuestionnaire(extra)).toBe(false);
  });

  it('rejects duplicate question IDs', () => {
    const dupe = [
      validQuestions[0]!,
      validQuestions[1]!,
      { ...validQuestions[2]!, id: validQuestions[0]!.id },
    ];
    expect(validateQuestionnaire(dupe)).toBe(false);
  });

  it('rejects questions with empty text', () => {
    const emptyText = [
      { ...validQuestions[0]!, questionText: '   ' },
      validQuestions[1]!,
      validQuestions[2]!,
    ];
    expect(validateQuestionnaire(emptyText)).toBe(false);
  });

  it('rejects questions without exactly one N/A option', () => {
    // Missing N/A
    const noNa = [
      {
        ...validQuestions[0]!,
        options: [
          { id: 'opt-1-a', optionText: 'A', emojiAnchor: '👍', sentiment: 'positive' as const, isNeutralNa: false },
          { id: 'opt-1-b', optionText: 'B', emojiAnchor: '👍', sentiment: 'positive' as const, isNeutralNa: false },
        ],
      },
      validQuestions[1]!,
      validQuestions[2]!,
    ];
    expect(validateQuestionnaire(noNa)).toBe(false);

    // Two N/A options
    const twoNa = [
      {
        ...validQuestions[0]!,
        options: [
          { id: 'opt-1-na1', optionText: 'N/A 1', emojiAnchor: '⚪', sentiment: 'neutral' as const, isNeutralNa: true },
          { id: 'opt-1-na2', optionText: 'N/A 2', emojiAnchor: '⚪', sentiment: 'neutral' as const, isNeutralNa: true },
        ],
      },
      validQuestions[1]!,
      validQuestions[2]!,
    ];
    expect(validateQuestionnaire(twoNa)).toBe(false);
  });

  it('rejects questionnaires with duplicate option IDs across questions', () => {
    const dupeOpt = [
      validQuestions[0]!,
      validQuestions[1]!,
      {
        ...validQuestions[2]!,
        options: [
          { id: 'opt-1-a', optionText: 'Duplicate ID', emojiAnchor: '👍', sentiment: 'positive' as const, isNeutralNa: false },
          { id: 'opt-3-na', optionText: 'N/A', emojiAnchor: '⚪', sentiment: 'neutral' as const, isNeutralNa: true },
        ],
      },
    ];
    expect(validateQuestionnaire(dupeOpt)).toBe(false);
  });

  it('fails closed on null or non-array inputs', () => {
    expect(validateQuestionnaire(null as unknown as SurveyQuestionDto[])).toBe(false);
    expect(validateQuestionnaire(undefined as unknown as SurveyQuestionDto[])).toBe(false);
  });
});

describe('truncateCustomerNote (Unicode & Surrogate Pair Safety)', () => {
  it('returns empty string for null, undefined, or empty text', () => {
    expect(truncateCustomerNote('')).toBe('');
    expect(truncateCustomerNote(null)).toBe('');
    expect(truncateCustomerNote(undefined)).toBe('');
  });

  it('preserves text that is strictly within limit', () => {
    expect(truncateCustomerNote('Loved the haircut!')).toBe('Loved the haircut!');
    expect(truncateCustomerNote('a'.repeat(150))).toBe('a'.repeat(150));
  });

  it('truncates standard ASCII strings at 150 characters', () => {
    const input = 'a'.repeat(160);
    const result = truncateCustomerNote(input, 150);
    expect(result.length).toBe(150);
    expect(result).toBe('a'.repeat(150));
  });

  it('prevents splitting surrogate pairs at the exact 149 + emoji boundary', () => {
    // Boundary test explicitly requested by founder:
    // "a".repeat(149) + "💇" has length 151.
    // Naive .slice(0, 150) would split "💇" (\uD83D\uDC87) leaving orphaned high surrogate \uD83D.
    const input = 'a'.repeat(149) + '💇';
    const naiveTruncated = input.slice(0, 150);

    // Confirm that naive slice DOES produce an orphaned high surrogate
    const naiveLastCode = naiveTruncated.charCodeAt(naiveLastCodeIndex(naiveTruncated));
    expect(naiveLastCode >= 0xd800 && naiveLastCode <= 0xdbff).toBe(true);

    // Confirm that truncateCustomerNote SAFELY drops the orphaned surrogate
    const safeResult = truncateCustomerNote(input, 150);
    expect(safeResult.length).toBe(149);
    expect(safeResult).toBe('a'.repeat(149));

    // Confirm last character is a valid ASCII 'a', not an orphaned surrogate
    const lastCode = safeResult.charCodeAt(safeResult.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdfff).toBe(false);
    expect(JSON.parse(JSON.stringify({ text: safeResult }))).toEqual({ text: 'a'.repeat(149) });
  });

  it('preserves full emoji when it fits within limit', () => {
    const input = 'a'.repeat(148) + '💇';
    const result = truncateCustomerNote(input, 150);
    expect(result.length).toBe(150);
    expect(result).toBe('a'.repeat(148) + '💇');
    expect(result.endsWith('💇')).toBe(true);
  });

  it('truncates trailing content after emoji safely', () => {
    const input = 'a'.repeat(148) + '💇' + 'extra';
    const result = truncateCustomerNote(input, 150);
    expect(result.length).toBe(150);
    expect(result).toBe('a'.repeat(148) + '💇');
  });

  it('safely handles repeated multi-byte emojis without splitting', () => {
    // 76 emojis = 152 code units. 75 emojis = 150 code units.
    const input = '💇'.repeat(76);
    const result = truncateCustomerNote(input, 150);
    expect(result.length).toBe(150);
    expect(result).toBe('💇'.repeat(75));
  });

  it('safely strips dangling Zero-Width Joiner (ZWJ)', () => {
    // "👨\u200D💻" is 5 units (👨[2] + ZWJ[1] + 💻[2])
    // 147 chars + 5 units = 152 units.
    // Slicing at 150 would cut after ZWJ (147 + 2 + 1 = 150).
    // The safe function drops the trailing ZWJ, keeping 👨 intact (149 units).
    const input = 'a'.repeat(147) + '👨\u200D💻';
    const result = truncateCustomerNote(input, 150);
    expect(result.length).toBe(149);
    expect(result).toBe('a'.repeat(147) + '👨');
    expect(result.endsWith('\u200D')).toBe(false);
  });
});

function naiveLastCodeIndex(str: string): number {
  return str.length - 1;
}

