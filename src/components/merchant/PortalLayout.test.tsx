import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router';
import type { Session, User } from '@supabase/supabase-js';
import { PortalLayout } from './PortalLayout';
import * as useMerchantAuthModule from '../../hooks/useMerchantAuth';
import type { Business } from '../../types/domain';

vi.mock('../../hooks/useMerchantAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof useMerchantAuthModule>();
  return {
    ...actual,
    useMerchantAuth: vi.fn(),
    MerchantAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

describe('PortalLayout (SCR-OWN-03 / M5-T02)', () => {
  const mockSignOut = vi.fn();
  const mockRefreshBusiness = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders accessible loading state while verifying credentials', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: true,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalLayout>
          <div>Child Content</div>
        </PortalLayout>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Verifying merchant credentials/i)).toBeInTheDocument();
    expect(screen.queryByText('Child Content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated visits to /login', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard/profile']}>
        <Routes>
          <Route path="/login" element={<div>Merchant Login Page</div>} />
          <Route
            path="/dashboard/*"
            element={
              <PortalLayout>
                <div>Protected Content</div>
              </PortalLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Merchant Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated visits to /login with encoded redirect_to query param', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    function LoginWatcher() {
      const [searchParams] = useSearchParams();
      return <div data-testid="login-redirect-param">{searchParams.get('redirect_to')}</div>;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard/analytics']}>
        <Routes>
          <Route path="/login" element={<LoginWatcher />} />
          <Route
            path="/dashboard/*"
            element={
              <PortalLayout>
                <div>Protected Content</div>
              </PortalLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('login-redirect-param')).toHaveTextContent('/dashboard/analytics');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('Check A: strips token-containing URL fragments and never transfers them into redirect_to', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    function LoginWatcher() {
      const [searchParams] = useSearchParams();
      return (
        <div>
          <span data-testid="login-redirect-param">{searchParams.get('redirect_to') ?? 'NONE'}</span>
        </div>
      );
    }

    render(
      <MemoryRouter
        initialEntries={[
          '/dashboard#access_token=sensitive_jwt_token_12345&refresh_token=secret_refresh_67890&type=recovery',
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginWatcher />} />
          <Route
            path="/dashboard/*"
            element={
              <PortalLayout>
                <div>Protected Content</div>
              </PortalLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // Tokens must NOT be in the redirect_to parameter
    const redirectParam = screen.getByTestId('login-redirect-param').textContent;
    expect(redirectParam).toBe('NONE');
    expect(redirectParam).not.toContain('access_token');
    expect(redirectParam).not.toContain('refresh_token');
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('Check B: prevents path traversal and rejects administrative destinations', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: null,
      user: null,
      business: null,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    function LoginWatcher() {
      const [searchParams] = useSearchParams();
      return <div data-testid="login-redirect-param">{searchParams.get('redirect_to') ?? 'NONE'}</div>;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard/../admin']}>
        <Routes>
          <Route path="/login" element={<LoginWatcher />} />
          <Route
            path="/dashboard/*"
            element={
              <PortalLayout>
                <div>Protected Content</div>
              </PortalLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const redirectParam = screen.getByTestId('login-redirect-param').textContent;
    expect(redirectParam).toBe('NONE');
    expect(redirectParam).not.toContain('admin');
  });

  it('renders error state when business profile fails to load', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: { user: { id: 'user-1' } } as unknown as Session,
      user: { id: 'user-1', email: 'merchant@local.test' } as unknown as User,
      business: null,
      loading: false,
      error: 'PostgREST query timed out',
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalLayout>
          <div>Child Content</div>
        </PortalLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('Unable to Load Business Profile')).toBeInTheDocument();
    expect(screen.getByText('PostgREST query timed out')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);
    expect(mockRefreshBusiness).toHaveBeenCalled();

    const signOutBtn = screen.getByRole('button', { name: /Sign Out/i });
    fireEvent.click(signOutBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('renders unassigned merchant state when no business is linked', () => {
    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: { user: { id: 'user-1' } } as unknown as Session,
      user: { id: 'user-1', email: 'unassigned@local.test' } as unknown as User,
      business: null,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalLayout>
          <div>Child Content</div>
        </PortalLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('No Business Profile Linked')).toBeInTheDocument();
    expect(screen.getByText(/unassigned@local.test/)).toBeInTheDocument();

    const signOutBtn = screen.getByRole('button', { name: /Sign Out/i });
    fireEvent.click(signOutBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('renders authenticated layout with business name, status, and navigation', () => {
    const mockBusiness = {
      id: 'b0000000-0000-4000-8000-000000000001',
      ownerId: 'user-1',
      name: 'Luxe Studio Unisex Salon',
      categoryId: 'salon',
      accountStatus: 'active',
      publicQrId: 'luxe000001',
      vanitySlug: 'luxe-studio',
      logoUrl: null,
      googlePlaceId: null,
      googleReviewUrl: null,
      whatsappNumber: '9876543210',
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    } as const;

    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: { user: { id: 'user-1' } } as unknown as Session,
      user: { id: 'user-1', email: 'merchant.luxe@local.test' } as unknown as User,
      business: mockBusiness as unknown as Business,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalLayout>
          <div data-testid="dashboard-content">Dashboard Metrics</div>
        </PortalLayout>
      </MemoryRouter>,
    );

    // Business identity verification
    expect(screen.getByTestId('merchant-business-name')).toHaveTextContent('Luxe Studio Unisex Salon');
    expect(screen.getByTestId('dashboard-content')).toHaveTextContent('Dashboard Metrics');

    // Desktop navigation links
    const desktopNav = screen.getByRole('navigation', { name: 'Merchant Portal Navigation' });
    expect(within(desktopNav).getByRole('link', { name: /Overview/i })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('link', { name: /Business Profile/i })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('link', { name: /Digital QR Studio/i })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('link', { name: /Feedback Feed/i })).toBeInTheDocument();
    expect(within(desktopNav).getByRole('link', { name: /Analytics/i })).toBeInTheDocument();

    // Sign out button
    const signOutBtn = screen.getByTestId('merchant-sign-out-btn');
    expect(signOutBtn).toBeInTheDocument();
    fireEvent.click(signOutBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('supports mobile drawer toggle and ESC key dismissal', () => {
    const mockBusiness: Partial<Business> = {
      id: 'b0000000-0000-4000-8000-000000000001',
      name: 'Luxe Studio',
      categoryId: 'salon',
      accountStatus: 'active',
    };

    vi.mocked(useMerchantAuthModule.useMerchantAuth).mockReturnValue({
      session: { user: { id: 'user-1' } } as unknown as Session,
      user: { id: 'user-1', email: 'merchant@local.test' } as unknown as User,
      business: mockBusiness as Business,
      loading: false,
      error: null,
      signOut: mockSignOut,
      refreshBusiness: mockRefreshBusiness,
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PortalLayout>
          <div>Content</div>
        </PortalLayout>
      </MemoryRouter>,
    );

    const toggleBtn = screen.getByTestId('merchant-mobile-menu-toggle');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    // Open mobile menu
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('navigation', { name: 'Mobile Navigation Drawer' })).toBeInTheDocument();

    // Press Escape to dismiss
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Mobile Navigation Drawer' })).not.toBeInTheDocument();
  });
});
