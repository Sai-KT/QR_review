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

  it('triggers exhausted alert at 100% capacity (150 of 150)', () => {
    render(
      <QuotaMeterBar
        usedCount={150}
        maxLimit={150}
        resetAt="2026-12-01T00:00:00Z"
      />,
    );

    expect(screen.getByText('Quota Reached')).toBeInTheDocument();
    expect(screen.getByTestId('quota-exhausted-banner')).toBeInTheDocument();
    expect(screen.getByText(/Monthly AI Review Quota Reached/)).toBeInTheDocument();
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
  });

  it('triggers exhausted alert when remaining count reaches 0 due to reservations', () => {
    render(<QuotaMeterBar usedCount={149} maxLimit={150} reservedCount={1} />);

    // 150 - 149 - 1 = 0 remaining
    expect(screen.getByText('Quota Reached')).toBeInTheDocument();
    expect(screen.getByTestId('quota-remaining-count')).toHaveTextContent('0 available');
  });

  it('handles zero maximum limit gracefully without NaN or Infinity', () => {
    render(<QuotaMeterBar usedCount={0} maxLimit={0} />);

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
