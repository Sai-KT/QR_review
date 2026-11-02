import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const LOCAL_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabaseAdmin = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUSINESS_1_ID = 'b0000000-0000-4000-8000-000000000001'; // Luxe Studio (Owner 1)
const BUSINESS_2_ID = 'b0000000-0000-4000-8000-000000000002'; // Daily Roast (Owner 2)

/**
 * M5-T03: Merchant Business Profile & Settings (SCR-OWN-04)
 *
 * Verifies:
 * - TC-OWN-05: Authenticated owner updates vanity slug, display name, and WhatsApp number.
 * - TC-OWN-06: Direct tampering of owner_id is strictly rejected by trigger / column permissions.
 * - TC-OWN-07: Direct tampering of public_qr_id is strictly rejected by trigger / column permissions.
 * - Cross-Tenant Isolation: Merchant A cannot modify Merchant B's business row.
 * - Unique Vanity Slug Collision: Attempting to claim an existing slug surfaces a friendly error.
 * - Pristine & Discard Changes Behavior: Reverts modified inputs to original values.
 * - 320px Mobile Reflow & WCAG 2.2 AA Accessibility Compliance.
 */

test.describe('M5-T03: Merchant Business Profile & Settings', () => {
  // Execute sequentially to prevent database state collision across parallel test workers
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test.afterEach(async () => {
    // Teardown: Restore Business 1 to clean baseline state
    await supabaseAdmin
      .from('businesses')
      .update({
        name: 'Luxe Studio Unisex Salon',
        vanity_slug: 'luxe-studio',
        whatsapp_number: '9876543210',
      })
      .eq('id', BUSINESS_1_ID);
  });

  test('TC-OWN-05: Authenticated merchant updates profile fields and synchronizes UI state', async ({
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
      page.getByRole('heading', { name: /Business Profile & Brand Settings/i }),
    ).toBeVisible();

    // Verify initial values
    const nameInput = page.getByTestId('business-name-input');
    const slugInput = page.getByTestId('vanity-slug-input');
    const phoneInput = page.getByTestId('whatsapp-input');
    const saveBtn = page.getByTestId('profile-save-btn');
    const resetBtn = page.getByTestId('profile-reset-btn');

    await expect(nameInput).toHaveValue('Luxe Studio Unisex Salon');
    await expect(slugInput).toHaveValue('luxe-studio');
    await expect(phoneInput).toHaveValue('9876543210');

    // Initially pristine, buttons disabled
    await expect(saveBtn).toBeDisabled();
    await expect(resetBtn).toBeDisabled();

    // 3. Edit fields
    await nameInput.fill('Luxe Studio & Luxury Spa');
    await slugInput.fill('luxe-luxury-spa');
    await phoneInput.fill('9876543299');

    await expect(saveBtn).toBeEnabled();
    await expect(resetBtn).toBeEnabled();

    // 4. Save Changes
    await saveBtn.click();

    // 5. Verify success alert appears
    const successAlert = page.getByTestId('profile-success-alert');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(/Business profile updated successfully/i);

    // 6. Verify PortalLayout navigation shell reflects updated business name
    const portalBusinessName = page.locator(
      '[data-testid="merchant-business-name"]:visible, [data-testid="merchant-mobile-business-name"]:visible',
    );
    await expect(portalBusinessName).toHaveText(/Luxe Studio & Luxury Spa/i);

    // 7. Reload page to verify persistence
    await page.reload();
    await expect(nameInput).toHaveValue('Luxe Studio & Luxury Spa');
    await expect(slugInput).toHaveValue('luxe-luxury-spa');
    await expect(phoneInput).toHaveValue('9876543299');

    // 8. Verify database state directly
    const { data: dbRow } = await supabaseAdmin
      .from('businesses')
      .select('name, vanity_slug, whatsapp_number')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(dbRow?.name).toBe('Luxe Studio & Luxury Spa');
    expect(dbRow?.vanity_slug).toBe('luxe-luxury-spa');
    expect(dbRow?.whatsapp_number).toBe('9876543299');
  });

  test('TC-OWN-06: Direct attempt to tamper owner_id is rejected by trigger / column permissions', async () => {
    // 1. Create client authenticated as Merchant Luxe (Owner 1)
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { error: authErr } = await client.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });
    expect(authErr).toBeNull();

    // 2. Attempt to update owner_id
    // @ts-expect-error - testing malicious payload
    const { error: updateErr } = await client
      .from('businesses')
      .update({ owner_id: '00000000-0000-4000-8000-000000000003' })
      .eq('id', BUSINESS_1_ID);

    // Must be rejected (either PostgreSQL error 42501 permission denied or P0001 trigger exception)
    expect(updateErr).not.toBeNull();

    // 3. Verify owner_id in database remains unchanged
    const { data: checkRow } = await supabaseAdmin
      .from('businesses')
      .select('owner_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(checkRow?.owner_id).toBe('00000000-0000-4000-8000-000000000002');
  });

  test('TC-OWN-07: Direct attempt to tamper public_qr_id is rejected by trigger / column permissions', async () => {
    // 1. Create client authenticated as Merchant Luxe (Owner 1)
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { error: authErr } = await client.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });
    expect(authErr).toBeNull();

    // 2. Attempt to update public_qr_id
    // @ts-expect-error - testing malicious payload
    const { error: updateErr } = await client
      .from('businesses')
      .update({ public_qr_id: 'tamper0001' })
      .eq('id', BUSINESS_1_ID);

    // Must be rejected
    expect(updateErr).not.toBeNull();

    // 3. Verify public_qr_id in database remains unchanged
    const { data: checkRow } = await supabaseAdmin
      .from('businesses')
      .select('public_qr_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(checkRow?.public_qr_id).toBe('luxe000001');
  });

  test('Cross-Tenant Isolation: Merchant A cannot modify Merchant B business record', async () => {
    // 1. Authenticate as Merchant Luxe (Owner 1)
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
    await client.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });

    // 2. Attempt to update Business 2 (Daily Roast Cafe, owned by Owner 2)
    const { data } = await client
      .from('businesses')
      .update({ name: 'Tampered Cafe Name' })
      .eq('id', BUSINESS_2_ID)
      .select();

    // RLS policy businesses_update_owner ensures USING (owner_id = auth.uid()),
    // so 0 rows are updated and returned.
    expect(data?.length ?? 0).toBe(0);

    // 3. Confirm Business 2 in DB was NOT modified
    const { data: checkRow } = await supabaseAdmin
      .from('businesses')
      .select('name')
      .eq('id', BUSINESS_2_ID)
      .single();

    expect(checkRow?.name).toBe('The Daily Roast Cafe');
  });

  test('Duplicate Vanity Slug Collision: Displays user-friendly inline error', async ({
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

    const slugInput = page.getByTestId('vanity-slug-input');
    const saveBtn = page.getByTestId('profile-save-btn');

    // 3. Enter vanity slug that belongs to Business 2 ('daily-roast')
    await slugInput.fill('daily-roast');
    await expect(saveBtn).toBeEnabled();

    // 4. Click Save Changes
    await saveBtn.click();

    // 5. Verify error alert is displayed
    const errorAlert = page.getByTestId('profile-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(
      /This vanity slug is already taken. Please choose another./i,
    );

    // 6. Verify database record was NOT changed
    const { data: checkRow } = await supabaseAdmin
      .from('businesses')
      .select('vanity_slug')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(checkRow?.vanity_slug).toBe('luxe-studio');
  });

  test('Discard Changes: Reverts modified inputs to original business values', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    const nameInput = page.getByTestId('business-name-input');
    const slugInput = page.getByTestId('vanity-slug-input');
    const resetBtn = page.getByTestId('profile-reset-btn');

    await nameInput.fill('Temporarily Modified Name');
    await slugInput.fill('temporary-slug');
    await expect(resetBtn).toBeEnabled();

    await resetBtn.click();

    await expect(nameInput).toHaveValue('Luxe Studio Unisex Salon');
    await expect(slugInput).toHaveValue('luxe-studio');
    await expect(resetBtn).toBeDisabled();
  });

  test('Mobile 320px Reflow & Accessibility Audit (WCAG 2.2 AA)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');
    await expect(
      page.getByRole('heading', { name: /Business Profile & Brand Settings/i }),
    ).toBeVisible();

    // Verify no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify touch target size of primary action button
    const saveBtn = page.getByTestId('profile-save-btn');
    const box = await saveBtn.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Run Axe-core WCAG 2.2 AA accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
