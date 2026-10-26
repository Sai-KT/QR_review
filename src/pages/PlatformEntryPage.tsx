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

export function PlatformEntryPage(): React.JSX.Element {
  React.useEffect(() => {
    document.title = 'QR_review — Platform Development Gateway';
  }, []);

  return (
    <div className="min-h-screen bg-surface-subtle text-text-primary antialiased">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-border-subtle bg-surface-base px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Milestone M1 — Toolchain & Foundations</Badge>
            <Badge variant="outline">React Router v7 Enabled</Badge>
          </div>
          <h1 className="mt-3 text-display-1 text-text-primary">QR_review Platform Gateway</h1>
          <p className="mt-2 text-body-large text-text-secondary">
            Multi-Tenant AI-Powered QR Review & Customer Feedback SaaS for Indian SMBs.
          </p>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {/* Active Development Showcase Card */}
          <Card className="border-brand-accent/30 bg-surface-base shadow-md">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Design System & Component Showcase</CardTitle>
                <Badge variant="accent">M1-T02 & M1-T03 Active Surface</Badge>
              </div>
              <CardDescription>
                Interactive validation surface featuring 15 WCAG 2.2 AA verified color roles, fluid
                typography, geometry tokens, and all nine approved UI component primitives.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-body-normal text-text-secondary">
                Explore Buttons, Inputs, Textareas, Cards, Badges, Native Selects, Radix Dialogs,
                Toast notifications, and Skeleton placeholders with live interactive states.
              </p>
            </CardContent>
            <CardFooter className="border-t border-border-subtle pt-4">
              <Link
                to="/showcase"
                className="inline-flex h-10 min-h-[44px] items-center justify-center gap-2 rounded-md bg-brand-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-[44px]"
              >
                Open Design-System Showcase (/showcase)
              </Link>
            </CardFooter>
          </Card>

          {/* Implemented Portal Shells Directory */}
          <Card className="border-border-subtle bg-surface-base shadow-sm">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Implemented Application Portals</CardTitle>
                <Badge variant="success">M1-T04 Code-Split Shells Active</Badge>
              </div>
              <CardDescription>
                Declarative route hierarchy configured with lazy-loaded domain shells and responsive
                portal layouts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Portal Links Grid */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Customer Portal Card */}
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary text-sm">
                      Public Customer Experience
                    </span>
                    <Badge variant="accent" size="sm">
                      Mobile-First
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    30-second mobile review flow, 3-MCQ categories, AI draft preview, and direct
                    Google Maps handoff.
                  </p>
                  <div className="pt-2">
                    <Link
                      to="/q/demo-cafe-1"
                      className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md bg-brand-primary px-3 text-xs font-medium text-brand-primary-fg shadow-xs transition hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open Customer Flow (/q/demo-cafe-1) →
                    </Link>
                  </div>
                </div>

                {/* Merchant Portal Card */}
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary text-sm">
                      Merchant Owner Portal
                    </span>
                    <Badge variant="default" size="sm">
                      Authenticated
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Owner overview, Google review destination settings, digital QR distribution, and
                    telemetry.
                  </p>
                  <div className="pt-2 flex flex-wrap gap-2">
                    <Link
                      to="/dashboard"
                      className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md bg-brand-primary px-3 text-xs font-medium text-brand-primary-fg shadow-xs transition hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Merchant Console (/dashboard) →
                    </Link>
                  </div>
                </div>

                {/* Super-Admin Console Card */}
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary text-sm">
                      Super-Admin Master Console
                    </span>
                    <Badge variant="destructive" size="sm">
                      MFA (aal2)
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Platform health, tenant provisioning, monthly quota allocation, and immutable
                    audit trail.
                  </p>
                  <div className="pt-2">
                    <Link
                      to="/admin"
                      className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md bg-brand-primary px-3 text-xs font-medium text-brand-primary-fg shadow-xs transition hover:bg-brand-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Admin Console (/admin) →
                    </Link>
                  </div>
                </div>

                {/* Authentication Portals Card */}
                <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary text-sm">
                      Authentication Shells
                    </span>
                    <Badge variant="outline" size="sm">
                      Auth
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Merchant login & password reset request, alongside super-admin credentials &
                    TOTP MFA challenge.
                  </p>
                  <div className="pt-2 flex flex-wrap gap-2">
                    <Link
                      to="/login"
                      className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-base px-3 text-xs font-medium text-text-primary shadow-xs transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Merchant Sign In (/login)
                    </Link>
                    <Link
                      to="/admin/login"
                      className="inline-flex h-9 min-h-[44px] items-center justify-center rounded-md border border-border bg-surface-base px-3 text-xs font-medium text-text-primary shadow-xs transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Admin Sign In (/admin/login)
                    </Link>
                  </div>
                </div>
              </div>

              {/* Development Status Disclosure */}
              <div className="rounded-md border border-border-subtle/80 bg-surface-muted/40 p-3 text-xs text-text-secondary space-y-1">
                <p className="font-medium text-text-primary">Development Boundary Notice:</p>
                <p>
                  All portal shells are nonfunctional development representations. Live Supabase
                  Auth, database queries, and external APIs will be introduced in subsequent
                  authorized milestones.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-subtle bg-surface-base px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-2 sm:flex-row">
          <p className="text-footnote text-text-secondary">
            QR_review Platform • Milestone M1-T04 Batch A Foundation
          </p>
          <p className="text-footnote text-text-secondary">
            Built with React 19, Strict TypeScript, Tailwind CSS v4, and React Router v7
          </p>
        </div>
      </footer>
    </div>
  );
}

export default PlatformEntryPage;
