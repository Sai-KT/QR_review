import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  performSafeLocalRateLimitReset,
  isStrictLocalTestEndpoint,
  isLocalDemoServiceKey,
} from './test-isolation';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

test.describe('M3-T06: Accessible Three-Question Survey Flow & Note Editor (SCR-CUST-02..05)', () => {
  const createdSessionUuids: string[] = [];

  test.beforeAll(async () => {
    // Fail-closed local rate-limit isolation
    const resetResult = await performSafeLocalRateLimitReset();
    if (!resetResult.success && resetResult.reason?.includes('Refusing cleanup')) {
      console.warn(`[E2E Preflight] ${resetResult.reason}`);
    }
  });

  test.afterAll(async () => {
    // Clean up created survey responses and server analytics events strictly on local test db
    if (
      createdSessionUuids.length > 0 &&
      isStrictLocalTestEndpoint(LOCAL_SUPABASE_URL) &&
      isLocalDemoServiceKey(LOCAL_SERVICE_KEY)
    ) {
      try {
        const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
          auth: { persistSession: false },
        });

        await client
          .from('survey_responses')
          .delete()
          .in('session_uuid', createdSessionUuids);

        await client
          .from('analytics_events')
          .delete()
          .in('session_uuid', createdSessionUuids);
      } catch (err) {
        console.warn('[E2E Cleanup] Non-fatal error cleaning test responses:', err);
      }
    }
  });

  // ── 1. Complete Salon Survey Journey ──────────────────────────────────────
  test('completes full salon survey journey with answer preservation, back/next navigation, note editor, and submission', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('local.test') || text.includes('ERR_NAME_NOT_RESOLVED')) return;
        consoleErrors.push(text);
      }
    });

    // 1. Visit Salon Welcome Screen
    await page.goto('/q/luxe000001');
    await expect(page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' })).toBeVisible({
      timeout: 10000,
    });

    // 2. Click Start Review -> mounts SurveyFlow at ?step=1
    const startBtn = page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    await startBtn.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=1/);

    // 3. Question 1 (Salon Service)
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /How was your hair or beauty service today\?/i }),
    ).toBeVisible();

    // Verify Anti-gating direct bypass button is visible on Question 1
    const googleBypassQ1 = page.getByRole('button', {
      name: /Review Directly on Google Maps ↗/i,
    });
    await expect(googleBypassQ1).toBeVisible();

    // Next is initially disabled before selection
    const nextQ1 = page.getByRole('button', { name: /Next/i });
    await expect(nextQ1).toBeDisabled();

    // Select Option 1 (Masterful & Precise) via visible label text
    await page.getByText('Masterful & Precise').click();
    const optQ1 = page.getByRole('radio', { name: /Masterful & Precise/i });
    await expect(optQ1).toBeChecked();
    await expect(nextQ1).toBeEnabled();

    // Proceed to Question 2
    await nextQ1.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=2/);

    // 4. Question 2 (Hospitality & Cleanliness)
    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: /How was the staff hospitality and cleanliness\?/i }),
    ).toBeVisible();

    await page.getByText('Clean & hygienic station').click();
    const optQ2 = page.getByRole('radio', { name: /Clean & hygienic station/i });
    await expect(optQ2).toBeChecked();

    const nextQ2 = page.getByRole('button', { name: /Next to question 3/i });
    await nextQ2.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=3/);

    // 5. Question 3 (Standout Highlights)
    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: /What stood out most about your visit\?/i }),
    ).toBeVisible();

    await page.getByText('Great styling advice').click();
    const optQ3 = page.getByRole('radio', { name: /Great styling advice/i });
    await expect(optQ3).toBeChecked();

    // 6. Test Back navigation & answer preservation
    const backToQ2 = page.getByRole('button', { name: /Back to question 2/i });
    await backToQ2.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=2/);
    await expect(optQ2).toBeChecked();

    // Change answer on Question 2
    await page.getByText('Warm & Attentive team').click();
    const altOptQ2 = page.getByRole('radio', { name: /Warm & Attentive team/i });
    await expect(altOptQ2).toBeChecked();

    // Forward to Question 3 -> answer still preserved
    await page.getByRole('button', { name: /Next to question 3/i }).click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=3/);
    await expect(optQ3).toBeChecked();

    // Forward to Note Editor
    const nextToNotes = page.getByRole('button', { name: /Next, optional note/i });
    await nextToNotes.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=notes/);

    // 7. SCR-CUST-05: Note Editor
    await expect(page.getByRole('heading', { name: /Add an Optional Note/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(
      page.getByText(/Notes are stored pseudonymously and automatically deleted after 30 days/i),
    ).toBeVisible();

    // Live character counter check
    await expect(page.getByText('0 / 150')).toBeVisible();

    const noteTextarea = page.getByRole('textbox', {
      name: /Personal Note \(Optional, max 150 characters\)/i,
    });
    await noteTextarea.fill('Loved the styling and warm hospitality from the entire team!');
    await expect(page.getByText('60 / 150')).toBeVisible();

    // Universal bypass button on Note Editor
    await expect(
      page.getByRole('button', { name: /Review Directly on Google Maps ↗/i }),
    ).toBeVisible();

    // 8. Submit Feedback
    const submitBtn = page.getByRole('button', { name: /Submit feedback/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 9. Submission Confirmation State
    await expect(page.getByText('Feedback Received!')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/Your responses have been recorded securely/i),
    ).toBeVisible();

    // Direct Google Maps action on confirmation
    await expect(
      page.getByRole('button', { name: /Review Directly on Google Maps ↗/i }),
    ).toBeVisible();

    // Extract session UUID from sessionStorage for test database cleanup
    const sessionUuid = await page.evaluate(() => {
      return sessionStorage.getItem('qr_customer_session_id');
    });
    if (sessionUuid) {
      createdSessionUuids.push(sessionUuid);
    }

    expect(consoleErrors).toEqual([]);
  });

  // ── 2. Cafe Survey Journey with Empty Note ────────────────────────────────
  test('completes cafe survey flow with cafe-specific questions and empty optional note', async ({
    page,
  }) => {
    await page.goto('/q/daily00001');
    await expect(page.getByRole('heading', { name: 'The Daily Roast Cafe' })).toBeVisible({
      timeout: 10000,
    });

    // Start Survey
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    // Verify Cafe Question 1
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /What did you enjoy most at our cafe\?/i }),
    ).toBeVisible();

    await page.getByText('Specialty coffee & espresso').click();
    await page.getByRole('button', { name: /Next to question 2/i }).click();

    // Cafe Question 2
    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: /How was our staff service and preparation time\?/i }),
    ).toBeVisible();

    await page.getByText('Super prompt & courteous staff').click();
    await page.getByRole('button', { name: /Next to question 3/i }).click();

    // Cafe Question 3
    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: /How was the seating comfort and cafe vibe\?/i }),
    ).toBeVisible();

    await page.getByText('Cozy atmosphere & good music').click();
    await page.getByRole('button', { name: /Next, optional note/i }).click();

    // Note Editor (submit empty note)
    await expect(page.getByRole('heading', { name: /Add an Optional Note/i })).toBeVisible({
      timeout: 5000,
    });
    const submitBtn = page.getByRole('button', { name: /Submit feedback/i });
    await submitBtn.click();

    // Verify confirmation
    await expect(page.getByText('Feedback Received!')).toBeVisible({ timeout: 10000 });

    const sessionUuid = await page.evaluate(() => {
      return sessionStorage.getItem('qr_customer_session_id');
    });
    if (sessionUuid) {
      createdSessionUuids.push(sessionUuid);
    }
  });

  // ── 3. WCAG 2.2 AA Accessibility Audits ──────────────────────────────────
  test('satisfies axe-core WCAG 2.2 AA accessibility requirements on question card and note editor', async ({
    page,
  }) => {
    await page.goto('/q/luxe000001?step=1');
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });

    // Audit Question Card
    const questionAudit = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(questionAudit.violations).toEqual([]);

    // Select options to advance to Note Editor
    await page.getByText('Masterful & Precise').click();
    await page.getByRole('button', { name: /Next to question 2/i }).click();

    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 5000 });
    await page.getByText('Clean & hygienic station').click();
    await page.getByRole('button', { name: /Next to question 3/i }).click();

    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 5000 });
    await page.getByText('Great styling advice').click();
    await page.getByRole('button', { name: /Next, optional note/i }).click();

    // Audit Note Editor
    await expect(page.getByRole('heading', { name: /Add an Optional Note/i })).toBeVisible({
      timeout: 5000,
    });

    const noteAudit = await new AxeBuilder({ page })
      .include('#root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    expect(noteAudit.violations).toEqual([]);
  });

  // ── 4. Viewport Reflow & Touch Target Sizing (320px) ──────────────────────
  test('verifies 320px viewport reflow and touch target sizing (>= 44px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/q/luxe000001?step=1');

    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });

    // Verify option label touch target height is at least 44px
    const optionLabel = page.locator('label').filter({ hasText: /Masterful & Precise/i });
    const box = await optionLabel.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Verify next button touch target is at least 44px
    const nextBtn = page.getByRole('button', { name: /Next/i });
    const nextBox = await nextBtn.boundingBox();
    expect(nextBox).not.toBeNull();
    if (nextBox) {
      expect(nextBox.height).toBeGreaterThanOrEqual(44);
    }

    // Verify no horizontal overflow at 320px width
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(320);
  });
});
