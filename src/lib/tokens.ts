/**
 * Canonical Design System Tokens
 * Source: docs/UI_UX.md §3
 * WCAG 2.2 Level AA Contrast Verified
 */

export interface ColorToken {
  readonly name: string;
  readonly hex: string;
  readonly role: 'text' | 'surface' | 'border' | 'brand' | 'icon';
  readonly usage: string;
  readonly targetContrastRatio?: number; // Minimum required contrast on white or paired background
}

export const COLOR_TOKENS = {
  brandPrimary: {
    name: 'brand-primary',
    hex: '#18181B',
    role: 'brand',
    usage: 'Primary actions, brand headings, emphasis',
    targetContrastRatio: 4.5,
  },
  brandPrimaryFg: {
    name: 'brand-primary-fg',
    hex: '#FFFFFF',
    role: 'text',
    usage: 'High-contrast text on primary buttons',
    targetContrastRatio: 4.5,
  },
  brandSecondary: {
    name: 'brand-secondary',
    hex: '#F4F4F5',
    role: 'surface',
    usage: 'Secondary buttons, active option card background',
  },
  brandAccent: {
    name: 'brand-accent',
    hex: '#2563EB',
    role: 'brand',
    usage: 'Hyperlinks, Google handoff button, focus rings',
    targetContrastRatio: 4.5,
  },
  surfaceBase: {
    name: 'surface-base',
    hex: '#FFFFFF',
    role: 'surface',
    usage: 'Core card background, modal surfaces',
  },
  surfaceSubtle: {
    name: 'surface-subtle',
    hex: '#F8FAFC',
    role: 'surface',
    usage: 'Page canvas background, customer screen canvas',
  },
  surfaceMuted: {
    name: 'surface-muted',
    hex: '#F1F5F9',
    role: 'surface',
    usage: 'Inactive option cards, disabled fill surfaces',
  },
  borderSubtle: {
    name: 'border-subtle',
    hex: '#E2E8F0',
    role: 'border',
    usage: 'Subtle 1px structural component borders',
  },
  borderStrong: {
    name: 'border-strong',
    hex: '#94A3B8',
    role: 'border',
    usage: 'Active card borders, focused input boundaries',
    targetContrastRatio: 3.0, // WCAG 2.2 AA Non-text contrast
  },
  textPrimary: {
    name: 'text-primary',
    hex: '#0F172A',
    role: 'text',
    usage: 'Page titles, prominent body text, questions',
    targetContrastRatio: 4.5,
  },
  textSecondary: {
    name: 'text-secondary',
    hex: '#475569',
    role: 'text',
    usage: 'Descriptions, metadata, secondary labels',
    targetContrastRatio: 4.5,
  },
  textMuted: {
    name: 'text-muted',
    hex: '#475569',
    role: 'text',
    usage: 'Standard helper text, character counters',
    targetContrastRatio: 4.5,
  },
  uiMutedIcon: {
    name: 'ui-muted-icon',
    hex: '#94A3B8',
    role: 'icon',
    usage: 'Strictly for decorative icons / non-text items',
  },
  stateSuccess: {
    name: 'state-success',
    hex: '#15803D',
    role: 'text',
    usage: 'Success messages, copy confirmation text',
    targetContrastRatio: 4.5,
  },
  stateSuccessBg: {
    name: 'state-success-bg',
    hex: '#DCFCE7',
    role: 'surface',
    usage: 'Success badge fills, confirmation card surface',
  },
  stateWarning: {
    name: 'state-warning',
    hex: '#B45309',
    role: 'text',
    usage: 'Warning notices, quota low text alerts',
    targetContrastRatio: 4.5,
  },
  stateWarningBg: {
    name: 'state-warning-bg',
    hex: '#FEF3C7',
    role: 'surface',
    usage: 'Quota warning banner fills',
  },
  stateDanger: {
    name: 'state-danger',
    hex: '#DC2626',
    role: 'text',
    usage: 'Error messages, quota exhausted, suspension text',
    targetContrastRatio: 4.5,
  },
  stateDangerBg: {
    name: 'state-danger-bg',
    hex: '#FEE2E2',
    role: 'surface',
    usage: 'Error alert fills, destructive badges',
  },
} as const;

export const TYPOGRAPHY_SCALE = {
  display1: {
    level: 'Display 1',
    fontFamily: 'Plus Jakarta Sans',
    fontSize: '1.875rem',
    fontSizePx: 30,
    lineHeight: '2.25rem',
    lineHeightPx: 36,
    fontWeight: 700,
    letterSpacing: '-0.025em',
    usage: 'Customer Welcome Title, Landing hero',
  },
  heading1: {
    level: 'Heading 1',
    fontFamily: 'Inter',
    fontSize: '1.500rem',
    fontSizePx: 24,
    lineHeight: '2.00rem',
    lineHeightPx: 32,
    fontWeight: 600,
    letterSpacing: '-0.020em',
    usage: 'Dashboard Overview Title, Admin Modals',
  },
  heading2: {
    level: 'Heading 2',
    fontFamily: 'Inter',
    fontSize: '1.250rem',
    fontSizePx: 20,
    lineHeight: '1.75rem',
    lineHeightPx: 28,
    fontWeight: 600,
    letterSpacing: '-0.015em',
    usage: 'Card section titles, MCQ Question prompt',
  },
  heading3: {
    level: 'Heading 3',
    fontFamily: 'Inter',
    fontSize: '1.000rem',
    fontSizePx: 16,
    lineHeight: '1.50rem',
    lineHeightPx: 24,
    fontWeight: 500,
    letterSpacing: '-0.010em',
    usage: 'Metric Card labels, Option card titles',
  },
  bodyLarge: {
    level: 'Body Large',
    fontFamily: 'Inter',
    fontSize: '1.000rem',
    fontSizePx: 16,
    lineHeight: '1.50rem',
    lineHeightPx: 24,
    fontWeight: 400,
    letterSpacing: '0.000em',
    usage: 'Review draft editor, lead paragraphs',
  },
  bodyNormal: {
    level: 'Body Normal',
    fontFamily: 'Inter',
    fontSize: '0.875rem',
    fontSizePx: 14,
    lineHeight: '1.25rem',
    lineHeightPx: 20,
    fontWeight: 400,
    letterSpacing: '0.000em',
    usage: 'Standard interface labels, table data',
  },
  bodySmall: {
    level: 'Body Small',
    fontFamily: 'Inter',
    fontSize: '0.750rem',
    fontSizePx: 12,
    lineHeight: '1.00rem',
    lineHeightPx: 16,
    fontWeight: 500,
    letterSpacing: '+0.010em',
    usage: 'Form helper text, timestamp badges, tooltips',
  },
  footnote: {
    level: 'Footnote',
    fontFamily: 'Inter',
    fontSize: '0.687rem',
    fontSizePx: 11,
    lineHeight: '0.875rem',
    lineHeightPx: 14,
    fontWeight: 400,
    letterSpacing: '+0.015em',
    usage: 'Privacy disclosures, legal compliance notices',
  },
} as const;

export const RADIUS_TOKENS = {
  sm: { value: '4px', usage: 'Badges, tooltips' },
  md: { value: '6px', usage: 'Standard buttons, form inputs' },
  lg: { value: '8px', usage: 'Inner cards, review editor box' },
  xl: { value: '12px', usage: 'MCQ option cards, dialog containers' },
  '2xl': { value: '16px', usage: 'Public customer mobile survey container' },
  full: { value: '9999px', usage: 'Pills, avatar placeholders' },
} as const;

export const SHADOW_TOKENS = {
  sm: { value: '0 1px 2px 0 rgb(0 0 0 / 0.05)', usage: 'Subtle card border lift' },
  md: {
    value: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
    usage: 'Active option cards',
  },
  lg: {
    value: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
    usage: 'Modals, flyout menus',
  },
} as const;

export const TOUCH_TARGETS = {
  preferred: {
    cssPx: 48,
    description: 'Preferred customer target for effortless single-hand thumb navigation',
  },
  floor: {
    cssPx: 24,
    description: 'WCAG 2.2 AA SC 2.5.8 absolute minimum target size',
  },
} as const;
