/**
 * Digital QR & Sharing Page (/dashboard/qr — SCR-OWN-06)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-06)
 *   - docs/ROADMAP.md (v1.1) §10.6 Task M5-T06
 *   - docs/PRD.md (v1.1) FR-OWNER-004
 *
 * Implements the authenticated merchant Digital QR Studio view.
 * Displays interactive QR code preview with merchant branding, one-tap first-party
 * review link copy, high-resolution PNG export (1024×1024), and multi-channel sharing.
 */

import * as React from 'react';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { DigitalQRPreviewCard } from '../../components/merchant/DigitalQRPreviewCard';
import { Skeleton } from '../../components/ui/skeleton';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';

export function DigitalQRPage(): React.JSX.Element {
  const { business, loading, error } = useMerchantAuth();

  // 1. Loading Skeleton State
  if (loading && !business) {
    return (
      <div
        className="space-y-6 max-w-3xl mx-auto py-6 px-3 sm:px-4 min-w-0"
        data-testid="digital-qr-loading-skeleton"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-[480px] w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  // 2. Error / Missing Business State
  if (error || !business) {
    return (
      <div className="max-w-3xl mx-auto py-6 px-3 sm:px-4 min-w-0">
        <Card className="border-destructive/30 bg-destructive/10" data-testid="digital-qr-error-card">
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
          Digital QR & Sharing Studio
        </h1>
        <p className="text-xs text-text-secondary">
          Display, download, and distribute the permanent customer review QR code for{' '}
          <span className="font-semibold text-text-primary">{business.name}</span>.
        </p>
      </div>

      {/* Main Digital QR Studio Card (CMP-14) */}
      <DigitalQRPreviewCard key={business.id} business={business} />

      {/* Placement & Distribution Best Practices */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Best Practices for Local In-Store Review Collection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-xs text-text-secondary">
          <div className="flex items-start gap-2">
            <span className="font-bold text-text-primary shrink-0">1.</span>
            <span>
              <strong className="text-text-primary">Billing Counter Display:</strong> Place the downloaded high-resolution PNG on your POS checkout screen or a framed counter stand.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-bold text-text-primary shrink-0">2.</span>
            <span>
              <strong className="text-text-primary">WhatsApp Follow-Up:</strong> Send the copied review link via WhatsApp immediately after service delivery for salon visits or dining.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-bold text-text-primary shrink-0">3.</span>
            <span>
              <strong className="text-text-primary">Permanent Identity Guarantee:</strong> Your QR code encodes an immutable identifier ({business.publicQrId}) that never breaks, even if you update your business name, logo, or Google destination.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

