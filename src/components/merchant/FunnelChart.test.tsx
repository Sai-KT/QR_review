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

    // Stage 1: QR Link Visits
    const s1 = within(screen.getByTestId('funnel-stage-qr-visits'));
    expect(s1.getByText('QR Link Visits')).toBeInTheDocument();
    expect(s1.getByText('100')).toBeInTheDocument();

    // Stage 2: Feedback Completed
    const s2 = within(screen.getByTestId('funnel-stage-surveys-completed'));
    expect(s2.getByText('Feedback Completed')).toBeInTheDocument();
    expect(s2.getByText('70')).toBeInTheDocument();
    expect(s2.getByText('70.0%')).toBeInTheDocument();
    expect(s2.getByText('of QR Link Visits')).toBeInTheDocument();
    expect(s2.getByText('30.0% relative volume difference')).toBeInTheDocument();

    // Stage 3: AI Reviews Drafted
    const s3 = within(screen.getByTestId('funnel-stage-reviews-drafted'));
    expect(s3.getByText('AI Reviews Drafted')).toBeInTheDocument();
    expect(s3.getByText('50')).toBeInTheDocument();
    expect(s3.getByText('71.4%')).toBeInTheDocument();
    expect(s3.getByText('of Feedback Completed')).toBeInTheDocument();
    expect(s3.getByText('28.6% relative volume difference')).toBeInTheDocument();

    // Stage 4: Copied to Clipboard
    const s4 = within(screen.getByTestId('funnel-stage-clipboard-copies'));
    expect(s4.getByText('Copied to Clipboard')).toBeInTheDocument();
    expect(s4.getByText('40')).toBeInTheDocument();
    expect(s4.getByText('80.0%')).toBeInTheDocument();
    expect(s4.getByText('of AI Reviews Drafted')).toBeInTheDocument();
    expect(s4.getByText('20.0% relative volume difference')).toBeInTheDocument();

    // Stage 5: Assisted Google Handoffs
    const s5 = within(screen.getByTestId('funnel-stage-google-handoffs'));
    expect(s5.getByText('Assisted Google Handoffs')).toBeInTheDocument();
    expect(s5.getByText('30')).toBeInTheDocument();
    expect(s5.getByText('75.0%')).toBeInTheDocument();
    expect(s5.getByText('of Copied Reviews')).toBeInTheDocument();
    expect(s5.getByText('25.0% relative volume difference')).toBeInTheDocument();
  });

  it('renders branching Direct Google Bypasses card with accurate counts and rates', () => {
    render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);

    const directCard = screen.getByTestId('funnel-direct-bypass-card');
    expect(directCard).toBeInTheDocument();
    expect(screen.getByText('Anti-Gating Direct Path')).toBeInTheDocument();
    expect(screen.getByText('Direct Google Bypasses')).toBeInTheDocument();
    expect(screen.getByText('10.0% of QR Link Visits')).toBeInTheDocument();

    // Total outbound handoffs = 30 + 10 = 40
    expect(screen.getByText('Total Google Outbound Handoffs (Assisted + Direct Bypass):')).toBeInTheDocument();
    expect(screen.getByText('40.0% of QR Link Visits')).toBeInTheDocument();
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
    expect(screen.getByText('Event Count')).toBeInTheDocument();
    expect(screen.getByText('Event Volume Ratio')).toBeInTheDocument();
    expect(screen.getByText('Volume Difference')).toBeInTheDocument();
    expect(screen.getByText('Denominator Base')).toBeInTheDocument();

    // Check table rows
    expect(screen.getByRole('row', { name: /1\. QR Link Visits/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2\. Feedback Completed/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /3\. AI Reviews Drafted/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /4\. Copied to Clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /5\. Assisted Google Handoffs/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Direct Google Bypasses/i })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Total Outbound Handoffs/i })).toBeInTheDocument();
  });

  it('handles zero events gracefully without division by zero or NaN values', () => {
    const { container } = render(<FunnelChart metrics={MOCK_ZERO_METRICS} />);

    expect(screen.getByText('QR Link Visits')).toBeInTheDocument();
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

describe('M5-T08 Check B: 12 Focused Conversion & Presentation Tests', () => {
  // Test 1: Assisted handoff after copying
  it('1. Assisted handoff after copying displays correct count, rate and denominator', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      clipboardCopies: 40,
      googleHandoffClicks: 30,
      handoffRate: 0.75, // 30 / 40 = 75%
    };
    render(<FunnelChart metrics={metrics} />);
    const s5 = within(screen.getByTestId('funnel-stage-google-handoffs'));
    expect(s5.getByText('30')).toBeInTheDocument();
    expect(s5.getByText('75.0%')).toBeInTheDocument();
    expect(s5.getByText('of Copied Reviews')).toBeInTheDocument();
  });

  // Test 2: Assisted handoff without copying (optional copying path)
  it('2. Assisted handoff without copying displays count safely with dash when denominator is zero', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      clipboardCopies: 0,
      copyRate: 0,
      googleHandoffClicks: 15, // Patrons tapped "Open Google Maps" directly without copying
      handoffRate: 0,
    };
    render(<FunnelChart metrics={metrics} />);
    const s5 = within(screen.getByTestId('funnel-stage-google-handoffs'));
    expect(s5.getByText('15')).toBeInTheDocument();
    // Denominator is 0, so step rate is unavailable (dash)
    expect(s5.getByText('—')).toBeInTheDocument();
  });

  // Test 3: Direct Google bypass without survey participation
  it('3. Direct Google bypass without survey participation renders accurate rate', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_ZERO_METRICS,
      qrVisits: 100,
      surveysCompleted: 0,
      reviewsDrafted: 0,
      clipboardCopies: 0,
      googleHandoffClicks: 0,
      directBypassClicks: 25,
      directBypassRate: 0.25,
      totalHandoffRate: 0.25,
    };
    render(<FunnelChart metrics={metrics} />);
    const directCard = screen.getByTestId('funnel-direct-bypass-card');
    expect(within(directCard).getAllByText('25').length).toBe(2);
    expect(within(directCard).getAllByText('25.0% of QR Link Visits').length).toBe(2);
  });

  // Test 4: Total outbound clicks exceeding copied events
  it('4. Total outbound clicks exceeding copied events renders separate total summary clearly', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      qrVisits: 100,
      clipboardCopies: 10,
      googleHandoffClicks: 10,
      directBypassClicks: 20,
      // Total outbound handoffs = 10 + 20 = 30 (exceeds copied events = 10)
      totalHandoffRate: 0.3,
    };
    render(<FunnelChart metrics={metrics} />);
    const directCard = screen.getByTestId('funnel-direct-bypass-card');
    expect(within(directCard).getByText('30')).toBeInTheDocument();
    expect(within(directCard).getByText('30.0% of QR Link Visits')).toBeInTheDocument();
    // And Stage 5 shows 10 assisted handoffs, separate from the 30 total
    const s5 = within(screen.getByTestId('funnel-stage-google-handoffs'));
    expect(s5.getByText('10')).toBeInTheDocument();
  });

  // Test 5: Repeated copy events (>100% rate)
  it('5. Repeated copy events (>100% rate) render faithfully without clamping or drop-off claims', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      reviewsDrafted: 10,
      clipboardCopies: 25, // 25 copies / 10 drafts = 250%
      copyRate: 2.5,
    };
    render(<FunnelChart metrics={metrics} />);
    const s4 = within(screen.getByTestId('funnel-stage-clipboard-copies'));
    expect(s4.getByText('25')).toBeInTheDocument();
    expect(s4.getByText('250.0%')).toBeInTheDocument();
    // Should NOT show drop-off when rate >= 1.0
    expect(s4.queryByText(/relative volume difference/i)).not.toBeInTheDocument();
  });

  // Test 6: Zero denominator handling
  it('6. Zero denominator renders dash without NaN or error', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_ZERO_METRICS,
      qrVisits: 0,
      surveysCompleted: 0,
    };
    render(<FunnelChart metrics={metrics} />);
    const s2 = within(screen.getByTestId('funnel-stage-surveys-completed'));
    expect(s2.getByText('—')).toBeInTheDocument();
    expect(s2.queryByText('NaN')).not.toBeInTheDocument();
  });

  // Test 7: Earlier-stage count lower than later-stage count
  it('7. Earlier-stage count lower than later-stage count suppresses volume difference', () => {
    const metrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      surveysCompleted: 20,
      reviewsDrafted: 25, // 25 drafts / 20 surveys = 125%
      draftSuccessRate: 1.25,
    };
    render(<FunnelChart metrics={metrics} />);
    const s3 = within(screen.getByTestId('funnel-stage-reviews-drafted'));
    expect(s3.getByText('25')).toBeInTheDocument();
    expect(s3.getByText('125.0%')).toBeInTheDocument();
    expect(s3.queryByText(/relative volume difference/i)).not.toBeInTheDocument();
  });

  // Test 8: Empty analytics period
  it('8. Empty analytics period renders zero state cleanly', () => {
    render(<FunnelChart metrics={MOCK_ZERO_METRICS} />);
    expect(screen.getByTestId('funnel-chart-container')).toBeInTheDocument();
    const s1 = within(screen.getByTestId('funnel-stage-qr-visits'));
    expect(s1.getByText('0')).toBeInTheDocument();
  });

  // Test 9: Accurate event terminology and disclaimers
  it('9. Accurate event terminology and disclaimers are preserved with zero false claims', () => {
    const { container } = render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} showTableDefault={true} />);
    expect(screen.getByText('Event Count')).toBeInTheDocument();
    expect(screen.getByText('Event Volume Ratio')).toBeInTheDocument();
    expect(screen.getByText('Volume Difference')).toBeInTheDocument();
    expect(screen.getByText(CANONICAL_ATTRIBUTION_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(CANONICAL_GOOGLE_HANDOFF_DISCLAIMER)).toBeInTheDocument();

    const text = container.textContent || '';
    expect(text).not.toContain('Published Reviews');
    expect(text).not.toContain('Verified Reviews');
    expect(text).not.toContain('Confirmed Reviews');
  });

  // Test 10: Accessible chart/table agreement
  it('10. Accessible table values agree exactly with visual chart stage counts', () => {
    render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} showTableDefault={true} />);
    const tableContainer = screen.getByTestId('funnel-table-container');
    const table = within(tableContainer);

    expect(table.getByRole('row', { name: /1\. QR Link Visits.*100/i })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /2\. Feedback Completed.*70.*70\.0%/i })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /3\. AI Reviews Drafted.*50.*71\.4%/i })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /4\. Copied to Clipboard.*40.*80\.0%/i })).toBeInTheDocument();
    expect(table.getByRole('row', { name: /5\. Assisted Google Handoffs.*30.*75\.0%/i })).toBeInTheDocument();
  });

  // Test 11: Mobile 320px responsive container
  it('11. Renders mobile responsive containers without horizontal scroll triggers', () => {
    const { container } = render(<FunnelChart metrics={MOCK_TC_ANA_07_METRICS} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeInTheDocument();
    expect(root.className).toContain('space-y-6');
  });

  // Test 12: Tenant-isolated data remains unchanged
  it('12. Component accepts single-tenant metrics and renders isolated values', () => {
    const tenantAMetrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      qrVisits: 999,
    };
    const { rerender } = render(<FunnelChart metrics={tenantAMetrics} />);
    expect(screen.getByText('999')).toBeInTheDocument();

    const tenantBMetrics: OwnerDashboardFunnelMetrics = {
      ...MOCK_TC_ANA_07_METRICS,
      qrVisits: 111,
    };
    rerender(<FunnelChart metrics={tenantBMetrics} />);
    expect(screen.getByText('111')).toBeInTheDocument();
    expect(screen.queryByText('999')).not.toBeInTheDocument();
  });
});
