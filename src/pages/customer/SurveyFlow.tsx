import * as React from 'react';
import { useSearchParams } from 'react-router';
import type { PublicBusinessProjection } from '../../types/domain';
import {
  fetchSurveyQuestions,
  submitFeedback,
  ApiClientError,
  type SurveyQuestionDto,
  type SubmitFeedbackSuccessResponse,
} from '../../lib/api/survey';
import { validateQuestionnaire } from '../../lib/utils/survey';
import { getClientSessionUuid, sanitizeGoogleReviewUrl, formatWhatsAppUrl } from '../../lib/utils/customer';
import { QuestionCard } from '../../components/customer/QuestionCard';
import { NoteEditor } from '../../components/customer/NoteEditor';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

export interface SurveyFlowProps {
  business: PublicBusinessProjection;
  activeTokenText?: string;
  onExitSurvey?: () => void;
  className?: string;
}

export type SurveyStatus =
  | 'loading_questions'
  | 'ready'
  | 'submitting'
  | 'submitted'
  | 'error_questions'
  | 'error_submission'
  | 'stale_questionnaire';

/**
 * SurveyFlow (SCR-CUST-02, SCR-CUST-03, SCR-CUST-04, SCR-CUST-05)
 *
 * Coordinates the full mobile survey lifecycle:
 * - Dynamic questionnaire retrieval (API-PUB-02) based on business category
 * - Accessible 3-MCQ questionnaire navigation (?step=1, ?step=2, ?step=3)
 * - Selection persistence and Back/Next answer preservation
 * - Optional 150-character note editor (?step=notes)
 * - In-flight feedback submission (API-PUB-04) with double-click protection
 * - Stale questionnaire detection and automated reconciliation
 * - Universal anti-gating direct Google review access on every step
 */
export function SurveyFlow({
  business,
  activeTokenText,
  onExitSurvey,
  className,
}: SurveyFlowProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  // State Machine
  const [status, setStatus] = React.useState<SurveyStatus>('loading_questions');
  const [questions, setQuestions] = React.useState<SurveyQuestionDto[]>([]);
  const [surveyVersion, setSurveyVersion] = React.useState<string>('');
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<string>('');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [staleNotice, setStaleNotice] = React.useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = React.useState<SubmitFeedbackSuccessResponse | null>(null);

  const isSubmittingRef = React.useRef(false);

  const sessionUuid = React.useMemo(
    () => getClientSessionUuid(business.publicQrId),
    [business.publicQrId],
  );

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(business.googleReviewUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const whatsAppUrl = formatWhatsAppUrl(business.whatsappNumber);

  // 1. Questionnaire Retrieval & Integrity Validation
  const loadQuestions = React.useCallback(
    async (versionParam?: string) => {
      setStatus('loading_questions');
      setErrorMessage(null);
      setStaleNotice(null);

      try {
        const data = await fetchSurveyQuestions(business.categoryId, {
          version: versionParam,
        });

        const sorted = [...data.questions].sort((a, b) => a.displayOrder - b.displayOrder);

        if (!validateQuestionnaire(sorted)) {
          setStatus('error_questions');
          setErrorMessage('The survey questions for this business are incomplete or misconfigured.');
          return;
        }

        setQuestions(sorted);
        setSurveyVersion(data.surveyVersion);
        setStatus('ready');

        // Reconcile existing answers when recovering from stale questions
        setAnswers((prevAnswers) => {
          const reconciled: Record<string, string> = {};
          for (const q of sorted) {
            const existingOptId = prevAnswers[q.id];
            if (existingOptId && q.options.some((o) => o.id === existingOptId)) {
              reconciled[q.id] = existingOptId;
            }
          }
          return reconciled;
        });
      } catch (err) {
        setStatus('error_questions');
        if (err instanceof ApiClientError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Failed to connect to survey service. Please check your connection.');
        }
      }
    },
    [business.categoryId],
  );

  // Initial fetch on mount or category change
  React.useEffect(() => {
    let isCancelled = false;

    fetchSurveyQuestions(business.categoryId)
      .then((data) => {
        if (isCancelled) return;
        const sorted = [...data.questions].sort((a, b) => a.displayOrder - b.displayOrder);
        if (!validateQuestionnaire(sorted)) {
          setStatus('error_questions');
          setErrorMessage('The survey questions for this business are incomplete or misconfigured.');
          return;
        }
        setQuestions(sorted);
        setSurveyVersion(data.surveyVersion);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (isCancelled) return;
        setStatus('error_questions');
        if (err instanceof ApiClientError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Failed to connect to survey service. Please check your connection.');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [business.categoryId]);

  // 2. URL Step Normalization & Question Bounds Checking
  const rawStep = searchParams.get('step') ?? '1';

  // Derived current step: safely guards against bypassing unanswered questions without cascading setState
  const currentStep = React.useMemo(() => {
    if (rawStep === 'submitted') return 'submitted';

    if (questions.length !== 3) {
      if (rawStep === 'notes') return 'notes';
      const num = parseInt(rawStep, 10);
      return num === 2 || num === 3 ? num : 1;
    }

    const q1Answered = Boolean(questions[0] && answers[questions[0].id]);
    const q2Answered = Boolean(questions[1] && answers[questions[1].id]);
    const q3Answered = Boolean(questions[2] && answers[questions[2].id]);

    if (rawStep === 'notes') {
      if (!q1Answered) return 1;
      if (!q2Answered) return 2;
      if (!q3Answered) return 3;
      return 'notes';
    }

    const num = parseInt(rawStep, 10);
    if (num === 2) {
      return q1Answered ? 2 : 1;
    }
    if (num === 3) {
      if (!q1Answered) return 1;
      if (!q2Answered) return 2;
      return 3;
    }

    return 1;
  }, [rawStep, questions, answers]);

  // 3. Selection Handlers
  const handleSelectOption = (questionId: string, optionId: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: optionId,
    }));
  };

  // 4. Step Navigation Handlers
  const handleNextFromQuestion = (stepNum: 1 | 2 | 3) => {
    if (stepNum === 1) {
      searchParams.set('step', '2');
      setSearchParams(searchParams);
    } else if (stepNum === 2) {
      searchParams.set('step', '3');
      setSearchParams(searchParams);
    } else if (stepNum === 3) {
      searchParams.set('step', 'notes');
      setSearchParams(searchParams);
    }
  };

  const handleBackFromQuestion = (stepNum: 1 | 2 | 3) => {
    if (stepNum === 1) {
      // Return to SCR-CUST-01 welcome screen without losing entered answers
      searchParams.delete('step');
      setSearchParams(searchParams);
      onExitSurvey?.();
    } else if (stepNum === 2) {
      searchParams.set('step', '1');
      setSearchParams(searchParams);
    } else if (stepNum === 3) {
      searchParams.set('step', '2');
      setSearchParams(searchParams);
    }
  };

  const handleBackFromNotes = () => {
    searchParams.set('step', '3');
    setSearchParams(searchParams);
  };

  // 5. Submission Execution with In-Flight Double-Click Guard
  const handleSubmitFeedback = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    // Verify all 3 questions answered
    if (
      questions.length !== 3 ||
      !answers[questions[0]!.id] ||
      !answers[questions[1]!.id] ||
      !answers[questions[2]!.id]
    ) {
      setErrorMessage('Please answer all 3 questions before submitting.');
      searchParams.set('step', '1');
      setSearchParams(searchParams);
      return;
    }

    isSubmittingRef.current = true;
    setStatus('submitting');
    setErrorMessage(null);

    const responses = questions.map((q) => ({
      questionId: q.id,
      optionId: answers[q.id]!,
    }));

    try {
      const result = await submitFeedback({
        publicQrId: business.publicQrId,
        sessionUuid,
        responses,
        optionalNote: note.trim() || null,
      });

      setSubmissionResult(result);
      setStatus('submitted');
      searchParams.set('step', 'submitted');
      setSearchParams(searchParams);
    } catch (err) {
      if (err instanceof ApiClientError) {
        // Detect stale question or soft-retired option
        const isStale =
          err.status === 400 &&
          (err.message.includes('is retired') ||
            err.message.includes('not an active question') ||
            err.code === 'ERR_QUESTION_OPTION_MISMATCH');

        if (isStale) {
          setStatus('stale_questionnaire');
          setErrorMessage(
            'The questionnaire for this business was recently updated. Please refresh and review your answers.',
          );
        } else if (err.code === 'ERR_IDEMPOTENCY_CONFLICT') {
          setStatus('error_submission');
          setErrorMessage(
            'A survey submission was already received for this session. Your feedback is safe.',
          );
        } else {
          setStatus('error_submission');
          setErrorMessage(err.message);
        }
      } else {
        setStatus('error_submission');
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'A network error occurred while submitting. Please check your data connection.',
        );
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  // 6. Stale Questionnaire Recovery
  const handleRefreshQuestionnaire = async () => {
    const cacheBuster = `refresh_${Date.now()}`;
    await loadQuestions(cacheBuster);
    setStaleNotice('Questionnaire refreshed. Please confirm your answers before submitting.');
    // Navigate back to step 1 so customer can review updated options
    searchParams.set('step', '1');
    setSearchParams(searchParams);
  };

  // --------------------------------------------------------------------------
  // Render: Loading State (Shimmer Skeleton)
  // --------------------------------------------------------------------------
  if (status === 'loading_questions') {
    return (
      <Card className={`w-full shadow-md border-border ${className ?? ''}`.trim()} aria-busy="true">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-28" shimmer />
            <Skeleton className="h-4 w-10" shimmer />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full mb-3" shimmer />
          <div className="flex items-center gap-2 pb-2">
            <Skeleton className="h-8 w-8 rounded-full" shimmer />
            <Skeleton className="h-4 w-36" shimmer />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Skeleton className="h-6 w-3/4 mx-auto mb-4" shimmer />
          <Skeleton className="h-12 w-full rounded-lg" shimmer />
          <Skeleton className="h-12 w-full rounded-lg" shimmer />
          <Skeleton className="h-12 w-full rounded-lg" shimmer />
          <Skeleton className="h-12 w-full rounded-lg" shimmer />
          <div className="flex gap-3 pt-2">
            <Skeleton className="h-12 flex-1 rounded-md" shimmer />
            <Skeleton className="h-12 flex-1 rounded-md" shimmer />
          </div>
        </CardContent>
        {activeTokenText && (
          <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
            <p className="text-xs text-muted-foreground">{activeTokenText}</p>
          </CardFooter>
        )}
      </Card>
    );
  }

  // --------------------------------------------------------------------------
  // Render: Error Fetching Questions
  // --------------------------------------------------------------------------
  if (status === 'error_questions') {
    return (
      <Card className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}>
        <CardHeader className="pb-3">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-danger-bg text-state-danger"
            aria-hidden="true"
          >
            <span className="text-2xl font-bold">✕</span>
          </div>
          <CardTitle className="text-heading-2">Unable to Load Survey Questions</CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            {errorMessage || 'A network error occurred while loading questions. Please try again.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Button
            type="button"
            variant="default"
            size="touch"
            className="w-full font-semibold"
            onClick={() => void loadQuestions(`retry_${Date.now()}`)}
          >
            Retry Loading Questions
          </Button>

          {/* Anti-gating Google fallback */}
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-center mt-3">
            <p className="text-xs text-muted-foreground mb-2">
              You can always share your thoughts directly on Google Maps:
            </p>
            <Button
              type="button"
              variant="outline"
              size="default"
              className="w-full text-xs font-medium min-h-[44px]"
              onClick={() => {
                window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              {hasConfiguredGoogle ? 'Review Directly on Google Maps ↗' : 'Search on Google Maps ↗'}
            </Button>
          </div>
        </CardContent>
        {activeTokenText && (
          <CardFooter className="pt-2 flex justify-center border-t border-border-subtle">
            <p className="text-xs text-muted-foreground">{activeTokenText}</p>
          </CardFooter>
        )}
      </Card>
    );
  }

  // --------------------------------------------------------------------------
  // Render: Stale Questionnaire Detected (Work Package H)
  // --------------------------------------------------------------------------
  if (status === 'stale_questionnaire') {
    return (
      <Card className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}>
        <CardHeader className="pb-3">
          <div
            className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-state-warning-bg text-state-warning"
            aria-hidden="true"
          >
            <span className="text-2xl font-bold">!</span>
          </div>
          <CardTitle className="text-heading-2">Questions Recently Updated</CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            The questions for {business.name} were updated while your session was active. Please refresh
            to review the active questionnaire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <Button
            type="button"
            variant="default"
            size="touch"
            className="w-full font-semibold"
            onClick={() => void handleRefreshQuestionnaire()}
          >
            Refresh Questions ↻
          </Button>

          {/* Anti-gating direct Google option */}
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="w-full"
            onClick={() => {
              window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            {hasConfiguredGoogle ? 'Review Directly on Google Maps ↗' : 'Search on Google Maps ↗'}
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

  // --------------------------------------------------------------------------
  // Render: Feedback Submission Success Confirmation (SCR-CUST-05 Completed)
  // --------------------------------------------------------------------------
  if (status === 'submitted' || currentStep === 'submitted') {
    return (
      <Card className={`w-full shadow-md text-center border-border ${className ?? ''}`.trim()}>
        <CardHeader className="pb-3">
          <div
            className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-state-success-bg text-state-success"
            aria-hidden="true"
          >
            <span className="text-3xl font-bold">✓</span>
          </div>
          <CardTitle className="text-heading-1 font-bold text-foreground">
            Feedback Received!
          </CardTitle>
          <CardDescription className="text-sm mt-2 text-muted-foreground">
            Thank you for sharing your experience at <strong className="text-foreground">{business.name}</strong>.
            Your responses have been recorded securely.
          </CardDescription>
        </CardHeader>

        <CardContent
          className="space-y-4 pt-2"
          data-response-id={submissionResult?.responseId}
          data-survey-version={surveyVersion}
        >
          {/* Informational AI Roadmap Notice (No fake drafts / Truthful copy) */}
          <div className="rounded-lg bg-surface-subtle border border-border-subtle p-3.5 text-xs text-muted-foreground text-left leading-relaxed">
            <p className="font-medium text-foreground mb-1">✦ What happens next?</p>
            <p>
              Your feedback is saved privately for the merchant. AI-assisted review drafting will be
              available in the upcoming release. In the meantime, you can leave an authentic review
              directly on Google Maps below.
            </p>
          </div>

          {/* Universal Anti-Gating Direct Google Action */}
          <Button
            type="button"
            variant="accent"
            size="touch"
            className="w-full font-semibold text-base min-h-[48px]"
            onClick={() => {
              window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            {hasConfiguredGoogle ? 'Review Directly on Google Maps ↗' : 'Search on Google Maps ↗'}
          </Button>

          {/* Optional WhatsApp Manager Contact Link */}
          {whatsAppUrl && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              className="w-full min-h-[44px]"
              onClick={() => {
                window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              Message Manager on WhatsApp ↗
            </Button>
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

  // --------------------------------------------------------------------------
  // Render: Optional Note Editor (SCR-CUST-05)
  // --------------------------------------------------------------------------
  if (currentStep === 'notes') {
    return (
      <NoteEditor
        businessName={business.name}
        logoUrl={business.logoUrl}
        note={note}
        onChangeNote={setNote}
        onSubmit={() => void handleSubmitFeedback()}
        onBack={handleBackFromNotes}
        isSubmitting={status === 'submitting'}
        submissionError={status === 'error_submission' ? errorMessage : null}
        targetGoogleUrl={business.googleReviewUrl}
        activeTokenText={activeTokenText}
        className={className}
      />
    );
  }

  // --------------------------------------------------------------------------
  // Render: Three Questions (SCR-CUST-02, SCR-CUST-03, SCR-CUST-04)
  // --------------------------------------------------------------------------
  const questionIndex = (currentStep as 1 | 2 | 3) - 1;
  const currentQuestion = questions[questionIndex];

  if (!currentQuestion) {
    return (
      <div className="text-center p-4">
        <p className="text-sm text-muted-foreground">Question not found.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void loadQuestions()}
        >
          Reload Questions
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2">
      {/* Informational Stale Questionnaire Notice if applicable */}
      {staleNotice && (
        <div
          role="status"
          className="rounded-lg bg-surface-subtle border border-state-warning/30 p-2.5 text-xs text-state-warning text-center"
        >
          {staleNotice}
        </div>
      )}

      <QuestionCard
        businessName={business.name}
        logoUrl={business.logoUrl}
        categoryId={business.categoryId}
        question={currentQuestion}
        stepNumber={currentStep as 1 | 2 | 3}
        totalSteps={3}
        selectedOptionId={answers[currentQuestion.id] ?? null}
        onSelectOption={(optionId) => handleSelectOption(currentQuestion.id, optionId)}
        onNext={() => handleNextFromQuestion(currentStep as 1 | 2 | 3)}
        onBack={() => handleBackFromQuestion(currentStep as 1 | 2 | 3)}
        targetGoogleUrl={business.googleReviewUrl}
        activeTokenText={activeTokenText}
        className={className}
      />
    </div>
  );
}

export default SurveyFlow;
