/**
 * Unit Tests for Subscription & Quota Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  formatResetDate,
  formatDate,
  formatDateTime,
  resolvePlanTierInfo,
  resolveSubscriptionStatusInfo,
} from './subscription';

describe('Subscription & Quota Utilities', () => {
  describe('formatResetDate', () => {
    it('formats ISO reset dates in IST', () => {
      const formatted = formatResetDate('2026-12-01T00:00:00Z');
      expect(formatted).toContain('1 Dec 2026');
      expect(formatted).toContain('5:30');
      expect(formatted).toContain('IST');
    });

    it('returns default fallback for null or invalid dates', () => {
      expect(formatResetDate(null)).toBe('End of monthly billing cycle');
      expect(formatResetDate('')).toBe('End of monthly billing cycle');
      expect(formatResetDate('not-a-date')).toBe('End of monthly billing cycle');
    });
  });

  describe('formatDate', () => {
    it('formats date string in en-IN locale', () => {
      const formatted = formatDate('2026-10-24');
      expect(formatted).toContain('24 Oct 2026');
    });

    it('returns default fallback for null or empty input', () => {
      expect(formatDate(null)).toBe('Not available');
      expect(formatDate('')).toBe('Not available');
    });
  });

  describe('formatDateTime', () => {
    it('formats ISO timestamp with time and IST suffix', () => {
      const formatted = formatDateTime('2026-10-24T20:50:07Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('IST');
    });

    it('returns default fallback for null or empty input', () => {
      expect(formatDateTime(null)).toBe('Not available');
      expect(formatDateTime('')).toBe('Not available');
    });
  });

  describe('resolvePlanTierInfo', () => {
    it('maps setup_package correctly', () => {
      const info = resolvePlanTierInfo('setup_package');
      expect(info.name).toBe('Setup Package');
      expect(info.badge).toBe('Setup Tier');
      expect(info.description).toContain('Includes digital QR studio setup');
    });

    it('maps standard_recurring correctly', () => {
      const info = resolvePlanTierInfo('standard_recurring');
      expect(info.name).toBe('Monthly Recurring Plan');
      expect(info.badge).toBe('Recurring Tier');
      expect(info.description).toContain('150 AI review drafts');
    });

    it('formats custom or unexpected plan tier safely', () => {
      const info = resolvePlanTierInfo('enterprise_custom');
      expect(info.name).toBe('Enterprise Custom');
      expect(info.badge).toBe('Custom Tier');
    });
  });

  describe('resolveSubscriptionStatusInfo', () => {
    it('maps pilot status to accent pill with evaluation description', () => {
      const info = resolveSubscriptionStatusInfo('pilot');
      expect(info.badgeLabel).toBe('Pilot Access');
      expect(info.variant).toBe('accent');
      expect(info.description).toContain('active pilot cohort');
    });

    it('maps active status to success pill', () => {
      const info = resolveSubscriptionStatusInfo('active');
      expect(info.badgeLabel).toBe('Active');
      expect(info.variant).toBe('success');
      expect(info.description).toContain('good standing');
    });

    it('maps past_due status to warning pill with anti-gating note', () => {
      const info = resolveSubscriptionStatusInfo('past_due');
      expect(info.badgeLabel).toBe('Past Due');
      expect(info.variant).toBe('warning');
      expect(info.description).toContain('route directly to your Google review page');
    });

    it('maps canceled status to destructive pill', () => {
      const info = resolveSubscriptionStatusInfo('canceled');
      expect(info.badgeLabel).toBe('Canceled');
      expect(info.variant).toBe('destructive');
      expect(info.description).toContain('route directly to your Google review link');
    });

    it('handles unexpected status safely', () => {
      const info = resolveSubscriptionStatusInfo('suspended_manual');
      expect(info.badgeLabel).toBe('suspended_manual');
      expect(info.variant).toBe('secondary');
    });
  });
});

