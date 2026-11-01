import * as React from 'react';
import { useParams } from 'react-router';
import { fetchPublicBusiness, ApiClientError } from '../../lib/api/public';
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
import { Skeleton } from '../../components/ui/skeleton';
import { WelcomePage } from './WelcomePage';

export type CustomerViewState =
  'loading' | 'active' | 'direct_only' | 'suspended' | 'not_found' | 'error';

/**
 * CustomerPageShell
 *
 * Public-facing customer review flow shell (/q/:qrId).
 * Integrates with get-public-business Edge Function (API-PUB-01) to dynamically
 * resolve merchant branding and route between:
 *   - SCR-CUST-01: Active Welcome Screen (3-MCQ flow + Direct Google bypass)
 *   - SCR-CUST-14: Direct-Only Mode (Lapsed subscription)
 *   - SCR-CUST-13: Suspended Business Notice (403)
 *   - SCR-CUST-12: QR Not Recognized (404)
 */
export function CustomerPageShell(): React.JSX.Element | null {
  const { qrId } = useParams<{ qrId: string }>();

  const [viewState, setViewState] = React.useState<CustomerViewState>(() =>
    !qrId || !qrId.trim() ? 'not_found' : 'loading',
  );
  const [business, setBusiness] = React.useState<PublicBusinessProjection | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isStarted, setIsStarted] = React.useState(false);

  const applyBusinessData = React.useCallback((data: PublicBusinessProjection) => {
    setBusiness(data);
    if (data.isSuspended || data.accountStatus === 'suspended' || data.isActive === false) {
      setViewState('suspended');
    } else if (
      data.isDirectGoogleOnly ||
      data.subscriptionStatus === 'past_due' ||
      data.subscriptionStatus === 'canceled'
    ) {
      setViewState('direct_only');
    } else {
      setViewState('active');
    }
  }, []);

  const applyError = React.useCallback((err: unknown) => {
    if (err instanceof ApiClientError) {
      if (err.status === 404 || err.code === 'ERR_QR_NOT_FOUND') {
        setViewState('not_found');
      } else if (err.status === 403 || err.code === 'ERR_BUSINESS_SUSPENDED' || err.isSuspended) {
        setViewState('suspended');
      } else {
        setViewState('error');
        setErrorMessage(err.message);
      }
    } else {
      setViewState('error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Unable to connect to review service. Please check your network.',
      );
    }
  }, []);

  const handleRetry = React.useCallback(async () => {
    if (!qrId || !qrId.trim()) {
      setViewState('not_found');
      return;
    }
    setViewState('loading');
    setErrorMessage(null);
    try {
      const data = await fetchPublicBusiness(qrId);
      applyBusinessData(data);
    } catch (err) {
      applyError(err);
    }
  }, [qrId, applyBusinessData, applyError]);

  React.useEffect(() => {
    if (!qrId || !qrId.trim()) {
      return;
    }

    let isCancelled = false;

    fetchPublicBusiness(qrId)
      .then((data) => {
        if (!isCancelled) {
          applyBusinessData(data);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          applyError(err);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [qrId, applyBusinessData, applyError]);

  const activeTokenText = `Active QR token parameter: "${qrId ?? 'unspecified'}"`;

  // 1. Loading State (Shimmer Skeleton)
  if (viewState === 'loading') {
    return (
      <div className="w-full flex flex-col gap-4">
        <Card className="w-full shadow-md" aria-busy="true">
          <CardHeader className="flex flex-col items-center text-center pb-2">
            <Skeleton className="h-20 w-20 rounded-full mb-3" shimmer />
            <Skeleton className="h-6 w-48 mb-2" shimmer />
            <Skeleton className="h-4 w-24" shimmer />
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <Skeleton className="h-12 w-full rounded-md" shimmer />
            <Skeleton className="h-12 w-full rounded-md" shimmer />
          </CardContent>
          <CardFooter className="pt-2 flex justify-center">
            <p className="text-xs text-muted-foreground">{activeTokenText}</p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 2. SCR-CUST-12: QR Code Not Recognized (404)
  if (viewState === 'not_found') {
    return (
      <Card className="w-full shadow-md text-center border-border">
        <CardHeader className="pb-3">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"
            aria-hidden="true"
          >
            <span className="text-2xl font-bold">?</span>
          </div>
          <CardTitle className="text-heading-2">QR Code Not Recognized</CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            This QR code is not recognized or may have been mistyped. Please verify the code with
            staff.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Button
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() => {
              window.open('https://www.google.com/maps', '_blank', 'noopener,noreferrer');
            }}
          >
            Search on Google Maps ↗
          </Button>
          <Button
            variant="ghost"
            size="touch"
            className="w-full"
            onClick={() => void handleRetry()}
          >
            Scan Again / Retry
          </Button>
        </CardContent>
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      </Card>
    );
  }

  // 3. SCR-CUST-13: Suspended Business Notice (403)
  if (viewState === 'suspended') {
    return (
      <Card className="w-full shadow-md text-center border-border">
        <CardHeader className="pb-3">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-warning-bg text-state-warning"
            aria-hidden="true"
          >
            <span className="text-2xl font-bold">!</span>
          </div>
          <CardTitle className="text-heading-2">Feedback Temporarily Unavailable</CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            Review collection for this location is currently paused. Please speak directly with the
            team for assistance.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="rounded-md bg-surface-subtle p-3 text-xs text-muted-foreground">
            Zero private data or account suspension details are exposed to public patrons.
          </div>
        </CardContent>
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      </Card>
    );
  }

  // 4. SCR-CUST-14: Direct-Only Mode (Lapsed Subscription)
  if (viewState === 'direct_only' && business) {
    const googleUrl = business.googleReviewUrl || 'https://www.google.com/maps';

    return (
      <Card className="w-full shadow-md border-border">
        <CardHeader className="flex flex-col items-center text-center pb-3">
          {business.logoUrl ? (
            <img
              src={business.logoUrl}
              alt={`${business.name} logo`}
              className="h-16 w-16 rounded-full object-cover border border-border shadow-xs mb-2"
            />
          ) : (
            <div
              className="h-16 w-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl mb-2"
              aria-hidden="true"
            >
              {business.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <CardTitle className="text-heading-2">{business.name}</CardTitle>
          <Badge variant="secondary" size="sm" className="mt-1 capitalize">
            {business.categoryId}
          </Badge>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            We are currently collecting direct reviews on Google Maps. Thank you for your support!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Button
            variant="accent"
            size="touch"
            className="w-full"
            onClick={() => {
              window.open(googleUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            Open Google Maps to Review ↗
          </Button>

          {business.whatsappNumber && (
            <Button
              variant="outline"
              size="touch"
              className="w-full"
              onClick={() => {
                window.open(
                  `https://wa.me/${business.whatsappNumber}`,
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
            >
              WhatsApp Manager
            </Button>
          )}
        </CardContent>
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      </Card>
    );
  }

  // 5. Error State (Network or Server Exception)
  if (viewState === 'error') {
    return (
      <Card className="w-full shadow-md text-center border-border">
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
              'A network error occurred. Please check your mobile data and try again.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Button
            variant="default"
            size="touch"
            className="w-full"
            onClick={() => void handleRetry()}
          >
            Try Again
          </Button>
          <Button
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
        <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
          <p className="text-xs text-muted-foreground">{activeTokenText}</p>
        </CardFooter>
      </Card>
    );
  }

  // 6. SCR-CUST-01 / SCR-CUST-09: Active Customer Welcome Experience
  if (!business) {
    return null;
  }

  return (
    <WelcomePage
      business={business}
      isStarted={isStarted}
      onStartReview={() => setIsStarted(true)}
      activeTokenText={activeTokenText}
    />
  );
}

export default CustomerPageShell;
