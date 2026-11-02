import * as React from 'react';
import { NavLink, Outlet, useLocation, Navigate } from 'react-router';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { MerchantAuthProvider, useMerchantAuth } from '../../hooks/useMerchantAuth';

export interface PortalLayoutProps {
  children?: React.ReactNode;
  className?: string;
}

interface NavDestination {
  label: string;
  href: string;
  end?: boolean;
  isPrimaryMobile?: boolean;
  icon: (props: { className?: string }) => React.JSX.Element;
}

function OverviewIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </svg>
  );
}

function DestinationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function QrIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h1" />
      <path d="M21 12v.01" />
      <path d="M12 21v-1" />
    </svg>
  );
}

function FeedbackIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function AnalyticsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

function SubscriptionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 shrink-0', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

const MERCHANT_NAV_DESTINATIONS: NavDestination[] = [
  { label: 'Overview', href: '/dashboard', end: true, isPrimaryMobile: true, icon: OverviewIcon },
  { label: 'Business Profile', href: '/dashboard/profile', icon: ProfileIcon },
  { label: 'Google Destination', href: '/dashboard/destination', icon: DestinationIcon },
  { label: 'Digital QR Studio', href: '/dashboard/qr', isPrimaryMobile: true, icon: QrIcon },
  {
    label: 'Feedback Feed',
    href: '/dashboard/feedback',
    isPrimaryMobile: true,
    icon: FeedbackIcon,
  },
  { label: 'Analytics', href: '/dashboard/analytics', isPrimaryMobile: true, icon: AnalyticsIcon },
  { label: 'Subscription & Quota', href: '/dashboard/subscription', icon: SubscriptionIcon },
  { label: 'Account Settings', href: '/dashboard/settings', icon: SettingsIcon },
];

function PortalLayoutContent({ children, className }: PortalLayoutProps): React.JSX.Element {
  const { session, user, business, loading, error, signOut, refreshBusiness } = useMerchantAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const location = useLocation();

  // Reset mobile drawer during render if route changes
  const [prevPathname, setPrevPathname] = React.useState(location.pathname);
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    setIsMobileMenuOpen(false);
  }

  const menuButtonRef = React.useRef<HTMLButtonElement>(null);

  // Handle ESC key to dismiss mobile drawer
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isMobileMenuOpen) {
        setIsMobileMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  // 1. Loading State
  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface-subtle text-foreground font-sans antialiased"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <span
            className="h-8 w-8 rounded-full border-3 border-brand-accent border-t-transparent animate-spin"
            aria-hidden="true"
          />
          <div>
            <p className="text-base font-semibold text-foreground">Verifying merchant credentials</p>
            <p className="text-xs text-muted-foreground mt-1">Establishing authenticated tenant context...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Guard Redirect
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // 3. Error State (Profile Fetch Failed)
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface-subtle text-foreground font-sans antialiased">
        <div className="max-w-md w-full bg-surface-base border border-destructive/30 rounded-lg p-6 shadow-sm text-center">
          <div className="h-12 w-12 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-4">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-foreground">Unable to Load Business Profile</h2>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="default" size="touch" onClick={refreshBusiness}>
              Retry
            </Button>
            <Button variant="outline" size="touch" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Unassigned Merchant State (No Business Linked)
  if (!business) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface-subtle text-foreground font-sans antialiased">
        <div className="max-w-md w-full bg-surface-base border border-border-subtle rounded-lg p-6 shadow-sm text-center">
          <div className="h-12 w-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
            <ProfileIcon className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold text-foreground">No Business Profile Linked</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Your account ({user?.email}) is signed in, but no active business profile was found. Please contact platform administration to activate your pilot location.
          </p>
          <div className="mt-6">
            <Button variant="outline" size="touch" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const primaryMobileDestinations = MERCHANT_NAV_DESTINATIONS.filter(
    (item) => item.isPrimaryMobile,
  );

  const statusVariant =
    business.accountStatus === 'active'
      ? 'success'
      : business.accountStatus === 'pilot'
        ? 'accent'
        : 'destructive';

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col lg:flex-row bg-surface-subtle text-foreground font-sans antialiased',
        className,
      )}
    >
      {/* Accessible Skip-to-Main-Content Link */}
      <a
        href="#merchant-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-sm font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop Persistent Left Sidebar */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:border-r lg:border-border-subtle lg:bg-surface-base"
        aria-label="Merchant sidebar"
      >
        {/* Brand Header */}
        <div className="h-16 px-6 border-b border-border-subtle flex items-center justify-between">
          <NavLink
            to="/dashboard"
            className="flex items-center gap-2 font-bold text-base tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md p-1"
          >
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              QR
            </div>
            <span>QR_review</span>
          </NavLink>
          <Badge variant="outline" size="sm" className="text-[10px]">
            Portal
          </Badge>
        </div>

        {/* Authenticated Business Context Card */}
        <div className="px-5 py-3.5 border-b border-border-subtle/80 bg-surface-subtle/50">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
              Business
            </span>
            <Badge
              variant={statusVariant}
              size="sm"
              className="text-[10px] uppercase font-mono px-1.5 py-0"
            >
              {business.accountStatus}
            </Badge>
          </div>
          <div
            className="text-sm text-foreground font-semibold truncate"
            title={business.name}
            data-testid="merchant-business-name"
          >
            {business.name}
          </div>
          <div className="text-xs text-muted-foreground capitalize mt-0.5">
            {business.categoryId}
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav
          className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
          aria-label="Merchant Portal Navigation"
        >
          {MERCHANT_NAV_DESTINATIONS.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors min-h-[44px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted font-normal',
                )
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Desktop Sidebar Footer with Sign Out */}
        <div className="p-3 border-t border-border-subtle space-y-2">
          <div className="px-3 py-1 text-[11px] text-muted-foreground truncate" title={user?.email}>
            {user?.email}
          </div>
          <button
            type="button"
            onClick={signOut}
            data-testid="merchant-sign-out-btn"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium"
            aria-label="Sign out of merchant account"
          >
            <SignOutIcon className="h-5 w-5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header Bar */}
      <header
        role="banner"
        className="lg:hidden h-14 border-b border-border-subtle bg-surface-base px-4 flex items-center justify-between sticky top-0 z-20"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
            QR
          </div>
          <span
            className="font-bold text-sm text-foreground tracking-tight truncate"
            data-testid="merchant-mobile-business-name"
          >
            {business.name}
          </span>
          <Badge
            variant={statusVariant}
            size="sm"
            className="text-[9px] uppercase font-mono px-1 py-0 shrink-0"
          >
            {business.accountStatus}
          </Badge>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="merchant-mobile-navigation"
          aria-label={isMobileMenuOpen ? 'Close portal navigation' : 'Open portal navigation'}
          data-testid="merchant-mobile-menu-toggle"
          className="inline-flex items-center justify-center p-2 rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px] shrink-0"
        >
          {isMobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* Mobile Collapsible Full Navigation Menu */}
      {isMobileMenuOpen && (
        <div
          id="merchant-mobile-navigation"
          className="lg:hidden border-b border-border bg-surface-base px-4 py-3 pb-24 shadow-xl z-30 sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto"
          aria-label="Merchant Mobile Full Menu"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
            <span>Portal Destinations</span>
            <span className="text-[10px] lowercase text-muted-foreground/80">{user?.email}</span>
          </div>
          <nav className="space-y-1 mb-4" aria-label="Mobile Navigation Drawer">
            {MERCHANT_NAV_DESTINATIONS.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.end}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors min-h-[44px]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-primary text-primary-foreground font-medium shadow-xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted font-normal',
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="border-t border-border-subtle pt-3">
            <button
              type="button"
              onClick={signOut}
              data-testid="merchant-mobile-sign-out-btn"
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium border border-destructive/20"
            >
              <SignOutIcon className="h-5 w-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <main
          id="merchant-main-content"
          tabIndex={-1}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-20 lg:pb-8 focus:outline-none"
        >
          {children ?? <Outlet context={{ business, user, refreshBusiness }} />}
        </main>

        <footer
          role="contentinfo"
          className="hidden lg:flex border-t border-border-subtle px-4 sm:px-6 py-4 text-xs text-muted-foreground items-center justify-between"
        >
          <span>QR_review Merchant Portal Shell</span>
          <span>Tenant Isolated Session</span>
        </footer>
      </div>

      {/* Mobile Touch-Friendly Primary Bottom Navigation Bar */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 h-16 bg-surface-base border-t border-border-subtle flex items-center justify-around px-2 z-20 shadow-lg"
        aria-label="Primary Mobile Navigation"
      >
        {primaryMobileDestinations.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-medium min-h-[44px] min-w-[44px] rounded-md transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate mt-0.5">{item.label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/**
 * PortalLayout
 *
 * Wraps merchant dashboard routes in MerchantAuthProvider, enforcing:
 * - Active Supabase Auth session requirement (unauthenticated requests redirect to /login).
 * - Automatic resolution of active business profile via API-OWN-01.
 * - Responsive desktop sidebar with business name, category, and account status.
 * - Accessible mobile navigation with >= 44x44px touch targets.
 * - One-click secure sign-out.
 */
export function PortalLayout({ children, className }: PortalLayoutProps): React.JSX.Element {
  return (
    <MerchantAuthProvider>
      <PortalLayoutContent className={className}>{children}</PortalLayoutContent>
    </MerchantAuthProvider>
  );
}
