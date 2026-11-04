import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FunnelChart } from './FunnelChart';
import type { OwnerDashboardFunnelMetrics } from '../../types/domain';
import {
  CANONICAL_ATTRIBUTION_DISCLAIMER,
  CANONICAL_GOOGLE_HANDOFF_DISCLAIMER,
} from '../../lib/adapters/analytics';

const MOCK_TC_ANA_07_METRICS: OwnerDashboardFunnelMetrics = {
  qrVisits: 100,
  qrPageViews: 100,
  surveysCompleted: 70,
  surveyCompletionRate: 0.7,
  completionRate: 0.7,
  reviewsDrafted: 50,
  generationsSuccess: 50,
  generationsRequested: 60,
  draftSuccessRate: 0.7143,
  clipboardCopies: 40,
  copySuccess: 40,
  copyRate: 0.8,
  googleHandoffClicks: 30,
  googleRedirectClicks: 30,
  handoffRate: 0.75,
  assistedHandoffRate: 0.75,
  directBypassClicks: 10,
  directBypassRate: 0.1,
  totalHandoffRate: 0.4,
};

const MOCK_ZERO_METRICS: OwnerDashboardFunnelMetrics = {
  qrVisits: 0,
  qrPageViews: 0,
  surveysCompleted: 0,
  surveyCompletionRate: 0,
  completionRate: 0,
  reviewsDrafted: 0,
  generationsSuccess: 0,
  generationsRequested: 0,
  draftSuccessRate: 0,
  clipboardCopies: 0,
  copySuccess: 0,
  copyRate: 0,
  googleHandoffClicks: 0,
  googleRedirectClicks: 0,
  handoffRate: 0,
  assistedHandoffRate: 0,
  directBypassClicks: 0,
  directBypassRate: 0,
  totalHandoffRate: 0,
};

describe('FunnelChart Component (CMP-14 / SCR-OWN-09)', () => {
  it('renders all 5 sequential conversion stages with exact counts and rates', () => {
    render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);

    // Stage 1
    const s1 = within(screen.getByTestId('funnel-stage-qr-visits'));
    expect(s1.getByText('QR Landing Visits')).toBeInTheDocument();
    expect(s1.getByText('100')).toBeInTheDocument();

    // Stage 2
    const s2 = within(screen.getByTestId('funnel-stage-surveys-completed'));
    expect(s2.getByText('Feedback Completed')).toBeInTheDocument();
    expect(s2.getByText('70')).toBeInTheDocument();
    expect(s2.getByText('70.0%')).toBeInTheDocument();
    expect(s2.getByText('of QR Landing Visits')).toBeInTheDocument();
    expect(s2.getByText('30.0% step drop-off')).toBeInTheDocument();

    // Stage 3
    const s3 = within(screen.getByTestId('funnel-stage-reviews-drafted'));
    expect(s3.getByText('AI Reviews Drafted')).toBeInTheDocument();
    expect(s3.getByText('50')).toBeInTheDocument();
    expect(s3.getByText('71.4%')).toBeInTheDocument();
    expect(s3.getByText('of Feedback Completed')).toBeInTheDocument();
    expect(s3.getByText('28.6% step drop-off')).toBeInTheDocument();

    // Stage 4
    const s4 = within(screen.getByTestId('funnel-stage-clipboard-copies'));
    expect(s4.getByText('Copied to Clipboard')).toBeInTheDocument();
    expect(s4.getByText('40')).toBeInTheDocument();
    expect(s4.getByText('80.0%')).toBeInTheDocument();
    expect(s4.getByText('of AI Reviews Drafted')).toBeInTheDocument();
    expect(s4.getByText('20.0% step drop-off')).toBeInTheDocument();

    // Stage 5
    const s5 = within(screen.getByTestId('funnel-stage-google-handoffs'));
    expect(s5.getByText('Google Maps Outbound Handoffs')).toBeInTheDocument();
    expect(s5.getByText('30')).toBeInTheDocument();
    expect(s5.getByText('75.0%')).toBeInTheDocument();
    expect(s5.getByText('of Copied Reviews')).toBeInTheDocument();
    expect(s5.getByText('25.0% step drop-off')).toBeInTheDocument();
  });

  it('renders branching Direct Google Bypasses card with accurate counts and rates', () => {
    render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);

    const directCard = screen.getByTestId('funnel-direct-bypass-card');
    expect(directCard).toBeInTheDocument();
    expect(screen.getByText('Anti-Gating Direct Path')).toBeInTheDocument();
    expect(screen.getByText('Direct Google Bypasses')).toBeInTheDocument();
    expect(screen.getByText('10.0% of QR visits')).toBeInTheDocument();

    // Total outbound handoffs = 30 + 10 = 40
    expect(screen.getByText('Total Google Outbound Handoffs (Assisted + Direct Bypass):')).toBeInTheDocument();
    expect(screen.getByText('40.0% of QR visits')).toBeInTheDocument();
  });

  it('renders mandatory Google Review Attribution Safeguard Disclaimer and forbids false claims', () => {
    const { container } = render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);

    const disclaimerCard = screen.getByTestId('attribution-disclaimer-card');
    expect(disclaimerCard).toBeInTheDocument();
    expect(screen.getByText('Google Review Attribution Safeguard')).toBeInTheDocument();
    expect(screen.getByText(CANONICAL_ATTRIBUTION_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(CANONICAL_GOOGLE_HANDOFF_DISCLAIMER)).toBeInTheDocument();

    // Strictly verify absence of forbidden claims
    const textContent = container.textContent || '';
    expect(textContent).not.toContain('Published Reviews');
    expect(textContent).not.toContain('Verified Reviews');
    expect(textContent).not.toContain('Confirmed Reviews');
    expect(textContent).not.toContain('Google Reviews Published');
  });

  it('toggles and displays accessible semantic HTML table for assistive tech', () => {
    render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);

    // Initially table is not shown
    expect(screen.queryByTestId('funnel-table-container')).not.toBeInTheDocument();

    // Click toggle button
    const toggleBtn = screen.getByTestId('toggle-table-btn');
    expect(toggleBtn).toHaveTextContent('Show Accessible Table');
    fireEvent.click(toggleBtn);

    // Table is now visible
    expect(screen.getByTestId('funnel-table-container')).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent('Hide Accessible Table');

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Caption and Headers
    expect(screen.getByText('Conversion Funnel Step-by-Step Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Funnel Stage')).toBeInTheDocument();
    expect(screen.getByText('Patron Count')).toBeInTheDocument();
    expect(screen.getByText('Step Conversion')).toBeInTheDocument();
    expect(screen.getByText('Step Drop-off')).toBeInTheDocument();
    expect(screen.getByText('Denominator Base')).toBeInTheDocument();

    // Check table rows
    expect(screen.getByRole('row', { name: /1\. QR Landing Visits/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2\. Feedback Completed/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /3\. AI Reviews Drafted/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /4\. Copied to Clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /5\. Google Maps Outbound Handoffs/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Direct Google Bypasses/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Total Outbound Handoffs/i })).toBeInTheDocument();
  });

  it('handles zero events gracefully without division by zero or NaN values', () => {
    const { container } = render(<FunnelChart metrics={MOCK_ZERO_METRICS} />);

    expect(screen.getByText('QR Landing Visits')).toBeInTheDocument();
    const textContent = container.textContent || '';
    expect(textContent).not.toContain('NaN');
    expect(textContent).not.toContain('Infinity');

    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars.length).toBe(5);
    progressBars.forEach((bar) => {
      expect(bar).toHaveAttribute('aria-valuenow', '0');
    });
  });
});
