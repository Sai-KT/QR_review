import * as React from 'react';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  getCategoryLabel,
  getInitials,
  sanitizeGoogleReviewUrl,
  formatWhatsAppUrl,
  getClientSessionUuid,
} from '../../lib/utils/customer';
import { trackEvent } from '../../lib/api/analytics';

export type GenerationFallbackMode =
  | 'timeout'            // SCR-CUST-10: Gemini generation timeout or retryable provider failure
  | 'quota_exhausted'    // SCR-CUST-11: Monthly business quota exhausted (HTTP 429 ERR_QUOTA_EXHAUSTED)
  | 'abstained'          // SCR-CUST-10 Abstention: Insufficient affirmative facts to generate authentic review (M0-16)
  | 'rate_limited'       // HTTP 429 ERR_RATE_LIMITED: Session / NAT IP rate limit (distinct from merchant quota)
  | 'token_expired'      // HTTP 401 ERR_TOKEN_EXPIRED: Expired survey submission token (cannot retry with stale token)
  | 'conflict'           // HTTP 409 ERR_CONCURRENT_REQUEST / ERR_IDEMPOTENCY_MISMATCH
  | 'generic_error';     // Unclassified or non-retryable generation error

/**
 * Classifies runtime errors or response payloads into specific fallback UX modes.
 *
 * Enforces strict boundary rules:
 * - HTTP 429 ERR_QUOTA_EXHAUSTED is mapped strictly to 'quota_exhausted'
 * - Session/IP rate limits (HTTP 429 ERR_RATE_LIMITED) are mapped to 'rate_limited', NEVER quota exhaustion
 * - HTTP 504 ERR_GEMINI_TIMEOUT or retryable errors are mapped to 'timeout'
 * - HTTP 409 concurrency conflicts are mapped to 'conflict', NEVER timeout
 * - HTTP 401 expired tokens are mapped to 'token_expired', disallowing retry with invalid credentials
 * - Responses with abstained=true or reason='INSUFFICIENT_FACTS' are mapped to 'abstained'
 */
// eslint-disable-next-line react-refresh/only-export-components
export function classifyGenerationError(error: unknown): GenerationFallbackMode {
  if (!error) return 'generic_error';

  // Check for abstained flag in response or error object (M0-16 Insufficient Facts)
  if (typeof error === 'object' && error !== null) {
    if ('abstained' in error && Boolean((error as { abstained?: boolean }).abstained)) {
      return 'abstained';
    }
    if (
      'reason' in error &&
      ((error as { reason?: string }).reason === 'INSUFFICIENT_FACTS' ||
        (error as { reason?: string }).reason === 'insufficient_facts')
    ) {
      return 'abstained';
    }
    if (
      'abstentionReason' in error &&
      ((error as { abstentionReason?: string }).abstentionReason === 'INSUFFICIENT_FACTS' ||
        (error as { abstentionReason?: string }).abstentionReason === 'insufficient_facts')
    ) {
      return 'abstained';
    }
  }

  const code = (error as { code?: string })?.code;
  const status = (error as { status?: number })?.status;

  // 1. Quota Exhaustion: Strictly ERR_QUOTA_EXHAUSTED
  if (code === 'ERR_QUOTA_EXHAUSTED') {
    return 'quota_exhausted';
  }

  // 2. Timeout: 504 or ERR_GEMINI_TIMEOUT / ERR_TIMEOUT
  if (status === 504 || code === 'ERR_GEMINI_TIMEOUT' || code === 'ERR_TIMEOUT') {
    return 'timeout';
  }

  // 3. Retryable provider errors or network drops:
  if (
    code === 'ERR_PROVIDER_ERROR' ||
    code === 'ERR_PROVIDER_RATE_LIMITED' ||
    code === 'ERR_NETWORK_ERROR'
  ) {
    return 'timeout';
  }

  // 4. Session / NAT IP Rate Limiting (HTTP 429 ERR_RATE_LIMITED / ERR_RATE_LIMIT_EXCEEDED / ERR_MAX_ATTEMPTS_EXCEEDED)
  // Must NOT be labeled as monthly quota exhaustion!
  if (
    code === 'ERR_RATE_LIMITED' ||
    code === 'ERR_RATE_LIMIT_EXCEEDED' ||
    code === 'ERR_MAX_ATTEMPTS_EXCEEDED' ||
    (status === 429 && code !== 'ERR_QUOTA_EXHAUSTED')
  ) {
    return 'rate_limited';
  }

  // 5. Expired token (HTTP 401 ERR_TOKEN_EXPIRED / ERR_SUBMISSION_EXPIRED)
  // Do NOT classify ERR_UNAUTHORIZED (e.g. invalid anon key) as token_expired!
  if (
    code === 'ERR_TOKEN_EXPIRED' ||
    code === 'ERR_SUBMISSION_EXPIRED' ||
    (status === 401 && code !== 'ERR_UNAUTHORIZED')
  ) {
    return 'token_expired';
  }

  // 6. Concurrency / Idempotency Conflict (HTTP 409 ERR_CONCURRENT_REQUEST / ERR_IDEMPOTENCY_MISMATCH / ERR_ALREADY_COMMITTED)
  if (
    status === 409 ||
    code === 'ERR_CONCURRENT_REQUEST' ||
    code === 'ERR_IDEMPOTENCY_MISMATCH' ||
    code === 'ERR_ALREADY_COMMITTED'
  ) {
    return 'conflict';
  }

  return 'generic_error';
}

// eslint-disable-next-line react-refresh/only-export-components
export function isGenerationTimeoutError(error: unknown): boolean {
  return classifyGenerationError(error) === 'timeout';
}

// eslint-disable-next-line react-refresh/only-export-components
export function isQuotaExhaustedError(error: unknown): boolean {
  return classifyGenerationError(error) === 'quota_exhausted';
}

// ============================================================================
// 1. SCR-CUST-10: Generation Timeout & Single Eligible Retry Card
// ============================================================================

export interface GenerationTimeoutCardProps {
  business: PublicBusinessProjection;
  /** Whether the patron is eligible for a retry (default: true unless already used) */
  canRetry?: boolean;
  /** Callback triggered when customer taps retry. Required for retry button to appear. */
  onRetry?: () => Promise<void> | void;
  /** External flag indicating a retry is actively in flight */
  isRetrying?: boolean;
  /** Callback when customer taps direct Google review bypass */
  onDirectGoogleClick?: () => void;
  /** Callback when customer chooses to compose review manually without AI suggestion */
  onComposeManually?: () => void;
  /** Callback when customer taps back to survey */
  onBackToSurvey?: () => void;
  className?: string;
}

/**
 * GenerationTimeoutCard (SCR-CUST-10)
 *
 * Presented when Gemini AI review generation exceeds the deadline (>8.0s HTTP 504)
 * or encounters a temporary retryable provider error.
 *
 * Core Invariants:
 * - Calm, reassuring explanation without alarming or blaming the customer
 * - Exactly ONE customer-triggered retry allowed per session
 * - Disabled immediately upon activation; double-click and in-flight concurrency protected
 * - Failed retry does not reset retry allowance; rerenders preserve retry state
 * - Zero automatic generation on component mount
 * - Permanent direct Google review bypass (Core Invariant #7)
 * - Telemetry event EVENT_GOOGLE_BYPASS_CLICK emitted on direct Google click
 */
export function GenerationTimeoutCard({
  business,
  canRetry = true,
  onRetry,
  isRetrying = false,
  onDirectGoogleClick,
  onComposeManually,
  onBackToSurvey,
  className,
}: GenerationTimeoutCardProps): React.JSX.Element {
  const [hasRetried, setHasRetried] = React.useState(false);
  const [internalRetrying, setInternalRetrying] = React.useState(false);
  const isExecutingRetryRef = React.useRef(false);
  const isBypassingRef = React.useRef(false);

  const [imageError, setImageError] = React.useState(false);
  const initials = getInitials(business.name);
  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);

  const isRetryingActive = isRetrying || internalRetrying;
  const isRetryAvailable = Boolean(onRetry) && canRetry !== false && !hasRetried;

  const handleRetryClick = async () => {
    if (!isRetryAvailable || isExecutingRetryRef.current || isRetryingActive) {
      return;
    }

    isExecutingRetryRef.current = true;
    setHasRetried(true);
    setInternalRetrying(true);

    try {
      await onRetry?.();
    } catch {
      // Failed retry does NOT reset retry allowance
    } finally {
      setInternalRetrying(false);
      isExecutingRetryRef.current = false;
    }
  };

  const handleGoogleClick = () => {
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
    onDirectGoogleClick?.();

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

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
      role="region"
      aria-label="Generation Timeout Recovery"
      data-testid="generation-timeout-card"
    >
      {/* ARIA Live Region for Screen Readers */}
      <div role="status" aria-live="polite" className="sr-only">
        {isRetryingActive ? 'Retrying review draft generation, please wait...' : ''}
      </div>

      <CardHeader className="flex flex-col items-center pb-3">
        {/* Merchant Branding Avatar */}
        {business.logoUrl && !imageError ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            className="h-12 w-12 rounded-full object-cover border border-border shadow-xs mb-2"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-lg border border-primary/20 mb-2 select-none"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <Badge variant="outline" className="mb-2 text-xs">
          {getCategoryLabel(business.categoryId)}
        </Badge>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {business.name}
        </p>

        {/* Timeout Indicator Icon */}
        <div
          className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-state-warning-bg text-state-warning text-xl font-bold"
          aria-hidden="true"
        >
          ⏱
        </div>

        <CardTitle className="text-heading-2 font-semibold text-foreground">
          Your review draft is taking longer than expected
        </CardTitle>

        <CardDescription className="text-sm mt-2 text-muted-foreground leading-relaxed">
          We couldn&apos;t prepare a suggestion this time. Your feedback is still valuable, and you can write directly on Google.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        {/* Exactly One Eligible Customer-Triggered Retry */}
        {onRetry && (
          <div>
            {isRetryingActive ? (
              <Button
                type="button"
                variant="outline"
                size="touch"
                disabled
                aria-busy="true"
                className="w-full font-semibold min-h-[48px] border-primary/40 text-primary cursor-wait"
                data-testid="timeout-retry-spinner"
              >
                <span className="inline-block animate-spin mr-2 motion-reduce:animate-none">↻</span>
                Retrying Generation...
              </Button>
            ) : hasRetried ? (
              <Button
                type="button"
                variant="outline"
                size="touch"
                disabled
                aria-disabled="true"
                className="w-full font-medium min-h-[48px] opacity-60 cursor-not-allowed"
                data-testid="timeout-retry-disabled"
              >
                Retry Limit Reached (1/1)
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={handleRetryClick}
                disabled={!isRetryAvailable}
                className="w-full font-semibold min-h-[48px]"
                data-testid="timeout-retry-button"
              >
                ↻ Retry Generation
              </Button>
            )}
          </div>
        )}

        {/* Permanent Primary Anti-Gating Action: Direct Google Review */}
        <Button
          type="button"
          variant="accent"
          size="touch"
          onClick={handleGoogleClick}
          className="w-full font-semibold min-h-[48px]"
          data-testid="timeout-direct-google-button"
        >
          {hasConfiguredGoogle
            ? 'Write Review Directly on Google →'
            : 'Search on Google Maps to Review ↗'}
        </Button>

        {/* Optional Secondary Action: Write in Your Own Words */}
        {onComposeManually && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onComposeManually}
            className="w-full text-sm font-medium min-h-[44px]"
            data-testid="timeout-compose-manually-button"
          >
            ✏️ Write in Your Own Words
          </Button>
        )}

        {/* Optional Secondary Action: Back to Survey */}
        {onBackToSurvey && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onBackToSurvey}
            className="w-full text-xs text-muted-foreground min-h-[44px]"
            data-testid="timeout-back-to-survey-button"
          >
            ← Back to Quick Survey
          </Button>
        )}

        {/* Optional WhatsApp Manager Link */}
        {whatsAppUrl && (
          <div className="pt-2 border-t border-border-subtle mt-2">
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => window.open(whatsAppUrl, '_blank', 'noopener,noreferrer')}
              className="w-full text-xs text-muted-foreground min-h-[44px]"
              data-testid="timeout-whatsapp-link"
            >
              💬 Chat with Manager on WhatsApp
            </Button>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2 pb-4 flex justify-center">
        <p className="text-xs text-muted-foreground">
          Zero friction • No login required • Direct access preserved
        </p>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 2. SCR-CUST-11: Monthly Quota Exhaustion Fallback Card
// ============================================================================

export interface QuotaExhaustedCardProps {
  business: PublicBusinessProjection;
  /** Callback when customer taps direct Google review bypass */
  onDirectGoogleClick?: () => void;
  /** Callback when customer chooses to compose review manually without AI suggestion */
  onComposeManually?: () => void;
  /** Callback when customer taps back to survey */
  onBackToSurvey?: () => void;
  className?: string;
}

/**
 * QuotaExhaustedCard (SCR-CUST-11)
 *
 * Presented strictly when the merchant's monthly AI generation limit has been reached
 * (HTTP 429 ERR_QUOTA_EXHAUSTED).
 *
 * Core Invariants:
 * - Brand-safe degradation: polite notification explaining automated assistance limit
 * - Strict Zero Secret Exposure: Never reveals internal quota accounting (e.g. 150/month),
 *   database usage counters, merchant subscription keys, or billing records
 * - Never blames the customer or implies Google reviews are unavailable
 * - No non-functional retry button is rendered
 * - Direct Google review access remains immediately available (Core Invariant #7)
 * - Emits EVENT_GOOGLE_BYPASS_CLICK telemetry non-blockingly
 */
export function QuotaExhaustedCard({
  business,
  onDirectGoogleClick,
  onComposeManually,
  onBackToSurvey,
  className,
}: QuotaExhaustedCardProps): React.JSX.Element {
  const isBypassingRef = React.useRef(false);
  const [imageError, setImageError] = React.useState(false);
  const initials = getInitials(business.name);
  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);

  const handleGoogleClick = () => {
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
    onDirectGoogleClick?.();

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

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
      role="region"
      aria-label="AI Review Assistance Unavailable"
      data-testid="quota-exhausted-card"
    >
      <CardHeader className="flex flex-col items-center pb-3">
        {/* Merchant Branding Avatar */}
        {business.logoUrl && !imageError ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            className="h-12 w-12 rounded-full object-cover border border-border shadow-xs mb-2"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-lg border border-primary/20 mb-2 select-none"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <Badge variant="outline" className="mb-2 text-xs">
          {getCategoryLabel(business.categoryId)}
        </Badge>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {business.name}
        </p>

        {/* Informative Icon */}
        <div
          className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground text-xl font-bold"
          aria-hidden="true"
        >
          ℹ
        </div>

        <CardTitle className="text-heading-2 font-semibold text-foreground">
          AI review assistance is temporarily unavailable
        </CardTitle>

        <CardDescription className="text-sm mt-2 text-muted-foreground leading-relaxed">
          This business has reached its monthly AI drafting limit. You can still share your experience directly on Google.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        {/* Primary Action: Direct Google Review Bypass */}
        <Button
          type="button"
          variant="accent"
          size="touch"
          onClick={handleGoogleClick}
          className="w-full font-semibold min-h-[48px]"
          data-testid="quota-direct-google-button"
        >
          {hasConfiguredGoogle
            ? 'Write Review Directly on Google →'
            : 'Search on Google Maps to Review ↗'}
        </Button>

        {/* Optional Secondary Action: Write in Your Own Words */}
        {onComposeManually && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onComposeManually}
            className="w-full text-sm font-medium min-h-[44px]"
            data-testid="quota-compose-manually-button"
          >
            ✏️ Write in Your Own Words
          </Button>
        )}

        {/* Optional Secondary Action: Back to Survey */}
        {onBackToSurvey && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onBackToSurvey}
            className="w-full text-xs text-muted-foreground min-h-[44px]"
            data-testid="quota-back-to-survey-button"
          >
            ← Back to Quick Survey
          </Button>
        )}

        {/* Optional WhatsApp Manager Contact Link */}
        {whatsAppUrl && (
          <div className="pt-2 border-t border-border-subtle mt-2">
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => window.open(whatsAppUrl, '_blank', 'noopener,noreferrer')}
              className="w-full text-xs text-muted-foreground min-h-[44px]"
              data-testid="quota-whatsapp-link"
            >
              💬 Chat with Manager on WhatsApp
            </Button>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-2 pb-4 flex justify-center">
        <p className="text-xs text-muted-foreground">
          Direct Google review is always free and open to all patrons
        </p>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 3. SCR-CUST-10 Abstention: Insufficient Facts Card (Founder Decision M0-16)
// ============================================================================

export interface InsufficientFactsCardProps {
  business: PublicBusinessProjection;
  onDirectGoogleClick?: () => void;
  onComposeManually?: () => void;
  onBackToSurvey?: () => void;
  className?: string;
}

/**
 * InsufficientFactsCard (M0-16 Grounding Policy)
 *
 * Presented when customer feedback contains only neutral or N/A answers and no specific note.
 * Prohibits fabricating false praise or hallucinations; abstains and offers customer choice.
 */
export function InsufficientFactsCard({
  business,
  onDirectGoogleClick,
  onComposeManually,
  onBackToSurvey,
  className,
}: InsufficientFactsCardProps): React.JSX.Element {
  const isBypassingRef = React.useRef(false);
  const [imageError, setImageError] = React.useState(false);
  const initials = getInitials(business.name);
  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);

  const handleGoogleClick = () => {
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
    onDirectGoogleClick?.();

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

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
      role="region"
      aria-label="Insufficient Information to Draft Review"
      data-testid="insufficient-facts-card"
    >
      <CardHeader className="flex flex-col items-center pb-3">
        {business.logoUrl && !imageError ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            className="h-12 w-12 rounded-full object-cover border border-border shadow-xs mb-2"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-lg border border-primary/20 mb-2 select-none"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <Badge variant="outline" className="mb-2 text-xs">
          {getCategoryLabel(business.categoryId)}
        </Badge>

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          {business.name}
        </p>

        <div
          className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground text-xl font-bold"
          aria-hidden="true"
        >
          ✏️
        </div>

        <CardTitle className="text-heading-2 font-semibold text-foreground">
          We couldn&apos;t generate a specific review draft
        </CardTitle>

        <CardDescription className="text-sm mt-2 text-muted-foreground leading-relaxed">
          We cannot generate a reliable draft from the provided information. Your feedback is still valuable, and you can write directly on Google or compose in your own words.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="accent"
          size="touch"
          onClick={handleGoogleClick}
          className="w-full font-semibold min-h-[48px]"
          data-testid="insufficient-direct-google-button"
        >
          {hasConfiguredGoogle
            ? 'Write Review Directly on Google →'
            : 'Search on Google Maps to Review ↗'}
        </Button>

        {onComposeManually && (
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={onComposeManually}
            className="w-full font-medium min-h-[44px]"
            data-testid="insufficient-compose-manually-button"
          >
            Write in Your Own Words
          </Button>
        )}

        {onBackToSurvey && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onBackToSurvey}
            className="w-full text-xs text-muted-foreground min-h-[44px]"
            data-testid="insufficient-back-to-survey-button"
          >
            ← Back to Quick Survey
          </Button>
        )}
      </CardContent>

      <CardFooter className="pt-2 pb-4 flex justify-center">
        <p className="text-xs text-muted-foreground">
          Grounded reviews • Zero fabricated claims
        </p>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 4. Session Rate Limited Notice Card (Non-Quota 429 ERR_RATE_LIMITED)
// ============================================================================

export interface RateLimitedNoticeCardProps {
  business: PublicBusinessProjection;
  onDirectGoogleClick?: () => void;
  onBackToSurvey?: () => void;
  className?: string;
}

/**
 * RateLimitedNoticeCard
 *
 * Presented when patron hits temporary session or IP velocity limits (HTTP 429 ERR_RATE_LIMITED).
 * Critical Invariant: Distinct from monthly merchant quota exhaustion (ERR_QUOTA_EXHAUSTED).
 */
export function RateLimitedNoticeCard({
  business,
  onDirectGoogleClick,
  onBackToSurvey,
  className,
}: RateLimitedNoticeCardProps): React.JSX.Element {
  const isBypassingRef = React.useRef(false);
  const [imageError, setImageError] = React.useState(false);
  const initials = getInitials(business.name);
  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);

  const handleGoogleClick = () => {
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
    onDirectGoogleClick?.();

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

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
      role="region"
      aria-label="Too Many Requests"
      data-testid="rate-limited-notice-card"
    >
      <CardHeader className="pb-3">
        {business.logoUrl && !imageError ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            className="h-12 w-12 rounded-full object-cover border border-border shadow-xs mb-2 mx-auto"
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-lg border border-primary/20 mb-2 select-none"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <div
          className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-state-warning-bg text-state-warning text-xl font-bold"
          aria-hidden="true"
        >
          ⏱
        </div>

        <CardTitle className="text-heading-2 font-semibold text-foreground">
          Too many generation requests
        </CardTitle>

        <CardDescription className="text-sm mt-2 text-muted-foreground leading-relaxed">
          You have reached the maximum number of attempts for this session. Please wait a moment, or share your review directly on Google.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="accent"
          size="touch"
          onClick={handleGoogleClick}
          className="w-full font-semibold min-h-[48px]"
          data-testid="ratelimit-direct-google-button"
        >
          {hasConfiguredGoogle
            ? 'Write Review Directly on Google →'
            : 'Search on Google Maps to Review ↗'}
        </Button>

        {onBackToSurvey && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={onBackToSurvey}
            className="w-full text-xs text-muted-foreground min-h-[44px]"
          >
            ← Back to Quick Survey
          </Button>
        )}
      </CardContent>

      <CardFooter className="pt-2 pb-4 flex justify-center">
        <p className="text-xs text-muted-foreground">
          Anti-abuse protection • Direct Google review available
        </p>
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 5. Composite GenerationFallbacks View Component
// ============================================================================

export interface GenerationFallbacksProps {
  /** Merchant store details */
  business: PublicBusinessProjection;
  /** Explicit mode or auto-classified from error */
  mode?: GenerationFallbackMode;
  /** Raw error object (ApiClientError, Response, or { status, code }) */
  error?: unknown;
  /** Whether the patron is eligible for a retry (timeout mode) */
  canRetry?: boolean;
  /** Customer-triggered retry callback */
  onRetry?: () => Promise<void> | void;
  /** External flag indicating a retry is actively in flight */
  isRetrying?: boolean;
  /** Direct Google review bypass callback */
  onDirectGoogleClick?: () => void;
  /** Callback when customer chooses to compose review manually without AI */
  onComposeManually?: () => void;
  /** Callback when customer taps back to survey */
  onBackToSurvey?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * GenerationFallbacks (Composite View)
 *
 * Automatically resolves the appropriate fallback card based on explicit mode or error inspection:
 * - 'timeout' -> GenerationTimeoutCard (SCR-CUST-10)
 * - 'quota_exhausted' -> QuotaExhaustedCard (SCR-CUST-11)
 * - 'abstained' -> InsufficientFactsCard (M0-16)
 * - 'rate_limited' -> RateLimitedNoticeCard
 * - other -> Default fallback card offering direct Google review bypass
 */
export function GenerationFallbacks({
  business,
  mode,
  error,
  canRetry = true,
  onRetry,
  isRetrying = false,
  onDirectGoogleClick,
  onComposeManually,
  onBackToSurvey,
  className,
}: GenerationFallbacksProps): React.JSX.Element {
  const activeMode: GenerationFallbackMode = React.useMemo(() => {
    if (mode) return mode;
    if (error) return classifyGenerationError(error);
    return 'generic_error';
  }, [mode, error]);

  switch (activeMode) {
    case 'timeout':
      return (
        <GenerationTimeoutCard
          business={business}
          canRetry={canRetry}
          onRetry={onRetry}
          isRetrying={isRetrying}
          onDirectGoogleClick={onDirectGoogleClick}
          onComposeManually={onComposeManually}
          onBackToSurvey={onBackToSurvey}
          className={className}
        />
      );

    case 'quota_exhausted':
      return (
        <QuotaExhaustedCard
          business={business}
          onDirectGoogleClick={onDirectGoogleClick}
          onComposeManually={onComposeManually}
          onBackToSurvey={onBackToSurvey}
          className={className}
        />
      );

    case 'abstained':
      return (
        <InsufficientFactsCard
          business={business}
          onDirectGoogleClick={onDirectGoogleClick}
          onComposeManually={onComposeManually}
          onBackToSurvey={onBackToSurvey}
          className={className}
        />
      );

    case 'rate_limited':
      return (
        <RateLimitedNoticeCard
          business={business}
          onDirectGoogleClick={onDirectGoogleClick}
          onBackToSurvey={onBackToSurvey}
          className={className}
        />
      );

    case 'token_expired':
    case 'conflict':
    case 'generic_error':
    default:
      // Generic recovery view preserving anti-gating direct Google review access
      return (
        <Card
          className={`w-full max-w-md mx-auto shadow-md border-border text-center ${className ?? ''}`.trim()}
          role="region"
          aria-label="Generation Assistance Unavailable"
          data-testid="generation-generic-fallback-card"
        >
          <CardHeader className="pb-3">
            <div
              className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-state-warning-bg text-state-warning text-xl font-bold"
              aria-hidden="true"
            >
              !
            </div>
            <CardTitle className="text-heading-2 font-semibold text-foreground">
              {activeMode === 'token_expired'
                ? 'Submission Session Expired'
                : activeMode === 'conflict'
                  ? 'Request Already in Progress'
                  : 'Unable to Generate Review Draft'}
            </CardTitle>
            <CardDescription className="text-sm mt-2 text-muted-foreground leading-relaxed">
              {activeMode === 'token_expired'
                ? 'This survey submission session has expired. You can review directly on Google or submit a new survey.'
                : activeMode === 'conflict'
                  ? 'A review generation request is already active or was previously processed for this survey.'
                  : "We encountered an issue preparing your review draft. You can write your review directly on Google."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <Button
              type="button"
              variant="accent"
              size="touch"
              onClick={() => {
                const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
                const dest = cleanGoogleUrl || 'https://www.google.com/maps';
                window.open(dest, '_blank', 'noopener,noreferrer');
                onDirectGoogleClick?.();
              }}
              className="w-full font-semibold min-h-[48px]"
              data-testid="generic-direct-google-button"
            >
              Write Review Directly on Google →
            </Button>
            {onComposeManually && (
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={onComposeManually}
                className="w-full font-medium min-h-[44px]"
              >
                Write in Your Own Words
              </Button>
            )}
            {onBackToSurvey && (
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={onBackToSurvey}
                className="w-full text-xs text-muted-foreground min-h-[44px]"
              >
                ← Back to Quick Survey
              </Button>
            )}
          </CardContent>
          <CardFooter className="pt-2 pb-4 flex justify-center">
            <p className="text-xs text-muted-foreground">
              Direct Google review is always accessible
            </p>
          </CardFooter>
        </Card>
      );
  }
}
