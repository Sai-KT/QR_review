/**
 * Subscription & Quota Utility Helpers
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-10)
 *   - docs/DATABASE_SCHEMA.md (v1.1) §5.7, §5.8
 *   - docs/API_SPEC.md (v1.2) §11.6, §11.9
 */

import type { PlanTier, SubscriptionStatus } from '../../types/domain';

export type StatusBadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'accent';

/**
 * Formats next reset timestamp in Indian Standard Time (IST / Asia/Kolkata).
 */
export function formatResetDate(resetAtIso?: string | null): string {
  if (!resetAtIso) return 'End of monthly billing cycle';
  try {
    const d = new Date(resetAtIso);
    if (isNaN(d.getTime())) return 'End of monthly billing cycle';

    return (
      new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(d) + ' IST'
    );
  } catch {
    return 'End of monthly billing cycle';
  }
}

/**
 * Formats date strings nicely in en-IN locale (e.g. "24 Oct 2026").
 */
export function formatDate(dateString?: string | null): string {
  if (!dateString) return 'Not available';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeZone: 'Asia/Kolkata',
    }).format(d);
  } catch {
    return dateString;
  }
}

/**
 * Formats ISO timestamps with time in en-IN locale (e.g. "24 Oct 2026, 8:50 pm IST").
 */
export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return 'Not available';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return (
      new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(d) + ' IST'
    );
  } catch {
    return isoString;
  }
}

/**
 * Maps database plan_tier into clear, honest merchant-facing labels.
 */
export function resolvePlanTierInfo(tier?: PlanTier | string): {
  name: string;
  badge: string;
  description: string;
} {
  switch (tier) {
    case 'setup_package':
      return {
        name: 'Setup Package',
        badge: 'Setup Tier',
        description:
          'Includes digital QR studio setup, custom 3-MCQ category survey, and 14-day pilot evaluation.',
      };
    case 'standard_recurring':
      return {
        name: 'Monthly Recurring Plan',
        badge: 'Recurring Tier',
        description:
          'Standard monthly commercial subscription including 150 AI review drafts per billing cycle.',
      };
    default:
      return {
        name: tier ? tier.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Standard Plan',
        badge: 'Custom Tier',
        description: 'Standard merchant review collection and digital QR access.',
      };
  }
}

/**
 * Maps database subscription_status into color-coded badges and plain-English explanations.
 */
export function resolveSubscriptionStatusInfo(status?: SubscriptionStatus | string): {
  badgeLabel: string;
  variant: StatusBadgeVariant;
  description: string;
} {
  switch (status) {
    case 'pilot':
      return {
        badgeLabel: 'Pilot Access',
        variant: 'accent',
        description:
          'Your venue is in the active pilot cohort. Digital QR sharing and AI review generation are fully enabled.',
      };
    case 'active':
      return {
        badgeLabel: 'Active',
        variant: 'success',
        description:
          'Your subscription is active and in good standing. Customer review drafting and digital QR codes are fully operational.',
      };
    case 'past_due':
      return {
        badgeLabel: 'Past Due',
        variant: 'warning',
        description:
          'Subscription renewal payment is pending. To prevent customer friction, customer QR scans will route directly to your Google review page without interruption.',
      };
    case 'canceled':
      return {
        badgeLabel: 'Canceled',
        variant: 'destructive',
        description:
          'Your subscription has ended. Customer QR scans will route directly to your Google review link.',
      };
    default:
      return {
        badgeLabel: status || 'Unknown',
        variant: 'secondary',
        description: 'Current subscription status is being verified.',
      };
  }
}

