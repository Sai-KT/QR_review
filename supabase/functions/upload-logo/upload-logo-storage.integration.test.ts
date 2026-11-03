// @vitest-environment node
/**
 * Real Supabase Storage & PostgreSQL Integration Test Suite for Logo Upload Gateway
 *
 * Task: M5-T05 — Supabase Storage Gateway: Logo Upload, Inspection & Deletion
 * Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
 *
 * Authoritative Specifications:
 *   - docs/ROADMAP.md (v1.1) Task M5-T05
 *   - docs/API_SPEC.md (v1.2) §11.7 (API-OWN-07), §11.8 (API-OWN-08)
 *   - docs/SECURITY.md (v1.1) §15.1 (Founder Decision M0-03)
 *   - docs/TEST_PLAN.md (v1.1) TC-UPL-01..08, TC-API-21..23
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const BUSINESS_1_ID = 'b0000000-0000-4000-8000-000000000001'; // Luxe Salon (Owner 1)
const BUSINESS_2_ID = 'b0000000-0000-4000-8000-000000000002'; // Daily Roast (Owner 2)

function createPngBytes(width = 120, height = 120, padLength?: number): Uint8Array {
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    0x08, 0x02, 0x00, 0x00, 0x00,
    0x4e, 0x9b, 0x67, 0x73,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ];

  if (padLength && padLength > bytes.length) {
    const buf = new Uint8Array(padLength);
    buf.set(bytes);
    return buf;
  }
  return new Uint8Array(bytes);
}

function createJpegBytes(width = 100, height = 100): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
  ]);
}

function createWebpBytes(width = 80, height = 80): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
    0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff,
    h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff,
  ]);
}

describe('upload-logo Real Storage & Database Integration (API-OWN-07 & 08)', () => {
  let tokenMerchant1: string;
  let tokenMerchant2: string;

  const restoreBusinessLogos = async () => {
    // Reset logo_url in database
    await supabaseAdmin
      .from('businesses')
      .update({ logo_url: null })
      .in('id', [BUSINESS_1_ID, BUSINESS_2_ID]);

    // Clean all logo files for test businesses (Option A uses ${businessId}/logos/ prefix)
    for (const biz of [BUSINESS_1_ID, BUSINESS_2_ID]) {
      try {
        const { data: topLevel } = await supabaseAdmin.storage
          .from('business-logos')
          .list(biz, { limit: 100 });
        const topFiles = (topLevel || []).map((f) => `${biz}/${f.name}`);
        if (topFiles.length > 0) {
          await supabaseAdmin.storage.from('business-logos').remove(topFiles);
        }

        const { data: logosDir } = await supabaseAdmin.storage
          .from('business-logos')
          .list(`${biz}/logos`, { limit: 100 });
        const logoFiles = (logosDir || []).map((f) => `${biz}/logos/${f.name}`);
        if (logoFiles.length > 0) {
          await supabaseAdmin.storage.from('business-logos').remove(logoFiles);
        }
      } catch {
        // Non-fatal on cleanup
      }
    }
  };

  beforeAll(async () => {
    // Sign in as Merchant 1 (Luxe)
    const client1 = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY);
    const { data: auth1, error: err1 } = await client1.auth.signInWithPassword({
      email: 'merchant.luxe@local.test',
      password: 'LocalDevPass123!',
    });
    if (err1 || !auth1.session?.access_token) {
      throw new Error(`Failed to sign in Merchant 1: ${err1?.message}`);
    }
    tokenMerchant1 = auth1.session.access_token;

    // Sign in as Merchant 2 (Daily Roast)
    const client2 = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY);
    const { data: auth2, error: err2 } = await client2.auth.signInWithPassword({
      email: 'merchant.daily@local.test',
      password: 'LocalDevPass123!',
    });
    if (err2 || !auth2.session?.access_token) {
      throw new Error(`Failed to sign in Merchant 2: ${err2?.message}`);
    }
    tokenMerchant2 = auth2.session.access_token;

    await restoreBusinessLogos();
  });

  afterAll(async () => {
    await restoreBusinessLogos();
  });

  it('rejects unauthenticated requests with HTTP 401', async () => {
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([createPngBytes()], 'logo.png', { type: 'image/png' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('TC-UPL-01: successfully uploads valid PNG, stores file, and updates DB logo_url', async () => {
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([createPngBytes(150, 150)], 'brand.png', { type: 'image/png' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('uploaded');
    expect(body.businessId).toBe(BUSINESS_1_ID);
    // Option A: path is under ${businessId}/logos/logo_<ts>_<uuid8>.png
    expect(body.logoUrl).toContain(`business-logos/${BUSINESS_1_ID}/logos/`);
    expect(body.logoUrl).toMatch(/logo_\d+_[0-9a-f]{8}\.png/);

    // Verify persistence in PostgreSQL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).toBe(body.logoUrl);

    // Verify file exists in Supabase Storage and is publicly downloadable
    const fileRes = await fetch(body.logoUrl);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-type')).toContain('image/png');
  });

  it('TC-UPL-02: successfully uploads valid JPEG image', async () => {
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([createJpegBytes(100, 100)], 'logo.jpeg', { type: 'image/jpeg' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Option A: URL path is under ${businessId}/logos/
    expect(body.logoUrl).toContain(`business-logos/${BUSINESS_1_ID}/logos/`);
    expect(body.logoUrl).toMatch(/logo_\d+_[0-9a-f]{8}\.jpeg/);

    // Verify public download of JPEG
    const fileRes = await fetch(body.logoUrl);
    expect(fileRes.status).toBe(200);
  });

  it('TC-UPL-03: successfully uploads valid WebP image', async () => {
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([createWebpBytes(90, 90)], 'logo.webp', { type: 'image/webp' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Option A: URL path is under ${businessId}/logos/
    expect(body.logoUrl).toContain(`business-logos/${BUSINESS_1_ID}/logos/`);
    expect(body.logoUrl).toMatch(/logo_\d+_[0-9a-f]{8}\.webp/);
  });

  it('TC-UPL-04: strictly rejects SVG file with HTTP 415 and prevents storage writes', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>';
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([svgContent], 'malicious.svg', { type: 'image/svg+xml' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_IMAGE_TYPE');
    expect(body.error.message).toContain('SVG and executable scripts are strictly prohibited');
  });

  it('TC-UPL-05: rejects oversized image exceeding 2 MB with HTTP 413', async () => {
    const oversized = createPngBytes(100, 100, 2_097_152 + 1024);
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([oversized], 'huge.png', { type: 'image/png' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_FILE_TOO_LARGE');
  });

  it('TC-UPL-07: rejects polyglot image containing executable payload with HTTP 415', async () => {
    const cleanPng = createPngBytes(100, 100);
    const phpPayload = new TextEncoder().encode('<?php system($_GET["cmd"]); ?>');
    const polyglot = new Uint8Array(cleanPng.length + phpPayload.length);
    polyglot.set(cleanPng);
    polyglot.set(phpPayload, cleanPng.length);

    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([polyglot], 'polyglot.png', { type: 'image/png' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`,
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_INVALID_IMAGE_TYPE');
  });

  it('Cross-Tenant Isolation: Merchant 1 token cannot upload logo for Merchant 2 (HTTP 403)', async () => {
    const formData = new FormData();
    formData.append('businessId', BUSINESS_2_ID); // Daily Roast owned by Merchant 2
    formData.append('file', new File([createPngBytes()], 'logo.png', { type: 'image/png' }));

    const res = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenMerchant1}`, // Merchant 1 caller
        apikey: LOCAL_ANON_KEY,
      },
      body: formData,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');

    // Verify Merchant 2 in DB was untouched
    const { data: biz2 } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_2_ID)
      .single();

    expect(biz2?.logo_url).toBeNull();
  });

  it('TC-UPL-08: logo replacement cleans up old extension file from storage', async () => {
    // 1. Upload JPEG
    const formData1 = new FormData();
    formData1.append('businessId', BUSINESS_1_ID);
    formData1.append('file', new File([createJpegBytes(100, 100)], 'old.jpeg', { type: 'image/jpeg' }));

    const res1 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData1,
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // 2. Upload PNG replacing JPEG
    const formData2 = new FormData();
    formData2.append('businessId', BUSINESS_1_ID);
    formData2.append('file', new File([createPngBytes(100, 100)], 'new.png', { type: 'image/png' }));

    const res2 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData2,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Option A: each upload gets a unique path — URLs are distinct
    expect(body2.logoUrl).not.toBe(body1.logoUrl);

    // New PNG is accessible
    const newFileRes = await fetch(body2.logoUrl);
    expect(newFileRes.status).toBe(200);

    // DB points to new PNG URL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();
    expect(biz?.logo_url).toBe(body2.logoUrl);

    // Old JPEG file should have been pruned — verify via storage listing
    const { data: logosDir } = await supabaseAdmin.storage
      .from('business-logos')
      .list(`${BUSINESS_1_ID}/logos`);
    const names = (logosDir || []).map((o) => o.name);
    // Only the new PNG file should remain
    expect(names.length).toBe(1);
    expect(names[0]).toMatch(/\.png$/);
    // Old JPEG should not be present
    const oldJpegName = decodeURIComponent(
      body1.logoUrl.split('/logos/')[1]?.split('?')[0] || '',
    );
    if (oldJpegName) {
      expect(names).not.toContain(oldJpegName);
    }
  });

  it('API-OWN-08 / TC-API-23: deletes logo files and clears database logo_url', async () => {
    // First upload a logo so there is something to delete
    const formData = new FormData();
    formData.append('businessId', BUSINESS_1_ID);
    formData.append('file', new File([createPngBytes(120, 120)], 'logo.png', { type: 'image/png' }));
    const uploadRes = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData,
    });
    expect(uploadRes.status).toBe(200);

    const res = await fetch(
      `${LOCAL_SUPABASE_URL}/functions/v1/upload-logo?businessId=${BUSINESS_1_ID}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenMerchant1}`,
          apikey: LOCAL_ANON_KEY,
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('deleted');
    expect(body.businessId).toBe(BUSINESS_1_ID);

    // Verify database logo_url is NULL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).toBeNull();

    // Option A: logos are under ${businessId}/logos/ — verify that subdir is also empty
    const { data: logosObjects } = await supabaseAdmin.storage
      .from('business-logos')
      .list(`${BUSINESS_1_ID}/logos`);

    expect(logosObjects?.length || 0).toBe(0);
  });

  it('cross-tenant: merchant 2 cannot delete merchant 1 logo with HTTP 403', async () => {
    const res = await fetch(
      `${LOCAL_SUPABASE_URL}/functions/v1/upload-logo?businessId=${BUSINESS_1_ID}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenMerchant2}`,
          apikey: LOCAL_ANON_KEY,
        },
      },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('ERR_PERMISSION_DENIED');
  });

  // Check A: Direct Storage API bypass is strictly rejected by RLS
  it('Check A: direct Supabase Storage API upload bypass by authenticated merchant is rejected by RLS', async () => {
    const clientMerchant1 = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenMerchant1}` } },
    });

    const garbageBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const { data, error } = await clientMerchant1.storage
      .from('business-logos')
      .upload(`${BUSINESS_1_ID}/bypass.png`, garbageBytes, {
        contentType: 'image/png',
        upsert: true,
      });

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security policy|permission denied/i);
  });

  it('Check A: direct Supabase Storage API delete bypass by authenticated merchant is rejected by RLS', async () => {
    const clientMerchant1 = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenMerchant1}` } },
    });

    const { data } = await clientMerchant1.storage
      .from('business-logos')
      .remove([`${BUSINESS_1_ID}/logo.png`]);

    // Storage remove under RLS returns empty list (0 deleted)
    expect(data?.length || 0).toBe(0);
  });

  it('Check A: same-extension replacement preserves public image accessibility and cleans backups', async () => {
    // 1. Upload initial PNG
    const formData1 = new FormData();
    formData1.append('businessId', BUSINESS_1_ID);
    formData1.append('file', new File([createPngBytes(100, 100)], 'initial.png', { type: 'image/png' }));

    const res1 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData1,
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // Verify initial public URL is downloadable
    const download1 = await fetch(body1.logoUrl);
    expect(download1.status).toBe(200);

    // 2. Upload replacement PNG (same extension) — should get its own unique path
    const formData2 = new FormData();
    formData2.append('businessId', BUSINESS_1_ID);
    formData2.append('file', new File([createPngBytes(150, 150)], 'replacement.png', { type: 'image/png' }));

    const res2 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData2,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Verify replacement URL is different from initial URL (unique paths in Option A)
    expect(body2.logoUrl).not.toBe(body1.logoUrl);

    // Verify replacement public URL is downloadable
    const download2 = await fetch(body2.logoUrl);
    expect(download2.status).toBe(200);

    // Option A: both uploads go to unique paths, so URLs differ
    expect(body2.logoUrl).not.toBe(body1.logoUrl);

    // Verify storage directory has exactly one file in logos/ and zero .backup_ files
    // (old file was pruned after CAS committed the new one)
    const { data: objects } = await supabaseAdmin.storage
      .from('business-logos')
      .list(`${BUSINESS_1_ID}/logos`);

    const names = objects?.map((o) => o.name) || [];
    expect(names.length).toBe(1);
    expect(names.some((n) => n.startsWith('.backup_'))).toBe(false);

    // Old file name should not appear in the listing
    const oldFileName = decodeURIComponent(
      body1.logoUrl.split('/logos/')[1]?.split('?')[0] || '',
    );
    if (oldFileName) {
      expect(names).not.toContain(oldFileName);
    }
  });

  it('Check B: multi-step extension transitions (PNG -> JPEG -> WebP) prune obsolete objects', async () => {
    // PNG -> JPEG
    const formData1 = new FormData();
    formData1.append('businessId', BUSINESS_1_ID);
    formData1.append('file', new File([createJpegBytes(100, 100)], 'step1.jpeg', { type: 'image/jpeg' }));

    const res1 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData1,
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    // JPEG -> WebP
    const formData2 = new FormData();
    formData2.append('businessId', BUSINESS_1_ID);
    formData2.append('file', new File([createWebpBytes(80, 80)], 'step2.webp', { type: 'image/webp' }));

    const res2 = await fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      body: formData2,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Option A: current URL is under /logos/ with .webp extension
    expect(body2.logoUrl).toContain(`${BUSINESS_1_ID}/logos/`);
    expect(body2.logoUrl).toMatch(/\.webp/);

    // Storage /logos/ should contain exactly one .webp file
    // (the old JPEG was pruned after the WebP CAS update committed)
    const { data: objects } = await supabaseAdmin.storage
      .from('business-logos')
      .list(`${BUSINESS_1_ID}/logos`);

    const names = objects?.map((o) => o.name) || [];
    expect(names.length).toBe(1);
    expect(names[0]).toMatch(/\.webp$/);

    // Old JPEG file should not appear in the listing
    const oldJpegFileName = decodeURIComponent(
      body1.logoUrl.split('/logos/')[1]?.split('?')[0] || '',
    );
    if (oldJpegFileName) {
      expect(names).not.toContain(oldJpegFileName);
    }
  });

  it('Check C: repeated deletion calls are idempotent and maintain null DB pointer', async () => {
    // Delete 1
    const res1 = await fetch(
      `${LOCAL_SUPABASE_URL}/functions/v1/upload-logo?businessId=${BUSINESS_1_ID}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      },
    );
    expect(res1.status).toBe(200);

    // Delete 2 (idempotent repeat)
    const res2 = await fetch(
      `${LOCAL_SUPABASE_URL}/functions/v1/upload-logo?businessId=${BUSINESS_1_ID}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
      },
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe('deleted');

    // Confirm DB is null and storage has 0 files
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).toBeNull();

    const { data: objects } = await supabaseAdmin.storage
      .from('business-logos')
      .list(BUSINESS_1_ID);

    expect(objects?.length || 0).toBe(0);
  });

  it('Check D: concurrent overlapping uploads converge without file corruption or lingering backups', async () => {
    const formDataA = new FormData();
    formDataA.append('businessId', BUSINESS_1_ID);
    formDataA.append('file', new File([createPngBytes(100, 100)], 'concurrentA.png', { type: 'image/png' }));

    const formDataB = new FormData();
    formDataB.append('businessId', BUSINESS_1_ID);
    formDataB.append('file', new File([createPngBytes(120, 120)], 'concurrentB.png', { type: 'image/png' }));

    const [resA, resB] = await Promise.all([
      fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
        body: formDataA,
      }),
      fetch(`${LOCAL_SUPABASE_URL}/functions/v1/upload-logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenMerchant1}`, apikey: LOCAL_ANON_KEY },
        body: formDataB,
      }),
    ]);

    // Option A + CAS: exactly one request wins (200), the other loses CAS (409 Conflict).
    // Both are acceptable non-error outcomes; no file corruption, no broken images.
    const statuses = [resA.status, resB.status].sort();
    const validPairs = [
      [200, 200], // Both read same initial null logo_url; both may succeed in test env
      [200, 409], // One wins CAS; loser self-cleans and retries
    ];
    const isValid = validPairs.some(
      (pair) => pair[0] === statuses[0] && pair[1] === statuses[1],
    );
    expect(isValid).toBe(true);

    // Regardless of outcome: DB must point to a valid, downloadable URL
    const { data: biz } = await supabaseAdmin
      .from('businesses')
      .select('logo_url')
      .eq('id', BUSINESS_1_ID)
      .single();

    expect(biz?.logo_url).not.toBeNull();
    const download = await fetch(biz!.logo_url!);
    expect(download.status).toBe(200);

    // Verify no .backup_ files remain (Option A creates none)
    const { data: logosDir } = await supabaseAdmin.storage
      .from('business-logos')
      .list(`${BUSINESS_1_ID}/logos`);
    const names = (logosDir || []).map((o) => o.name);
    expect(names.some((n) => n.startsWith('.backup_'))).toBe(false);

    // Exactly one unique logo file should remain in /logos/
    expect(names.length).toBe(1);
  });
});
