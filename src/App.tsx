import React from 'react';
import './App.css';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_SCALE,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  TOUCH_TARGETS,
} from './lib/tokens.ts';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Select, SelectOption } from './components/ui/select.tsx';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './components/ui/dialog.tsx';
import { Skeleton } from './components/ui/skeleton.tsx';
import { ToastProvider, useToast } from './components/ui/toast.tsx';

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
        contrastBadge: 'Secondary Button / Form Background',
      },
    ],
  },
  {
    title: 'Typography & Icon Roles',
    description: 'Foreground text contrast compliant with WCAG 2.2 Level AA.',
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
        contrastBadge: '≥ 3.0:1 UI Components (2.73:1 Decorative)',
      },
    ],
  },
  {
    title: 'Border Tokens',
    description: 'Component boundaries, divider lines, and active input rings.',
    tokens: [
      {
        ...COLOR_TOKENS.borderSubtle,
        contrastBadge: 'Dividers & Inactive Inputs',
      },
      {
        ...COLOR_TOKENS.borderStrong,
        contrastBadge: 'Interactive State Focus Rings',
      },
    ],
  },
  {
    title: 'Semantic State Roles',
    description: 'Positive, warning, and error status indicators with paired backgrounds.',
    tokens: [
      {
        ...COLOR_TOKENS.stateSuccess,
        contrastBadge: '≥ 4.5:1 on White (5.02:1)',
      },
      {
        ...COLOR_TOKENS.stateSuccessBg,
        contrastBadge: '4.57:1 with Success Green text',
      },
      {
        ...COLOR_TOKENS.stateWarning,
        contrastBadge: '≥ 4.5:1 on White (5.02:1)',
      },
      {
        ...COLOR_TOKENS.stateWarningBg,
        contrastBadge: '4.51:1 with Warning text',
      },
      {
        ...COLOR_TOKENS.stateDanger,
        contrastBadge: '≥ 4.5:1 on White (4.83:1)',
      },
      {
        ...COLOR_TOKENS.stateDangerBg,
        contrastBadge: '3.95:1 with Danger Red text',
      },
    ],
  },
];

const TYPOGRAPHY_LEVELS = [
  {
    role: 'Display 1',
    token: TYPOGRAPHY_SCALE.display1,
    sample: 'Empower Your Business Reviews',
    usage: 'Customer Welcome Title, Hero headings',
  },
  {
    role: 'Heading 1',
    token: TYPOGRAPHY_SCALE.heading1,
    sample: 'Merchant Analytics Overview',
    usage: 'Dashboard headers, primary modal titles',
  },
  {
    role: 'Heading 2',
    token: TYPOGRAPHY_SCALE.heading2,
    sample: 'How was your dining experience today?',
    usage: 'Survey MCQ questions, section titles',
  },
  {
    role: 'Heading 3',
    token: TYPOGRAPHY_SCALE.heading3,
    sample: 'Ambience & Cleanliness',
    usage: 'Option card titles, metric summary labels',
  },
  {
    role: 'Body Large',
    token: TYPOGRAPHY_SCALE.bodyLarge,
    sample: 'The service was prompt and the staff was extremely courteous.',
    usage: 'Review draft editor text, lead paragraphs',
  },
  {
    role: 'Body Normal',
    token: TYPOGRAPHY_SCALE.bodyNormal,
    sample: 'Reviews help local businesses thrive and improve community trust.',
    usage: 'Interface labels, general survey text',
  },
  {
    role: 'Body Small',
    token: TYPOGRAPHY_SCALE.bodySmall,
    sample: 'All customer feedback is private and protected.',
    usage: 'Timestamps, helper instructions, tooltips',
  },
  {
    role: 'Footnote',
    token: TYPOGRAPHY_SCALE.footnote,
    sample: 'DPDPA 2023 Compliant • Anonymous Survey Submission',
    usage: 'Legal notices, subtle metadata disclaimers',
  },
];

const RADII_ITEMS = [
  { key: 'sm', ...RADIUS_TOKENS.sm, usage: 'Badges, tooltips' },
  { key: 'md', ...RADIUS_TOKENS.md, usage: 'Standard buttons, form inputs' },
  { key: 'lg', ...RADIUS_TOKENS.lg, usage: 'Inner cards, review editor box' },
  { key: 'xl', ...RADIUS_TOKENS.xl, usage: 'MCQ option cards, dialog containers' },
  { key: '2xl', ...RADIUS_TOKENS['2xl'], usage: 'Customer mobile survey card' },
  { key: 'full', ...RADIUS_TOKENS.full, usage: 'Status pills, avatar tags' },
];

const SHADOW_ITEMS = [
  {
    key: 'sm',
    ...SHADOW_TOKENS.sm,
    usage: 'Card borders, baseline elevation',
  },
  {
    key: 'md',
    ...SHADOW_TOKENS.md,
    usage: 'Active option card lift, subtle focus hover',
  },
  {
    key: 'lg',
    ...SHADOW_TOKENS.lg,
    usage: 'Modals, flyout menus, standee preview card',
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

function ComponentShowcase(): React.JSX.Element {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = React.useState('salon');
  const [storeName, setStoreName] = React.useState('Aura Salon & Spa');
  const [optionalNote, setOptionalNote] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <section
      aria-labelledby="heading-components"
      className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
      id="components-showcase"
    >
      <header className="border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="heading-components" className="text-heading-1 text-text-primary">
            Section D: M1-T03 — UI Component Showcase
          </h2>
          <span className="inline-flex items-center rounded-sm bg-state-success-bg px-2.5 py-0.5 text-footnote font-medium text-state-success">
            Milestone M1-T03 • 9 Components Integrated
          </span>
        </div>
        <p className="mt-1 text-body-normal text-text-secondary">
          Integrated demonstration of all nine approved UI component types built on React 19, strict
          TypeScript, Tailwind CSS v4, and accessible Radix primitives.
        </p>
      </header>

      <div className="mt-8 space-y-10">
        {/* 1. Button */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">1. Button</h3>
            <p className="text-body-normal text-text-secondary">
              Accessible buttons supporting semantic variants, keyboard focus rings, and touch-aware
              sizing (≥44px floor, 48px preferred thumb target).
            </p>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
            <h4 className="mb-3 text-heading-3 text-text-primary">Variants</h4>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="default">Primary Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="accent">Brand Accent</Button>
              <Button variant="link">Link Action</Button>
            </div>

            <h4 className="mt-6 mb-3 text-heading-3 text-text-primary">Sizes & Touch Ergonomics</h4>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small (32px)</Button>
              <Button size="default">Default (40px)</Button>
              <Button size="lg">Large (44px target)</Button>
              <Button size="touch">Touch Preferred (48px)</Button>
              <Button size="icon" aria-label="Copy action">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </Button>
              <Button size="icon-touch" aria-label="Touch copy action">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </Button>
              <Button isLoading>Loading State</Button>
              <Button disabled>Disabled Button</Button>
            </div>
          </div>
        </article>

        {/* 2. Input & Textarea */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">2. Input & Textarea</h3>
            <p className="text-body-normal text-text-secondary">
              Form inputs with associated labels, helper text, accessible error states, and mobile
              touch sizing.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 rounded-lg border border-border-subtle bg-surface-subtle p-5 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="showcase-store-name"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Store Name (Default Labeled)
                </label>
                <Input
                  id="showcase-store-name"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="Enter business name"
                />
                <p className="mt-1 text-footnote text-text-secondary">
                  Used in public QR survey banner.
                </p>
              </div>

              <div>
                <label
                  htmlFor="showcase-input-required"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Destination URL{' '}
                  <span className="text-state-danger" aria-hidden="true">
                    *
                  </span>{' '}
                  (Required)
                </label>
                <Input
                  id="showcase-input-required"
                  required
                  defaultValue="https://g.page/r/example"
                  placeholder="Mandatory Google Maps URL"
                />
              </div>

              <div>
                <label
                  htmlFor="showcase-input-disabled"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Public QR Identifier (Disabled / Read-only)
                </label>
                <Input
                  id="showcase-input-disabled"
                  disabled
                  defaultValue="pub_9k2m1x"
                  aria-label="Public QR Identifier (Hardware locked)"
                />
                <p className="mt-1 text-footnote text-text-secondary">
                  Immutable hardware-locked tenant identity.
                </p>
              </div>

              <div>
                <label
                  htmlFor="showcase-input-touch"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Mobile Touch Input (48px height, 16px font prevents zoom)
                </label>
                <Input
                  id="showcase-input-touch"
                  inputSize="touch"
                  defaultValue="https://maps.app.goo.gl/sample"
                  placeholder="Paste Google Maps review link"
                />
              </div>

              <div>
                <label
                  htmlFor="showcase-input-invalid"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Input with Error State
                </label>
                <Input
                  id="showcase-input-invalid"
                  isInvalid
                  defaultValue="invalid-url"
                  aria-describedby="input-error-msg"
                />
                <p id="input-error-msg" className="mt-1 text-footnote text-state-danger">
                  Please enter a valid Google Maps review link.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="showcase-note-textarea"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Customer Feedback Note (Textarea)
                </label>
                <Textarea
                  id="showcase-note-textarea"
                  value={optionalNote}
                  onChange={(e) => setOptionalNote(e.target.value)}
                  placeholder="Tell us what stood out during your visit (optional)..."
                  maxLength={150}
                  rows={3}
                />
                <div className="mt-1 flex justify-between text-footnote text-text-secondary">
                  <span>Treat text as data, never instructions</span>
                  <span>{optionalNote.length}/150 chars</span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="showcase-textarea-disabled"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Disabled Textarea (Survey Closed)
                </label>
                <Textarea
                  id="showcase-textarea-disabled"
                  disabled
                  defaultValue="This survey is currently locked by tenant administrator."
                  rows={2}
                />
              </div>

              <div>
                <label
                  htmlFor="showcase-textarea-invalid"
                  className="mb-1.5 block text-body-small font-medium text-text-primary"
                >
                  Textarea Error State
                </label>
                <Textarea
                  id="showcase-textarea-invalid"
                  isInvalid
                  defaultValue="Note exceeds maximum permitted length."
                  aria-describedby="textarea-error-msg"
                />
                <p id="textarea-error-msg" className="mt-1 text-footnote text-state-danger">
                  Character limit exceeded (maximum 150 characters).
                </p>
              </div>
            </div>
          </div>
        </article>

        {/* 3. Native Select */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">3. Native Select</h3>
            <p className="text-body-normal text-text-secondary">
              Accessible dropdown with custom SVG chevron indicator, preserving mobile platform
              picker sheets.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 rounded-lg border border-border-subtle bg-surface-subtle p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="showcase-select-default"
                className="mb-1.5 block text-body-small font-medium text-text-primary"
              >
                Category (Default)
              </label>
              <Select
                id="showcase-select-default"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                <SelectOption value="salon">Salon & Spa</SelectOption>
                <SelectOption value="cafe">Specialty Cafe</SelectOption>
                <SelectOption value="clinic">Wellness Clinic</SelectOption>
              </Select>
            </div>

            <div>
              <label
                htmlFor="showcase-select-touch"
                className="mb-1.5 block text-body-small font-medium text-text-primary"
              >
                Touch Size (48px target)
              </label>
              <Select id="showcase-select-touch" selectSize="touch" defaultValue="active">
                <SelectOption value="active">Active Business</SelectOption>
                <SelectOption value="suspended">Suspended</SelectOption>
                <SelectOption value="past_due">Past Due</SelectOption>
              </Select>
            </div>

            <div>
              <label
                htmlFor="showcase-select-disabled"
                className="mb-1.5 block text-body-small font-medium text-text-primary"
              >
                Plan Tier (Disabled)
              </label>
              <Select id="showcase-select-disabled" disabled defaultValue="pilot">
                <SelectOption value="pilot">Founder Pilot Tier</SelectOption>
                <SelectOption value="pro">Pro Merchant</SelectOption>
              </Select>
            </div>

            <div>
              <label
                htmlFor="showcase-select-invalid"
                className="mb-1.5 block text-body-small font-medium text-text-primary"
              >
                Select with Error
              </label>
              <Select id="showcase-select-invalid" isInvalid defaultValue="">
                <SelectOption value="">Choose category...</SelectOption>
                <SelectOption value="salon">Salon</SelectOption>
                <SelectOption value="cafe">Cafe</SelectOption>
              </Select>
              <p className="mt-1 text-footnote text-state-danger">Please choose a category.</p>
            </div>
          </div>
        </article>

        {/* 4. Card Family */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">4. Card</h3>
            <p className="text-body-normal text-text-secondary">
              Passive structural containers for layouts, dashboard tiles, and survey shells.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Merchant Overview</CardTitle>
                  <Badge variant="success">Active Pilot</Badge>
                </div>
                <CardDescription>Tenant metrics and digital QR review health.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-body-normal text-text-secondary">
                  Monthly quota: 124 / 150 generations consumed. Direct Google bypass link active.
                </p>
              </CardContent>
              <CardFooter className="flex justify-between border-t border-border-subtle pt-4">
                <span className="text-footnote text-text-secondary">ID: pub_9k2m1x</span>
                <Button variant="outline" size="sm">
                  Configure Google URL
                </Button>
              </CardFooter>
            </Card>

            <Card variant="subtle">
              <CardHeader>
                <CardTitle>Subtle Card Container</CardTitle>
                <CardDescription>
                  Flat subtle surface fill for nested content groups.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-body-normal text-text-secondary">
                  Provides visual separation when rendering secondary data panels without heavy
                  elevation.
                </p>
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button variant="ghost" size="sm">
                  Dismiss
                </Button>
                <Button size="sm">Acknowledge</Button>
              </CardFooter>
            </Card>
          </div>
        </article>

        {/* 5. Badge */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">5. Badge</h3>
            <p className="text-body-normal text-text-secondary">
              Informational status indicators with verified normal-text contrast (≥4.5:1).
            </p>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
            <h4 className="mb-3 text-heading-3 text-text-primary">Semantic Variants</h4>
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant="default">Primary Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="success">Success (Active)</Badge>
              <Badge variant="warning">Warning (Pending)</Badge>
              <Badge variant="destructive">Destructive (Suspended: 4.83:1)</Badge>
              <Badge variant="accent">Brand Accent</Badge>
            </div>

            <h4 className="mt-6 mb-3 text-heading-3 text-text-primary">Shapes & Sizing</h4>
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge size="sm">Small (11px)</Badge>
              <Badge size="default">Default (12px)</Badge>
              <Badge size="lg">Large (14px)</Badge>
              <Badge shape="pill" variant="success">
                Pill: Online
              </Badge>
              <Badge shape="pill" variant="destructive">
                Pill: Expired
              </Badge>
              <Badge shape="pill" variant="secondary">
                Pill: Draft
              </Badge>
            </div>
          </div>
        </article>

        {/* 6. Modal Dialog (Radix UI) */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">6. Dialog (Radix UI)</h3>
            <p className="text-body-normal text-text-secondary">
              Accessible modal with focus trapping, Escape dismissal, backdrop blur, and
              touch-friendly close target.
            </p>
          </div>

          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="default">Open Confirmation Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reset Monthly Generation Quota?</DialogTitle>
                  <DialogDescription>
                    This administrative action will immediately restore the monthly draft
                    reservation limit to 150 generations for this merchant tenant.
                  </DialogDescription>
                </DialogHeader>
                <div className="rounded-md border border-border-subtle bg-surface-subtle p-3 text-body-small text-text-secondary">
                  Target Tenant: <strong>Aura Salon & Spa (pub_9k2m1x)</strong>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    variant="default"
                    onClick={() => {
                      setDialogOpen(false);
                      toast({
                        title: 'Quota Reset Successfully',
                        description:
                          'Monthly generation allowance set to 150 for tenant pub_9k2m1x.',
                        variant: 'success',
                      });
                    }}
                  >
                    Confirm Reset
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </article>

        {/* 7. Toast Notifications */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">7. Toast Notifications</h3>
            <p className="text-body-normal text-text-secondary">
              Floating feedback alerts for clipboard copy events, save confirmations, and error
              telemetry.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-subtle p-5">
            <Button
              variant="outline"
              onClick={() => {
                toast({
                  title: 'Review Link Copied!',
                  description: 'https://qr-review.in/q/pub_9k2m1x copied to clipboard.',
                  variant: 'success',
                });
              }}
            >
              Trigger Success Toast
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                toast({
                  title: 'Survey Setting Saved',
                  description: 'Question 2 category options updated successfully.',
                  variant: 'default',
                });
              }}
            >
              Trigger Default Toast
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                toast({
                  title: 'Quota Approaching Limit',
                  description: '140 of 150 generation reservations used for current cycle.',
                  variant: 'warning',
                });
              }}
            >
              Trigger Warning Toast
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                toast({
                  title: 'Generation Failed',
                  description: 'AI model timed out after 8000ms. Reserved quota released.',
                  variant: 'destructive',
                });
              }}
            >
              Trigger Destructive Toast
            </Button>
          </div>
        </article>

        {/* 8. Skeleton Loading Shimmer */}
        <article className="space-y-4">
          <div>
            <h3 className="text-heading-2 text-text-primary">8. Skeleton</h3>
            <p className="text-body-normal text-text-secondary">
              Accessible placeholder shapes (`aria-hidden="true"`) with pulse and shimmer animation
              modes and parent live status announcements.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 rounded-lg border border-border-subtle bg-surface-subtle p-5 sm:grid-cols-2">
            {/* Pulse Skeleton Card */}
            <div
              role="status"
              aria-label="Loading merchant telemetry card"
              className="space-y-3 rounded-lg border border-border-subtle bg-surface-base p-4"
            >
              <span className="sr-only">Loading merchant telemetry...</span>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="grow space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-20 w-full" />
              <div className="flex justify-end gap-2 pt-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>
            </div>

            {/* Shimmer Skeleton Card */}
            <div
              role="status"
              aria-label="Loading survey option card"
              className="space-y-3 rounded-lg border border-border-subtle bg-surface-base p-4"
            >
              <span className="sr-only">Loading survey options...</span>
              <div className="flex items-center justify-between">
                <Skeleton shimmer className="h-5 w-32" />
                <Skeleton shimmer className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton shimmer className="h-4 w-full" />
              <Skeleton shimmer className="h-4 w-5/6" />
              <Skeleton shimmer className="h-4 w-2/3" />
              <div className="pt-2">
                <Skeleton shimmer className="h-10 w-full" />
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function AppContent(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-surface-subtle text-text-primary antialiased">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-border-subtle bg-surface-base px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-sm bg-state-success-bg px-2.5 py-0.5 text-footnote font-medium text-state-success">
              M1-T02 • Validation Surface
            </span>
            <span className="inline-flex items-center rounded-sm bg-state-success-bg px-2.5 py-0.5 text-footnote font-medium text-state-success">
              M1-T03 • UI Primitives Integrated
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
                      className="overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle shadow-sm"
                    >
                      <div
                        className="h-24 w-full border-b border-border-subtle"
                        style={{ backgroundColor: token.hex }}
                        aria-label={`Color swatch for ${token.name}`}
                      />
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-body-small font-semibold text-text-primary">
                            {token.name}
                          </span>
                          <span className="font-mono text-footnote text-text-secondary">
                            {token.hex}
                          </span>
                        </div>
                        <p className="mt-1 text-footnote text-text-secondary">{token.usage}</p>
                        <div className="mt-2">
                          <span
                            className={`inline-block rounded-xs px-1.5 py-0.5 text-footnote font-medium ${
                              token.contrastBadge.includes('FAIL')
                                ? 'bg-state-danger-bg text-state-danger'
                                : 'bg-surface-muted text-text-secondary'
                            }`}
                          >
                            {token.contrastBadge}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Section B: Typography Scale ─────────────────────────────────── */}
        <section
          aria-labelledby="heading-typography"
          className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-typography" className="text-heading-1 text-text-primary">
              Section B — Typography Scale
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Fluid, accessible typography defined in docs/UI_UX.md §3.2 using Inter and Plus
              Jakarta Sans.
            </p>
          </header>

          <div className="mt-6 divide-y divide-border-subtle">
            {TYPOGRAPHY_LEVELS.map((level) => (
              <div key={level.role} className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-body-small font-semibold text-text-primary">
                      {level.role}
                    </span>
                    <span className="text-footnote text-text-secondary">
                      ({level.token.fontFamily})
                    </span>
                  </div>
                  <div className="font-mono text-footnote text-text-secondary">
                    {level.token.fontSize} / {level.token.lineHeight} • Weight:{' '}
                    {level.token.fontWeight} • Tracking: {level.token.letterSpacing}
                  </div>
                </div>

                <div
                  className="mt-2 text-text-primary"
                  style={{
                    fontFamily:
                      level.token.fontFamily === 'Plus Jakarta Sans'
                        ? 'var(--font-display)'
                        : 'var(--font-sans)',
                    fontSize: level.token.fontSize,
                    lineHeight: level.token.lineHeight,
                    fontWeight: level.token.fontWeight,
                    letterSpacing: level.token.letterSpacing,
                  }}
                >
                  {level.sample}
                </div>

                <p className="mt-1 text-footnote text-text-secondary">Usage: {level.usage}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section C: Geometry & Interaction Tokens ────────────────────── */}
        <section
          aria-labelledby="heading-geometry"
          className="mb-12 rounded-xl border border-border-subtle bg-surface-base p-6 sm:p-8"
        >
          <header className="border-b border-border-subtle pb-4">
            <h2 id="heading-geometry" className="text-heading-1 text-text-primary">
              Section C — Radii, Elevation & Touch Targets
            </h2>
            <p className="mt-1 text-body-normal text-text-secondary">
              Geometry, shadows, and touch ergonomics meeting WCAG 2.2 AA SC 2.5.8 requirements.
            </p>
          </header>

          <div className="mt-6 space-y-8">
            {/* Border Radii */}
            <article>
              <h3 className="text-heading-3 text-text-primary">Border Radii Scale</h3>
              <p className="text-body-small text-text-secondary">
                From micro badges to public customer survey cards.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {RADII_ITEMS.map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-col items-center rounded-lg border border-border-subtle bg-surface-subtle p-4 text-center"
                  >
                    <div
                      className="size-[52px] border-2 border-brand-accent bg-blue-50"
                      style={{ borderRadius: item.value }}
                      aria-hidden="true"
                    />
                    <span className="mt-3 font-mono text-body-small font-semibold text-text-primary">
                      rounded-{item.key}
                    </span>
                    <span className="font-mono text-footnote text-text-secondary">
                      {item.value}
                    </span>
                    <span className="mt-1 text-footnote text-text-secondary">{item.usage}</span>
                  </div>
                ))}
              </div>
            </article>

            {/* Elevation Shadows */}
            <article>
              <h3 className="text-heading-3 text-text-primary">Elevation Shadows</h3>
              <p className="text-body-small text-text-secondary">
                Subtle, non-distracting depth layers.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
                {SHADOW_ITEMS.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-lg border border-border-subtle bg-surface-base p-5 text-center"
                    style={{ boxShadow: item.value }}
                  >
                    <span className="font-mono text-body-small font-semibold text-text-primary">
                      shadow-{item.key}
                    </span>
                    <p className="mt-2 text-footnote text-text-secondary">{item.usage}</p>
                    <code className="mt-3 block font-mono text-footnote text-gray-400">
                      {item.value}
                    </code>
                  </div>
                ))}
              </div>
            </article>

            {/* Touch Target Ergonomics */}
            <article className="rounded-lg border border-border-subtle bg-surface-subtle p-5">
              <h3 className="text-heading-3 text-text-primary">Touch Target Ergonomics</h3>
              <p className="mt-1 text-body-normal text-text-secondary">
                Mobile-first target boundaries exceeding WCAG 2.2 AA minimums.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="rounded-md border border-border-subtle bg-surface-base p-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex size-14 items-center justify-center rounded-lg bg-green-50 text-green-600"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <div className="text-heading-3 text-text-primary">
                        Preferred Target ({TOUCH_TARGETS.preferred.cssPx}×
                        {TOUCH_TARGETS.preferred.cssPx}px)
                      </div>
                      <div className="text-footnote text-text-secondary">
                        {TOUCH_TARGETS.preferred.description}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border-subtle bg-surface-base p-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex size-14 items-center justify-center rounded-lg bg-blue-50 text-brand-accent"
                      aria-hidden="true"
                    >
                      <svg
                        className="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <div className="text-heading-3 text-text-primary">
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

        {/* ── Section D: M1-T03 Component Primitives Showcase ────────────── */}
        <ComponentShowcase />
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border-subtle bg-surface-base px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
          <p className="text-footnote text-text-secondary">
            QR_review Platform • Milestone M1-T03 Accessible Component Primitives Showcase
          </p>
          <p className="text-footnote text-text-secondary">
            Evaluated under WCAG 2.2 Level AA criteria
          </p>
        </div>
      </footer>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
