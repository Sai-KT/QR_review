import * as React from 'react';
import { Link } from 'react-router';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../../components/ui/card.tsx';
import { Badge } from '../../components/ui/badge.tsx';

export interface RoutePlaceholderCardProps {
  screenId: string;
  screenName: string;
  routePath: string;
  surface: 'Customer' | 'Merchant' | 'Super-Admin' | 'Auth';
  description: string;
  notes?: string;
}

/**
 * RoutePlaceholderCard
 *
 * Lightweight, accessible placeholder card for M1-T04 code-split portal route shells.
 * Clearly demarcates development status, canonical screen ID, and roadmap boundaries.
 */
export function RoutePlaceholderCard({
  screenId,
  screenName,
  routePath,
  surface,
  description,
  notes,
}: RoutePlaceholderCardProps): React.JSX.Element {
  React.useEffect(() => {
    document.title = `QR_review — ${screenId}: ${screenName}`;
  }, [screenId, screenName]);

  const surfaceBadgeVariant =
    surface === 'Customer'
      ? 'accent'
      : surface === 'Merchant'
        ? 'default'
        : surface === 'Super-Admin'
          ? 'destructive'
          : 'secondary';

  return (
    <div className="w-full max-w-2xl mx-auto py-4">
      <Card className="border-border shadow-sm">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {screenId}
              </Badge>
              <Badge variant={surfaceBadgeVariant} size="sm">
                {surface} Portal
              </Badge>
            </div>
            <Badge variant="warning" size="sm">
              M1-T04 Shell
            </Badge>
          </div>
          <CardTitle className="text-heading-2 text-foreground font-semibold">
            {screenName}
          </CardTitle>
          <CardDescription className="text-sm font-mono text-muted-foreground">
            Canonical Route: <span className="text-foreground">{routePath}</span>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p className="text-foreground">{description}</p>
          {notes && <p className="text-xs text-muted-foreground italic">{notes}</p>}
          <div className="rounded-md border border-border-subtle bg-surface-subtle p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Development Boundary Status:</p>
            <p>
              This route shell is a nonfunctional development placeholder created in M1-T04 Batch C.
              Business logic, database connections, and telemetry will be wired in subsequent
              milestones.
            </p>
          </div>
        </CardContent>

        <CardFooter className="border-t border-border-subtle/80 pt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">QR_review SaaS Platform</span>
          <Link
            to="/"
            className="text-brand-accent hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm p-1"
          >
            ← Return to Platform Gateway
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
