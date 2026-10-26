import * as React from 'react';
import { RoutePlaceholderCard } from '../shared/RoutePlaceholderCard.tsx';

/**
 * MerchantOverviewPage (/dashboard)
 */
export function MerchantOverviewPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-03"
      screenName="Merchant Dashboard Overview"
      routePath="/dashboard"
      surface="Merchant"
      description="Executive merchant summary: 30-day conversion metrics, QR scan velocity, recent patron activity stream, and quick-action digital QR links."
    />
  );
}

/**
 * MerchantProfilePage (/dashboard/profile)
 */
export function MerchantProfilePage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-04"
      screenName="Business Profile & Brand Settings"
      routePath="/dashboard/profile"
      surface="Merchant"
      description="Merchant brand configuration: business display name, contact phone, category selection, custom vanity slug, and 2 MB PNG/JPEG logo upload."
    />
  );
}

/**
 * GoogleDestinationPage (/dashboard/destination)
 */
export function GoogleDestinationPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-05"
      screenName="Google Review Destination Setup"
      routePath="/dashboard/destination"
      surface="Merchant"
      description="Google Maps review link gateway: strict URL format validation, Google Place ID extraction, test navigation verification in new tab, and anti-gating compliance guardrails."
    />
  );
}

/**
 * DigitalQrStudioPage (/dashboard/qr)
 */
export function DigitalQrStudioPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-06"
      screenName="Digital QR & Distribution Studio"
      routePath="/dashboard/qr"
      surface="Merchant"
      description="Digital QR code generator: real-time QR preview with embedded merchant logo, high-resolution PNG export (1024x1024), and copyable first-party link (/q/:public_qr_id)."
    />
  );
}

/**
 * FeedbackFeedPage (/dashboard/feedback)
 */
export function FeedbackFeedPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-08"
      screenName="Customer Feedback & Notes Stream"
      routePath="/dashboard/feedback"
      surface="Merchant"
      description="Private customer telemetry feed: aggregated MCQ responses, sentiment distribution, and customer notes with automated 30-day DPDPA purge indicators."
    />
  );
}

/**
 * AnalyticsPage (/dashboard/analytics)
 */
export function AnalyticsPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-09"
      screenName="Conversion Funnel & Analytics Trends"
      routePath="/dashboard/analytics"
      surface="Merchant"
      description="Funnel conversion telemetry: Total QR Scans → Surveys Completed → AI Drafts Generated → Google Redirect Clicks, with explicit non-attribution disclosures."
    />
  );
}

/**
 * SubscriptionPlanPage (/dashboard/subscription)
 */
export function SubscriptionPlanPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-10"
      screenName="Subscription Tier & Quota Meter"
      routePath="/dashboard/subscription"
      surface="Merchant"
      description="Merchant plan and consumption monitor: Pilot tier status, monthly generation quota meter (default 150/month), billing cycle reset date, and manual upgrade requests."
    />
  );
}

/**
 * AccountSettingsPage (/dashboard/settings)
 */
export function AccountSettingsPage(): React.JSX.Element {
  return (
    <RoutePlaceholderCard
      screenId="SCR-OWN-11"
      screenName="Account Security & Settings"
      routePath="/dashboard/settings"
      surface="Merchant"
      description="Merchant account management: credential updates, password changes, notification preference toggles, and session termination."
    />
  );
}
