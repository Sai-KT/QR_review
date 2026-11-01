import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

/**
 * Strict Local Test Endpoint Validator
 *
 * Enforces fail-closed security invariants:
 * 1. Protocol must be strictly 'http:' (remote Supabase projects strictly require https:).
 * 2. Hostname must be strictly '127.0.0.1' or 'localhost' (exact match; rejecting subdomains, suffixes, and nip.io).
 * 3. Port must be strictly '54321' (standard local Supabase CLI Kong API gateway port).
 * 4. URL must not contain userinfo (username or password spoofing).
 * 5. Fails closed on any parse error, null, empty, or undefined input.
 */
export function isStrictLocalTestEndpoint(rawUrl: string | undefined | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return false;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);

    // Protocol must be unencrypted local HTTP
    if (parsed.protocol !== 'http:') {
      return false;
    }

    // Hostname must be strictly loopback
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return false;
    }

    // Port must strictly match local Supabase CLI Kong gateway (54321)
    if (parsed.port !== '54321') {
      return false;
    }

    // Reject userinfo spoofing (e.g. http://attacker:pass@localhost:54321)
    if (parsed.username !== '' || parsed.password !== '') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that the provided service role secret is strictly the local Supabase demo key.
 * Remote projects use production JWTs with project-specific issuers.
 */
export function isLocalDemoServiceKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  const parts = key.trim().split('.');
  if (parts.length !== 3) {
    return false;
  }

  try {
    const payloadJson = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);
    return (
      payload &&
      payload.iss === 'supabase-demo' &&
      payload.role === 'service_role'
    );
  } catch {
    return false;
  }
}

/**
 * Computes exact daily rate-limit key hashes strictly for local runner loopback IPs.
 */
export function computeLocalTestKeyHashes(masterSecret?: string): string[] {
  const secret =
    masterSecret ||
    process.env.RATE_LIMIT_SALT ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const todayStr = new Date().toISOString().slice(0, 10);
  const dailySalt = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`qr_rate_limit_salt:${todayStr}`)
    .digest('hex');

  // Exact local loopback and Docker bridge gateway IPs
  const localIps = ['127.0.0.1', '172.18.0.1', '172.17.0.1'];
  return localIps.map((ip) =>
    createHmac('sha256', Buffer.from(dailySalt, 'hex'))
      .update(`qr_ip:${ip}`)
      .digest('hex'),
  );
}

/**
 * Safely resets rate limit events ONLY for local runner loopback hashes.
 * Fails closed if the endpoint or credentials cannot be verified as strictly local.
 */
export async function performSafeLocalRateLimitReset(
  customClient?: SupabaseClient,
  customDbUrl?: string,
  customServiceKey?: string,
): Promise<{ success: boolean; reason?: string }> {
  const dbUrl = customDbUrl || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
  const serviceKey =
    customServiceKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

  // 1. Strict Fail-Closed Endpoint Check
  if (!isStrictLocalTestEndpoint(dbUrl)) {
    return {
      success: false,
      reason: `Refusing cleanup: Database URL "${dbUrl}" is not an authorized local test endpoint.`,
    };
  }

  // 2. Strict Fail-Closed Service Key Check
  if (!isLocalDemoServiceKey(serviceKey)) {
    return {
      success: false,
      reason: 'Refusing cleanup: Service role key is not an authorized local demo key.',
    };
  }

  // 3. Perform Targeted Local IP Hash Deletion
  try {
    const client = customClient || createClient(dbUrl, serviceKey, { auth: { persistSession: false } });
    const targetHashes = computeLocalTestKeyHashes();

    const { error } = await client
      .from('rate_limit_events')
      .delete()
      .in('key_hash', targetHashes);

    if (error) {
      return { success: false, reason: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : 'Unknown exception during cleanup',
    };
  }
}

