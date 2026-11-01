import * as React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../ui/card';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { getInitials, sanitizeGoogleReviewUrl } from '../../lib/utils/customer';

export interface GenerationShimmerProps {
  /** Merchant name for branding context */
  businessName?: string;
  /** Optional merchant logo URL */
  logoUrl?: string | null;
  /** Direct Google review URL for fallback bypass */
  targetGoogleUrl?: string | null;
  /** Callback when patron clicks direct Google review bypass */
  onDirectGoogleClick?: () => void;
  /** Optional cancellation callback if caller genuinely supports aborting */
  onCancel?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * Reassurance status messages according to UI specification:
 * - 0–1.0s: "Analyzing your feedback..."
 * - 1.0–2.2s: "Crafting your personalized review draft..."
 * - After 2.2s: "Finalizing authentic wording..."
 */
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

/**
 * GenerationShimmer (SCR-CUST-06)
 *
 * Dedicated accessible loading state presented while Gemini AI generates a personalized review draft.
 * Features:
 *   - Accessible live region (`role="status"`, `aria-live="polite"`) announcing staged progress
 *   - Staged reassurance messages (0-1s, 1-2.2s, 2.2s+)
 *   - Subtle animated sparkle icon with `prefers-reduced-motion` compliance
 *   - Skeleton placeholder approximating a review draft without layout jump
 *   - 6-second fallback prompt offering direct Google review bypass ("Taking longer than usual?")
 *   - Unbiased anti-gating compliance: direct Google access remains available
 *   - Defensive timer cleanup on unmount
 */
export function GenerationShimmer({
  businessName,
  logoUrl,
  targetGoogleUrl,
  onDirectGoogleClick,
  onCancel,
  className,
}: GenerationShimmerProps): React.JSX.Element {
  const [statusMessage, setStatusMessage] = React.useState<string>(SHIMMER_MESSAGES.STAGE_1);
  const [showFallback, setShowFallback] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);

  // Staged progress timers & 6-second fallback
  React.useEffect(() => {
    const timerStage2 = setTimeout(() => {
      setStatusMessage(SHIMMER_MESSAGES.STAGE_2);
    }, STAGE_TIMINGS.STAGE_2_DELAY_MS);

    const timerStage3 = setTimeout(() => {
      setStatusMessage(SHIMMER_MESSAGES.STAGE_3);
    }, STAGE_TIMINGS.STAGE_3_DELAY_MS);

    const timerFallback = setTimeout(() => {
      setShowFallback(true);
    }, STAGE_TIMINGS.FALLBACK_DELAY_MS);

    return () => {
      clearTimeout(timerStage2);
      clearTimeout(timerStage3);
      clearTimeout(timerFallback);
    };
  }, []);

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(targetGoogleUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const initials = businessName ? getInitials(businessName) : 'QR';

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border ${className ?? ''}`.trim()}
      data-testid="generation-shimmer-card"
    >
      <CardHeader className="flex flex-col items-center text-center pb-2">
        {/* Merchant Branding (when supplied) */}
        {businessName && (
          <div className="flex flex-col items-center mb-3">
            {logoUrl && !imageError ? (
              <img
                src={logoUrl}
                alt={`${businessName} logo`}
                onError={() => setImageError(true)}
                className="h-12 w-12 rounded-full object-cover border border-border shadow-xs mb-1.5"
              />
            ) : (
              <div
                className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg mb-1.5 select-none"
                aria-hidden="true"
              >
                {initials}
              </div>
            )}
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {businessName}
            </span>
          </div>
        )}

        {/* Animated Sparkle Icon (Reduced-Motion Safe) */}
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary motion-safe:animate-pulse motion-reduce:animate-none mb-2"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6 text-primary"
            aria-hidden="true"
            data-testid="shimmer-sparkle-icon"
          >
            {/* Multi-point decorative AI sparkle star */}
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
            <circle cx="19" cy="5" r="1.5" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        </div>

        <CardTitle className="text-heading-2 text-foreground">
          Crafting your personalized review draft...
        </CardTitle>
        <CardDescription className="text-body-normal text-muted-foreground mt-1">
          Using your feedback to prepare an editable suggestion.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {/* Live ARIA Status Region (Screen-Reader Polite Announcements) */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="rounded-lg bg-surface-subtle border border-border-subtle p-3 text-center"
          data-testid="shimmer-live-region"
        >
          <p
            className="text-xs font-semibold text-foreground transition-all duration-300"
            data-testid="shimmer-status-text"
          >
            {statusMessage}
          </p>
          <span className="sr-only">AI review draft generation in progress.</span>
        </div>

        {/* Skeleton Preview: Approximating a Review Draft Box (Decorative, Hidden from A11y) */}
        <div
          className="rounded-lg border border-border-subtle bg-surface-subtle/50 p-4 space-y-3"
          aria-hidden="true"
          data-testid="shimmer-skeleton-box"
        >
          {/* Header Row: Neutral Draft Metadata (Strictly Sentiment-Neutral, Zero Assumed Stars) */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton shimmer className="h-7 w-7 rounded-full" />
              <Skeleton shimmer className="h-3.5 w-24 rounded" />
            </div>
            {/* Sentiment-Neutral Draft Indicator (replaces any five-star rating assumption) */}
            <Skeleton shimmer className="h-3.5 w-16 rounded" />
          </div>

          {/* Body Lines: Simulating Grounded Review Paragraph */}
          <div className="space-y-2 pt-1">
            <Skeleton shimmer className="h-3 w-full rounded" />
            <Skeleton shimmer className="h-3 w-[92%] rounded" />
            <Skeleton shimmer className="h-3 w-[78%] rounded" />
          </div>

          {/* Footer Meta Row: Simulated Word Counter badge */}
          <div className="flex items-center justify-between pt-1">
            <Skeleton shimmer className="h-3 w-20 rounded" />
            <Skeleton shimmer className="h-4 w-12 rounded-full" />
          </div>
        </div>

        {/* Reassurance Disclaimer: Transparency & No Automatic Posting */}
        <p className="text-footnote text-center text-muted-foreground leading-relaxed px-2">
          Your feedback stays editable. Nothing is ever posted automatically to Google Maps.
        </p>

        {/* Six-Second Fallback Action Prompt (Anti-Gating Compliance) */}
        {showFallback && (
          <div
            className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-center space-y-2 transition-opacity duration-300 motion-reduce:transition-none"
            data-testid="shimmer-fallback-section"
          >
            <p className="text-xs font-medium text-muted-foreground">
              Taking longer than usual?
            </p>
            <Button
              type="button"
              variant="outline"
              size="default"
              className="w-full text-xs font-semibold min-h-[44px] touch-target-preferred"
              onClick={handleGoogleClick}
            >
              {hasConfiguredGoogle
                ? 'Review Directly on Google Maps ↗'
                : 'Search on Google Maps ↗'}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground hover:text-foreground mt-0.5"
                onClick={onCancel}
              >
                Cancel Generation
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default GenerationShimmer;
