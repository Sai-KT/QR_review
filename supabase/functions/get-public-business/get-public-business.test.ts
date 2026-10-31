import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  handleGetPublicBusiness,
  isValidIpv4,
  isValidIpv6,
  extractClientIp,
  deriveDailySalt,
  computeIpHash,
  isUtcMidnightOverlap,
  getRateLimitSalt,
  type PublicBusinessRow,
} from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

// 32-byte (256-bit) test salt encoded as 64 hex characters
const TEST_SALT =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createMockSupabase(params: {
  projectionData?: PublicBusinessRow[] | null;
  dbError?: Error | null;
  rateLimitAllowed?: boolean;
  rateLimitError?: Error | null;
}): SupabaseClient {
  const {
    projectionData = [],
    dbError = null,
    rateLimitAllowed = true,
    rateLimitError = null,
  } = params;

  const mockRpc = vi.fn().mockImplementation((fnName: string) => {
    if (fnName === 'check_exact_rate_limit') {
      return Promise.resolve({
        data: rateLimitAllowed,
        error: rateLimitError,
      });
    }
    if (fnName === 'get_public_business_by_qr') {
      return Promise.resolve({
        data: projectionData,
        error: dbError,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  return {
    rpc: mockRpc,
  } as unknown as SupabaseClient;
}

function makeGetRequest(
  url: string,
  customHeaders: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      ...customHeaders,
    },
  });
}

describe('M3-T01: Edge Function get-public-business (API-PUB-01)', () => {
  const originalSaltEnv = process.env['RATE_LIMIT_SALT'];
  const originalUrlEnv = process.env['SUPABASE_URL'];

  beforeEach(() => {
    process.env['RATE_LIMIT_SALT'] = TEST_SALT;
    process.env['SUPABASE_URL'] = 'http://127.0.0.1:54321';
  });

  afterEach(() => {
    if (originalSaltEnv !== undefined) {
      process.env['RATE_LIMIT_SALT'] = originalSaltEnv;
    } else {
      delete process.env['RATE_LIMIT_SALT'];
    }
    if (originalUrlEnv !== undefined) {
      process.env['SUPABASE_URL'] = originalUrlEnv;
    } else {
      delete process.env['SUPABASE_URL'];
    }
  });

  const mockActiveRow: PublicBusinessRow = {
    public_qr_id: 'luxe000001',
    name: 'Luxe Salon & Spa',
    logo_url: 'https://cdn.example.com/logos/luxe.png',
    category_id: 'salon',
    google_review_url:
      'https://search.google.com/local/writereview?placeid=ChIJ123',
    whatsapp_number: '9876543210',
    account_status: 'active',
    is_active: true,
    subscription_status: 'active',
    is_direct_google_only: false,
    is_suspended: false,
  };

  /* ------------------------------------------------------------------------ */
  /* 1. Core Resolver & Header Invariants (TC-API-01)                         */
  /* ------------------------------------------------------------------------ */

  it('TC-API-01: resolves active business and sets 0-second cache-control', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
    });
    expect(res.status).toBe(200);

    // Dynamic 0-second freshness invariant
    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-cache, no-store, max-age=0, must-revalidate',
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();

    const body = await res.json();
    expect(body.publicQrId).toBe('luxe000001');
    expect(body.name).toBe('Luxe Salon & Spa');
    expect(body.logoUrl).toBe('https://cdn.example.com/logos/luxe.png');
    expect(body.categoryId).toBe('salon');
    expect(body.googleReviewUrl).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJ123',
    );
    expect(body.whatsappNumber).toBe('9876543210');
    expect(body.isActive).toBe(true);
    expect(body.accountStatus).toBe('active');
    expect(body.subscriptionStatus).toBe('active');
    expect(body.isDirectGoogleOnly).toBe(false);

    // Zero-data-leak boundary: internal owner and DB keys must never be projected
    expect('owner_id' in body).toBe(false);
    expect('ownerId' in body).toBe(false);
    expect('place_id' in body).toBe(false);
    expect('googlePlaceId' in body).toBe(false);
    expect('id' in body).toBe(false);
    expect('billing_email' in body).toBe(false);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Not Found & Suspended Invariants (TC-API-02, TC-API-03)               */
  /* ------------------------------------------------------------------------ */

  it('TC-API-02: returns HTTP 404 ERR_QR_NOT_FOUND when token does not match any business', async () => {
    const mockClient = createMockSupabase({ projectionData: [] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=unknown999',
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('ERR_QR_NOT_FOUND');
    expect(body.error.message).toContain('not found');
    expect(body.error.retryable).toBe(false);
  });

  it('TC-API-03: returns HTTP 403 ERR_BUSINESS_SUSPENDED and strips outbound destinations (DEC-M3-05)', async () => {
    const suspendedRow: PublicBusinessRow = {
      ...mockActiveRow,
      account_status: 'suspended',
      is_active: false,
      is_suspended: true,
      google_review_url: null,
      whatsapp_number: null,
    };
    const mockClient = createMockSupabase({ projectionData: [suspendedRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('ERR_BUSINESS_SUSPENDED');
    expect(body.isSuspended).toBe(true);

    // Verify outbound URLs are strictly stripped
    expect(body.googleReviewUrl).toBeUndefined();
    expect(body.whatsappNumber).toBeUndefined();
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Lapsed Subscription / Direct-Only Mode (TC-API-04 / DEC-M3-04)        */
  /* ------------------------------------------------------------------------ */

  it('TC-API-04: returns HTTP 200 with isDirectGoogleOnly = true for lapsed subscription', async () => {
    const lapsedRow: PublicBusinessRow = {
      ...mockActiveRow,
      subscription_status: 'past_due',
      is_direct_google_only: true,
    };
    const mockClient = createMockSupabase({ projectionData: [lapsedRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isDirectGoogleOnly).toBe(true);
    expect(body.subscriptionStatus).toBe('past_due');
    // Google review link is preserved for direct Google handoff (SCR-CUST-14)
    expect(body.googleReviewUrl).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJ123',
    );
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Public API Authentication & Cryptographic Verification                */
  /* ------------------------------------------------------------------------ */

  const TEST_JWT_SECRET = 'test-jwt-secret-for-signing-unit-tests-12345';
  const VALID_CONFIGURED_KEY = 'sb_publishable_my_project_valid_key_001';

  function makeTestJwt(payload: Record<string, unknown>, secret: string): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  it('1. accepts genuine configured publishable key', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: VALID_CONFIGURED_KEY },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(200);
  });

  it('2. rejects requests missing the apikey header with HTTP 401 ERR_UNAUTHORIZED', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = new Request(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      {
        method: 'GET',
        headers: {}, // No apikey
      },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('3. rejects arbitrary invalid apikey strings with HTTP 401', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: 'fake-invalid-string-12345' },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('4. rejects random syntactically valid sb_publishable_... key not matching project', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: 'sb_publishable_attacker_random_token_99999' },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('5. rejects valid publishable key belonging to a different project', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: 'sb_publishable_another_legit_project_888' },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('6. rejects elevated service role key on public anonymous endpoint with HTTP 401', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const originalServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-secret-key-do-not-leak';

    try {
      const req = makeGetRequest(
        'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
        { apikey: 'service-role-secret-key-do-not-leak' },
      );

      const res = await handleGetPublicBusiness(req, {
        supabaseClient: mockClient,
        rateLimitSalt: TEST_SALT,
        expectedApiKey: VALID_CONFIGURED_KEY,
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_UNAUTHORIZED');
    } finally {
      if (originalServiceKey !== undefined) {
        process.env['SUPABASE_SERVICE_ROLE_KEY'] = originalServiceKey;
      } else {
        delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
      }
    }
  });

  it('7. rejects malformed JWT strings with HTTP 401', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: 'header.payload' }, // missing signature
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('8. rejects forged or incorrectly signed JWT with HTTP 401', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const forgedToken = makeTestJwt(
      { sub: 'attacker-uuid', role: 'anon', exp: Math.floor(Date.now() / 1000) + 3600 },
      'wrong-signing-secret-attacker',
    );

    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      { apikey: forgedToken },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('9. accepts valid user JWT signed by project JWT secret', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const validUserJwt = makeTestJwt(
      { sub: '00000000-0000-4000-8000-000000000002', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      TEST_JWT_SECRET,
    );

    const req = new Request(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      {
        method: 'GET',
        headers: {
          apikey: VALID_CONFIGURED_KEY,
          Authorization: `Bearer ${validUserJwt}`,
        },
      },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
      jwtSecret: TEST_JWT_SECRET,
    });
    expect(res.status).toBe(200);
  });

  it('10. accepts genuine publishable key passed in Authorization: Bearer', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });
    const req = new Request(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${VALID_CONFIGURED_KEY}`,
        },
      },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
      expectedApiKey: VALID_CONFIGURED_KEY,
    });
    expect(res.status).toBe(200);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Canonical QR ID Validation (DEC-M3-03)                                */
  /* ------------------------------------------------------------------------ */

  it('rejects vanity slugs, uppercase, and non-10-char identifiers with HTTP 400', async () => {
    const mockClient = createMockSupabase({ projectionData: [mockActiveRow] });

    // Vanity slug with hyphen (DEC-M3-03: vanity slugs are not public QR IDs)
    const reqSlug = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe-studio',
    );
    const resSlug = await handleGetPublicBusiness(reqSlug, {
      supabaseClient: mockClient,
    });
    expect(resSlug.status).toBe(400);

    // Uppercase identifier
    const reqUpper = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=LUXE000001',
    );
    const resUpper = await handleGetPublicBusiness(reqUpper, {
      supabaseClient: mockClient,
    });
    expect(resUpper.status).toBe(400);

    // Too short (9 chars)
    const reqShort = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe00001',
    );
    const resShort = await handleGetPublicBusiness(reqShort, {
      supabaseClient: mockClient,
    });
    expect(resShort.status).toBe(400);

    // Too long (11 chars)
    const reqLong = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe0000001',
    );
    const resLong = await handleGetPublicBusiness(reqLong, {
      supabaseClient: mockClient,
    });
    expect(resLong.status).toBe(400);

    // Missing parameter
    const reqMissing = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business',
    );
    const resMissing = await handleGetPublicBusiness(reqMissing, {
      supabaseClient: mockClient,
    });
    expect(resMissing.status).toBe(400);
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Exact Rolling-Window Rate Limiting (DEC-M3-01 / Work Package D)       */
  /* ------------------------------------------------------------------------ */

  it('enforces exact rate limiting and returns HTTP 429 with Retry-After: 60', async () => {
    const mockClient = createMockSupabase({
      projectionData: [mockActiveRow],
      rateLimitAllowed: false,
    });
    const req = makeGetRequest(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      {
        'x-real-ip': '203.0.113.195',
      },
    );

    const res = await handleGetPublicBusiness(req, {
      supabaseClient: mockClient,
      rateLimitSalt: TEST_SALT,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');

    const body = await res.json();
    expect(body.error.code).toBe('ERR_RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* 7. IP Address Normalization & Validation (Work Package E)                */
  /* ------------------------------------------------------------------------ */

  describe('IP Validation and Extraction', () => {
    it('validates standard IPv4 addresses correctly', () => {
      expect(isValidIpv4('192.168.1.1')).toBe(true);
      expect(isValidIpv4('0.0.0.0')).toBe(true);
      expect(isValidIpv4('255.255.255.255')).toBe(true);
      // Invalid octets
      expect(isValidIpv4('256.0.0.1')).toBe(false);
      expect(isValidIpv4('192.168.1')).toBe(false);
      expect(isValidIpv4('192.168.1.1.1')).toBe(false);
      // Rejects leading zeros (octal ambiguity prevention)
      expect(isValidIpv4('192.168.01.1')).toBe(false);
      expect(isValidIpv4('192.168.001.1')).toBe(false);
    });

    it('validates IPv6 addresses correctly', () => {
      expect(isValidIpv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
        true,
      );
      expect(isValidIpv6('2001:db8::1')).toBe(true);
      expect(isValidIpv6('::1')).toBe(true);
      // Invalid IPv6
      expect(isValidIpv6('2001:db8:::1')).toBe(false); // triple colon
      expect(isValidIpv6('192.168.1.1')).toBe(false);
    });

    it('normalizes IPv4-mapped IPv6 addresses from x-real-ip', () => {
      const req = makeGetRequest('https://example.com', {
        'x-real-ip': '::ffff:192.0.2.128',
      });
      expect(extractClientIp(req)).toBe('192.0.2.128');
    });

    it('prioritizes x-real-ip over client-supplied cf-connecting-ip or x-forwarded-for', () => {
      const req = makeGetRequest('https://example.com', {
        'x-real-ip': '198.51.100.99',
        'cf-connecting-ip': 'spoofed.ip.attacker',
        'x-forwarded-for': 'spoofed.ip.attacker2, 10.0.0.1',
      });
      expect(extractClientIp(req)).toBe('198.51.100.99');
    });

    it('discards forged cf-connecting-ip when TRUST_CLOUDFLARE_PROXY is enabled but connecting peer is not Cloudflare', () => {
      const origTrust = process.env['TRUST_CLOUDFLARE_PROXY'];
      process.env['TRUST_CLOUDFLARE_PROXY'] = 'true';
      try {
        const req = makeGetRequest('https://example.com', {
          'x-real-ip': '172.18.0.1', // Non-Cloudflare direct connection
          'cf-connecting-ip': '198.51.100.42', // Attacker attempt to forge client IP
        });
        // Must reject cf-connecting-ip and use verified connection IP
        expect(extractClientIp(req)).toBe('172.18.0.1');
      } finally {
        if (origTrust !== undefined) process.env['TRUST_CLOUDFLARE_PROXY'] = origTrust;
        else delete process.env['TRUST_CLOUDFLARE_PROXY'];
      }
    });

    it('accepts cf-connecting-ip when TRUST_CLOUDFLARE_PROXY is enabled and connecting peer is authentic Cloudflare proxy CIDR', () => {
      const origTrust = process.env['TRUST_CLOUDFLARE_PROXY'];
      process.env['TRUST_CLOUDFLARE_PROXY'] = 'true';
      try {
        const req = makeGetRequest('https://example.com', {
          'x-real-ip': '162.158.25.10', // Authentic Cloudflare IPv4 CIDR (162.158.0.0/15)
          'cf-connecting-ip': '203.0.113.88', // Authentic patron IP
        });
        expect(extractClientIp(req)).toBe('203.0.113.88');
      } finally {
        if (origTrust !== undefined) process.env['TRUST_CLOUDFLARE_PROXY'] = origTrust;
        else delete process.env['TRUST_CLOUDFLARE_PROXY'];
      }
    });

    it('ignores cf-connecting-ip when TRUST_CLOUDFLARE_PROXY is disabled even from Cloudflare peer', () => {
      const origTrust = process.env['TRUST_CLOUDFLARE_PROXY'];
      delete process.env['TRUST_CLOUDFLARE_PROXY'];
      try {
        const req = makeGetRequest('https://example.com', {
          'x-real-ip': '162.158.25.10',
          'cf-connecting-ip': '203.0.113.88',
        });
        // When not trusting CF proxy, always use direct peer
        expect(extractClientIp(req)).toBe('162.158.25.10');
      } finally {
        if (origTrust !== undefined) process.env['TRUST_CLOUDFLARE_PROXY'] = origTrust;
        else delete process.env['TRUST_CLOUDFLARE_PROXY'];
      }
    });

    it('evaluates rightmost IP from x-forwarded-for to prevent leftmost client spoofing', () => {
      const req = makeGetRequest('https://example.com', {
        'x-forwarded-for': '198.51.100.1, 10.0.0.1, 192.0.2.55',
      });
      expect(extractClientIp(req)).toBe('192.0.2.55');
    });

    it('strips port from IPv4 address', () => {
      const req = makeGetRequest('https://example.com', {
        'x-real-ip': '198.51.100.22:443',
      });
      expect(extractClientIp(req)).toBe('198.51.100.22');
    });

    it('rejects malformed client IP with HTTP 400', async () => {
      const mockClient = createMockSupabase({
        projectionData: [mockActiveRow],
      });
      const req = makeGetRequest(
        'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
        {
          'x-real-ip': 'invalid-malformed-ip',
        },
      );

      const res = await handleGetPublicBusiness(req, {
        supabaseClient: mockClient,
        rateLimitSalt: TEST_SALT,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ERR_INVALID_PAYLOAD');
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 8. Master Secret & Key Derivation (Work Package E & F)                   */
  /* ------------------------------------------------------------------------ */

  describe('Master Secret & Salt Derivation', () => {
    it('throws sanitized configuration error when RATE_LIMIT_SALT is invalid', () => {
      expect(() => getRateLimitSalt('too-short')).toThrow(/ERR_CRYPTO_CONFIG/);
      expect(() =>
        getRateLimitSalt(
          'not-hex-chars-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        ),
      ).toThrow(/ERR_CRYPTO_CONFIG/);
    });

    it('derives deterministic daily salts and IP hashes', () => {
      const saltA = deriveDailySalt(TEST_SALT, '2026-11-01');
      const saltB = deriveDailySalt(TEST_SALT, '2026-11-01');
      const saltC = deriveDailySalt(TEST_SALT, '2026-11-02');
      expect(saltA).toBe(saltB);
      expect(saltA).not.toBe(saltC);

      const hash1 = computeIpHash(saltA, '192.0.2.1');
      const hash2 = computeIpHash(saltA, '192.0.2.1');
      const hash3 = computeIpHash(saltA, '192.0.2.2');
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('identifies UTC midnight overlap window correctly', () => {
      // 00:05:00 UTC (inside 630-second overlap window)
      const dateInOverlap = new Date('2026-11-01T00:05:00.000Z');
      expect(isUtcMidnightOverlap(dateInOverlap)).toBe(true);

      // 00:10:00 UTC (600s, inside 630s window)
      const dateAt10m = new Date('2026-11-01T00:10:00.000Z');
      expect(isUtcMidnightOverlap(dateAt10m)).toBe(true);

      // 00:11:00 UTC (660s, outside overlap window)
      const dateOutside = new Date('2026-11-01T00:11:00.000Z');
      expect(isUtcMidnightOverlap(dateOutside)).toBe(false);

      // 12:00:00 UTC (noon, outside overlap window)
      const dateNoon = new Date('2026-11-01T12:00:00.000Z');
      expect(isUtcMidnightOverlap(dateNoon)).toBe(false);
    });

    it('supplies previous day key hash during UTC midnight overlap', async () => {
      const mockClient = createMockSupabase({
        projectionData: [mockActiveRow],
      });
      const req = makeGetRequest(
        'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
        {
          'x-real-ip': '203.0.113.10',
        },
      );

      // Execute request at 00:03 UTC
      const dateAtMidnight = new Date('2026-11-01T00:03:00.000Z');
      await handleGetPublicBusiness(req, {
        supabaseClient: mockClient,
        rateLimitSalt: TEST_SALT,
        currentTime: dateAtMidnight,
      });

      // Verify check_exact_rate_limit was called with p_prev_key_hash populated
      expect(mockClient.rpc).toHaveBeenCalledWith(
        'check_exact_rate_limit',
        expect.objectContaining({
          p_key_hash: expect.any(String),
          p_prev_key_hash: expect.any(String),
          p_max_requests: 60,
          p_window_seconds: 600,
        }),
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 9. HTTP Methods & CORS                                                    */
  /* ------------------------------------------------------------------------ */

  it('handles CORS OPTIONS preflight with HTTP 204', async () => {
    const req = new Request(
      'https://edge.example.com/functions/v1/get-public-business',
      {
        method: 'OPTIONS',
      },
    );

    const res = await handleGetPublicBusiness(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('rejects unsupported HTTP methods with HTTP 405 Method Not Allowed', async () => {
    const req = new Request(
      'https://edge.example.com/functions/v1/get-public-business?qrId=luxe000001',
      {
        method: 'POST',
        headers: { apikey: 'test' },
        body: JSON.stringify({ test: true }),
      },
    );

    const res = await handleGetPublicBusiness(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_METHOD_NOT_ALLOWED');
    expect(res.headers.get('Allow')).toContain('GET');
  });
});
