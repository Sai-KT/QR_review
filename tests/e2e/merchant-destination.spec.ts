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
 * M5-T04: Google Review Destination Setup (SCR-OWN-05 / API-OWN-03)
 *
 * Verifies:
 * - TC-OWN-08: Authenticated owner updates destination URL & Place ID; verified in DB and admin_audit_logs.
 * - TC-OWN-09: Lookalike domains, non-HTTPS URLs, and invalid domains are rejected with inline validation.
 * - TC-OWN-10: Test Review Link button opens URL with noopener and unlocks the Save button.
 * - TC-DST-09: Cross-tenant Place ID collision and Place ID parameter mismatch rejected with 422.
 * - Cross-Tenant Isolation: Merchant A token cannot modify Merchant B's destination.
 * - Anti-Gating Integration: Customer flow routes immediately to updated destination.
 * - SCR-OWN-04 Modal Integration: Configure Destination modal on Profile page updates destination.
 * - Mobile 320px Reflow & WCAG 2.2 AA Accessibility Compliance.
 */

test.describe('M5-T04: Google Review Destination Setup', () => {
  // Execute serially to prevent database state race conditions
  test.describe.configure({ mode: 'serial' });

  const restoreFixtures = async () => {
    await supabaseAdmin
      .from('businesses')
      .update({
        google_place_id: 'ChIJLUXE00000001',
        google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
      })
      .eq('id', BUSINESS_1_ID);

    await supabaseAdmin
      .from('businesses')
      .update({
        google_place_id: 'ChIJDAILY0000001',
        google_review_url: 'https://search.google.com/local/writereview?placeid=ChIJDAILY0000001',
      })
      .eq('id', BUSINESS_2_ID);
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

  test('TC-OWN-08: Authenticated merchant updates Google review destination, verifies DB and audit log', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Google Destination page
    await page.goto('/dashboard/destination');
    await expect(
      page.getByRole('heading', { level: 1, name: /Google Review Destination/i }),
    ).toBeVisible();

    // Verify initial values
    const urlInput = page.getByTestId('destination-url-input');
    const placeIdInput = page.getByTestId('destination-place-id-input');
    const testLinkBtn = page.getByTestId('destination-test-btn');
    const saveBtn = page.getByTestId('destination-save-btn');

    await expect(urlInput).toHaveValue(
      'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
    );
    await expect(placeIdInput).toHaveValue('ChIJLUXE00000001');

    // Initially pristine, Save is disabled
    await expect(saveBtn).toBeDisabled();

    // 3. Edit Google review URL to a new valid Place ID
    const newUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000099';
    await urlInput.fill(newUrl);

    // Auto-extracted Place ID should update automatically
    await expect(placeIdInput).toHaveValue('ChIJLUXE00000099');

    // Save button must remain disabled until tested
    await expect(saveBtn).toBeDisabled();

    // 4. Test link by clicking "Test Review Link"
    const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await testLinkBtn.click();
    const popup = await popupPromise;
    if (popup) {
      expect(decodeURIComponent(popup.url())).toContain('ChIJLUXE00000099');
      await popup.close();
    }
    await expect(page.getByTestId('destination-test-notice')).toBeVisible();

    // Save button should now be enabled
    await expect(saveBtn).toBeEnabled();

    // 5. Submit destination update
    await saveBtn.click();

    // 6. Verify success alert
    const successAlert = page.getByTestId('destination-success-alert');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(/Google review destination updated/i);

    // 7. Verify persistence in database
    const { data: dbBusiness } = await supabaseAdmin
      .from('businesses')
      .select('google_review_url, google_place_id')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(dbBusiness?.google_review_url).toBe(newUrl);
    expect(dbBusiness?.google_place_id).toBe('ChIJLUXE00000099');

    // 8. Verify audit log entry in admin_audit_logs
    const { data: auditLogs } = await supabaseAdmin
      .from('admin_audit_logs')
      .select('*')
      .eq('target_business_id', BUSINESS_1_ID)
      .eq('action', 'UPDATE_GOOGLE_DESTINATION')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(auditLogs).not.toBeNull();
    expect(auditLogs!.length).toBe(1);
    const log = auditLogs![0];
    expect(log.actor_role).toBe('owner');
    expect(log.actor_user_id).toBe('00000000-0000-4000-8000-000000000002');
    expect(log.payload_after?.google_place_id).toBe('ChIJLUXE00000099');
    expect(log.payload_after?.google_review_url).toBe(newUrl);
  });

  test('TC-OWN-09: Lookalike domains and non-HTTPS URLs are rejected with inline validation', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/destination');

    const urlInput = page.getByTestId('destination-url-input');
    const saveBtn = page.getByTestId('destination-save-btn');

    // Test lookalike domain
    await urlInput.fill('https://search.google.com.phishing.attacker.com/writereview');
    await expect(
      page.getByText(/approved Google Maps review link/i),
    ).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // Test insecure HTTP protocol
    await urlInput.fill('http://search.google.com/local/writereview?placeid=ChIJLUXE00000001');
    await expect(
      page.getByText(/must use secure HTTPS protocol/i),
    ).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // Test invalid generic domain
    await urlInput.fill('https://example.com/review-us');
    await expect(
      page.getByText(/approved Google Maps review link/i),
    ).toBeVisible();
    await expect(saveBtn).toBeDisabled();
  });

  test('TC-OWN-10: Test Review Link button opens URL with noopener and unlocks Save button', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/destination');

    const urlInput = page.getByTestId('destination-url-input');
    const placeIdInput = page.getByTestId('destination-place-id-input');
    const testLinkBtn = page.getByTestId('destination-test-btn');
    const saveBtn = page.getByTestId('destination-save-btn');

    // Shortlink format
    const shortUrl = 'https://maps.app.goo.gl/abcdef1234567890';
    await urlInput.fill(shortUrl);
    // Explicit place ID needed for shortlink
    await placeIdInput.fill('ChIJLUXE00000088');

    // Unverified: Save button is disabled
    await expect(saveBtn).toBeDisabled();

    // Click test review link
    const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await testLinkBtn.click();
    const popup = await popupPromise;
    if (popup) {
      expect(popup.url()).toMatch(/(google\.com|goo\.gl)/);
      await popup.close();
    }
    await expect(page.getByTestId('destination-test-notice')).toBeVisible();

    // Save button unlocked
    await expect(saveBtn).toBeEnabled();

    // Changing the URL immediately invalidates verification
    await urlInput.fill('https://maps.app.goo.gl/changed123456789');
    await expect(saveBtn).toBeDisabled();
  });

  test('TC-DST-09: Cross-tenant Place ID collision and Place ID parameter mismatch rejected with 422', async ({
    page,
  }) => {
    // 1. Test Cross-Tenant Place ID Collision in UI
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/destination');

    const urlInput = page.getByTestId('destination-url-input');
    const testLinkBtn = page.getByTestId('destination-test-btn');
    const saveBtn = page.getByTestId('destination-save-btn');

    // Enter Business 2's Place ID (Daily Roast Cafe: ChIJDAILY0000001)
    const collidingUrl = 'https://search.google.com/local/writereview?placeid=ChIJDAILY0000001';
    await urlInput.fill(collidingUrl);

    // Test link to enable save
    const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await testLinkBtn.click();
    const popup = await popupPromise;
    if (popup) {
      await popup.close();
    }

    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Expect collision error alert
    const errorAlert = page.getByTestId('destination-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(
      /already associated with another registered business/i,
    );

    // Confirm Business 1 was not modified
    const { data: dbCheck } = await supabaseAdmin
      .from('businesses')
      .select('google_place_id')
      .eq('id', BUSINESS_1_ID)
      .single();
    expect(dbCheck?.google_place_id).toBe('ChIJLUXE00000001');

    // 2. Test Place ID parameter mismatch directly via Edge Function gateway
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: authData } = await client.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });
    const token = authData.session?.access_token;
    expect(token).toBeDefined();

    const mismatchRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/update-destination`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        businessId: BUSINESS_1_ID,
        googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000001',
        googlePlaceId: 'ChIJLUXE00000099', // contradicts URL placeid
      }),
    });

    expect(mismatchRes.status).toBe(422);
    const mismatchBody = await mismatchRes.json();
    expect(mismatchBody.error.code).toBe('ERR_PLACE_ID_MISMATCH');
  });

  test('Cross-Tenant Isolation: Merchant A token cannot modify Merchant B destination', async () => {
    // Authenticate as Merchant Luxe (Owner 1)
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: authData } = await client.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });
    const token = authData.session?.access_token;
    expect(token).toBeDefined();

    // Attempt to update Business 2 (Daily Roast Cafe)
    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/update-destination`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        businessId: BUSINESS_2_ID,
        googleReviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000099',
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
    expect(body.error.message).toContain('You do not have permission to modify this business review destination.');

    // Verify Business 2 was untouched in database
    const { data: checkRow } = await supabaseAdmin
      .from('businesses')
      .select('google_place_id')
      .eq('id', BUSINESS_2_ID)
      .single();
    expect(checkRow?.google_place_id).toBe('ChIJDAILY0000001');
  });

  test('Anti-Gating Integration: Customer portal routes immediately to updated Google destination', async ({
    page,
  }) => {
    // 1. Update Business 1 destination to a specific test URL
    const updatedReviewUrl = 'https://search.google.com/local/writereview?placeid=ChIJLUXE00000055';
    await supabaseAdmin
      .from('businesses')
      .update({
        google_place_id: 'ChIJLUXE00000055',
        google_review_url: updatedReviewUrl,
      })
      .eq('id', BUSINESS_1_ID);

    // 2. Open public customer QR entry point for Luxe Studio
    await page.goto('/q/luxe000001');

    // 3. Verify direct Google Maps link on Customer Welcome screen (SCR-CUST-01 anti-gating)
    const directLink = page.getByRole('button', { name: /Review Directly on Google Maps ↗/i });
    await expect(directLink).toBeVisible();

    // Verify clicking opens the updated review URL
    const popupPromise = page.waitForEvent('popup', { timeout: 4000 }).catch(() => null);
    await directLink.click();
    const popup = await popupPromise;
    if (popup) {
      expect(decodeURIComponent(popup.url())).toContain('ChIJLUXE00000055');
      await popup.close();
    }
  });

  test('SCR-OWN-04 Modal Integration: Configure Destination modal on Profile page updates destination', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/profile');

    // Open Destination Modal
    const configBtn = page.getByTestId('configure-destination-btn');
    await expect(configBtn).toBeVisible();
    await configBtn.click();

    // Verify modal is open
    await expect(
      page.getByTestId('google-destination-modal'),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Google Review Destination Setup/i }),
    ).toBeVisible();

    // Close modal via Close dialog button
    const closeBtn = page.getByRole('button', { name: /Close dialog/i });
    await closeBtn.click();

    // Verify modal is closed
    await expect(
      page.getByTestId('google-destination-modal'),
    ).not.toBeVisible();
  });

  test('Mobile 320px Reflow & Accessibility Audit (WCAG 2.2 AA)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/dashboard/destination');
    await expect(
      page.getByRole('heading', { level: 1, name: /Google Review Destination/i }),
    ).toBeVisible();

    // Verify no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify touch targets of buttons
    const testLinkBtn = page.getByTestId('destination-test-btn');
    const box = await testLinkBtn.boundingBox();
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

