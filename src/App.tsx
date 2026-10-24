import React from 'react';
import './App.css';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_SCALE,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  TOUCH_TARGETS,
} from './lib/tokens.ts';

interface DisplayToken {
  name: string;
  hex: string;
  role: string;
  usage: string;
  contrastBadge: string;
}

interface ColorCategory {
  title: string;
  description: string;
  tokens: DisplayToken[];
}

const COLOR_CATEGORIES: ColorCategory[] = [
  {
    title: 'Brand Tokens',
    description: 'Core identity, primary actions, and interactive brand accents.',
    tokens: [
      {
        ...COLOR_TOKENS.brandPrimary,
        contrastBadge: '≥ 4.5:1 on White (17.72:1)',
      },
      {
        ...COLOR_TOKENS.brandPrimaryFg,
        contrastBadge: '≥ 4.5:1 on Brand Primary (17.72:1)',
      },
      {
        ...COLOR_TOKENS.brandSecondary,
        contrastBadge: 'Surface / Button Fill',
      },
      {
        ...COLOR_TOKENS.brandAccent,
        contrastBadge: '≥ 4.5:1 on White (5.17:1)',
      },
    ],
  },
  {
    title: 'Surface Roles',
    description: 'Canvas backgrounds, card containers, and inactive fill surfaces.',
    tokens: [
      {
        ...COLOR_TOKENS.surfaceBase,
        contrastBadge: 'Core White Canvas',
      },
      {
        ...COLOR_TOKENS.surfaceSubtle,
        contrastBadge: 'Page Background Fill',
      },
      {
        ...COLOR_TOKENS.surfaceMuted,
        contrastBadge: 'Inactive Card Fill',
      },
    ],
  },
  {
    title: 'Border Roles',
    description: 'Structural dividers and active focus boundaries.',
    tokens: [
      {
        ...COLOR_TOKENS.borderSubtle,
        contrastBadge: '1px Structural Divider',
      },
      {
        ...COLOR_TOKENS.borderStrong,
        contrastBadge: '≥ 3.0:1 Non-text Boundary (AA)',
      },
    ],
  },
  {
    title: 'Typography & Icon Roles',
    description: 'High-contrast text hierarchy and decorative iconography.',
    tokens: [
      {
        ...COLOR_TOKENS.textPrimary,
        contrastBadge: '≥ 4.5:1 on White (17.85:1)',
      },
      {
        ...COLOR_TOKENS.textSecondary,
        contrastBadge: '≥ 4.5:1 on White (7.58:1)',
      },
      {
        ...COLOR_TOKENS.textMuted,
        contrastBadge: '≥ 4.5:1 on White (7.58:1)',
      },
      {
        ...COLOR_TOKENS.uiMutedIcon,
        contrastBadge: '≥ 3.0:1 Decorative / Non-text Only',
      },
    ],
  },
  {
    title: 'Semantic State Roles',
    description: 'Contextual feedback for success, warning, and danger states.',
    tokens: [
      {
        ...COLOR_TOKENS.stateSuccess,
        contrastBadge: '≥ 4.5:1 on White & Bg (4.57:1)',
      },
      {
        ...COLOR_TOKENS.stateSuccessBg,
        contrastBadge: 'Success Banner Fill',
      },
      {
        ...COLOR_TOKENS.stateWarning,
        contrastBadge: '≥ 4.5:1 on White & Bg (4.51:1)',
      },
      {
        ...COLOR_TOKENS.stateWarningBg,
        contrastBadge: 'Warning Banner Fill',
      },
      {
        ...COLOR_TOKENS.stateDanger,
        contrastBadge: '≥ 4.5:1 on White (4.83:1)',
      },
      {
        ...COLOR_TOKENS.stateDangerBg,
        contrastBadge: 'Surface Fill (3.95:1 Large / Icon)',
      },
    ],
  },
];

const TYPOGRAPHY_ENTRIES = [
  {
    key: 'display1',
    className: 'text-display-1',
    spec: TYPOGRAPHY_SCALE.display1,
    sample: 'Display 1 — Fast Google Reviews for Local Business',
  },
  {
    key: 'heading1',
    className: 'text-heading-1',
    spec: TYPOGRAPHY_SCALE.heading1,
    sample: 'Heading 1 — Merchant Feedback Analytics Dashboard',
  },
  {
    key: 'heading2',
    className: 'text-heading-2',
    spec: TYPOGRAPHY_SCALE.heading2,
    sample: 'Heading 2 — How was your dining experience today?',
  },
  {
    key: 'heading3',
    className: 'text-heading-3',
    spec: TYPOGRAPHY_SCALE.heading3,
    sample: 'Heading 3 — Positive Feedback Conversion Rate',
  },
  {
    key: 'bodyLarge',
    className: 'text-body-large',
    spec: TYPOGRAPHY_SCALE.bodyLarge,
    sample:
      'Body Large — Thank you for visiting us. Select options below to generate a tailored review.',
  },
  {
    key: 'bodyNormal',
    className: 'text-body-normal',
    spec: TYPOGRAPHY_SCALE.bodyNormal,
    sample:
      'Body Normal — Standard interface copy, table records, and form labels rendered with accessible contrast.',
  },
  {
    key: 'bodySmall',
    className: 'text-body-small',
    spec: TYPOGRAPHY_SCALE.bodySmall,
    sample: 'Body Small — 128 characters remaining • Updated 2 minutes ago',
  },
  {
    key: 'footnote',
    className: 'text-footnote',
    spec: TYPOGRAPHY_SCALE.footnote,
    sample:
      'Footnote — By submitting, you agree to our Terms of Service and Privacy Policy. All rights reserved.',
  },
];

const RADIUS_ENTRIES = [
  { key: 'sm', token: RADIUS_TOKENS.sm, className: 'rounded-sm' },
  { key: 'md', token: RADIUS_TOKENS.md, className: 'rounded-md' },
  { key: 'lg', token: RADIUS_TOKENS.lg, className: 'rounded-lg' },
  { key: 'xl', token: RADIUS_TOKENS.xl, className: 'rounded-xl' },
  { key: '2xl', token: RADIUS_TOKENS['2xl'], className: 'rounded-2xl' },
  { key: 'full', token: RADIUS_TOKENS.full, className: 'rounded-full' },
];

const SHADOW_ENTRIES = [
  {
    key: 'sm',
    token: SHADOW_TOKENS.sm,
    className: 'shadow-sm',
    label: 'Shadow Small (sm)',
  },
  {
    key: 'md',
    token: SHADOW_TOKENS.md,
    className: 'shadow-md',
    label: 'Shadow Medium (md)',
  },
  {
    key: 'lg',
    token: SHADOW_TOKENS.lg,
    className: 'shadow-lg',
    label: 'Shadow Large (lg)',
  },
];

const SPACING_STEPS = [
  { px: 4, label: '4px (0.25rem)' },
  { px: 8, label: '8px (0.50rem)' },
  { px: 12, label: '12px (0.75rem)' },
  { px: 16, label: '16px (1.00rem)' },
  { px: 24, label: '24px (1.50rem)' },
  { px: 32, label: '32px (2.00rem)' },
];

export function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-surface-subtle text-text-primary antialiased">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-border-subtle bg-surface-base px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-sm bg-state-success-bg px-2.5 py-0.5 text-footnote font-medium text-state-success">
              M1-T02 • Validation Surface
            </span>
            <span className="inline-flex items-center rounded-sm bg-surface-muted px-2.5 py-0.5 text-footnote text-text-secondary">
              Tailwind CSS v4
            </span>
            <span className="inline-flex items-center rounded-sm bg-surface-muted px-2.5 py-0.5 text-footnote text-text-secondary">
              WCAG 2.2 Level AA Verified Tokens
            </span>
          </div>
          <h1 className="mt-3 text-display-1 text-text-primary">Design System Preview</h1>
          <p className="mt-1 text-body-large text-text-secondary">
            Canonical design tokens, typography scales, geometry, and interaction targets for
            QR_review.
          </p>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* ── Section A: Semantic Color Tokens ──────────────────────────── */}
        <section
          aria-labelledby="heading-colors"
          className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-colors" className="text-heading-1 text-text-primary">
              Section A — Semantic Color Tokens
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Approved color roles from docs/UI_UX.md §3 with verified WCAG 2.2 AA contrast ratios.
            </p>
          </header>

          <div className="mt-6 space-y-8">
            {COLOR_CATEGORIES.map((category) => (
              <article key={category.title}>
                <h3 className="text-heading-3 text-text-primary">{category.title}</h3>
                <p className="text-body-small text-text-secondary">{category.description}</p>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {category.tokens.map((token) => (
                    <div
                      key={token.name}
                      className="flex flex-col justify-between rounded-lg border border-border-subtle bg-surface-base p-3 shadow-sm"
                    >
                      <div>
                        <div
                          className="h-12 w-full rounded-md border border-border-subtle"
                          style={{ backgroundColor: token.hex }}
                          aria-hidden="true"
                        />
                        <div className="mt-2 font-mono text-body-small font-semibold text-text-primary">
                          {token.name}
                        </div>
                        <div className="font-mono text-footnote text-text-secondary">
                          {token.hex}
                        </div>
                        <p className="mt-1 text-footnote text-text-secondary">{token.usage}</p>
                      </div>

                      <div className="mt-2 border-t border-border-subtle pt-2">
                        <span className="inline-block rounded-sm bg-surface-subtle px-1.5 py-0.5 text-footnote text-text-secondary">
                          {token.contrastBadge}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}

            {/* Accessible State Usage & Contrast Guidance Box */}
            <div className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
              <h4 className="text-heading-3 text-text-primary">
                Accessible State Usage & Contrast Thresholds
              </h4>
              <p className="mt-1 text-body-normal text-text-secondary">
                WCAG 2.2 AA SC 1.4.3 requires ≥ 4.5:1 for normal text and ≥ 3.0:1 for large text (≥
                24px regular / ≥ 18.66px bold) or non-text indicators (SC 1.4.11).
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Success State */}
                <div className="rounded-md border border-border-subtle bg-surface-base p-3">
                  <span className="inline-flex items-center rounded-sm bg-state-success-bg px-2 py-0.5 text-body-small font-medium text-state-success">
                    Success: 4.57:1 (AA Normal Text)
                  </span>
                  <p className="mt-2 text-footnote text-text-secondary">
                    state-success (#15803D) on state-success-bg (#DCFCE7) meets the 4.5:1 threshold
                    for normal-sized text.
                  </p>
                </div>

                {/* Warning State */}
                <div className="rounded-md border border-border-subtle bg-surface-base p-3">
                  <span className="inline-flex items-center rounded-sm bg-state-warning-bg px-2 py-0.5 text-body-small font-medium text-state-warning">
                    Warning: 4.51:1 (AA Normal Text)
                  </span>
                  <p className="mt-2 text-footnote text-text-secondary">
                    state-warning (#B45309) on state-warning-bg (#FEF3C7) meets the 4.5:1 threshold
                    for normal-sized text.
                  </p>
                </div>

                {/* Danger State */}
                <div className="rounded-md border border-border-subtle bg-surface-base p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded-sm bg-state-danger px-2 py-0.5 text-body-small font-medium text-brand-primary-fg">
                      Solid: 4.83:1 (AA Normal)
                    </span>
                  </div>
                  <p className="mt-2 text-footnote text-text-secondary">
                    White on state-danger (#DC2626) yields 4.83:1 (AA normal text). On light fill
                    (#FEE2E2), state-danger yields 3.95:1 (qualifying large text ≥ 24px only; use
                    text-primary 14.6:1 for normal body text).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section B: Typography Scale ───────────────────────────────── */}
        <section
          aria-labelledby="heading-typography"
          className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-typography" className="text-heading-1 text-text-primary">
              Section B — Typography Hierarchy
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Eight standardized levels with approved font pairings (Plus Jakarta Sans & Inter).
            </p>
          </header>

          <div className="mt-6 divide-y divide-border-subtle">
            {TYPOGRAPHY_ENTRIES.map((entry) => (
              <article key={entry.key} className="py-5 first:pt-0 last:pb-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-sm bg-surface-muted px-2 py-0.5 font-mono text-footnote font-medium text-text-primary">
                    .{entry.className}
                  </span>
                  <span className="text-footnote text-text-secondary">
                    {entry.spec.level} • {entry.spec.fontFamily} • {entry.spec.fontSize} (
                    {entry.spec.fontSizePx}px) / {entry.spec.lineHeight} ({entry.spec.lineHeightPx}
                    px) • Weight {entry.spec.fontWeight}
                  </span>
                </div>
                <div className={`${entry.className} text-text-primary`}>{entry.sample}</div>
                <p className="mt-1 text-footnote text-text-secondary">Usage: {entry.spec.usage}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Section C: Radius and Elevation ───────────────────────────── */}
        <section
          aria-labelledby="heading-geometry"
          className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-geometry" className="text-heading-1 text-text-primary">
              Section C — Radius and Elevation
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Standardized geometric border curves and elevation depth layers.
            </p>
          </header>

          {/* Border Radius */}
          <article className="mt-6">
            <h3 className="text-heading-3 text-text-primary">Border Radius Scale</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {RADIUS_ENTRIES.map((r) => (
                <div
                  key={r.key}
                  className={`flex h-24 flex-col items-center justify-center border-2 border-brand-accent bg-surface-subtle p-2 text-center ${r.className}`}
                >
                  <span className="font-mono text-body-small font-semibold text-text-primary">
                    {r.key} ({r.token.value})
                  </span>
                  <span className="text-footnote text-text-secondary">{r.token.usage}</span>
                </div>
              ))}
            </div>
          </article>

          {/* Elevation Shadows */}
          <article className="mt-8 border-t border-border-subtle pt-6">
            <h3 className="text-heading-3 text-text-primary">Elevation Shadows</h3>
            <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {SHADOW_ENTRIES.map((s) => (
                <div
                  key={s.key}
                  className={`rounded-lg border border-border-subtle bg-surface-base p-6 text-center ${s.className}`}
                >
                  <span className="text-heading-3 text-text-primary">{s.label}</span>
                  <p className="mt-2 font-mono text-footnote text-text-secondary">
                    {s.token.value}
                  </p>
                  <p className="mt-1 text-footnote text-text-secondary">{s.token.usage}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        {/* ── Section D: Touch-Target and Spacing Examples ───────────────── */}
        <section
          aria-labelledby="heading-ergonomics"
          className="rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-ergonomics" className="text-heading-1 text-text-primary">
              Section D — Touch Targets and Spacing
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Mobile ergonomic targets meeting and exceeding WCAG 2.2 SC 2.5.8 requirements.
            </p>
          </header>

          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Preferred vs Floor Targets */}
            <article className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
              <h3 className="text-heading-3 text-text-primary">Target Sizing Guidelines</h3>
              <p className="mt-1 text-body-normal text-text-secondary">
                Touch targets must provide comfortable, error-free mobile interaction.
              </p>

              <div className="mt-6 space-y-6">
                {/* 48px Preferred Target */}
                <div>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      className="touch-target-preferred inline-flex items-center justify-center rounded-md bg-brand-primary px-4 py-3 text-body-normal font-medium text-brand-primary-fg shadow-sm transition hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                    >
                      48×48px Button
                    </button>
                    <div>
                      <div className="text-body-normal font-medium text-text-primary">
                        Preferred Target ({TOUCH_TARGETS.preferred.cssPx}×
                        {TOUCH_TARGETS.preferred.cssPx}px)
                      </div>
                      <div className="text-footnote text-text-secondary">
                        {TOUCH_TARGETS.preferred.description}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 24px Floor Boundary */}
                <div>
                  <div className="flex items-center gap-4">
                    <div
                      className="touch-target-floor flex items-center justify-center rounded-sm border-2 border-dashed border-state-warning bg-state-warning-bg text-center font-mono text-footnote font-bold text-state-warning"
                      aria-label="24 by 24 pixel minimum target boundary indicator"
                    >
                      24
                    </div>
                    <div>
                      <div className="text-body-normal font-medium text-text-primary">
                        Absolute Floor ({TOUCH_TARGETS.floor.cssPx}×{TOUCH_TARGETS.floor.cssPx}px)
                      </div>
                      <div className="text-footnote text-text-secondary">
                        {TOUCH_TARGETS.floor.description}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </article>

            {/* Spacing Conventions */}
            <article className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
              <h3 className="text-heading-3 text-text-primary">
                Spacing Conventions (4px Multiples)
              </h3>
              <p className="mt-1 text-body-normal text-text-secondary">
                Predictable vertical rhythm and component padding.
              </p>

              <div className="mt-6 space-y-3">
                {SPACING_STEPS.map((s) => (
                  <div key={s.px} className="flex items-center gap-3">
                    <div className="w-24 font-mono text-footnote text-text-secondary">
                      {s.label}
                    </div>
                    <div
                      className="h-5 rounded-xs bg-brand-accent"
                      style={{ width: `${s.px * 3}px` }}
                      aria-hidden="true"
                    />
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-subtle bg-surface-base px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
          <p className="text-footnote text-text-secondary">
            QR_review Platform • Milestone M1-T02 Design System Validation Surface
          </p>
          <p className="text-footnote text-text-secondary">
            Evaluated under WCAG 2.2 Level AA criteria
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
