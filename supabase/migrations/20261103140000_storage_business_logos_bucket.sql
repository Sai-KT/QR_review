-- ============================================================================
-- QR_review — Supabase PostgreSQL Storage Migration
-- Migration: 20261103140000_storage_business_logos_bucket.sql
-- Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
-- Task: M5-T05 — Supabase Storage Gateway: Logo Upload, Inspection & Deletion
-- Target System: PostgreSQL 17 / Supabase Storage Local & Cloud Engine
--
-- Authoritative Specifications:
--   - docs/ROADMAP.md (v1.1) Task M5-T05
--   - docs/API_SPEC.md (v1.2) §11.7 (API-OWN-07), §11.8 (API-OWN-08)
--   - docs/SECURITY.md (v1.1) §15.1 (Founder Decision M0-03)
--   - docs/TEST_PLAN.md (v1.1) TC-UPL-01..08, TC-API-21..23
--
-- Capabilities:
--   1. Provisions storage bucket 'business-logos' with public read access.
--   2. Enforces maximum 2 MB (2,097,152 bytes) upload size limit at storage boundary.
--   3. Restricts allowed MIME types strictly to PNG, JPEG, and WebP (SVG prohibited).
--   4. Configures defense-in-depth storage RLS policies restricting mutations to tenant owners.
-- ============================================================================

-- 1. Create or update storage bucket: business-logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'business-logos',
    'business-logos',
    true, -- Public read for customer QR survey branding and dashboard preview
    2097152, -- 2 MB limit (2,097,152 bytes)
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage RLS Policies for Defense-in-Depth

-- Policy A: Public read access for logos in 'business-logos' bucket
DROP POLICY IF EXISTS "Public Access: View business logos" ON storage.objects;
CREATE POLICY "Public Access: View business logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'business-logos');

-- Policy B: Authenticated owner insert access
-- Restricts insertion to the caller's tenant folder (${businessId}/...)
DROP POLICY IF EXISTS "Owner Access: Upload business logos" ON storage.objects;
CREATE POLICY "Owner Access: Upload business logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
);

-- Policy C: Authenticated owner update access
DROP POLICY IF EXISTS "Owner Access: Update business logos" ON storage.objects;
CREATE POLICY "Owner Access: Update business logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
);

-- Policy D: Authenticated owner delete access
DROP POLICY IF EXISTS "Owner Access: Delete business logos" ON storage.objects;
CREATE POLICY "Owner Access: Delete business logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'business-logos'
    AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (storage.foldername(name))[1]::uuid IN (
        SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
);
