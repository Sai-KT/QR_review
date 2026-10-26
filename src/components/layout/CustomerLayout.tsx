import * as React from 'react';
import { Outlet } from 'react-router';
import { cn } from '../../lib/utils.ts';
import { Badge } from '../ui/badge.tsx';

export interface CustomerLayoutProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * CustomerLayout
 *
 * Public-facing mobile-first layout shell for digital QR review flows (/q/:qrId).
 * Enforces a strict 480px maximum container width on all viewports, ensuring that patrons
 * scanning from mobile, tablet, or desktop browsers receive an ergonomic mobile card
 * experience with zero stretched lines, clear focus indicators, and accessible landmarks.
 *
 * Note: Structural shell only; does not query merchant records or execute Google handoffs.
 */
export function CustomerLayout({ children, className }: CustomerLayoutProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-screen flex flex-col bg-surface-subtle text-foreground font-sans antialiased',
        className,
      )}
    >
      {/* Accessible Skip-to-Main-Content Link */}
      <a
        href="#customer-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-sm font-medium"
      >
        Skip to main content
      </a>

      {/* Minimal Header */}
      <header
        role="banner"
        className="w-full border-b border-border-subtle bg-surface-base/90 backdrop-blur-xs sticky top-0 z-10"
      >
        <div className="mx-auto max-w-[480px] w-full px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs select-none"
              aria-hidden="true"
            >
              QR
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">QR_review</span>
          </div>

          <Badge variant="outline" size="sm" className="text-[11px] font-medium">
            Customer Review Shell
          </Badge>
        </div>
      </header>

      {/* Main Content Region (Enforces 480px maximum width) */}
      <main
        id="customer-main-content"
        tabIndex={-1}
        className="flex-1 w-full mx-auto max-w-[480px] px-4 py-6 flex flex-col justify-center focus:outline-none"
      >
        {children ?? <Outlet />}
      </main>

      {/* Accessible Footer */}
      <footer
        role="contentinfo"
        className="w-full border-t border-border-subtle/60 py-4 px-4 text-center"
      >
        <div className="mx-auto max-w-[480px] w-full flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <span>QR_review • Customer Review Shell</span>
          <span className="text-footnote">Mobile Feedback Flow</span>
        </div>
      </footer>
    </div>
  );
}
