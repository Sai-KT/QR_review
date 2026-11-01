import { test, expect } from '@playwright/test';
import {
  isStrictLocalTestEndpoint,
  isLocalDemoServiceKey,
  computeLocalTestKeyHashes,
  performSafeLocalRateLimitReset,
} from './test-isolation';

test.describe('M3-T05: Strict Local Test Isolation & Fail-Closed Guard', () => {
  test.describe('isStrictLocalTestEndpoint()', () => {
    test('accepts valid local development endpoints', () => {
      expect(isStrictLocalTestEndpoint('http://127.0.0.1:54321')).toBe(true);
      expect(isStrictLocalTestEndpoint('http://localhost:54321')).toBe(true);
      expect(isStrictLocalTestEndpoint('http://127.0.0.1:54321/')).toBe(true);
    });

    test('rejects HTTPS remote or local URLs (fail-closed)', () => {
      expect(isStrictLocalTestEndpoint('https://127.0.0.1:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('https://localhost:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('https://abc.supabase.co:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('https://project.supabase.co')).toBe(false);
    });

    test('rejects misleading or spoofed hostnames containing localhost or 127.0.0.1', () => {
      expect(isStrictLocalTestEndpoint('http://localhost.attacker.com:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://notlocalhost.com:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://127.0.0.1.attacker.com:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://127.0.0.1.nip.io:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://evil.com/localhost:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://localhost:8000@evil.com:54321')).toBe(false);
    });

    test('rejects incorrect ports', () => {
      expect(isStrictLocalTestEndpoint('http://127.0.0.1:8000')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://127.0.0.1:54322')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://127.0.0.1')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://localhost')).toBe(false);
    });

    test('rejects userinfo credential injection in URL', () => {
      expect(isStrictLocalTestEndpoint('http://attacker:secret@127.0.0.1:54321')).toBe(false);
      expect(isStrictLocalTestEndpoint('http://user:pass@localhost:54321')).toBe(false);
    });

    test('fails closed on null, undefined, empty, or malformed input', () => {
      expect(isStrictLocalTestEndpoint(null)).toBe(false);
      expect(isStrictLocalTestEndpoint(undefined)).toBe(false);
      expect(isStrictLocalTestEndpoint('')).toBe(false);
      expect(isStrictLocalTestEndpoint('   ')).toBe(false);
      expect(isStrictLocalTestEndpoint('not-a-valid-url')).toBe(false);
    });
  });

  test.describe('isLocalDemoServiceKey()', () => {
    test('accepts the canonical local Supabase demo service role JWT', () => {
      const localDemoKey =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
      expect(isLocalDemoServiceKey(localDemoKey)).toBe(true);
    });

    test('rejects non-demo service role keys or tokens without iss=supabase-demo', () => {
      // Mock production JWT with iss: 'supabase'
      const prodHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const prodPayload = Buffer.from(JSON.stringify({ iss: 'supabase', role: 'service_role' })).toString('base64url');
      const prodToken = `${prodHeader}.${prodPayload}.mockSignature`;

      expect(isLocalDemoServiceKey(prodToken)).toBe(false);
      expect(isLocalDemoServiceKey('raw-secret-key-12345')).toBe(false);
      expect(isLocalDemoServiceKey(null)).toBe(false);
      expect(isLocalDemoServiceKey(undefined)).toBe(false);
    });
  });

  test.describe('computeLocalTestKeyHashes()', () => {
    test('produces exactly 3 deterministic 64-char hex hashes for local runner IPs', () => {
      const hashes = computeLocalTestKeyHashes();
      expect(hashes).toHaveLength(3);
      hashes.forEach((hash) => {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      });
    });
  });

  test.describe('performSafeLocalRateLimitReset()', () => {
    test('refuses execution and fails closed when endpoint is remote', async () => {
      const result = await performSafeLocalRateLimitReset(
        undefined,
        'https://my-prod-project.supabase.co:54321',
      );
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not an authorized local test endpoint');
    });

    test('refuses execution and fails closed when service key is invalid or remote', async () => {
      const result = await performSafeLocalRateLimitReset(
        undefined,
        'http://127.0.0.1:54321',
        'invalid.production.jwt',
      );
      expect(result.success).toBe(false);
      expect(result.reason).toContain('not an authorized local demo key');
    });
  });
});

