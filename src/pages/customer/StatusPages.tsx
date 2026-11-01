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
} from '../../lib/utils/customer';

// ----------------------------------------------------------------------------
// 1. SCR-CUST-12: Invalid QR Identifier (404)
// ----------------------------------------------------------------------------

export interface InvalidQrCardProps {
  qrToken?: string;
  onRetry?: () => void;
  activeTokenText?: string;
  className?: string;
}

/**
 * InvalidQrCard (SCR-CUST-12)
 *
 * Rendered when a scanned QR code does not exist in the database or is malformed.
 * Invariants:
 *   - Friendly, neutral explanation without technical jargon or database error codes
 *   - Zero leakage of internal tenant UUIDs, database schemas, or billing info
 *   - Universal generic Google Maps search action (honestly labeled)
 *   - Safe retry / scan again action
 */
export function InvalidQrCard({
  qrToken,
  onRetry,
  activeTokenText,
  className,
}: InvalidQrCardProps): React.JSX.Element {
  const tokenDisplay = activeTokenText ?? `Active QR token parameter: "${qrToken ?? 'unspecified'}"`;

  return (
    <Card
      className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}
      role="region"
      aria-label="QR Code Not Recognized"
    >
      <CardHeader className="pb-3">
        <div
          className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold">?</span>
        </div>
        <CardTitle className="text-heading-2">QR Code Not Recognized</CardTitle>
        <CardDescription className="text-sm mt-2 text-muted-foreground">
          This QR code is not recognized or may have been mistyped. Please verify the code with staff.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="w-full"
          onClick={() => {
            window.open('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
          }}
        >
          Search on Google Maps ↗
        </Button>

        {onRetry && (
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="w-full"
            onClick={onRetry}
          >
            Scan Again / Retry
          </Button>
        )}
      </CardContent>

      <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
        <p className="text-xs text-muted-foreground">{tokenDisplay}</p>
      </CardFooter>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 2. SCR-CUST-13: Suspended Business Notice (403)
// ----------------------------------------------------------------------------

export interface SuspendedBusinessCardProps {
  qrToken?: string;
  activeTokenText?: string;
  className?: string;
}

/**
 * SuspendedBusinessCard (SCR-CUST-13)
 *
 * Rendered when a business account is suspended or inactive.
 * Invariants:
 *   - Strict privacy & information minimization: zero disclosure of billing, suspension cause,
 *     owner identity, or admin decisions.
 *   - Zero merchant-specific URLs, WhatsApp actions, or review links manufactured.
 *   - No survey CTA or feedback submission possible.
 */
export function SuspendedBusinessCard({
  qrToken,
  activeTokenText,
  className,
}: SuspendedBusinessCardProps): React.JSX.Element {
  const tokenDisplay = activeTokenText ?? `Active QR token parameter: "${qrToken ?? 'unspecified'}"`;

  return (
    <Card
      className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}
      role="region"
      aria-label="Feedback Temporarily Unavailable"
    >
      <CardHeader className="pb-3">
        <div
          className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-warning-bg text-state-warning"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold">!</span>
        </div>
        <CardTitle className="text-heading-2">Feedback Temporarily Unavailable</CardTitle>
        <CardDescription className="text-sm mt-2 text-muted-foreground">
          Review collection for this location is currently paused. Please speak directly with the team for assistance.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-2">
        <div className="rounded-md bg-surface-subtle p-3 text-xs text-muted-foreground">
          Zero private data or account suspension details are exposed to public patrons.
        </div>
      </CardContent>

      <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
        <p className="text-xs text-muted-foreground">{tokenDisplay}</p>
      </CardFooter>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 3. SCR-CUST-14: Direct Google-Only Mode (Lapsed Subscription)
// ----------------------------------------------------------------------------

export interface DirectOnlyCardProps {
  business: PublicBusinessProjection;
  activeTokenText?: string;
  className?: string;
}

/**
 * DirectOnlyCard (SCR-CUST-14)
 *
 * Rendered when a merchant subscription has lapsed but the QR code remains in circulation.
 * Invariants:
 *   - Never shows "subscription expired", "payment failed", or billing details.
 *   - Shows verified merchant branding (name, logo or monogram, category badge).
 *   - Immediate direct Google review action using validated merchant googleReviewUrl.
 *   - If review URL is missing/invalid, honestly labels generic fallback as "Search on Google Maps ↗".
 *   - Optional WhatsApp manager contact if allowed and valid.
 *   - Complete bypass of AI survey flow without dead ends.
 */
export function DirectOnlyCard({
  business,
  activeTokenText,
  className,
}: DirectOnlyCardProps): React.JSX.Element {
  const [logoFailed, setLogoFailed] = React.useState(false);

  const tokenDisplay =
    activeTokenText ?? `Active QR token parameter: "${business.publicQrId}"`;

  const sanitizedGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationUrl = sanitizedGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredReviewUrl = Boolean(sanitizedGoogleUrl);

  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);
  const categoryLabel = getCategoryLabel(business.categoryId);
  const initials = getInitials(business.name);

  return (
    <Card
      className={`w-full shadow-md border-border ${className ?? ''}`.trim()}
      role="region"
      aria-label={`Direct Review for ${business.name}`}
    >
      <CardHeader className="flex flex-col items-center text-center pb-3">
        {business.logoUrl && !logoFailed ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            onError={() => setLogoFailed(true)}
            className="h-16 w-16 rounded-full object-cover border border-border shadow-xs mb-2"
          />
        ) : (
          <div
            className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl mb-2"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <CardTitle className="text-heading-2">{business.name}</CardTitle>
        {categoryLabel && (
          <Badge variant="secondary" size="sm" className="mt-1">
            {categoryLabel}
          </Badge>
        )}

        <CardDescription className="text-sm mt-2 text-muted-foreground">
          We are currently collecting direct reviews on Google Maps. Thank you for your support!
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="accent"
          size="touch"
          className="w-full font-semibold"
          onClick={() => {
            window.open(destinationUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          {hasConfiguredReviewUrl
            ? 'Open Google Maps to Review ↗'
            : 'Search on Google Maps ↗'}
        </Button>

        {whatsAppUrl && (
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() => {
              window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            WhatsApp Manager
          </Button>
        )}
      </CardContent>

      <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
        <p className="text-xs text-muted-foreground">{tokenDisplay}</p>
      </CardFooter>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// 4. SCR-CUST-15: Offline / Cellular Connection Recovery
// ----------------------------------------------------------------------------

export interface OfflineRecoveryCardProps {
  onRetry: () => void | Promise<void>;
  cachedGoogleUrl?: string | null;
  hasAnswers?: boolean;
  activeTokenText?: string;
  className?: string;
}

/**
 * OfflineRecoveryCard (SCR-CUST-15 — Full Screen State)
 *
 * Rendered when initial load or resolution fails due to cellular / Wi-Fi disconnection.
 * Invariants:
 *   - Informs customer of connection loss without technical codes
 *   - Confirms answers are preserved if mid-journey
 *   - Clear "Retry Connection" action
 *   - Cached direct Google Maps action if previously verified
 */
export function OfflineRecoveryCard({
  onRetry,
  cachedGoogleUrl,
  hasAnswers = false,
  activeTokenText,
  className,
}: OfflineRecoveryCardProps): React.JSX.Element {
  const sanitizedGoogleUrl = sanitizeGoogleReviewUrl(cachedGoogleUrl);
  const destinationUrl = sanitizedGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(sanitizedGoogleUrl);

  return (
    <Card
      className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}
      role="alert"
      aria-live="polite"
    >
      <CardHeader className="pb-3">
        <div
          className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-warning-bg text-state-warning"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold">⚡</span>
        </div>
        <CardTitle className="text-heading-2">Connection Lost</CardTitle>
        <CardDescription className="text-sm mt-2 text-muted-foreground">
          {hasAnswers
            ? 'Please check your internet connection. Your current answers are still here.'
            : 'Please check your cellular data or Wi-Fi connection and tap below to retry.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="default"
          size="touch"
          className="w-full font-semibold"
          onClick={() => void onRetry()}
        >
          Retry Connection
        </Button>

        <Button
          type="button"
          variant="outline"
          size="touch"
          className="w-full"
          onClick={() => {
            window.open(destinationUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          {hasConfiguredGoogle
            ? 'Open Google Maps Directly ↗'
            : 'Search on Google Maps ↗'}
        </Button>
      </CardContent>

      {activeTokenText && (
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      )}
    </Card>
  );
}

export interface OfflineConnectionBannerProps {
  onRetry?: () => void | Promise<void>;
  cachedGoogleUrl?: string | null;
  className?: string;
}

/**
 * OfflineConnectionBanner (SCR-CUST-15 — Sticky / Top Banner)
 *
 * Displays a non-intrusive alert when the customer loses network connectivity mid-survey.
 * Preserves in-flight answers and allows immediate reconnection testing.
 */
export function OfflineConnectionBanner({
  onRetry,
  cachedGoogleUrl,
  className,
}: OfflineConnectionBannerProps): React.JSX.Element {
  const sanitizedGoogleUrl = sanitizeGoogleReviewUrl(cachedGoogleUrl);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`w-full rounded-lg border border-state-warning bg-state-warning-bg p-3 text-state-warning shadow-xs transition-all ${
        className ?? ''
      }`.trim()}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <span className="text-base" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <p className="text-xs font-semibold text-state-warning">
              Connection Lost
            </p>
            <p className="text-xs text-muted-foreground">
              Please check your connection. Your current answers are safely retained.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 sm:pt-0">
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[36px] text-xs font-medium"
              onClick={() => void onRetry()}
            >
              Retry ↻
            </Button>
          )}

          {sanitizedGoogleUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[36px] text-xs font-medium"
              onClick={() => {
                window.open(sanitizedGoogleUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              Google Maps ↗
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 5. Rate Limited & Service Exception Cards
// ----------------------------------------------------------------------------

export interface RateLimitedCardProps {
  onRetry: () => void | Promise<void>;
  activeTokenText?: string;
  className?: string;
}

/**
 * RateLimitedCard (HTTP 429 / QC-01)
 *
 * Rendered when excessive requests are detected for the client's venue IP or session.
 */
export function RateLimitedCard({
  onRetry,
  activeTokenText,
  className,
}: RateLimitedCardProps): React.JSX.Element {
  return (
    <Card
      className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}
      role="region"
      aria-label="Too Many Requests"
    >
      <CardHeader className="pb-3">
        <div
          className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-danger-bg text-state-danger"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold">⏱</span>
        </div>
        <CardTitle className="text-heading-2">Unable to Load Review Portal</CardTitle>
        <CardDescription className="text-sm mt-2 text-muted-foreground">
          Too many requests. Please wait before scanning or refreshing again.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="default"
          size="touch"
          className="w-full font-semibold"
          onClick={() => void onRetry()}
        >
          Try Again
        </Button>

        <Button
          type="button"
          variant="outline"
          size="touch"
          className="w-full"
          onClick={() => {
            window.open('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
          }}
        >
          Search on Google Maps ↗
        </Button>
      </CardContent>

      {activeTokenText && (
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      )}
    </Card>
  );
}

export interface ServiceErrorCardProps {
  onRetry: () => void | Promise<void>;
  errorMessage?: string | null;
  activeTokenText?: string;
  className?: string;
}

/**
 * ServiceErrorCard (HTTP 500/503 / Database or Gateway Outage)
 *
 * Rendered when backend service is unavailable, with sanitized non-leaking error messaging.
 */
export function ServiceErrorCard({
  onRetry,
  errorMessage,
  activeTokenText,
  className,
}: ServiceErrorCardProps): React.JSX.Element {
  return (
    <Card
      className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}
      role="region"
      aria-label="Service Error"
    >
      <CardHeader className="pb-3">
        <div
          className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-danger-bg text-state-danger"
          aria-hidden="true"
        >
          <span className="text-2xl font-bold">✕</span>
        </div>
        <CardTitle className="text-heading-2">Unable to Load Review Portal</CardTitle>
        <CardDescription className="text-sm mt-2 text-muted-foreground">
          {errorMessage ||
            'A temporary service error occurred. Please check your connection and try again.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-2">
        <Button
          type="button"
          variant="default"
          size="touch"
          className="w-full font-semibold"
          onClick={() => void onRetry()}
        >
          Try Again
        </Button>

        <Button
          type="button"
          variant="outline"
          size="touch"
          className="w-full"
          onClick={() => {
            window.open('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
          }}
        >
          Search on Google Maps ↗
        </Button>
      </CardContent>

      {activeTokenText && (
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      )}
    </Card>
  );
}

