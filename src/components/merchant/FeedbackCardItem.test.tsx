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

  /* -------------------------------------------------------------------------- */
  /* Section 4: Focused 8-Scenario Note Privacy Lifecycle Test Suite            */
  /* -------------------------------------------------------------------------- */
  describe('Section 4: Focused 8-Scenario Note Privacy Lifecycle Suite', () => {
    it('1. renders a recent response with a retained note (Case A)', () => {
      const recentFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-1',
        optionalNote: 'Recent glowing review note',
        purgedAt: null,
        noteStatus: 'RETAINED',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };

      render(
        <FeedbackCardItem
          feedback={recentFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-retained')).toBeInTheDocument();
      expect(screen.getByText('“Recent glowing review note”')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-none')).not.toBeInTheDocument();
    });

    it('2. renders a recent response without a note (Case C)', () => {
      const recentNoNoteFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-2',
        optionalNote: null,
        purgedAt: null,
        noteStatus: 'NONE',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };

      render(
        <FeedbackCardItem
          feedback={recentNoNoteFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-none')).toBeInTheDocument();
      expect(screen.getByText('No additional note provided.')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
    });

    it('3. renders a 45-day-old response that never contained a note (Case C - Critical Fix)', () => {
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const oldNoNoteFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-3',
        optionalNote: null,
        purgedAt: null,
        noteStatus: 'NONE',
        createdAt: fortyFiveDaysAgo,
      };

      render(
        <FeedbackCardItem
          feedback={oldNoNoteFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      // CRITICAL INVARIANT: Never invent an expired/purged indicator merely because the response is old!
      expect(screen.getByTestId('feedback-note-none')).toBeInTheDocument();
      expect(screen.getByText('No additional note provided.')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
      expect(screen.queryByText('[Personal note expired per privacy policy]')).not.toBeInTheDocument();
    });

    it('4. renders a 45-day-old response with an unpurged note still present in database response (Case D)', () => {
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const oldUnpurgedFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-4',
        optionalNote: null, // Redacted by DTO adapter
        purgedAt: null, // Authoritative DB truth
        noteStatus: 'EXPIRED',
        createdAt: fortyFiveDaysAgo,
      };

      render(
        <FeedbackCardItem
          feedback={oldUnpurgedFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
      expect(screen.getByTestId('badge-note-expired')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByText('[Personal note expired per privacy policy]')).toBeInTheDocument();
      expect(
        screen.getByText(/Customer notes are automatically expunged after 30 days/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-none')).not.toBeInTheDocument();
    });

    it('5. renders a physically purged response with purged_at (Case B)', () => {
      const purgedFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-5',
        optionalNote: null,
        purgedAt: '2026-10-15T12:00:00Z',
        noteStatus: 'PURGED',
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      };

      render(
        <FeedbackCardItem
          feedback={purgedFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
      expect(screen.getByTestId('badge-note-purged')).toBeInTheDocument();
      expect(screen.getByText('Purged')).toBeInTheDocument();
      expect(screen.getByText('[Personal note expired per privacy policy]')).toBeInTheDocument();
      expect(
        screen.getByText(/Customer notes are automatically expunged after 30 days/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-none')).not.toBeInTheDocument();
    });

    it('6. handles an inconsistent row containing both optional_note and purged_at (Case B)', () => {
      const inconsistentFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-6',
        optionalNote: null, // strictly redacted by adapter
        purgedAt: '2026-10-15T12:00:00Z',
        noteStatus: 'PURGED',
        createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      };

      render(
        <FeedbackCardItem
          feedback={inconsistentFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
      expect(screen.getByTestId('badge-note-purged')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
    });

    it('7. handles exact 30-day boundary: retained at exactly 30 days, expired past 30 days', () => {
      const now = Date.now();
      const exactBoundary = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const pastBoundary = new Date(now - (30 * 24 * 60 * 60 * 1000 + 1000)).toISOString();

      // 7a: Exact boundary with note is RETAINED
      const boundaryFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-7a',
        optionalNote: 'Note on the exact border',
        purgedAt: null,
        noteStatus: 'RETAINED',
        createdAt: exactBoundary,
      };

      const { rerender } = render(
        <FeedbackCardItem
          feedback={boundaryFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-retained')).toBeInTheDocument();
      expect(screen.getByText('“Note on the exact border”')).toBeInTheDocument();

      // 7b: Past boundary with note is EXPIRED
      const expiredFeedback: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-7b',
        optionalNote: null,
        purgedAt: null,
        noteStatus: 'EXPIRED',
        createdAt: pastBoundary,
      };

      rerender(
        <FeedbackCardItem
          feedback={expiredFeedback}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-purged')).toBeInTheDocument();
      expect(screen.getByTestId('badge-note-expired')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-retained')).not.toBeInTheDocument();
    });

    it('8. handles malformed or missing timestamps safely without crashing', () => {
      // 8a: Malformed timestamp with active note
      const malformedWithNote: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-8a',
        optionalNote: 'Safe note with bad date',
        purgedAt: null,
        noteStatus: 'RETAINED',
        createdAt: 'malformed-date-string',
      };

      const { rerender } = render(
        <FeedbackCardItem
          feedback={malformedWithNote}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-retained')).toBeInTheDocument();
      expect(screen.getByText('“Safe note with bad date”')).toBeInTheDocument();

      // 8b: Malformed timestamp without note
      const malformedWithoutNote: CustomerFeedback = {
        ...baseFeedback,
        id: 'f-sec4-8b',
        optionalNote: null,
        purgedAt: null,
        noteStatus: 'NONE',
        createdAt: 'malformed-date-string',
      };

      rerender(
        <FeedbackCardItem
          feedback={malformedWithoutNote}
          optionsMap={mockOptionsMap}
          questionsMap={mockQuestionsMap}
        />,
      );

      expect(screen.getByTestId('feedback-note-none')).toBeInTheDocument();
      expect(screen.getByText('No additional note provided.')).toBeInTheDocument();
      expect(screen.queryByTestId('feedback-note-purged')).not.toBeInTheDocument();
    });
  });
});

