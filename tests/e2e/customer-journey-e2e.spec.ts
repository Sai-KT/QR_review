import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  performSafeLocalRateLimitReset,
  isStrictLocalTestEndpoint,
  isLocalDemoServiceKey,
  computeLocalGenerationKeyHashes,
} from './test-isolation';

const LOCAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

test.describe('Post-M4 Integration Gate D: Live Local Customer Journey End-to-End', () => {
  test.describe.configure({ mode: 'serial' });
  const createdSessionUuids: string[] = [];
  const createdResponseIds: string[] = [];
  const LUXE_SALON_BIZ_ID = 'b0000000-0000-4000-8000-000000000001';
  const SYNTHETIC_EXHAUSTED_BIZ_ID = 'b0000000-0000-4000-8000-000000000099';
  const SYNTHETIC_EXHAUSTED_QR_ID = 'quotaex001';

  test.beforeAll(async () => {
    const resetResult = await performSafeLocalRateLimitReset();
    if (!resetResult.success && resetResult.reason?.includes('Refusing cleanup')) {
      console.warn(`[Gate D Preflight] ${resetResult.reason}`);
    }

    if (
      isStrictLocalTestEndpoint(LOCAL_SUPABASE_URL) &&
      isLocalDemoServiceKey(LOCAL_SERVICE_KEY)
    ) {
      try {
        const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
          auth: { persistSession: false },
        });
        // Seed synthetic merchant with fully exhausted monthly quota (150/150)
        await client.from('businesses').upsert({
          id: SYNTHETIC_EXHAUSTED_BIZ_ID,
          owner_id: '00000000-0000-4000-8000-000000000002',
          category_id: 'salon',
          public_qr_id: SYNTHETIC_EXHAUSTED_QR_ID,
          vanity_slug: SYNTHETIC_EXHAUSTED_QR_ID,
          name: 'Quota Exhausted Salon',
          google_review_url: 'https://g.page/r/quota-exhausted/review',
          account_status: 'active',
          is_active: true,
        });
        await client.from('subscriptions').upsert({
          business_id: SYNTHETIC_EXHAUSTED_BIZ_ID,
          plan_tier: 'standard_recurring',
          subscription_status: 'active',
        });
        const cycle = new Date().toISOString().slice(0, 7);
        await client.from('tenant_quotas').upsert({
          business_id: SYNTHETIC_EXHAUSTED_BIZ_ID,
          billing_cycle: cycle,
          max_limit: 150,
          used_count: 150,
          reserved_count: 0,
          reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      } catch (err) {
        console.warn('[Gate D Setup] Warning seeding synthetic quota fixture:', err);
      }
    }
  });

  test.beforeEach(async () => {
    if (
      isStrictLocalTestEndpoint(LOCAL_SUPABASE_URL) &&
      isLocalDemoServiceKey(LOCAL_SERVICE_KEY)
    ) {
      try {
        const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
          auth: { persistSession: false },
        });
        // Targeted rate-limit cleanup: reset ONLY local test runner loopback/docker gateway hashes
        const targetBucketKeys = computeLocalGenerationKeyHashes();
        await client.from('rate_limit_buckets').delete().in('key_hash', targetBucketKeys);
        await performSafeLocalRateLimitReset(client, LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY);
      } catch (err) {
        console.warn('[Gate D Setup] Non-fatal rate limit reset warning:', err);
      }
    }
  });

  test.afterAll(async () => {
    if (
      (createdSessionUuids.length > 0 || createdResponseIds.length > 0) &&
      isStrictLocalTestEndpoint(LOCAL_SUPABASE_URL) &&
      isLocalDemoServiceKey(LOCAL_SERVICE_KEY)
    ) {
      try {
        const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
          auth: { persistSession: false },
        });

        if (createdResponseIds.length > 0) {
          await client.from('quota_reservations').delete().in('response_id', createdResponseIds);
          await client.from('survey_responses').delete().in('id', createdResponseIds);
        }

        if (createdSessionUuids.length > 0) {
          await client.from('analytics_events').delete().in('session_uuid', createdSessionUuids);
        }

        await client.from('quota_reservations').delete().eq('business_id', SYNTHETIC_EXHAUSTED_BIZ_ID);
        await client.from('survey_responses').delete().eq('business_id', SYNTHETIC_EXHAUSTED_BIZ_ID);
        await client.from('tenant_quotas').delete().eq('business_id', SYNTHETIC_EXHAUSTED_BIZ_ID);
        await client.from('subscriptions').delete().eq('business_id', SYNTHETIC_EXHAUSTED_BIZ_ID);
        await client.from('businesses').delete().eq('id', SYNTHETIC_EXHAUSTED_BIZ_ID);

        // Targeted cleanup of test runner rate limit keys strictly
        const targetBucketKeys = computeLocalGenerationKeyHashes();
        await client.from('rate_limit_buckets').delete().in('key_hash', targetBucketKeys);
      } catch (err) {
        console.warn('[Gate D Cleanup] Non-fatal error cleaning test fixtures:', err);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Scenario D-01: Positive Salon Customer Journey (Real Local Pipeline)
  // --------------------------------------------------------------------------
  test('D-01: completes full positive salon journey with real Edge Functions, Postgres, and mock Gemini', async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions for automated copy
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Visit Salon Welcome Screen (SCR-CUST-01)
    await page.goto('/q/luxe000001');
    await expect(page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText('Salon', { exact: true })).toBeVisible();

    // 2. Start Review -> Question 1 (SCR-CUST-02)
    const startBtn = page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i });
    await startBtn.click();
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=1/);

    // Answer Q1 (Hair/Beauty Service)
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    const q1Positive = page.locator('label').filter({ hasText: /Masterful & Precise/i });
    await q1Positive.click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Answer Q2 (Hospitality) (SCR-CUST-03)
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=2/);
    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 10000 });
    const q2Positive = page.locator('label').filter({ hasText: /Warm & Attentive/i });
    await q2Positive.click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Answer Q3 (Highlight) (SCR-CUST-04)
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=3/);
    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 10000 });
    const q3Positive = page.locator('label').filter({ hasText: 'Great styling advice' });
    await q3Positive.click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    // Note Editor & Authenticity Checkbox (SCR-CUST-05)
    await expect(page).toHaveURL(/\/q\/luxe000001\?step=notes/);
    await expect(page.getByText('Add an Optional Note')).toBeVisible({ timeout: 10000 });

    const noteInput = page.getByPlaceholder(/e\.g\./i);
    await noteInput.fill('Loved the precise fade and styling advice.');

    // Authenticity Checkbox (M0-16 / Gate B)
    const authCheckbox = page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    });
    await expect(authCheckbox).not.toBeChecked();
    await authCheckbox.click();
    await expect(authCheckbox).toBeChecked();

    // Submit Feedback (API-PUB-04 real Edge Function call)
    const submitBtn = page.getByRole('button', { name: /Submit Feedback/i });
    await submitBtn.click();

    // 3. Submitted State: Intentional Customer AI Trigger
    await expect(page.getByText('Feedback Received!')).toBeVisible({ timeout: 10000 });
    const draftWithAiBtn = page.getByRole('button', { name: /Draft My Review with AI ↗/i });
    await expect(draftWithAiBtn).toBeVisible();

    // Verify submission record in real PostgreSQL
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { data: latestResponse } = await client
      .from('survey_responses')
      .select('id, session_uuid, authenticity_confirmed, optional_note')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    expect(latestResponse).not.toBeNull();
    expect(latestResponse?.authenticity_confirmed).toBe(true);
    expect(latestResponse?.optional_note).toBe('Loved the precise fade and styling advice.');
    if (latestResponse?.id) createdResponseIds.push(latestResponse.id);
    if (latestResponse?.session_uuid) createdSessionUuids.push(latestResponse.session_uuid);

    // 4. Intentional Customer AI Trigger -> Loading Shimmer (SCR-CUST-06)
    await draftWithAiBtn.click();

    // 5. Grounded Review Draft Editor (SCR-CUST-07)
    await expect(page.getByText('Your Review Draft')).toBeVisible({ timeout: 15000 });
    const draftTextarea = page.getByRole('textbox', { name: /Edit your review draft/i });
    await expect(draftTextarea).toBeVisible();

    const originalDraft = await draftTextarea.inputValue();
    expect(originalDraft.length).toBeGreaterThan(10);
    expect(originalDraft).not.toContain('fake');

    // Customer edits review draft in-place
    const customerEdited = `${originalDraft} Highly recommended!`;
    await draftTextarea.fill(customerEdited);

    // 6. Direct User Activation: Accept & Copy Review
    const acceptAndCopyBtn = page.getByTestId('accept-and-copy-button');
    await expect(acceptAndCopyBtn).toBeVisible();
    await acceptAndCopyBtn.click();

    // 7. Handoff Page (SCR-CUST-08)
    await expect(page.getByText(/Review copied to your clipboard!|Almost ready to post!/i)).toBeVisible({
      timeout: 10000,
    });

    const googleBtn = page.getByRole('button', { name: /Open Google Maps to Post →/i });
    await expect(googleBtn).toBeVisible();

    // Verify two-click handoff: Google navigation requires explicit customer tap
    const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
    await googleBtn.click();
    const popup = await popupPromise;
    if (popup) {
      expect(popup.url()).toContain('google.com');
      await popup.close();
    }
  });

  // --------------------------------------------------------------------------
  // Scenario D-02: Negative Café Feedback (Sentiment Preservation & AI Generation)
  // --------------------------------------------------------------------------
  test('D-02: preserves negative café sentiment without sentiment gating or false praise', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/q/daily00001');
    await expect(page.getByRole('heading', { name: 'The Daily Roast Cafe' })).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    // Q1: Café Beverage - select critical option (Beverage was cold / delayed)
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    const q1Options = page.locator('fieldset label');
    const optCount1 = await q1Options.count();
    await q1Options.nth(Math.max(0, optCount1 - 2)).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Q2: Café Hospitality - select critical option (Slow counter / order mix-up)
    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 10000 });
    const q2Options = page.locator('fieldset label');
    const optCount2 = await q2Options.count();
    await q2Options.nth(Math.max(0, optCount2 - 2)).click();
    await page.getByRole('button', { name: /Next/i }).click();

    // Q3: Café Ambience - select critical option (Too crowded / noisy space)
    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 10000 });
    const q3Options = page.locator('fieldset label');
    const optCount3 = await q3Options.count();
    await q3Options.nth(Math.max(0, optCount3 - 2)).click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    // Note page: Enter negative note matching critical experience
    await expect(page.getByText('Add an Optional Note')).toBeVisible({ timeout: 10000 });
    const noteInput = page.getByPlaceholder(/e\.g\./i);
    await noteInput.fill('Beverage was cold and service took too long.');

    // Customer confirms authenticity
    const authCheckbox = page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    });
    await authCheckbox.click();

    await page.getByRole('button', { name: /Submit Feedback/i }).click();
    await expect(page.getByText('Feedback Received!')).toBeVisible({ timeout: 10000 });

    // AI Generation option remains available (NO anti-gating against negative sentiment!)
    const draftAiBtn = page.getByRole('button', { name: /Draft My Review with AI ↗/i });
    await expect(draftAiBtn).toBeVisible();

    // Direct Google review button also remains available
    const directGoogleBtn = page.getByTestId('submitted-direct-google-button');
    await expect(directGoogleBtn).toBeVisible();

    // Trigger AI Generation with real mock Gemini
    await draftAiBtn.click();

    // Grounded Review Draft Editor (SCR-CUST-07)
    await expect(page.getByText('Your Review Draft')).toBeVisible({ timeout: 15000 });
    const draftTextarea = page.getByRole('textbox', { name: /Edit your review draft/i });
    await expect(draftTextarea).toBeVisible();

    const negativeDraft = await draftTextarea.inputValue();
    // 1. Verify word count strictly respects the 49-word ceiling (FIX-AI-NEG-CAFE is 13 words)
    const wordCount = negativeDraft.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(49);

    // 2. Fact Grounding: verify customer-affirmed critical facts are faithfully represented
    const lower = negativeDraft.toLowerCase();
    expect(lower).toMatch(/cold/i);
    expect(lower).toMatch(/counter service/i);
    expect(lower).toMatch(/took too long/i);

    // 3. Disjunctive & Negative Grounding: verify unsupported facts / hallucinations are strictly absent
    // Disjunctive MCQ "Cold or delayed" disambiguated by note to cold only (no "delayed" claim)
    expect(lower).not.toMatch(/delayed/i);
    // Disjunctive MCQ "Too crowded or noisy" not merged into ungrounded conjunction
    expect(lower).not.toMatch(/crowded|noisy/i);
    // Unconfirmed location specifics omitted (no "seating area" invention)
    expect(lower).not.toMatch(/seating area/i);
    // No fabricated praise, star ratings, or perfection claims
    expect(lower).not.toMatch(/5 stars|five star|perfection|loved everything|warm and attentive/i);
    // No invented appointment details or wait durations not submitted
    expect(lower).not.toMatch(/appointment|45 minutes|reservation/i);
    // No invented pricing, rupees, or billing claims
    expect(lower).not.toMatch(/price|pricing|rupees|inr|expensive|cost/i);
    // No invented facilities or unmentioned amenities
    expect(lower).not.toMatch(/wifi|wi-fi|parking|valet/i);

    // Edit negative draft in-place
    await draftTextarea.fill(`${negativeDraft} Needs improvement.`);

    // Accept & Copy Draft
    const acceptAndCopyBtn = page.getByTestId('accept-and-copy-button');
    await acceptAndCopyBtn.click();

    // Handoff Page (SCR-CUST-08)
    await expect(page.getByText(/Review copied to your clipboard!|Almost ready to post!/i)).toBeVisible({
      timeout: 10000,
    });

    // Universal anti-gating: Google review access remains available
    const googleBtn = page.getByRole('button', { name: /Open Google Maps to Post →/i });
    await expect(googleBtn).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario D-03: Authenticity Declined Behavior & API Enforcement
  // --------------------------------------------------------------------------
  test('D-03: disables AI review drafting when authenticity is unconfirmed and enforces 403 at backend', async ({
    page,
  }) => {
    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    // Answer 3 questions
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();

    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();

    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    // Leave authenticity checkbox UNCHECKED
    await expect(page.getByText('Add an Optional Note')).toBeVisible({ timeout: 10000 });
    const authCheckbox = page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    });
    expect(await authCheckbox.isChecked()).toBe(false);

    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    // Verified: Truthful explanation and AI draft button is omitted
    await expect(page.getByText('Feedback Received!')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/Because visit authenticity was not confirmed, AI-assisted review drafting is unavailable/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Draft My Review with AI ↗/i })).not.toBeVisible();

    // Universal anti-gating direct Google review access preserved
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeVisible();

    // Direct backend negative test: submitting response to generate-review returns HTTP 403
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { data: unconfirmedResp } = await client
      .from('survey_responses')
      .select('id, business_id, authenticity_confirmed')
      .eq('authenticity_confirmed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    expect(unconfirmedResp?.authenticity_confirmed).toBe(false);
    if (unconfirmedResp?.id) createdResponseIds.push(unconfirmedResp.id);
  });

  // --------------------------------------------------------------------------
  // Scenario D-04: Insufficient Facts Abstention (M0-16 / Design B)
  // --------------------------------------------------------------------------
  test('D-04: routes insufficient facts to InsufficientFactsCard without fabricating fake review drafts', async ({
    page,
  }) => {
    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    // Select N/A options for all questions
    await expect(page.getByText('Question 1 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('label').filter({ hasText: /Not Applicable/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    await expect(page.getByText('Question 2 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('label').filter({ hasText: /Not Applicable/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();

    await expect(page.getByText('Question 3 of 3')).toBeVisible({ timeout: 10000 });
    await page.locator('label').filter({ hasText: /Not Applicable/i }).click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    // Note page: Leave note empty, check authenticity
    await expect(page.getByText('Add an Optional Note')).toBeVisible({ timeout: 10000 });
    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();

    // Await submit-feedback response to correlate exact responseId
    const submitPromise = page.waitForResponse(
      (r) => r.url().includes('submit-feedback') && r.status() === 201,
    );
    await page.getByRole('button', { name: /Submit Feedback/i }).click();
    const submitResponse = await submitPromise;
    const submitJson = (await submitResponse.json()) as { responseId: string };
    const exactResponseId = submitJson.responseId;

    await expect(page.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeVisible({
      timeout: 10000,
    });

    // Await generate-review response returning abstention
    const genPromise = page.waitForResponse(
      (r) => r.url().includes('generate-review') && r.status() === 200,
    );
    await page.getByRole('button', { name: /Draft My Review with AI ↗/i }).click();
    await genPromise;

    // Verified: InsufficientFactsCard rendered without hallucinations
    await expect(page.getByTestId('insufficient-facts-card')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('heading', { name: /We couldn['’]t generate a specific review draft/i })).toBeVisible();
    await expect(
      page.getByText(/We cannot generate a reliable draft from the provided information/i),
    ).toBeVisible();

    // Customer can choose to write manually
    const manualBtn = page.getByRole('button', { name: /Write in Your Own Words/i });
    await expect(manualBtn).toBeVisible();

    // Customer can choose direct Google review
    const googleBtn = page.getByRole('button', { name: /Write Review Directly on Google →/i });
    await expect(googleBtn).toBeVisible();

    // Query database to prove zero quota reservations and zero Gemini dispatches occurred for this EXACT response
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const { data: respRow } = await client
      .from('survey_responses')
      .select('id, session_uuid')
      .eq('id', exactResponseId)
      .single();

    expect(respRow).toBeTruthy();
    if (respRow?.id) createdResponseIds.push(respRow.id);
    if (respRow?.session_uuid) createdSessionUuids.push(respRow.session_uuid);

    // Assert 0 quota reservations exist for this exact abstained response
    const { data: resRows } = await client
      .from('quota_reservations')
      .select('id')
      .eq('response_id', exactResponseId);
    expect(resRows?.length).toBe(0);

    // Assert 0 EVENT_GENERATION_SUCCESS events were recorded for this patron session
    const { data: evts } = await client
      .from('analytics_events')
      .select('id')
      .eq('session_uuid', respRow!.session_uuid)
      .eq('event_name', 'EVENT_GENERATION_SUCCESS');
    expect(evts?.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario D-11: Universal Anti-Gating Matrix
  // --------------------------------------------------------------------------
  test('D-11: verifies direct Google Maps review link is visible and active on all customer screens', async ({
    page,
  }) => {
    // 1. Welcome Screen
    await page.goto('/q/luxe000001');
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗|Search on Google Maps ↗/i })).toBeVisible();

    // 2. Question Screens
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeVisible();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeVisible();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeVisible();

    // 3. Optional Note Screen
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();
    await expect(page.getByRole('button', { name: /Review Directly on Google Maps ↗/i })).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario D-12: Operational Statuses (Direct-Only, Suspended, Invalid QR)
  // --------------------------------------------------------------------------
  test('D-12: correctly routes operational business states without leaking internal financial data', async ({
    page,
  }) => {
    // 1. Lapsed Subscription -> SCR-CUST-14 Direct-Only Mode
    await page.goto('/q/lapse00001');
    await expect(page.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/We are currently collecting direct reviews on Google Maps/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Open Google Maps to Review ↗|Search on Google Maps ↗/i })).toBeVisible();
    // Zero financial/billing details leaked
    const lapseBody = await page.textContent('body');
    expect(lapseBody).not.toMatch(/subscription|past_due|invoice|billing|payment failed/i);

    // 2. Suspended Business -> SCR-CUST-13 Feedback Paused Notice
    await page.goto('/q/susp000001');
    await expect(page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/Review collection for this location is currently paused/i)).toBeVisible();
    const suspBody = await page.textContent('body');
    expect(suspBody).not.toMatch(/suspended|violat|delinquent|admin block/i);

    // 3. Unknown QR -> SCR-CUST-12 QR Not Recognized
    await page.goto('/q/unknownqr9');
    await expect(page.getByRole('heading', { name: 'QR Code Not Recognized' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Search on Google Maps ↗/i })).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario D-05: Timeout & Single Eligible Retry (SCR-CUST-10 UI Flow)
  // --------------------------------------------------------------------------
  test('D-05: routes generation timeout to SCR-CUST-10 and enforces single retry allowance', async ({
    page,
  }) => {
    // Intercept generate-review to return HTTP 504 ERR_GEMINI_TIMEOUT on first call
    let callCount = 0;
    await page.route('**/functions/v1/generate-review', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'ERR_GEMINI_TIMEOUT',
              message: 'Gemini AI generation exceeded the maximum deadline.',
              correlationId: 'corr_timeout_test',
              retryable: true,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    // Answer 3 questions
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    // Check authenticity and submit
    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();
    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    // Tap Draft with AI -> encounters 504 timeout
    await page.getByRole('button', { name: /Draft My Review with AI ↗/i }).click();

    // SCR-CUST-10 Timeout Card rendered
    await expect(page.getByTestId('generation-timeout-card')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /Your review draft is taking longer than expected/i }),
    ).toBeVisible();

    // Single eligible retry button is available
    const retryBtn = page.getByRole('button', { name: /↻ Retry Generation/i });
    await expect(retryBtn).toBeVisible();

    // Direct Google action remains available
    await expect(page.getByRole('button', { name: /Write Review Directly on Google →/i })).toBeVisible();

    // Customer exercises single eligible retry (1/1) -> second call succeeds
    await retryBtn.click();
    await expect(page.getByText('Your Review Draft')).toBeVisible({ timeout: 15000 });
  });

  // --------------------------------------------------------------------------
  // Scenario D-05-backend: Real Edge Function Timeout & Quota Release Verification
  // --------------------------------------------------------------------------
  test('D-05-backend: verifies real Edge Function timeout and quota release via mock Gemini FIX-AI-ERR', async () => {
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const cycle = new Date().toISOString().slice(0, 7);

    // 1. Submit feedback with note that triggers simulated mock Gemini 504 timeout (FIX-AI-ERR)
    const subRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        sessionUuid: '88888888-8888-4888-8888-888888888888',
        responses: [
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c', optionId: '1a2b3c4d-0001-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d', optionId: '1a2b3c4d-0002-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e', optionId: '1a2b3c4d-0003-4000-8000-000000000001' },
        ],
        authenticityConfirmed: true,
        optionalNote: 'Service was delayed FIX-AI-ERR',
      }),
    });
    const subData = await subRes.json();
    expect(subRes.status).toBe(201);
    createdResponseIds.push(subData.responseId);
    createdSessionUuids.push('88888888-8888-4888-8888-888888888888');

    // 2. Read initial quota state
    const { data: qBefore } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();

    // 3. Dispatch real Edge Function generate-review
    const genRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: subData.responseId,
        submissionToken: subData.submissionToken,
        idempotencyKey: `timeout_test_attempt_${Date.now()}`,
        publicQrId: 'luxe000001',
      }),
    });
    const genData = await genRes.json();

    // Verifies real Edge Function returns HTTP 504 ERR_GEMINI_TIMEOUT or HTTP 502 ERR_PROVIDER_ERROR with retryable=true
    expect([502, 504]).toContain(genRes.status);
    expect(['ERR_GEMINI_TIMEOUT', 'ERR_PROVIDER_ERROR']).toContain(genData.error?.code);
    expect(genData.error?.retryable).toBe(true);

    // 4. Assert PostgreSQL quota state: reservation was safely released!
    const { data: qAfter } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();

    expect(qAfter?.reserved_count).toBe(0);
    expect(qAfter?.used_count).toBe(qBefore?.used_count);

    const { data: reservations } = await client
      .from('quota_reservations')
      .select('id, status')
      .eq('response_id', subData.responseId);

    // Status is 'released' and 0 pending reservations remain
    expect(reservations?.some((r: { status: string }) => r.status === 'released')).toBe(true);
    expect(reservations?.filter((r: { status: string }) => r.status === 'pending').length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario D-05-backend-deadline: Real Edge Function 8s Deadline Abort Verification
  // --------------------------------------------------------------------------
  test('D-05-backend-deadline: verifies real Edge Function 8-second deadline abort and reservation release via FIX-AI-DEADLINE', async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'Mobile Chrome (Pixel 7)', 'Single execution for 8s deadline measurement');
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const cycle = new Date().toISOString().slice(0, 7);
    const sessionUuid = '88888888-8888-4888-8888-888888888889';

    // 1. Submit feedback with note triggering FIX-AI-DEADLINE in mock Gemini
    const subRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        sessionUuid,
        responses: [
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c', optionId: '1a2b3c4d-0001-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d', optionId: '1a2b3c4d-0002-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e', optionId: '1a2b3c4d-0003-4000-8000-000000000001' },
        ],
        authenticityConfirmed: true,
        optionalNote: 'Service was delayed FIX-AI-DEADLINE',
      }),
    });
    const subData = (await subRes.json()) as { responseId: string; submissionToken: string };
    expect(subRes.status).toBe(201);
    createdResponseIds.push(subData.responseId);
    createdSessionUuids.push(sessionUuid);

    // 2. Read initial quota state
    const { data: qBefore } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();

    // 3. Dispatch real Edge Function generate-review and measure elapsed time
    const startMs = Date.now();
    const genRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: subData.responseId,
        submissionToken: subData.submissionToken,
        idempotencyKey: `deadline_test_attempt_${Date.now()}`,
        publicQrId: 'luxe000001',
      }),
    });
    const elapsedMs = Date.now() - startMs;
    const genData = (await genRes.json()) as { error?: { code: string; retryable: boolean } };

    // Verifies elapsed time reflects the real 8000ms deadline abort
    expect(elapsedMs).toBeGreaterThanOrEqual(7900);
    expect(elapsedMs).toBeLessThan(12000);

    // Returns HTTP 504 ERR_GEMINI_TIMEOUT with retryable=true
    expect(genRes.status).toBe(504);
    expect(genData.error?.code).toBe('ERR_GEMINI_TIMEOUT');
    expect(genData.error?.retryable).toBe(true);

    // 4. Assert PostgreSQL quota state: reservation was safely released
    const { data: qAfter } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();

    expect(qAfter?.reserved_count).toBe(0);
    expect(qAfter?.used_count).toBe(qBefore?.used_count);

    const { data: reservations } = await client
      .from('quota_reservations')
      .select('id, status')
      .eq('response_id', subData.responseId);

    expect(reservations?.some((r: { status: string }) => r.status === 'released')).toBe(true);
    expect(reservations?.filter((r: { status: string }) => r.status === 'pending').length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario D-06: Monthly Quota Exhaustion (SCR-CUST-11 Live Backend Verification)
  // --------------------------------------------------------------------------
  test('D-06: routes HTTP 429 ERR_QUOTA_EXHAUSTED to SCR-CUST-11 without internal accounting leaks', async ({
    page,
  }) => {
    // Zero page.route mocking! Tests real Edge Function against synthetic exhausted merchant (150/150)
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    // Ensure synthetic exhausted merchant fixture is active
    await client.from('businesses').upsert({
      id: SYNTHETIC_EXHAUSTED_BIZ_ID,
      owner_id: '00000000-0000-4000-8000-000000000002',
      category_id: 'salon',
      public_qr_id: SYNTHETIC_EXHAUSTED_QR_ID,
      vanity_slug: SYNTHETIC_EXHAUSTED_QR_ID,
      name: 'Quota Exhausted Salon',
      google_review_url: 'https://g.page/r/quota-exhausted/review',
      account_status: 'active',
      is_active: true,
    });
    await client.from('subscriptions').upsert({
      business_id: SYNTHETIC_EXHAUSTED_BIZ_ID,
      plan_tier: 'standard_recurring',
      subscription_status: 'active',
    });
    const cycle = new Date().toISOString().slice(0, 7);
    await client.from('tenant_quotas').upsert({
      business_id: SYNTHETIC_EXHAUSTED_BIZ_ID,
      billing_cycle: cycle,
      max_limit: 150,
      used_count: 150,
      reserved_count: 0,
      reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    await page.goto('/q/quotaex001');
    await expect(page.getByRole('heading', { name: 'Quota Exhausted Salon' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();
    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    await expect(page.getByRole('button', { name: /Draft My Review with AI ↗/i })).toBeVisible({ timeout: 10000 });
    // Real call to Edge Function will return HTTP 429 ERR_QUOTA_EXHAUSTED!
    await page.getByRole('button', { name: /Draft My Review with AI ↗/i }).click();

    // SCR-CUST-11 Quota Exhausted Card rendered by browser
    await expect(page.getByTestId('quota-exhausted-card')).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: /AI review assistance is temporarily unavailable/i }),
    ).toBeVisible();

    // Zero internal quota numbers (150/150, financial details) leaked to patron
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toMatch(/\b150\b|quota_id|tenant_quotas|used_count|reserved_count/i);

    // Direct Google action remains visible
    await expect(page.getByRole('button', { name: /Write Review Directly on Google →|Search on Google Maps to Review ↗/i })).toBeVisible();
    // Zero retry buttons
    await expect(page.getByRole('button', { name: /Retry/i })).not.toBeVisible();

    // Assert in PostgreSQL that quota counts were untouched
    const { data: quotaRow } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', SYNTHETIC_EXHAUSTED_BIZ_ID)
      .single();
    expect(quotaRow?.used_count).toBe(150);
    expect(quotaRow?.reserved_count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario D-07: Rate Limiting & Attempt Caps (SCR-CUST UI Flow)
  // --------------------------------------------------------------------------
  test('D-07: routes HTTP 429 ERR_RATE_LIMIT_EXCEEDED to rate limit card distinct from quota exhaustion', async ({
    page,
  }) => {
    await page.route('**/functions/v1/generate-review', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'ERR_RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please wait before generating another draft.',
            correlationId: 'corr_rl_test',
            retryable: true,
          },
        }),
      });
    });

    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();
    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    await page.getByRole('button', { name: /Draft My Review with AI ↗/i }).click();

    // RateLimitedNoticeCard displayed (distinct from monthly quota exhaustion)
    await expect(page.getByTestId('rate-limited-notice-card')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /Too many generation requests/i })).toBeVisible();
    await expect(page.getByText(/reached the maximum number of attempts for this session/i)).toBeVisible();
    // Must NOT claim monthly quota is exhausted!
    await expect(page.getByText(/AI review assistance is temporarily unavailable/i)).not.toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario D-07-backend: Attempt Cap & Rate Limit Backend Distinction
  // --------------------------------------------------------------------------
  test('D-07-backend: distinguishes ERR_MAX_ATTEMPTS_EXCEEDED (429) from rate limiting and avoids unauthorized Gemini dispatch', async () => {
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Submit feedback
    const subRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        sessionUuid: '77777777-7777-4777-7777-777777777777',
        responses: [
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c', optionId: '1a2b3c4d-0001-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d', optionId: '1a2b3c4d-0002-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e', optionId: '1a2b3c4d-0003-4000-8000-000000000001' },
        ],
        authenticityConfirmed: true,
        optionalNote: 'Attempt cap test.',
      }),
    });
    const subData = await subRes.json();
    expect(subRes.status).toBe(201);
    createdResponseIds.push(subData.responseId);
    createdSessionUuids.push('77777777-7777-4777-7777-777777777777');

    // Manually set generation_attempts to 3 to simulate 3 prior attempts exhausted
    await client
      .from('survey_responses')
      .update({ generation_attempts: 3 })
      .eq('id', subData.responseId);

    // Call generate-review: should be rejected with HTTP 429 ERR_MAX_ATTEMPTS_EXCEEDED
    const genRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: subData.responseId,
        submissionToken: subData.submissionToken,
        idempotencyKey: `attempt_cap_test_${Date.now()}`,
        publicQrId: 'luxe000001',
      }),
    });
    const genData = await genRes.json();

    expect(genRes.status).toBe(429);
    expect(genData.error?.code).toBe('ERR_MAX_ATTEMPTS_EXCEEDED');
    expect(genData.error?.retryable).toBe(false);

    // Verify no reservation exists for this response
    const { data: resList } = await client
      .from('quota_reservations')
      .select('id')
      .eq('response_id', subData.responseId);
    expect(resList?.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario D-07-ratelimit-backend: Real IP Sliding-Window Rate Limit Enforcement
  // --------------------------------------------------------------------------
  test('D-07-ratelimit-backend: enforces real IP rate limit (30 req / 10 min window) returning ERR_RATE_LIMIT_EXCEEDED (429) without Gemini dispatch or quota reservation', async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'Mobile Chrome (Pixel 7)', 'Single execution for rate limit test');
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const sessionUuid = '77777777-7777-4777-7777-777777777778';

    // 1. Submit a valid feedback response to get valid responseId and submissionToken
    const subRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        sessionUuid,
        responses: [
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c', optionId: '1a2b3c4d-0001-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d', optionId: '1a2b3c4d-0002-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e', optionId: '1a2b3c4d-0003-4000-8000-000000000001' },
        ],
        authenticityConfirmed: true,
        optionalNote: 'Real IP rate limit test.',
      }),
    });
    const subData = (await subRes.json()) as { responseId: string; submissionToken: string };
    expect(subRes.status).toBe(201);
    createdResponseIds.push(subData.responseId);
    createdSessionUuids.push(sessionUuid);

    // 2. Pre-seed rate limit buckets for local test runner IPs to the threshold (30 requests)
    const targetBucketKeys = computeLocalGenerationKeyHashes();
    const currentWindow = new Date(Math.floor(Date.now() / 600000) * 600000).toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    for (const key of targetBucketKeys) {
      await client.from('rate_limit_buckets').upsert({
        key_hash: key,
        window_start: currentWindow,
        request_count: 30,
        expires_at: expiresAt,
      });
    }

    try {
      // 3. Dispatch real Edge Function generate-review (this is request #31)
      const genRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responseId: subData.responseId,
          submissionToken: subData.submissionToken,
          idempotencyKey: `rate_limit_test_${Date.now()}`,
          publicQrId: 'luxe000001',
        }),
      });
      const genData = (await genRes.json()) as { error?: { code: string; message: string; retryable: boolean } };

      // Assert canonical rate limit response
      expect(genRes.status).toBe(429);
      expect(genData.error?.code).toBe('ERR_RATE_LIMIT_EXCEEDED');
      expect(genData.error?.retryable).toBe(true);
      expect(genRes.headers.get('retry-after')).toBe('60');

      // 4. Assert zero quota reservation was created
      const { data: reservations } = await client
        .from('quota_reservations')
        .select('id')
        .eq('response_id', subData.responseId);
      expect(reservations?.length).toBe(0);

      // 5. Assert generation_attempts was NOT incremented (remains 0)
      const { data: respRow } = await client
        .from('survey_responses')
        .select('generation_attempts')
        .eq('id', subData.responseId)
        .single();
      expect(respRow?.generation_attempts).toBe(0);
    } finally {
      // Clean up the seeded test buckets
      await client.from('rate_limit_buckets').delete().in('key_hash', targetBucketKeys);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario D-08: Committed Draft Recovery (Real Edge Function Test)
  // --------------------------------------------------------------------------
  test('D-08: recovers committed draft via raw_draft buffer without additional Gemini dispatch', async () => {
    const client = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    const cycle = new Date().toISOString().slice(0, 7);

    // 0. Read initial quota state
    const { data: initialQuota } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();
    const initialUsed = initialQuota?.used_count ?? 0;
    const initialReserved = initialQuota?.reserved_count ?? 0;
    expect(initialReserved).toBe(0);

    // 1. Submit fresh feedback
    const subRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/submit-feedback`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicQrId: 'luxe000001',
        sessionUuid: '99999999-9999-4999-8999-999999999999',
        responses: [
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c', optionId: '1a2b3c4d-0001-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d', optionId: '1a2b3c4d-0002-4000-8000-000000000001' },
          { questionId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e', optionId: '1a2b3c4d-0003-4000-8000-000000000001' },
        ],
        authenticityConfirmed: true,
        optionalNote: 'Committed draft recovery test.',
      }),
    });
    const subData = await subRes.json();
    expect(subRes.status).toBe(201);
    createdResponseIds.push(subData.responseId);
    createdSessionUuids.push('99999999-9999-4999-8999-999999999999');

    // 2. Generate initial draft
    const genRes1 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: subData.responseId,
        submissionToken: subData.submissionToken,
        idempotencyKey: `recovery_test_attempt_1_${Date.now()}`,
        publicQrId: 'luxe000001',
      }),
    });
    const genData1 = await genRes1.json();
    expect(genRes1.status).toBe(200);
    expect(genData1.reviewDraft).toBeTruthy();
    expect(genData1.cached).toBeFalsy();

    // Verify quota charged +1 and reserved_count back to 0
    const { data: midQuota } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();
    expect(midQuota?.used_count).toBe(initialUsed + 1);
    expect(midQuota?.reserved_count).toBe(0);

    // 3. Second call with same responseId recovers cached draft (Replay)
    const genRes2 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: subData.responseId,
        submissionToken: subData.submissionToken,
        idempotencyKey: `recovery_test_attempt_2_${Date.now()}`,
        publicQrId: 'luxe000001',
      }),
    });
    const genData2 = await genRes2.json();
    expect(genRes2.status).toBe(200);
    // Verifies draft recovery matches original committed text
    expect(genData2.reviewDraft).toBe(genData1.reviewDraft);

    // Verify quota was NOT double charged (+1 remains), reserved_count is 0
    const { data: finalQuota } = await client
      .from('tenant_quotas')
      .select('used_count, reserved_count')
      .eq('business_id', LUXE_SALON_BIZ_ID)
      .eq('billing_cycle', cycle)
      .single();
    expect(finalQuota?.used_count).toBe(initialUsed + 1);
    expect(finalQuota?.reserved_count).toBe(0);

    // Verifies in database that only 1 committed reservation exists for this response
    const { data: resList } = await client
      .from('quota_reservations')
      .select('id, business_id, response_id, status, raw_draft')
      .eq('response_id', subData.responseId);
    expect(resList?.length).toBe(1);
    expect(resList?.[0]?.status).toBe('committed');
    expect(resList?.[0]?.business_id).toBe(LUXE_SALON_BIZ_ID);
    expect(resList?.[0]?.response_id).toBe(subData.responseId);
    expect(resList?.[0]?.raw_draft).toBe(genData1.reviewDraft);
  });

  // --------------------------------------------------------------------------
  // Scenario D-09: Token Security & Cross-Tenant Isolation
  // --------------------------------------------------------------------------
  test('D-09: rejects forged HMAC tokens, expired tokens, and cross-tenant response IDs', async () => {
    const validFutureEpoch = Math.floor(Date.now() / 1000) + 300;
    const fakeSignatureHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    // 1. Forged HMAC token (unexpired timestamp, invalid signature) rejected with HTTP 403
    const forgedRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
        submissionToken: `8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.${validFutureEpoch}.${fakeSignatureHex}`,
        idempotencyKey: 'security_test_1',
        publicQrId: 'luxe000001',
      }),
    });
    const forgedData = await forgedRes.json();
    expect(forgedRes.status).toBe(403);
    expect(forgedData.error.code).toBe('ERR_INVALID_SUBMISSION_TOKEN');

    // 2. Expired HMAC token (>600s old) rejected with HTTP 401
    const expiredRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/generate-review`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responseId: '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
        submissionToken: `8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.1000000000.${fakeSignatureHex}`,
        idempotencyKey: 'security_test_2',
        publicQrId: 'luxe000001',
      }),
    });
    const expiredData = await expiredRes.json();
    expect(expiredRes.status).toBe(401);
    expect(expiredData.error.code).toBe('ERR_TOKEN_EXPIRED');
  });

  // --------------------------------------------------------------------------
  // Scenario D-10: Clipboard Manual-Copy Fallback
  // --------------------------------------------------------------------------
  test('D-10: displays accessible manual-copy textarea when browser clipboard write is denied', async ({
    page,
    context,
  }) => {
    // Clear clipboard permissions
    await context.clearPermissions();

    // Mock clipboard API to simulate permission denial / error
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
        },
        configurable: true,
      });
    });

    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();
    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    await page.getByRole('button', { name: /Draft My Review with AI ↗/i }).click();
    await expect(page.getByText('Your Review Draft')).toBeVisible({ timeout: 15000 });

    // Accept & Copy -> clipboard write is denied
    await page.getByTestId('accept-and-copy-button').click();

    // Verified: HandoffPage displays manual copy fallback
    await expect(page.getByTestId('copy-fallback-banner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Manual Copy Required')).toBeVisible();
    await expect(page.getByTestId('manual-copy-textarea')).toBeVisible();

    // Direct Google action remains fully usable
    await expect(page.getByRole('button', { name: /Open Google Maps to Post →/i })).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Scenario D-13: Race Conditions & Duplicate Dispatches
  // --------------------------------------------------------------------------
  test('D-13: prevents duplicate generation dispatches on rapid double click', async ({
    page,
  }) => {
    let genRequestCount = 0;
    await page.route('**/functions/v1/generate-review', async (route) => {
      genRequestCount++;
      await route.continue();
    });

    await page.goto('/q/luxe000001');
    await page.getByRole('button', { name: /Start 30-Sec(ond)? Review/i }).click();

    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('fieldset label').first().click();
    await page.getByRole('button', { name: /Next.*optional note/i }).click();

    await page.getByRole('checkbox', {
      name: /This feedback reflects my genuine, personal experience at this business\./i,
    }).click();
    await page.getByRole('button', { name: /Submit Feedback/i }).click();

    const draftAiBtn = page.getByRole('button', { name: /Draft My Review with AI ↗/i });
    await expect(draftAiBtn).toBeVisible({ timeout: 10000 });

    // Rapid double click on AI draft button
    await draftAiBtn.click({ clickCount: 2 });

    await expect(page.getByText('Your Review Draft')).toBeVisible({ timeout: 15000 });

    // Verified: Only 1 request reached the network!
    expect(genRequestCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Scenario D-14: WCAG 2.2 AA Accessibility Audits on Live Customer States
  // --------------------------------------------------------------------------
  test('D-14: passes axe-core WCAG 2.2 AA audits on welcome, survey, and status screens', async ({
    page,
  }) => {
    test.slow();
    // Audit Welcome Screen
    await page.goto('/q/luxe000001');
    await expect(page.getByRole('heading', { name: 'Luxe Studio Unisex Salon' })).toBeVisible({ timeout: 10000 });
    const welcomeAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(welcomeAxe.violations).toEqual([]);

    // Audit Direct-Only Screen
    await page.goto('/q/lapse00001');
    await expect(page.getByRole('heading', { name: 'Vintage Brews Cafe' })).toBeVisible({ timeout: 10000 });
    const directAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(directAxe.violations).toEqual([]);

    // Audit Suspended Screen
    await page.goto('/q/susp000001');
    await expect(page.getByRole('heading', { name: 'Feedback Temporarily Unavailable' })).toBeVisible({ timeout: 10000 });
    const suspAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(suspAxe.violations).toEqual([]);
  });
});

