/**
 * Digital QR Interactive Preview & Sharing Card (CMP-14 / SCR-OWN-06)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-06); §13 (CMP-14)
 *   - docs/ROADMAP.md (v1.1) Task M5-T06
 *   - docs/TEST_PLAN.md (v1.1) TC-OWN-11, TC-OWN-12, TC-PRT-05
 *
 * Responsibilities:
 * - Renders real-time interactive preview of the business's permanent first-party QR code.
 * - Enforces mandatory 4-module quiet zone and error correction level H.
 * - Renders central merchant logo or initials monogram badge.
 * - Provides 1-tap "Copy Review Link" button with accessible copied feedback and toast.
 * - Provides "Download QR (PNG)" generating high-resolution 1024x1024 PNG asset.
 * - Provides multi-channel digital sharing:
 *     * Native browser share (navigator.share) when available
 *     * WhatsApp direct share target
 *     * Email review link prompt
 * - Secondary "Open Customer Portal" button opening customer portal in a new tab.
 * - WCAG 2.2 AA contrast, >= 44px touch targets, and full 320px responsive reflow.
 */

import * as React from 'react';
import type { Business } from '../../types/domain';
import {
  buildFirstPartyReviewUrl,
  renderQrToCanvas,
  downloadQrPng,
  generateSafeFilename,
  getBusinessMonogram,
} from '../../lib/qrGenerator';
import { useToast } from '../ui/toast';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';

export interface DigitalQRPreviewCardProps {
  business: Business;
  className?: string;
  onLinkCopied?: () => void;
  onPngDownloaded?: () => void;
}

export function DigitalQRPreviewCard({
  business,
  className = '',
  onLinkCopied,
  onPngDownloaded,
}: DigitalQRPreviewCardProps): React.JSX.Element {
  const { toast } = useToast();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const [rendering, setRendering] = React.useState<boolean>(true);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState<boolean>(false);
  const [copied, setCopied] = React.useState<boolean>(false);
  const [renderKey, setRenderKey] = React.useState<number>(0);
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute canonical first-party review URL
  const reviewUrl = React.useMemo(() => {
    try {
      return buildFirstPartyReviewUrl(business.publicQrId);
    } catch {
      return `https://${typeof window !== 'undefined' ? window.location.host : 'app.qrs.local'}/q/${business.publicQrId}`;
    }
  }, [business.publicQrId]);

  const businessMonogram = React.useMemo(
    () => getBusinessMonogram(business.name),
    [business.name],
  );

  // Renders the QR code canvas whenever parameters or retry trigger updates
  React.useEffect(() => {
    let cancelled = false;

    const executeRender = async () => {
      if (!canvasRef.current) return;
      try {
        await renderQrToCanvas(canvasRef.current, reviewUrl, {
          size: 512, // Crisp preview resolution (scaled by CSS to container)
          quietZone: 4,
          errorCorrectionLevel: 'H',
          logoUrl: business.logoUrl,
          businessName: business.name,
          fallbackMonogram: businessMonogram,
        });
        if (!cancelled) {
          setRendering(false);
          setRenderError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to render digital QR preview canvas:', err);
          setRenderError(err instanceof Error ? err.message : 'Failed to generate QR preview');
          setRendering(false);
        }
      }
    };

    void executeRender();

    return () => {
      cancelled = true;
    };
  }, [reviewUrl, business.logoUrl, business.name, businessMonogram, renderKey]);

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // 1. Copy Review Link Handler
  // 1. Copy Review Link Handler with Resilient Fallback
  const handleCopyLink = async () => {
    let success = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(reviewUrl);
        success = true;
      }
    } catch (err) {
      console.warn('Primary clipboard write failed; attempting textarea fallback:', err);
    }

    if (!success) {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = reviewUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        success = true;
      } catch (fallbackErr) {
        console.warn('Fallback clipboard copy failed:', fallbackErr);
      }
    }

    if (success) {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2500);

      toast({
        title: 'Review Link Copied',
        description: 'First-party customer review URL copied to clipboard.',
        variant: 'success',
      });
      onLinkCopied?.();
    } else {
      toast({
        title: 'Copy Failed',
        description: 'Unable to access clipboard. Please copy the URL manually.',
        variant: 'destructive',
      });
    }
  };

  // 2. High-Resolution PNG Download Handler
  const handleDownloadPng = async () => {
    setDownloading(true);
    try {
      const filename = generateSafeFilename(business.name, business.publicQrId, 'png');
      await downloadQrPng(reviewUrl, filename, {
        size: 1024,
        quietZone: 4,
        errorCorrectionLevel: 'H',
        logoUrl: business.logoUrl,
        businessName: business.name,
        fallbackMonogram: businessMonogram,
      });

      toast({
        title: 'High-Res QR Downloaded',
        description: `Exported 1024×1024 PNG saved as ${filename}.`,
        variant: 'success',
      });
      onPngDownloaded?.();
    } catch (err) {
      console.error('Failed to export QR PNG:', err);
      toast({
        title: 'Download Failed',
        description: err instanceof Error ? err.message : 'Could not generate QR PNG asset.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  // 3. Multi-Channel Sharing Handlers
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({
        title: `Review ${business.name}`,
        text: `Share your honest feedback for ${business.name}:`,
        url: reviewUrl,
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.warn('Native share failed:', err);
      }
    }
  };

  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(
    `Leave a review for ${business.name}! Take a quick 30-second survey: ${reviewUrl}`,
  )}`;

  const emailShareUrl = `mailto:?subject=${encodeURIComponent(
    `Share feedback for ${business.name}`,
  )}&body=${encodeURIComponent(
    `Hi,\n\nWe would love your feedback! Please take 30 seconds to review your experience at ${business.name}:\n\n${reviewUrl}\n\nThank you!`,
  )}`;

  return (
    <Card className={`border-border bg-card shadow-sm ${className}`} data-testid="digital-qr-card">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl font-bold text-text-primary">
            Digital QR Code Studio
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[11px] font-medium border-border text-text-secondary">
              Permanent QR
            </Badge>
            <Badge variant="outline" className="text-[11px] font-semibold border-emerald-600/30 text-emerald-800 dark:text-emerald-300 bg-emerald-500/10">
              Error Correction: High
            </Badge>
          </div>
        </div>
        <CardDescription className="text-xs text-text-secondary">
          Display this permanent QR code at checkout, on receipts, or share digitally across messaging channels.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Main QR Display Section */}
        <div className="flex flex-col items-center justify-center p-6 bg-surface-alt/50 border border-border/60 rounded-xl space-y-4">
          <div className="relative flex items-center justify-center bg-white p-3.5 rounded-2xl shadow-md border border-slate-200/80 w-64 h-64 sm:w-72 sm:h-72 max-w-full aspect-square">
            {rendering && (
              <div
                className="absolute inset-0 flex items-center justify-center bg-white/90 rounded-2xl z-10"
                data-testid="qr-loading-shimmer"
              >
                <div className="space-y-3 w-48 text-center flex flex-col items-center">
                  <Skeleton className="w-40 h-40 rounded-xl" />
                  <Skeleton className="w-28 h-3" />
                </div>
              </div>
            )}

            {renderError && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 text-destructive space-y-2 bg-white rounded-2xl z-10"
                data-testid="qr-render-error"
              >
                <svg className="w-8 h-8 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-xs font-medium">Failed to generate QR</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRendering(true);
                    setRenderError(null);
                    setRenderKey((k) => k + 1);
                  }}
                  className="text-xs h-7 px-3"
                >
                  Retry
                </Button>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className={`w-full h-full object-contain rounded-lg ${renderError ? 'opacity-0 pointer-events-none' : ''}`}
              role="img"
              aria-label={`Digital QR Code for ${business.name}`}
              data-testid="digital-qr-canvas"
            />
          </div>

          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-text-primary" data-testid="qr-business-name">
              {business.name}
            </p>
            <p className="text-xs text-text-secondary font-mono tracking-wider">
              QR ID: <span className="font-semibold text-text-primary">{business.publicQrId}</span>
            </p>
          </div>
        </div>

        {/* First-Party Review URL Box & Copy Action */}
        <div className="space-y-2">
          <label
            htmlFor="first-party-review-url"
            className="text-xs font-semibold uppercase tracking-wider text-text-secondary"
          >
            First-Party Review Link
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                id="first-party-review-url"
                type="text"
                readOnly
                value={reviewUrl}
                data-testid="review-url-input"
                className="w-full h-11 px-3.5 bg-surface-alt/70 border border-border rounded-lg text-xs font-mono text-text-primary select-all focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <Button
              type="button"
              variant={copied ? 'outline' : 'default'}
              onClick={handleCopyLink}
              data-testid="copy-review-link-button"
              className={`h-11 px-4 min-w-[140px] font-medium text-xs transition-colors ${
                copied
                  ? 'border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'
                  : ''
              }`}
            >
              {copied ? (
                <span className="flex items-center gap-1.5" data-testid="copy-success-indicator">
                  <svg className="w-4 h-4 text-emerald-700 dark:text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Link Copied!
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Review Link
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Action CTAs: High-Res PNG Download & External Review Portal Inspection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <Button
            type="button"
            variant="default"
            onClick={handleDownloadPng}
            disabled={downloading || Boolean(renderError)}
            data-testid="download-png-button"
            className="h-12 w-full font-semibold text-sm flex items-center justify-center gap-2 shadow-sm"
          >
            {downloading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Generating 1024×1024 PNG...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download QR (PNG)
              </span>
            )}
          </Button>

          <a
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="test-review-link-button"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-border bg-surface-base text-foreground shadow-sm hover:bg-muted active:scale-[0.98] h-12 w-full text-sm"
          >
            <svg className="w-4 h-4 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open Customer Portal
          </a>
        </div>

        {/* Multi-Channel Digital Sharing Section */}
        <div className="pt-4 border-t border-border/80 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Multi-Channel Digital Sharing
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {canNativeShare && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleNativeShare}
                data-testid="native-share-button"
                className="h-10 text-xs font-medium border-border hover:bg-surface-alt flex items-center justify-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share via Device
              </Button>
            )}

            <a
              href={whatsappShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="whatsapp-share-button"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-border bg-surface-base hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:border-emerald-500/40 text-text-primary h-10 px-3 text-xs"
            >
              <svg className="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Share via WhatsApp
            </a>

            <a
              href={emailShareUrl}
              data-testid="email-share-button"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-border bg-surface-base text-foreground hover:bg-surface-alt h-10 px-3 text-xs"
            >
              <svg className="w-3.5 h-3.5 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              Share via Email
            </a>
          </div>
        </div>

        {/* Deferred Notice for Standees & Printable Vector PDFs */}
        <div className="p-3 bg-surface-alt/40 border border-border/50 rounded-lg text-xs text-text-secondary flex items-start gap-2.5">
          <svg className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div>
            <span className="font-semibold text-text-primary">Print & Physical Distribution:</span>{' '}
            High-resolution PNG is optimized for digital displays and independent printing. Physical acrylic standees and vector print-bleed PDFs (SCR-OWN-07) are scheduled for Post-MVP per Founder Decision M0-05.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
