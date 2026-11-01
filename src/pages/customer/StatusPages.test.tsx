import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InvalidQrCard,
  SuspendedBusinessCard,
  DirectOnlyCard,
  OfflineRecoveryCard,
  OfflineConnectionBanner,
  RateLimitedCard,
  ServiceErrorCard,
} from './StatusPages';
import type { PublicBusinessProjection } from '../../types/domain';

describe('StatusPages Components (M3-T07 / SCR-CUST-12..15)', () => {
  const windowOpenSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.open = windowOpenSpy;
  });

  // --------------------------------------------------------------------------
  // 1. SCR-CUST-12: InvalidQrCard
  // --------------------------------------------------------------------------
  describe('SCR-CUST-12: InvalidQrCard', () => {
    it('renders friendly missing QR message without technical jargon', () => {
      render(<InvalidQrCard qrToken="badtoken99" />);

      expect(screen.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'This QR code is not recognized or may have been mistyped. Please verify the code with staff.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Active QR token parameter: "badtoken99"')).toBeInTheDocument();
    });

    it('does not leak internal database schemas, tenant UUIDs, or billing data', () => {
      const { container } = render(<InvalidQrCard qrToken="unknown123" />);
      const text = container.textContent || '';

      expect(text).not.toContain('table');
      expect(text).not.toContain('column');
      expect(text).not.toContain('schema');
      expect(text).not.toContain('PostgreSQL');
      expect(text).not.toContain('uuid');
      expect(text).not.toContain('subscription');
    });

    it('opens generic Google Maps search when Search on Google Maps button is clicked', async () => {
      const user = userEvent.setup();
      render(<InvalidQrCard qrToken="badtoken99" />);

      const searchBtn = screen.getByRole('button', { name: /Search on Google Maps ↗/i });
      await user.click(searchBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('triggers onRetry callback when Scan Again / Retry button is clicked', async () => {
      const user = userEvent.setup();
      const retrySpy = vi.fn();
      render(<InvalidQrCard qrToken="badtoken99" onRetry={retrySpy} />);

      const retryBtn = screen.getByRole('button', { name: /Scan Again \/ Retry/i });
      await user.click(retryBtn);

      expect(retrySpy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 2. SCR-CUST-13: SuspendedBusinessCard
  // --------------------------------------------------------------------------
  describe('SCR-CUST-13: SuspendedBusinessCard', () => {
    it('renders neutral paused notice and reassuring privacy statement', () => {
      render(<SuspendedBusinessCard qrToken="s8p4v2m1xx" />);

      expect(
        screen.getByRole('heading', { name: 'Feedback Temporarily Unavailable' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Review collection for this location is currently paused. Please speak directly with the team for assistance.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Zero private data or account suspension details are exposed to public patrons.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Active QR token parameter: "s8p4v2m1xx"')).toBeInTheDocument();
    });

    it('does not expose billing delinquency, admin decisions, or outbound links', () => {
      const { container } = render(<SuspendedBusinessCard qrToken="susp000001" />);
      const text = container.textContent || '';

      expect(text).not.toContain('delinquent');
      expect(text).not.toContain('unpaid');
      expect(text).not.toContain('suspended because');
      expect(text).not.toContain('admin');
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 3. SCR-CUST-14: DirectOnlyCard
  // --------------------------------------------------------------------------
  describe('SCR-CUST-14: DirectOnlyCard', () => {
    const directBusiness: PublicBusinessProjection = {
      publicQrId: 'lapse00001',
      name: 'Vintage Brews Cafe',
      logoUrl: 'https://local.test/logos/vintage-brews.png',
      categoryId: 'cafe',
      googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLAPSE0000001',
      whatsappNumber: '9876543213',
      accountStatus: 'active',
      isActive: true,
      subscriptionStatus: 'past_due',
      isDirectGoogleOnly: true,
      isSuspended: false,
    };

    it('renders verified merchant branding, category badge, and direct review message', () => {
      render(<DirectOnlyCard business={directBusiness} />);

      expect(screen.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeInTheDocument();
      expect(screen.getByText('Café')).toBeInTheDocument();
      expect(screen.getByAltText('Vintage Brews Cafe logo')).toBeInTheDocument();
      expect(
        screen.getByText(
          'We are currently collecting direct reviews on Google Maps. Thank you for your support!',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Open Google Maps to Review ↗' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'WhatsApp Manager' })).toBeInTheDocument();
    });

    it('opens validated Google review destination in a new tab', async () => {
      const user = userEvent.setup();
      render(<DirectOnlyCard business={directBusiness} />);

      const googleBtn = screen.getByRole('button', { name: 'Open Google Maps to Review ↗' });
      await user.click(googleBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://search.google.com/local/writereview?placeid=ChIJLAPSE0000001',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('falls back honestly to generic search when Google review URL is unconfigured or invalid', async () => {
      const user = userEvent.setup();
      const noGoogleBusiness: PublicBusinessProjection = {
        ...directBusiness,
        googleReviewUrl: null,
      };

      render(<DirectOnlyCard business={noGoogleBusiness} />);

      const searchBtn = screen.getByRole('button', { name: 'Search on Google Maps ↗' });
      await user.click(searchBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('opens international WhatsApp URL when WhatsApp button is clicked', async () => {
      const user = userEvent.setup();
      render(<DirectOnlyCard business={directBusiness} />);

      const waBtn = screen.getByRole('button', { name: 'WhatsApp Manager' });
      await user.click(waBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/wa\.me\/919876543213\?text=/),
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('renders monogram avatar fallback when logo is missing or errors', () => {
      const noLogoBusiness: PublicBusinessProjection = {
        ...directBusiness,
        logoUrl: null,
      };

      render(<DirectOnlyCard business={noLogoBusiness} />);

      expect(screen.getByText('VB')).toBeInTheDocument();
      expect(screen.queryByAltText(/logo/i)).not.toBeInTheDocument();
    });

    it('does not mention expired subscriptions or AI features', () => {
      const { container } = render(<DirectOnlyCard business={directBusiness} />);
      const text = container.textContent || '';

      expect(text).not.toContain('expired');
      expect(text).not.toContain('past due');
      expect(text).not.toContain('unpaid');
      expect(text).not.toContain('payment');
      expect(text).not.toContain('Start 30-Sec Review');
    });
  });

  // --------------------------------------------------------------------------
  // 4. SCR-CUST-15: OfflineRecoveryCard & OfflineConnectionBanner
  // --------------------------------------------------------------------------
  describe('SCR-CUST-15: OfflineRecoveryCard', () => {
    it('renders connection lost notice with answer preservation message when hasAnswers is true', () => {
      render(
        <OfflineRecoveryCard
          onRetry={vi.fn()}
          hasAnswers={true}
          cachedGoogleUrl="https://search.google.com/local/writereview?placeid=123"
        />,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Connection Lost' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Please check your internet connection. Your current answers are still here.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry Connection' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Open Google Maps Directly ↗' }),
      ).toBeInTheDocument();
    });

    it('renders initial load offline guidance when hasAnswers is false', () => {
      render(
        <OfflineRecoveryCard
          onRetry={vi.fn()}
          hasAnswers={false}
          cachedGoogleUrl={null}
        />,
      );

      expect(
        screen.getByText(
          'Please check your cellular data or Wi-Fi connection and tap below to retry.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search on Google Maps ↗' })).toBeInTheDocument();
    });

    it('calls onRetry when Retry Connection button is clicked', async () => {
      const user = userEvent.setup();
      const retrySpy = vi.fn();

      render(<OfflineRecoveryCard onRetry={retrySpy} />);

      const retryBtn = screen.getByRole('button', { name: 'Retry Connection' });
      await user.click(retryBtn);

      expect(retrySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('SCR-CUST-15: OfflineConnectionBanner', () => {
    it('renders sticky alert banner with retry action and cached Google Maps link', async () => {
      const user = userEvent.setup();
      const retrySpy = vi.fn();

      render(
        <OfflineConnectionBanner
          onRetry={retrySpy}
          cachedGoogleUrl="https://search.google.com/local/writereview?placeid=123"
        />,
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Connection Lost')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Please check your connection. Your current answers are safely retained.',
        ),
      ).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: 'Retry ↻' });
      await user.click(retryBtn);
      expect(retrySpy).toHaveBeenCalledTimes(1);

      const googleBtn = screen.getByRole('button', { name: 'Google Maps ↗' });
      await user.click(googleBtn);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://search.google.com/local/writereview?placeid=123',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. RateLimitedCard & ServiceErrorCard
  // --------------------------------------------------------------------------
  describe('RateLimitedCard (HTTP 429)', () => {
    it('renders too many requests notice and retry/search buttons', async () => {
      const user = userEvent.setup();
      const retrySpy = vi.fn();

      render(<RateLimitedCard onRetry={retrySpy} />);

      expect(
        screen.getByRole('heading', { name: 'Unable to Load Review Portal' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Too many requests. Please wait before scanning or refreshing again.'),
      ).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: 'Try Again' });
      await user.click(retryBtn);
      expect(retrySpy).toHaveBeenCalledTimes(1);

      const searchBtn = screen.getByRole('button', { name: 'Search on Google Maps ↗' });
      await user.click(searchBtn);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  describe('ServiceErrorCard (HTTP 500/503)', () => {
    it('renders sanitized service outage message without exposing stack traces', () => {
      render(
        <ServiceErrorCard
          onRetry={vi.fn()}
          errorMessage="A temporary service error occurred. Please check your connection and try again."
        />,
      );

      expect(
        screen.getByRole('heading', { name: 'Unable to Load Review Portal' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'A temporary service error occurred. Please check your connection and try again.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });
  });
});

