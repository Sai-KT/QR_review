import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SurveyFlow } from './SurveyFlow';
import * as surveyApi from '../../lib/api/survey';
import type { PublicBusinessProjection } from '../../types/domain';

describe('SurveyFlow Component (M3-T06 / SCR-CUST-02..05)', () => {
  const mockBusiness: PublicBusinessProjection = {
    publicQrId: 'luxe000001',
    name: 'Luxe Studio Unisex Salon',
    logoUrl: 'https://cdn.example.com/logo.png',
    categoryId: 'salon',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=luxe',
    whatsappNumber: '919876543210',
    accountStatus: 'active',
    isActive: true,
    subscriptionStatus: 'active',
    isDirectGoogleOnly: false,
    isSuspended: false,
  };

  const mockQuestionsData: surveyApi.SurveyQuestionsDto = {
    categoryId: 'salon',
    surveyVersion: 'sv_test1234567890',
    questions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayOrder: 1,
        questionText: 'How was your hair service today?',
        options: [
          {
            id: 'opt-q1-pos',
            optionText: 'Masterful & Precise',
            emojiAnchor: '💇',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'opt-q1-neg',
            optionText: 'Service took too long',
            emojiAnchor: '⏳',
            sentiment: 'negative',
            isNeutralNa: false,
          },
          {
            id: 'opt-q1-na',
            optionText: 'Not Applicable',
            emojiAnchor: '⚪',
            sentiment: 'neutral',
            isNeutralNa: true,
          },
        ],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        displayOrder: 2,
        questionText: 'How was the hospitality & team ambience?',
        options: [
          {
            id: 'opt-q2-pos',
            optionText: 'Warm & Professional',
            emojiAnchor: '✨',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'opt-q2-na',
            optionText: 'Not Applicable',
            emojiAnchor: '⚪',
            sentiment: 'neutral',
            isNeutralNa: true,
          },
        ],
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        displayOrder: 3,
        questionText: 'Would you recommend Luxe Studio?',
        options: [
          {
            id: 'opt-q3-pos',
            optionText: 'Definitely Yes',
            emojiAnchor: '🌟',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'opt-q3-na',
            optionText: 'Not Applicable',
            emojiAnchor: '⚪',
            sentiment: 'neutral',
            isNeutralNa: true,
          },
        ],
      },
    ],
  };

  function renderSurveyFlow(initialStep = '1', props?: Partial<React.ComponentProps<typeof SurveyFlow>>) {
    return render(
      <MemoryRouter initialEntries={[`/q/luxe000001?step=${initialStep}`]}>
        <SurveyFlow business={mockBusiness} {...props} />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading shimmer initially while fetching questionnaire', () => {
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockImplementation(
      () => new Promise(() => {}), // Pending forever
    );

    renderSurveyFlow('1', { activeTokenText: 'token: "luxe000001"' });

    const busyCard = screen.getByRole('generic', { busy: true });
    expect(busyCard).toBeInTheDocument();
  });

  it('renders Question 1 when questions are successfully loaded', async () => {
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
      expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    });

    expect(screen.getByText(/Masterful & Precise/i)).toBeInTheDocument();
    expect(screen.getByText(/Service took too long/i)).toBeInTheDocument();
    expect(screen.getByText(/Not Applicable/i)).toBeInTheDocument();
  });

  it('handles question retrieval failure with retry button and direct Google bypass', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(surveyApi, 'fetchSurveyQuestions')
      .mockRejectedValueOnce(new surveyApi.ApiClientError('Server error', 500, 'ERR_INTERNAL_ERROR'))
      .mockResolvedValueOnce(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Survey Questions')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry Loading Questions/i });
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('enforces sequential progression and preserves answers during Back navigation', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Step 1: Select negative critical option
    const negOption = screen.getByText(/Service took too long/i);
    await user.click(negOption);

    const nextBtn1 = screen.getByRole('button', { name: /Next to question 2/i });
    await user.click(nextBtn1);

    // Should advance to Question 2
    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
      expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    });

    // Navigate Back to Question 1
    const backBtn = screen.getByRole('button', { name: /Back to question 1/i });
    await user.click(backBtn);

    // Answer from Question 1 must be preserved
    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });
    const radio = screen.getByDisplayValue('opt-q1-neg');
    expect(radio).toBeChecked();
  });

  it('allows changing an earlier selection, replacing the previous answer', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Select negative first
    await user.click(screen.getByText(/Service took too long/i));
    expect(screen.getByDisplayValue('opt-q1-neg')).toBeChecked();

    // Change to positive
    await user.click(screen.getByText(/Masterful & Precise/i));
    expect(screen.getByDisplayValue('opt-q1-pos')).toBeChecked();
    expect(screen.getByDisplayValue('opt-q1-neg')).not.toBeChecked();
  });

  it('navigates from Question 3 to Optional Note Editor', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Question 1
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    // Question 2
    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Professional/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    // Question 3
    await waitFor(() => {
      expect(screen.getByText('Would you recommend Luxe Studio?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Definitely Yes/i));
    await user.click(screen.getByRole('button', { name: /Next, optional note/i }));

    // Note Editor (SCR-CUST-05)
    await waitFor(() => {
      expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
      expect(screen.getByLabelText(/Personal Note/i)).toBeInTheDocument();
    });
  });

  it('submits feedback through API-PUB-04 and renders confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);
    const submitSpy = vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-12345',
      submissionToken: 'sub_valid_token_xyz',
    });

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Step 1
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    // Step 2
    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Professional/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    // Step 3
    await waitFor(() => {
      expect(screen.getByText('Would you recommend Luxe Studio?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Definitely Yes/i));
    await user.click(screen.getByRole('button', { name: /Next, optional note/i }));

    // Note Editor
    await waitFor(() => {
      expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
    });
    const noteInput = screen.getByLabelText(/Personal Note/i);
    await user.type(noteInput, 'Loved the haircut by Priya!');

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Submit feedback/i });
    await user.click(submitBtn);

    // Verify API call payload
    expect(submitSpy).toHaveBeenCalledWith({
      publicQrId: 'luxe000001',
      sessionUuid: expect.any(String),
      responses: [
        { questionId: '11111111-1111-4111-8111-111111111111', optionId: 'opt-q1-pos' },
        { questionId: '22222222-2222-4222-8222-222222222222', optionId: 'opt-q2-pos' },
        { questionId: '33333333-3333-4333-8333-333333333333', optionId: 'opt-q3-pos' },
      ],
      optionalNote: 'Loved the haircut by Priya!',
    });

    // Success Confirmation
    await waitFor(() => {
      expect(screen.getByText('Feedback Received!')).toBeInTheDocument();
      expect(screen.getByText(/Your responses have been recorded securely/i)).toBeInTheDocument();
    });

    // Universal Anti-Gating Direct Google Action
    expect(screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeInTheDocument();
  });

  it('detects stale question error and provides Refresh Questions recovery', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);
    vi.spyOn(surveyApi, 'submitFeedback').mockRejectedValue(
      new surveyApi.ApiClientError(
        'Option opt-q1-pos is retired and no longer active.',
        400,
        'ERR_INVALID_PAYLOAD',
      ),
    );

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Answer questions
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Professional/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => {
      expect(screen.getByText('Would you recommend Luxe Studio?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Definitely Yes/i));
    await user.click(screen.getByRole('button', { name: /Next, optional note/i }));

    await waitFor(() => {
      expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
    });

    // Submit triggers stale error
    const submitBtn = screen.getByRole('button', { name: /Submit feedback/i });
    await user.click(submitBtn);

    // Stale questionnaire recovery card
    await waitFor(() => {
      expect(screen.getByText('Questions Recently Updated')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh Questions ↻/i })).toBeInTheDocument();
    });

    // Direct Google action remains available even during stale error
    expect(screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeInTheDocument();
  });

  it('handles HTTP 409 idempotency conflict gracefully without fabricating success', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);
    vi.spyOn(surveyApi, 'submitFeedback').mockRejectedValue(
      new surveyApi.ApiClientError(
        'A survey submission already exists for this session with different responses or note.',
        409,
        'ERR_IDEMPOTENCY_CONFLICT',
      ),
    );

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Professional/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => {
      expect(screen.getByText('Would you recommend Luxe Studio?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Definitely Yes/i));
    await user.click(screen.getByRole('button', { name: /Next, optional note/i }));

    await waitFor(() => {
      expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Submit feedback/i });
    await user.click(submitBtn);

    // Shows conflict message on note editor
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already received for this session/i);
    });
  });

  it('displays OfflineConnectionBanner when offline event fires mid-survey while preserving state', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    // Select Q1 answer
    await user.click(screen.getByText(/Masterful & Precise/i));

    // Simulate network disconnection
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Offline banner must appear immediately
    await waitFor(() => {
      expect(screen.getByText('Connection Lost')).toBeInTheDocument();
      expect(
        screen.getByText(/Please check your connection\. Your current answers are safely retained\./i),
      ).toBeInTheDocument();
    });

    // Verify option is still checked
    expect(screen.getByRole('radio', { name: /Masterful & Precise/i })).toBeChecked();

    // Advance to Q2 while offline
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));
    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });

    // Simulate reconnection
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(screen.queryByText('Connection Lost')).not.toBeInTheDocument();
    });
  });

  it('handles offline submission failure safely without losing note or answers', async () => {
    const user = userEvent.setup();
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockQuestionsData);
    vi.spyOn(surveyApi, 'submitFeedback').mockRejectedValue(
      new surveyApi.ApiClientError('Network error', 0, 'ERR_NETWORK_ERROR'),
    );

    renderSurveyFlow('1');

    await waitFor(() => {
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => {
      expect(screen.getByText('How was the hospitality & team ambience?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Professional/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => {
      expect(screen.getByText('Would you recommend Luxe Studio?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Definitely Yes/i));
    await user.click(screen.getByRole('button', { name: /Next, optional note/i }));

    await waitFor(() => {
      expect(screen.getByText('Add an Optional Note')).toBeInTheDocument();
    });

    const noteTextarea = screen.getByRole('textbox', { name: /Personal Note/i });
    await user.type(noteTextarea, 'Terrific stylist and experience!');

    // Attempt submit while network fails
    const submitBtn = screen.getByRole('button', { name: /Submit feedback/i });
    await user.click(submitBtn);

    // Shows connection error
    await waitFor(() => {
      expect(screen.getByText('Connection Lost')).toBeInTheDocument();
    });

    // Verify note is still in textarea
    expect(noteTextarea).toHaveValue('Terrific stylist and experience!');
  });
});
