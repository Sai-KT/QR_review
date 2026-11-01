import * as React from 'react';
import { useSearchParams } from 'react-router';
import type { PublicBusinessProjection } from '../../types/domain';
import { WelcomeCard } from '../../components/customer/WelcomeCard';
import { DirectGoogleHandoff } from '../../components/customer/DirectGoogleHandoff';
import { trackEvent } from '../../lib/api/analytics';
import { getClientSessionUuid } from '../../lib/utils/customer';

export interface WelcomePageProps {
  business: PublicBusinessProjection;
  onStartReview?: () => void;
  isStarted?: boolean;
  activeTokenText?: string;
}

/**
 * WelcomePage (SCR-CUST-01 & SCR-CUST-09)
 *
 * Coordinates:
 *   - SCR-CUST-01: Welcome screen with brand header, 30-sec survey CTA, anti-gating bypass, and WhatsApp link
 *   - SCR-CUST-09: Dedicated Direct Google Review handoff card when query parameter ?handoff=direct is present
 *   - Analytics: Dispatches EVENT_QR_PAGE_VIEW on initial eligible render (idempotent, StrictMode safe)
 *   - Analytics: Dispatches EVENT_GOOGLE_BYPASS_CLICK when patron activates direct Google review action
 */
export function WelcomePage({
  business,
  onStartReview,
  isStarted = false,
  activeTokenText,
}: WelcomePageProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const isDirectHandoff = searchParams.get('handoff') === 'direct';

  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  // 1. Telemetry: Dispatch EVENT_QR_PAGE_VIEW once per session
  const pageViewTrackedRef = React.useRef(false);

  React.useEffect(() => {
    // Only track if business is active and not suspended
    if (business.isSuspended || business.isActive === false) {
      return;
    }

    const trackingKey = `qr_pv_tracked_${business.publicQrId}_${sessionUuid}`;
    let isAlreadyTracked = false;

    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        isAlreadyTracked = window.sessionStorage.getItem(trackingKey) === 'true';
      }
    } catch {
      // Ignore storage access error
    }

    if (pageViewTrackedRef.current || isAlreadyTracked) {
      return;
    }

    pageViewTrackedRef.current = true;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(trackingKey, 'true');
      }
    } catch {
      // Ignore storage access error
    }

    // Fire best-effort non-blocking telemetry
    trackEvent({
      publicQrId: business.publicQrId,
      eventName: 'EVENT_QR_PAGE_VIEW',
      sessionUuid,
    }).catch(() => {
      // Telemetry failure is non-blocking; customer experience is unaffected
    });
  }, [business.publicQrId, business.isSuspended, business.isActive, sessionUuid]);

  // 2. Telemetry: Dispatch EVENT_GOOGLE_BYPASS_CLICK
  const handleBypassClick = React.useCallback(() => {
    trackEvent({
      publicQrId: business.publicQrId,
      eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
      sessionUuid,
    }).catch(() => {
      // Non-blocking telemetry
    });
  }, [business.publicQrId, sessionUuid]);

  // 3. Navigation: Start review flow (navigates to ?step=1 matching M3-T06 contract)
  const handleStartReview = React.useCallback(() => {
    searchParams.set('step', '1');
    setSearchParams(searchParams);
    onStartReview?.();
  }, [searchParams, setSearchParams, onStartReview]);

  // 4. Navigation: Return from SCR-CUST-09 back to SCR-CUST-01
  const handleBackFromHandoff = React.useCallback(() => {
    searchParams.delete('handoff');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const hasStartedStep = isStarted || searchParams.get('step') === '1';

  // 5. SCR-CUST-09: Direct Google Review Handoff State
  if (isDirectHandoff) {
    return (
      <DirectGoogleHandoff
        business={business}
        onBack={handleBackFromHandoff}
        onHandoffClick={handleBypassClick}
        activeTokenText={activeTokenText}
      />
    );
  }

  // 6. SCR-CUST-01: Welcome Screen
  return (
    <WelcomeCard
      business={business}
      onStartReview={handleStartReview}
      onDirectGoogleClick={handleBypassClick}
      isStarted={hasStartedStep}
      activeTokenText={activeTokenText}
    />
  );
}

export default WelcomePage;
