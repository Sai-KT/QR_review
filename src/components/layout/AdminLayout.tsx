import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { cn } from '../../lib/utils.ts';
import { Badge } from '../ui/badge.tsx';

export interface AdminLayoutProps {
  children?: React.ReactNode;
  className?: string;
}

interface AdminNavDestination {
  label: string;
  href: string;
  end?: boolean;
  icon: (props: { className?: string }) => React.JSX.Element;
}

function DashboardIcon({ className }: { className?: string }) {
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
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

function DirectoryIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function QuotaIcon({ className }: { className?: string }) {
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
      <path d="M12 2v20" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function AuditIcon({ className }: { className?: string }) {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
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

const ADMIN_NAV_DESTINATIONS: AdminNavDestination[] = [
  { label: 'System Overview', href: '/admin', end: true, icon: DashboardIcon },
  { label: 'Merchant Directory', href: '/admin/businesses', icon: DirectoryIcon },
  { label: 'Quota Monitoring', href: '/admin/quotas', icon: QuotaIcon },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: AuditIcon },
];

/**
 * AdminLayout
 *
 * Responsive layout shell for the Super-Admin Master Console (/admin/*).
 * Provides administrative navigation with accessible NavLink indicators, minimum 44px
 * touch targets, skip-to-content links, and clear structural shell demarcations without
 * simulating authenticated sessions or claiming active MFA verification.
 */
export function AdminLayout({ children, className }: AdminLayoutProps): React.JSX.Element {
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

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col lg:flex-row bg-surface-subtle text-foreground font-sans antialiased',
        className,
      )}
    >
      {/* Accessible Skip-to-Main-Content Link */}
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-sm font-medium"
      >
        Skip to main content
      </a>

      {/* Desktop Persistent Admin Sidebar */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:border-r lg:border-border-subtle lg:bg-surface-base"
        aria-label="Super-Admin sidebar"
      >
        <div className="h-16 px-6 border-b border-border-subtle flex items-center justify-between">
          <NavLink
            to="/admin"
            className="flex items-center gap-2 font-bold text-base tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md p-1"
          >
            <div className="h-7 w-7 rounded-md bg-brand-primary text-brand-primary-fg flex items-center justify-center text-xs font-bold">
              SA
            </div>
            <span>Admin Console</span>
          </NavLink>
          <Badge variant="outline" size="sm" className="text-[10px] font-mono">
            Shell
          </Badge>
        </div>

        {/* Structural Context Notice */}
        <div className="px-6 py-3.5 border-b border-border-subtle/80 bg-surface-subtle/60">
          <div className="text-[11px] font-mono text-muted-foreground uppercase font-semibold">
            Administrative Scope
          </div>
          <div className="text-xs text-foreground font-medium truncate mt-0.5">
            Admin Portal Shell
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav
          className="flex-1 px-3 py-4 space-y-1 overflow-y-auto"
          aria-label="Super-Admin Navigation"
        >
          {ADMIN_NAV_DESTINATIONS.map((item) => (
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
        <div className="p-4 border-t border-border-subtle text-xs text-muted-foreground font-mono">
          <span>Security Boundary: Enforced Post-Auth</span>
        </div>
      </aside>

      {/* Mobile Header Bar */}
      <header
        role="banner"
        className="lg:hidden h-14 border-b border-border-subtle bg-surface-base px-4 flex items-center justify-between sticky top-0 z-20"
      >
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-brand-primary text-brand-primary-fg flex items-center justify-center text-xs font-bold">
            SA
          </div>
          <span className="font-bold text-sm text-foreground tracking-tight font-mono">
            ADMIN CONSOLE
          </span>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="admin-mobile-navigation"
          aria-label={isMobileMenuOpen ? 'Close admin navigation' : 'Open admin navigation'}
          className="inline-flex items-center justify-center p-2 rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px] min-w-[44px]"
        >
          {isMobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* Mobile Collapsible Navigation Menu */}
      {isMobileMenuOpen && (
        <div
          id="admin-mobile-navigation"
          className="lg:hidden border-b border-border bg-surface-base px-4 py-3 shadow-md z-20 sticky top-14"
          aria-label="Admin Mobile Navigation"
        >
          <nav className="space-y-1" aria-label="Admin Navigation Links">
            {ADMIN_NAV_DESTINATIONS.map((item) => (
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
        {/* Main Landmark */}
        <main
          id="admin-main-content"
          tabIndex={-1}
          className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto focus:outline-none"
        >
          {children ?? <Outlet />}
        </main>

        {/* Semantic Admin Footer */}
        <footer
          role="contentinfo"
          className="border-t border-border-subtle px-4 sm:px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row items-center justify-between gap-2 font-mono"
        >
          <span>QR_review Admin Console Shell</span>
          <span>Approved Route Family: /admin/*</span>
        </footer>
      </div>
    </div>
  );
}
