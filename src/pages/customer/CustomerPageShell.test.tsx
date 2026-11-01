import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerPageShell } from './CustomerPageShell';
import * as publicApi from '../../lib/api/public';
import * as surveyApi from '../../lib/api/survey';
import type { PublicBusinessProjection } from '../../types/domain';

const mockUseParams = vi.fn();
const mockUseSearchParams = vi.fn().mockReturnValue([new URLSearchParams(), vi.fn()]);

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useSearchParams: () => mockUseSearchParams(),
  };
});

describe('CustomerPageShell Component (M3-T01 / SCR-CUST-01..14)', () => {
  const mockActiveBusiness: PublicBusinessProjection = {
    publicQrId: 'DEMO123456',
    name: 'Green Salon & Spa',
    logoUrl: 'https://cdn.example.com/logo.png',
    categoryId: 'salon',
    googleReviewUrl: 'https://search.google.com/local/writereview?placeid=123',
    whatsappNumber: '9876543210',
    accountStatus: 'active',
    isActive: true,
    subscriptionStatus: 'active',
    isDirectGoogleOnly: false,
    isSuspended: false,
  };

  const mockSurveyQuestions: surveyApi.SurveyQuestionsDto = {
    categoryId: 'salon',
    surveyVersion: 'sv_test1234567890',
    questions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        displayOrder: 1,
        questionText: 'How was your hair service today?',
        options: [
          {
            id: 'aaaa1111-1111-4111-8111-111111111111',
            optionText: 'Masterful & Precise',
            emojiAnchor: '💇',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'aaaa2222-2222-4222-8222-222222222222',
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
        questionText: 'How was the hospitality & ambience?',
        options: [
          {
            id: 'bbbb1111-1111-4111-8111-111111111111',
            optionText: 'Welcoming & Relaxing',
            emojiAnchor: '✨',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'bbbb2222-2222-4222-8222-222222222222',
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
        questionText: 'Would you recommend this salon?',
        options: [
          {
            id: 'cccc1111-1111-4111-8111-111111111111',
            optionText: 'Definitely Yes',
            emojiAnchor: '🌟',
            sentiment: 'positive',
            isNeutralNa: false,
          },
          {
            id: 'cccc2222-2222-4222-8222-222222222222',
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
    mockUseParams.mockReturnValue({ qrId: 'DEMO123456' });
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()]);
  });

  it('renders loading state initially while resolving public business', () => {
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockImplementation(
      () => new Promise(() => {}), // Pending forever
    );

    render(<CustomerPageShell />);

    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
    const busyCard = screen.getByRole('generic', { busy: true });
    expect(busyCard).toBeInTheDocument();
  });

  it('renders SCR-CUST-01 (Active Welcome Card) with store branding and anti-gating bypass', async () => {
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Green Salon & Spa')).toBeInTheDocument();
    });

    expect(screen.getByText(/^salon$/i)).toBeInTheDocument();
    expect(screen.getByAltText('Green Salon & Spa logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Message Manager on WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
  });

  it('transitions to survey flow when Start 30-Sec Review CTA is tapped', async () => {
    const user = userEvent.setup();
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(mockActiveBusiness);
    vi.spyOn(surveyApi, 'fetchSurveyQuestions').mockResolvedValue(mockSurveyQuestions);

    const searchParams = new URLSearchParams();
    const mockSetSearchParams = vi.fn().mockImplementation((newParams) => {
      searchParams.set('step', newParams.get('step'));
    });
    mockUseSearchParams.mockReturnValue([searchParams, mockSetSearchParams]);

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Green Salon & Spa')).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    await user.click(startButton);

    expect(mockSetSearchParams).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/Question 1 of 3/i)).toBeInTheDocument();
      expect(screen.getByText('How was your hair service today?')).toBeInTheDocument();
    });
  });

  it('renders SCR-CUST-14 (Direct-Only Mode) when subscription is past due', async () => {
    const directOnlyBusiness: PublicBusinessProjection = {
      ...mockActiveBusiness,
      subscriptionStatus: 'past_due',
      isDirectGoogleOnly: true,
    };
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockResolvedValue(directOnlyBusiness);

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Green Salon & Spa')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/We are currently collecting direct reviews on Google Maps/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open Google Maps to Review ↗/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /WhatsApp Manager/i })).toBeInTheDocument();
    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
  });

  it('renders SCR-CUST-13 (Suspended Business Notice) when account is suspended', async () => {
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockRejectedValue(
      new publicApi.ApiClientError(
        'This business account is currently suspended.',
        403,
        'ERR_BUSINESS_SUSPENDED',
        undefined,
        false,
        true,
      ),
    );

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Feedback Temporarily Unavailable')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Review collection for this location is currently paused/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Zero private data or account suspension details/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
  });

  it('renders SCR-CUST-12 (QR Code Not Recognized) on HTTP 404', async () => {
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockRejectedValue(
      new publicApi.ApiClientError(
        'The requested QR code or business was not found.',
        404,
        'ERR_QR_NOT_FOUND',
      ),
    );

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('QR Code Not Recognized')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/This QR code is not recognized or may have been mistyped/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search on Google Maps ↗/i })).toBeInTheDocument();
    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
  });

  it('renders generic error state and allows retry on network failure', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(publicApi, 'fetchPublicBusiness')
      .mockRejectedValueOnce(new Error('Network connection timeout'))
      .mockResolvedValueOnce(mockActiveBusiness);

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Review Portal')).toBeInTheDocument();
    });

    expect(screen.getByText('Network connection timeout')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Try Again/i });
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('Green Salon & Spa')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renders HTTP 429 (ERR_RATE_LIMITED) with retry and direct Google search bypass', async () => {
    vi.spyOn(publicApi, 'fetchPublicBusiness').mockRejectedValue(
      new publicApi.ApiClientError(
        'Too many requests. Please wait before scanning or refreshing again.',
        429,
        'ERR_RATE_LIMITED',
        undefined,
        true,
      ),
    );

    render(<CustomerPageShell />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load Review Portal')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Too many requests\. Please wait before scanning or refreshing again\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search on Google Maps ↗/i })).toBeInTheDocument();
    expect(screen.getByText(/Active QR token parameter: "DEMO123456"/i)).toBeInTheDocument();
  });
});
