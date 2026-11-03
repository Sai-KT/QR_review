import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoogleDestinationPage } from './GoogleDestinationPage';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import type { Business } from '../../types/domain';

vi.mock('../../hooks/useMerchantAuth', () => ({
  useMerchantAuth: vi.fn(),
}));

// Mock GoogleDestinationForm to keep page test focused
vi.mock('../../components/merchant/GoogleDestinationForm', () => ({
  GoogleDestinationForm: ({ business }: { business: Business }) => (
    <div data-testid="mock-destination-form">
      Destination form for {business.name}
    </div>
  ),
}));

const MOCK_BUSINESS: Business = {
  id: 'b0000000-0000-4000-8000-000000000001',
  ownerId: '00000000-0000-4000-8000-000000000002',
  categoryId: 'salon',
  publicQrId: 'luxe000001',
  vanitySlug: 'luxe-studio',
  name: 'Luxe Studio Unisex Salon',
  logoUrl: 'https://local.test/logos/luxe-studio.png',
  googlePlaceId: 'ChIJLUXE00000001',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
  whatsappNumber: '9876543210',
  accountStatus: 'active',
  isActive: true,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

describe('GoogleDestinationPage (SCR-OWN-05)', () => {
  const mockRefreshBusiness = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: MOCK_BUSINESS,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });
  });

  it('renders loading skeleton when fetching initial business context', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: true,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    render(<GoogleDestinationPage />);
    expect(screen.getByTestId('destination-loading-skeleton')).toBeInTheDocument();
  });

  it('renders error state when error is present', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: false,
      error: 'Failed to load merchant profile',
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    render(<GoogleDestinationPage />);
    expect(screen.getByText('Unable to Load Business Context')).toBeInTheDocument();
    expect(screen.getByText('Failed to load merchant profile')).toBeInTheDocument();
  });

  it('renders fallback error message when business is null without explicit error', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      business: null,
      loading: false,
      error: null,
      session: null,
      user: null,
      signOut: vi.fn(),
      refreshBusiness: mockRefreshBusiness,
    });

    render(<GoogleDestinationPage />);
    expect(screen.getByText('Unable to Load Business Context')).toBeInTheDocument();
    expect(
      screen.getByText('No merchant business profile found for this authenticated account.')
    ).toBeInTheDocument();
  });

  it('renders destination header and form when business context is loaded', () => {
    render(<GoogleDestinationPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Google Review Destination' })).toBeInTheDocument();
    expect(screen.getByText('Luxe Studio Unisex Salon')).toBeInTheDocument();
    expect(screen.getByTestId('mock-destination-form')).toBeInTheDocument();
  });
});

