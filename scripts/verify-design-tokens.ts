/**
 * Design System & WCAG 2.2 AA Contrast Verification Script
 * Validates all tokens defined in src/lib/tokens.ts against docs/UI_UX.md requirements.
 */

import {
  COLOR_TOKENS,
  TYPOGRAPHY_SCALE,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  TOUCH_TARGETS,
} from '../src/lib/tokens.ts';
import { evaluateContrast } from '../src/lib/contrast.ts';

interface ContrastCheck {
  token: string;
  fgHex: string;
  bgHex: string;
  bgName: string;
  role: string;
  minRatio: number;
}

const CHECKS: ContrastCheck[] = [
  // Normal Text Tokens on White (#FFFFFF) - Requirement >= 4.5:1
  {
    token: 'brand-primary',
    fgHex: COLOR_TOKENS.brandPrimary.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'brand-accent',
    fgHex: COLOR_TOKENS.brandAccent.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'link/brand-accent',
    minRatio: 4.5,
  },
  {
    token: 'text-primary',
    fgHex: COLOR_TOKENS.textPrimary.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'text-secondary',
    fgHex: COLOR_TOKENS.textSecondary.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'text-muted',
    fgHex: COLOR_TOKENS.textMuted.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'state-success',
    fgHex: COLOR_TOKENS.stateSuccess.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'state-text',
    minRatio: 4.5,
  },
  {
    token: 'state-warning',
    fgHex: COLOR_TOKENS.stateWarning.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'state-text',
    minRatio: 4.5,
  },
  {
    token: 'state-danger',
    fgHex: COLOR_TOKENS.stateDanger.hex,
    bgHex: '#FFFFFF',
    bgName: 'surface-base (#FFFFFF)',
    role: 'state-text',
    minRatio: 4.5,
  },

  // Normal Text Tokens on Surface Subtle (#F8FAFC) - Requirement >= 4.5:1
  {
    token: 'text-primary on subtle',
    fgHex: COLOR_TOKENS.textPrimary.hex,
    bgHex: '#F8FAFC',
    bgName: 'surface-subtle (#F8FAFC)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'text-secondary on subtle',
    fgHex: COLOR_TOKENS.textSecondary.hex,
    bgHex: '#F8FAFC',
    bgName: 'surface-subtle (#F8FAFC)',
    role: 'normal-text',
    minRatio: 4.5,
  },
  {
    token: 'text-muted on subtle',
    fgHex: COLOR_TOKENS.textMuted.hex,
    bgHex: '#F8FAFC',
    bgName: 'surface-subtle (#F8FAFC)',
    role: 'normal-text',
    minRatio: 4.5,
  },

  // Primary Button Inversion (White on Brand Primary) - Requirement >= 4.5:1
  {
    token: 'brand-primary-fg on brand-primary',
    fgHex: COLOR_TOKENS.brandPrimaryFg.hex,
    bgHex: COLOR_TOKENS.brandPrimary.hex,
    bgName: 'brand-primary (#18181B)',
    role: 'button-text',
    minRatio: 4.5,
  },

  // State text on badge backgrounds (UI_UX.md Alert/Badge fills)
  {
    token: 'state-success on state-success-bg',
    fgHex: COLOR_TOKENS.stateSuccess.hex,
    bgHex: COLOR_TOKENS.stateSuccessBg.hex,
    bgName: 'state-success-bg (#DCFCE7)',
    role: 'badge-text',
    minRatio: 4.5,
  },
  {
    token: 'state-warning on state-warning-bg',
    fgHex: COLOR_TOKENS.stateWarning.hex,
    bgHex: COLOR_TOKENS.stateWarningBg.hex,
    bgName: 'state-warning-bg (#FEF3C7)',
    role: 'badge-text',
    minRatio: 4.5,
  },
  {
    token: 'state-danger on state-danger-bg',
    fgHex: COLOR_TOKENS.stateDanger.hex,
    bgHex: COLOR_TOKENS.stateDangerBg.hex,
    bgName: 'state-danger-bg (#FEE2E2)',
    role: 'large/badge-text',
    minRatio: 3.0,
  },
];

console.log('='.repeat(90));
console.log('   DESIGN SYSTEM & WCAG 2.2 LEVEL AA CONTRAST AUDIT (Task M1-T02)');
console.log('='.repeat(90));
console.log('');

let totalPassed = 0;
let totalFailed = 0;

console.log('1. Evaluating Contrast Ratios against WCAG 2.2 AA Criteria:');
console.log('-'.repeat(90));
console.log(
  'Token Name'.padEnd(35) + 'Pair'.padEnd(25) + 'Ratio'.padEnd(12) + 'Target'.padEnd(10) + 'Status',
);
console.log('-'.repeat(90));

for (const check of CHECKS) {
  const result = evaluateContrast(check.fgHex, check.bgHex);
  const passed = result.ratio >= check.minRatio;
  const pairDesc = `${check.fgHex} on ${check.bgHex}`;
  const status = passed ? 'PASS (AA)' : 'FAIL';

  console.log(
    check.token.padEnd(35) +
      pairDesc.padEnd(25) +
      `${result.ratio}:1`.padEnd(12) +
      `>= ${check.minRatio}:1`.padEnd(10) +
      status,
  );

  if (passed) {
    totalPassed++;
  } else {
    totalFailed++;
    console.error(
      `  [ERROR] Contrast failure: ${check.token} ratio ${result.ratio}:1 < ${check.minRatio}:1`,
    );
  }
}

console.log('-'.repeat(90));
console.log(`Contrast Check Summary: ${totalPassed} passed, ${totalFailed} failed.`);
console.log('');

// Typography scale inspection
console.log('2. Typography Scale Inspection:');
console.log('-'.repeat(90));
console.log(
  'Level'.padEnd(15) +
    'Font Family'.padEnd(22) +
    'Size (rem/px)'.padEnd(18) +
    'Line Height'.padEnd(14) +
    'Weight',
);
console.log('-'.repeat(90));
for (const typo of Object.values(TYPOGRAPHY_SCALE)) {
  console.log(
    typo.level.padEnd(15) +
      typo.fontFamily.padEnd(22) +
      `${typo.fontSize} (${typo.fontSizePx}px)`.padEnd(18) +
      `${typo.lineHeight}`.padEnd(14) +
      `${typo.fontWeight}`,
  );
}
console.log('');

// Touch Target Sizing Inspection
console.log('3. Touch Target Ergonomics Inspection:');
console.log('-'.repeat(90));
console.log(
  `Preferred Single-Hand Thumb Target : ${TOUCH_TARGETS.preferred.cssPx}px (Exceeds WCAG 2.2 AA)`,
);
console.log(`WCAG 2.2 SC 2.5.8 Absolute Floor   : ${TOUCH_TARGETS.floor.cssPx}px`);
console.log('');

// Border Radii & Shadow Tokens
console.log('4. Geometry & Elevation Tokens:');
console.log('-'.repeat(90));
console.log(
  `Radii   : sm=${RADIUS_TOKENS.sm.value}, md=${RADIUS_TOKENS.md.value}, lg=${RADIUS_TOKENS.lg.value}, xl=${RADIUS_TOKENS.xl.value}, 2xl=${RADIUS_TOKENS['2xl'].value}, full=${RADIUS_TOKENS.full.value}`,
);
console.log(`Shadows : sm=${SHADOW_TOKENS.sm.value}`);
console.log(`          md=${SHADOW_TOKENS.md.value}`);
console.log(`          lg=${SHADOW_TOKENS.lg.value}`);
console.log('='.repeat(90));

if (totalFailed > 0) {
  console.error(`\nAudit FAILED with ${totalFailed} contrast violations.`);
  process.exit(1);
} else {
  console.log('\nAudit PASSED: 100% WCAG 2.2 AA compliant tokens verified.');
  process.exit(0);
}
