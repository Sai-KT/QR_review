/**
 * AnalyticsPage Integration Tests (/dashboard/analytics — SCR-OWN-09)
 *
 * Source: docs/UI_UX.md (v1.1) §9.4; docs/ROADMAP.md (v1.1) Task M5-T08; API-OWN-04
 *
 * Verifies:
 * - Loading skeleton while merchant auth / business profile is loading.
 * - Missing business profile fallback with redirection button.
 * - Successful fetching and rendering of funnel metrics for default 30d period.
 * - Metric summary cards (6 cards) rendering exact values.
 * - Mandatory Google Review Attribution Safeguard notice and zero claims of confirmed reviews.
 * - Period selector switching (7d, 30d, 90d, all) and re-fetching.
 * - Empty state when qrVisits is 0 with link to /dashboard/qr.
 * - Error state handling with Retry button.
 * - Secondary monthly quota ledger context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnalyticsPage } from './AnalyticsPage';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { fetchOwnerDashboard } from '../../lib/api/merchant';
import type { Business, OwnerDashboardResponse } from '../../types/domain';
import {
  CANONICAL_ATTRIBUTION_DISCLAIMER,
  CANONICAL_GOOGLE_HANDOFF_DISCLAIMER,
} from '../../lib/adapters/analytics';

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../hooks/useMerchantAuth', () => ({
  useMerchantAuth: vi.fn(),
}));

vi.mock('../../lib/api/merchant', () => ({
  fetchOwnerDashboard: vi.fn(),
}));

const MOCK_BUSINESS: Business = {
  id: 'b1111111-1111-4111-8111-111111111111',
  ownerId: 'u1111111-1111-4111-8111-111111111111',
  categoryId: 'salon',
  publicQrId: 'luxe000001',
  vanitySlug: 'luxe-salon',
  name: 'Luxe Salon',
  logoUrl: 'https://example.com/logo.png',
  googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
  whatsappNumber: '+919876543210',
  accountStatus: 'active',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const MOCK_DASHBOARD_DATA: OwnerDashboardResponse = {
  businessId: 'b1111111-1111-4111-8111-111111111111',
  period: '30d',
  metrics: {
    qrVisits: 100,
    qrPageViews: 100,
    surveysCompleted: 70,
    surveyCompletionRate: 0.7,
    completionRate: 0.7,
    reviewsDrafted: 50,
    generationsSuccess: 50,
    generationsRequested: 60,
    draftSuccessRate: 0.7143,
    clipboardCopies: 40,
    copySuccess: 40,
    copyRate: 0.8,
    googleHandoffClicks: 30,
    googleRedirectClicks: 30,
    handoffRate: 0.75,
    assistedHandoffRate: 0.75,
    directBypassClicks: 10,
    directBypassRate: 0.1,
    totalHandoffRate: 0.4,
  },
  funnel: {
    qrVisits: 100,
    qrPageViews: 100,
    surveysCompleted: 70,
    surveyCompletionRate: 0.7,
    completionRate: 0.7,
    reviewsDrafted: 50,
    generationsSuccess: 50,
    generationsRequested: 60,
    draftSuccessRate: 0.7143,
    clipboardCopies: 40,
    copySuccess: 40,
    copyRate: 0.8,
    googleHandoffClicks: 30,
    googleRedirectClicks: 30,
    handoffRate: 0.75,
    assistedHandoffRate: 0.75,
    directBypassClicks: 10,
    directBypassRate: 0.1,
    totalHandoffRate: 0.4,
  },
  quota: {
    billingCycle: '2026-10',
    monthlyQuotaLimit: 150,
    generationsUsed: 84,
    generationsRemaining: 66,
    resetDate: '2026-11-01T00:00:00Z',
  },
  disclaimer: CANONICAL_ATTRIBUTION_DISCLAIMER,
};

describe('AnalyticsPage Component (/dashboard/analytics — SCR-OWN-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders auth loading skeleton while merchant auth is loading', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: true,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    render(<AnalyticsPage />);
    expect(screen.getByTestId('analytics-auth-loading')).toBeInTheDocument();
  });

  it('renders fallback when merchant business profile is missing', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    render(<AnalyticsPage />);
    expect(screen.getByTestId('analytics-no-business')).toBeInTheDocument();
    expect(screen.getByText('No Business Profile Found')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Go to Profile Settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profile');
  });

  it('successfully fetches and renders funnel metrics on default 30d period', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    vi.mocked(fetchOwnerDashboard).mockResolvedValue({
      data: MOCK_DASHBOARD_DATA,
      error: null,
    });

    render(<AnalyticsPage />);

    expect(fetchOwnerDashboard).toHaveBeenCalledWith({
      businessId: MOCK_BUSINESS.id,
      period: '30d',
    });

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    // Header & copy
    expect(screen.getByText('Funnel Analytics & Conversion Attribution')).toBeInTheDocument();
    expect(
      screen.getByText(/Landing page visits can originate from physical QR scans/i),
    ).toBeInTheDocument();

    // 6 Metric Summary Cards
    expect(screen.getByTestId('metric-qr-visits')).toHaveTextContent('100');
    expect(screen.getByTestId('metric-surveys-completed')).toHaveTextContent('70');
    expect(screen.getByTestId('metric-reviews-drafted')).toHaveTextContent('50');
    expect(screen.getByTestId('metric-clipboard-copies')).toHaveTextContent('40');
    expect(screen.getByTestId('metric-google-handoffs')).toHaveTextContent('30');
    expect(screen.getByTestId('metric-direct-bypasses')).toHaveTextContent('10');

    // Attribution Notices
    expect(screen.getByTestId('page-attribution-notice')).toBeInTheDocument();
    expect(screen.getAllByText(CANONICAL_ATTRIBUTION_DISCLAIMER).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(CANONICAL_GOOGLE_HANDOFF_DISCLAIMER).length).toBeGreaterThanOrEqual(1);

    // Secondary Quota Context Card
    expect(screen.getByTestId('quota-context-card')).toBeInTheDocument();
    expect(screen.getByText('Monthly AI Generation Quota:')).toBeInTheDocument();
    expect(screen.getByText('Cycle 2026-10')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
    expect(screen.getByText('/ 150 used')).toBeInTheDocument();
    expect(screen.getByText('66 remaining')).toBeInTheDocument();
  });

  it('allows period switching (7d, 90d, all) and triggers re-fetch', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    vi.mocked(fetchOwnerDashboard).mockResolvedValue({
      data: MOCK_DASHBOARD_DATA,
      error: null,
    });

    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    // Default period button is 30d
    const btn30d = screen.getByTestId('period-btn-30d');
    expect(btn30d).toHaveAttribute('aria-pressed', 'true');

    // Switch to 7d
    const btn7d = screen.getByTestId('period-btn-7d');
    fireEvent.click(btn7d);

    await waitFor(() => {
      expect(fetchOwnerDashboard).toHaveBeenCalledWith({
        businessId: MOCK_BUSINESS.id,
        period: '7d',
      });
    });

    // Switch to all
    const btnAll = screen.getByTestId('period-btn-all');
    fireEvent.click(btnAll);

    await waitFor(() => {
      expect(fetchOwnerDashboard).toHaveBeenCalledWith({
        businessId: MOCK_BUSINESS.id,
        period: 'all',
      });
    });
  });

  it('renders empty state banner when qrVisits is 0 and links to /dashboard/qr', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    const zeroDashboardData: OwnerDashboardResponse = {
      ...MOCK_DASHBOARD_DATA,
      metrics: {
        ...MOCK_DASHBOARD_DATA.metrics,
        qrVisits: 0,
        qrPageViews: 0,
        surveysCompleted: 0,
        reviewsDrafted: 0,
        clipboardCopies: 0,
        googleHandoffClicks: 0,
        directBypassClicks: 0,
      },
    };

    vi.mocked(fetchOwnerDashboard).mockResolvedValue({
      data: zeroDashboardData,
      error: null,
    });

    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-empty-state')).toBeInTheDocument();
    });

    expect(screen.getByText('No Visitor Activity in this Period')).toBeInTheDocument();

    const goToQrBtn = screen.getByTestId('empty-go-to-qr-btn');
    fireEvent.click(goToQrBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/qr');
  });

  it('handles error state and allows retry', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    vi.mocked(fetchOwnerDashboard).mockResolvedValueOnce({
      data: null,
      error: new Error('Failed to query analytics telemetry events'),
    });

    render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-error-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to load conversion analytics')).toBeInTheDocument();
    expect(screen.getByText('Failed to query analytics telemetry events')).toBeInTheDocument();

    // Now mock success for retry
    vi.mocked(fetchOwnerDashboard).mockResolvedValueOnce({
      data: MOCK_DASHBOARD_DATA,
      error: null,
    });

    const retryBtn = screen.getByTestId('analytics-retry-btn');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('metrics-summary-grid')).toBeInTheDocument();
    });
  });

  it('strictly preserves attribution safeguards with zero claims of published reviews', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
    } as unknown as ReturnType<typeof useMerchantAuth>);

    vi.mocked(fetchOwnerDashboard).mockResolvedValue({
      data: MOCK_DASHBOARD_DATA,
      error: null,
    });

    const { container } = render(<AnalyticsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('analytics-page')).toBeInTheDocument();
    });

    const pageText = container.textContent || '';
    expect(pageText).not.toContain('Published Reviews');
    expect(pageText).not.toContain('Verified Reviews');
    expect(pageText).not.toContain('Confirmed Reviews');
    expect(pageText).not.toContain('Google Reviews Published');
  });
});
