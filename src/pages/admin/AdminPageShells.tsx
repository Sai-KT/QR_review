import * as React from 'react';
import { useParams } from 'react-router';
import { RoutePlaceholderCard } from '../shared/RoutePlaceholderCard.tsx';

/**
 * AdminOverviewPage (/admin)
 */
export function AdminOverviewPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-02"
      screenName="Super-Admin Master Overview"
      routePath="/admin"
      surface="Super-Admin"
      description="Central platform health overview: active pilot tenants, 24-hour Gemini API call volume, system error rates, and security alert banners."
    />
  );
}

/**
 * MerchantDirectoryPage (/admin/businesses)
 */
export function MerchantDirectoryPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-03"
      screenName="Merchant Directory & Tenant Management"
      routePath="/admin/businesses"
      surface="Super-Admin"
      description="Multi-tenant directory: searchable business table, account status filters (Active, Suspended, Past Due), category breakdowns, and direct tenant inspection links."
    />
  );
}

/**
 * MerchantOnboardingPage (/admin/businesses/new)
 */
export function MerchantOnboardingPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-04"
      screenName="Merchant Onboarding & Provisioning Modal"
      routePath="/admin/businesses/new"
      surface="Super-Admin"
      description="Administrative provisioning workflow: business category selection, immutable public_qr_id generation, initial pilot quota assignment, and welcome credential distribution."
    />
  );
}

/**
 * MerchantInspectorPage (/admin/businesses/:id)
 */
export function MerchantInspectorPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();

  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-05"
      screenName="Tenant Profile Inspector & Emergency Controls"
      routePath={`/admin/businesses/${id ?? ':id'}`}
      surface="Super-Admin"
      description="Deep tenant inspector: business metadata, quota override controls, immutable audit provenance, and emergency tenant suspension switch."
      notes={`Inspected tenant UUID parameter: "${id ?? 'unspecified'}"`}
    />
  );
}

/**
 * QuotaConsumptionPage (/admin/quotas)
 */
export function QuotaConsumptionPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-06"
      screenName="Global Quota & Gemini Cost Monitor"
      routePath="/admin/quotas"
      surface="Super-Admin"
      description="Platform-wide Gemini Flash consumption monitor: token burn rates, per-tenant reservation telemetry, monthly spending thresholds, and emergency quota clamps."
    />
  );
}

/**
 * AuditLogsStreamPage (/admin/audit-logs)
 */
export function AuditLogsStreamPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-ADM-07"
      screenName="Immutable Security Audit Log Stream"
      routePath="/admin/audit-logs"
      surface="Super-Admin"
      description="Cryptographically attributed administrative action stream: actor UUID, actor role, target business UUID, client IP hash, timestamp, and immutable operation payloads."
    />
  );
}
