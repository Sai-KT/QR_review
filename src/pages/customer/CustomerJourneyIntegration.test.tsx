import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CustomerPageShell } from './CustomerPageShell';
import * as publicApi from '../../lib/api/public';
import * as surveyApi from '../../lib/api/survey';
import * as reviewApi from '../../lib/api/review';
import * as clipboardModule from '../../lib/clipboard';
import * as analyticsApi from '../../lib/api/analytics';
import type { PublicBusinessProjection } from '../../types/domain';

function renderCustomerJourney(initialRoute = '/q/TESTQR1234') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/q/:qrId" element={<CustomerPageShell />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Post-M4 Integration Gate C: Complete Customer Journey Orchestration', () => {
  const mockActiveBusiness: PublicBusinessProjection = {
    publicQrId: 'TESTQR1234',
    name: 'Artisan Hair Studio',
    logoUrl: 'https://cdn.example.com/logo.png',
    categoryId: 'salon',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ12345',
    whatsappNumber: '919876543210',
    accountStatus: 'active',
    isActive: true,
    subscriptionStatus: 'active',
    isDirectGoogleOnly: false,
    isSuspended: false,
  };

  const mockSurveyQuestions: surveyApi.SurveyQuestionsDto = {
    categoryId: 'salon',
    surveyVersion: 'sv_test_v1',
    questions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayOrder: 1,
        questionText: 'How was your haircut today?',
        options: [
          {
            id: 'opt-q1-pos',
            optionText: 'Masterful & Precise',
            emojiAnchor: '✂️',
            sentiment: 'positive',
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
        questionText: 'How was the staff hospitality?',
        options: [
          {
            id: 'opt-q2-pos',
            optionText: 'Warm & Attentive team',
            emojiAnchor: '😊',
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
        questionText: 'What stood out most about your visit?',
        options: [
          {
            id: 'opt-q3-pos',
            optionText: 'Clean & hygienic station',
            emojiAnchor: '✨',
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

  beforeEach(() => {
    vi.clearAllMocks();
    clipboardModule._resetClipboardInFlight();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Happy Path: Full End-to-End Orchestration (Welcome -> Survey -> AI -> Editor -> Handoff)
  // ==========================================================================
  it('orchestrates complete journey from QR scan to Google Maps handoff with customer authenticity confirmation', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    const submitFeedbackSpy = vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-001',
      submissionToken: 'resp-uuid-001.1730000000.signature_hash_xyz',
    });
    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview').mockResolvedValue({
      reviewDraft: 'Masterful haircut with great precision. The station was clean and hygienic, and the team was warm and attentive.',
      wordCount: 20,
      sentiment: 'positive',
    });
    const copySpy = vi.spyOn(clipboardModule, 'copyReviewDraftWithTelemetry').mockResolvedValue({
      success: true,
    });
    const trackEventSpy = vi.spyOn(analyticsApi, 'trackEvent').mockResolvedValue({
      status: 'accepted',
    });

    renderCustomerJourney();

    // 1. Welcome Page (SCR-CUST-01)
    await waitFor(() => {
      expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i })).toBeInTheDocument();
    });

    // Customer starts survey
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    // 2. Question 1 (SCR-CUST-02)
    await waitFor(() => {
      expect(screen.getByText('How was your haircut today?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    // 3. Question 2 (SCR-CUST-03)
    await waitFor(() => {
      expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    // 4. Question 3 (SCR-CUST-04)
    await waitFor(() => {
      expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument();
    });
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    // 5. Note Editor & Authenticity Checkbox (SCR-CUST-05)
    await waitFor(() => {
      expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument();
    });
    const noteTextarea = screen.getByPlaceholderText(/e\.g\./i);
    await user.type(noteTextarea, 'Great attention to detail!');

    // Customer checks authenticity confirmation
    const authenticityCheckbox = screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    });
    expect(authenticityCheckbox).not.toBeChecked();
    await user.click(authenticityCheckbox);
    expect(authenticityCheckbox).toBeChecked();

    // Customer submits survey
    const submitButton = screen.getByRole('button', { name: /Submit Feedback/i });
    await user.click(submitButton);

    expect(submitFeedbackSpy).toHaveBeenCalledTimes(1);
    expect(submitFeedbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        publicQrId: 'TESTQR1234',
        authenticityConfirmed: true,
        optionalNote: 'Great attention to detail!',
      }),
    );

    // 6. Survey Submission Success (SCR-CUST-05 Completed)
    await waitFor(() => {
      expect(screen.getByText('Feedback Received!')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    // Zero AI generation before explicit customer action!
    expect(generateReviewSpy).not.toHaveBeenCalled();

    // 7. Intentional AI Generation Trigger
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    // Verified: EVENT_GENERATION_REQUESTED tracked non-blockingly
    expect(trackEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        publicQrId: 'TESTQR1234',
        eventName: 'EVENT_GENERATION_REQUESTED',
      }),
    );

    // Verified: API payload binds responseId, submissionToken, and sessionUuid
    expect(generateReviewSpy).toHaveBeenCalledTimes(1);
    expect(generateReviewSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: 'resp-uuid-001',
        submissionToken: 'resp-uuid-001.1730000000.signature_hash_xyz',
        publicQrId: 'TESTQR1234',
      }),
    );

    // 8. Review Draft Editor (SCR-CUST-07)
    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
      expect(screen.getByTestId('ai-transparency-notice')).toBeInTheDocument();
      expect(screen.getByText(/This draft is an AI suggestion based on your selections/i)).toBeInTheDocument();
    });

    const draftTextarea = screen.getByRole('textbox', { name: /Edit your review draft/i });
    expect(draftTextarea).toHaveValue(
      'Masterful haircut with great precision. The station was clean and hygienic, and the team was warm and attentive.',
    );

    // Customer in-place editing freedom: modify the draft
    await user.type(draftTextarea, ' Highly recommended!');

    // 9. Synchronous User-Gesture Clipboard Handoff (SCR-CUST-08)
    const acceptAndCopyBtn = screen.getByRole('button', { name: /Accept & Copy Draft →/i });
    await user.click(acceptAndCopyBtn);

    // Verified: copyReviewDraftWithTelemetry invoked synchronously with edited draft
    expect(copySpy).toHaveBeenCalledWith(
      'Masterful haircut with great precision. The station was clean and hygienic, and the team was warm and attentive. Highly recommended!',
      expect.objectContaining({
        publicQrId: 'TESTQR1234',
      }),
    );

    // 10. Handoff Screen (SCR-CUST-08)
    await waitFor(() => {
      expect(screen.getByText('Review copied to your clipboard!')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Open Google Maps to Post →/i })).toBeInTheDocument();
    });

    // Customer clicks Google Maps handoff
    await user.click(screen.getByRole('button', { name: /Open Google Maps to Post →/i }));
    expect(window.open).toHaveBeenCalledWith(
      'https://search.google.com/local/writereview?placeid=ChIJ12345',
      '_blank',
      'noopener,noreferrer',
    );
  });

  // ==========================================================================
  // 2. Gate B Authenticity Enforcement: Unconfirmed Feedback Flow
  // ==========================================================================
  it('prohibits AI review generation when customer leaves authenticity confirmation unchecked (Gate B)', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-unconfirmed',
      submissionToken: 'resp-uuid-unconfirmed.token',
    });
    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview');

    renderCustomerJourney();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    // Answer Q1, Q2, Q3
    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    // Note page: Customer leaves authenticity checkbox UNCHECKED
    await waitFor(() => {
      expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument();
    });
    const authenticityCheckbox = screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    });
    expect(authenticityCheckbox).not.toBeChecked();

    // Submit feedback
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByText('Feedback Received!')).toBeInTheDocument();
      // Truthful explanation why AI is disabled
      expect(screen.getByText(/Because visit authenticity was not confirmed, AI-assisted review drafting is unavailable/i)).toBeInTheDocument();
    });

    // Verified: No AI generation button is rendered for unconfirmed patron
    expect(screen.queryByRole('button', { name: /Draft My Review with AI ↗/i })).not.toBeInTheDocument();

    // Verified: Anti-gating direct Google review access remains immediately accessible
    expect(screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeInTheDocument();

    // Verified: generateReview API was NEVER dispatched
    expect(generateReviewSpy).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // 3. Negative Feedback Eligibility (Sentiment Preservation)
  // ==========================================================================
  it('allows customers with critical/neutral feedback to request authentic AI review drafting without sentiment gating', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-crit',
      submissionToken: 'resp-uuid-crit.token',
    });
    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview').mockResolvedValue({
      reviewDraft: 'Service was standard and stations were clean, but wait time was longer than expected.',
      wordCount: 15,
      sentiment: 'neutral',
    });

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    // Select N/A or standard options
    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Not Applicable/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Not Applicable/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/e\.g\./i), 'Wait was 25 mins');

    // Confirm authenticity
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });

    expect(generateReviewSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: /Edit your review draft/i })).toHaveValue(
      'Service was standard and stations were clean, but wait time was longer than expected.',
    );
  });

  // ==========================================================================
  // 4. Fallback Routing: Gemini Timeout (HTTP 504) and Single Eligible Retry
  // ==========================================================================
  it('routes HTTP 504 Gemini timeout to timeout recovery screen and enforces single retry allowance', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-timeout',
      submissionToken: 'resp-uuid-timeout.token',
    });

    const timeoutError = new reviewApi.ApiClientError(
      'Gemini AI generation exceeded the maximum deadline.',
      504,
      'ERR_GEMINI_TIMEOUT',
      'corr_timeout_001',
      true,
    );
    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview').mockRejectedValue(timeoutError);

    renderCustomerJourney();

    // Fast-forward survey steps
    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    // Trigger AI generation
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    // Timeout Card presented (SCR-CUST-10)
    await waitFor(() => {
      expect(screen.getByText(/Your review draft is taking longer than expected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /↻ Retry Generation/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeInTheDocument();
    });

    expect(generateReviewSpy).toHaveBeenCalledTimes(1);

    // Customer exercises their single eligible retry (1/1)
    await user.click(screen.getByRole('button', { name: /↻ Retry Generation/i }));

    expect(generateReviewSpy).toHaveBeenCalledTimes(2);

    // After retry fails, retry button is disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Retry/i })).toBeDisabled();
    });

    // Customer can still write in their own words
    await user.click(screen.getByRole('button', { name: /Write in Your Own Words/i }));

    // Review editor empty state card
    await waitFor(() => {
      expect(screen.getByText('No Review Draft Available')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Your Own Review ✍/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Write Your Own Review ✍/i }));

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /Edit your review draft/i })).toHaveValue('');
    });
  });

  // ==========================================================================
  // 5. Fallback Routing: Quota Exhaustion (HTTP 429 ERR_QUOTA_EXHAUSTED)
  // ==========================================================================
  it('routes HTTP 429 ERR_QUOTA_EXHAUSTED to quota exhaustion screen with zero internal accounting leakage', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-quota',
      submissionToken: 'resp-uuid-quota.token',
    });

    const quotaError = new reviewApi.ApiClientError(
      'Monthly review drafting quota exhausted for this business.',
      429,
      'ERR_QUOTA_EXHAUSTED',
      'corr_quota_001',
      false,
    );
    vi.spyOn(reviewApi, 'generateReview').mockRejectedValue(quotaError);

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    // SCR-CUST-11 Quota Exhausted Card
    await waitFor(() => {
      expect(screen.getByText('AI review assistance is temporarily unavailable')).toBeInTheDocument();
      expect(screen.getByText(/This business has reached its monthly AI drafting limit/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeInTheDocument();
    });

    // Zero internal quota numbers (150/month) leaked to customer
    expect(screen.queryByText(/150/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
  });

  // ==========================================================================
  // 6. Fallback Routing: M0-16 Insufficient Facts Abstention
  // ==========================================================================
  it('routes M0-16 abstention response to InsufficientFactsCard without fabricating fake review drafts', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-abstained',
      submissionToken: 'resp-uuid-abstained.token',
    });

    vi.spyOn(reviewApi, 'generateReview').mockResolvedValue({
      reviewDraft: null,
      wordCount: 0,
      sentiment: 'neutral',
      abstained: true,
      reason: 'INSUFFICIENT_FACTS',
      message: 'Cannot generate grounded review from neutral selections without personal notes.',
    });

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    // Insufficient Facts Card
    await waitFor(() => {
      expect(screen.getByText(/We couldn't generate a specific review draft/i)).toBeInTheDocument();
      expect(screen.getByText(/We cannot generate a reliable draft from the provided information/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write in Your Own Words/i })).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 7. Clipboard Failure Graceful Degradation (Manual-Copy Fallback)
  // ==========================================================================
  it('gracefully degrades to accessible manual-copy fallback when Clipboard API write fails or is denied', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-clip',
      submissionToken: 'resp-uuid-clip.token',
    });
    vi.spyOn(reviewApi, 'generateReview').mockResolvedValue({
      reviewDraft: 'Great hair studio, very clean stations and friendly staff.',
      wordCount: 10,
      sentiment: 'positive',
    });

    // Simulate Clipboard API permission denial
    vi.spyOn(clipboardModule, 'copyReviewDraftWithTelemetry').mockResolvedValue({
      success: false,
      code: 'NOT_ALLOWED',
      message: 'Clipboard write permission was denied by the browser.',
    });

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });

    // Accept & Copy
    await user.click(screen.getByRole('button', { name: /Accept & Copy Draft →/i }));

    // Handoff Page renders with Manual-Copy Fallback Notice (not success banner!)
    await waitFor(() => {
      expect(screen.getByText(/Manual Copy Required/i)).toBeInTheDocument();
      expect(screen.getByText(/Automatic clipboard copy was restricted/i)).toBeInTheDocument();
    });

    // Verified: Manual selectable text area is present with review draft
    const manualTextarea = screen.getByRole('textbox', { name: /Customer review draft to copy manually/i });
    expect(manualTextarea).toHaveValue('Great hair studio, very clean stations and friendly staff.');
    expect(manualTextarea).toHaveAttribute('readonly');

    // Customer can still proceed to Google Maps
    expect(screen.getByRole('button', { name: /Open Google Maps to Post →/i })).toBeInTheDocument();
  });

  // ==========================================================================
  // 8. Stale Response Protection & Navigation Safety
  // ==========================================================================
  it('discards late generation responses when customer has navigated away or composed manually', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-stale',
      submissionToken: 'resp-uuid-stale.token',
    });

    // Create a delayed generation promise that we can resolve on demand
    let resolveGeneration: (res: reviewApi.GenerateReviewResponse) => void;
    const delayedGenerationPromise = new Promise<reviewApi.GenerateReviewResponse>((resolve) => {
      resolveGeneration = resolve;
    });

    vi.spyOn(reviewApi, 'generateReview').mockImplementation(() => delayedGenerationPromise);

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    // Start generation (in-flight shimmer active)
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Analyzing your feedback...')).toBeInTheDocument();
    });

    // Customer does not want to wait; uses direct Google bypass from shimmer screen
    const directGoogleBtn = screen.getByRole('button', { name: /Review on Google Maps ↗/i });
    expect(directGoogleBtn).toBeInTheDocument();
    await user.click(directGoogleBtn);

    expect(window.open).toHaveBeenCalledWith(
      'https://search.google.com/local/writereview?placeid=ChIJ12345',
      '_blank',
      'noopener,noreferrer',
    );

    // Now resolve late generation promise
    resolveGeneration!({
      reviewDraft: 'Belated review draft text that arrived too late.',
      wordCount: 8,
      sentiment: 'positive',
    });

    // Shimmer transitions safely to editor
    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 9. Draft Regeneration Lifecycle and Preservation
  // ==========================================================================
  it('allows eligible draft regeneration and preserves previous draft on regeneration failure', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-regen',
      submissionToken: 'resp-uuid-regen.token',
    });

    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview')
      .mockResolvedValueOnce({
        reviewDraft: 'Initial draft: Very clean salon and welcoming hospitality.',
        wordCount: 8,
        sentiment: 'positive',
      })
      .mockRejectedValueOnce(new reviewApi.ApiClientError('Timeout on regen', 504, 'ERR_GEMINI_TIMEOUT'));

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox', { name: /Edit your review draft/i });
    expect(textarea).toHaveValue('Initial draft: Very clean salon and welcoming hospitality.');

    // Customer clicks regenerate
    const regenBtn = screen.getByRole('button', { name: /Regenerate Suggestion ↻/i });
    await user.click(regenBtn);

    // Generation was called for regeneration
    expect(generateReviewSpy).toHaveBeenCalledTimes(2);

    // Because regeneration failed, previous draft remains safely preserved!
    expect(textarea).toHaveValue('Initial draft: Very clean salon and welcoming hospitality.');

    // Regeneration limit reached
    expect(screen.getByRole('button', { name: /Regeneration limit reached/i })).toBeDisabled();
  });

  // ==========================================================================
  // 10. Fallback Routing: Expired Token (HTTP 401 ERR_TOKEN_EXPIRED)
  // ==========================================================================
  it('routes HTTP 401 expired token to token expired fallback without leaking credentials', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-expired',
      submissionToken: 'resp-uuid-expired.token',
    });

    vi.spyOn(reviewApi, 'generateReview').mockRejectedValue(
      new reviewApi.ApiClientError(
        'Survey submission token has expired.',
        401,
        'ERR_TOKEN_EXPIRED',
        'corr_expired_001',
        false,
      ),
    );

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    // Token Expired Fallback
    await waitFor(() => {
      expect(screen.getByText('Submission Session Expired')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeInTheDocument();
    });

    // Customer can navigate back to survey
    const backBtn = screen.getByRole('button', { name: /Back to Quick Survey/i });
    expect(backBtn).toBeInTheDocument();
    await user.click(backBtn);

    await waitFor(() => {
      expect(screen.getByText('How was your haircut today?')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 11. Concurrency Conflict (HTTP 409 ERR_CONCURRENT_REQUEST)
  // ==========================================================================
  it('routes HTTP 409 concurrency conflict safely to conflict recovery card without second provider call', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-conflict',
      submissionToken: 'resp-uuid-conflict.token',
    });

    vi.spyOn(reviewApi, 'generateReview').mockRejectedValue(
      new reviewApi.ApiClientError(
        'A generation request is currently active for this session.',
        409,
        'ERR_CONCURRENT_REQUEST',
        'corr_conflict_001',
        true,
      ),
    );

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Request Already in Progress')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 12. Privacy Verification: Zero Token or Review Draft Persistence
  // ==========================================================================
  it('strictly verifies zero submission tokens, HMAC signatures, or review drafts are persisted in browser storage or URLs', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-priv',
      submissionToken: 'resp-uuid-priv.1730000000.secret_hmac_signature',
    });
    vi.spyOn(reviewApi, 'generateReview').mockResolvedValue({
      reviewDraft: 'Top tier salon service, confidential customer experience.',
      wordCount: 7,
      sentiment: 'positive',
    });
    vi.spyOn(clipboardModule, 'copyReviewDraftWithTelemetry').mockResolvedValue({
      success: true,
    });

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Draft My Review with AI ↗/i }));

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });

    // Accept & Copy
    await user.click(screen.getByRole('button', { name: /Accept & Copy Draft →/i }));

    await waitFor(() => {
      expect(screen.getByText('Review copied to your clipboard!')).toBeInTheDocument();
    });

    // Verify localStorage has NO tokens or draft text
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      const val = localStorage.getItem(key) ?? '';
      expect(val).not.toContain('secret_hmac_signature');
      expect(val).not.toContain('confidential customer experience');
    }

    // Verify sessionStorage has NO tokens or draft text
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? '';
      const val = sessionStorage.getItem(key) ?? '';
      expect(val).not.toContain('secret_hmac_signature');
      expect(val).not.toContain('confidential customer experience');
    }

    // Verify URL does not contain token or review draft
    expect(window.location.search).not.toContain('secret_hmac_signature');
    expect(window.location.search).not.toContain('confidential customer experience');
  });

  // ==========================================================================
  // 13. Rapid Tap Concurrency Guard on AI Draft Trigger
  // ==========================================================================
  it('prevents multiple dispatches when patron taps Draft My Review with AI rapidly', async () => {
    const user = userEvent.setup();

    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);
    vi.spyOn(surveyApi, 'submitFeedback').mockResolvedValue({
      status: 'recorded',
      responseId: 'resp-uuid-doubleclick',
      submissionToken: 'resp-uuid-doubleclick.token',
    });

    let resolveGen: (res: reviewApi.GenerateReviewResponse) => void;
    const pendingGen = new Promise<reviewApi.GenerateReviewResponse>((resolve) => {
      resolveGen = resolve;
    });
    const generateReviewSpy = vi.spyOn(reviewApi, 'generateReview').mockImplementation(() => pendingGen);

    renderCustomerJourney();

    await waitFor(() => expect(screen.getByText('Artisan Hair Studio')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }));

    await waitFor(() => expect(screen.getByText('How was your haircut today?')).toBeInTheDocument());
    await user.click(screen.getByText(/Masterful & Precise/i));
    await user.click(screen.getByRole('button', { name: /Next to question 2/i }));

    await waitFor(() => expect(screen.getByText('How was the staff hospitality?')).toBeInTheDocument());
    await user.click(screen.getByText(/Warm & Attentive team/i));
    await user.click(screen.getByRole('button', { name: /Next to question 3/i }));

    await waitFor(() => expect(screen.getByText('What stood out most about your visit?')).toBeInTheDocument());
    await user.click(screen.getByText(/Clean & hygienic station/i));
    await user.click(screen.getByRole('button', { name: /Next.*optional note/i }));

    await waitFor(() => expect(screen.getByText(/Add an Optional Note|Anything else/i)).toBeInTheDocument());
    await user.click(screen.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }));
    await user.click(screen.getByRole('button', { name: /Submit Feedback/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeInTheDocument();
    });

    const aiDraftBtn = screen.getByRole('button', { name: /Draft My Review with AI ↗/i });

    // Rapid double click
    await user.click(aiDraftBtn);
    await user.click(aiDraftBtn);

    // Verified: generateReview called exactly ONCE
    expect(generateReviewSpy).toHaveBeenCalledTimes(1);

    // Resolve pending generation
    resolveGen!({
      reviewDraft: 'High quality cut and friendly service.',
      wordCount: 6,
      sentiment: 'positive',
    });

    await waitFor(() => {
      expect(screen.getByText('Your Review Draft')).toBeInTheDocument();
    });
  });
});
