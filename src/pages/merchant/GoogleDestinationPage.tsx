/**
 * Google Destination Page (/dashboard/destination — SCR-OWN-05)
 *
 * Source: docs/UI_UX.md (v1.1) §9.1; docs/ROADMAP.md (v1.1) §10.6 Task M5-T04
 *
 * Implements the authenticated merchant Google review destination management view.
 */

import * as React from 'react';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { GoogleDestinationForm } from '../../components/merchant/GoogleDestinationForm';
import { Skeleton } from '../../components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';

export function GoogleDestinationPage(): React.JSX.Element {
  const { business, loading, error, refreshBusiness } = useMerchantAuth();

  // 1. Loading Skeleton State
  if (loading && !business) {
    return (
      <div
        className="space-y-6 max-w-3xl mx-auto py-6 px-3 sm:px-4 min-w-0"
        data-testid="destination-loading-skeleton"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  // 2. Error / Missing Business State
  if (error || !business) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-3 sm:px-4 min-w-0">
        <Card className="border-destructive/30 bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              Unable to Load Business Context
            </CardTitle>
            <CardDescription className="text-xs text-text-secondary">
              {error || 'No merchant business profile found for this authenticated account.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-text-secondary">
              Please sign out and sign in again, or contact support if this issue persists.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto py-6 px-3 sm:px-4 min-w-0">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">
          Google Review Destination
        </h1>
        <p className="text-xs text-text-secondary">
          Configure, test, and save your official Google Maps review prompt link for{' '}
          <span className="font-semibold text-text-primary">{business.name}</span>.
        </p>
      </div>

      {/* Main Destination Form */}
      <GoogleDestinationForm
        key={business.id}
        business={business}
        onSuccess={refreshBusiness}
      />
    </div>
  );
}

