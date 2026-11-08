/**
 * QuotaMeterBar Component Unit Tests (CMP-12)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuotaMeterBar } from './QuotaMeterBar';
import { formatResetDate } from '../../lib/utils/subscription';

describe('QuotaMeterBar (CMP-12)', () => {
  it('renders normal healthy usage correctly (<80%)', () => {
    render(
      <QuotaMeterBar
        usedCount={50}
        maxLimit={150}
        reservedCount={0}
        billingCycle="2026-11"
        resetAt="2026-12-01T00:00:00Z"
      />,
    );

    expect(screen.getByTestId('quota-meter-bar')).toBeInTheDocument();
    expect(screen.getByText('Monthly AI Review Quota')).toBeInTheDocument();
    expect(screen.getByText('Cycle 2026-11')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();

    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('50');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('100 available');
    expect(screen.getByText('(33%)')).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '50');
    expect(progressbar).toHaveAttribute('aria-valuemax', '150');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuetext', '50 of 150 AI review drafts used (33%)');

    // No warning banners visible in healthy state
    expect(screen.queryByTestId('quota-warning-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('renders TC-OWN-15 baseline scenario: 84 used, 66 remaining out of 150', () => {
    render(
      <QuotaMeterBar
        usedCount={84}
        maxLimit={150}
        reservedCount={0}
        billingCycle="2026-10"
        resetAt="2026-11-01T00:00:00Z"
      />,
    );

    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('84');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('66 available');
    expect(screen.getByText('(56%)')).toBeInTheDocument();

    // 84 / 150 = 56% -> healthy
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders reserved in-flight generations accurately', () => {
    render(
      <QuotaMeterBar
        usedCount={84}
        maxLimit={150}
        reservedCount={2}
        billingCycle="2026-10"
      />,
    );

    // Remaining capacity is 150 - 84 - 2 = 64
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('84');
    expect(screen.getByTestId('quota-reserved-count')).toHaveTextContent('(+2 reserved)');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('64 available');

    const reservedSegment = screen.getByTestId('quota-progressbar-reserved');
    expect(reservedSegment).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute(
      'aria-valuetext',
      '84 of 150 AI review drafts used (56%), 2 in-flight reservations',
    );
  });

  it('triggers warning state at exactly 80% usage boundary (120 of 150)', () => {
    render(<QuotaMeterBar usedCount={120} maxLimit={150} />);

    expect(screen.getByText('High Usage (≥80%)')).toBeInTheDocument();
    expect(screen.getByTestId('quota-warning-banner')).toBeInTheDocument();
    expect(screen.getByText(/Approaching Monthly Quota Limit \(80%\)/)).toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('remains in healthy state just below 80% (119 of 150 = 79%)', () => {
    render(<QuotaMeterBar usedCount={119} maxLimit={150} />);

    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByTestId('quota-warning-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('triggers warning state above 80% (121 of 150 = 81%)', () => {
    render(<QuotaMeterBar usedCount={121} maxLimit={150} />);

    expect(screen.getByText('High Usage (≥80%)')).toBeInTheDocument();
    expect(screen.getByTestId('quota-warning-banner')).toBeInTheDocument();
  });

  it('triggers exhausted alert only when monthly quota is fully committed (used=150, reserved=0, max=150)', () => {
    render(
      <QuotaMeterBar
        usedCount={150}
        maxLimit={150}
        reservedCount={0}
        resetAt="2026-12-01T00:00:00Z"
      />,
    );

    expect(screen.getByText('Quota Reached')).toBeInTheDocument();
    expect(screen.getByTestId('quota-exhausted-banner')).toBeInTheDocument();
    expect(screen.getByText(/Monthly AI Review Quota Reached/)).toBeInTheDocument();
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
    expect(screen.queryByTestId('quota-reserved-banner')).not.toBeInTheDocument();
  });

  it('distinguishes temporary reservation exhaustion from permanent monthly exhaustion (used=75, reserved=75, max=150)', () => {
    render(<QuotaMeterBar usedCount={75} maxLimit={150} reservedCount={75} />);

    // Capacity is not available (0 available)
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('75');
    expect(screen.getByTestId('quota-reserved-count')).toHaveTextContent('(+75 reserved)');
    expect(screen.getByText('(50%)')).toBeInTheDocument();

    // Badge indicates capacity reserved, NOT quota reached
    expect(screen.getByText('Capacity Reserved')).toBeInTheDocument();
    expect(screen.queryByText('Quota Reached')).not.toBeInTheDocument();

    // Shows temporary reservation banner, NOT permanent exhausted banner
    expect(screen.getByTestId('quota-reserved-banner')).toBeInTheDocument();
    expect(screen.getByText(/Capacity Temporarily Reserved/)).toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('handles full reservation with zero committed usage (used=0, reserved=150, max=150)', () => {
    render(<QuotaMeterBar usedCount={0} maxLimit={150} reservedCount={150} />);

    // 0 committed, 0 remaining, 150 reserved
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('0');
    expect(screen.getByTestId('quota-reserved-count')).toHaveTextContent('(+150 reserved)');
    expect(screen.getByText('(0%)')).toBeInTheDocument();

    expect(screen.getByText('Capacity Reserved')).toBeInTheDocument();
    expect(screen.getByTestId('quota-reserved-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('handles active reservation in healthy state (used=84, reserved=5, max=150)', () => {
    render(<QuotaMeterBar usedCount={84} maxLimit={150} reservedCount={5} />);

    // 150 - 84 - 5 = 61 remaining
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('84');
    expect(screen.getByTestId('quota-reserved-count')).toHaveTextContent('(+5 reserved)');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('61 available');
    expect(screen.getByText('(56%)')).toBeInTheDocument();

    // 84 / 150 = 56% committed -> Healthy
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByTestId('quota-warning-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-reserved-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-exhausted-banner')).not.toBeInTheDocument();
  });

  it('handles zero maximum limit gracefully without NaN or Infinity (used=0, reserved=0, max=0)', () => {
    render(<QuotaMeterBar usedCount={0} maxLimit={0} reservedCount={0} />);

    expect(screen.getByText('Zero Limit')).toBeInTheDocument();
    expect(screen.getByTestId('quota-zero-limit-banner')).toBeInTheDocument();
    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('0');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
    expect(screen.getByText('(0%)')).toBeInTheDocument();
  });

  it('clamps negative inputs safely to 0', () => {
    render(<QuotaMeterBar usedCount={-10} maxLimit={-50} reservedCount={-5} />);

    expect(screen.getByTestId('quota-used-count')).toHaveTextContent('0');
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
  });

  it('formats reset date in IST timezone correctly', () => {
    const formatted = formatResetDate('2026-12-01T00:00:00Z');
    // UTC 00:00 on Dec 1 is 05:30 AM IST on Dec 1
    expect(formatted).toContain('1 Dec 2026');
    expect(formatted).toContain('5:30');
    expect(formatted).toContain('IST');

    // Missing date fallback
    expect(formatResetDate(null)).toBe('End of monthly billing cycle');
    expect(formatResetDate('invalid-date')).toBe('End of monthly billing cycle');
  });
});
