import React from 'react';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useLocation,
  useParams,
} from 'react-router';
import { PlatformEntryPage } from './pages/PlatformEntryPage.tsx';
import { NotFoundPageShell } from './pages/NotFoundPageShell.tsx';

// Layout Shells
import { CustomerLayout } from './components/layout/CustomerLayout.tsx';
import { PortalLayout } from './components/merchant/PortalLayout.tsx';
import { AdminLayout } from './components/layout/AdminLayout.tsx';
import { AuthLayout } from './components/layout/AuthLayout.tsx';

// Lazy-Loaded Development Showcase
const DesignSystemShowcasePage = React.lazy(
  () => import('./pages/dev/DesignSystemShowcasePage.tsx'),
);

// Lazy-Loaded Grouped Customer Route Shells (/q/:qrId)
const CustomerReviewFlowPage = React.lazy(() => import('./pages/customer/CustomerPageShell.tsx'));

// Lazy-Loaded Grouped Authentication Route Shells
const AuthPages = {
  MerchantLogin: React.lazy(() =>
    import('./pages/auth/AuthPageShells.tsx').then((m) => ({ default: m.MerchantLoginPage })),
  ),
  ForgotPassword: React.lazy(() =>
    import('./pages/auth/AuthPageShells.tsx').then((m) => ({ default: m.ForgotPasswordPage })),
  ),
  ResetPassword: React.lazy(() =>
    import('./pages/auth/AuthPageShells.tsx').then((m) => ({ default: m.ResetPasswordPage })),
  ),
  AdminLogin: React.lazy(() =>
    import('./pages/auth/AuthPageShells.tsx').then((m) => ({ default: m.AdminLoginPage })),
  ),
  AdminMfa: React.lazy(() =>
    import('./pages/auth/AuthPageShells.tsx').then((m) => ({ default: m.AdminMfaPage })),
  ),
};

// Lazy-Loaded Grouped Merchant Route Shells (/dashboard/*)
const MerchantPages = {
  Overview: React.lazy(() =>
    import('./pages/merchant/MerchantPageShells.tsx').then((m) => ({
      default: m.MerchantOverviewPage,
    })),
  ),
  Profile: React.lazy(() =>
    import('./pages/merchant/ProfileSettingsPage.tsx').then((m) => ({
      default: m.ProfileSettingsPage,
    })),
  ),
  Destination: React.lazy(() =>
    import('./pages/merchant/GoogleDestinationPage.tsx').then((m) => ({
      default: m.GoogleDestinationPage,
    })),
  ),
  Qr: React.lazy(() =>
    import('./pages/merchant/DigitalQRPage.tsx').then((m) => ({
      default: m.DigitalQRPage,
    })),
  ),
  Feedback: React.lazy(() =>
    import('./pages/merchant/MerchantPageShells.tsx').then((m) => ({
      default: m.FeedbackFeedPage,
    })),
  ),
  Analytics: React.lazy(() =>
    import('./pages/merchant/MerchantPageShells.tsx').then((m) => ({
      default: m.AnalyticsPage,
    })),
  ),
  Subscription: React.lazy(() =>
    import('./pages/merchant/MerchantPageShells.tsx').then((m) => ({
      default: m.SubscriptionPlanPage,
    })),
  ),
  Settings: React.lazy(() =>
    import('./pages/merchant/MerchantPageShells.tsx').then((m) => ({
      default: m.AccountSettingsPage,
    })),
  ),
};

// Lazy-Loaded Grouped Super-Admin Route Shells (/admin/*)
const AdminPages = {
  Overview: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({ default: m.AdminOverviewPage })),
  ),
  Directory: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({
      default: m.MerchantDirectoryPage,
    })),
  ),
  Onboarding: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({
      default: m.MerchantOnboardingPage,
    })),
  ),
  Inspector: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({
      default: m.MerchantInspectorPage,
    })),
  ),
  Quotas: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({ default: m.QuotaConsumptionPage })),
  ),
  AuditLogs: React.lazy(() =>
    import('./pages/admin/AdminPageShells.tsx').then((m) => ({ default: m.AuditLogsStreamPage })),
  ),
};

function SuspenseWrapper({
  children,
  fallbackText = 'Loading route shell...',
}: {
  children: React.ReactNode;
  fallbackText?: string;
}) {
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-[40vh] items-center justify-center p-6 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-full border-2 border-brand-accent border-t-transparent animate-spin"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">{fallbackText}</p>
          </div>
        </div>
      }
    >
      {children}
    </React.Suspense>
  );
}

/**
 * MerchantCompatibilityRedirect
 *
 * Implements the approved roadmap compatibility redirect from /merchant/* to /dashboard/*
 * strictly preserving subpaths, query parameters, and URL hash fragments via client-side replace.
 * Also seamlessly redirects unauthenticated /merchant auth endpoints (/merchant/login, etc.)
 * directly to canonical authentication routes per ROADMAP.md M5-T02.
 */
function MerchantCompatibilityRedirect(): React.JSX.Element {
  const location = useLocation();

  if (location.pathname === '/merchant/login' || location.pathname.startsWith('/merchant/login/')) {
    const targetUrl = `/login${location.search}${location.hash}`;
    return <Navigate to={targetUrl} replace />;
  }
  if (location.pathname === '/merchant/forgot-password') {
    const targetUrl = `/forgot-password${location.search}${location.hash}`;
    return <Navigate to={targetUrl} replace />;
  }
  if (location.pathname === '/merchant/reset-password') {
    const targetUrl = `/reset-password${location.search}${location.hash}`;
    return <Navigate to={targetUrl} replace />;
  }

  const targetPath = location.pathname.replace(/^\/merchant(\/|$)/, '/dashboard$1');
  const targetUrl = `${targetPath}${location.search}${location.hash}`;
  return <Navigate to={targetUrl} replace />;
}

/**
 * AdminTenantRedirect
 *
 * Resolves legacy/alternative /admin/tenants/:id route to canonical /admin/businesses/:id
 * preserving path params, query parameters, and URL hash fragments.
 */
function AdminTenantRedirect(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const targetPath = `/admin/businesses/${id ?? ''}${location.search}${location.hash}`;
  return <Navigate to={targetPath} replace />;
}

const router = createBrowserRouter([
  // ── Development Gateway & Showcase (Preserved from Batch A) ─────────────
  {
    path: '/',
    element: <PlatformEntryPage />,
  },
  {
    path: '/showcase',
    element: (
      <SuspenseWrapper fallbackText="Loading design system showcase...">
        <DesignSystemShowcasePage />
      </SuspenseWrapper>
    ),
  },

  // ── Customer Public Flow (/q/:qrId) ─────────────────────────────────────
  {
    element: <CustomerLayout />,
    children: [
      {
        path: '/q/:qrId',
        element: (
          <SuspenseWrapper fallbackText="Loading customer review flow...">
            <CustomerReviewFlowPage />
          </SuspenseWrapper>
        ),
      },
    ],
  },

  // ── Authentication Flows (/login, /forgot-password, /admin/login, etc.) ─
  {
    element: <AuthLayout />,
    children: [
      {
        path: '/login',
        element: (
          <SuspenseWrapper fallbackText="Loading merchant sign in...">
            <AuthPages.MerchantLogin />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/forgot-password',
        element: (
          <SuspenseWrapper fallbackText="Loading password recovery...">
            <AuthPages.ForgotPassword />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/reset-password',
        element: (
          <SuspenseWrapper fallbackText="Loading password reset...">
            <AuthPages.ResetPassword />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/admin/login',
        element: (
          <SuspenseWrapper fallbackText="Loading admin sign in...">
            <AuthPages.AdminLogin />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/admin/mfa',
        element: (
          <SuspenseWrapper fallbackText="Loading MFA verification...">
            <AuthPages.AdminMfa />
          </SuspenseWrapper>
        ),
      },
      // ── Architectural & Roadmap Authentication Aliases ─────────────────
      {
        path: '/auth/login',
        element: (
          <SuspenseWrapper fallbackText="Loading sign in...">
            <AuthPages.MerchantLogin />
          </SuspenseWrapper>
        ),
      },
      {
        path: '/auth',
        element: <Navigate to="/login" replace />,
      },
      {
        path: '/auth/forgot-password',
        element: <Navigate to="/forgot-password" replace />,
      },
      {
        path: '/auth/reset-password',
        element: <Navigate to="/reset-password" replace />,
      },
    ],
  },

  // ── Merchant Owner Portal (/dashboard/*) ────────────────────────────────
  {
    path: '/dashboard',
    element: <PortalLayout />,
    children: [
      {
        index: true,
        element: (
          <SuspenseWrapper fallbackText="Loading dashboard overview...">
            <MerchantPages.Overview />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'profile',
        element: (
          <SuspenseWrapper fallbackText="Loading business profile...">
            <MerchantPages.Profile />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'destination',
        element: (
          <SuspenseWrapper fallbackText="Loading Google destination setup...">
            <MerchantPages.Destination />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'qr',
        element: (
          <SuspenseWrapper fallbackText="Loading digital QR studio...">
            <MerchantPages.Qr />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'feedback',
        element: (
          <SuspenseWrapper fallbackText="Loading customer feedback feed...">
            <MerchantPages.Feedback />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'analytics',
        element: (
          <SuspenseWrapper fallbackText="Loading conversion analytics...">
            <MerchantPages.Analytics />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'subscription',
        element: (
          <SuspenseWrapper fallbackText="Loading subscription & quota status...">
            <MerchantPages.Subscription />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'settings',
        element: (
          <SuspenseWrapper fallbackText="Loading account settings...">
            <MerchantPages.Settings />
          </SuspenseWrapper>
        ),
      },
      // ── Architectural & Alternative Merchant Path Aliases ───────────────
      {
        path: 'overview',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'google',
        element: <Navigate to="/dashboard/destination" replace />,
      },
      {
        path: 'quota',
        element: <Navigate to="/dashboard/subscription" replace />,
      },
      {
        path: 'insights',
        element: <Navigate to="/dashboard/feedback" replace />,
      },
    ],
  },

  // ── Roadmap Compatibility Redirects (/merchant/* -> /dashboard/*) ──────
  {
    path: '/merchant',
    element: <MerchantCompatibilityRedirect />,
  },
  {
    path: '/merchant/*',
    element: <MerchantCompatibilityRedirect />,
  },

  // ── Super-Admin Master Console (/admin/*) ───────────────────────────────
  {
    path: '/admin',
    element: <AdminLayout />,
    children: [
      {
        index: true,
        element: (
          <SuspenseWrapper fallbackText="Loading admin console overview...">
            <AdminPages.Overview />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'businesses',
        element: (
          <SuspenseWrapper fallbackText="Loading merchant directory...">
            <AdminPages.Directory />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'businesses/new',
        element: (
          <SuspenseWrapper fallbackText="Loading merchant onboarding...">
            <AdminPages.Onboarding />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'businesses/:id',
        element: (
          <SuspenseWrapper fallbackText="Loading tenant inspector...">
            <AdminPages.Inspector />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'quotas',
        element: (
          <SuspenseWrapper fallbackText="Loading quota balances...">
            <AdminPages.Quotas />
          </SuspenseWrapper>
        ),
      },
      {
        path: 'audit-logs',
        element: (
          <SuspenseWrapper fallbackText="Loading audit logs stream...">
            <AdminPages.AuditLogs />
          </SuspenseWrapper>
        ),
      },
      // ── Architectural & Alternative Super-Admin Path Aliases ───────────
      {
        path: 'overview',
        element: <Navigate to="/admin" replace />,
      },
      {
        path: 'merchants',
        element: <Navigate to="/admin/businesses" replace />,
      },
      {
        path: 'onboarding',
        element: <Navigate to="/admin/businesses/new" replace />,
      },
      {
        path: 'tenants/:id',
        element: <AdminTenantRedirect />,
      },
      {
        path: 'costs',
        element: <Navigate to="/admin/quotas" replace />,
      },
    ],
  },

  // ── Catch-All 404 Fallback ──────────────────────────────────────────────
  {
    path: '*',
    element: <NotFoundPageShell />,
  },
]);

export function AppRoutes(): React.JSX.Element {
  return <RouterProvider router={router} />;
}

export default AppRoutes;
