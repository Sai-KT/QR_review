/**
 * Tests for FeedbackFeedPage (SCR-OWN-08)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { FeedbackFeedPage, calculateDateRangeBounds } from './FeedbackFeedPage';
import * as merchantAuthHook from '../../hooks/useMerchantAuth';
import * as merchantApi from '../../lib/api/merchant';
import type { CustomerFeedback } from '../../lib/adapters/feedback';
import type { Business } from '../../types/domain';

// Mock merchant auth hook
vi.mock('../../hooks/useMerchantAuth', () => ({
  useMerchantAuth: vi.fn(),
}));

// Mock merchant API calls
vi.mock('../../lib/api/merchant', async (importOriginal) => {
  const actual = await importOriginal<typeof merchantApi>();
  return {
    ...actual,
    fetchMerchantFeedback: vi.fn(),
    fetchSurveyOptionsMap: vi.fn(),
    fetchSurveyQuestionsMap: vi.fn(),
  };
});

describe('calculateDateRangeBounds', () => {
  it('returns empty bounds for "all"', () => {
    expect(calculateDateRangeBounds('all')).toEqual({});
  });

  it('returns valid ISO date strings for 7d preset', () => {
    const bounds = calculateDateRangeBounds('7d');
    expect(bounds.startDate).toBeDefined();
    expect(bounds.endDate).toBeDefined();
    expect(bounds.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bounds.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns custom bounds when provided', () => {
    const bounds = calculateDateRangeBounds('custom', '2026-10-01', '2026-10-15');
    expect(bounds.startDate).toBe('2026-10-01');
    expect(bounds.endDate).toBe('2026-10-15');
  });
});

describe('FeedbackFeedPage (SCR-OWN-08)', () => {
  const mockBusiness: Business = {
    id: 'b-001',
    ownerId: 'owner-001',
    name: 'Luxe Studio',
    categoryId: 'salon',
    publicQrId: 'luxe000001',
    vanitySlug: 'luxe-studio',
    logoUrl: null,
    googlePlaceId: 'ChIJ123',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ123',
    whatsappNumber: null,
    accountStatus: 'active',
    isActive: true,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  const sampleFeedbackPositive: CustomerFeedback = {
    id: 'f-1',
    businessId: 'b-001',
    categoryId: 'salon',
    selectedOptions: [{ questionId: 'q-1', optionId: 'opt-pos' }],
    affirmedFactsSnapshot: ['Expert Cut'],
    optionalNote: 'Loved my new haircut so much!',
    sessionUuid: 's-1',
    purgedAt: null,
    createdAt: '2026-10-25T10:00:00Z',
    authenticityConfirmed: true,
  };

  const sampleFeedbackCritical: CustomerFeedback = {
    id: 'f-2',
    businessId: 'b-001',
    categoryId: 'salon',
    selectedOptions: [{ questionId: 'q-1', optionId: 'opt-neg' }],
    affirmedFactsSnapshot: ['Rushed Service'],
    optionalNote: 'Waited 30 minutes past my appointment time.',
    sessionUuid: 's-2',
    purgedAt: null,
    createdAt: '2026-10-24T12:00:00Z',
    authenticityConfirmed: true,
  };

  const sampleFeedbackPurged: CustomerFeedback = {
    id: 'f-3',
    businessId: 'b-001',
    categoryId: 'salon',
    selectedOptions: [{ questionId: 'q-1', optionId: 'opt-pos' }],
    affirmedFactsSnapshot: ['Clean salon'],
    optionalNote: null,
    sessionUuid: 's-3',
    purgedAt: '2026-11-25T10:00:00Z',
    createdAt: '2026-10-20T08:00:00Z',
    authenticityConfirmed: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: mockBusiness,
      session: null,
      user: null,
      loading: false,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    vi.mocked(merchantApi.fetchSurveyOptionsMap).mockResolvedValue({
      data: new Map([
        [
          'opt-pos',
          {
            id: 'opt-pos',
            questionId: 'q-1',
            optionText: 'Expert Cut',
            emojiAnchor: '✂️',
            sentimentLabel: 'positive',
            isNeutralNa: false,
          },
        ],
        [
          'opt-neg',
          {
            id: 'opt-neg',
            questionId: 'q-1',
            optionText: 'Rushed Service',
            emojiAnchor: '⏳',
            sentimentLabel: 'negative',
            isNeutralNa: false,
          },
        ],
      ]),
      error: null,
    });

    vi.mocked(merchantApi.fetchSurveyQuestionsMap).mockResolvedValue(
      new Map([['q-1', { id: 'q-1', questionText: 'Haircut Quality', displayOrder: 1 }]]),
    );
  });

  it('renders auth loading skeleton when business is loading', () => {
    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: null,
      session: null,
      user: null,
      loading: true,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('feedback-feed-auth-skeleton')).toBeInTheDocument();
  });

  it('renders auth error card when merchant context fails to load', () => {
    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: null,
      session: null,
      user: null,
      loading: false,
      error: 'Tenant authorization failed.',
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('feedback-feed-error-card')).toBeInTheDocument();
    expect(screen.getByText('Tenant authorization failed.')).toBeInTheDocument();
  });

  it('renders empty state directing to Digital QR Studio when no feedback records exist', async () => {
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValue({
      data: [],
      totalCount: 0,
      error: null,
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('feedback-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No Customer Feedback Yet')).toBeInTheDocument();
    expect(screen.getByTestId('btn-empty-open-qr')).toBeInTheDocument();
  });

  it('renders customer feedback stream with metrics and note privacy indicators', async () => {
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValue({
      data: [sampleFeedbackPositive, sampleFeedbackCritical, sampleFeedbackPurged],
      totalCount: 3,
      error: null,
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('feedback-feed-page')).toBeInTheDocument();
    });

    // Check Metrics Strip
    expect(screen.getByTestId('metric-total-feedback')).toHaveTextContent('3');
    expect(screen.getByTestId('metric-positive-feedback')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-critical-feedback')).toHaveTextContent('1');

    // Check Feedback Items
    expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
    expect(
      screen.getByText('“Waited 30 minutes past my appointment time.”'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('[Personal note expired per privacy policy]'),
    ).toBeInTheDocument();
  });

  it('filters feedbacks when clicking a sentiment filter tab', async () => {
    const user = userEvent.setup();
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValue({
      data: [sampleFeedbackPositive, sampleFeedbackCritical],
      totalCount: 2,
      error: null,
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
    });

    // Click Critical tab
    const criticalTab = screen.getByTestId('sentiment-tab-critical');
    await user.click(criticalTab);

    // Only critical feedback remains
    expect(
      screen.getByText('“Waited 30 minutes past my appointment time.”'),
    ).toBeInTheDocument();
    expect(screen.queryByText('“Loved my new haircut so much!”')).not.toBeInTheDocument();
  });

  it('filters feedbacks via client search input', async () => {
    const user = userEvent.setup();
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValue({
      data: [sampleFeedbackPositive, sampleFeedbackCritical],
      totalCount: 2,
      error: null,
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('feedback-search-input');
    await user.type(searchInput, 'appointment');

    expect(
      screen.getByText('“Waited 30 minutes past my appointment time.”'),
    ).toBeInTheDocument();
    expect(screen.queryByText('“Loved my new haircut so much!”')).not.toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByTestId('feedback-clear-search-btn');
    await user.click(clearBtn);

    expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
  });

  it('shows no matches card when search yields 0 items', async () => {
    const user = userEvent.setup();
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValue({
      data: [sampleFeedbackPositive],
      totalCount: 1,
      error: null,
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('feedback-search-input');
    await user.type(searchInput, 'nonexistent keyword');

    expect(screen.getByTestId('feedback-no-matches')).toBeInTheDocument();

    // Reset filters
    const resetBtn = screen.getByTestId('btn-reset-filters');
    await user.click(resetBtn);

    expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
  });

  it('handles database query error and allows retry', async () => {
    const user = userEvent.setup();
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValueOnce({
      data: null,
      totalCount: 0,
      error: new Error('PostgREST connection failed'),
    });

    render(
      <MemoryRouter>
        <FeedbackFeedPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('feedback-query-error')).toBeInTheDocument();
    });
    expect(screen.getByText('PostgREST connection failed')).toBeInTheDocument();

    // Retry with success
    vi.mocked(merchantApi.fetchMerchantFeedback).mockResolvedValueOnce({
      data: [sampleFeedbackPositive],
      totalCount: 1,
      error: null,
    });

    const retryBtn = screen.getByTestId('btn-retry-feedback');
    await user.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('“Loved my new haircut so much!”')).toBeInTheDocument();
    });
  });
});
