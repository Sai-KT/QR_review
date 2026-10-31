-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261031220000_survey_responses_session_dedup.sql
-- Task: M3-T03 — Survey Feedback Submission & HMAC Token Issuer
-- Gate: A — Forward-Only Idempotency & Concurrency Guard (Unexecuted Migration)
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M3-T03
--   docs/API_SPEC.md (v1.2) §7.3 (API-PUB-04: Survey Feedback Submission)
--   docs/DATABASE_SCHEMA.md (v1.1) §5.5 (survey_responses)
--   docs/SECURITY.md (v1.1) §8 (Transient Client Session Boundaries)
--   Founder Decision M0-11 (Cryptographic Submission Binding)
--
-- Invariants Enforced:
--   1. Database-Enforced Atomic Idempotency: Eliminates concurrent duplicate
--      insertion races from mobile network retries or browser double-taps.
--   2. Session Scope: Scoped to (business_id, session_uuid), ensuring legitimate
--      subsequent visits with fresh ephemeral scan session UUIDs are never blocked.
--   3. Non-Destructive / Forward-Only: Preserves existing M1/M2 schema and RLS.
-- ============================================================================

-- 1. Create unique index on (business_id, session_uuid) for atomic ON CONFLICT handling
CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_business_session_uq
    ON public.survey_responses (business_id, session_uuid);

COMMENT ON INDEX public.survey_responses_business_session_uq IS
    'Enforces database-level uniqueness on (business_id, session_uuid) to guarantee atomic idempotency and eliminate duplicate submission races (M3-T03).';

