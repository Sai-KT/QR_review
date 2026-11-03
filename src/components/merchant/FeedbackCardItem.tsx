/**
 * Merchant Feedback Card Item Component (CMP-13 / SCR-OWN-08)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.3 (SCR-OWN-08); §13 (CMP-13)
 *   - docs/ROADMAP.md (v1.1) Task M5-T07
 *   - docs/SECURITY.md (v1.1) §12 DPDPA Data Privacy & 30-Day Note Retention
 *   - docs/API_SPEC.md (v1.2) API-OWN-05
 *
 * Responsibilities:
 * - Displays a single verified customer feedback submission in the merchant feedback feed.
 * - Displays creation timestamp with accessible formatted date and relative time.
 * - Displays authoritative sentiment badge (positive, neutral, critical) derived strictly
 *   from survey_options affirmative selections.
 * - Displays authentic customer visit badge if authenticityConfirmed is true.
 * - Displays MCQ response breakdown and affirmed experience facts.
 * - Preserves customer privacy per Founder Decision M0-01 (DPDPA 30-day retention):
 *     * Case A (Retained): renders sanitized customer note in quote block.
 *     * Case B (Purged): renders privacy badge `[Personal note expired per privacy policy]`.
 *     * Case C (None): renders subtle `No additional note provided.` (NEVER flagged as purged).
 * - Zero PII, zero internal database IDs, and zero fabricated review text.
 * - WCAG 2.2 AA contrast, 320px responsive reflow, and accessible HTML semantics.
 */

import * as React from 'react';
import type {
  CustomerFeedback,
  SelectedSurveyOption,
  AffirmedFact,
} from '../../lib/adapters/feedback';
import {
  deriveResponseSentiment,
  type SurveyQuestionOptionMeta,
  type QuestionMeta,
  type DerivedSentiment,
} from '../../lib/api/merchant';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

export interface FeedbackCardItemProps {
  feedback: CustomerFeedback;
  optionsMap?: Map<string, SurveyQuestionOptionMeta>;
  questionsMap?: Map<string, QuestionMeta>;
  className?: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function formatFeedbackDate(isoString: string): { relative: string; full: string } {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return { relative: 'Recently', full: isoString };
    }
    const full = new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);

    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return { relative: 'Just now', full };
    if (diffMins < 60) return { relative: `${diffMins}m ago`, full };
    if (diffHours < 24) return { relative: `${diffHours}h ago`, full };
    if (diffDays === 1) return { relative: 'Yesterday', full };
    if (diffDays < 30) return { relative: `${diffDays}d ago`, full };
    return { relative: full, full };
  } catch {
    return { relative: 'Recently', full: isoString };
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function isFeedbackNoteExpired(
  purgedAt: string | null | undefined,
  createdAt?: string,
): boolean {
  if (purgedAt) return true;
  if (!createdAt) return false;
  const createdMs = new Date(createdAt).getTime();
  if (isNaN(createdMs)) return false;
  return Date.now() - createdMs > 30 * 24 * 60 * 60 * 1000;
}

export function FeedbackCardItem({
  feedback,
  optionsMap,
  questionsMap,
  className = '',
}: FeedbackCardItemProps): React.JSX.Element {
  const sentiment: DerivedSentiment = React.useMemo(() => {
    return deriveResponseSentiment(feedback, optionsMap);
  }, [feedback, optionsMap]);

  const { relative: relativeTime, full: fullFormattedDate } = React.useMemo(() => {
    return formatFeedbackDate(feedback.createdAt);
  }, [feedback.createdAt]);

  // Case B / D: Note is explicitly purged OR past the mandatory 30-day DPDPA retention ceiling
  const isPurged = React.useMemo(() => {
    return isFeedbackNoteExpired(feedback.purgedAt, feedback.createdAt);
  }, [feedback.purgedAt, feedback.createdAt]);

  const hasNote = Boolean(
    !isPurged && feedback.optionalNote && feedback.optionalNote.trim().length > 0,
  );

  return (
    <Card
      role="article"
      className={`border-border bg-card shadow-sm transition-shadow hover:shadow-md ${className}`}
      aria-label={`Customer feedback from ${fullFormattedDate}`}
      data-testid="feedback-card-item"
    >
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Timestamp with title tooltip */}
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <svg
              className="w-3.5 h-3.5 text-text-secondary shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <time
              dateTime={feedback.createdAt}
              title={fullFormattedDate}
              className="font-medium text-text-secondary"
            >
              {relativeTime}
            </time>
            <span className="text-text-secondary hidden sm:inline" aria-hidden="true">
              •
            </span>
            <span className="text-[11px] text-text-secondary hidden sm:inline">
              {fullFormattedDate}
            </span>
          </div>

          {/* Badges: Sentiment and Authenticity */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Authenticity confirmed badge */}
            {feedback.authenticityConfirmed && (
              <Badge
                variant="outline"
                className="text-[11px] font-medium border-primary/30 text-primary bg-primary/10 gap-1"
                data-testid="badge-authenticity-confirmed"
              >
                <svg
                  className="w-3 h-3 text-primary shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <span>Verified Visit</span>
              </Badge>
            )}

            {/* Authoritative sentiment badge */}
            {sentiment === 'positive' && (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold border-emerald-600/30 text-emerald-800 dark:text-emerald-300 bg-emerald-500/10 gap-1"
                data-testid="badge-sentiment-positive"
              >
                <svg
                  className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <span>Positive</span>
              </Badge>
            )}

            {sentiment === 'critical' && (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold border-amber-600/30 text-amber-800 dark:text-amber-300 bg-amber-500/10 gap-1"
                data-testid="badge-sentiment-critical"
              >
                <svg
                  className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Needs Attention</span>
              </Badge>
            )}

            {sentiment === 'neutral' && (
              <Badge
                variant="outline"
                className="text-[11px] font-semibold border-slate-400/30 text-slate-700 dark:text-slate-300 bg-slate-500/10 gap-1"
                data-testid="badge-sentiment-neutral"
              >
                <svg
                  className="w-3 h-3 text-slate-500 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>Neutral</span>
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* MCQ Answers & Affirmed Facts Section */}
        <div className="space-y-2.5">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            Affirmed Experience Facts
          </h4>

          {feedback.selectedOptions && feedback.selectedOptions.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {feedback.selectedOptions.map((sel: SelectedSurveyOption, idx: number) => {
                const optMeta = optionsMap?.get(sel.optionId);
                const questionMeta = optMeta ? questionsMap?.get(optMeta.questionId) : undefined;

                // Historical survey integrity: If option metadata is retired or unavailable,
                // fall back to the customer's frozen affirmed fact snapshot from submission time
                const snapshotFact = Array.isArray(feedback.affirmedFactsSnapshot)
                  ? (feedback.affirmedFactsSnapshot as Array<string | AffirmedFact>)[idx]
                  : undefined;
                const snapshotText =
                  typeof snapshotFact === 'string'
                    ? snapshotFact
                    : typeof snapshotFact === 'object' &&
                        snapshotFact !== null &&
                        'optionText' in snapshotFact
                      ? (snapshotFact as { optionText?: string }).optionText
                      : undefined;

                const displayText = optMeta ? optMeta.optionText : (snapshotText || `Option ${idx + 1}`);
                const emoji = optMeta?.emojiAnchor || '';
                const isNegative = optMeta?.sentimentLabel === 'negative';
                const isHistorical = !optMeta && Boolean(snapshotText);

                return (
                  <div
                    key={`${feedback.id}-opt-${sel.optionId || idx}`}
                    className={`rounded-lg border p-2.5 text-xs transition-colors ${
                      isNegative
                        ? 'border-amber-500/30 bg-amber-500/5 text-amber-950 dark:text-amber-200'
                        : 'border-border/70 bg-surface-alt/40 text-text-primary'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <p className="text-[11px] text-text-secondary font-medium truncate">
                        {questionMeta?.questionText || `Question ${idx + 1}`}
                      </p>
                      {isHistorical && (
                        <span
                          className="text-[9px] uppercase tracking-wider text-text-secondary font-medium bg-surface-alt px-1 py-0.2 rounded border border-border/60 shrink-0"
                          title="Questionnaire option is retired; displaying verified snapshot from submission time"
                        >
                          Historical
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-text-primary flex items-center gap-1.5">
                      {emoji && <span aria-hidden="true">{emoji}</span>}
                      <span>{displayText}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          ) : Array.isArray(feedback.affirmedFactsSnapshot) &&
            feedback.affirmedFactsSnapshot.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {(feedback.affirmedFactsSnapshot as Array<string | AffirmedFact>).map(
                (fact: string | AffirmedFact, idx: number) => {
                  const text =
                    typeof fact === 'string' ? fact : fact.optionText || `Fact ${idx + 1}`;
                  return (
                    <Badge
                      key={`${feedback.id}-fact-${idx}`}
                      variant="secondary"
                      className="text-xs py-1 px-2.5 font-medium border-border"
                    >
                      {text}
                    </Badge>
                  );
                },
              )}
            </div>
          ) : (
            <p className="text-xs text-text-secondary italic">No survey responses recorded.</p>
          )}
        </div>

        {/* Customer Note Section (DPDPA 30-Day Retention Handling) */}
        <div className="pt-1">
          {/* Case B: Purged note (purgedAt is set) */}
          {isPurged ? (
            <div
              className="rounded-lg border border-border/70 bg-surface-alt/30 p-3 space-y-1.5"
              data-testid="feedback-note-purged"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                <svg
                  className="w-3.5 h-3.5 text-text-secondary shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Customer Note</span>
                <Badge
                  variant="outline"
                  className="text-[10px] font-medium border-border/80 text-text-secondary ml-auto"
                >
                  Expired
                </Badge>
              </div>
              <p className="text-xs text-text-secondary font-medium">
                [Personal note expired per privacy policy]
              </p>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                Customer notes are automatically expunged after 30 days in compliance with data privacy policies (DPDPA).
              </p>
            </div>
          ) : hasNote ? (
            /* Case A: Active Retained note */
            <div
              className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5"
              data-testid="feedback-note-retained"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <svg
                  className="w-3.5 h-3.5 text-primary shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Customer Note</span>
              </div>
              <blockquote className="text-xs sm:text-sm text-text-primary leading-relaxed pl-2.5 border-l-2 border-primary/50 italic">
                &ldquo;{feedback.optionalNote}&rdquo;
              </blockquote>
            </div>
          ) : (
            /* Case C: Customer provided no note */
            <div
              className="text-xs text-text-secondary italic pl-1"
              data-testid="feedback-note-none"
            >
              No additional note provided.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
