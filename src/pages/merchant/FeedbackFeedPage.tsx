/**
 * Merchant Feedback Feed Page (/dashboard/feedback — SCR-OWN-08)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.3 (SCR-OWN-08)
 *   - docs/ROADMAP.md (v1.1) Task M5-T07
 *   - docs/API_SPEC.md (v1.2) API-OWN-05
 *   - docs/SECURITY.md (v1.1) §12 DPDPA Customer Note Privacy
 *
 * Responsibilities:
 * - Displays verified chronological customer survey submissions in the Merchant Owner Portal.
 * - Enforces strict tenant isolation via authenticated session business context.
 * - Displays affirmed experience facts snapshot (3 MCQs) and authoritative sentiment classification.
 * - Displays customer notes within 30-day window or accessible DPDPA privacy-purged indicator.
 * - Multi-criteria filtering:
 *     * Date range: "All Time", "Last 7 Days", "Last 30 Days", "Last 90 Days", and "Custom Range".
 *     * Sentiment filter: "All", "Positive", "Neutral", "Needs Attention" (critical).
 *     * Client-side privacy-safe search across customer notes and affirmed facts.
 * - Server-side pagination with exact total counts and deterministic ordering.
 * - Direct empty state linking to Digital QR Studio (/dashboard/qr) per Founder Decision M0-05.
 * - WCAG 2.2 AA contrast, 320px mobile responsive reflow, and full keyboard navigation.
 */

import * as React from 'react';
import { useNavigate } from 'react-router';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import {
  fetchMerchantFeedback,
  fetchSurveyOptionsMap,
  fetchSurveyQuestionsMap,
  deriveResponseSentiment,
  type SurveyQuestionOptionMeta,
  type QuestionMeta,
} from '../../lib/api/merchant';
import type { CustomerFeedback } from '../../lib/adapters/feedback';
import { FeedbackCardItem } from '../../components/merchant/FeedbackCardItem';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';

export type DateRangePreset = 'all' | '7d' | '30d' | '90d' | 'custom';

// eslint-disable-next-line react-refresh/only-export-components
export function calculateDateRangeBounds(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
): { startDate?: string; endDate?: string } {
  if (preset === 'custom') {
    return {
      startDate: customStart && customStart.trim() ? customStart.trim() : undefined,
      endDate: customEnd && customEnd.trim() ? customEnd.trim() : undefined,
    };
  }

  if (preset === 'all') {
    return {};
  }

  const daysMap: Record<'7d' | '30d' | '90d', number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
  };

  const days = daysMap[preset];
  const now = new Date();
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    startDate: past.toISOString().split('T')[0],
    endDate: now.toISOString().split('T')[0],
  };
}

const PAGE_SIZE = 50;

export function FeedbackFeedPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { business, loading: authLoading, error: authError } = useMerchantAuth();

  // Questionnaire metadata maps
  const [optionsMap, setOptionsMap] = React.useState<Map<string, SurveyQuestionOptionMeta> | null>(
    null,
  );
  const [questionsMap, setQuestionsMap] = React.useState<Map<string, QuestionMeta> | null>(null);

  // Feedback data state
  const [feedbacks, setFeedbacks] = React.useState<CustomerFeedback[]>([]);
  const [totalCount, setTotalCount] = React.useState<number>(0);
  const [loadingFeedback, setLoadingFeedback] = React.useState<boolean>(true);
  const [feedbackError, setFeedbackError] = React.useState<string | null>(null);

  // Filter & Pagination state
  const [dateRange, setDateRange] = React.useState<DateRangePreset>('all');
  const [customStart, setCustomStart] = React.useState<string>('');
  const [customEnd, setCustomEnd] = React.useState<string>('');
  const [sentimentFilter, setSentimentFilter] = React.useState<
    'all' | 'positive' | 'neutral' | 'critical'
  >('all');
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [refreshKey, setRefreshKey] = React.useState<number>(0);

  // 1. Load Questionnaire Options and Questions Metadata
  React.useEffect(() => {
    let isCancelled = false;

    async function loadMetadata() {
      try {
        const [optRes, qMap] = await Promise.all([
          fetchSurveyOptionsMap(),
          fetchSurveyQuestionsMap(business?.categoryId),
        ]);

        if (!isCancelled) {
          if (optRes.data) {
            setOptionsMap(optRes.data);
          }
          if (qMap) {
            setQuestionsMap(qMap);
          }
        }
      } catch (err) {
        console.warn('Failed to load questionnaire display metadata:', err);
      }
    }

    if (business?.id) {
      loadMetadata();
    }

    return () => {
      isCancelled = true;
    };
  }, [business?.id, business?.categoryId]);

  // 2. Load Feedbacks from API-OWN-05
  React.useEffect(() => {
    let cancelled = false;

    async function executeLoad() {
      if (!business?.id) return;

      const { startDate, endDate } = calculateDateRangeBounds(dateRange, customStart, customEnd);

      const result = await fetchMerchantFeedback({
        businessId: business.id,
        startDate,
        endDate,
        page: currentPage,
        pageSize: PAGE_SIZE,
      });

      if (!cancelled) {
        if (result.error) {
          setFeedbackError(result.error.message);
          setFeedbacks([]);
          setTotalCount(0);
        } else {
          setFeedbackError(null);
          setFeedbacks(result.data || []);
          setTotalCount(result.totalCount);
        }
        setLoadingFeedback(false);
      }
    }

    void executeLoad();

    return () => {
      cancelled = true;
    };
  }, [business, dateRange, customStart, customEnd, currentPage, refreshKey]);

  const handleRetry = React.useCallback(() => {
    setLoadingFeedback(true);
    setRefreshKey((k) => k + 1);
  }, []);

  // 3. Compute Summary Counts for Metric Cards
  const { positiveCount, neutralCount, criticalCount } = React.useMemo(() => {
    let pos = 0;
    let neu = 0;
    let crit = 0;

    for (const f of feedbacks) {
      const s = deriveResponseSentiment(f, optionsMap ?? undefined);
      if (s === 'positive') pos++;
      else if (s === 'neutral') neu++;
      else if (s === 'critical') crit++;
    }

    return { positiveCount: pos, neutralCount: neu, criticalCount: crit };
  }, [feedbacks, optionsMap]);

  // 4. Apply Client-side Filtering (Sentiment & Privacy Search)
  const filteredFeedbacks = React.useMemo(() => {
    let result = feedbacks;

    // Filter by sentiment tab
    if (sentimentFilter !== 'all') {
      result = result.filter(
        (f) => deriveResponseSentiment(f, optionsMap ?? undefined) === sentimentFilter,
      );
    }

    // Filter by client search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((f) => {
        // Match note
        if (f.optionalNote && f.optionalNote.toLowerCase().includes(q)) {
          return true;
        }

        // Match affirmed facts snapshot
        if (f.affirmedFactsSnapshot && Array.isArray(f.affirmedFactsSnapshot)) {
          for (const fact of f.affirmedFactsSnapshot) {
            const text =
              typeof fact === 'string'
                ? fact
                : typeof fact === 'object' && fact !== null && 'optionText' in fact
                  ? String((fact as { optionText?: unknown }).optionText || '')
                  : '';
            if (text.toLowerCase().includes(q)) return true;
          }
        }

        // Match selected option display text from optionsMap
        if (optionsMap && f.selectedOptions) {
          for (const sel of f.selectedOptions) {
            const opt = optionsMap.get(sel.optionId);
            if (opt && opt.optionText.toLowerCase().includes(q)) return true;
          }
        }

        return false;
      });
    }

    return result;
  }, [feedbacks, sentimentFilter, searchQuery, optionsMap]);

  // 5. Reset Filters Handler
  const handleResetFilters = React.useCallback(() => {
    setLoadingFeedback(true);
    setDateRange('all');
    setCustomStart('');
    setCustomEnd('');
    setSentimentFilter('all');
    setSearchQuery('');
    setCurrentPage(1);
    setRefreshKey((k) => k + 1);
  }, []);

  // Pagination Calculations
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const showingTo = Math.min(currentPage * PAGE_SIZE, totalCount);

  // Auth Loading Skeleton
  if (authLoading && !business) {
    return (
      <div
        className="space-y-6 max-w-5xl mx-auto py-6 px-3 sm:px-4 min-w-0"
        data-testid="feedback-feed-auth-skeleton"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  // Auth Error State
  if (authError || !business) {
    return (
      <div className="max-w-5xl mx-auto py-6 px-3 sm:px-4 min-w-0">
        <Card className="border-destructive/30 bg-destructive/10" data-testid="feedback-feed-error-card">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Unable to Load Business Feedback
            </CardTitle>
            <CardDescription className="text-xs text-text-secondary">
              {authError || 'No merchant business profile found for this authenticated account.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-text-secondary">
              Please sign out and sign in again, or contact support if this issue persists.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="space-y-6 max-w-5xl mx-auto py-6 px-3 sm:px-4 min-w-0"
      data-testid="feedback-feed-page"
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">
              Customer Feedback Stream
            </h1>
            <Badge variant="outline" className="text-xs font-medium border-border text-text-secondary">
              SCR-OWN-08
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Browse genuine customer survey submissions, affirmed experiences, and private notes.
          </p>
        </div>

        {/* Quick link to Digital QR Studio */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/dashboard/qr')}
          className="self-start sm:self-auto gap-1.5 shrink-0 text-xs font-semibold"
          data-testid="btn-nav-qr-studio"
        >
          <svg
            className="w-4 h-4 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Digital QR Studio</span>
        </Button>
      </div>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="feedback-metrics-strip">
        <button
          type="button"
          onClick={() => setSentimentFilter('all')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            sentimentFilter === 'all'
              ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
              : 'border-border bg-card hover:bg-surface-alt/50'
          }`}
          data-testid="metric-total-feedback"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
            Total Responses
          </p>
          <p className="text-2xl font-extrabold text-text-primary mt-1">{totalCount}</p>
        </button>

        <button
          type="button"
          onClick={() => setSentimentFilter('positive')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            sentimentFilter === 'positive'
              ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-500/10'
              : 'border-border bg-card hover:bg-surface-alt/50'
          }`}
          data-testid="metric-positive-feedback"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
            Positive
          </p>
          <p className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">
            {positiveCount}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSentimentFilter('neutral')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            sentimentFilter === 'neutral'
              ? 'border-slate-500 ring-2 ring-slate-400/20 bg-slate-500/10'
              : 'border-border bg-card hover:bg-surface-alt/50'
          }`}
          data-testid="metric-neutral-feedback"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Neutral
          </p>
          <p className="text-2xl font-extrabold text-slate-700 dark:text-slate-200 mt-1">
            {neutralCount}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSentimentFilter('critical')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            sentimentFilter === 'critical'
              ? 'border-amber-600 ring-2 ring-amber-500/20 bg-amber-500/10'
              : 'border-border bg-card hover:bg-surface-alt/50'
          }`}
          data-testid="metric-critical-feedback"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
            Needs Attention
          </p>
          <p className="text-2xl font-extrabold text-amber-700 dark:text-amber-300 mt-1">
            {criticalCount}
          </p>
        </button>
      </div>

      {/* Filter and Search Controls Toolbar */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <div
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
                aria-hidden="true"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <Input
                type="text"
                placeholder="Search notes or affirmed facts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 text-xs sm:text-sm"
                aria-label="Search feedback notes and facts"
                data-testid="feedback-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary p-0.5"
                  aria-label="Clear search query"
                  data-testid="feedback-clear-search-btn"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Date Range Dropdown */}
            <div className="w-full md:w-56 shrink-0">
              <Select
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value as DateRangePreset);
                  setCurrentPage(1);
                }}
                className="text-xs sm:text-sm"
                aria-label="Filter feedback by date range"
                data-testid="feedback-date-range-select"
              >
                <option value="all">All Time</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="custom">Custom Date Range</option>
              </Select>
            </div>
          </div>

          {/* Custom Date Range Pickers (shown when preset === 'custom') */}
          {dateRange === 'custom' && (
            <div
              className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-border/60"
              data-testid="custom-date-range-container"
            >
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-text-secondary whitespace-nowrap">From:</span>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-xs h-8"
                  aria-label="Custom start date"
                  data-testid="custom-date-start"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-text-secondary whitespace-nowrap">To:</span>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-xs h-8"
                  aria-label="Custom end date"
                  data-testid="custom-date-end"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCustomStart('');
                  setCustomEnd('');
                  setDateRange('all');
                  setCurrentPage(1);
                }}
                className="text-xs h-8 px-2 text-text-secondary"
              >
                Reset Dates
              </Button>
            </div>
          )}

          {/* Sentiment Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
            <span className="text-xs font-semibold text-text-secondary mr-1">Sentiment:</span>
            {(
              [
                { id: 'all', label: 'All', count: feedbacks.length },
                { id: 'positive', label: 'Positive', count: positiveCount },
                { id: 'neutral', label: 'Neutral', count: neutralCount },
                { id: 'critical', label: 'Needs Attention', count: criticalCount },
              ] as const
            ).map((tab) => {
              const active = sentimentFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSentimentFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-surface-alt border border-border/80 text-text-primary hover:bg-surface-alt/80'
                  }`}
                  data-testid={`sentiment-tab-${tab.id}`}
                >
                  {tab.label}
                  <span
                    className={
                      active
                        ? 'ml-1 text-primary-foreground font-normal'
                        : 'ml-1 text-text-secondary font-normal'
                    }
                  >
                    ({tab.count})
                  </span>
                </button>
              );
            })}

            {/* Active filters clear button */}
            {(sentimentFilter !== 'all' || searchQuery || dateRange !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="ml-auto text-xs h-7 px-2 text-text-secondary hover:text-text-primary"
                data-testid="btn-clear-all-filters"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content Stream Area */}
      <div className="space-y-4">
        {/* Loading Skeletons */}
        {loadingFeedback && (
          <div className="space-y-4" data-testid="feedback-loading-skeleton">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        )}

        {/* Database Query Error State */}
        {!loadingFeedback && feedbackError && (
          <Card className="border-destructive/30 bg-destructive/10" data-testid="feedback-query-error">
            <CardHeader>
              <CardTitle className="text-base text-destructive flex items-center gap-2">
                <svg className="w-5 h-5 text-destructive shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>Failed to Load Customer Feedback</span>
              </CardTitle>
              <CardDescription className="text-xs text-text-secondary">
                {feedbackError}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                onClick={handleRetry}
                data-testid="btn-retry-feedback"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Empty States */}
        {!loadingFeedback && !feedbackError && feedbacks.length === 0 && (
          <Card
            className="text-center p-8 sm:p-12 border-dashed border-border/80 bg-surface-alt/30"
            data-testid="feedback-empty-state"
          >
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-3">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <CardTitle className="text-base sm:text-lg font-bold text-text-primary mb-1">
              No Customer Feedback Yet
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm text-text-secondary max-w-md mx-auto mb-5 leading-relaxed">
              Display your digital QR code from the Digital QR Studio or share your review link with customers to start collecting authentic feedback!
            </CardDescription>
            <Button
              onClick={() => navigate('/dashboard/qr')}
              className="gap-1.5"
              data-testid="btn-empty-open-qr"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span>Open Digital QR Studio</span>
            </Button>
          </Card>
        )}

        {/* Filtered Out Empty State */}
        {!loadingFeedback && !feedbackError && feedbacks.length > 0 && filteredFeedbacks.length === 0 && (
          <Card
            className="text-center p-8 border-dashed border-border/80 bg-surface-alt/30"
            data-testid="feedback-no-matches"
          >
            <CardTitle className="text-base font-semibold text-text-primary mb-1">
              No Feedback Matches Your Criteria
            </CardTitle>
            <CardDescription className="text-xs text-text-secondary max-w-md mx-auto mb-4">
              We couldn't find any feedback records matching your active filter or search query.
            </CardDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              data-testid="btn-reset-filters"
            >
              Reset Filters
            </Button>
          </Card>
        )}

        {/* Feedbacks Stream List */}
        {!loadingFeedback && !feedbackError && filteredFeedbacks.length > 0 && (
          <div className="space-y-3.5" data-testid="feedback-cards-container">
            {filteredFeedbacks.map((item) => (
              <FeedbackCardItem
                key={item.id}
                feedback={item}
                optionsMap={optionsMap ?? undefined}
                questionsMap={questionsMap ?? undefined}
              />
            ))}
          </div>
        )}

        {/* Pagination Bar */}
        {!loadingFeedback && !feedbackError && totalCount > 0 && (
          <div
            className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border/60 text-xs text-text-secondary"
            data-testid="feedback-pagination-bar"
          >
            <div>
              Showing <span className="font-semibold text-text-primary">{showingFrom}</span>–
              <span className="font-semibold text-text-primary">{showingTo}</span> of{' '}
              <span className="font-semibold text-text-primary">{totalCount}</span> responses
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || loadingFeedback}
                className="h-8 text-xs px-3"
                data-testid="btn-pagination-prev"
              >
                Previous
              </Button>
              <span className="text-xs font-medium px-2" data-testid="pagination-page-indicator">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || loadingFeedback}
                className="h-8 text-xs px-3"
                data-testid="btn-pagination-next"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
