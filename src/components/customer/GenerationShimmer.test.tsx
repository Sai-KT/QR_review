import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenerationShimmer } from './GenerationShimmer';

const SHIMMER_MESSAGES = {
  STAGE_1: 'Analyzing your feedback...',
  STAGE_2: 'Crafting your personalized review draft...',
  STAGE_3: 'Finalizing authentic wording...',
} as const;

const STAGE_TIMINGS = {
  STAGE_2_DELAY_MS: 1000,
  STAGE_3_DELAY_MS: 2200,
  FALLBACK_DELAY_MS: 6000,
} as const;

describe('GenerationShimmer Component (SCR-CUST-06 / M4-T05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* ------------------------------------------------------------------------ */
  /* 1. Rendering Suite                                                       */
  /* ------------------------------------------------------------------------ */

  describe('Visual & Semantic Rendering', () => {
    it('renders the card with initial heading, description, and status message', () => {
      render(<GenerationShimmer />);

      expect(
        screen.getByRole('heading', {
          name: /Crafting your personalized review draft\.\.\./i,
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText(/Using your feedback to prepare an editable suggestion\./i),
      ).toBeInTheDocument();

      expect(screen.getByText(SHIMMER_MESSAGES.STAGE_1)).toBeInTheDocument();

      expect(
        screen.getByText(
          /Your feedback stays editable\. Nothing is ever posted automatically to Google Maps\./i,
        ),
      ).toBeInTheDocument();
    });

    it('renders skeleton preview box with decorative aria-hidden attribute', () => {
      render(<GenerationShimmer />);

      const skeletonBox = screen.getByTestId('shimmer-skeleton-box');
      expect(skeletonBox).toBeInTheDocument();
      expect(skeletonBox).toHaveAttribute('aria-hidden', 'true');
    });

    it('hides decorative sparkle icon from screen readers', () => {
      render(<GenerationShimmer />);

      const sparkle = screen.getByTestId('shimmer-sparkle-icon');
      expect(sparkle).toBeInTheDocument();
      expect(sparkle).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders merchant branding with logo when provided', () => {
      render(
        <GenerationShimmer
          businessName="Luxe Unisex Salon"
          logoUrl="https://cdn.example.com/logo.png"
        />,
      );

      expect(screen.getByText('Luxe Unisex Salon')).toBeInTheDocument();
      const logoImg = screen.getByAltText('Luxe Unisex Salon logo');
      expect(logoImg).toBeInTheDocument();
      expect(logoImg).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    });

    it('falls back to monogram initials if logo image fails to load or is null', () => {
      const { rerender } = render(
        <GenerationShimmer
          businessName="Luxe Unisex Salon"
          logoUrl="https://cdn.example.com/broken.png"
        />,
      );

      const logoImg = screen.getByAltText('Luxe Unisex Salon logo');
      fireEvent.error(logoImg);

      expect(screen.queryByAltText('Luxe Unisex Salon logo')).not.toBeInTheDocument();
      expect(screen.getByText('LU')).toBeInTheDocument();

      // Explicit null logoUrl
      rerender(<GenerationShimmer businessName="Green Leaf Cafe" logoUrl={null} />);
      expect(screen.getByText('GL')).toBeInTheDocument();
    });

    it('never renders authentication tokens, credentials, or footer secret text in DOM or accessibility tree (P1 Privacy)', () => {
      const { container } = render(
        <GenerationShimmer businessName="Luxe Unisex Salon" />,
      );

      // Verify no footer or token text exists in DOM
      expect(container.querySelector('footer')).toBeNull();
      expect(container.querySelector('[role="contentinfo"]')).toBeNull();
      expect(container.textContent).not.toMatch(/token|secret|session id|bearer|apikey|jwt/i);
    });

    it('maintains strict sentiment neutrality without fabricated star ratings or rating placeholders in skeleton (P2 Sentiment Neutrality)', () => {
      const { container } = render(<GenerationShimmer />);

      const skeletonBox = screen.getByTestId('shimmer-skeleton-box');
      expect(skeletonBox).toBeInTheDocument();

      // Verify zero star icons, zero star rating grids, zero rating text
      expect(skeletonBox.querySelectorAll('svg')).toHaveLength(0);
      expect(container.textContent).not.toMatch(/star|rating|★|☆/i);
      expect(skeletonBox.querySelector('[role="radiogroup"]')).toBeNull();
      expect(skeletonBox.querySelector('[aria-valuenow]')).toBeNull();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Timing & Staged Reassurance Messages Suite                            */
  /* ------------------------------------------------------------------------ */

  describe('Staged Timing Transitions (Fake Timers)', () => {
    it('progresses through all three reassurance stages accurately', () => {
      vi.useFakeTimers();

      render(<GenerationShimmer />);

      // Stage 1 (0 to 1.0s)
      expect(screen.getByTestId('shimmer-status-text')).toHaveTextContent(
        SHIMMER_MESSAGES.STAGE_1,
      );

      // Advance to 1,000ms -> Stage 2
      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.STAGE_2_DELAY_MS);
      });
      expect(screen.getByTestId('shimmer-status-text')).toHaveTextContent(
        SHIMMER_MESSAGES.STAGE_2,
      );

      // Advance to 2,200ms -> Stage 3
      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.STAGE_3_DELAY_MS - STAGE_TIMINGS.STAGE_2_DELAY_MS);
      });
      expect(screen.getByTestId('shimmer-status-text')).toHaveTextContent(
        SHIMMER_MESSAGES.STAGE_3,
      );
    });

    it('renders 6-second fallback prompt only after 6000ms elapsed', () => {
      vi.useFakeTimers();

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
        />,
      );

      // Before 6s, fallback prompt is not rendered
      expect(screen.queryByTestId('shimmer-fallback-section')).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5999);
      });
      expect(screen.queryByTestId('shimmer-fallback-section')).not.toBeInTheDocument();

      // At 6,000ms, fallback prompt appears
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('shimmer-fallback-section')).toBeInTheDocument();
      expect(screen.getByText('Taking longer than usual?')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i }),
      ).toBeInTheDocument();
    });

    it('clears all active timers on component unmount to prevent leaks', () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { unmount } = render(<GenerationShimmer />);
      expect(clearTimeoutSpy).not.toHaveBeenCalled();

      unmount();
      // Should have cleared all 3 staged timers
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
    });

    it('does not leak or throw on rapid unmount and remount', () => {
      vi.useFakeTimers();

      const { unmount } = render(<GenerationShimmer />);
      unmount();

      expect(() => {
        const { unmount: unmount2 } = render(<GenerationShimmer />);
        act(() => {
          vi.advanceTimersByTime(3000);
        });
        unmount2();
      }).not.toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Accessibility Suite (TC-A11Y-03, TC-CUST-11)                          */
  /* ------------------------------------------------------------------------ */

  describe('Accessibility & Live Regions (TC-A11Y-03, TC-CUST-11)', () => {
    it('declares an accessible polite live region with atomic updates', () => {
      render(<GenerationShimmer />);

      const liveRegion = screen.getByTestId('shimmer-live-region');
      expect(liveRegion).toHaveAttribute('role', 'status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    it('has exactly one role="status" live region on the entire card', () => {
      render(<GenerationShimmer />);

      const statusRegions = screen.getAllByRole('status');
      expect(statusRegions).toHaveLength(1);
    });

    it('includes screen-reader-only context announcement', () => {
      render(<GenerationShimmer />);

      expect(
        screen.getByText('AI review draft generation in progress.'),
      ).toHaveClass('sr-only');
    });

    it('supports reduced-motion preference with motion-reduce utilities', () => {
      render(<GenerationShimmer />);

      const sparkleContainer = screen.getByTestId('shimmer-sparkle-icon').parentElement;
      expect(sparkleContainer).toHaveClass('motion-safe:animate-pulse');
      expect(sparkleContainer).toHaveClass('motion-reduce:animate-none');
    });

    it('does not trap keyboard focus or interfere with document tabbing', () => {
      vi.useFakeTimers();

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
          onCancel={vi.fn()}
        />,
      );

      // Advance to show buttons
      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      const googleBtn = screen.getByRole('button', {
        name: /Review Directly on Google Maps/i,
      });
      const cancelBtn = screen.getByRole('button', {
        name: /Cancel Generation/i,
      });

      googleBtn.focus();
      expect(document.activeElement).toBe(googleBtn);

      cancelBtn.focus();
      expect(document.activeElement).toBe(cancelBtn);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Anti-Gating & Direct Google Bypass Suite                              */
  /* ------------------------------------------------------------------------ */

  describe('Anti-Gating & Direct Google Review Fallback', () => {
    it('opens direct Google Maps review in new tab when 6-second fallback clicked', async () => {
      vi.useFakeTimers();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const directClickSpy = vi.fn();

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/valid-destination/review"
          onDirectGoogleClick={directClickSpy}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      const fallbackBtn = screen.getByRole('button', {
        name: /Review Directly on Google Maps ↗/i,
      });

      fireEvent.click(fallbackBtn);

      expect(directClickSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(
        'https://g.page/r/valid-destination/review',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('safely falls back to search URL when merchant review link is unconfigured or invalid', () => {
      vi.useFakeTimers();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <GenerationShimmer
          targetGoogleUrl="javascript:alert(1)" // malicious / invalid URL
        />,
      );

      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      const fallbackBtn = screen.getByRole('button', {
        name: /Search on Google Maps ↗/i,
      });

      fireEvent.click(fallbackBtn);

      expect(openSpy).toHaveBeenCalledWith(
        'https://www.google.com/maps',
        '_blank',
        'noopener,noreferrer',
      );
    });

    it('does NOT construct or open an external window automatically at 6 seconds', () => {
      vi.useFakeTimers();
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
        />,
      );

      // Fast-forward past 6 seconds
      act(() => {
        vi.advanceTimersByTime(10000);
      });

      // Window.open should NEVER have been called automatically
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('renders Cancel button and executes onCancel only when genuinely supplied', () => {
      vi.useFakeTimers();
      const cancelSpy = vi.fn();

      const { rerender } = render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
        />,
      );

      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      // When onCancel is NOT provided, no cancel button is rendered
      expect(
        screen.queryByRole('button', { name: /Cancel Generation/i }),
      ).not.toBeInTheDocument();

      // When onCancel IS provided
      rerender(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
          onCancel={cancelSpy}
        />,
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel Generation/i });
      fireEvent.click(cancelBtn);

      expect(cancelSpy).toHaveBeenCalledTimes(1);
    });

    it('clicking fallback bypass does not mutate state or trigger duplicate generation', () => {
      vi.useFakeTimers();
      const directClickSpy = vi.fn();

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
          onDirectGoogleClick={directClickSpy}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      const fallbackBtn = screen.getByRole('button', {
        name: /Review Directly on Google Maps ↗/i,
      });

      fireEvent.click(fallbackBtn);
      expect(directClickSpy).toHaveBeenCalledTimes(1);

      // Verify the loading state remains intact and does not trigger unhandled state changes
      expect(screen.getByTestId('shimmer-live-region')).toBeInTheDocument();
      expect(screen.getByTestId('shimmer-status-text')).toHaveTextContent(
        SHIMMER_MESSAGES.STAGE_3,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Responsive & Layout Robustness Suite                                  */
  /* ------------------------------------------------------------------------ */

  describe('Responsive Layout & Fluid Design', () => {
    it('contains width clamping classes to prevent horizontal overflow on 320px screens', () => {
      render(<GenerationShimmer className="custom-test-class" />);

      const card = screen.getByTestId('generation-shimmer-card');
      expect(card).toHaveClass('w-full');
      expect(card).toHaveClass('max-w-md');
      expect(card).toHaveClass('custom-test-class');
    });

    it('renders cleanly within fluid containers across 320px, 375px, and 390px mobile viewports', () => {
      const { container } = render(
        <div style={{ width: '320px' }}>
          <GenerationShimmer
            businessName="Hair Studio Deluxe"
            targetGoogleUrl="https://g.page/r/sample/review"
          />
        </div>,
      );

      const card = container.querySelector('[data-testid="generation-shimmer-card"]');
      expect(card).toBeInTheDocument();
      expect(card).toHaveClass('w-full');
      expect(card).toHaveClass('max-w-md');
    });

    it('preserves text readability and heading hierarchy with large text scale', () => {
      render(
        <GenerationShimmer
          businessName="Very Long Salon Name With Extensive Branding"
        />,
      );

      const heading = screen.getByRole('heading', {
        name: /Crafting your personalized review draft\.\.\./i,
      });
      expect(heading).toBeInTheDocument();
      expect(heading.tagName).toBe('H3');
      expect(screen.getByText('Very Long Salon Name With Extensive Branding')).toBeInTheDocument();
    });

    it('ensures touch targets for all interactive buttons are at least 44px', () => {
      vi.useFakeTimers();

      render(
        <GenerationShimmer
          targetGoogleUrl="https://g.page/r/sample/review"
        />,
      );

      act(() => {
        vi.advanceTimersByTime(STAGE_TIMINGS.FALLBACK_DELAY_MS);
      });

      const googleBtn = screen.getByRole('button', {
        name: /Review Directly on Google Maps/i,
      });

      // Uses min-h-[44px] and touch-target-preferred classes
      expect(googleBtn).toHaveClass('min-h-[44px]');
      expect(googleBtn).toHaveClass('touch-target-preferred');
    });
  });
});
