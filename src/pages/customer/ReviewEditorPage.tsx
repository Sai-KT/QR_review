import * as React from 'react';
import type { PublicBusinessProjection } from '../../types/domain';
import { DraftEditor } from '../../components/customer/DraftEditor';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { sanitizeGoogleReviewUrl } from '../../lib/utils/customer';

export interface ReviewEditorPageProps {
  /** Merchant store details */
  business: PublicBusinessProjection;
  /** Initial AI review draft from generation pipeline (API-PUB-03) */
  initialDraft?: string | null;
  /** Whether draft generation or regeneration is actively in progress */
  isLoading?: boolean;
  /** Whether the customer is eligible to regenerate (quota / attempt policy) */
  canRegenerate?: boolean;
  /** Callback to trigger draft regeneration */
  onRegenerate?: () => Promise<void> | void;
  /** Regeneration error message if request failed */
  regenerationError?: string | null;
  /** Continuation callback when customer approves draft (boundary for M4-T07 clipboard handoff) */
  onAcceptAndCopy?: (finalDraft: string) => void;
  /** Direct Google bypass callback */
  onDirectGoogleClick?: () => void;
  /** Callback when customer taps back or exit */
  onBack?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * ReviewEditorPage (SCR-CUST-07)
 *
 * Primary customer review editor screen coordinating:
 * - Genuine AI review draft presentation
 * - Mandatory M0-16 AI Transparency Notice
 * - Customer in-place editing freedom with dynamic advisory word counter
 * - Quota-aware regeneration controls
 * - Handoff continuation boundary for subsequent clipboard operation (M4-T07)
 * - Anti-gating direct Google review access
 * - Safe fallback state when draft is unavailable (no fabricated drafts)
 */
export function ReviewEditorPage({
  business,
  initialDraft,
  isLoading = false,
  canRegenerate = true,
  onRegenerate,
  regenerationError,
  onAcceptAndCopy,
  onDirectGoogleClick,
  onBack,
  className,
}: ReviewEditorPageProps): React.JSX.Element {
  // Ephemeral in-memory editing state
  const [prevInitialDraft, setPrevInitialDraft] = React.useState<string | null | undefined>(initialDraft);
  const [editedDraft, setEditedDraft] = React.useState<string>(initialDraft ?? '');
  const [isCustomBlankMode, setIsCustomBlankMode] = React.useState<boolean>(false);

  // Synchronize when a new valid initialDraft arrives (e.g. from successful regeneration)
  // Adheres to React 19 recommendation for adjusting state on prop changes without useEffect
  if (initialDraft !== prevInitialDraft) {
    setPrevInitialDraft(initialDraft);
    setEditedDraft(initialDraft ?? '');
    if (initialDraft && initialDraft.trim().length > 0) {
      setIsCustomBlankMode(false);
    }
  }

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <Card
        className={`w-full max-w-md mx-auto shadow-md border-border ${className ?? ''}`.trim()}
        aria-busy="true"
        data-testid="review-editor-loading"
      >
        <CardHeader className="flex flex-col items-center pb-2">
          <Skeleton shimmer className="h-10 w-10 rounded-full mb-2" />
          <Skeleton shimmer className="h-4 w-32 rounded mb-2" />
          <Skeleton shimmer className="h-6 w-48 rounded" />
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <Skeleton shimmer className="h-14 w-full rounded-lg" />
          <Skeleton shimmer className="h-36 w-full rounded-md" />
          <Skeleton shimmer className="h-12 w-full rounded-md" />
          <Skeleton shimmer className="h-10 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // 2. Safe Fallback State when initial draft is absent or empty (and user hasn't opted to write blank review)
  const hasValidDraft = Boolean(initialDraft && initialDraft.trim().length > 0);
  if (!hasValidDraft && !isCustomBlankMode) {
    return (
      <Card
        className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
        data-testid="review-editor-empty-state"
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-2 font-semibold text-foreground">
            No Review Draft Available
          </CardTitle>
          <CardDescription className="text-body-normal text-muted-foreground mt-1">
            An AI review draft was not found or generation was not completed. You can write your own
            review freely or proceed directly to Google Maps.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pt-2">
          {/* Option 1: Write Custom Review from Scratch */}
          <Button
            type="button"
            variant="accent"
            size="touch"
            onClick={() => setIsCustomBlankMode(true)}
            className="w-full font-semibold min-h-[48px]"
            data-testid="write-custom-review-button"
          >
            Write Your Own Review ✍
          </Button>

          {/* Option 2: Anti-Gating Direct Google Navigation */}
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={handleGoogleClick}
            className="w-full min-h-[44px]"
            data-testid="empty-state-direct-google-button"
          >
            {hasConfiguredGoogle
              ? 'Review Directly on Google Maps ↗'
              : 'Search on Google Maps ↗'}
          </Button>

          {/* Option 3: Return Back (if onBack provided) */}
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={onBack}
              className="w-full min-h-[44px] text-xs text-muted-foreground"
              data-testid="empty-state-back-button"
            >
              ← Back to Survey
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // 3. Normal Review Editor State (with genuine initial draft or user-initiated custom blank draft)
  return (
    <DraftEditor
      businessName={business.name}
      logoUrl={business.logoUrl}
      initialDraft={editedDraft}
      value={editedDraft}
      onChange={setEditedDraft}
      targetGoogleUrl={business.googleReviewUrl}
      onDirectGoogleClick={onDirectGoogleClick}
      whatsappPhone={business.whatsappNumber}
      canRegenerate={canRegenerate}
      onRegenerate={onRegenerate}
      regenerationError={regenerationError}
      onAcceptAndCopy={onAcceptAndCopy}
      className={className}
    />
  );
}

export default ReviewEditorPage;
