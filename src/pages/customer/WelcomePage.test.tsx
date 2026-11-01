import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { WelcomePage } from './WelcomePage';
import * as analyticsApi from '../../lib/api/analytics';
import type { PublicBusinessProjection } from '../../types/domain';

const mockBusiness: PublicBusinessProjection = {
  name: 'Luxe Salon & Spa',
  publicQrId: 'luxe000001',
  categoryId: 'salon',
  googleReviewUrl: 'https://g.page/r/luxe-salon/review',
  whatsappNumber: '+91 98765 43210',
  logoUrl: 'https://cdn.example.com/luxe.png',
  isActive: true,
  isSuspended: false,
  isDirectGoogleOnly: false,
  subscriptionStatus: 'active',
  accountStatus: 'active',
};

describe('WelcomePage Component (SCR-CUST-01 & SCR-CUST-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.spyOn(analyticsApi, 'trackEvent').mockResolvedValue({
      status: 'accepted',
      deduplicated: false,
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders SCR-CUST-01 WelcomeCard by default when handoff parameter is absent', () => {
    render(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Luxe Salon & Spa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start 30-Second Review/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Direct Google Review Handoff')).not.toBeInTheDocument();
  });

  it('renders SCR-CUST-09 DirectGoogleHandoff when ?handoff=direct is present in URL', () => {
    render(
      <MemoryRouter initialEntries={['/q/luxe000001?handoff=direct']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Direct Google Review Handoff')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open Google Maps to Review →/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /← Back to Quick Survey/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start 30-Second Review/i })).not.toBeInTheDocument();
  });

  it('navigates back from SCR-CUST-09 to SCR-CUST-01 when Back button is tapped', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/q/luxe000001?handoff=direct']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Direct Google Review Handoff')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /← Back to Quick Survey/i });
    await user.click(backBtn);

    // After clicking back, ?handoff=direct is removed, showing SCR-CUST-01
    await waitFor(() => {
      expect(screen.queryByText('Direct Google Review Handoff')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start 30-Second Review/i })).toBeInTheDocument();
    });
  });

  it('dispatches EVENT_QR_PAGE_VIEW telemetry on initial active render', async () => {
    render(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(1);
    });

    expect(analyticsApi.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_QR_PAGE_VIEW',
        sessionUuid: expect.any(String),
      }),
    );
  });

  it('deduplicates EVENT_QR_PAGE_VIEW across re-renders in the same session (StrictMode safe)', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(1);
    });

    // Rerender component
    rerender(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    // Should NOT have fired a second time
    expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(1);
  });

  it('does NOT dispatch EVENT_QR_PAGE_VIEW if business is suspended or inactive', async () => {
    render(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route
            path="/q/:qrId"
            element={
              <WelcomePage
                business={{ ...mockBusiness, isSuspended: true }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(analyticsApi.trackEvent).not.toHaveBeenCalled();
  });

  it('dispatches EVENT_GOOGLE_BYPASS_CLICK telemetry when patron clicks direct Google review bypass in SCR-CUST-01', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/q/luxe000001']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(1); // Page view
    });

    const bypassBtn = screen.getByRole('button', { name: /Review Directly on Google Maps ↗/i });
    await user.click(bypassBtn);

    expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(2);
    expect(analyticsApi.trackEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid: expect.any(String),
      }),
    );
  });

  it('dispatches EVENT_GOOGLE_BYPASS_CLICK telemetry when patron taps primary action in SCR-CUST-09', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/q/luxe000001?handoff=direct']}>
        <Routes>
          <Route path="/q/:qrId" element={<WelcomePage business={mockBusiness} />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(1); // Page view
    });

    const openMapsBtn = screen.getByRole('button', { name: /Open Google Maps to Review →/i });
    await user.click(openMapsBtn);

    expect(analyticsApi.trackEvent).toHaveBeenCalledTimes(2);
    expect(analyticsApi.trackEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        publicQrId: 'luxe000001',
        eventName: 'EVENT_GOOGLE_BYPASS_CLICK',
        sessionUuid: expect.any(String),
      }),
    );
  });
});
