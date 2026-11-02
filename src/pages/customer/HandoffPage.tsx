import * as React from 'react';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Textarea } from '../../components/ui/textarea';
import {
  getInitials,
  sanitizeGoogleReviewUrl,
  formatWhatsAppUrl,
  getClientSessionUuid,
} from '../../lib/utils/customer';
import { copyReviewDraftWithTelemetry } from '../../lib/clipboard';
import { trackEvent } from '../../lib/api/analytics';

export type ClipboardUiState = 'success' | 'fallback' | 'idle';

export interface HandoffPageProps {
  /** Merchant store details */
  business: PublicBusinessProjection;
  /** Customer-approved review draft text */
  draft?: string | null;
  /** Initial clipboard UI state (defaults to 'success' if draft is present) */
  initialClipboardState?: ClipboardUiState;
  /** Callback when Google redirect button is clicked (assisted handoff) */
  onGoogleRedirectClick?: () => void;
  /** Callback when customer explicitly bypasses review draft and navigates directly to Google */
  onDirectGoogleBypassClick?: () => void;
  /** Callback when re-copy succeeds */
  onCopySuccess?: () => void;
  /** Callback when customer taps back to edit draft */
  onBack?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * HandoffPage (SCR-CUST-08)
 *
 * Copy Confirmation & Google Maps Handoff screen adhering to:
 * - FR-CUST-007: Resilient clipboard copy confirmation & verified external Google handoff
 * - Core Invariant #6: Two-click handoff policy (explicit customer-directed Google launch; zero automatic redirect)
 * - Core Invariant #7: Universal anti-gating (accessible to all patrons regardless of sentiment)
 * - Canonical Telemetry Taxonomy:
 *     - EVENT_COPY_ATTEMPTED: When customer initiates a clipboard write
 *     - EVENT_COPY_SUCCESS: Strictly when clipboard Promise resolves successfully
 *     - EVENT_GOOGLE_REDIRECT_CLICK: When customer opens Google Maps to post copied review (assisted)
 *     - EVENT_GOOGLE_BYPASS_CLICK: When customer navigates to Google directly without review draft
 * - Defensive Clipboard Recovery: Accessible manual-copy textarea fallback when Clipboard API is denied/unsupported
 */
export function HandoffPage({
  business,
  draft,
  initialClipboardState,
  onGoogleRedirectClick,
  onDirectGoogleBypassClick,
  onCopySuccess,
  onBack,
  className,
}: HandoffPageProps): React.JSX.Element {
  const hasDraft = Boolean(draft && draft.trim().length > 0);

  // Default state: if draft is provided, start in 'success' (representing state right after Accept & Copy)
  const defaultState: ClipboardUiState = hasDraft
    ? (initialClipboardState ?? 'success')
    : 'idle';

  const [clipboardState, setClipboardState] = React.useState<ClipboardUiState>(defaultState);
  const [isCopying, setIsCopying] = React.useState<boolean>(false);
  const [copyFeedbackNotice, setCopyFeedbackNotice] = React.useState<string | null>(null);
  const [imageError, setImageError] = React.useState<boolean>(false);

  // In-flight guard to avoid duplicate analytics dispatches on rapid double clicks
  const isRedirectingRef = React.useRef<boolean>(false);
  const isBypassingRef = React.useRef<boolean>(false);

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const initials = business.name ? getInitials(business.name) : 'QR';
  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);

  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  // 1. Explicit Re-Copy Handler with Telemetry (EVENT_COPY_ATTEMPTED & EVENT_COPY_SUCCESS)
  const handleCopyAgain = async () => {
    if (!draft || isCopying) return;

    setIsCopying(true);
    setCopyFeedbackNotice(null);

    const result = await copyReviewDraftWithTelemetry(draft, {
      publicQrId: business.publicQrId,
      sessionUuid,
    });

    if (result.success) {
      setClipboardState('success');
      setCopyFeedbackNotice('Review text re-copied to clipboard!');
      onCopySuccess?.();
    } else {
      setClipboardState('fallback');
      setCopyFeedbackNotice('Automatic copy unavailable. Please select and copy manually below.');
    }

    setIsCopying(false);
  };

  // 2. Assisted Google Maps Launch (Second Click in Two-Click Handoff: EVENT_GOOGLE_REDIRECT_CLICK)
  const handleLaunchGoogleMaps = () => {
    // Immediate synchronous window opening to avoid browser popup blockers
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');

    onGoogleRedirectClick?.();

    // Telemetry: Record EVENT_GOOGLE_REDIRECT_CLICK asynchronously
    // Invariant: Telemetry failures must NEVER block customer navigation
    if (!isRedirectingRef.current) {
      isRedirectingRef.current = true;
      trackEvent({
        publicQrId: business.publicQrId,
        eventName: 'EVENT_GOOGLE_REDIRECT_CLICK',
        sessionUuid,
      }).catch(() => {
        // Non-critical telemetry failure gracefully swallowed
      });
    }
  };

  // 3. Direct Google Bypass Launch (Independent Anti-Gating: EVENT_GOOGLE_BYPASS_CLICK)
  const handleDirectGoogleBypass = () => {
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');

    onDirectGoogleBypassClick?.();

    if (!isBypassingRef.current) {
      isBypassingRef.current = true;
      trackEvent({
        publicQrId: business.publicQrId,
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid,
      }).catch(() => {
        // Non-critical telemetry failure gracefully swallowed
      });
    }
  };

  // --------------------------------------------------------------------------
  // Render: Safe Fallback State when no draft is provided (Never fabricate drafts)
  // --------------------------------------------------------------------------
  if (!hasDraft) {
    return (
      <Card
        className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
        data-testid="handoff-no-draft-card"
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-2 font-semibold text-foreground">
            No Review Draft Available
          </CardTitle>
          <CardDescription className="text-body-normal text-muted-foreground mt-1">
            A review draft was not found. You can still share your genuine feedback directly on
            Google Maps below.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3 pt-2">
          {/* Direct Bypass Action: Emits EVENT_GOOGLE_BYPASS_CLICK */}
          <Button
            type="button"
            variant="accent"
            size="touch"
            onClick={handleDirectGoogleBypass}
            className="w-full font-semibold min-h-[48px]"
            data-testid="handoff-direct-google-button"
          >
            {hasConfiguredGoogle
              ? 'Review Directly on Google Maps ↗'
              : 'Search on Google Maps ↗'}
          </Button>

          {onBack && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={onBack}
              className="w-full min-h-[44px] text-xs"
              data-testid="handoff-back-button"
            >
              ← Back to Review Editor
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // --------------------------------------------------------------------------
  // Render: Normal Handoff Screen (Success Confirmation or Manual Fallback)
  // --------------------------------------------------------------------------
  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border ${className ?? ''}`.trim()}
      data-testid="handoff-card"
    >
      <CardHeader className="flex flex-col items-center text-center pb-2">
        {/* Merchant Branding Header */}
        <div className="flex flex-col items-center mb-2">
          {business.logoUrl && !imageError ? (
            <img
              src={business.logoUrl}
              alt={`${business.name} logo`}
              onError={() => setImageError(true)}
              className="h-10 w-10 rounded-full object-cover border border-border shadow-xs mb-1"
            />
          ) : (
            <div
              className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm mb-1 select-none"
              aria-hidden="true"
            >
              {initials}
            </div>
          )}
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {business.name}
          </span>
        </div>

        {/* State Banner: Success vs Manual Copy Fallback */}
        {clipboardState === 'success' ? (
          <div className="flex flex-col items-center space-y-1.5" data-testid="copy-success-banner">
            <div
              className="h-11 w-11 rounded-full bg-state-success-bg text-state-success flex items-center justify-center font-bold text-xl"
              aria-hidden="true"
            >
              ✓
            </div>
            <CardTitle className="text-heading-2 font-semibold text-foreground">
              Review copied to your clipboard!
            </CardTitle>
            <CardDescription className="text-body-normal text-muted-foreground">
              Follow the quick steps below to post your review on Google Maps.
            </CardDescription>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-1.5" data-testid="copy-fallback-banner">
            <Badge variant="warning" size="sm" shape="pill" className="mb-1">
              Manual Copy Required
            </Badge>
            <CardTitle className="text-heading-2 font-semibold text-foreground">
              Almost ready to post!
            </CardTitle>
            <CardDescription className="text-body-normal text-muted-foreground">
              Automatic clipboard copy was restricted. Please select and copy your text below.
            </CardDescription>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {/* Re-copy feedback banner if present */}
        {copyFeedbackNotice && (
          <div
            role="status"
            className="rounded-lg bg-surface-subtle border border-border-subtle p-2.5 text-xs text-foreground text-center"
            data-testid="copy-feedback-notice"
          >
            {copyFeedbackNotice}
          </div>
        )}

        {/* Conditional View: Manual Copy Fallback Box vs Step Instructions */}
        {clipboardState === 'fallback' ? (
          <div className="space-y-2" data-testid="manual-copy-box">
            <label
              htmlFor="manual-copy-textarea"
              className="text-xs font-semibold text-foreground flex items-center justify-between"
            >
              <span>Your Review Text</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Tap box to select all
              </span>
            </label>

            <Textarea
              id="manual-copy-textarea"
              value={draft ?? ''}
              readOnly
              onClick={(e) => e.currentTarget.select()}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Customer review draft to copy manually"
              className="min-h-[120px] text-sm leading-relaxed p-3 bg-surface-subtle select-all font-normal"
              data-testid="manual-copy-textarea"
            />

            <p className="text-xs text-muted-foreground">
              💡 <strong>Mobile tip:</strong> Press and hold inside the box above, tap{' '}
              <strong>Copy</strong>, then open Google Maps below.
            </p>

            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={isCopying}
              onClick={handleCopyAgain}
              className="w-full min-h-[44px] text-xs font-medium"
              data-testid="retry-copy-button"
            >
              {isCopying ? 'Copying...' : 'Try Automatic Copy Again ↻'}
            </Button>
          </div>
        ) : (
          /* 4-Step Instructions Card */
          <div
            className="rounded-lg bg-surface-subtle border border-border-subtle p-3.5 space-y-2.5 text-left"
            data-testid="posting-instructions-card"
          >
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              How to post on Google Maps:
            </p>
            <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                Tap <strong className="text-foreground">Open Google Maps</strong> below.
              </li>
              <li>
                Select your <strong className="text-foreground">Star Rating</strong> based on your
                visit.
              </li>
              <li>
                Press &amp; hold the review box and tap <strong className="text-foreground">Paste</strong>.
              </li>
              <li>
                Personalize any details you like, then tap{' '}
                <strong className="text-foreground">Post</strong>.
              </li>
            </ol>
          </div>
        )}

        {/* Action Controls */}
        <div className="space-y-2 pt-2">
          {/* Primary Action (Second Click in Two-Click Handoff): Open Google Maps to Post (EVENT_GOOGLE_REDIRECT_CLICK) */}
          <Button
            type="button"
            variant="accent"
            size="touch"
            onClick={handleLaunchGoogleMaps}
            className="w-full font-semibold text-base min-h-[48px]"
            data-testid="open-google-maps-button"
          >
            {hasConfiguredGoogle
              ? 'Open Google Maps to Post →'
              : 'Search on Google Maps to Post →'}
          </Button>

          {/* Secondary Action: Re-copy button in success state */}
          {clipboardState === 'success' && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={isCopying}
              onClick={handleCopyAgain}
              className="w-full min-h-[44px] text-xs font-medium"
              data-testid="recopy-review-button"
            >
              {isCopying ? 'Copying...' : 'Copy Review Text Again ↻'}
            </Button>
          )}

          {/* Optional Back to Editor Action */}
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={onBack}
              className="w-full min-h-[44px] text-xs text-muted-foreground hover:text-foreground"
              data-testid="handoff-back-to-editor-button"
            >
              ← Edit Review Draft
            </Button>
          )}

          {/* Independent Direct Google Review Bypass Link (EVENT_GOOGLE_BYPASS_CLICK) */}
          <div className="pt-2 border-t border-border-subtle mt-2 text-center">
            <button
              type="button"
              onClick={handleDirectGoogleBypass}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer py-1"
              data-testid="handoff-direct-bypass-link"
            >
              Review directly on Google without copied text ↗
            </button>
          </div>

          {/* Optional WhatsApp Manager Contact Link */}
          {whatsAppUrl && (
            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={() => {
                  window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
                }}
                className="w-full min-h-[44px] text-xs text-muted-foreground hover:text-foreground"
                data-testid="whatsapp-contact-button"
              >
                Message Manager on WhatsApp ↗
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default HandoffPage;
