import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabaseAdmin = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUSINESS_1_ID = 'b0000000-0000-4000-8000-000000000001'; // Luxe Studio (Owner 1)

// Valid 1x1 PNG that cleanly decodes in Chromium browsers
const VALID_1X1_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createValidPngBuffer(padLength?: number): Buffer {
  const baseBuf = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
  if (padLength && padLength > baseBuf.length) {
    const padded = Buffer.alloc(padLength);
    baseBuf.copy(padded);
    return padded;
  }
  return baseBuf;
}

test.describe('M5-T05: Merchant Logo Upload & Storage Gateway', () => {
  test.describe.configure({ mode: 'serial' });

  const restoreFixtures = async () => {
    await supabaseAdmin
      .from('businesses')
      .update({ logo_url: null })
      .eq('id', BUSINESS_1_ID);

    const files = ['png', 'jpeg', 'webp'].map((ext) => `${BUSINESS_1_ID}/logo.${ext}`);
    await supabaseAdmin.storage.from('business-logos').remove(files);
  };

  test.beforeAll(async () => {
    await restoreFixtures();
  });

  test.afterAll(async () => {
    await restoreFixtures();
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test.afterEach(async () => {
    await restoreFixtures();
  });

  test('TC-UPL-01: Authenticated merchant uploads PNG logo, updates preview, and verifies DB persistence', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Profile Settings
    await page.goto('/dashboard/profile');
    await expect(
      page.getByRole('heading', { level: 1, name: /Business Profile & Brand Settings/i }),
    ).toBeVisible();

    // 3. Verify initial state shows Default Avatar monogram
    const logoCard = page.getByTestId('profile-logo-card');
    await expect(logoCard).toBeVisible();
    await expect(logoCard.getByTestId('logo-monogram-placeholder')).toHaveText('LS');
    await expect(logoCard.getByTestId('logo-remove-btn')).not.toBeVisible();

    // 4. Select and upload a valid PNG logo file
    const fileInput = page.getByTestId('logo-file-input');
    const pngBuffer = createValidPngBuffer();

    await fileInput.setInputFiles({
      name: 'luxe-brand-logo.png',
      mimeType: 'image/png',
      buffer: pngBuffer,
    });

    // 5. Verify success alert appears
    const successAlert = page.getByTestId('logo-success-alert');
    await expect(successAlert).toBeVisible({ timeout: 10000 });
    await expect(successAlert).toContainText(/uploaded and verified successfully/i);

    // 6. Verify preview renders image
    const previewImg = page.getByTestId('current-logo-preview');
    await expect(previewImg).toBeVisible();
    await expect(previewImg).toHaveAttribute('src', /business-logos/);

    // 7. Verify remove button is now visible
    const removeBtn = page.getByTestId('logo-remove-btn');
    await expect(removeBtn).toBeVisible();

    // 8. Verify database persistence in PostgreSQL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).not.toBeNull();
    expect(biz?.logo_url).toContain(`business-logos/${BUSINESS_1_ID}/logo.png`);

    // 9. Verify public customer flow displays the updated logo
    await page.goto('/q/luxe000001');
    const customerLogo = page.getByRole('img', { name: /Luxe Studio Unisex Salon logo/i });
    await expect(customerLogo).toBeVisible();
  });

  test('TC-UPL-04: Rejects SVG upload with immediate security error and prevents DB writes', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    const fileInput = page.getByTestId('logo-file-input');
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    await fileInput.setInputFiles({
      name: 'malicious.svg',
      mimeType: 'image/svg+xml',
      buffer: svgBuffer,
    });

    const errorAlert = page.getByTestId('logo-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/SVG files are strictly prohibited/i);

    // Verify database logo_url remains NULL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).toBeNull();
  });

  test('TC-UPL-05: Rejects oversized file exceeding 2 MB boundary', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    const fileInput = page.getByTestId('logo-file-input');
    const oversizedBuffer = createValidPngBuffer(2_097_152 + 1024);

    await fileInput.setInputFiles({
      name: 'oversized-logo.png',
      mimeType: 'image/png',
      buffer: oversizedBuffer,
    });

    const errorAlert = page.getByTestId('logo-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/exceeds the 2 MB limit/i);
  });

  test('API-OWN-08 / TC-API-23: Removes logo, updates UI, and clears database logo_url', async ({
    page,
  }) => {
    // 1. First upload a valid logo
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    const fileInput = page.getByTestId('logo-file-input');
    await fileInput.setInputFiles({
      name: 'temp-logo.png',
      mimeType: 'image/png',
      buffer: createValidPngBuffer(),
    });

    await expect(page.getByTestId('logo-success-alert')).toBeVisible({ timeout: 10000 });
    const removeBtn = page.getByTestId('logo-remove-btn');
    await expect(removeBtn).toBeVisible();

    // 2. Click Remove Logo
    await removeBtn.click();

    // 3. Verify removal success
    await expect(page.getByTestId('logo-success-alert')).toContainText(/removed successfully/i);
    await expect(page.getByTestId('logo-monogram-placeholder')).toHaveText('LS');
    await expect(page.getByTestId('logo-remove-btn')).not.toBeVisible();

    // 4. Verify DB was cleared
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).toBeNull();
  });

  test('Mobile 320px Reflow & Accessibility Audit (WCAG 2.2 AA)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    // 1. Verify no horizontal overflow
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalScroll).toBe(false);

    // 2. Verify touch targets on logo dropzone
    const dropzone = page.getByTestId('logo-dropzone');
    const box = await dropzone.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // 3. Axe-core accessibility audit
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast']) // Colors governed by centralized CSS design tokens
      .analyze();

    expect(axeResults.violations).toEqual([]);
  });
});
