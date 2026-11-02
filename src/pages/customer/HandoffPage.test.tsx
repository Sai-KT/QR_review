import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HandoffPage } from './HandoffPage';
import type { PublicBusinessProjection } from '../../types/domain';
import * as analyticsModule from '../../lib/api/analytics';
import * as clipboardModule from '../../lib/clipboard';

const mockBusiness: PublicBusinessProjection = {
  name: 'Luxe Salon & Spa',
  publicQrId: 'luxe000001',
  categoryId: 'salon',
  googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJ123',
  whatsappNumber: '+91 98765 43210',
  logoUrl: 'https://cdn.example.com/luxe.png',
  isActive: true,
  isSuspended: false,
  isDirectGoogleOnly: false,
  subscriptionStatus: 'active',
  accountStatus: 'active',
};

describe('HandoffPage Component (SCR-CUST-08 / M4-T07)', () => {
  const sampleApprovedDraft =
    'Loved the haircut and precision beard fade today. Friendly atmosphere and spotless stations ✨';

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
  /* 1. Success State Rendering & Copy Confirmation                            */
  /* -------------------------------------------------------------------------- */
  describe('Success State Rendering & Copy Confirmation', () => {
    it('renders truthful copy confirmation and 4-step instructions card', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      // Verify success banner and heading
      expect(screen.getByTestId('copy-success-banner')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /review copied to your clipboard!/i }),
      ).toBeInTheDocument();

      // Verify 4-step instructions card
      const instructions = screen.getByTestId('posting-instructions-card');
      expect(instructions).toBeInTheDocument();
      expect(instructions).toHaveTextContent(/how to post on google maps/i);
      expect(instructions).toHaveTextContent(/open google maps/i);
      expect(instructions).toHaveTextContent(/star rating/i);
      expect(instructions).toHaveTextContent(/paste/i);
      expect(instructions).toHaveTextContent(/post/i);

      // Verify primary action
      const openBtn = screen.getByTestId('open-google-maps-button');
      expect(openBtn).toBeInTheDocument();
      expect(openBtn).toHaveTextContent('Open Google Maps to Post →');

      // Verify manual copy box is not rendered in success state
      expect(screen.queryByTestId('manual-copy-box')).toBeNull();
    });

    it('displays store branding and monogram initials when logo is absent', () => {
      render(
        <HandoffPage
          business={{ ...mockBusiness, logoUrl: null }}
          draft={sampleApprovedDraft}
        />,
      );

      expect(screen.getByText('Luxe Salon & Spa')).toBeInTheDocument();
      expect(screen.getByText('LS')).toBeInTheDocument();
    });

    it('does NOT automatically navigate or redirect on mount', () => {
      const windowOpenSpy = vi.spyOn(window, 'open');

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      // Two-click handoff policy: zero automatic redirect!
      expect(windowOpenSpy).not.toHaveBeenCalled();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Manual Copy Fallback View                                              */
  /* -------------------------------------------------------------------------- */
  describe('Manual Copy Fallback View', () => {
    it('renders read-only manual copy textarea when initialClipboardState is fallback', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          initialClipboardState="fallback"
        />,
      );

      expect(screen.getByTestId('copy-fallback-banner')).toBeInTheDocument();
      expect(screen.getByText(/manual copy required/i)).toBeInTheDocument();
      expect(screen.queryByTestId('copy-success-banner')).toBeNull();

      const textarea = screen.getByTestId('manual-copy-textarea') as HTMLTextAreaElement;
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue(sampleApprovedDraft);
      expect(textarea).toHaveAttribute('readonly');

      expect(screen.getByTestId('manual-copy-box')).toHaveTextContent(
        /press and hold inside the box above/i,
      );
      expect(screen.getByTestId('retry-copy-button')).toBeInTheDocument();
    });

    it('selects textarea contents on click and focus in manual copy box', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          initialClipboardState="fallback"
        />,
      );

      const textarea = screen.getByTestId('manual-copy-textarea') as HTMLTextAreaElement;
      const selectSpy = vi.spyOn(textarea, 'select');

      fireEvent.click(textarea);
      expect(selectSpy).toHaveBeenCalledTimes(1);

      fireEvent.focus(textarea);
      expect(selectSpy).toHaveBeenCalledTimes(2);
    });

    it('transitions to success state when Try Automatic Copy Again succeeds', async () => {
      const user = userEvent.setup();
      const writeTextSpy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });
      const handleCopySuccess = vi.fn();

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          initialClipboardState="fallback"
          onCopySuccess={handleCopySuccess}
        />,
      );

      const retryBtn = screen.getByTestId('retry-copy-button');
      await user.click(retryBtn);

      expect(writeTextSpy).toHaveBeenCalledWith(sampleApprovedDraft);
      expect(handleCopySuccess).toHaveBeenCalledTimes(1);

      // Transitions to success banner
      expect(screen.getByTestId('copy-success-banner')).toBeInTheDocument();
      expect(screen.getByTestId('copy-feedback-notice')).toHaveTextContent(
        /re-copied to clipboard/i,
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. No-Draft Fallback State (No Fabricated AI Reviews)                      */
  /* -------------------------------------------------------------------------- */
  describe('No-Draft Fallback State', () => {
    it('renders clean fallback state when draft is null or empty without inventing reviews', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={null}
        />,
      );

      expect(screen.getByTestId('handoff-no-draft-card')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /no review draft available/i }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('copy-success-banner')).toBeNull();
      expect(screen.queryByTestId('manual-copy-textarea')).toBeNull();

      // Direct Google Maps button remains available
      expect(screen.getByTestId('handoff-direct-google-button')).toBeInTheDocument();
    });

    it('invokes onBack callback when clicking back in no-draft state', async () => {
      const user = userEvent.setup();
      const handleBack = vi.fn();

      render(
        <HandoffPage
          business={mockBusiness}
          draft=""
          onBack={handleBack}
        />,
      );

      const backBtn = screen.getByTestId('handoff-back-button');
      await user.click(backBtn);

      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Google Maps Launch & Anti-Gating (Second Click)                         */
  /* -------------------------------------------------------------------------- */
  describe('Google Maps Launch & Anti-Gating (Second Click)', () => {
    it('opens verified Google review destination in a new tab upon explicit click', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');
      const handleGoogleClick = vi.fn();

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          onGoogleRedirectClick={handleGoogleClick}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      await user.click(openBtn);

      expect(handleGoogleClick).toHaveBeenCalledTimes(1);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        mockBusiness.googleReviewUrl,
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('falls back safely to Google search URL on unconfigured destination', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');

      render(
        <HandoffPage
          business={{ ...mockBusiness, googleReviewUrl: null }}
          draft={sampleApprovedDraft}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      expect(openBtn).toHaveTextContent(/search on google maps to post/i);

      await user.click(openBtn);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('renders WhatsApp manager contact link when configured', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const waBtn = screen.getByTestId('whatsapp-contact-button');
      expect(waBtn).toBeInTheDocument();
      await user.click(waBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining('https://wa.me/919876543210'),
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Telemetry & Analytics Safety (API-PUB-05)                               */
  /* -------------------------------------------------------------------------- */
  describe('Analytics & Telemetry Safety', () => {
    it('dispatches EVENT_GOOGLE_REDIRECT_CLICK on assisted Google Maps click without logging draft text', async () => {
      const user = userEvent.setup();
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      await user.click(openBtn);

      expect(trackEventSpy).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_GOOGLE_REDIRECT_CLICK',
        }),
      );

      // Verify draft text is NOT leaked to analytics payload
      const payloadArg = trackEventSpy.mock.calls[0]?.[0];
      expect(JSON.stringify(payloadArg)).not.toContain(sampleApprovedDraft);
      expect(JSON.stringify(payloadArg)).not.toContain('Loved the haircut');
    });

    it('dispatches EVENT_GOOGLE_BYPASS_CLICK when clicking direct Google link in no-draft state', async () => {
      const user = userEvent.setup();
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });
      const handleBypassClick = vi.fn();

      render(
        <HandoffPage
          business={mockBusiness}
          draft={null}
          onDirectGoogleBypassClick={handleBypassClick}
        />,
      );

      const directBtn = screen.getByTestId('handoff-direct-google-button');
      await user.click(directBtn);

      expect(handleBypassClick).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        }),
      );
    });

    it('dispatches EVENT_GOOGLE_BYPASS_CLICK when patron clicks direct bypass link on active review screen', async () => {
      const user = userEvent.setup();
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });
      const handleBypassClick = vi.fn();

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          onDirectGoogleBypassClick={handleBypassClick}
        />,
      );

      const bypassLink = screen.getByTestId('handoff-direct-bypass-link');
      await user.click(bypassLink);

      expect(handleBypassClick).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        }),
      );
    });

    it('dispatches EVENT_COPY_ATTEMPTED and EVENT_COPY_SUCCESS when re-copying review text', async () => {
      const user = userEvent.setup();
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });
      vi.spyOn(clipboardModule, 'copyTextToClipboard').mockResolvedValue({
        success: true,
      });

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const recopyBtn = screen.getByTestId('recopy-review-button');
      await user.click(recopyBtn);

      expect(trackEventSpy).toHaveBeenCalledTimes(2);
      expect(trackEventSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_COPY_ATTEMPTED',
        }),
      );
      expect(trackEventSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_COPY_SUCCESS',
        }),
      );
    });

    it('dispatches EVENT_COPY_ATTEMPTED but NEVER EVENT_COPY_SUCCESS when re-copy fails', async () => {
      const user = userEvent.setup();
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });
      const notAllowedErr = new Error('Permission denied');
      notAllowedErr.name = 'NotAllowedError';
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(notAllowedErr) },
        configurable: true,
        writable: true,
      });

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const recopyBtn = screen.getByTestId('recopy-review-button');
      await user.click(recopyBtn);

      // Only EVENT_COPY_ATTEMPTED must be emitted; NEVER EVENT_COPY_SUCCESS!
      expect(trackEventSpy).toHaveBeenCalledTimes(1);
      expect(trackEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          publicQrId: mockBusiness.publicQrId,
          eventName: 'EVENT_COPY_ATTEMPTED',
        }),
      );
    });

    it('does not prevent window navigation when analytics fails or throws', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');
      vi.spyOn(analyticsModule, 'trackEvent').mockRejectedValue(new Error('Network error'));

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      await user.click(openBtn);

      // Google Maps must still open!
      expect(windowOpenSpy).toHaveBeenCalledWith(
        mockBusiness.googleReviewUrl,
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('guards against duplicate analytics events on rapid double-clicks', async () => {
      const trackEventSpy = vi.spyOn(analyticsModule, 'trackEvent').mockResolvedValue({
        status: 'accepted',
      });

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      // Rapid double clicks
      fireEvent.click(openBtn);
      fireEvent.click(openBtn);

      expect(trackEventSpy).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Security, Storage & Privacy Safeguards                                   */
  /* -------------------------------------------------------------------------- */
  describe('Security & Privacy Safeguards', () => {
    it('never writes review draft to localStorage or sessionStorage', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      expect(localStorage.getItem('draft')).toBeNull();
      expect(sessionStorage.getItem('draft')).toBeNull();

      // Verify draft text is strictly nowhere in any storage entry
      const allStoredValues = [
        ...Object.values(localStorage),
        ...Object.values(sessionStorage),
      ].join(' ');
      expect(allStoredValues).not.toContain(sampleApprovedDraft);
      expect(allStoredValues).not.toContain('Loved the haircut');
    });

    it('never renders authentication tokens or secrets in DOM', () => {
      const { container } = render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      expect(container.querySelector('footer')).toBeNull();
      expect(container.textContent).not.toMatch(/submissionToken|bearer|apikey|jwt|session id/i);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. Accessibility & Mobile Responsive Layout (WCAG 2.2 AA)                  */
  /* -------------------------------------------------------------------------- */
  describe('Accessibility & Responsive Design', () => {
    it('provides logical keyboard Tab navigation through interactive controls', async () => {
      const user = userEvent.setup();

      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
          onBack={vi.fn()}
        />,
      );

      await user.tab();
      expect(screen.getByTestId('open-google-maps-button')).toHaveFocus();

      await user.tab();
      expect(screen.getByTestId('recopy-review-button')).toHaveFocus();

      await user.tab();
      expect(screen.getByTestId('handoff-back-to-editor-button')).toHaveFocus();
    });

    it('clamps width with responsive max-w-md container for mobile viewports', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const card = screen.getByTestId('handoff-card');
      expect(card.className).toContain('max-w-md');
      expect(card.className).toContain('w-full');
    });

    it('enforces touch targets >= 44px on interactive buttons', () => {
      render(
        <HandoffPage
          business={mockBusiness}
          draft={sampleApprovedDraft}
        />,
      );

      const openBtn = screen.getByTestId('open-google-maps-button');
      expect(openBtn.className).toContain('min-h-[48px]');

      const recopyBtn = screen.getByTestId('recopy-review-button');
      expect(recopyBtn.className).toContain('min-h-[44px]');
    });
  });
});
