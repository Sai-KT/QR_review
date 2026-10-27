-- Migration: 20261027163923_core_tables.sql
-- Task: M2-T02 Deploy 12 Relational Tables with Canonical Table Naming
-- Milestone: M2 — Database, Security & Core Stored Procedures
-- Operating Mode: Founder-Authorized Gate A (SQL Authoring Only)
-- Canonical References: docs/DATABASE_SCHEMA.md (v1.1), docs/ROADMAP.md, docs/SECURITY.md (v1.1)
-- Approved Decisions: Option 1 (Inline Foreign Keys) & M0-13 Alternative A (Immutable Audit Target UUID)

-- ============================================================================
-- 1. Table: public.business_categories
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.1
-- ============================================================================
CREATE TABLE public.business_categories (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.business_categories IS 'Normalizes supported business verticals (e.g. salon, cafe) and anchors 3-MCQ question templates.';
COMMENT ON COLUMN public.business_categories.id IS 'Primary Key text slug (e.g., salon, cafe).';
COMMENT ON COLUMN public.business_categories.display_name IS 'Human-readable vertical title for dashboard rendering.';
COMMENT ON COLUMN public.business_categories.description IS 'Operational scope and description of business vertical.';
COMMENT ON COLUMN public.business_categories.is_active IS 'Soft-disable flag for vertical decommissioning.';
COMMENT ON COLUMN public.business_categories.created_at IS 'Monotonic creation timestamp.';

-- ============================================================================
-- 2. Table: public.businesses
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.2
-- ============================================================================
CREATE TABLE public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    category_id TEXT NOT NULL REFERENCES public.business_categories(id) ON DELETE RESTRICT,
    public_qr_id TEXT NOT NULL,
    vanity_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    logo_url TEXT,
    google_place_id TEXT,
    google_review_url TEXT,
    whatsapp_number TEXT,
    account_status public.account_status_type NOT NULL DEFAULT 'pilot'::public.account_status_type,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.businesses IS 'Core tenant profile linking owner, immutable QR identity, vanity slug, and Google destinations.';
COMMENT ON COLUMN public.businesses.id IS 'Internal surrogate UUID primary key. Never exposed in public QR URLs.';
COMMENT ON COLUMN public.businesses.owner_id IS 'Foreign key referencing auth.users(id) of authenticated merchant owner. Restricted deletion.';
COMMENT ON COLUMN public.businesses.category_id IS 'Foreign key referencing business_categories(id). Restricted deletion.';
COMMENT ON COLUMN public.businesses.public_qr_id IS 'Immutable 10-char URL-safe nano-id encoded into physical/digital QR codes (/q/:public_qr_id).';
COMMENT ON COLUMN public.businesses.vanity_slug IS 'Cosmetic URL slug for merchant sharing (/r/:slug). Regex validated in M2-T03.';
COMMENT ON COLUMN public.businesses.name IS 'Display business name (1-100 characters).';
COMMENT ON COLUMN public.businesses.logo_url IS 'Public HTTPS logo storage URL (PNG, JPEG, WebP, max 2 MB).';
COMMENT ON COLUMN public.businesses.google_place_id IS 'Google Maps Place ID string.';
COMMENT ON COLUMN public.businesses.google_review_url IS 'Validated direct Google Maps review destination URL.';
COMMENT ON COLUMN public.businesses.whatsapp_number IS 'Indian 10-digit mobile contact number for owner notifications.';
COMMENT ON COLUMN public.businesses.account_status IS 'Lifecycle state enum: active, pilot, suspended.';
COMMENT ON COLUMN public.businesses.is_active IS 'Administrative kill-switch. False immediately disables survey flow.';
COMMENT ON COLUMN public.businesses.created_at IS 'Creation timestamp.';
COMMENT ON COLUMN public.businesses.updated_at IS 'System-managed modification timestamp.';

-- ============================================================================
-- 3. Table: public.survey_questions
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.3
-- ============================================================================
CREATE TABLE public.survey_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id TEXT NOT NULL REFERENCES public.business_categories(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    display_order SMALLINT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_survey_questions_display_order CHECK (display_order BETWEEN 1 AND 3)
);

COMMENT ON TABLE public.survey_questions IS 'Stores the category-specific customer experience MCQs (exactly 3 active questions per vertical).';
COMMENT ON COLUMN public.survey_questions.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.survey_questions.category_id IS 'Foreign key referencing parent vertical in business_categories.';
COMMENT ON COLUMN public.survey_questions.question_text IS 'Experience prompt string displayed to patrons.';
COMMENT ON COLUMN public.survey_questions.display_order IS 'Order position on screen (enforced 1, 2, or 3).';
COMMENT ON COLUMN public.survey_questions.is_active IS 'Active flag for question versioning and soft retirement (M0-07).';
COMMENT ON COLUMN public.survey_questions.created_at IS 'Creation timestamp.';

-- ============================================================================
-- 4. Table: public.survey_options
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.4 & M0-06 / M0-08
-- ============================================================================
CREATE TABLE public.survey_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    emoji_anchor TEXT NOT NULL DEFAULT '',
    sentiment_label TEXT NOT NULL DEFAULT 'positive',
    is_neutral_na BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_survey_options_sentiment CHECK (sentiment_label IN ('positive', 'neutral', 'negative'))
);

COMMENT ON TABLE public.survey_options IS 'Selectable experience choices and neutral N/A options per question with sentiment tags.';
COMMENT ON COLUMN public.survey_options.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.survey_options.question_id IS 'Foreign key referencing parent survey_questions(id).';
COMMENT ON COLUMN public.survey_options.option_text IS 'Affirmation string drafted into customer review upon affirmative selection.';
COMMENT ON COLUMN public.survey_options.emoji_anchor IS 'Visual emoji anchor character (e.g. 💇).';
COMMENT ON COLUMN public.survey_options.sentiment_label IS 'Sentiment categorization: positive, neutral, negative.';
COMMENT ON COLUMN public.survey_options.is_neutral_na IS 'When TRUE, choice is excluded from AI review prompt payload.';
COMMENT ON COLUMN public.survey_options.is_active IS 'Soft retirement flag (M0-06/M0-08); preserves historical response integrity.';
COMMENT ON COLUMN public.survey_options.display_order IS 'Relative display order within question.';
COMMENT ON COLUMN public.survey_options.created_at IS 'Creation timestamp.';

-- ============================================================================
-- 5. Table: public.survey_responses
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.5 & M0-01 / M0-12
-- ============================================================================
CREATE TABLE public.survey_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES public.business_categories(id) ON DELETE RESTRICT,
    selected_options JSONB NOT NULL DEFAULT '[]'::jsonb,
    affirmed_facts_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    optional_note TEXT,
    session_uuid UUID NOT NULL,
    purged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    is_generated BOOLEAN NOT NULL DEFAULT FALSE,
    generation_attempts INT NOT NULL DEFAULT 0,
    CONSTRAINT chk_survey_responses_gen_attempts CHECK (generation_attempts >= 0)
);

COMMENT ON TABLE public.survey_responses IS 'Validated customer survey submissions, historical option snapshots, and pseudonymous notes.';
COMMENT ON COLUMN public.survey_responses.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.survey_responses.business_id IS 'Foreign key referencing target business tenant.';
COMMENT ON COLUMN public.survey_responses.category_id IS 'Foreign key referencing business category vertical.';
COMMENT ON COLUMN public.survey_responses.selected_options IS 'Validated option UUID array: [{"question_id": "...", "option_id": "..."}].';
COMMENT ON COLUMN public.survey_responses.affirmed_facts_snapshot IS 'Historical snapshot of affirmed option text at submission time.';
COMMENT ON COLUMN public.survey_responses.optional_note IS 'Optional pseudonymous feedback note (max 150 chars). Purged after 30 days per M0-01.';
COMMENT ON COLUMN public.survey_responses.session_uuid IS 'Transient client scan session token for audit and rate-limit correlation.';
COMMENT ON COLUMN public.survey_responses.purged_at IS 'Timestamp when optional_note was scrubbed by automated daily maintenance.';
COMMENT ON COLUMN public.survey_responses.created_at IS 'Submission timestamp.';
COMMENT ON COLUMN public.survey_responses.is_generated IS 'Flag indicating successful review draft delivery (M0-12).';
COMMENT ON COLUMN public.survey_responses.generation_attempts IS 'Provider dispatch accounting counter (capped at 3; M0-12).';

-- ============================================================================
-- 6. Table: public.analytics_events
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.6
-- ============================================================================
CREATE TABLE public.analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    event_name public.event_name_type NOT NULL,
    session_uuid UUID NOT NULL,
    user_agent_category TEXT NOT NULL DEFAULT 'mobile',
    deduplication_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_analytics_events_ua_category CHECK (user_agent_category IN ('mobile', 'desktop', 'tablet'))
);

COMMENT ON TABLE public.analytics_events IS 'High-velocity append-only event log capturing the 8 conversion funnel milestones.';
COMMENT ON COLUMN public.analytics_events.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.analytics_events.business_id IS 'Foreign key referencing target business tenant.';
COMMENT ON COLUMN public.analytics_events.event_name IS 'Canonical PRD event taxonomy enum member.';
COMMENT ON COLUMN public.analytics_events.session_uuid IS 'Ephemeral client scan session identifier.';
COMMENT ON COLUMN public.analytics_events.user_agent_category IS 'Client device category: mobile, desktop, tablet.';
COMMENT ON COLUMN public.analytics_events.deduplication_key IS 'SHA-256 idempotency hash for event deduplication.';
COMMENT ON COLUMN public.analytics_events.created_at IS 'Event occurrence timestamp.';

-- ============================================================================
-- 7. Table: public.subscriptions
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.7
-- ============================================================================
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
    plan_tier public.plan_tier_type NOT NULL DEFAULT 'setup_package'::public.plan_tier_type,
    subscription_status public.subscription_status_type NOT NULL DEFAULT 'pilot'::public.subscription_status_type,
    trial_ends_at DATE,
    current_period_starts_at DATE NOT NULL DEFAULT CURRENT_DATE,
    current_period_ends_at DATE NOT NULL DEFAULT (CURRENT_DATE + 30),
    billing_currency TEXT NOT NULL DEFAULT 'INR',
    last_payment_amount NUMERIC(10,2),
    last_payment_recorded_at TIMESTAMPTZ,
    payment_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_subscriptions_currency CHECK (billing_currency = 'INR')
);

COMMENT ON TABLE public.subscriptions IS 'Commercial terms, pilot expiration, renewal dates, and manual payment records for solo founder.';
COMMENT ON COLUMN public.subscriptions.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.subscriptions.business_id IS 'Foreign key referencing business tenant. Strictly 1:1 per merchant.';
COMMENT ON COLUMN public.subscriptions.plan_tier IS 'Commercial plan tier enum: setup_package, standard_recurring.';
COMMENT ON COLUMN public.subscriptions.subscription_status IS 'Lifecycle state enum: pilot, active, past_due, canceled.';
COMMENT ON COLUMN public.subscriptions.trial_ends_at IS 'Pilot trial expiration date (14 days from onboarding).';
COMMENT ON COLUMN public.subscriptions.current_period_starts_at IS 'Start date of active billing cycle.';
COMMENT ON COLUMN public.subscriptions.current_period_ends_at IS 'Renewal expiration date. When exceeded without payment, status transitions to past_due.';
COMMENT ON COLUMN public.subscriptions.billing_currency IS 'Hardcoded billing currency identifier (INR).';
COMMENT ON COLUMN public.subscriptions.last_payment_amount IS 'Amount settled in INR (e.g. 999.00).';
COMMENT ON COLUMN public.subscriptions.last_payment_recorded_at IS 'Timestamp when founder recorded payment receipt.';
COMMENT ON COLUMN public.subscriptions.payment_reference IS 'Manual settlement reference (UPI ID, bank transaction number).';
COMMENT ON COLUMN public.subscriptions.created_at IS 'Creation timestamp.';
COMMENT ON COLUMN public.subscriptions.updated_at IS 'Modification timestamp.';

-- ============================================================================
-- 8. Table: public.tenant_quotas
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.8
-- ============================================================================
CREATE TABLE public.tenant_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    billing_cycle TEXT NOT NULL,
    max_limit INT NOT NULL DEFAULT 150,
    used_count INT NOT NULL DEFAULT 0,
    reserved_count INT NOT NULL DEFAULT 0,
    reset_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_tenant_quotas_limits CHECK (max_limit >= 0 AND used_count >= 0 AND reserved_count >= 0)
);

COMMENT ON TABLE public.tenant_quotas IS 'Monthly generation quota ledger tracking committed usage and active reservations.';
COMMENT ON COLUMN public.tenant_quotas.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.tenant_quotas.business_id IS 'Foreign key referencing target business tenant.';
COMMENT ON COLUMN public.tenant_quotas.billing_cycle IS 'Billing cycle string in format YYYY-MM (e.g. 2026-10).';
COMMENT ON COLUMN public.tenant_quotas.max_limit IS 'Monthly generation ceiling (default 150).';
COMMENT ON COLUMN public.tenant_quotas.used_count IS 'Committed successful generations count.';
COMMENT ON COLUMN public.tenant_quotas.reserved_count IS 'In-flight generations count awaiting commit or release.';
COMMENT ON COLUMN public.tenant_quotas.reset_at IS 'Scheduled timestamp for monthly quota rollover.';
COMMENT ON COLUMN public.tenant_quotas.created_at IS 'Creation timestamp.';
COMMENT ON COLUMN public.tenant_quotas.updated_at IS 'Modification timestamp.';

-- ============================================================================
-- 9. Table: public.quota_reservations
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.9 & M0-06 / M0-12
-- ============================================================================
CREATE TABLE public.quota_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    quota_id UUID NOT NULL REFERENCES public.tenant_quotas(id) ON DELETE RESTRICT,
    response_id UUID NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    tokens_billed INT NOT NULL DEFAULT 0,
    raw_draft TEXT,
    ttl_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_quota_reservations_status CHECK (status IN ('pending', 'committed', 'released', 'expired')),
    CONSTRAINT chk_quota_reservations_tokens CHECK (tokens_billed >= 0)
);

COMMENT ON TABLE public.quota_reservations IS 'Two-phase quota reservation ledger and temporary draft recovery cache.';
COMMENT ON COLUMN public.quota_reservations.id IS 'Primary Key UUID returned to Edge Function as reservation handle.';
COMMENT ON COLUMN public.quota_reservations.business_id IS 'Foreign key referencing target business tenant.';
COMMENT ON COLUMN public.quota_reservations.quota_id IS 'Foreign key referencing tenant_quotas(id) to bind cycle across month-end (M0-06).';
COMMENT ON COLUMN public.quota_reservations.response_id IS 'Foreign key referencing survey_responses(id) (M0-12).';
COMMENT ON COLUMN public.quota_reservations.idempotency_key IS 'Unique client attempt token (${session_uuid}_${seq}).';
COMMENT ON COLUMN public.quota_reservations.payload_hash IS 'Cryptographic HMAC-SHA256 request fingerprint to detect answer changes (M0-06).';
COMMENT ON COLUMN public.quota_reservations.status IS 'Reservation lifecycle state: pending, committed, released, expired.';
COMMENT ON COLUMN public.quota_reservations.tokens_billed IS 'Actual Gemini tokens consumed during generation.';
COMMENT ON COLUMN public.quota_reservations.raw_draft IS 'Temporary generated review proposal (up to 60m recovery buffer; M0-12).';
COMMENT ON COLUMN public.quota_reservations.ttl_expires_at IS 'Hard expiry timestamp (created_at + 60s).';
COMMENT ON COLUMN public.quota_reservations.created_at IS 'Creation timestamp (immutable recovery anchor).';
COMMENT ON COLUMN public.quota_reservations.updated_at IS 'State transition timestamp.';

-- ============================================================================
-- 10. Table: public.rate_limit_buckets
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.10
-- ============================================================================
CREATE TABLE public.rate_limit_buckets (
    key_hash TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (key_hash, window_start),
    CONSTRAINT chk_rate_limit_buckets_count CHECK (request_count >= 1)
);

COMMENT ON TABLE public.rate_limit_buckets IS 'Distributed sliding-window rate limit counters for shared venue Wi-Fi NAT protection.';
COMMENT ON COLUMN public.rate_limit_buckets.key_hash IS 'Primary Key (1/2): SHA-256(client_ip + daily_salt). Zero raw IPs stored.';
COMMENT ON COLUMN public.rate_limit_buckets.window_start IS 'Primary Key (2/2): 10-minute sliding window start boundary timestamp.';
COMMENT ON COLUMN public.rate_limit_buckets.request_count IS 'Atomic counter incremented via upsert.';
COMMENT ON COLUMN public.rate_limit_buckets.expires_at IS 'Hard purge timestamp (window_start + 24 hours).';

-- ============================================================================
-- 11. Table: public.admin_users
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.11 & M0-06
-- ============================================================================
CREATE TABLE public.admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'super_admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enforced BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_admin_users_role CHECK (role = 'super_admin')
);

COMMENT ON TABLE public.admin_users IS 'Super-admin privilege registry with mandatory verified TOTP MFA enforcement.';
COMMENT ON COLUMN public.admin_users.user_id IS 'Primary Key referencing auth.users(id) of platform super-administrator.';
COMMENT ON COLUMN public.admin_users.role IS 'Platform administrative role (strictly super_admin).';
COMMENT ON COLUMN public.admin_users.is_active IS 'Administrative privilege flag (M0-06); immediate revocation at RPC boundary.';
COMMENT ON COLUMN public.admin_users.mfa_enforced IS 'Enforces verified aal2 TOTP MFA for all administrative procedures.';
COMMENT ON COLUMN public.admin_users.created_at IS 'Creation timestamp.';

-- ============================================================================
-- 12. Table: public.admin_audit_logs
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.12 & M0-06 / M0-13 (Alternative A & Option A+)
-- ============================================================================
CREATE TABLE public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    actor_role TEXT NOT NULL,
    target_business_id UUID,
    action TEXT NOT NULL,
    payload_before JSONB,
    payload_after JSONB,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_admin_audit_logs_actor_role CHECK (actor_role IN ('super_admin', 'owner', 'system')),
    CONSTRAINT chk_audit_actor_integrity CHECK (
        (actor_role = 'system' AND actor_user_id IS NULL) OR
        (actor_role IN ('super_admin', 'owner') AND actor_user_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.admin_audit_logs IS 'Append-only immutable audit trail capturing privileged administrative and merchant actions.';
COMMENT ON COLUMN public.admin_audit_logs.id IS 'Primary Key UUID.';
COMMENT ON COLUMN public.admin_audit_logs.actor_user_id IS 'References auth.users(id) of human actor; NULL for system background workers (M0-06/M0-13).';
COMMENT ON COLUMN public.admin_audit_logs.actor_role IS 'Authoritative role of acting entity: super_admin, owner, system (M0-06).';
COMMENT ON COLUMN public.admin_audit_logs.target_business_id IS 'Standalone immutable target business UUID; no cascade to preserve audit history (M0-13 Alternative A).';
COMMENT ON COLUMN public.admin_audit_logs.action IS 'Audited operation code (e.g. PROVISION_TENANT, SUSPEND_TENANT, ADJUST_QUOTA).';
COMMENT ON COLUMN public.admin_audit_logs.payload_before IS 'Redacted snapshot of record prior to mutation.';
COMMENT ON COLUMN public.admin_audit_logs.payload_after IS 'Redacted snapshot of record after mutation.';
COMMENT ON COLUMN public.admin_audit_logs.ip_hash IS 'Hashed IP of actor; NULL for background system workers (M0-13).';
COMMENT ON COLUMN public.admin_audit_logs.created_at IS 'Execution timestamp.';
