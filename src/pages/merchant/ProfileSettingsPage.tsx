/**
 * Merchant Profile & Brand Settings Page (SCR-OWN-04)
 *
 * Source: docs/ROADMAP.md (M5-T03); docs/UI_UX.md §9.1; docs/API_SPEC.md §11.2; docs/DATABASE_SCHEMA.md §5.2
 *
 * Primary Purpose:
 * Allows authenticated merchants to edit safe profile fields:
 * - Business Display Name (`name`, 1-100 characters)
 * - Custom Vanity URL Slug (`vanity_slug`, regex `^[a-z0-9]+(-[a-z0-9]+)*$`, 2-63 chars)
 * - Optional WhatsApp Contact Number (`whatsapp_number`, Indian 10-digit mobile `^[6-9]\d{9}$`)
 *
 * Security & Multi-Tenant Invariants:
 * - Directly calls `updateMerchantBusiness` using PostgREST `API-OWN-02`.
 * - Protected by PostgreSQL RLS (`businesses_update_owner: owner_id = auth.uid()`).
 * - Column-level grants strictly permit: `name`, `vanity_slug`, `whatsapp_number`.
 * - Hardware QR token (`public_qr_id`), owner identity (`owner_id`), category (`category_id`),
 *   account status (`account_status`), and kill-switch (`is_active`) are immutable/read-only
 *   and protected by trigger `enforce_business_field_protection`.
 * - Unique vanity slug collision (`23505`) is surfaced as a clear inline error.
 * - Calling `refreshBusiness()` immediately synchronizes tenant state in the portal navigation shell.
 */

import * as React from 'react';
import { useMerchantAuth } from '../../hooks/useMerchantAuth';
import { updateMerchantBusiness } from '../../lib/api/merchant';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { GoogleDestinationModal } from '../../components/merchant/GoogleDestinationModal';
import { LogoUploader } from '../../components/merchant/LogoUploader';
import type { Business } from '../../types/domain';

interface ValidationErrors {
  name?: string;
  vanitySlug?: string;
  whatsappNumber?: string;
}

interface ProfileSettingsFormProps {
  business: Business;
  refreshBusiness: () => Promise<void>;
}

function ProfileSettingsForm({
  business,
  refreshBusiness,
}: ProfileSettingsFormProps): React.JSX.Element {
  const [name, setName] = React.useState<string>(business.name ?? '');
  const [vanitySlug, setVanitySlug] = React.useState<string>(business.vanitySlug ?? '');
  const [whatsappNumber, setWhatsappNumber] = React.useState<string>(
    business.whatsappNumber ?? '',
  );

  const [validationErrors, setValidationErrors] = React.useState<ValidationErrors>({});
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = React.useState<string | null>(null);
  const [externalUpdateNotice, setExternalUpdateNotice] = React.useState<boolean>(false);
  const [isDestinationModalOpen, setIsDestinationModalOpen] = React.useState<boolean>(false);

  // Compute dirty state
  const isDirty = React.useMemo(() => {
    const currentName = name.trim();
    const currentSlug = vanitySlug.trim().toLowerCase();
    const currentWhatsapp = whatsappNumber.trim() || null;

    const savedName = business.name.trim();
    const savedSlug = business.vanitySlug.trim().toLowerCase();
    const savedWhatsapp = business.whatsappNumber ? business.whatsappNumber.trim() : null;

    return (
      currentName !== savedName ||
      currentSlug !== savedSlug ||
      currentWhatsapp !== savedWhatsapp
    );
  }, [business, name, vanitySlug, whatsappNumber]);

  // Synchronize state during render when business identity or timestamp changes
  const [prevBusiness, setPrevBusiness] = React.useState<Business>(business);
  if (business !== prevBusiness) {
    setPrevBusiness(business);
    if (!isDirty) {
      setName(business.name ?? '');
      setVanitySlug(business.vanitySlug ?? '');
      setWhatsappNumber(business.whatsappNumber ?? '');
      setValidationErrors({});
      setSubmitError(null);
      setExternalUpdateNotice(false);
    } else if (!submitting) {
      setExternalUpdateNotice(true);
    }
  }

  // Client-side field validations
  const validate = (): boolean => {
    const errors: ValidationErrors = {};
    const trimmedName = name.trim();
    const trimmedSlug = vanitySlug.trim().toLowerCase();
    const trimmedWhatsapp = whatsappNumber.trim();

    // 1. Business Name (1-100 chars, not empty)
    if (!trimmedName) {
      errors.name = 'Business name is required (1-100 characters).';
    } else if (trimmedName.length > 100) {
      errors.name = 'Business name must not exceed 100 characters.';
    }

    // 2. Vanity Slug (2-63 chars, regex ^[a-z0-9]+(-[a-z0-9]+)*$)
    if (!trimmedSlug) {
      errors.vanitySlug = 'Vanity URL slug is required.';
    } else if (trimmedSlug.length < 2 || trimmedSlug.length > 63) {
      errors.vanitySlug = 'Vanity slug must be between 2 and 63 characters.';
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmedSlug)) {
      errors.vanitySlug =
        'Vanity slug may only contain lowercase letters, numbers, and single hyphens (no consecutive or trailing hyphens).';
    }

    // 3. Optional WhatsApp Number (Indian 10-digit mobile ^[6-9]\d{9}$)
    if (trimmedWhatsapp) {
      if (!/^[6-9]\d{9}$/.test(trimmedWhatsapp)) {
        errors.whatsappNumber =
          'Enter a valid 10-digit Indian mobile number (e.g. 9876543210) starting with 6, 7, 8, or 9.';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    if (!validate()) {
      return;
    }

    setSubmitting(true);

    try {
      const trimmedName = name.trim();
      const trimmedSlug = vanitySlug.trim().toLowerCase();
      const trimmedWhatsapp = whatsappNumber.trim() || null;

      const result = await updateMerchantBusiness(business.id, {
        name: trimmedName,
        vanitySlug: trimmedSlug,
        whatsappNumber: trimmedWhatsapp,
      });

      if (result.error) {
        setSubmitError(result.error.message);
      } else {
        setSubmitSuccess('Business profile updated successfully.');
        setExternalUpdateNotice(false);
        await refreshBusiness();
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'An unexpected error occurred while saving profile.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = (): void => {
    setName(business.name ?? '');
    setVanitySlug(business.vanitySlug ?? '');
    setWhatsappNumber(business.whatsappNumber ?? '');
    setValidationErrors({});
    setSubmitError(null);
    setSubmitSuccess(null);
    setExternalUpdateNotice(false);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.qrreview.in';
  const previewSlug = vanitySlug.trim().toLowerCase() || 'your-slug';

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-6 px-3 sm:px-4 min-w-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border-subtle pb-5 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Business Profile & Brand Settings
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure your customer-facing business name, public vanity slug, and WhatsApp contact link.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Badge variant="accent" shape="pill" className="capitalize">
            {business.categoryId} vertical
          </Badge>
          <Badge
            variant={
              business.accountStatus === 'active' || business.accountStatus === 'pilot'
                ? 'success'
                : 'destructive'
            }
            shape="pill"
            className="capitalize"
          >
            {business.accountStatus}
          </Badge>
        </div>
      </div>

      {/* Status Feedback Banners */}
      {submitSuccess && (
        <div
          role="alert"
          data-testid="profile-success-alert"
          className="rounded-lg border border-state-success/30 bg-state-success-bg p-4 flex items-start gap-3 min-w-0"
        >
          <svg
            className="h-5 w-5 text-state-success shrink-0 mt-0.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-sm font-medium text-state-success break-words min-w-0">
            {submitSuccess}
          </div>
        </div>
      )}

      {submitError && (
        <div
          role="alert"
          data-testid="profile-error-alert"
          className="rounded-lg border border-state-danger/30 bg-state-danger-bg p-4 flex items-start gap-3 min-w-0"
        >
          <svg
            className="h-5 w-5 text-state-danger shrink-0 mt-0.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-sm font-medium text-state-danger break-words min-w-0">
            {submitError}
          </div>
        </div>
      )}

      {externalUpdateNotice && (
        <div
          role="status"
          data-testid="profile-external-update-notice"
          className="rounded-lg border border-state-warning/30 bg-state-warning-bg p-4 flex items-start gap-3 min-w-0"
        >
          <svg
            className="h-5 w-5 text-state-warning shrink-0 mt-0.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-sm font-medium text-state-warning break-words min-w-0">
            The business record was refreshed from the server. Your unsaved changes have been preserved. Click Save Changes to keep your edits or Discard Changes to view server values.
          </div>
        </div>
      )}

      {/* Editable Business Profile Form (API-OWN-02) */}
      <form onSubmit={handleSubmit} data-testid="profile-form" noValidate className="min-w-0">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-text-primary">
              Public Business Details
            </CardTitle>
            <CardDescription className="text-text-secondary">
              These details are publicly visible to customers scanning your QR code or visiting your vanity link.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 min-w-0">
            {/* Field 1: Business Display Name */}
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="business-name"
                  className="text-sm font-medium text-text-primary"
                >
                  Business Display Name <span className="text-state-danger" aria-hidden="true">*</span>
                </label>
                <span
                  className="text-xs text-text-secondary"
                  aria-live="polite"
                  data-testid="business-name-counter"
                >
                  {name.length}/100
                </span>
              </div>
              <Input
                id="business-name"
                name="name"
                data-testid="business-name-input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (validationErrors.name) {
                    setValidationErrors((prev) => ({ ...prev, name: undefined }));
                  }
                }}
                disabled={submitting}
                maxLength={100}
                required
                isInvalid={Boolean(validationErrors.name)}
                aria-invalid={Boolean(validationErrors.name)}
                aria-describedby={
                  validationErrors.name ? 'business-name-error' : 'business-name-hint'
                }
                placeholder="e.g. Luxe Studio Unisex Salon"
                className="w-full"
              />
              {validationErrors.name ? (
                <p
                  id="business-name-error"
                  role="alert"
                  className="text-xs font-medium text-state-danger"
                >
                  {validationErrors.name}
                </p>
              ) : (
                <p id="business-name-hint" className="text-xs text-text-secondary">
                  The primary store name rendered on customer review drafts and surveys.
                </p>
              )}
            </div>

            {/* Field 2: Vanity URL Slug */}
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="vanity-slug"
                className="text-sm font-medium text-text-primary"
              >
                Custom Vanity Slug <span className="text-state-danger" aria-hidden="true">*</span>
              </label>
              <Input
                id="vanity-slug"
                name="vanitySlug"
                data-testid="vanity-slug-input"
                type="text"
                value={vanitySlug}
                onChange={(e) => {
                  setVanitySlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  if (validationErrors.vanitySlug) {
                    setValidationErrors((prev) => ({ ...prev, vanitySlug: undefined }));
                  }
                }}
                disabled={submitting}
                maxLength={63}
                required
                isInvalid={Boolean(validationErrors.vanitySlug)}
                aria-invalid={Boolean(validationErrors.vanitySlug)}
                aria-describedby={
                  validationErrors.vanitySlug ? 'vanity-slug-error' : 'vanity-slug-hint'
                }
                placeholder="e.g. luxe-studio"
                className="w-full font-mono text-sm"
              />

              {/* Live Link Preview */}
              <div
                className="rounded-md bg-surface-muted px-3 py-2 text-xs font-mono text-text-secondary flex flex-wrap items-center gap-1.5 overflow-hidden min-w-0"
                data-testid="vanity-slug-preview"
              >
                <span className="text-text-muted shrink-0">Short Link:</span>
                <span className="text-brand-accent underline break-all select-all min-w-0">
                  {origin}/r/{previewSlug}
                </span>
              </div>

              {validationErrors.vanitySlug ? (
                <p
                  id="vanity-slug-error"
                  role="alert"
                  className="text-xs font-medium text-state-danger"
                >
                  {validationErrors.vanitySlug}
                </p>
              ) : (
                <p id="vanity-slug-hint" className="text-xs text-text-secondary">
                  2–63 characters. Lowercase letters, numbers, and single hyphens only.
                </p>
              )}
            </div>

            {/* Field 3: WhatsApp Contact Phone */}
            <div className="space-y-1.5 min-w-0">
              <label
                htmlFor="whatsapp-number"
                className="text-sm font-medium text-text-primary"
              >
                WhatsApp Contact Number <span className="text-xs text-text-secondary font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Input
                  id="whatsapp-number"
                  name="whatsappNumber"
                  data-testid="whatsapp-input"
                  type="tel"
                  value={whatsappNumber}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
                    setWhatsappNumber(clean);
                    if (validationErrors.whatsappNumber) {
                      setValidationErrors((prev) => ({ ...prev, whatsappNumber: undefined }));
                    }
                  }}
                  disabled={submitting}
                  maxLength={10}
                  isInvalid={Boolean(validationErrors.whatsappNumber)}
                  aria-invalid={Boolean(validationErrors.whatsappNumber)}
                  aria-describedby={
                    validationErrors.whatsappNumber ? 'whatsapp-number-error' : 'whatsapp-number-hint'
                  }
                  placeholder="e.g. 9876543210"
                  className="w-full"
                />
              </div>
              {validationErrors.whatsappNumber ? (
                <p
                  id="whatsapp-number-error"
                  role="alert"
                  className="text-xs font-medium text-state-danger"
                >
                  {validationErrors.whatsappNumber}
                </p>
              ) : (
                <p id="whatsapp-number-hint" className="text-xs text-text-secondary">
                  Indian 10-digit mobile number starting with 6, 7, 8, or 9. Enables one-click WhatsApp chat link for customers needing assistance.
                </p>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-6 border-t border-border-subtle">
            <Button
              type="button"
              variant="outline"
              data-testid="profile-reset-btn"
              onClick={handleReset}
              disabled={!isDirty || submitting}
              className="w-full sm:w-auto min-h-[44px]"
            >
              Discard Changes
            </Button>
            <Button
              type="submit"
              variant="default"
              data-testid="profile-save-btn"
              disabled={!isDirty || submitting}
              className="w-full sm:w-auto min-h-[44px]"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  Saving Changes...
                </span>
              ) : (
                'Save Changes'
              )}
            </Button>
          </CardFooter>
        </Card>
      </form>

      {/* Immutable / Platform-Managed Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
        {/* Hardware QR Token Card */}
        <Card className="bg-surface-subtle border-border-subtle min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-text-primary">
                Permanent Hardware QR Token
              </CardTitle>
              <Badge variant="outline" shape="pill" className="text-[11px] shrink-0">
                Hardware Locked
              </Badge>
            </div>
            <CardDescription className="text-xs text-text-secondary">
              Immutable physical QR identifier encoded on your counter standee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 min-w-0">
            <div
              className="rounded bg-surface-base border border-border-subtle p-2.5 font-mono text-sm font-semibold text-text-primary flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 overflow-hidden min-w-0"
              data-testid="public-qr-id-display"
            >
              <span className="shrink-0">{business.publicQrId}</span>
              <span className="text-xs font-normal text-text-secondary truncate min-w-0">
                {origin}/q/{business.publicQrId}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              Decoupled from store name and Google destinations. Never breaks when you update your profile or review destination.
            </p>
          </CardContent>
        </Card>

        {/* Business Category Card */}
        <Card className="bg-surface-subtle border-border-subtle min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-text-primary">
                Business Vertical Category
              </CardTitle>
              <Badge variant="outline" shape="pill" className="text-[11px] shrink-0">
                Admin Managed
              </Badge>
            </div>
            <CardDescription className="text-xs text-text-secondary">
              Determines the 3 customer survey questions and AI grounding taxonomy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 min-w-0">
            <div className="rounded bg-surface-base border border-border-subtle p-2.5 text-sm font-semibold text-text-primary capitalize truncate">
              {business.categoryId === 'salon' ? 'Salon & Personal Care' : 'Cafe & Quick Service'}
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              Assigned during tenant onboarding. Question choices and prompt anchors are tailored strictly to this vertical.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Related Gateways Status Notices (M5-T04 and M5-T05 boundaries) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">
        {/* Brand Logo & Standee Artwork Card (Task M5-T05 / SCR-OWN-04) */}
        <Card className="border-border-subtle min-w-0 overflow-hidden" data-testid="profile-logo-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold text-text-primary">
                Brand Logo & Counter Artwork
              </CardTitle>
              {business.logoUrl ? (
                <Badge variant="success" shape="pill" className="text-[11px] shrink-0">
                  Custom Logo Active
                </Badge>
              ) : (
                <Badge variant="secondary" shape="pill" className="text-[11px] shrink-0">
                  Default Avatar
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-text-secondary">
              Upload your official brand logo for customer surveys, Google review prompts, and digital QR codes (PNG, JPEG, WebP &le; 2 MB).
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <LogoUploader
              businessId={business.id}
              businessName={business.name}
              currentLogoUrl={business.logoUrl}
              onLogoUpdated={async () => {
                await refreshBusiness();
              }}
            />
          </CardContent>
        </Card>

        {/* Google Review Destination Configuration Card */}
        <Card className="border-border-subtle min-w-0 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold text-text-primary">
                Google Review Destination
              </CardTitle>
              {business.googleReviewUrl ? (
                <Badge variant="success" shape="pill" className="text-[11px] shrink-0">
                  Active & Routing
                </Badge>
              ) : (
                <Badge variant="warning" shape="pill" className="text-[11px] shrink-0">
                  Setup Required
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs text-text-secondary">
              Strictly verified server-side URL link to your Google Maps review prompt.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 min-w-0">
            {business.googleReviewUrl ? (
              <div className="space-y-1 min-w-0">
                <p
                  className="text-xs text-text-primary font-mono truncate min-w-0"
                  data-testid="profile-destination-url-preview"
                >
                  {business.googleReviewUrl}
                </p>
                {business.googlePlaceId && (
                  <p className="text-[11px] text-text-secondary font-mono truncate min-w-0">
                    Place ID: {business.googlePlaceId}
                  </p>
                )}
              </div>
            ) : (
              <p
                className="text-xs text-text-secondary italic"
                data-testid="profile-destination-unconfigured-text"
              >
                No Google review destination configured.
              </p>
            )}
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsDestinationModalOpen(true)}
                data-testid="configure-destination-btn"
                className="min-h-[44px] text-xs font-medium"
              >
                {business.googleReviewUrl ? 'Update Destination Link' : 'Configure Google Destination'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Google Destination Modal */}
        <GoogleDestinationModal
          business={business}
          open={isDestinationModalOpen}
          onOpenChange={setIsDestinationModalOpen}
          onSuccess={refreshBusiness}
        />
      </div>
    </div>
  );
}

export function ProfileSettingsPage(): React.JSX.Element {
  const { business, loading, error: authError, refreshBusiness } = useMerchantAuth();

  // 1. Loading State
  if (loading && !business) {
    return (
      <div
        className="space-y-6 max-w-4xl mx-auto py-6 px-3 sm:px-4 min-w-0"
        data-testid="profile-loading-skeleton"
      >
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-72" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // 2. Error / Missing Business State
  if (!business) {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4" data-testid="profile-error-state">
        <Card className="border-state-danger/30 bg-state-danger-bg/10">
          <CardHeader>
            <CardTitle className="text-state-danger text-lg font-semibold">
              Business Profile Unavailable
            </CardTitle>
            <CardDescription className="text-text-secondary">
              {authError ||
                'Could not load your merchant business profile. Please refresh or try again later.'}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              onClick={() => refreshBusiness()}
              className="min-h-[44px]"
            >
              Retry Loading Profile
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <ProfileSettingsForm
      key={business.id}
      business={business}
      refreshBusiness={refreshBusiness}
    />
  );
}
