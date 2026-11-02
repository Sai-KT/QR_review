import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewEditorPage } from './ReviewEditorPage';
import type { PublicBusinessProjection } from '../../types/domain';

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

describe('ReviewEditorPage Component (SCR-CUST-07 / M4-T06)', () => {
  const sampleInitialDraft =
    'Loved the haircut and precision beard fade today. Friendly atmosphere and spotless stations.';

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
  /* 1. Loading State                                                           */
  /* -------------------------------------------------------------------------- */
  describe('Loading State', () => {
    it('renders accessible loading skeleton when isLoading is true', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          isLoading={true}
        />,
      );

      const loadingCard = screen.getByTestId('review-editor-loading');
      expect(loadingCard).toBeInTheDocument();
      expect(loadingCard).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByTestId('draft-editor-textarea')).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Safe Fallback State (No Fabricated AI Drafts)                          */
  /* -------------------------------------------------------------------------- */
  describe('Safe Fallback State (No Fabricated Drafts)', () => {
    it('renders empty-state fallback card when initialDraft is null', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={null}
        />,
      );

      expect(screen.getByTestId('review-editor-empty-state')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /no review draft available/i })).toBeInTheDocument();
      expect(screen.queryByTestId('draft-editor-textarea')).toBeNull();
    });

    it('renders empty-state fallback card when initialDraft is empty whitespace', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft="   "
        />,
      );

      expect(screen.getByTestId('review-editor-empty-state')).toBeInTheDocument();
    });

    it('allows customer to write custom review from scratch when draft unavailable', async () => {
      const user = userEvent.setup();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={null}
        />,
      );

      const writeCustomBtn = screen.getByTestId('write-custom-review-button');
      await user.click(writeCustomBtn);

      // Now renders DraftEditor in blank mode
      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('');
    });

    it('provides direct Google Maps navigation from empty fallback state', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={null}
        />,
      );

      const googleBtn = screen.getByTestId('empty-state-direct-google-button');
      expect(googleBtn).toBeInTheDocument();
      await user.click(googleBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        mockBusiness.googleReviewUrl,
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('invokes onBack callback when clicking back in empty state', async () => {
      const user = userEvent.setup();
      const handleBack = vi.fn();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={null}
          onBack={handleBack}
        />,
      );

      const backBtn = screen.getByTestId('empty-state-back-button');
      await user.click(backBtn);

      expect(handleBack).toHaveBeenCalledTimes(1);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Normal Draft Editor Presentation                                        */
  /* -------------------------------------------------------------------------- */
  describe('Draft Editor Presentation & In-Memory Editing', () => {
    it('renders DraftEditor with provided genuine initial draft', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue(sampleInitialDraft);

      const notice = screen.getByTestId('ai-transparency-notice');
      expect(notice).toHaveTextContent(
        'This draft is an AI suggestion based on your selections. Please edit or rewrite it as you see fit before posting.',
      );
    });

    it('allows customer to edit draft text in memory', async () => {
      const user = userEvent.setup();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Stylist Vikram was excellent.');

      expect(textarea).toHaveValue(`${sampleInitialDraft} Stylist Vikram was excellent.`);
    });

    it('preserves customer edits across parent component rerenders', async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          canRegenerate={true}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Absolutely 5 stars.');

      const editedText = (textarea as HTMLTextAreaElement).value;

      // Simulate parent update (e.g. quota limit reached)
      rerender(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          canRegenerate={false}
        />,
      );

      expect(screen.getByRole('textbox', { name: /edit your review draft/i })).toHaveValue(
        editedText,
      );
    });

    it('updates text when a new initialDraft arrives after regeneration', () => {
      const { rerender } = render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft="Initial generated draft."
        />,
      );

      expect(screen.getByRole('textbox', { name: /edit your review draft/i })).toHaveValue(
        'Initial generated draft.',
      );

      // Regeneration succeeds and supplies fresh initialDraft
      rerender(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft="Regenerated suggestion with refreshed phrasing."
        />,
      );

      expect(screen.getByRole('textbox', { name: /edit your review draft/i })).toHaveValue(
        'Regenerated suggestion with refreshed phrasing.',
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Regeneration Integration                                                */
  /* -------------------------------------------------------------------------- */
  describe('Regeneration Integration', () => {
    it('calls onRegenerate when customer taps regenerate button', async () => {
      const user = userEvent.setup();
      const handleRegenerate = vi.fn();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          onRegenerate={handleRegenerate}
          canRegenerate={true}
        />,
      );

      const regenBtn = screen.getByTestId('regenerate-draft-button');
      await user.click(regenBtn);

      expect(handleRegenerate).toHaveBeenCalledTimes(1);
    });

    it('displays regeneration error alert banner when regenerationError is passed', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          onRegenerate={vi.fn()}
          regenerationError="Monthly generation limit reached."
        />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Monthly generation limit reached.');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Continuation Boundary (Accept & Copy)                                   */
  /* -------------------------------------------------------------------------- */
  describe('Accept & Copy Continuation Boundary', () => {
    it('passes edited draft to onAcceptAndCopy callback when approved', async () => {
      const user = userEvent.setup();
      const handleAcceptAndCopy = vi.fn();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft="Initial draft."
          onAcceptAndCopy={handleAcceptAndCopy}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Additional customer note.');

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      await user.click(copyBtn);

      expect(handleAcceptAndCopy).toHaveBeenCalledTimes(1);
      expect(handleAcceptAndCopy).toHaveBeenCalledWith('Initial draft. Additional customer note.');
    });

    it('does not invoke clipboard or window navigation directly in M4-T06', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          onAcceptAndCopy={vi.fn()}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      await user.click(copyBtn);

      expect(windowOpenSpy).not.toHaveBeenCalled();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Anti-Gating & Direct Google Access                                      */
  /* -------------------------------------------------------------------------- */
  describe('Direct Google Anti-Gating Link', () => {
    it('renders direct Google review bypass button and opens in new tab', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open');
      const handleGoogleClick = vi.fn();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          onDirectGoogleClick={handleGoogleClick}
        />,
      );

      const googleBtn = screen.getByTestId('direct-google-button');
      expect(googleBtn).toBeInTheDocument();
      await user.click(googleBtn);

      expect(handleGoogleClick).toHaveBeenCalledTimes(1);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        mockBusiness.googleReviewUrl,
        '_blank',
        'noopener,noreferrer',
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. Security, Privacy & Storage Guardrails                                  */
  /* -------------------------------------------------------------------------- */
  describe('Security & Privacy Safeguards', () => {
    it('never writes customer draft to localStorage or sessionStorage', async () => {
      const user = userEvent.setup();

      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Private thoughts.');

      expect(localStorage.getItem('draft')).toBeNull();
      expect(sessionStorage.getItem('draft')).toBeNull();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });

    it('never renders authentication tokens, secrets or credentials in DOM', () => {
      const { container } = render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
        />,
      );

      expect(container.querySelector('footer')).toBeNull();
      expect(container.textContent).not.toMatch(/submissionToken|bearer|apikey|jwt|session id/i);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. Accessibility & Responsive Verification (WCAG 2.2 AA)                   */
  /* -------------------------------------------------------------------------- */
  describe('Accessibility & Responsive Design', () => {
    it('clamps width with responsive max-w-md container for mobile viewports', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
        />,
      );

      const card = screen.getByTestId('draft-editor-card');
      expect(card.className).toContain('max-w-md');
      expect(card.className).toContain('w-full');
    });

    it('enforces touch targets >= 44px on interactive buttons', () => {
      render(
        <ReviewEditorPage
          business={mockBusiness}
          initialDraft={sampleInitialDraft}
          onRegenerate={vi.fn()}
          onAcceptAndCopy={vi.fn()}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      expect(copyBtn.className).toContain('min-h-[48px]');

      const regenBtn = screen.getByTestId('regenerate-draft-button');
      expect(regenBtn.className).toContain('min-h-[44px]');

      const googleBtn = screen.getByTestId('direct-google-button');
      expect(googleBtn.className).toContain('min-h-[44px]');
    });
  });
});
