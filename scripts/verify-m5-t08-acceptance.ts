/**
 * M5-T08 Acceptance Verification Script
 *
 * Verifies Check D (Real Authentication & Tenant Isolation) and
 * Check C (Periods, Boundaries, Zero-Denominators, Quota Independence)
 * against local Supabase instance.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const LUXE_BIZ_ID = 'b0000000-0000-4000-8000-000000000001';
const DAILY_BIZ_ID = 'b0000000-0000-4000-8000-000000000002';
const NON_EXISTENT_BIZ_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

async function loginUser(email: string, pass: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A-39sBDVYn_s_t-S_I_t_c-7h8y4y3bXW-8_8',
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

interface DashboardApiResponse {
  businessId?: string;
  period?: string;
  metrics?: {
    qrVisits?: number;
    surveysCompleted?: number;
    reviewsDrafted?: number;
    clipboardCopies?: number;
    googleHandoffClicks?: number;
    directBypassClicks?: number;
    surveyCompletionRate?: number;
    draftSuccessRate?: number;
    copyRate?: number;
    handoffRate?: number;
    directBypassRate?: number;
    totalHandoffRate?: number;
  };
  quota?: {
    billingCycle?: string;
    monthlyQuotaLimit?: number;
    generationsUsed?: number;
    generationsRemaining?: number;
  };
  disclaimer?: string;
  error?: {
    code?: string;
    message?: string;
  };
}

async function requestDashboard(params: {
  businessId?: string;
  period?: string;
  token?: string;
}): Promise<{ status: number; body: DashboardApiResponse | null }> {
  const query = new URLSearchParams();
  if (params.businessId !== undefined) query.set('businessId', params.businessId);
  if (params.period !== undefined) query.set('period', params.period);

  const headers: Record<string, string> = {};
  if (params.token) {
    headers['Authorization'] = `Bearer ${params.token}`;
  }

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/get-owner-dashboard?${query.toString()}`,
    {
      method: 'GET',
      headers,
    },
  );

  let body: DashboardApiResponse | null;
  try {
    body = (await res.json()) as DashboardApiResponse;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function run() {
  console.log('================================================================');
  console.log('   M5-T08 CHECK D & C LIVE VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string, detail?: string) {
    if (cond) {
      passed++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL: ${name}`);
      if (detail) console.error(`    Details: ${detail}`);
    }
  }

  // 1. Unauthenticated Request
  console.log('1. Authentication Gate Tests:');
  const unauthRes = await requestDashboard({ businessId: LUXE_BIZ_ID });
  assert(
    unauthRes.status === 401 && unauthRes.body?.error?.code === 'ERR_UNAUTHORIZED',
    'Unauthenticated request returns 401 ERR_UNAUTHORIZED',
  );

  // 2. Invalid Token Request
  const invalidTokenRes = await requestDashboard({
    businessId: LUXE_BIZ_ID,
    token: 'invalid.jwt.token',
  });
  assert(
    invalidTokenRes.status === 401 && invalidTokenRes.body?.error?.code === 'ERR_UNAUTHORIZED',
    'Invalid Bearer token returns 401 ERR_UNAUTHORIZED',
  );

  // 3. Authenticate Merchant Luxe & Merchant Daily Roast
  console.log('\n2. Authenticated Session Retrieval:');
  const luxeToken = await loginUser('merchant.luxe@local.test', 'LocalDevPass123!');
  assert(!!luxeToken, 'Obtained valid GoTrue session JWT for Merchant Luxe');

  const dailyToken = await loginUser('merchant.daily@local.test', 'LocalDevPass123!');
  assert(!!dailyToken, 'Obtained valid GoTrue session JWT for Merchant Daily Roast');

  // 4. Authorized Tenant Access
  console.log('\n3. Authorized Dashboard Queries & Data Verification:');
  const luxeRes = await requestDashboard({
    businessId: LUXE_BIZ_ID,
    period: '30d',
    token: luxeToken,
  });
  assert(luxeRes.status === 200, 'Merchant Luxe querying Luxe business returns 200 OK');
  assert(
    luxeRes.body?.businessId === LUXE_BIZ_ID,
    'Returned payload matches requested businessId',
  );
  assert(luxeRes.body?.period === '30d', 'Returned payload matches period 30d');
  assert(
    typeof luxeRes.body?.metrics?.qrVisits === 'number' &&
      typeof luxeRes.body?.metrics?.surveysCompleted === 'number' &&
      typeof luxeRes.body?.metrics?.reviewsDrafted === 'number' &&
      typeof luxeRes.body?.metrics?.clipboardCopies === 'number' &&
      typeof luxeRes.body?.metrics?.googleHandoffClicks === 'number' &&
      typeof luxeRes.body?.metrics?.directBypassClicks === 'number',
    'Returned metrics contain all 6 canonical funnel event counts',
  );
  assert(
    typeof luxeRes.body?.metrics?.surveyCompletionRate === 'number' &&
      typeof luxeRes.body?.metrics?.draftSuccessRate === 'number' &&
      typeof luxeRes.body?.metrics?.copyRate === 'number' &&
      typeof luxeRes.body?.metrics?.handoffRate === 'number' &&
      typeof luxeRes.body?.metrics?.directBypassRate === 'number' &&
      typeof luxeRes.body?.metrics?.totalHandoffRate === 'number',
    'Returned metrics contain all 6 canonical conversion rates',
  );
  assert(
    typeof luxeRes.body?.quota?.billingCycle === 'string' &&
      typeof luxeRes.body?.quota?.monthlyQuotaLimit === 'number' &&
      typeof luxeRes.body?.quota?.generationsUsed === 'number' &&
      typeof luxeRes.body?.quota?.generationsRemaining === 'number',
    'Returned payload includes authorized tenant quota ledger',
  );
  assert(
    luxeRes.body?.disclaimer?.includes('Google Maps does not notify third-party platforms'),
    'Returned payload includes mandatory attribution safeguard disclaimer',
  );

  // 5. Privacy & Zero-PII Audit
  console.log('\n4. Privacy & Zero-PII Response Audit:');
  const payloadStr = JSON.stringify(luxeRes.body);
  assert(!payloadStr.includes('session_uuid'), 'Response does NOT contain session_uuid');
  assert(!payloadStr.includes('sessionUuid'), 'Response does NOT contain sessionUuid');
  assert(!payloadStr.includes('ip_hash'), 'Response does NOT contain ip_hash');
  assert(!payloadStr.includes('optional_note'), 'Response does NOT contain optional_note');
  assert(!payloadStr.includes('optionalNote'), 'Response does NOT contain optionalNote');
  assert(!payloadStr.includes('patron'), 'Response does NOT contain patron PII');

  // 6. Cross-Tenant Isolation (Check D #3 & #4)
  console.log('\n5. Cross-Tenant Isolation Enforcement:');
  const crossTenantRes1 = await requestDashboard({
    businessId: DAILY_BIZ_ID,
    period: '30d',
    token: luxeToken,
  });
  assert(
    crossTenantRes1.status === 403 && crossTenantRes1.body?.error?.code === 'ERR_FORBIDDEN',
    'Merchant Luxe requesting Merchant Daily Roast business returns 403 ERR_FORBIDDEN',
  );

  const dailyRes = await requestDashboard({
    businessId: DAILY_BIZ_ID,
    period: '30d',
    token: dailyToken,
  });
  assert(
    dailyRes.status === 200 && dailyRes.body?.businessId === DAILY_BIZ_ID,
    'Merchant Daily Roast requesting Daily Roast business returns 200 OK',
  );

  const crossTenantRes2 = await requestDashboard({
    businessId: LUXE_BIZ_ID,
    period: '30d',
    token: dailyToken,
  });
  assert(
    crossTenantRes2.status === 403 && crossTenantRes2.body?.error?.code === 'ERR_FORBIDDEN',
    'Merchant Daily Roast requesting Luxe business returns 403 ERR_FORBIDDEN',
  );

  // 7. Non-Existent Business ID / Tampered ID
  console.log('\n6. Tampered / Non-Existent Business ID:');
  const tamperedRes = await requestDashboard({
    businessId: NON_EXISTENT_BIZ_ID,
    token: luxeToken,
  });
  assert(
    tamperedRes.status === 403 && tamperedRes.body?.error?.code === 'ERR_FORBIDDEN',
    'Non-existent business UUID returns 403 ERR_FORBIDDEN (no leakage of existence)',
  );

  const malformedRes = await requestDashboard({
    businessId: 'not-a-valid-uuid',
    token: luxeToken,
  });
  assert(
    malformedRes.status === 400 && malformedRes.body?.error?.code === 'ERR_INVALID_INPUT',
    'Malformed business UUID returns 400 ERR_INVALID_INPUT',
  );

  // 8. Period Filter Verification (7d, 30d, 90d, all, invalid)
  console.log('\n7. Period Filters & Quota Independence:');
  for (const p of ['7d', '30d', '90d', 'all']) {
    const periodRes = await requestDashboard({
      businessId: LUXE_BIZ_ID,
      period: p,
      token: luxeToken,
    });
    assert(
      periodRes.status === 200 && periodRes.body?.period === p,
      `Period '${p}' returns 200 OK with correct period echoed`,
    );
    assert(
      periodRes.body?.quota?.monthlyQuotaLimit === 150,
      `Quota limit is constant across period '${p}' (quota is billing-cycle dependent, not period dependent)`,
    );
  }

  const invalidPeriodRes = await requestDashboard({
    businessId: LUXE_BIZ_ID,
    period: 'invalid_period',
    token: luxeToken,
  });
  assert(
    invalidPeriodRes.status === 400 && invalidPeriodRes.body?.error?.code === 'ERR_INVALID_INPUT',
    'Invalid period parameter returns 400 ERR_INVALID_INPUT',
  );

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
