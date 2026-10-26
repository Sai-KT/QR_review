import React from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../components/ui/card.tsx';
import { Badge } from '../components/ui/badge.tsx';

export function NotFoundPageShell(): React.JSX.Element {
  React.useEffect(() => {
    document.title = 'QR_review — 404 Page Not Found';
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle p-4 text-text-primary antialiased">
      <main id="main-content" className="w-full max-w-md">
        <Card className="border-border-subtle bg-surface-base shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2">
              <Badge variant="destructive">HTTP 404</Badge>
            </div>
            <CardTitle className="text-display-1">Page Not Found</CardTitle>
            <CardDescription className="text-body-normal">
              The requested URL does not match any active route in the QR_review application.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-body-small text-text-secondary">
            Please verify the link address or use the navigation options below to return to known
            routes.
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:flex-wrap sm:justify-center">
            <Link
              to="/"
              className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md bg-brand-primary px-3 text-xs font-medium text-brand-primary-fg shadow-xs transition hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Return Home
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-base px-3 text-xs font-medium text-text-primary shadow-xs transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Merchant Portal
            </Link>
            <Link
              to="/admin"
              className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-base px-3 text-xs font-medium text-text-primary shadow-xs transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Admin Console
            </Link>
            <Link
              to="/showcase"
              className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-base px-3 text-xs font-medium text-text-primary shadow-xs transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Component Showcase
            </Link>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}

export default NotFoundPageShell;
