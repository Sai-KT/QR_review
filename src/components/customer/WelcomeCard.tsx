import * as React from 'react';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  getCategoryLabel,
  getInitials,
  sanitizeGoogleReviewUrl,
  formatWhatsAppUrl,
} from '../../lib/utils/customer';

export interface WelcomeCardProps {
  business: PublicBusinessProjection;
  onStartReview?: () => void;
  onDirectGoogleClick?: () => void;
  onWhatsAppClick?: () => void;
  isStarted?: boolean;
  activeTokenText?: string;
  className?: string;
}

/**
 * WelcomeCard (SCR-CUST-01)
 *
 * Mobile-first customer landing card presented upon digital QR scan.
 * Features:
 *   - Verified store branding (real business name, logo with fallback monogram, category badge)
 *   - Prominent "Start 30-Second Review" CTA initiating the customer review journey
 *   - Unbiased, anti-gating Direct Google Review Bypass (always accessible, never gated on sentiment)
 *   - WhatsApp manager contact link formatted to international click-to-chat standards
 *   - Accessible heading hierarchy, visible focus rings, and WCAG 2.2 AA compliant touch targets (>=44px)
 */
export function WelcomeCard({
  business,
  onStartReview,
  onDirectGoogleClick,
  onWhatsAppClick,
  isStarted = false,
  activeTokenText,
  className,
}: WelcomeCardProps): React.JSX.Element {
  const [failedLogoUrl, setFailedLogoUrl] = React.useState<string | null>(null);
  const isImageFailed = Boolean(business.logoUrl && business.logoUrl === failedLogoUrl);

  const sanitizedGoogleUrl =
    sanitizeGoogleReviewUrl(business.googleReviewUrl) || 'https://www.google.com/maps';

  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);
  const categoryLabel = getCategoryLabel(business.categoryId);
  const initials = getInitials(business.name);

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(sanitizedGoogleUrl, '_blank', 'noopener,noreferrer');
  };

  const handleWhatsAppClick = () => {
    if (!whatsAppUrl) return;
    onWhatsAppClick?.();
    window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card className={`w-full shadow-md border-border ${className ?? ''}`.trim()}>
      <CardHeader className="flex flex-col items-center text-center pb-3">
        {/* Merchant Logo with Fallback Monogram Avatar */}
        {business.logoUrl && !isImageFailed ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            onError={() => setFailedLogoUrl(business.logoUrl)}
            className="h-20 w-20 rounded-full object-cover border border-border shadow-xs mb-2"
          />
        ) : (
          <div
            className="h-20 w-20 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-2xl mb-2 select-none shadow-xs"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <CardTitle className="text-heading-1 text-foreground leading-tight">
          {business.name}
        </CardTitle>

        {categoryLabel && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" size="sm" className="capitalize">
              {categoryLabel}
            </Badge>
          </div>
        )}

        <CardDescription className="text-sm mt-3 text-muted-foreground max-w-xs mx-auto">
          How was your experience today? Help us improve or share your thoughts on Google Maps.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {/* Primary CTA (Navigates to 3-MCQ Questionnaire) */}
        <Button
          variant="default"
          size="touch"
          className="w-full font-semibold text-base shadow-sm min-h-[48px]"
          onClick={onStartReview}
          aria-label={
            isStarted
              ? 'Survey Started (3 Quick MCQs)'
              : 'Start 30-Second Review'
          }
        >
          {isStarted ? 'Survey Started (3 Quick MCQs)' : 'Start 30-Second Review →'}
        </Button>

        {/* Anti-Gating Direct Google Review Bypass (Always Accessible) */}
        <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-center">
          <p className="text-xs text-muted-foreground mb-2">
            Prefer to write directly without AI assistance?
          </p>
          <Button
            variant="outline"
            size="default"
            className="w-full text-xs font-medium min-h-[44px]"
            onClick={handleGoogleClick}
          >
            Review Directly on Google Maps ↗
          </Button>
        </div>

        {/* Universal WhatsApp Contact Link (FR-CUST-08) */}
        {whatsAppUrl && (
          <div className="text-center pt-1">
            <a
              href={whatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                handleWhatsAppClick();
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 inline-flex items-center gap-1.5 min-h-[44px] py-2 px-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Message Manager on WhatsApp</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}
      </CardContent>

      {activeTokenText && (
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      )}
    </Card>
  );
}

export default WelcomeCard;
