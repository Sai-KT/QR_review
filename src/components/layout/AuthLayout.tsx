import * as React from 'react';
import { NavLink, Outlet } from 'react-router';
import { cn } from '../../lib/utils.ts';
import { Badge } from '../ui/badge.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.tsx';

export interface AuthLayoutProps {
  children?: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
}

/**
 * AuthLayout
 *
 * Shared centered layout shell for authentication and access-recovery routes:
 * - /login
 * - /forgot-password
 * - /reset-password
 * - /admin/login
 * - /admin/mfa
 *
 * Enforces a centered card container (max 420px) optimized for mobile and desktop screens,
 * with skip-to-content accessibility links, semantic landmarks, and clear structural focus.
 */
export function AuthLayout({
  children,
  title = 'Portal Authentication',
  subtitle = 'Sign in to access your authorized workspace',
  className,
}: AuthLayoutProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col justify-between bg-surface-subtle text-foreground font-sans antialiased',
        className,
      )}
    >
      {/* Accessible Skip-to-Content Link */}
      <a
        href="#auth-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-sm font-medium"
      >
        Skip to authentication form
      </a>

      {/* Auth Shell Header */}
      <header
        role="banner"
        className="w-full border-b border-border-subtle bg-surface-base/80 backdrop-blur-xs"
      >
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <NavLink
            to="/"
            className="flex items-center gap-2 font-bold text-base tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md p-1"
          >
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              QR
            </div>
            <span>QR_review</span>
          </NavLink>

          <Badge variant="outline" size="sm" className="text-[11px] font-medium">
            Auth Shell
          </Badge>
        </div>
      </header>

      {/* Main Landmark: Centered Form Card */}
      <main
        id="auth-main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-[420px] mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center focus:outline-none"
      >
        <Card className="w-full shadow-md border-border">
          <CardHeader className="text-center space-y-2 pb-4">
            <div className="flex items-center justify-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-base font-bold select-none">
                QR
              </div>
            </div>
            <CardTitle className="text-heading-2">{title}</CardTitle>
            {subtitle && (
              <CardDescription className="text-xs sm:text-sm">{subtitle}</CardDescription>
            )}
          </CardHeader>

          <CardContent>{children ?? <Outlet />}</CardContent>
        </Card>
      </main>

      {/* Auth Shell Footer */}
      <footer
        role="contentinfo"
        className="w-full border-t border-border-subtle/60 py-4 px-4 text-center"
      >
        <div className="max-w-md mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 text-xs text-muted-foreground">
          <span>QR_review Authentication Gateway</span>
          <span>Access Shell</span>
        </div>
      </footer>
    </div>
  );
}
