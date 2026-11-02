import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GenerationFallbacks,
  GenerationTimeoutCard,
  QuotaExhaustedCard,
  InsufficientFactsCard,
  RateLimitedNoticeCard,
  classifyGenerationError,
  isGenerationTimeoutError,
  isQuotaExhaustedError,
} from './GenerationFallbacks';
import type { PublicBusinessProjection } from '../../types/domain';
import * as analyticsModule from '../../lib/api/analytics';

const mockBusiness: PublicBusinessProjection = {
  name: 'Velvet Cuts & Cafe',
  publicQrId: 'velvet0001',
  categoryId: 'salon',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ987',
  whatsappNumber: '+91 98765 12345',
  logoUrl: 'https://cdn.example.com/velvet.png',
  isActive: true,
  isSuspended: false,
  isDirectGoogleOnly: false,
  subscriptionStatus: 'active',
  accountStatus: 'active',
};

describe('GenerationFallbacks Component Suite (M4-T08 / SCR-CUST-10 & SCR-CUST-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Error Classification & Boundaries (classifyGenerationError)            */
  /* -------------------------------------------------------------------------- */
  describe('classifyGenerationError & Boundary Helpers', () => {
    it('classifies HTTP 504 and ERR_GEMINI_TIMEOUT as timeout', () => {
      expect(classifyGenerationError({ status: 504, code: 'ERR_GEMINI_TIMEOUT' })).toBe('timeout');
      expect(classifyGenerationError({ code: 'ERR_GEMINI_TIMEOUT' })).toBe('timeout');
      expect(classifyGenerationError({ code: 'ERR_TIMEOUT' })).toBe('timeout');
      expect(classifyGenerationError({ status: 504 })).toBe('timeout');
      expect(isGenerationTimeoutError({ status: 504 })).toBe(true);
    });

    it('classifies retryable provider and network errors as timeout', () => {
      expect(classifyGenerationError({ code: 'ERR_PROVIDER_ERROR' })).toBe('timeout');
      expect(classifyGenerationError({ code: 'ERR_PROVIDER_RATE_LIMITED' })).toBe('timeout');
      expect(classifyGenerationError({ code: 'ERR_NETWORK_ERROR' })).toBe('timeout');
    });

    it('strictly classifies ERR_QUOTA_EXHAUSTED as quota_exhausted', () => {
      expect(classifyGenerationError({ status: 429, code: 'ERR_QUOTA_EXHAUSTED' })).toBe('quota_exhausted');
      expect(classifyGenerationError({ code: 'ERR_QUOTA_EXHAUSTED' })).toBe('quota_exhausted');
      expect(isQuotaExhaustedError({ code: 'ERR_QUOTA_EXHAUSTED' })).toBe(true);
    });

    it('classifies session/IP rate limits (ERR_RATE_LIMITED) as rate_limited, NEVER quota_exhausted', () => {
      expect(classifyGenerationError({ status: 429, code: 'ERR_RATE_LIMITED' })).toBe('rate_limited');
      expect(classifyGenerationError({ code: 'ERR_RATE_LIMITED' })).toBe('rate_limited');
      expect(classifyGenerationError({ status: 429 })).toBe('rate_limited');
      expect(isQuotaExhaustedError({ status: 429, code: 'ERR_RATE_LIMITED' })).toBe(false);
    });

    it('classifies concurrent requests (409 ERR_CONCURRENT_REQUEST) as conflict, NEVER timeout', () => {
      expect(classifyGenerationError({ status: 409, code: 'ERR_CONCURRENT_REQUEST' })).toBe('conflict');
      expect(classifyGenerationError({ code: 'ERR_IDEMPOTENCY_MISMATCH' })).toBe('conflict');
      expect(isGenerationTimeoutError({ status: 409, code: 'ERR_CONCURRENT_REQUEST' })).toBe(false);
    });

    it('classifies expired submission tokens (401 ERR_TOKEN_EXPIRED) as token_expired', () => {
      expect(classifyGenerationError({ status: 401, code: 'ERR_TOKEN_EXPIRED' })).toBe('token_expired');
      expect(classifyGenerationError({ code: 'ERR_SUBMISSION_EXPIRED' })).toBe('token_expired');
      expect(isGenerationTimeoutError({ status: 401, code: 'ERR_TOKEN_EXPIRED' })).toBe(false);
    });

    it('classifies abstained responses (M0-16 Insufficient Facts) as abstained', () => {
      expect(classifyGenerationError({ abstained: true, reason: 'INSUFFICIENT_FACTS' })).toBe('abstained');
      expect(classifyGenerationError({ reason: 'INSUFFICIENT_FACTS' })).toBe('abstained');
      expect(isGenerationTimeoutError({ abstained: true })).toBe(false);
      expect(isQuotaExhaustedError({ abstained: true })).toBe(false);
    });

    it('handles null, undefined, and unrecognized errors safely', () => {
      expect(classifyGenerationError(null)).toBe('generic_error');
      expect(classifyGenerationError(undefined)).toBe('generic_error');
      expect(classifyGenerationError({ code: 'UNKNOWN_CODE' })).toBe('generic_error');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. SCR-CUST-10: Generation Timeout & Single Eligible Retry                */
  /* -------------------------------------------------------------------------- */
  describe('SCR-CUST-10 Generation Timeout Card', () => {
    it('renders valid timeout state with reassuring non-technical message', () => {
      render(<GenerationTimeoutCard business={mockBusiness} />);

      expect(screen.getByTestId('generation-timeout-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /your review draft is taking longer than expected/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/we couldn't prepare a suggestion this time\. your feedback is still valuable/i),
      ).toBeInTheDocument();
      expect(screen.getByText('Velvet Cuts & Cafe')).toBeInTheDocument();
    });

    it('does NOT trigger generation automatically on component mount', () => {
      const onRetryMock = vi.fn();
      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      expect(onRetryMock).not.toHaveBeenCalled();
    });

    it('renders retry button when onRetry is provided and canRetry is true', () => {
      const onRetryMock = vi.fn();
      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} canRetry={true} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).toHaveTextContent(/retry generation/i);
    });

    it('omits retry button when onRetry callback is not provided', () => {
      render(<GenerationTimeoutCard business={mockBusiness} onRetry={undefined} />);

      expect(screen.queryByTestId('timeout-retry-button')).not.toBeInTheDocument();
      // Direct Google review button remains prominently available
      expect(screen.getByTestId('timeout-direct-google-button')).toBeInTheDocument();
    });

    it('disables retry button when canRetry is false', () => {
      const onRetryMock = vi.fn();
      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} canRetry={false} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');
      expect(retryBtn).toBeDisabled();
    });

    it('allows exactly one customer-triggered retry invocation', async () => {
      const onRetryMock = vi.fn().mockResolvedValue(undefined);
      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');
      await userEvent.click(retryBtn);

      expect(onRetryMock).toHaveBeenCalledTimes(1);

      // Subsequent state indicates retry limit reached
      await waitFor(() => {
        expect(screen.getByTestId('timeout-retry-disabled')).toBeInTheDocument();
      });
      expect(screen.getByTestId('timeout-retry-disabled')).toHaveTextContent(/retry limit reached/i);
      expect(screen.getByTestId('timeout-retry-disabled')).toBeDisabled();
    });

    it('prevents rapid double-click from dispatching multiple retry calls', async () => {
      let resolvePromise: () => void = () => {};
      const pendingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      const onRetryMock = vi.fn().mockReturnValue(pendingPromise);

      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');

      // Trigger two clicks in rapid succession within act
      await act(async () => {
        fireEvent.click(retryBtn);
        fireEvent.click(retryBtn);
      });

      expect(onRetryMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolvePromise();
      });
    });

    it('displays in-flight pending state with spinner and screen-reader announcement', async () => {
      let resolveRetry: () => void = () => {};
      const onRetryMock = vi.fn().mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveRetry = res;
          }),
      );

      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');
      await userEvent.click(retryBtn);

      // Verify in-flight pending button
      const spinnerBtn = screen.getByTestId('timeout-retry-spinner');
      expect(spinnerBtn).toBeInTheDocument();
      expect(spinnerBtn).toHaveTextContent(/retrying generation\.\.\./i);
      expect(spinnerBtn).toHaveAttribute('aria-busy', 'true');
      expect(spinnerBtn).toBeDisabled();

      // Verify live region announcement
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent(/retrying review draft generation, please wait\.\.\./i);

      // Resolve retry
      await act(async () => {
        resolveRetry();
      });
      await waitFor(() => {
        expect(screen.getByTestId('timeout-retry-disabled')).toBeInTheDocument();
      });
    });

    it('preserves retry allowance consumption even when retry operation fails (rejection)', async () => {
      const onRetryMock = vi.fn().mockRejectedValue(new Error('Second timeout failure'));

      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      const retryBtn = screen.getByTestId('timeout-retry-button');
      await userEvent.click(retryBtn);

      expect(onRetryMock).toHaveBeenCalledTimes(1);

      // Even on error, retry limit is preserved (cannot retry a second time)
      await waitFor(() => {
        expect(screen.getByTestId('timeout-retry-disabled')).toBeInTheDocument();
      });
      expect(screen.getByTestId('timeout-retry-disabled')).toBeDisabled();
    });

    it('preserves consumed retry state across component rerenders', async () => {
      const onRetryMock = vi.fn().mockResolvedValue(undefined);

      const { rerender } = render(
        <GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} className="initial" />,
      );

      const retryBtn = screen.getByTestId('timeout-retry-button');
      await userEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByTestId('timeout-retry-disabled')).toBeInTheDocument();
      });

      // Rerender with new prop
      rerender(
        <GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} className="rerendered" />,
      );

      // Retry allowance is not restored on rerender
      expect(screen.getByTestId('timeout-retry-disabled')).toBeInTheDocument();
      expect(screen.queryByTestId('timeout-retry-button')).not.toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. SCR-CUST-11: Monthly Quota Exhaustion Card                             */
  /* -------------------------------------------------------------------------- */
  describe('SCR-CUST-11 Monthly Quota Exhaustion Card', () => {
    it('renders clean monthly limit notice without internal accounting or secrets', () => {
      render(<QuotaExhaustedCard business={mockBusiness} />);

      expect(screen.getByTestId('quota-exhausted-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /ai review assistance is temporarily unavailable/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/this business has reached its monthly ai drafting limit/i),
      ).toBeInTheDocument();

      // Zero internal quota or billing secrets
      expect(screen.queryByText(/150/)).not.toBeInTheDocument();
      expect(screen.queryByText(/used_count/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/max_limit/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/subscription/i)).not.toBeInTheDocument();

      // Zero non-functional retry button
      expect(screen.queryByTestId('timeout-retry-button')).not.toBeInTheDocument();
      expect(screen.queryByText(/retry/i)).not.toBeInTheDocument();

      // Direct Google review button is front and center
      expect(screen.getByTestId('quota-direct-google-button')).toBeInTheDocument();
    });

    it('renders optional WhatsApp manager link when merchant phone is present', () => {
      render(<QuotaExhaustedCard business={mockBusiness} />);

      const waBtn = screen.getByTestId('quota-whatsapp-link');
      expect(waBtn).toBeInTheDocument();
      expect(waBtn).toHaveTextContent(/chat with manager on whatsapp/i);

      fireEvent.click(waBtn);
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining('wa.me/919876512345'),
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Insufficient Facts Card (M0-16 Grounding Policy)                       */
  /* -------------------------------------------------------------------------- */
  describe('Insufficient Facts Abstention (Founder Decision M0-16)', () => {
    it('renders neutral explanation without fabricated praise', () => {
      const onComposeMock = vi.fn();
      render(
        <InsufficientFactsCard
          business={mockBusiness}
          onComposeManually={onComposeMock}
        />,
      );

      expect(screen.getByTestId('insufficient-facts-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /we couldn't generate a specific review draft/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/we cannot generate a reliable draft from the provided information/i),
      ).toBeInTheDocument();

      const composeBtn = screen.getByTestId('insufficient-compose-manually-button');
      expect(composeBtn).toBeInTheDocument();
      fireEvent.click(composeBtn);
      expect(onComposeMock).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Rate-Limited Notice Card (Non-Quota 429)                               */
  /* -------------------------------------------------------------------------- */
  describe('RateLimitedNoticeCard (Session / NAT Rate Limiting)', () => {
    it('explains attempt limit without falsely claiming monthly quota exhaustion', () => {
      render(<RateLimitedNoticeCard business={mockBusiness} />);

      expect(screen.getByTestId('rate-limited-notice-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /too many generation requests/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/you have reached the maximum number of attempts for this session/i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/monthly ai drafting limit/i)).not.toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Direct Google Review Access & Universal Anti-Gating (Core Invariant #7) */
  /* -------------------------------------------------------------------------- */
  describe('Direct Google Review Navigation & Telemetry', () => {
    it('opens verified Google review URL in a new tab with security attributes', () => {
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({ status: 'accepted' });
      const onDirectGoogleMock = vi.fn();

      render(
        <GenerationTimeoutCard
          business={mockBusiness}
          onDirectGoogleClick={onDirectGoogleMock}
        />,
      );

      const googleBtn = screen.getByTestId('timeout-direct-google-button');
      fireEvent.click(googleBtn);

      expect(window.open).toHaveBeenCalledTimes(1);
      expect(window.open).toHaveBeenCalledWith(
        'https://search.google.com/local/writereview?placeid=ChIJ987',
        '_blank',
        'noopener,noreferrer',
      );
      expect(onDirectGoogleMock).toHaveBeenCalledTimes(1);

      // Verifies EVENT_GOOGLE_BYPASS_CLICK attribution
      expect(trackEventSpy).toHaveBeenCalledWith({
        publicQrId: 'velvet0001',
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid: expect.any(String),
      });
    });

    it('safely falls back to Google Maps search when merchant URL is unconfigured or null', () => {
      const businessWithoutGoogle: PublicBusinessProjection = {
        ...mockBusiness,
        googleReviewUrl: null,
      };

      render(<QuotaExhaustedCard business={businessWithoutGoogle} />);

      const googleBtn = screen.getByTestId('quota-direct-google-button');
      expect(googleBtn).toHaveTextContent(/search on google maps to review/i);

      fireEvent.click(googleBtn);
      expect(window.open).toHaveBeenCalledWith('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
    });

    it('rejects unsafe destination URLs (e.g. javascript:) and falls back to Google Maps', () => {
      const businessWithMaliciousUrl: PublicBusinessProjection = {
        ...mockBusiness,
        googleReviewUrl: 'javascript:alert(1)',
      };

      render(<QuotaExhaustedCard business={businessWithMaliciousUrl} />);

      const googleBtn = screen.getByTestId('quota-direct-google-button');
      fireEvent.click(googleBtn);

      expect(window.open).toHaveBeenCalledWith('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
    });

    it('swallows telemetry failure without blocking Google Maps navigation', async () => {
      vi.spyOn(analyticsModule, 'trackEvent').mockRejectedValue(new Error('Network drop on telemetry'));

      render(<GenerationTimeoutCard business={mockBusiness} />);

      const googleBtn = screen.getByTestId('timeout-direct-google-button');
      fireEvent.click(googleBtn);

      // Window still opened despite analytics failure
      expect(window.open).toHaveBeenCalledWith(
        'https://search.google.com/local/writereview?placeid=ChIJ987',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('prevents duplicate telemetry dispatches on rapid double clicks of Google button', () => {
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({ status: 'accepted' });

      render(<GenerationTimeoutCard business={mockBusiness} />);

      const googleBtn = screen.getByTestId('timeout-direct-google-button');
      fireEvent.click(googleBtn);
      fireEvent.click(googleBtn);

      expect(trackEventSpy).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. Composite GenerationFallbacks View Component                           */
  /* -------------------------------------------------------------------------- */
  describe('Composite GenerationFallbacks View Component', () => {
    it('auto-resolves HTTP 504 error to GenerationTimeoutCard', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          error={{ status: 504, code: 'ERR_GEMINI_TIMEOUT' }}
        />,
      );
      expect(screen.getByTestId('generation-timeout-card')).toBeInTheDocument();
    });

    it('auto-resolves HTTP 429 ERR_QUOTA_EXHAUSTED to QuotaExhaustedCard', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          error={{ status: 429, code: 'ERR_QUOTA_EXHAUSTED' }}
        />,
      );
      expect(screen.getByTestId('quota-exhausted-card')).toBeInTheDocument();
    });

    it('auto-resolves abstained response to InsufficientFactsCard', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          error={{ abstained: true, reason: 'INSUFFICIENT_FACTS' }}
        />,
      );
      expect(screen.getByTestId('insufficient-facts-card')).toBeInTheDocument();
    });

    it('auto-resolves HTTP 429 ERR_RATE_LIMITED to RateLimitedNoticeCard', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          error={{ status: 429, code: 'ERR_RATE_LIMITED' }}
        />,
      );
      expect(screen.getByTestId('rate-limited-notice-card')).toBeInTheDocument();
    });

    it('renders generic fallback card on unclassified errors while preserving Google bypass', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          error={{ status: 500, code: 'ERR_DATABASE_ERROR' }}
        />,
      );
      expect(screen.getByTestId('generation-generic-fallback-card')).toBeInTheDocument();
      expect(screen.getByTestId('generic-direct-google-button')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('generic-direct-google-button'));
      expect(window.open).toHaveBeenCalledWith(
        'https://search.google.com/local/writereview?placeid=ChIJ987',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('respects explicit mode override over error prop', () => {
      render(
        <GenerationFallbacks
          business={mockBusiness}
          mode="quota_exhausted"
          error={{ status: 504, code: 'ERR_GEMINI_TIMEOUT' }}
        />,
      );
      expect(screen.getByTestId('quota-exhausted-card')).toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. Privacy & Accessibility Compliance (WCAG 2.2 AA)                       */
  /* -------------------------------------------------------------------------- */
  describe('Privacy & Accessibility Compliance', () => {
    it('ensures zero HMAC submission tokens or customer notes exist in DOM', () => {
      const { container } = render(
        <GenerationTimeoutCard business={mockBusiness} onRetry={vi.fn()} />,
      );

      expect(container.innerHTML).not.toContain('eyJ');
      expect(container.innerHTML).not.toContain('submissionToken');
      expect(container.innerHTML).not.toContain('optionalNote');
    });

    it('ensures zero review draft text, tokens, or notes are stored in browser storage', () => {
      render(<GenerationTimeoutCard business={mockBusiness} />);

      expect(localStorage.length).toBe(0);
      expect(localStorage.getItem('draft')).toBeNull();
      expect(sessionStorage.getItem('draft')).toBeNull();

      const allStoredValues = [
        ...Object.values(localStorage),
        ...Object.values(sessionStorage),
      ].join(' ');
      expect(allStoredValues).not.toContain('draft');
      expect(allStoredValues).not.toContain('optionalNote');
      expect(allStoredValues).not.toContain('token');
    });

    it('provides accessible role="region" and aria-labels for screen readers', () => {
      render(<GenerationTimeoutCard business={mockBusiness} />);
      const card = screen.getByRole('region', { name: /generation timeout recovery/i });
      expect(card).toBeInTheDocument();
    });

    it('maintains logical keyboard Tab navigation sequence', async () => {
      render(
        <GenerationTimeoutCard
          business={mockBusiness}
          onRetry={vi.fn()}
          onComposeManually={vi.fn()}
          onBackToSurvey={vi.fn()}
        />,
      );

      const retryBtn = screen.getByTestId('timeout-retry-button');
      const googleBtn = screen.getByTestId('timeout-direct-google-button');
      const composeBtn = screen.getByTestId('timeout-compose-manually-button');
      const backBtn = screen.getByTestId('timeout-back-to-survey-button');

      retryBtn.focus();
      expect(document.activeElement).toBe(retryBtn);

      await userEvent.tab();
      expect(document.activeElement).toBe(googleBtn);

      await userEvent.tab();
      expect(document.activeElement).toBe(composeBtn);

      await userEvent.tab();
      expect(document.activeElement).toBe(backBtn);
    });

    it('enforces touch targets >= 44px on interactive controls', () => {
      render(
        <GenerationTimeoutCard
          business={mockBusiness}
          onRetry={vi.fn()}
          onComposeManually={vi.fn()}
        />,
      );

      expect(screen.getByTestId('timeout-retry-button').className).toContain('min-h-[48px]');
      expect(screen.getByTestId('timeout-direct-google-button').className).toContain('min-h-[48px]');
      expect(screen.getByTestId('timeout-compose-manually-button').className).toContain('min-h-[44px]');
    });

    it('enforces 320px viewport responsive container classes and motion-reduce animation support', async () => {
      let resolveRetry: () => void = () => {};
      const onRetryMock = vi.fn().mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveRetry = res;
          }),
      );

      render(<GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />);

      const card = screen.getByTestId('generation-timeout-card');
      expect(card.className).toContain('max-w-md');
      expect(card.className).toContain('mx-auto');

      // Click retry to inspect spinner
      await userEvent.click(screen.getByTestId('timeout-retry-button'));

      const spinner = screen.getByTestId('timeout-retry-spinner').querySelector('.animate-spin');
      expect(spinner?.className).toContain('motion-reduce:animate-none');

      await act(async () => {
        resolveRetry();
      });
    });

    it('handles long merchant names and text gracefully without layout breaking', () => {
      const businessWithLongName: PublicBusinessProjection = {
        ...mockBusiness,
        name: 'Supercalifragilisticexpialidocious Long Salon & Spa Wellness Sanctuary of Bengal',
      };

      render(<QuotaExhaustedCard business={businessWithLongName} />);

      expect(
        screen.getByText('Supercalifragilisticexpialidocious Long Salon & Spa Wellness Sanctuary of Bengal'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('quota-exhausted-card')).toBeInTheDocument();
    });

    it('handles component unmount safely while retry is in-flight', async () => {
      let resolveRetry: () => void = () => {};
      const onRetryMock = vi.fn().mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveRetry = res;
          }),
      );

      const { unmount } = render(
        <GenerationTimeoutCard business={mockBusiness} onRetry={onRetryMock} />,
      );

      await userEvent.click(screen.getByTestId('timeout-retry-button'));
      expect(onRetryMock).toHaveBeenCalledTimes(1);

      // Unmount while retry promise is pending
      unmount();

      // Resolve pending promise after unmount: should not throw React state update error
      expect(() => resolveRetry()).not.toThrow();
    });
  });
});
