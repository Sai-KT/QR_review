-- ============================================================================
-- QR_review — Supabase Storage Security Hardening Migration
-- Migration: 20261103160000_storage_lock_down_direct_merchant_access.sql
-- Milestone: M5 — Merchant Owner Portal & Digital QR Sharing
-- Task: M5-T05 — Supabase Storage Gateway: Logo Upload, Inspection & Deletion
-- Target System: PostgreSQL 17 / Supabase Storage Engine
--
-- Authoritative Specifications & Security Mandates:
--   - docs/SECURITY.md §15.1 (Founder Decision M0-03)
--   - docs/API_SPEC.md §11.7 (API-OWN-07), §11.8 (API-OWN-08)
--   - docs/ROADMAP.md Task M5-T05
--
-- Security Objective:
--   Revoke direct storage.objects INSERT, UPDATE, and DELETE policies for
--   authenticated roles. All mutations to 'business-logos' MUST transit through
--   the 'upload-logo' Edge Function (executing with service_role privileges).
--   This guarantees that:
--     1. Binary magic-byte inspection (PNG, JPEG, WebP) cannot be bypassed.
--     2. SVG, HTML scripts, and executable polyglots are strictly rejected.
--     3. Image dimension constraints (<= 2048x2048) and aspect ratio checks are enforced.
--     4. Replacement and deletion atomically update public.businesses.logo_url
--        and enforce tenant ownership verification.
--     5. Public read access ("Public Access: View business logos") remains intact.
-- ============================================================================

-- Drop direct authenticated write policies on storage.objects
DROP POLICY IF EXISTS "Owner Access: Upload business logos" ON storage.objects;
DROP POLICY IF EXISTS "Owner Access: Update business logos" ON storage.objects;
DROP POLICY IF EXISTS "Owner Access: Delete business logos" ON storage.objects;

-- Ensure public read policy remains active for branding delivery
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polrelid = 'storage.objects'::regclass
          AND polname = 'Public Access: View business logos'
    ) THEN
        CREATE POLICY "Public Access: View business logos"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'business-logos');
    END IF;
END $$;

