import * as React from 'react';
import type { SurveyQuestionDto } from '../../lib/api/survey';
import { Card, CardHeader, CardContent, CardFooter } from '../ui/card';
import { Button } from '../ui/button';
import { sanitizeGoogleReviewUrl } from '../../lib/utils/customer';

export interface QuestionCardProps {
  businessName: string;
  logoUrl?: string | null;
  categoryId: string;
  question: SurveyQuestionDto;
  stepNumber: number; // 1, 2, or 3
  totalSteps?: number; // default: 3
  selectedOptionId: string | null;
  onSelectOption: (optionId: string) => void;
  onNext: () => void;
  onBack: () => void;
  targetGoogleUrl?: string | null;
  onDirectGoogleClick?: () => void;
  activeTokenText?: string;
  className?: string;
}

/**
 * QuestionCard (SCR-CUST-02, SCR-CUST-03, SCR-CUST-04)
 *
 * Single-column accessible question card displaying:
 * - Step progress indicator (e.g. "Question 1 of 3") with semantic progress bar
 * - Question text in semantic <legend>
 * - Accessible radio options (min 48px touch targets, equal visual priority for all sentiments)
 * - Navigation buttons (Back, Next)
 * - Universal anti-gating direct Google review link
 */
export function QuestionCard({
  businessName,
  logoUrl,
  question,
  stepNumber,
  totalSteps = 3,
  selectedOptionId,
  onSelectOption,
  onNext,
  onBack,
  targetGoogleUrl,
  onDirectGoogleClick,
  activeTokenText,
  className,
}: QuestionCardProps): React.JSX.Element {
  const [failedLogo, setFailedLogo] = React.useState(false);

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(targetGoogleUrl);
  const destinationUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogleUrl = Boolean(cleanGoogleUrl);

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(destinationUrl, '_blank', 'noopener,noreferrer');
  };

  const progressPercentage = Math.round((stepNumber / totalSteps) * 100);
  const legendId = `question-legend-${question.id}`;

  return (
    <Card className={`w-full shadow-md border-border ${className ?? ''}`.trim()}>
      <CardHeader className="pb-3">
        {/* Step Progress Header */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span className="font-medium">
            Question {stepNumber} of {totalSteps}
          </span>
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {progressPercentage}%
          </span>
        </div>

        {/* Accessible Progress Bar */}
        <div
          role="progressbar"
          aria-valuenow={stepNumber}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-label={`Survey progress: Question ${stepNumber} of ${totalSteps}`}
          className="h-1.5 w-full bg-surface-muted rounded-full overflow-hidden mb-4"
        >
          <div
            className="h-full bg-primary transition-all duration-300 rounded-full"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>

        {/* Business Context Monogram / Mini-Header */}
        <div className="flex items-center gap-2.5 pb-2 border-b border-border-subtle">
          {logoUrl && !failedLogo ? (
            <img
              src={logoUrl}
              alt=""
              onError={() => setFailedLogo(true)}
              className="h-8 w-8 rounded-full object-cover border border-border shadow-xs"
              aria-hidden="true"
            />
          ) : (
            <div
              className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs select-none shadow-xs"
              aria-hidden="true"
            >
              {businessName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            {businessName}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {/* Semantic Fieldset for Radio Group */}
        <fieldset className="space-y-3 m-0 p-0 border-0">
          <legend
            id={legendId}
            className="text-heading-2 font-bold text-foreground text-center mb-3 leading-snug w-full px-1"
          >
            <h2 className="text-lg font-bold text-foreground leading-snug inline">
              {question.questionText}
            </h2>
          </legend>

          {/* Options Radiogroup */}
          <div
            role="radiogroup"
            aria-labelledby={legendId}
            className="space-y-2.5"
          >
            {question.options.map((option) => {
              const isSelected = selectedOptionId === option.id;
              const inputId = `opt-${option.id}`;

              return (
                <label
                  key={option.id}
                  htmlFor={inputId}
                  className={`flex items-center gap-3.5 p-3.5 rounded-lg border text-left cursor-pointer transition-colors min-h-[48px] select-none ${
                    isSelected
                      ? 'border-primary bg-primary/5 text-foreground font-semibold shadow-xs ring-1 ring-primary'
                      : 'border-border bg-surface-base text-foreground hover:bg-surface-subtle hover:border-border-subtle'
                  }`}
                >
                  <input
                    type="radio"
                    id={inputId}
                    name={`q-${question.id}`}
                    value={option.id}
                    checked={isSelected}
                    onChange={() => onSelectOption(option.id)}
                    className="sr-only"
                    aria-checked={isSelected}
                  />

                  {/* Accessible Custom Radio Circle Indicator */}
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 bg-surface-base'
                    }`}
                  >
                    {isSelected && (
                      <span className="h-2 w-2 rounded-full bg-primary-foreground" />
                    )}
                  </span>

                  {/* Option Content with Emoji Anchor */}
                  <span className="text-sm font-medium leading-snug flex-1">
                    {option.emojiAnchor ? `${option.emojiAnchor} ` : ''}
                    {option.optionText}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Navigation Action Buttons */}
        <div className="flex items-center gap-3 pt-3">
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="flex-1 min-h-[48px] font-medium"
            onClick={onBack}
            aria-label={stepNumber === 1 ? 'Back to welcome screen' : `Back to question ${stepNumber - 1}`}
          >
            ← Back
          </Button>

          <Button
            type="button"
            variant="default"
            size="touch"
            className="flex-1 min-h-[48px] font-semibold"
            onClick={onNext}
            disabled={!selectedOptionId}
            aria-disabled={!selectedOptionId}
            aria-label={
              selectedOptionId
                ? stepNumber === totalSteps
                  ? 'Next, optional note'
                  : `Next to question ${stepNumber + 1}`
                : 'Next (select an option to proceed)'
            }
          >
            Next →
          </Button>
        </div>

        {/* Universal Anti-Gating Direct Google Bypass Link */}
        <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3 text-center mt-3">
          <p className="text-xs text-muted-foreground mb-2">
            Prefer to write directly without completing the survey?
          </p>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="w-full text-xs font-medium min-h-[44px]"
            onClick={handleGoogleClick}
          >
            {hasConfiguredGoogleUrl
              ? 'Review Directly on Google Maps ↗'
              : 'Search on Google Maps ↗'}
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

export default QuestionCard;
