/**
 * Tests for FeedbackCardItem component (CMP-13)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedbackCardItem, formatFeedbackDate } from './FeedbackCardItem';
import type { CustomerFeedback } from '../../lib/adapters/feedback';
import type { SurveyQuestionOptionMeta, QuestionMeta } from '../../lib/api/merchant';

describe('formatFeedbackDate', () => {
  it('formats invalid dates safely without crashing', () => {
    const res = formatFeedbackDate('invalid-date');
    expect(res.relative).toBe('Recently');
    expect(res.full).toBe('invalid-date');
  });

  it('formats recent timestamps to relative time', () => {
    const nowIso = new Date().toISOString();
    const res = formatFeedbackDate(nowIso);
    expect(res.relative).toBe('Just now');
  });
});

describe('FeedbackCardItem (CMP-13)', () => {
  const mockOptionsMap = new Map<string, SurveyQuestionOptionMeta>([
    [
      'opt-1',
      {
        id: 'opt-1',
        questionId: 'q-1',
        optionText: 'Masterful & Precise',
        emojiAnchor: '✂️',
        sentimentLabel: 'positive',
        isNeutralNa: false,
      },
    ],
    [
      'opt-2',
      {
        id: 'opt-2',
        questionId: 'q-2',
        optionText: 'Clean & hygienic station',
        emojiAnchor: '✨',
        sentimentLabel: 'positive',
        isNeutralNa: false,
      },
    ],
    [
      'opt-3-neg',
      {
        id: 'opt-3-neg',
        questionId: 'q-3',
        optionText: 'Long wait despite appointment',
        emojiAnchor: '⏳',
        sentimentLabel: 'negative',
        isNeutralNa: false,
      },
    ],
  ]);

  const mockQuestionsMap = new Map<string, QuestionMeta>([
    ['q-1', { id: 'q-1', questionText: 'How was your haircut?', displayOrder: 1 }],
    ['q-2', { id: 'q-2', questionText: 'Salon cleanliness', displayOrder: 2 }],
    ['q-3', { id: 'q-3', questionText: 'Wait time & hospitality', displayOrder: 3 }],
  ]);

  const baseFeedback: CustomerFeedback = {
    id: 'f-100',
    businessId: 'b-001',
    categoryId: 'salon',
    selectedOptions: [
      { questionId: 'q-1', optionId: 'opt-1' },
      { questionId: 'q-2', optionId: 'opt-2' },
    ],
    affirmedFactsSnapshot: ['Masterful & Precise', 'Clean & hygienic station'],
    optionalNote: 'Stylist was amazing and gentle with my hair!',
    sessionUuid: 's-100',
    purgedAt: null,
    createdAt: '2026-10-25T14:30:00Z',
    authenticityConfirmed: true,
  };

  it('renders Case A: Active retained customer note correctly', () => {
    render(
      <FeedbackCardItem
        feedback={baseFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('feedback-card-item')).toBeInTheDocument();
    expect(screen.getByTestId('feedback-note-retained')).toBeInTheDocument();
    expect(
      screen.getByText('“Stylist was amazing and gentle with my hair!”'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-none')).not.toBeInTheDocument();
  });

  it('renders Case B: Privacy-purged customer note indicator when purgedAt is set', () => {
    const purgedFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-101',
      optionalNote: null,
      purgedAt: '2026-11-24T14:30:00Z',
    };

    render(
      <FeedbackCardItem
        feedback={purgedFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
    expect(
      screen.getByText('[Personal note expired per privacy policy]'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Customer notes are automatically expunged after 30 days/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-none')).not.toBeInTheDocument();
  });

  it('prioritizes purged indicator even if legacy record has stale note content', () => {
    const staleFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-102',
      optionalNote: 'Stale note that was not erased',
      purgedAt: '2026-11-24T14:30:00Z',
    };

    render(
      <FeedbackCardItem
        feedback={staleFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
    expect(
      screen.getByText('[Personal note expired per privacy policy]'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stale note that was not erased/i)).not.toBeInTheDocument();
  });

  it('renders Case C: Customer provided no note (does NOT flag as purged)', () => {
    const noNoteFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-103',
      optionalNote: null,
      purgedAt: null,
    };

    render(
      <FeedbackCardItem
        feedback={noNoteFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('feedback-note-none')).toBeInTheDocument();
    expect(screen.getByText('No additional note provided.')).toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
  });

  it('renders positive sentiment and authenticity badges', () => {
    render(
      <FeedbackCardItem
        feedback={baseFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('badge-sentiment-positive')).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByTestId('badge-authenticity-confirmed')).toBeInTheDocument();
    expect(screen.getByText('Verified Visit')).toBeInTheDocument();
  });

  it('renders critical sentiment badge when negative option is selected', () => {
    const criticalFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-104',
      selectedOptions: [
        { questionId: 'q-1', optionId: 'opt-1' },
        { questionId: 'q-3', optionId: 'opt-3-neg' },
      ],
    };

    render(
      <FeedbackCardItem
        feedback={criticalFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('badge-sentiment-critical')).toBeInTheDocument();
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
  });

  it('renders MCQ questions and options with emojis', () => {
    render(
      <FeedbackCardItem
        feedback={baseFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByText('How was your haircut?')).toBeInTheDocument();
    expect(screen.getByText('Masterful & Precise')).toBeInTheDocument();
    expect(screen.getByText('✂️')).toBeInTheDocument();
    expect(screen.getByText('Salon cleanliness')).toBeInTheDocument();
    expect(screen.getByText('Clean & hygienic station')).toBeInTheDocument();
  });

  it('renders affirmed facts snapshot fallback if selectedOptions is empty', () => {
    const factsFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-105',
      selectedOptions: [],
      affirmedFactsSnapshot: ['Friendly greeting', 'Great haircut'],
    };

    render(<FeedbackCardItem feedback={factsFeedback} />);

    expect(screen.getByText('Friendly greeting')).toBeInTheDocument();
    expect(screen.getByText('Great haircut')).toBeInTheDocument();
  });

  it('renders historical affirmed facts snapshot separately without false positional attribution when neutral option was omitted', () => {
    // Exact scenario from Section 3:
    // Q1 answered positive, Q2 neutral N/A (omitted from snapshot), Q3 answered negative
    // All 3 options later soft-retired
    const historicalFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-106',
      selectedOptions: [
        { questionId: 'q-1', optionId: 'opt-retired-q1' },
        { questionId: 'q-2', optionId: 'opt-retired-q2-na' },
        { questionId: 'q-3', optionId: 'opt-retired-q3-neg' },
      ],
      // Snapshot only contains non-neutral affirmative facts (2 items for 3 questions)
      affirmedFactsSnapshot: ['Masterful & Precise', 'Long wait despite appointment'],
    };

    render(
      <FeedbackCardItem
        feedback={historicalFeedback}
        optionsMap={mockOptionsMap} // does NOT contain the retired options
        questionsMap={mockQuestionsMap}
      />,
    );

    // 1. Grid questions display "Archived Option", NEVER falsely attributing Q3's fact to Q2
    const archivedBadges = screen.getAllByText('Archived');
    expect(archivedBadges.length).toBe(3);

    // 2. The dedicated snapshot section contains the verified submission-time affirmations
    expect(
      screen.getByTestId('feedback-affirmed-facts-snapshot'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Affirmed Experience Snapshot (Submission Time)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Masterful & Precise')).toBeInTheDocument();
    expect(screen.getByText('Long wait despite appointment')).toBeInTheDocument();

    // 3. Question 2's card container must NOT contain "Long wait despite appointment"
    const q2Card = screen.getByText('Salon cleanliness').closest('.rounded-lg');
    expect(q2Card).not.toHaveTextContent('Long wait despite appointment');
    expect(q2Card).toHaveTextContent('Archived Option');
  });

  it('handles partially retired options where Q2 is active and Q1/Q3 are retired', () => {
    const mixedRetiredFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-106b',
      selectedOptions: [
        { questionId: 'q-1', optionId: 'opt-retired-q1' },
        { questionId: 'q-2', optionId: 'opt-2' }, // opt-2 IS active in mockOptionsMap
        { questionId: 'q-3', optionId: 'opt-retired-q3' },
      ],
      affirmedFactsSnapshot: ['Style fact', 'Clean & hygienic station'],
    };

    render(
      <FeedbackCardItem
        feedback={mixedRetiredFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    // Q2 displays its active option text
    expect(screen.getAllByText('Clean & hygienic station').length).toBeGreaterThanOrEqual(1);

    // Q1 and Q3 display Archived Option
    expect(screen.getAllByText('Archived Option').length).toBe(2);

    // Dedicated snapshot is rendered because at least one option is retired
    expect(
      screen.getByTestId('feedback-affirmed-facts-snapshot'),
    ).toBeInTheDocument();
    expect(screen.getByText('Style fact')).toBeInTheDocument();
  });

  it('handles retired options with missing or empty snapshot safely without crashing', () => {
    const emptySnapshotFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-106c',
      selectedOptions: [{ questionId: 'q-1', optionId: 'opt-retired-q1' }],
      affirmedFactsSnapshot: [],
    };

    render(
      <FeedbackCardItem
        feedback={emptySnapshotFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByText('Archived Option')).toBeInTheDocument();
    expect(
      screen.queryByTestId('feedback-affirmed-facts-snapshot'),
    ).not.toBeInTheDocument();
  });

  it('redacts customer notes older than 30 days even if purgedAt was not yet set by pg_cron (Case D)', () => {
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const staleUnpurgedFeedback: CustomerFeedback = {
      ...baseFeedback,
      id: 'f-107',
      optionalNote: 'Customer secret note that was not yet swept by cron',
      purgedAt: null,
      createdAt: thirtyFiveDaysAgo,
    };

    render(
      <FeedbackCardItem
        feedback={staleUnpurgedFeedback}
        optionsMap={mockOptionsMap}
        questionsMap={mockQuestionsMap}
      />,
    );

    expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
    expect(
      screen.getByText('[Personal note expired per privacy policy]'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Customer secret note that was not yet swept by cron/i),
    ).not.toBeInTheDocument();
  });
});

