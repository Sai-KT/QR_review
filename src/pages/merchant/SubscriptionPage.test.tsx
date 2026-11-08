/**
 * SubscriptionPage Component Unit Tests (SCR-OWN-10)
 *
 * Verifies TC-OWN-15, TC-OWN-16, API-OWN-06, API-OWN-09, Plan & Status Mappings,
 * Usage Warning Thresholds, and Manual Renewal Safeguards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubscriptionPage } from './SubscriptionPage';
import * as merchantAuthHook from '../../hooks/useMerchantAuth';
import * as merchantApi from '../../lib/api/merchant';
import type { Subscription, TenantQuota, Business } from '../../types/domain';

// Mock the hook and api modules
vi.mock('../../hooks/useMerchantAuth');
vi.mock('../../lib/api/merchant');

const MOCK_BUSINESS: Business = {
  id: 'b0000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000002',
  categoryId: 'salon',
  publicQrId: 'luxe000001',
  vanitySlug: 'luxe-studio',
  name: 'Luxe Studio Unisex Salon',
  logoUrl: 'https://local.test/logos/luxe.png',
  googlePlaceId: 'ChIJLUXE00000001',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
  whatsappNumber: '9876543210',
  accountStatus: 'active',
  isActive: true,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

const MOCK_ACTIVE_SUB: Subscription = {
  id: 'sub-luxe-01',
  businessId: 'b0000000-0000-4000-8000-000000000001',
  planTier: 'standard_recurring',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  currentPeriodStartsAt: '2026-10-24',
  currentPeriodEndsAt: '2026-11-23',
  billingCurrency: 'INR',
  lastPaymentAmount: 399.0,
  lastPaymentRecordedAt: '2026-10-24T20:50:07Z',
  paymentReference: 'UPI-REF-LUXE-001',
  createdAt: '2026-09-24T20:50:07Z',
  updatedAt: '2026-10-24T20:50:07Z',
};

const MOCK_PILOT_SUB: Subscription = {
  id: 'sub-daily-02',
  businessId: 'b0000000-0000-4000-8000-000000000002',
  planTier: 'setup_package',
  subscriptionStatus: 'pilot',
  trialEndsAt: '2026-11-12',
  currentPeriodStartsAt: '2026-10-29',
  currentPeriodEndsAt: '2026-11-28',
  billingCurrency: 'INR',
  lastPaymentAmount: 999.0,
  lastPaymentRecordedAt: '2026-10-28T20:50:07Z',
  paymentReference: 'UPI-REF-DAILY-001',
  createdAt: '2026-10-15T20:50:07Z',
  updatedAt: '2026-10-28T20:50:07Z',
};

const MOCK_QUOTA_LEDGER: TenantQuota[] = [
  {
    id: 'quota-002',
    businessId: 'b0000000-0000-4000-8000-000000000001',
    billingCycle: '2026-11',
    maxLimit: 150,
    usedCount: 84,
    reservedCount: 0,
    resetAt: '2026-12-01T00:00:00Z',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
    remainingCount: 66,
  },
  {
    id: 'quota-001',
    businessId: 'b0000000-0000-4000-8000-000000000001',
    billingCycle: '2026-10',
    maxLimit: 150,
    usedCount: 12,
    reservedCount: 0,
    resetAt: '2026-11-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-31T00:00:00Z',
    remainingCount: 138,
  },
];

describe('SubscriptionPage (SCR-OWN-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    vi.mocked(merchantApi.fetchMerchantSubscription).mockResolvedValue({
      data: MOCK_ACTIVE_SUB,
      error: null,
    });

    vi.mocked(merchantApi.fetchMerchantQuotaLedger).mockResolvedValue({
      data: MOCK_QUOTA_LEDGER,
      activeQuota: MOCK_QUOTA_LEDGER[0] ?? null,
      error: null,
    });
  });

  it('renders loading skeleton while authenticating', () => {
    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: null,
      loading: true,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(<SubscriptionPage />);

    expect(screen.getByTestId('subscription-loading-skeleton')).toBeInTheDocument();
  });

  it('renders auth error when merchant authentication fails', () => {
    vi.mocked(merchantAuthHook.useMerchantAuth).mockReturnValue({
      business: null,
      loading: false,
      error: 'Session expired. Please log in again.',
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(<SubscriptionPage />);

    expect(screen.getByTestId('subscription-auth-error')).toBeInTheDocument();
    expect(screen.getByText('Session expired. Please log in again.')).toBeInTheDocument();
  });

  it('TC-OWN-15 & TC-OWN-16: renders active subscription and quota ledger accurately', async () => {
    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('subscription-page')).toBeInTheDocument();
    });

    // 1. Subscription Details Card (TC-OWN-16)
    expect(screen.getByTestId('subscription-plan-name')).toHaveTextContent('Monthly Recurring Plan');
    expect(screen.getByTestId('subscription-status-badge')).toHaveTextContent('Active');
    expect(screen.getByTestId('sub-period-start')).toHaveTextContent(/24 Oct 2026/);
    expect(screen.getByTestId('sub-period-end')).toHaveTextContent(/23 Nov 2026/);

    // Payment Settlement Info
    expect(screen.getByTestId('sub-payment-amount')).toHaveTextContent('₹399.00');
    expect(screen.getByTestId('sub-payment-ref')).toHaveTextContent('UPI-REF-LUXE-001');

    // 2. Quota Meter Bar (TC-OWN-15)
    // used_count (84) + remaining (66) = 150
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('84');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('66 available');
    expect(screen.getByText('Cycle 2026-11')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    // 3. Billing Cycle History Table
    expect(screen.getByTestId('quota-history-table')).toBeInTheDocument();
    expect(screen.getByText('2026-10')).toBeInTheDocument();
  });

  it('renders pilot tier subscription details with trial expiration', async () => {
    vi.mocked(merchantApi.fetchMerchantSubscription).mockResolvedValue({
      data: MOCK_PILOT_SUB,
      error: null,
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('subscription-plan-name')).toHaveTextContent('Setup Package');
    });

    expect(screen.getByTestId('subscription-status-badge')).toHaveTextContent('Pilot Access');
    expect(screen.getByTestId('sub-trial-end')).toHaveTextContent(/12 Nov 2026/);
    expect(screen.getByTestId('sub-payment-amount')).toHaveTextContent('₹999.00');
    expect(screen.getByTestId('sub-payment-ref')).toHaveTextContent('UPI-REF-DAILY-001');
  });

  it('renders high usage warning when quota reaches >= 80%', async () => {
    const baseQuota = MOCK_QUOTA_LEDGER[0]!;
    const highUsageQuota: TenantQuota = {
      ...baseQuota,
      usedCount: 143, // 143 / 150 = 95%
      remainingCount: 7,
    };

    vi.mocked(merchantApi.fetchMerchantQuotaLedger).mockResolvedValue({
      data: [highUsageQuota],
      activeQuota: highUsageQuota,
      error: null,
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('quota-warning-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/Approaching Monthly Quota Limit \(95%\)/)).toBeInTheDocument();
    expect(screen.getByText('High Usage (≥80%)')).toBeInTheDocument();
  });

  it('renders quota exhausted alert when usedCount reaches maxLimit (150/150)', async () => {
    const baseQuota = MOCK_QUOTA_LEDGER[0]!;
    const exhaustedQuota: TenantQuota = {
      ...baseQuota,
      usedCount: 150,
      remainingCount: 0,
    };

    vi.mocked(merchantApi.fetchMerchantQuotaLedger).mockResolvedValue({
      data: [exhaustedQuota],
      activeQuota: exhaustedQuota,
      error: null,
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('quota-exhausted-banner')).toBeInTheDocument();
    });

    expect(screen.getByText(/Monthly AI Review Quota Reached/)).toBeInTheDocument();
    expect(screen.getByText('Quota Reached')).toBeInTheDocument();
  });

  it('handles missing subscription row honestly without crashing', async () => {
    vi.mocked(merchantApi.fetchMerchantSubscription).mockResolvedValue({
      data: null,
      error: null,
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('subscription-plan-name')).toHaveTextContent('No Subscription Record');
    });

    expect(screen.queryByTestId('sub-period-start')).not.toBeInTheDocument();
  });

  it('handles missing quota ledger honestly without crashing', async () => {
    vi.mocked(merchantApi.fetchMerchantQuotaLedger).mockResolvedValue({
      data: [],
      activeQuota: null,
      error: null,
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByText('No Active Quota Ledger')).toBeInTheDocument();
    });
  });

  it('surfaces fetch error with working retry trigger', async () => {
    vi.mocked(merchantApi.fetchMerchantSubscription).mockResolvedValue({
      data: null,
      error: new Error('PostgREST connection timeout'),
    });

    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('subscription-fetch-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/PostgREST connection timeout/)).toBeInTheDocument();

    // Click retry button
    const retryBtn = screen.getByTestId('error-retry-btn');
    fireEvent.click(retryBtn);

    expect(merchantApi.fetchMerchantSubscription).toHaveBeenCalledTimes(2);
  });

  it('opens and closes manual renewal inquiry modal', async () => {
    render(<SubscriptionPage />);

    await waitFor(() => {
      expect(screen.getByTestId('contact-founder-upgrade-btn')).toBeInTheDocument();
    });

    // Modal is initially not in document
    expect(screen.queryByTestId('inquiry-modal')).not.toBeInTheDocument();

    // Click contact button
    fireEvent.click(screen.getByTestId('contact-founder-upgrade-btn'));

    expect(screen.getByTestId('inquiry-modal')).toBeInTheDocument();
    expect(screen.getByText('Manual Renewal & Upgrades')).toBeInTheDocument();
    expect(screen.getByText(/Luxe Studio Unisex Salon/)).toBeInTheDocument();

    // Close modal
    fireEvent.click(screen.getByTestId('close-inquiry-modal'));
    expect(screen.queryByTestId('inquiry-modal')).not.toBeInTheDocument();
  });
});
