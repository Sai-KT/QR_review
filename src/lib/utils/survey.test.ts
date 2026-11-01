import { describe, it, expect } from 'vitest';
import { validateQuestionnaire } from './survey';
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

