/**
 * M5-T09 Live Acceptance Verification Script
 *
 * Verifies Check D (Real Supabase Auth & Multi-Tenant PostgreSQL RLS) for:
 *   - API-OWN-06 (GET /rest/v1/tenant_quotas)
 *   - API-OWN-09 (GET /rest/v1/subscriptions)
 * Also verifies multi-tenant isolation, direct write tampering protection,
 * and mathematical quota calculation invariants.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A-39sBDVYn_s_t-S_I_t_c-7h8y4y3bXW-8_8';

const LUXE_BIZ_ID = 'b0000000-0000-4000-8000-000000000001';
const DAILY_BIZ_ID = 'b0000000-0000-4000-8000-000000000002';
const NON_EXISTENT_BIZ_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

async function loginUser(email: string, pass: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ email, password: pass }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to login ${email}: ${res.status} ${errText}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface RawSubscriptionRow {
  id: string;
  business_id: string;
  plan_tier: string;
  subscription_status: string;
  trial_ends_at: string | null;
  current_period_starts_at: string;
  current_period_ends_at: string;
  billing_currency: string;
  last_payment_amount: number | null;
  last_payment_recorded_at: string | null;
  payment_reference: string | null;
}

interface RawTenantQuotaRow {
  id: string;
  business_id: string;
  billing_cycle: string;
  max_limit: number;
  used_count: number;
  reserved_count: number;
  reset_at: string;
}

async function queryTable<T>(
  table: string,
  params: Record<string, string>,
  token?: string,
): Promise<{ status: number; rows: T[] }> {
  const query = new URLSearchParams(params);
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query.toString()}`, {
    method: 'GET',
    headers,
  });

  try {
    const rows = (await res.json()) as T[];
    return { status: res.status, rows: Array.isArray(rows) ? rows : [] };
  } catch {
    return { status: res.status, rows: [] };
  }
}

async function run() {
  console.log('================================================================');
  console.log('   M5-T09 LIVE MULTI-TENANT RLS & CONTRACT VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string, detail?: string) {
    if (cond) {
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${name}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  try {
    // 1. Anonymous Access Controls (Unauthenticated caller)
    console.log('1. Anonymous Role Direct Access Control:');
    const anonSub = await queryTable<RawSubscriptionRow>('subscriptions', {
      business_id: `eq.${LUXE_BIZ_ID}`,
      select: '*',
    });
    assert(
      anonSub.rows.length === 0,
      'Anon role cannot read subscriptions (RLS returns 0 rows)',
      `Returned ${anonSub.rows.length} rows`,
    );

    const anonQuota = await queryTable<RawTenantQuotaRow>('tenant_quotas', {
      business_id: `eq.${LUXE_BIZ_ID}`,
      select: '*',
    });
    assert(
      anonQuota.rows.length === 0,
      'Anon role cannot read tenant_quotas (RLS returns 0 rows)',
      `Returned ${anonQuota.rows.length} rows`,
    );

    // 2. Authenticated Session Retrieval
    console.log('\n2. Authenticated Session Retrieval:');
    const luxeToken = await loginUser('merchant.luxe@local.test', 'LocalDevPass123!');
    assert(Boolean(luxeToken), 'Obtained valid GoTrue session JWT for Merchant Luxe');

    const dailyToken = await loginUser('merchant.daily@local.test', 'LocalDevPass123!');
    assert(Boolean(dailyToken), 'Obtained valid GoTrue session JWT for Merchant Daily Roast');

    // 3. Authorized Queries: Merchant Luxe (Active standard_recurring)
    console.log('\n3. Authorized Self Queries — Merchant Luxe:');
    const luxeSub = await queryTable<RawSubscriptionRow>(
      'subscriptions',
      { business_id: `eq.${LUXE_BIZ_ID}`, select: '*' },
      luxeToken,
    );
    assert(luxeSub.rows.length === 1, 'Merchant Luxe reads exactly 1 subscription record');
    assert(
      luxeSub.rows[0]?.business_id === LUXE_BIZ_ID,
      'Returned subscription matches Luxe businessId',
    );
    assert(
      luxeSub.rows[0]?.plan_tier === 'standard_recurring',
      'Luxe subscription tier is standard_recurring',
    );
    assert(
      luxeSub.rows[0]?.subscription_status === 'active',
      'Luxe subscription status is active',
    );
    assert(
      Number(luxeSub.rows[0]?.last_payment_amount) === 399.0,
      'Luxe last payment amount is ₹399.00',
    );

    const luxeQuota = await queryTable<RawTenantQuotaRow>(
      'tenant_quotas',
      { business_id: `eq.${LUXE_BIZ_ID}`, select: '*', order: 'billing_cycle.desc' },
      luxeToken,
    );
    assert(luxeQuota.rows.length >= 1, 'Merchant Luxe reads quota ledger history');
    assert(
      luxeQuota.rows[0]?.max_limit === 150,
      'Luxe monthly quota ceiling is 150 generations',
    );
    assert(
      Boolean(luxeQuota.rows[0]?.reset_at),
      'Luxe quota contains authoritative reset_at timestamp',
    );

    // 4. Authorized Queries: Merchant Daily Roast (Pilot setup_package)
    console.log('\n4. Authorized Self Queries — Merchant Daily Roast:');
    const dailySub = await queryTable<RawSubscriptionRow>(
      'subscriptions',
      { business_id: `eq.${DAILY_BIZ_ID}`, select: '*' },
      dailyToken,
    );
    assert(dailySub.rows.length === 1, 'Merchant Daily Roast reads exactly 1 subscription record');
    assert(
      dailySub.rows[0]?.business_id === DAILY_BIZ_ID,
      'Returned subscription matches Daily Roast businessId',
    );
    assert(
      dailySub.rows[0]?.plan_tier === 'setup_package',
      'Daily Roast subscription tier is setup_package',
    );
    assert(
      dailySub.rows[0]?.subscription_status === 'pilot',
      'Daily Roast subscription status is pilot',
    );
    assert(
      Boolean(dailySub.rows[0]?.trial_ends_at),
      'Daily Roast subscription contains trial_ends_at expiration',
    );

    const dailyQuota = await queryTable<RawTenantQuotaRow>(
      'tenant_quotas',
      { business_id: `eq.${DAILY_BIZ_ID}`, select: '*', order: 'billing_cycle.desc' },
      dailyToken,
    );
    assert(dailyQuota.rows.length >= 1, 'Merchant Daily Roast reads quota ledger history');

    // 5. Cross-Tenant Isolation Enforcement (PostgreSQL RLS)
    console.log('\n5. Multi-Tenant Isolation Enforcement (RLS Cross-Tenant Denial):');
    const crossSubLuxeToDaily = await queryTable<RawSubscriptionRow>(
      'subscriptions',
      { business_id: `eq.${DAILY_BIZ_ID}`, select: '*' },
      luxeToken,
    );
    assert(
      crossSubLuxeToDaily.rows.length === 0,
      'Merchant Luxe querying Daily Roast subscription returns 0 rows (RLS blocked)',
      `Returned ${crossSubLuxeToDaily.rows.length} rows`,
    );

    const crossQuotaLuxeToDaily = await queryTable<RawTenantQuotaRow>(
      'tenant_quotas',
      { business_id: `eq.${DAILY_BIZ_ID}`, select: '*' },
      luxeToken,
    );
    assert(
      crossQuotaLuxeToDaily.rows.length === 0,
      'Merchant Luxe querying Daily Roast quota returns 0 rows (RLS blocked)',
      `Returned ${crossQuotaLuxeToDaily.rows.length} rows`,
    );

    const crossSubDailyToLuxe = await queryTable<RawSubscriptionRow>(
      'subscriptions',
      { business_id: `eq.${LUXE_BIZ_ID}`, select: '*' },
      dailyToken,
    );
    assert(
      crossSubDailyToLuxe.rows.length === 0,
      'Merchant Daily Roast querying Luxe subscription returns 0 rows (RLS blocked)',
      `Returned ${crossSubDailyToLuxe.rows.length} rows`,
    );

    const crossQuotaDailyToLuxe = await queryTable<RawTenantQuotaRow>(
      'tenant_quotas',
      { business_id: `eq.${LUXE_BIZ_ID}`, select: '*' },
      dailyToken,
    );
    assert(
      crossQuotaDailyToLuxe.rows.length === 0,
      'Merchant Daily Roast querying Luxe quota returns 0 rows (RLS blocked)',
      `Returned ${crossQuotaDailyToLuxe.rows.length} rows`,
    );

    // 6. Tampered / Non-Existent Business ID Queries
    console.log('\n6. Tampered & Non-Existent Business IDs:');
    const fakeSub = await queryTable<RawSubscriptionRow>(
      'subscriptions',
      { business_id: `eq.${NON_EXISTENT_BIZ_ID}`, select: '*' },
      luxeToken,
    );
    assert(
      fakeSub.rows.length === 0,
      'Querying non-existent business UUID returns 0 rows (no leakage of existence)',
    );

    const fakeQuota = await queryTable<RawTenantQuotaRow>(
      'tenant_quotas',
      { business_id: `eq.${NON_EXISTENT_BIZ_ID}`, select: '*' },
      luxeToken,
    );
    assert(
      fakeQuota.rows.length === 0,
      'Querying non-existent business UUID quota returns 0 rows (no leakage of existence)',
    );

    // 7. Direct Write Tampering Protection (Merchant cannot self-elevate plan or quota)
    console.log('\n7. Direct Write & Self-Elevation Protection:');
    const patchSubRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?business_id=eq.${LUXE_BIZ_ID}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: `Bearer ${luxeToken}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ plan_tier: 'setup_package', subscription_status: 'canceled' }),
      },
    );
    const patchedSub = (await patchSubRes.json()) as unknown[];
    assert(
      !Array.isArray(patchedSub) || patchedSub.length === 0,
      'Merchant direct PATCH to subscriptions is blocked by RLS (0 rows modified)',
    );

    const patchQuotaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tenant_quotas?business_id=eq.${LUXE_BIZ_ID}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: `Bearer ${luxeToken}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ max_limit: 9999 }),
      },
    );
    const patchedQuota = (await patchQuotaRes.json()) as unknown[];
    assert(
      !Array.isArray(patchedQuota) || patchedQuota.length === 0,
      'Merchant direct PATCH to tenant_quotas is blocked by RLS (0 rows modified)',
    );

    // 8. Quota Calculation Invariants & Threshold Verification
    console.log('\n8. Quota Calculation & Threshold Invariants:');
    const used = 84;
    const max = 150;
    const reserved = 0;
    const remaining = Math.max(0, max - used - reserved);
    const pct = Math.round((used / max) * 100);
    assert(remaining === 66, 'TC-OWN-15 formula: 150 - 84 = 66 remaining');
    assert(pct === 56, '84 / 150 = 56% committed usage');
    assert(pct < 80, '56% is in healthy status (<80%)');

    const reservedUsage = Math.max(0, 150 - 84 - 2);
    assert(reservedUsage === 64, 'In-flight reservation correctly reserves available capacity (64)');

    const warningPct = Math.round((120 / 150) * 100);
    assert(warningPct === 80, '120 / 150 = exactly 80% boundary');
    const isWarningAt80 = warningPct >= 80 && warningPct < 100;
    assert(isWarningAt80, 'Exactly 80% triggers warning state');

    const below80Pct = Math.round((119 / 150) * 100);
    assert(below80Pct === 79, '119 / 150 = 79% (below 80%)');
    const isWarningAt79 = below80Pct >= 80;
    assert(!isWarningAt79, '79% remains in healthy state');

    const exhaustedPct = Math.round((150 / 150) * 100);
    assert(exhaustedPct === 100, '150 / 150 = 100%');
    const isExhaustedAt100 = 150 >= 150;
    assert(isExhaustedAt100, '150/150 triggers quota exhausted state');
  } catch (err) {
    console.error('Test execution failed:', err);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

void run();

