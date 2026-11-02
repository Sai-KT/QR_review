import * as React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../ui/card';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import {
  getInitials,
  sanitizeGoogleReviewUrl,
  formatWhatsAppUrl,
} from '../../lib/utils/customer';
import {
  countWords,
  getWordCountGuidance,
  RECOMMENDED_MAX_WORD_COUNT,
} from '../../lib/utils/review';

export interface DraftEditorProps {
  /** Merchant store name for brand identity context */
  businessName?: string;
  /** Optional store logo URL */
  logoUrl?: string | null;
  /** Initial AI-generated review draft (uncontrolled initialization) */
  initialDraft?: string;
  /** Controlled value (optional, if parent manages ephemeral state) */
  value?: string;
  /** Callback when customer edits the review draft */
  onChange?: (draft: string) => void;
  /** Target Google review URL for anti-gating bypass */
  targetGoogleUrl?: string | null;
  /** Callback when patron clicks direct Google review bypass */
  onDirectGoogleClick?: () => void;
  /** Optional WhatsApp manager contact number */
  whatsappPhone?: string | null;
  /** Whether draft regeneration is actively in flight */
  isRegenerating?: boolean;
  /** Whether patron is eligible to regenerate (quota / single retry limit) */
  canRegenerate?: boolean;
  /** Callback to request a new draft suggestion */
  onRegenerate?: () => void;
  /** Error message if regeneration failed */
  regenerationError?: string | null;
  /** Continuation callback when patron approves draft (boundary for M4-T07 clipboard) */
  onAcceptAndCopy?: (finalDraft: string) => void;
  /** Custom class name */
  className?: string;
}

/**
 * DraftEditor (SCR-CUST-07)
 *
 * In-place customer review draft editor adhering to:
 * - FR-CUST-005: Grounded review draft display
 * - FR-CUST-006: Customer in-place editing freedom
 * - FR-AI-003: Output length constraints (< 50 words ceiling: 49w recommended)
 * - Founder Decision M0-16: Mandatory AI Transparency Notice
 * - Core Invariant #7: Universal anti-gating direct Google review access
 */
export function DraftEditor({
  businessName,
  logoUrl,
  initialDraft = '',
  value,
  onChange,
  targetGoogleUrl,
  onDirectGoogleClick,
  whatsappPhone,
  isRegenerating = false,
  canRegenerate = true,
  onRegenerate,
  regenerationError,
  onAcceptAndCopy,
  className,
}: DraftEditorProps): React.JSX.Element {
  // Ephemeral in-memory state: initialized from initialDraft or controlled value
  const isControlled = value !== undefined;
  const [prevInitialDraft, setPrevInitialDraft] = React.useState<string>(initialDraft);
  const [internalDraft, setInternalDraft] = React.useState<string>(initialDraft);
  const [imageError, setImageError] = React.useState<boolean>(false);

  // Synchronize internal draft when initialDraft changes (e.g. following regeneration)
  // Pattern adheres to React 19 recommendation for adjusting state on prop changes without useEffect
  if (initialDraft !== prevInitialDraft) {
    setPrevInitialDraft(initialDraft);
    if (!isControlled) {
      setInternalDraft(initialDraft);
    }
  }

  const currentDraft = isControlled ? (value ?? '') : internalDraft;

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    if (!isControlled) {
      setInternalDraft(nextVal);
    }
    onChange?.(nextVal);
  };

  // Advisory Word Count calculation
  const wordCount = countWords(currentDraft);
  const guidance = getWordCountGuidance(currentDraft);

  // Google Maps Destination Sanitization
  const cleanGoogleUrl = sanitizeGoogleReviewUrl(targetGoogleUrl);
  const destinationGoogleUrl = cleanGoogleUrl || 'https://www.google.com/maps';
  const hasConfiguredGoogle = Boolean(cleanGoogleUrl);
  const initials = businessName ? getInitials(businessName) : 'QR';
  const whatsAppUrl = formatWhatsAppUrl(whatsappPhone);

  const handleGoogleClick = () => {
    onDirectGoogleClick?.();
    window.open(destinationGoogleUrl, '_blank', 'noopener,noreferrer');
  };

  const handleAcceptAndCopyClick = () => {
    if (onAcceptAndCopy && currentDraft.trim().length > 0) {
      onAcceptAndCopy(currentDraft);
    }
  };

  const isDraftEmpty = currentDraft.trim().length === 0;

  return (
    <Card
      className={`w-full max-w-md mx-auto shadow-md border-border ${className ?? ''}`.trim()}
      data-testid="draft-editor-card"
    >
      <CardHeader className="flex flex-col items-center text-center pb-3">
        {/* Merchant Branding Header */}
        {businessName && (
          <div className="flex flex-col items-center mb-2">
            {logoUrl && !imageError ? (
              <img
                src={logoUrl}
                alt={`${businessName} logo`}
                onError={() => setImageError(true)}
                className="h-10 w-10 rounded-full object-cover border border-border shadow-xs mb-1"
              />
            ) : (
              <div
                className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm mb-1 select-none"
                aria-hidden="true"
              >
                {initials}
              </div>
            )}
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {businessName}
            </span>
          </div>
        )}

        {/* Heading & Subtitle */}
        <CardTitle className="text-heading-2 font-semibold text-foreground">
          Your Review Draft
        </CardTitle>
        <CardDescription className="text-body-normal text-muted-foreground mt-0.5">
          Review, personalize, and edit freely before posting.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {/* AI Transparency Notice (Mandatory Founder Decision M0-16 Design B) */}
        <div
          id="ai-transparency-notice"
          role="note"
          aria-label="AI generation notice"
          className="rounded-lg bg-surface-subtle border border-border-subtle p-3 text-left transition-colors"
          data-testid="ai-transparency-notice"
        >
          <div className="flex items-start gap-2">
            <span className="text-primary font-bold text-sm select-none" aria-hidden="true">
              ✦
            </span>
            <p className="text-xs text-foreground font-medium leading-relaxed">
              This draft is an AI suggestion based on your selections. Please edit or rewrite it as
              you see fit before posting.
            </p>
          </div>
        </div>

        {/* Regeneration Error Banner (if error occurred during regeneration attempt) */}
        {regenerationError && (
          <div
            role="alert"
            className="rounded-lg bg-state-danger-bg border border-state-danger/30 p-2.5 text-xs text-state-danger flex items-start gap-2"
            data-testid="regeneration-error-alert"
          >
            <span className="font-bold select-none" aria-hidden="true">
              ⚠
            </span>
            <span>{regenerationError}</span>
          </div>
        )}

        {/* Textarea Editor */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="review-draft-textarea"
              className="text-xs font-semibold text-foreground"
            >
              Review Text (Editable)
            </label>

            {/* Word Count Badge (Advisory) */}
            <Badge
              variant={guidance.isWithinRecommended ? 'outline' : 'warning'}
              size="sm"
              shape="pill"
              data-testid="word-counter-badge"
              aria-hidden="true"
            >
              {guidance.label}
            </Badge>
          </div>

          <Textarea
            id="review-draft-textarea"
            value={currentDraft}
            onChange={handleDraftChange}
            aria-label="Edit your review draft"
            aria-describedby="ai-transparency-notice word-counter-guidance"
            placeholder="Write your genuine review experience here..."
            className="min-h-[140px] text-sm leading-relaxed p-3 resize-y font-normal bg-surface-base"
            data-testid="draft-editor-textarea"
          />

          {/* Accessible Live Region for Screen Readers & Advisory Text */}
          <div
            id="word-counter-guidance"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs text-muted-foreground mt-1"
            data-testid="word-counter-guidance"
          >
            {guidance.advisoryText ? (
              <p className="text-state-warning font-medium">{guidance.advisoryText}</p>
            ) : (
              <p className="text-muted-foreground">
                Concise reviews (under 50 words) are recommended for readability on Google Maps.
              </p>
            )}
            <span className="sr-only">
              Current word count: {wordCount} words. Recommended ceiling: {RECOMMENDED_MAX_WORD_COUNT} words.
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="space-y-2 pt-2">
          {/* Primary CTA: Accept & Copy Continuation Action */}
          <Button
            type="button"
            variant="accent"
            size="touch"
            disabled={!onAcceptAndCopy || isDraftEmpty}
            onClick={handleAcceptAndCopyClick}
            className="w-full font-semibold text-base min-h-[48px]"
            data-testid="accept-and-copy-button"
          >
            Accept &amp; Copy Draft →
          </Button>

          {/* Secondary Action: Regenerate Draft (if handler provided) */}
          {onRegenerate && (
            <Button
              type="button"
              variant="outline"
              size="touch"
              disabled={isRegenerating || !canRegenerate}
              onClick={onRegenerate}
              className="w-full min-h-[44px] text-xs font-medium"
              data-testid="regenerate-draft-button"
            >
              {isRegenerating ? (
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-3.5 w-3.5 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  <span>Generating new draft...</span>
                </span>
              ) : !canRegenerate ? (
                'Regeneration limit reached'
              ) : (
                'Regenerate Suggestion ↻'
              )}
            </Button>
          )}

          {/* Independent Direct Google Review Anti-Gating Button */}
          <div className="pt-2 border-t border-border-subtle mt-3">
            <p className="text-xs text-muted-foreground text-center mb-2">
              Prefer to write directly without an AI suggestion?
            </p>
            <Button
              type="button"
              variant="outline"
              size="touch"
              onClick={handleGoogleClick}
              className="w-full min-h-[44px] text-xs"
              data-testid="direct-google-button"
            >
              {hasConfiguredGoogle
                ? 'Review Directly on Google Maps ↗'
                : 'Search on Google Maps ↗'}
            </Button>
          </div>

          {/* Optional WhatsApp Manager Contact Link */}
          {whatsAppUrl && (
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={() => {
                window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
              }}
              className="w-full min-h-[44px] text-xs text-muted-foreground hover:text-foreground"
              data-testid="whatsapp-contact-button"
            >
              Message Manager on WhatsApp ↗
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default DraftEditor;
