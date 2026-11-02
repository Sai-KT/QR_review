import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftEditor } from './DraftEditor';

describe('DraftEditor Component (SCR-CUST-07 / M4-T06)', () => {
  const sampleInitialDraft =
    'Fantastic haircut and precision beard trim today. The styling station was spotless and welcoming.';

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Draft Editing & Memory Safety                                           */
  /* -------------------------------------------------------------------------- */
  describe('Draft Editing & In-Memory State', () => {
    it('initializes textarea with the provided initialDraft', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue(sampleInitialDraft);
    });

    it('allows customer to insert additional text into the draft', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="Great service."
          onChange={handleChange}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Stylist was friendly.');

      expect(textarea).toHaveValue('Great service. Stylist was friendly.');
      expect(handleChange).toHaveBeenCalled();
    });

    it('allows customer to delete text from the draft', async () => {
      const user = userEvent.setup();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="Great service. Will return."
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.clear(textarea);
      expect(textarea).toHaveValue('');
    });

    it('allows complete rewrite of the draft', async () => {
      const user = userEvent.setup();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="Initial draft."
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.clear(textarea);
      await user.type(textarea, 'Completely new experience written by customer.');

      expect(textarea).toHaveValue('Completely new experience written by customer.');
    });

    it('preserves customer edits across unrelated parent rerenders', async () => {
      const user = userEvent.setup();

      const { rerender } = render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          isRegenerating={false}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' Highly recommended!');

      const editedValue = textarea.getAttribute('value') || (textarea as HTMLTextAreaElement).value;
      expect(editedValue).toContain('Highly recommended!');

      // Simulate parent rerender with changed loading prop
      rerender(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          isRegenerating={true}
        />,
      );

      expect(screen.getByRole('textbox', { name: /edit your review draft/i })).toHaveValue(
        editedValue,
      );
    });

    it('handles intentional draft replacement when initialDraft prop changes', () => {
      const { rerender } = render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="First generated draft."
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toHaveValue('First generated draft.');

      // Simulate regeneration arrival with new initialDraft
      rerender(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="Second regenerated draft with fresh wording."
        />,
      );

      expect(textarea).toHaveValue('Second regenerated draft with fresh wording.');
    });

    it('handles empty draft safely and disables Accept & Copy button', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft=""
          onAcceptAndCopy={vi.fn()}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toHaveValue('');

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      expect(copyBtn).toBeDisabled();
    });

    it('preserves emojis and complex Unicode characters without corruption', async () => {
      const user = userEvent.setup();
      const emojiDraft = 'Amazing haircut! 💇‍♂️ Loved the coffee ☕️ and ambience ✨';

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft=""
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, emojiDraft);

      expect(textarea).toHaveValue(emojiDraft);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Word Count & Length Guidance                                            */
  /* -------------------------------------------------------------------------- */
  describe('Word Counter & Length Guidance', () => {
    it('displays 0 words when textarea is empty', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft=""
        />,
      );

      const badge = screen.getByTestId('word-counter-badge');
      expect(badge).toHaveTextContent('0 words');
    });

    it('handles multiple consecutive spaces and newlines correctly in word count', async () => {
      const user = userEvent.setup();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft=""
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, 'Clean   station \t\n and \r\n great advice.');

      const badge = screen.getByTestId('word-counter-badge');
      expect(badge).toHaveTextContent('5 words');
    });

    it('displays within-recommended label for draft under 50 words', () => {
      const draft40 = Array.from({ length: 40 }, (_, i) => `word${i + 1}`).join(' ');

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={draft40}
        />,
      );

      const badge = screen.getByTestId('word-counter-badge');
      expect(badge).toHaveTextContent('40 words (recommended: < 50 words)');
    });

    it('displays gentle advisory guidance when draft exceeds 49 words without truncating text', () => {
      const draft55 = Array.from({ length: 55 }, (_, i) => `detail${i + 1}`).join(' ');

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={draft55}
        />,
      );

      const badge = screen.getByTestId('word-counter-badge');
      expect(badge).toHaveTextContent('55 words');

      const guidance = screen.getByTestId('word-counter-guidance');
      expect(guidance).toHaveTextContent(/under 50 words/i);

      // Verify customer text was NOT truncated
      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toHaveValue(draft55);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. AI Transparency Notice (Founder Decision M0-16)                         */
  /* -------------------------------------------------------------------------- */
  describe('AI Transparency Notice', () => {
    it('displays the exact approved AI Transparency Notice prominently', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const notice = screen.getByTestId('ai-transparency-notice');
      expect(notice).toBeInTheDocument();
      expect(notice).toHaveTextContent(
        'This draft is an AI suggestion based on your selections. Please edit or rewrite it as you see fit before posting.',
      );
    });

    it('does not conceal transparency notice inside a tooltip', () => {
      const { container } = render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const notice = screen.getByTestId('ai-transparency-notice');
      expect(notice).toBeVisible();
      // Verify it is not wrapped in a hidden tooltip or popover trigger
      expect(notice.getAttribute('aria-hidden')).not.toBe('true');
      expect(container.querySelector('[role="tooltip"]')).toBeNull();
    });

    it('does not claim review has already been published to Google Maps', () => {
      const { container } = render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      expect(container.textContent).not.toMatch(/published to google|posted to google maps|certified review/i);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Regeneration Behavior & Props                                          */
  /* -------------------------------------------------------------------------- */
  describe('Regeneration Behavior', () => {
    it('invokes onRegenerate callback when Regenerate button is clicked', async () => {
      const user = userEvent.setup();
      const handleRegenerate = vi.fn();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onRegenerate={handleRegenerate}
          canRegenerate={true}
        />,
      );

      const regenBtn = screen.getByTestId('regenerate-draft-button');
      expect(regenBtn).toBeInTheDocument();
      await user.click(regenBtn);

      expect(handleRegenerate).toHaveBeenCalledTimes(1);
    });

    it('does not render an enabled fake button when onRegenerate is absent', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      expect(screen.queryByTestId('regenerate-draft-button')).toBeNull();
    });

    it('disables regenerate button and prevents double click while in flight', async () => {
      const handleRegenerate = vi.fn();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onRegenerate={handleRegenerate}
          isRegenerating={true}
        />,
      );

      const regenBtn = screen.getByTestId('regenerate-draft-button');
      expect(regenBtn).toBeDisabled();
      expect(regenBtn).toHaveTextContent(/generating new draft/i);

      fireEvent.click(regenBtn);
      expect(handleRegenerate).not.toHaveBeenCalled();
    });

    it('disables regenerate button when canRegenerate is false', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onRegenerate={vi.fn()}
          canRegenerate={false}
        />,
      );

      const regenBtn = screen.getByTestId('regenerate-draft-button');
      expect(regenBtn).toBeDisabled();
      expect(regenBtn).toHaveTextContent(/regeneration limit reached/i);
    });

    it('renders regeneration error in an accessible alert banner without discarding customer text', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="My customized customer review."
          onRegenerate={vi.fn()}
          regenerationError="Monthly generation quota reached for this business."
        />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Monthly generation quota reached for this business.');

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toHaveValue('My customized customer review.');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 5. Continuation & Accept & Copy Boundary                                  */
  /* -------------------------------------------------------------------------- */
  describe('Continuation Boundary (M4-T07 Isolation)', () => {
    it('invokes onAcceptAndCopy with current in-memory draft on click', async () => {
      const user = userEvent.setup();
      const handleAccept = vi.fn();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onAcceptAndCopy={handleAccept}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      await user.click(copyBtn);

      expect(handleAccept).toHaveBeenCalledTimes(1);
      expect(handleAccept).toHaveBeenCalledWith(sampleInitialDraft);
    });

    it('does NOT call navigator.clipboard.writeText automatically', async () => {
      const user = userEvent.setup();
      const writeTextSpy = vi.fn();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextSpy },
        configurable: true,
        writable: true,
      });

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onAcceptAndCopy={vi.fn()}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      await user.click(copyBtn);

      // M4-T06 MUST NOT implement clipboard copying; that is M4-T07
      expect(writeTextSpy).not.toHaveBeenCalled();
    });

    it('does not open Google Maps automatically on Accept & Copy click', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onAcceptAndCopy={vi.fn()}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      await user.click(copyBtn);

      expect(windowOpenSpy).not.toHaveBeenCalled();
    });

    it('disables Accept & Copy button if onAcceptAndCopy is not provided', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const copyBtn = screen.getByTestId('accept-and-copy-button');
      expect(copyBtn).toBeDisabled();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. Anti-Gating & Direct Google Bypass                                      */
  /* -------------------------------------------------------------------------- */
  describe('Direct Google Anti-Gating Bypass', () => {
    it('renders direct Google review button regardless of draft content or sentiment', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft=""
          targetGoogleUrl="https://search.google.com/local/writereview?placeid=ChIJ123"
        />,
      );

      const googleBtn = screen.getByTestId('direct-google-button');
      expect(googleBtn).toBeInTheDocument();
      expect(googleBtn).toHaveTextContent(/Review Directly on Google Maps/i);
    });

    it('opens verified Google Maps URL in a new tab when clicked', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const googleUrl = 'https://search.google.com/local/writereview?placeid=ChIJ123';

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          targetGoogleUrl={googleUrl}
        />,
      );

      const googleBtn = screen.getByTestId('direct-google-button');
      await user.click(googleBtn);

      expect(windowOpenSpy).toHaveBeenCalledWith(
        googleUrl,
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('falls back safely to Google search URL on unconfigured destination', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          targetGoogleUrl={null}
        />,
      );

      const googleBtn = screen.getByTestId('direct-google-button');
      expect(googleBtn).toHaveTextContent(/Search on Google Maps/i);

      await user.click(googleBtn);
      expect(windowOpenSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('renders WhatsApp manager contact button if phone configured', async () => {
      const user = userEvent.setup();
      const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          whatsappPhone="+919876543210"
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
  /* 7. Security & Privacy Safeguards                                           */
  /* -------------------------------------------------------------------------- */
  describe('Security & Privacy Safeguards', () => {
    it('never renders authentication tokens or secrets in the DOM (P1 Privacy)', () => {
      const { container } = render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      expect(container.querySelector('footer')).toBeNull();
      expect(container.textContent).not.toMatch(/token|submissionToken|bearer|apikey|jwt/i);
    });

    it('never writes draft text to localStorage or sessionStorage', async () => {
      const user = userEvent.setup();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft="Sensitive patron feedback."
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      await user.type(textarea, ' More secret details.');

      expect(localStorage.getItem('draft')).toBeNull();
      expect(sessionStorage.getItem('draft')).toBeNull();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. Accessibility & Responsive Layout (WCAG 2.2 AA)                         */
  /* -------------------------------------------------------------------------- */
  describe('Accessibility & Responsive Design', () => {
    it('provides accessible label and description bindings on textarea', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: /edit your review draft/i });
      expect(textarea).toHaveAttribute('id', 'review-draft-textarea');
      expect(textarea).toHaveAttribute(
        'aria-describedby',
        'ai-transparency-notice word-counter-guidance',
      );
    });

    it('allows sequential keyboard Tab navigation through interactive elements', async () => {
      const user = userEvent.setup();

      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
          onRegenerate={vi.fn()}
          onAcceptAndCopy={vi.fn()}
        />,
      );

      await user.tab();
      expect(screen.getByRole('textbox', { name: /edit your review draft/i })).toHaveFocus();

      await user.tab();
      expect(screen.getByTestId('accept-and-copy-button')).toHaveFocus();

      await user.tab();
      expect(screen.getByTestId('regenerate-draft-button')).toHaveFocus();

      await user.tab();
      expect(screen.getByTestId('direct-google-button')).toHaveFocus();
    });

    it('clamps width with responsive max-w-md container for 320px viewport', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
          initialDraft={sampleInitialDraft}
        />,
      );

      const card = screen.getByTestId('draft-editor-card');
      expect(card.className).toContain('max-w-md');
      expect(card.className).toContain('w-full');
    });

    it('enforces touch targets >= 44px on interactive buttons', () => {
      render(
        <DraftEditor
          businessName="Luxe Unisex Salon"
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
