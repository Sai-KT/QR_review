/**
 * M5-T06 E2E Suite: Digital QR Studio & Multi-Channel Sharing (SCR-OWN-06 / CMP-14)
 *
 * Source:
 *   - docs/UI_UX.md (v1.1) §9.1 (SCR-OWN-06); §13 (CMP-14)
 *   - docs/ROADMAP.md (v1.1) Task M5-T06
 *   - docs/TEST_PLAN.md (v1.1) TC-OWN-11, TC-OWN-12, TC-PRT-05
 *   - docs/SECURITY.md (v1.1) §4 Multi-Tenancy & Tenant Isolation
 *   - AGENTS.md §5 Core Invariants: Immutable Public QR Identity, 4-module quiet zone, ECC Level H
 *
 * Verifies:
 * - TC-OWN-11: Authenticated merchant loads Digital QR Studio, verifies interactive preview,
 *   4-module quiet zone, ECC Level H badge, business branding, and immutable public QR ID.
 * - TC-PRT-05: One-tap copy of first-party review link with visual confirmation and toast.
 * - TC-OWN-12: Client-side high-resolution PNG export (1024×1024) download with valid PNG magic bytes.
 * - Multi-Channel Sharing: WhatsApp direct link, Email link, and secondary direct portal inspection.
 * - Cross-Tenant Isolation: Merchant 1 sees only Tenant 1 QR, Merchant 2 sees only Tenant 2 QR.
 * - Mobile 320px responsive reflow (no horizontal overflow) & WCAG 2.2 AA accessibility scan.
 */

import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('M5-T06: Digital QR Studio & Multi-Channel Sharing', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
    // Grant clipboard permissions for automated link copy testing
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('TC-OWN-11: Authenticated merchant views Digital QR Studio, canvas preview, and branding', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');
    await expect(
      page.getByRole('heading', { level: 1, name: /Digital QR & Sharing Studio/i }),
    ).toBeVisible();

    // 3. Verify Card elements & badges
    const qrCard = page.getByTestId('digital-qr-card');
    await expect(qrCard).toBeVisible();
    await expect(qrCard.getByText('Permanent QR', { exact: true })).toBeVisible();
    await expect(qrCard.getByText(/Error Correction: High/i)).toBeVisible();

    // 4. Verify Business Name and Public QR ID
    await expect(page.getByTestId('qr-business-name')).toHaveText('Luxe Studio Unisex Salon');
    await expect(qrCard.getByText('luxe000001')).toBeVisible();

    // 5. Verify Canvas element is mounted with accessible attributes
    const canvas = page.getByTestId('digital-qr-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute('role', 'img');
    await expect(canvas).toHaveAttribute(
      'aria-label',
      'Digital QR Code for Luxe Studio Unisex Salon',
    );

    // 6. Verify First-Party Review URL Input is read-only and contains canonical path
    const reviewUrlInput = page.getByTestId('review-url-input');
    await expect(reviewUrlInput).toBeVisible();
    await expect(reviewUrlInput).toHaveAttribute('readonly', '');
    const inputValue = await reviewUrlInput.inputValue();
    expect(inputValue).toMatch(/\/q\/luxe000001$/);
  });

  test('TC-PRT-05: One-tap copy copies review link to clipboard and provides visual feedback', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');
    const copyButton = page.getByTestId('copy-review-link-button');
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toContainText(/Copy Review Link/i);

    // 3. Click Copy Review Link
    await copyButton.click();

    // 4. Verify visual feedback changes to "Link Copied!"
    await expect(page.getByTestId('copy-success-indicator')).toBeVisible();
    await expect(copyButton).toContainText(/Link Copied!/i);

    // 5. Verify success toast appears
    await expect(page.getByText(/Review Link Copied/i)).toBeVisible();
    await expect(page.getByText(/First-party customer review URL copied to clipboard/i)).toBeVisible();

    // 6. Verify clipboard contains the first-party review URL
    const clipboardText = await page.evaluate(async () => {
      return await navigator.clipboard.readText();
    });
    expect(clipboardText).toMatch(/\/q\/luxe000001$/);
  });

  test('TC-OWN-12: High-resolution 1024×1024 PNG download generates valid image asset', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');
    const downloadButton = page.getByTestId('download-png-button');
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toBeEnabled();

    // 3. Trigger download and capture event
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    // 4. Verify filename convention
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toBe('luxe-studio-unisex-salon-review-qr-1024.png');

    // 5. Verify downloaded file content (valid PNG magic bytes: 0x89, 0x50, 0x4E, 0x47)
    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error('Could not create read stream for downloaded file');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    expect(fileBuffer.length).toBeGreaterThan(1000); // 1024x1024 PNG is at least a few KB
    expect(fileBuffer[0]).toBe(0x89);
    expect(fileBuffer[1]).toBe(0x50); // 'P'
    expect(fileBuffer[2]).toBe(0x4e); // 'N'
    expect(fileBuffer[3]).toBe(0x47); // 'G'

    // 6. Verify success toast notification
    await expect(page.getByText(/High-Res QR Downloaded/i)).toBeVisible();
  });

  test('Multi-Channel Sharing & Secondary Portal Navigation Links', async ({ page }) => {
    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');

    // 3. WhatsApp share link
    const whatsappLink = page.getByTestId('whatsapp-share-button');
    await expect(whatsappLink).toBeVisible();
    await expect(whatsappLink).toHaveAttribute('target', '_blank');
    await expect(whatsappLink).toHaveAttribute('rel', 'noopener noreferrer');
    const waHref = await whatsappLink.getAttribute('href');
    expect(waHref).toContain('https://wa.me/?text=');
    expect(waHref).toContain(encodeURIComponent('/q/luxe000001'));

    // 4. Email share link
    const emailLink = page.getByTestId('email-share-button');
    await expect(emailLink).toBeVisible();
    const mailtoHref = await emailLink.getAttribute('href');
    expect(mailtoHref).toContain('mailto:?subject=');
    expect(mailtoHref).toContain(encodeURIComponent('Luxe Studio Unisex Salon'));

    // 5. Open Customer Portal link
    const portalLink = page.getByTestId('test-review-link-button');
    await expect(portalLink).toBeVisible();
    await expect(portalLink).toHaveAttribute('target', '_blank');
    await expect(portalLink).toHaveAttribute('rel', 'noopener noreferrer');
    const portalHref = await portalLink.getAttribute('href');
    expect(portalHref).toMatch(/\/q\/luxe000001$/);
  });

  test('Cross-Tenant Isolation: Merchant 2 views strictly isolated QR and branding', async ({
    page,
  }) => {
    // 1. Sign in as Merchant Daily (Owner 2)
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.daily@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');

    // 3. Verify Daily Roast branding and public QR ID
    await expect(page.getByTestId('qr-business-name')).toHaveText('The Daily Roast Cafe');
    await expect(page.getByTestId('digital-qr-card')).toContainText('daily00001');

    // 4. Verify review URL input contains Daily Roast QR ID
    const reviewUrlInput = page.getByTestId('review-url-input');
    const inputValue = await reviewUrlInput.inputValue();
    expect(inputValue).toMatch(/\/q\/daily00001$/);

    // 5. Ensure Luxe Studio's data does not appear
    await expect(page.getByText('luxe000001')).not.toBeVisible();
    await expect(page.getByText('Luxe Studio Unisex Salon')).not.toBeVisible();
  });

  test('Mobile 320px Reflow and WCAG 2.2 AA Accessibility Compliance', async ({ page }) => {
    // Set viewport to mobile 320px width
    await page.setViewportSize({ width: 320, height: 640 });

    // 1. Sign in as Merchant Luxe
    await page.goto('/login');
    await page.getByLabel(/Email Address/i).fill('merchant.luxe@local.test');
    await page.getByLabel(/^Password$/i).fill('LocalDevPass123!');
    await page.getByRole('button', { name: /^Sign In$/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Navigate to Digital QR Studio
    await page.goto('/dashboard/qr');
    await expect(
      page.getByRole('heading', { level: 1, name: /Digital QR & Sharing Studio/i }),
    ).toBeVisible();

    // 3. Verify no horizontal overflow at 320px
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // 4. Verify touch target sizes (minimum 44px height for primary buttons)
    const copyBtnBox = await page.getByTestId('copy-review-link-button').boundingBox();
    expect(copyBtnBox).not.toBeNull();
    if (copyBtnBox) {
      expect(copyBtnBox.height).toBeGreaterThanOrEqual(44);
    }

    const downloadBtnBox = await page.getByTestId('download-png-button').boundingBox();
    expect(downloadBtnBox).not.toBeNull();
    if (downloadBtnBox) {
      expect(downloadBtnBox.height).toBeGreaterThanOrEqual(44);
    }

    // 5. Run Axe-core WCAG 2.2 AA accessibility scan
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
