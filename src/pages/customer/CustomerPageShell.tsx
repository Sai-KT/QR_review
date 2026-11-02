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
import { Button } from '../../components/ui/button';
import { WelcomePage } from './WelcomePage';
import { SurveyFlow, type FeedbackSubmissionData } from './SurveyFlow';
import { GenerationShimmer } from '../../components/customer/GenerationShimmer';
import { ReviewEditorPage } from './ReviewEditorPage';
import { HandoffPage, type ClipboardUiState } from './HandoffPage';
import {
  GenerationFallbacks,
  type GenerationFallbackMode,
  classifyGenerationError,
} from './GenerationFallbacks';
import { generateReview } from '../../lib/api/review';
import { copyReviewDraftWithTelemetry } from '../../lib/clipboard';
import { trackEvent } from '../../lib/api/analytics';
import { getClientSessionUuid } from '../../lib/utils/customer';
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

export type CustomerJourneyPhase =
  | 'welcome'
  | 'survey'
  | 'generating'
  | 'editor'
  | 'handoff'
  | 'fallback';

/**
 * CustomerPageShell
 *
 * Public-facing customer review flow shell (/q/:qrId).
 * Integrates with get-public-business Edge Function (API-PUB-01) to dynamically
 * resolve merchant branding and route between:
 *   - SCR-CUST-01: Active Welcome Screen (3-MCQ flow + Direct Google bypass)
 *   - SCR-CUST-02..05: 3-MCQ Mobile Survey Flow + Authenticity Confirmation
 *   - SCR-CUST-06: AI Review Generation Loading Shimmer
 *   - SCR-CUST-07: Grounded Review Draft Editor with In-Place Customer Editing
 *   - SCR-CUST-08: Resilient Clipboard Copy & Google Maps Handoff
 *   - SCR-CUST-10..11: Timeout Retry, Quota Exhaustion, and Abstention Fallbacks
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
  const [searchParams, setSearchParams] = useSearchParams();

  const [viewState, setViewState] = React.useState<CustomerViewState>(() => {
    if (!qrId || !qrId.trim()) return 'not_found';
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
    return 'loading';
  });

  const [business, setBusiness] = React.useState<PublicBusinessProjection | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isStarted, setIsStarted] = React.useState(false);

  // Customer Journey State Machine (Post-M4 Integration Gate C)
  const [journeyPhase, setJourneyPhase] = React.useState<CustomerJourneyPhase>(() => {
    const step = searchParams.get('step');
    if (step === '1' || step === '2' || step === '3' || step === 'notes' || step === 'submitted') {
      return 'survey';
    }
    return 'welcome';
  });

  const [submissionData, setSubmissionData] = React.useState<FeedbackSubmissionData | null>(null);
  const [reviewDraft, setReviewDraft] = React.useState<string | null>(null);
  const [copiedDraft, setCopiedDraft] = React.useState<string | null>(null);
  const [initialClipboardState, setInitialClipboardState] = React.useState<ClipboardUiState>('idle');
  const [fallbackMode, setFallbackMode] = React.useState<GenerationFallbackMode>('generic_error');
  const [generationError, setGenerationError] = React.useState<unknown>(null);
  const [retryCount, setRetryCount] = React.useState<number>(0);
  const [isRegenerating, setIsRegenerating] = React.useState<boolean>(false);

  // In-flight concurrency and stale-response guards
  const generationRequestId = React.useRef<number>(0);
  const idempotencySeq = React.useRef<number>(1);
  const isGeneratingRef = React.useRef<boolean>(false);

  const sessionUuid = React.useMemo(() => {
    return business ? getClientSessionUuid(business.publicQrId) : '';
  }, [business]);

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

  // --------------------------------------------------------------------------
  // Generation Pipeline Dispatcher
  // --------------------------------------------------------------------------
  const executeGeneration = React.useCallback(
    async (submission: FeedbackSubmissionData) => {
      if (!business) return;

      // Gate B Enforcement: Feedback must be authenticity confirmed
      if (!submission.authenticityConfirmed) {
        setFallbackMode('generic_error');
        setJourneyPhase('fallback');
        return;
      }

      // Guard against rapid duplicate dispatches
      if (isGeneratingRef.current) return;
      isGeneratingRef.current = true;

      // Increment request counter to discard stale async results
      generationRequestId.current += 1;
      const currentReqId = generationRequestId.current;

      setJourneyPhase('generating');
      setGenerationError(null);

      // Client-owned telemetry: emit EVENT_GENERATION_REQUESTED non-blockingly
      trackEvent({
        publicQrId: business.publicQrId,
        eventName: 'EVENT_GENERATION_REQUESTED',
        sessionUuid: submission.sessionUuid,
      }).catch(() => {
        // Telemetry failure is non-blocking
      });

      const key = `${submission.sessionUuid}_${idempotencySeq.current++}`;

      try {
        const response = await generateReview({
          responseId: submission.responseId,
          submissionToken: submission.submissionToken,
          idempotencyKey: key,
          publicQrId: business.publicQrId,
          sessionUuid: submission.sessionUuid,
        });

        // Stale response guard
        if (generationRequestId.current !== currentReqId) {
          return;
        }

        if (response.abstained || response.reason === 'INSUFFICIENT_FACTS') {
          setFallbackMode('abstained');
          setJourneyPhase('fallback');
        } else if (response.reviewDraft && response.reviewDraft.trim().length > 0) {
          setReviewDraft(response.reviewDraft);
          setJourneyPhase('editor');
        } else {
          setFallbackMode('generic_error');
          setJourneyPhase('fallback');
        }
      } catch (err) {
        // Stale response guard
        if (generationRequestId.current !== currentReqId) {
          return;
        }

        const mode = classifyGenerationError(err);
        setFallbackMode(mode);
        setGenerationError(err);
        setJourneyPhase('fallback');
      } finally {
        isGeneratingRef.current = false;
      }
    },
    [business],
  );

  const handleProceedToAiDraft = React.useCallback(
    (submission: FeedbackSubmissionData) => {
      setSubmissionData(submission);
      void executeGeneration(submission);
    },
    [executeGeneration],
  );

  // --------------------------------------------------------------------------
  // Regeneration Handler (Review Editor)
  // --------------------------------------------------------------------------
  const handleRegenerate = React.useCallback(async () => {
    if (retryCount >= 1 || isRegenerating || !submissionData || !business) {
      return;
    }

    setIsRegenerating(true);
    generationRequestId.current += 1;
    const currentReqId = generationRequestId.current;
    const regenKey = `${submissionData.sessionUuid}_regen_${idempotencySeq.current++}`;

    try {
      const response = await generateReview({
        responseId: submissionData.responseId,
        submissionToken: submissionData.submissionToken,
        idempotencyKey: regenKey,
        publicQrId: business.publicQrId,
        sessionUuid: submissionData.sessionUuid,
      });

      if (generationRequestId.current === currentReqId) {
        if (response.reviewDraft && response.reviewDraft.trim().length > 0) {
          setReviewDraft(response.reviewDraft);
        }
        setRetryCount((prev) => prev + 1);
      }
    } catch {
      if (generationRequestId.current === currentReqId) {
        setRetryCount((prev) => prev + 1);
        // Existing customer draft is preserved on failed regeneration
      }
    } finally {
      setIsRegenerating(false);
    }
  }, [retryCount, isRegenerating, submissionData, business]);

  // --------------------------------------------------------------------------
  // Direct User-Activation Clipboard Handoff (Review Editor -> Handoff)
  // --------------------------------------------------------------------------
  const handleAcceptAndCopy = React.useCallback(
    async (finalDraft: string) => {
      if (!business) return;

      // CRITICAL: Must execute clipboard write synchronously within direct user gesture
      const result = await copyReviewDraftWithTelemetry(finalDraft, {
        publicQrId: business.publicQrId,
        sessionUuid,
      });

      setCopiedDraft(finalDraft);
      setInitialClipboardState(result.success ? 'success' : 'fallback');
      setJourneyPhase('handoff');
    },
    [business, sessionUuid],
  );

  // --------------------------------------------------------------------------
  // Navigation & Fallback Action Handlers
  // --------------------------------------------------------------------------
  const handleDirectGoogleBypass = React.useCallback(() => {
    if (!business) return;
    trackEvent({
      publicQrId: business.publicQrId,
      eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
      sessionUuid,
    }).catch(() => {});
  }, [business, sessionUuid]);

  const handleTimeoutRetry = React.useCallback(async () => {
    if (retryCount >= 1 || !submissionData) return;
    setRetryCount((prev) => prev + 1);
    await executeGeneration(submissionData);
  }, [retryCount, submissionData, executeGeneration]);

  const handleComposeManually = React.useCallback(() => {
    setReviewDraft('');
    setJourneyPhase('editor');
  }, []);

  const handleBackToSurvey = React.useCallback(() => {
    searchParams.set('step', 'notes');
    setSearchParams(searchParams);
    setJourneyPhase('survey');
  }, [searchParams, setSearchParams]);

  const handleBackFromEditor = React.useCallback(() => {
    searchParams.set('step', 'notes');
    setSearchParams(searchParams);
    setJourneyPhase('survey');
  }, [searchParams, setSearchParams]);

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

  // 8. Active Customer Experience
  if (!business) {
    return null;
  }

  // 8a. AI Generation Loading Shimmer (SCR-CUST-06)
  if (journeyPhase === 'generating') {
    return (
      <div className="w-full flex flex-col gap-2">
        <GenerationShimmer
          businessName={business.name}
          logoUrl={business.logoUrl}
          targetGoogleUrl={business.googleReviewUrl}
          onDirectGoogleClick={handleDirectGoogleBypass}
        />
        {/* Universal Anti-Gating: Immediate Direct Google Access throughout Loading */}
        <div className="text-center pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 min-h-[44px]"
            onClick={() => {
              handleDirectGoogleBypass();
              const cleanUrl = business.googleReviewUrl?.trim();
              window.open(cleanUrl || 'https://www.google.com/maps', '_blank', 'noopener,noreferrer');
            }}
          >
            Review on Google Maps ↗
          </Button>
        </div>
      </div>
    );
  }

  // 8b. Grounded Review Draft Editor (SCR-CUST-07)
  if (journeyPhase === 'editor') {
    return (
      <ReviewEditorPage
        business={business}
        initialDraft={reviewDraft}
        canRegenerate={retryCount < 1}
        isLoading={isRegenerating}
        onRegenerate={handleRegenerate}
        onAcceptAndCopy={handleAcceptAndCopy}
        onDirectGoogleClick={handleDirectGoogleBypass}
        onBack={handleBackFromEditor}
      />
    );
  }

  // 8c. Clipboard Copy Confirmation & Google Handoff (SCR-CUST-08)
  if (journeyPhase === 'handoff') {
    return (
      <HandoffPage
        business={business}
        draft={copiedDraft}
        initialClipboardState={initialClipboardState}
        onBack={() => setJourneyPhase('editor')}
      />
    );
  }

  // 8d. Generation Fallbacks (SCR-CUST-10, SCR-CUST-11, Abstention, Rate Limits)
  if (journeyPhase === 'fallback') {
    return (
      <GenerationFallbacks
        business={business}
        mode={fallbackMode}
        error={generationError}
        canRetry={retryCount < 1}
        onRetry={handleTimeoutRetry}
        onDirectGoogleClick={handleDirectGoogleBypass}
        onComposeManually={handleComposeManually}
        onBackToSurvey={handleBackToSurvey}
      />
    );
  }

  // 8e. 3-MCQ Survey Flow (SCR-CUST-02..05)
  const step = searchParams.get('step');
  const isSurveyActive =
    journeyPhase === 'survey' ||
    step === '1' ||
    step === '2' ||
    step === '3' ||
    step === 'notes' ||
    step === 'submitted';

  if (isSurveyActive) {
    return (
      <SurveyFlow
        business={business}
        activeTokenText={activeTokenText}
        onExitSurvey={() => {
          searchParams.delete('step');
          setSearchParams(searchParams);
          setIsStarted(false);
          setJourneyPhase('welcome');
        }}
        onProceedToAiDraft={handleProceedToAiDraft}
      />
    );
  }

  // 8f. Active Welcome Screen (SCR-CUST-01 / SCR-CUST-09)
  return (
    <WelcomePage
      business={business}
      isStarted={isStarted}
      onStartReview={() => {
        setIsStarted(true);
        setJourneyPhase('survey');
      }}
      activeTokenText={activeTokenText}
    />
  );
}

export default CustomerPageShell;
