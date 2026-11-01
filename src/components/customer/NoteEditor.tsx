import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { sanitizeGoogleReviewUrl } from '../../lib/utils/customer';

export interface NoteEditorProps {
  businessName: string;
  logoUrl?: string | null;
  note: string;
  onChangeNote: (note: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
  submissionError?: string | null;
  targetGoogleUrl?: string | null;
  onDirectGoogleClick?: () => void;
  activeTokenText?: string;
  className?: string;
}

/**
 * NoteEditor (SCR-CUST-05)
 *
 * Optional 150-character customer feedback note editor displaying:
 * - Progress indicator (Final Step)
 * - Accessible textarea with strict 150-char ceiling
 * - Real-time live character counter
 * - Approved DPDPA 30-day pseudonymous retention privacy notice (M0-01)
 * - Back and Submit actions with in-flight double-click protection
 * - Universal anti-gating direct Google review bypass link
 */
export function NoteEditor({
  businessName,
  logoUrl,
  note,
  onChangeNote,
  onSubmit,
  onBack,
  isSubmitting = false,
  submissionError,
  targetGoogleUrl,
  onDirectGoogleClick,
  activeTokenText,
  className,
}: NoteEditorProps): React.JSX.Element {
  const [failedLogo, setFailedLogo] = React.useState(false);

  const cleanGoogleUrl = sanitizeGoogleReviewUrl(targetGoogleUrl);
  const destinationUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogleUrl = Boolean(cleanGoogleUrl);

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(destinationUrl, '_blank', 'noopener,noreferrer');
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    // Strict 150-character ceiling
    if (val.length <= 150) {
      onChangeNote(val);
    } else {
      onChangeNote(val.slice(0, 150));
    }
  };

  const charCount = note.length;
  const isNearLimit = charCount >= 140;
  const isAtLimit = charCount === 150;

  return (
    <Card className={`w-full shadow-md border-border ${className ?? ''}`.trim()}>
      <CardHeader className="pb-3">
        {/* Step Progress Header */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span className="font-medium">Final Step (Optional)</span>
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            100%
          </span>
        </div>

        {/* Progress Bar (Completed) */}
        <div
          role="progressbar"
          aria-valuenow={4}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-label="Survey progress: Final optional note"
          className="h-1.5 w-full bg-surface-muted rounded-full overflow-hidden mb-4"
        >
          <div className="h-full bg-primary rounded-full w-full" />
        </div>

        {/* Business Mini-Header */}
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

        <CardTitle className="text-heading-2 font-bold text-foreground text-center mt-3 leading-snug">
          Add an Optional Note
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground text-center mt-1">
          Mention specific staff or details you appreciated. This note is completely optional.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {/* Textarea Form Group */}
        <div>
          <label
            htmlFor="optional-customer-note"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            Personal Note (Optional, max 150 characters)
          </label>
          <Textarea
            id="optional-customer-note"
            value={note}
            onChange={handleChange}
            maxLength={150}
            rows={4}
            disabled={isSubmitting}
            placeholder="e.g. Loved the service by Priya, great ambience and coffee..."
            className="resize-none text-sm"
            aria-describedby="char-counter privacy-notice-text"
          />

          {/* Character Counter */}
          <div
            id="char-counter"
            className="flex justify-between items-center text-xs mt-1 px-0.5"
            aria-live="polite"
          >
            <span className="text-muted-foreground">
              {isAtLimit ? 'Maximum character limit reached' : 'Up to 150 characters'}
            </span>
            <span
              className={`font-mono text-xs ${
                isAtLimit
                  ? 'text-state-danger font-semibold'
                  : isNearLimit
                    ? 'text-state-warning font-medium'
                    : 'text-muted-foreground'
              }`}
            >
              {charCount} / 150
            </span>
          </div>
        </div>

        {/* DPDPA 30-Day Note Retention Notice (M0-01) */}
        <div
          id="privacy-notice-text"
          className="rounded-lg bg-surface-subtle border border-border-subtle p-3 text-xs text-muted-foreground leading-relaxed"
        >
          <p>
            🔒 <strong className="text-foreground">Privacy Notice:</strong> Notes are stored
            pseudonymously under our 30-day retention policy. We never sell your personal data.
          </p>
        </div>

        {/* Submission Error Banner */}
        {submissionError && (
          <div
            role="alert"
            className="rounded-lg bg-state-danger-bg border border-state-danger/30 p-3 text-xs text-state-danger"
          >
            <p className="font-medium">{submissionError}</p>
          </div>
        )}

        {/* Navigation Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            size="touch"
            className="flex-1 min-h-[48px] font-medium"
            onClick={onBack}
            disabled={isSubmitting}
            aria-label="Back to question 3"
          >
            ← Back
          </Button>

          <Button
            type="button"
            variant="default"
            size="touch"
            className="flex-1 min-h-[48px] font-semibold"
            onClick={onSubmit}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            aria-label={isSubmitting ? 'Submitting feedback' : 'Submit feedback'}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Feedback →'}
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

export default NoteEditor;

