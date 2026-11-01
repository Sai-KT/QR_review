import * as React from 'react';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  getCategoryLabel,
  getInitials,
  sanitizeGoogleReviewUrl,
} from '../../lib/utils/customer';

export interface DirectGoogleHandoffProps {
  business: PublicBusinessProjection;
  onBack?: () => void;
  onHandoffClick?: () => void;
  activeTokenText?: string;
  className?: string;
}

/**
 * DirectGoogleHandoff (SCR-CUST-09)
 *
 * Dedicated confirmation launchpad for patrons who explicitly choose the Direct Google Review bypass.
 * Features:
 *   - Verified store branding header (BrandHeader)
 *   - Clear explanation of external transition to Google Maps
 *   - Primary "Open Google Maps to Review →" external action
 *   - Accessible "← Back to Quick Survey" return agency
 *   - Safe fallback when merchant Google review URL is unconfigured
 */
export function DirectGoogleHandoff({
  business,
  onBack,
  onHandoffClick,
  activeTokenText,
  className,
}: DirectGoogleHandoffProps): React.JSX.Element {
  const [imageError, setImageError] = React.useState(false);

  const sanitizedGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const categoryLabel = getCategoryLabel(business.categoryId);
  const initials = getInitials(business.name);

  const handleOpenGoogle = () => {
    onHandoffClick?.();
    const targetUrl = sanitizedGoogleUrl || 'https://www.google.com/maps';
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card className={`w-full shadow-md border-border ${className ?? ''}`.trim()}>
      <CardHeader className="flex flex-col items-center text-center pb-3">
        {business.logoUrl && !imageError ? (
          <img
            src={business.logoUrl}
            alt={`${business.name} logo`}
            onError={() => setImageError(true)}
            className="h-16 w-16 rounded-full object-cover border border-border shadow-xs mb-2"
          />
        ) : (
          <div
            className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl mb-2 select-none"
            aria-hidden="true"
          >
            {initials}
          </div>
        )}

        <CardTitle className="text-heading-2 text-foreground">{business.name}</CardTitle>
        {categoryLabel && (
          <Badge variant="secondary" size="sm" className="mt-1 capitalize">
            {categoryLabel}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        <div className="rounded-lg border border-border bg-surface-subtle p-4 text-center space-y-2">
          <div
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary mb-1"
            aria-hidden="true"
          >
            <span className="text-lg font-bold">G</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            Direct Google Review Handoff
          </h3>
          <p className="text-xs text-muted-foreground">
            {sanitizedGoogleUrl
              ? `You are heading directly to Google Maps to review ${business.name}. We appreciate your honest feedback!`
              : `A direct review link is not configured for this location. You can search for "${business.name}" directly on Google Maps.`}
          </p>
        </div>

        {/* Primary External Action */}
        <Button
          variant="accent"
          size="touch"
          className="w-full font-semibold min-h-[48px]"
          onClick={handleOpenGoogle}
        >
          {sanitizedGoogleUrl
            ? 'Open Google Maps to Review →'
            : 'Search on Google Maps ↗'}
        </Button>

        {/* Cancel / Return to Survey */}
        <Button
          variant="ghost"
          size="touch"
          className="w-full text-sm font-medium min-h-[44px]"
          onClick={onBack}
        >
          ← Back to Quick Survey
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

export default DirectGoogleHandoff;
