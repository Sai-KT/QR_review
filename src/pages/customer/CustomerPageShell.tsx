import * as React from 'react';
import { useParams, useSearchParams } from 'react-router';
import { fetchPublicBusiness, ApiClientError } from '../../lib/api/public';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { WelcomePage } from './WelcomePage';
import { SurveyFlow } from './SurveyFlow';
import {
  InvalidQrCard,
  SuspendedBusinessCard,
  DirectOnlyCard,
  OfflineRecoveryCard,
  RateLimitedCard,
  ServiceErrorCard,
} from './StatusPages';

export type CustomerViewState =
  | 'loading'
  | 'active'
  | 'direct_only'
  | 'suspended'
  | 'not_found'
  | 'offline'
  | 'rate_limited'
  | 'error';

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
 *   - SCR-CUST-15: Offline / Cellular Recovery
 */
export function CustomerPageShell(): React.JSX.Element | null {
  const { qrId } = useParams<{ qrId: string }>();
  return <CustomerPageShellInner key={qrId ?? ''} qrId={qrId} />;
}

function CustomerPageShellInner({ qrId }: { qrId?: string }): React.JSX.Element | null {
  const [searchParams] = useSearchParams();

  const [viewState, setViewState] = React.useState<CustomerViewState>(() => {
    if (!qrId || !qrId.trim()) return 'not_found';
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    return 'loading';
  });

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
    // Cross-tenant safety: wipe business data on resolution error
    setBusiness(null);

    if (err instanceof ApiClientError) {
      if (err.status === 404 || err.code === 'ERR_QR_NOT_FOUND') {
        setViewState('not_found');
      } else if (err.status === 403 || err.code === 'ERR_BUSINESS_SUSPENDED' || err.isSuspended) {
        setViewState('suspended');
      } else if (err.status === 429 || err.code === 'ERR_RATE_LIMITED') {
        setViewState('rate_limited');
      } else if (
        err.code === 'ERR_NETWORK_ERROR' ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        setViewState('offline');
      } else {
        setViewState('error');
        setErrorMessage(err.message);
      }
    } else {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setViewState('offline');
      } else {
        setViewState('error');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Unable to connect to review service. Please check your network.',
        );
      }
    }
  }, []);

  const handleRetry = React.useCallback(async () => {
    if (!qrId || !qrId.trim()) {
      setViewState('not_found');
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setViewState('offline');
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

  // Network connectivity listener for real-time offline/online transitions
  React.useEffect(() => {
    const handleOnline = () => {
      // If we were stuck in offline recovery, attempt resolution
      setViewState((current) => {
        if (current === 'offline') {
          void handleRetry();
        }
        return current;
      });
    };

    const handleOffline = () => {
      setViewState((current) => {
        // If still loading, transition to offline
        if (current === 'loading') {
          return 'offline';
        }
        return current;
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleRetry]);

  // Route resolution effect for this specific qrId
  React.useEffect(() => {
    if (!qrId || !qrId.trim() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
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
            <Skeleton className="h-4 w-24" />
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
      <InvalidQrCard
        qrToken={qrId}
        onRetry={() => void handleRetry()}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 3. SCR-CUST-13: Suspended Business Notice (403)
  if (viewState === 'suspended') {
    return (
      <SuspendedBusinessCard
        qrToken={qrId}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 4. SCR-CUST-14: Direct-Only Mode (Lapsed Subscription)
  if (viewState === 'direct_only' && business) {
    return (
      <DirectOnlyCard
        business={business}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 5. SCR-CUST-15: Offline / Cellular Recovery
  if (viewState === 'offline') {
    return (
      <OfflineRecoveryCard
        onRetry={() => void handleRetry()}
        cachedGoogleUrl={business?.googleReviewUrl}
        hasAnswers={false}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 6. Rate Limited State (HTTP 429)
  if (viewState === 'rate_limited') {
    return (
      <RateLimitedCard
        onRetry={() => void handleRetry()}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 7. Generic / Service Error State (HTTP 500/503)
  if (viewState === 'error') {
    return (
      <ServiceErrorCard
        onRetry={() => void handleRetry()}
        errorMessage={errorMessage}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 8. Active Customer Experience: Welcome Screen (SCR-CUST-01/09) or 3-MCQ Survey Flow (SCR-CUST-02..05)
  if (!business) {
    return null;
  }

  const step = searchParams.get('step');
  const isSurveyActive =
    step === '1' || step === '2' || step === '3' || step === 'notes' || step === 'submitted';

  if (isSurveyActive) {
    return (
      <SurveyFlow
        business={business}
        activeTokenText={activeTokenText}
        onExitSurvey={() => setIsStarted(false)}
      />
    );
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
