/**
 * DigitalQRPage Integration Tests (/dashboard/qr — SCR-OWN-06)
 *
 * Source: docs/UI_UX.md (v1.1) §9.1; docs/ROADMAP.md (v1.1) Task M5-T06
 *
 * Verifies:
 * - Loading skeleton while merchant auth / business profile is loading.
 * - Error boundary / message when business profile is missing or errors.
 * - Successful rendering of page header, DigitalQRPreviewCard, and best practices.
 * - Clean context switching when authenticated tenant changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DigitalQRPage } from './DigitalQRPage';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import type { Business } from '../../types/domain';

vi.mock('../../hooks/useMerchantAuth', () => ({
  useMerchantAuth: vi.fn(),
}));

vi.mock('../../components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const MOCK_SALON: Business = {
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

const MOCK_CAFE: Business = {
  id: 'b2222222-2222-4222-8222-222222222222',
  ownerId: 'u2222222-2222-4222-8222-222222222222',
  categoryId: 'cafe',
  publicQrId: 'cafe000002',
  vanitySlug: 'roasted-bean',
  name: 'Roasted Bean Cafe',
  logoUrl: null,
  googlePlaceId: 'ChIJcafe1234567890',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJcafe1234567890',
  whatsappNumber: '+919876543211',
  accountStatus: 'active',
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('M5-T06: DigitalQRPage (/dashboard/qr — SCR-OWN-06)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arcTo: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      clip: vi.fn(),
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  it('renders skeleton shimmer when auth context is loading', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: true,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(<DigitalQRPage />);
    expect(screen.getByTestId('digital-qr-loading-skeleton')).toBeInTheDocument();
  });

  it('renders error card when merchant business profile fails to load', () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: false,
      error: 'Network connection dropped',
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(<DigitalQRPage />);
    expect(screen.getByTestId('digital-qr-error-card')).toBeInTheDocument();
    expect(screen.getByText('Unable to Load Business Context')).toBeInTheDocument();
    expect(screen.getByText('Network connection dropped')).toBeInTheDocument();
  });

  it('renders complete Digital QR Studio for authenticated salon merchant', async () => {
    vi.mocked(useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: MOCK_SALON,
      loading: false,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    render(<DigitalQRPage />);

    expect(screen.getByText('Digital QR & Sharing Studio')).toBeInTheDocument();
    expect(screen.getByTestId('qr-business-name')).toHaveTextContent('Luxe Salon');
    expect(screen.getByText('luxe000001')).toBeInTheDocument();
    expect(screen.getByText('Best Practices for Local In-Store Review Collection')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('digital-qr-canvas')).toBeInTheDocument();
    });
  });

  it('updates display and QR ID when switching merchant tenant context', async () => {
    // First tenant: Salon
    vi.mocked(useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: MOCK_SALON,
      loading: false,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    const { rerender } = render(<DigitalQRPage />);
    expect(screen.getByTestId('qr-business-name')).toHaveTextContent('Luxe Salon');
    expect(screen.getByText('luxe000001')).toBeInTheDocument();

    // Tenant Switch: Cafe
    vi.mocked(useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: MOCK_CAFE,
      loading: false,
      error: null,
      signOut: vi.fn(),
      refreshBusiness: vi.fn(),
    });

    rerender(<DigitalQRPage />);
    await waitFor(() => {
      expect(screen.getByTestId('qr-business-name')).toHaveTextContent('Roasted Bean Cafe');
    });
    expect(screen.getByText('cafe000002')).toBeInTheDocument();
    expect(screen.queryByText('luxe000001')).not.toBeInTheDocument();
  });
});
