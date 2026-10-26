import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/utils.ts';
import { Badge } from '../ui/badge.tsx';

export interface MerchantLayoutProps {
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

/**
 * MerchantLayout
 *
 * Responsive layout shell for the Merchant Owner Portal (/dashboard/*).
 * Features a persistent desktop sidebar, accessible mobile navigation with touch targets
 * measuring >= 44x44 CSS px, route-aware NavLink indicators with proper end matching on /dashboard,
 * and a clear unauthenticated structural placeholder boundary.
 */
export function MerchantLayout({ children, className }: MerchantLayoutProps): React.JSX.Element {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const location = useLocation();

  // Reset mobile drawer during render if route changes
  const [prevPathname, setPrevPathname] = React.useState(location.pathname);
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    setIsMobileMenuOpen(false);
  }

  const menuButtonRef = React.useRef<HTMLButtonElement>(null);

  // Handle ESC key to dismiss mobile drawer and restore keyboard focus
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

  const primaryMobileDestinations = MERCHANT_NAV_DESTINATIONS.filter(
    (item) => item.isPrimaryMobile,
  );

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

        {/* Structural Merchant-Context Placeholder */}
        <div className="px-6 py-3.5 border-b border-border-subtle/80 bg-surface-subtle/50">
          <div className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">
            Workspace Context
          </div>
          <div className="text-xs text-foreground font-medium truncate mt-0.5">
            Merchant Portal Shell
          </div>
        </div>

        {/* Desktop Navigation */}
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

        {/* Desktop Sidebar Footer */}
        <div className="p-4 border-t border-border-subtle text-xs text-muted-foreground">
          <span>Tenant Isolated Portal Shell</span>
        </div>
      </aside>

      {/* Mobile Header Bar */}
      <header
        role="banner"
        className="lg:hidden h-14 border-b border-border-subtle bg-surface-base px-4 flex items-center justify-between sticky top-0 z-20"
      >
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
            QR
          </div>
          <span className="font-bold text-sm text-foreground tracking-tight">QR_review</span>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="merchant-mobile-navigation"
          aria-label={isMobileMenuOpen ? 'Close portal navigation' : 'Open portal navigation'}
          className="inline-flex items-center justify-center p-2 rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px]"
        >
          {isMobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* Mobile Collapsible Full Navigation Menu */}
      {isMobileMenuOpen && (
        <div
          id="merchant-mobile-navigation"
          className="lg:hidden border-b border-border bg-surface-base px-4 py-3 shadow-md z-20 sticky top-14"
          aria-label="Merchant Mobile Full Menu"
        >
          <div className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
            All Portal Destinations
          </div>
          <nav className="space-y-1" aria-label="Mobile Navigation Drawer">
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
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Main Landmark (includes padding bottom to ensure no overlap with mobile navigation bar) */}
        <main
          id="merchant-main-content"
          tabIndex={-1}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-20 lg:pb-8 focus:outline-none"
        >
          {children ?? <Outlet />}
        </main>

        {/* Desktop/Tablet Semantic Footer */}
        <footer
          role="contentinfo"
          className="hidden lg:flex border-t border-border-subtle px-4 sm:px-6 py-4 text-xs text-muted-foreground items-center justify-between"
        >
          <span>QR_review Merchant Portal Shell</span>
          <span>Approved Route Family: /dashboard/*</span>
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
