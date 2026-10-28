-- Migration: 20261028195000_indexes_and_constraints.sql
-- Task: M2-T03 Deploy Hardware Token Indexes, CHECK Constraints & Composite Keys
-- Milestone: M2 — Database, Security & Core Stored Procedures
-- Operating Mode: Founder-Authorized Gate A (SQL Authoring & Static Verification Only)
-- Canonical References: docs/DATABASE_SCHEMA.md (v1.1) §5 & §15, docs/ROADMAP.md, docs/SECURITY.md (v1.1)
-- Approved Founder Decisions:
--   Decision 1: Rate-limit indexing (rely on rate_limit_buckets_pkey, deploy rate_limit_buckets_expiry_idx)
--   Decision 2: Quota ceiling (deploy chk_tenant_quotas_ceiling: used_count + reserved_count <= max_limit)
--   Decision 3: Active question uniqueness (M0-07 partial unique index: category_id, display_order WHERE is_active = TRUE)
--   Decision 4: Vanity slug validation (regex ^[a-z0-9]+(-[a-z0-9]+)*$, length 2-63 chars)
--   Decision 5: Explicit canonical snake_case naming for all indexes and constraints

-- ============================================================================
-- 1. SUPPLEMENTARY CHECK CONSTRAINTS
-- ============================================================================

-- 1.1 businesses: Vanity URL slug format & length bounds
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.2, Founder Decision 4, TC-DB-11
ALTER TABLE public.businesses
    ADD CONSTRAINT chk_businesses_vanity_slug
    CHECK (
        vanity_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        AND char_length(vanity_slug) BETWEEN 2 AND 63
    );

COMMENT ON CONSTRAINT chk_businesses_vanity_slug ON public.businesses IS
    'Enforces lowercase alphanumeric characters with single separating hyphens and length between 2 and 63 characters.';

-- 1.2 businesses: Display name non-empty and bounded length
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.2, docs/API_SPEC.md §14
ALTER TABLE public.businesses
    ADD CONSTRAINT chk_businesses_name
    CHECK (
        char_length(trim(name)) >= 1
        AND char_length(name) <= 100
    );

COMMENT ON CONSTRAINT chk_businesses_name ON public.businesses IS
    'Guarantees merchant display name is not blank and does not exceed 100 characters.';

-- 1.3 businesses: Optional WhatsApp mobile contact phone (Indian 10-digit format)
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.2, docs/API_SPEC.md §14
ALTER TABLE public.businesses
    ADD CONSTRAINT chk_businesses_whatsapp_number
    CHECK (
        whatsapp_number IS NULL
        OR whatsapp_number ~ '^[6-9][0-9]{9}$'
    );

COMMENT ON CONSTRAINT chk_businesses_whatsapp_number ON public.businesses IS
    'Validates Indian 10-digit mobile number starting with 6-9 when provided; allows NULL.';

-- 1.4 survey_responses: Customer optional feedback note length bound (DPDPA 2023)
-- Canonical Reference: Founder Decision M0-01, docs/PRD.md FR-CUST-004, docs/ROADMAP.md M2-T03
ALTER TABLE public.survey_responses
    ADD CONSTRAINT chk_survey_responses_optional_note
    CHECK (
        optional_note IS NULL
        OR char_length(optional_note) <= 150
    );

COMMENT ON CONSTRAINT chk_survey_responses_optional_note ON public.survey_responses IS
    'Bounds optional customer feedback note to 150 characters for privacy and prompt injection defense.';

-- 1.5 tenant_quotas: ISO billing cycle format (YYYY-MM)
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.8
ALTER TABLE public.tenant_quotas
    ADD CONSTRAINT chk_tenant_quotas_billing_cycle
    CHECK (
        billing_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    );

COMMENT ON CONSTRAINT chk_tenant_quotas_billing_cycle ON public.tenant_quotas IS
    'Enforces strict ISO calendar format YYYY-MM (e.g. 2026-10) for monthly quota ledger rows.';

-- 1.6 tenant_quotas: Quota ceiling invariant (used + reserved <= max_limit)
-- Canonical Reference: Founder Decision 2, AGENTS.md §12, docs/TEST_PLAN.md Gate M0-12
ALTER TABLE public.tenant_quotas
    ADD CONSTRAINT chk_tenant_quotas_ceiling
    CHECK (
        used_count + reserved_count <= max_limit
    );

COMMENT ON CONSTRAINT chk_tenant_quotas_ceiling ON public.tenant_quotas IS
    'Declarative mathematical ceiling guaranteeing committed plus reserved generations never exceed max_limit.';


-- ============================================================================
-- 2. BUSINESSES INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.2 & §15
-- ============================================================================

-- Hardware-locked immutable QR token unique index (FR-CUST-001)
CREATE UNIQUE INDEX businesses_public_qr_id_uq
    ON public.businesses (public_qr_id);

COMMENT ON INDEX public.businesses_public_qr_id_uq IS
    'Guarantees global uniqueness of permanent 10-character URL-safe nano-id across all merchants.';

-- Merchant cosmetic vanity slug unique index (FR-OWNER-002)
CREATE UNIQUE INDEX businesses_vanity_slug_uq
    ON public.businesses (vanity_slug);

COMMENT ON INDEX public.businesses_vanity_slug_uq IS
    'Guarantees global uniqueness of merchant vanity URL slug for public routing (/r/:slug).';

-- Merchant owner foreign key lookup index for tenant resolution and RLS
CREATE INDEX businesses_owner_id_idx
    ON public.businesses (owner_id);

COMMENT ON INDEX public.businesses_owner_id_idx IS
    'Optimizes merchant profile lookup and RLS tenant isolation queries filtering by owner_id = auth.uid().';


-- ============================================================================
-- 3. SURVEY QUESTIONS & OPTIONS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.3, §5.4, §15 & Founder Decision M0-07
-- ============================================================================

-- Question versioning: Active display order uniqueness per category vertical (M0-07)
CREATE UNIQUE INDEX survey_questions_active_cat_order_uq
    ON public.survey_questions (category_id, display_order)
    WHERE is_active = TRUE;

COMMENT ON INDEX public.survey_questions_active_cat_order_uq IS
    'Enforces display order uniqueness (1, 2, 3) for active questions within each vertical; enables versioning.';

-- Survey options foreign key lookup and display ordering index
CREATE INDEX survey_options_question_idx
    ON public.survey_options (question_id, display_order);

COMMENT ON INDEX public.survey_options_question_idx IS
    'Optimizes retrieval and display-order sorting of selectable experience choices for a given question.';

-- Survey options active choices partial index for public survey retrieval
CREATE INDEX survey_options_active_idx
    ON public.survey_options (question_id, is_active)
    WHERE is_active = TRUE;

COMMENT ON INDEX public.survey_options_active_idx IS
    'Accelerates public questionnaire retrieval by pre-filtering active selectable choices.';


-- ============================================================================
-- 4. SURVEY RESPONSES INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.5, §15 & Founder Decision M0-01
-- ============================================================================

-- Merchant dashboard feedback feed reverse-chronological pagination index
CREATE INDEX survey_responses_business_date_idx
    ON public.survey_responses (business_id, created_at DESC);

COMMENT ON INDEX public.survey_responses_business_date_idx IS
    'Powers owner dashboard feedback feed queries and reverse-chronological pagination by tenant.';

-- Automated rolling 30-day customer note privacy purge partial index (DPDPA 2023)
CREATE INDEX survey_responses_unpurged_notes_idx
    ON public.survey_responses (created_at)
    WHERE optional_note IS NOT NULL;

COMMENT ON INDEX public.survey_responses_unpurged_notes_idx IS
    'Partial index enabling high-velocity daily pg_cron maintenance sweeps to scrub notes older than 30 days.';


-- ============================================================================
-- 5. ANALYTICS EVENTS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.6 & §15
-- ============================================================================

-- Server-side event deduplication unique index
CREATE UNIQUE INDEX analytics_events_dedup_uq
    ON public.analytics_events (deduplication_key);

COMMENT ON INDEX public.analytics_events_dedup_uq IS
    'Enforces server-side idempotency and deduplication for client analytics milestone events.';

-- Merchant conversion funnel analytics aggregation index
CREATE INDEX analytics_events_biz_funnel_idx
    ON public.analytics_events (business_id, event_name, created_at);

COMMENT ON INDEX public.analytics_events_biz_funnel_idx IS
    'Powers conversion funnel rate calculations and step-by-step milestone aggregations per merchant.';

-- Rolling 12-month analytics data retention pruning index
CREATE INDEX analytics_events_cleanup_idx
    ON public.analytics_events (created_at);

COMMENT ON INDEX public.analytics_events_cleanup_idx IS
    'Accelerates periodic automated cleanup and rollup of aged analytics telemetry records.';


-- ============================================================================
-- 6. SUBSCRIPTIONS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.7 & §15
-- ============================================================================

-- Strict 1:1 business-to-subscription unique relationship index
CREATE UNIQUE INDEX subscriptions_business_id_uq
    ON public.subscriptions (business_id);

COMMENT ON INDEX public.subscriptions_business_id_uq IS
    'Enforces strictly one commercial subscription record per business tenant.';

-- Founder subscription renewal tracking and lapsed account inspection index
CREATE INDEX subscriptions_status_renewal_idx
    ON public.subscriptions (subscription_status, current_period_ends_at);

COMMENT ON INDEX public.subscriptions_status_renewal_idx IS
    'Powers founder batch renewal queries and automated notification routines for upcoming expirations.';


-- ============================================================================
-- 7. TENANT QUOTAS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.8 & §15
-- ============================================================================

-- Tenant + billing cycle composite unique index
CREATE UNIQUE INDEX tenant_quotas_biz_cycle_uq
    ON public.tenant_quotas (business_id, billing_cycle);

COMMENT ON INDEX public.tenant_quotas_biz_cycle_uq IS
    'Guarantees exactly one quota allocation record per business tenant per monthly billing cycle.';


-- ============================================================================
-- 8. QUOTA RESERVATIONS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.9, §15, Founder Decisions M0-06 & M0-12
-- ============================================================================

-- Client attempt idempotency unique index (prevents duplicate generation dispatch)
CREATE UNIQUE INDEX quota_reservations_idempotency_uq
    ON public.quota_reservations (idempotency_key);

COMMENT ON INDEX public.quota_reservations_idempotency_uq IS
    'Enforces strictly one quota reservation per unique client attempt token (${session_uuid}_${seq}).';

-- Response-level pending reservation concurrency guard (Founder Decision M0-12)
CREATE UNIQUE INDEX quota_reservations_pending_response_uq
    ON public.quota_reservations (response_id)
    WHERE status = 'pending';

COMMENT ON INDEX public.quota_reservations_pending_response_uq IS
    'Guarantees at most one active in-flight pending reservation per feedback response to prevent double-spending.';

-- Foreign key lookup index on quota_id for month-end reconciliation
CREATE INDEX quota_reservations_quota_idx
    ON public.quota_reservations (quota_id);

COMMENT ON INDEX public.quota_reservations_quota_idx IS
    'Accelerates quota reservation commit and release lookups bound to specific monthly quota periods.';

-- Orphaned pending reservation TTL sweep partial index (60-second recovery)
CREATE INDEX quota_reservations_ttl_pending_idx
    ON public.quota_reservations (ttl_expires_at)
    WHERE status = 'pending';

COMMENT ON INDEX public.quota_reservations_ttl_pending_idx IS
    'Enables high-velocity index sweeps of timed-out 60-second in-flight reservations for automatic release.';


-- ============================================================================
-- 9. RATE LIMIT BUCKETS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.10, §15 & Founder Decision 1
-- Note: Composite primary key rate_limit_buckets_pkey already indexes (key_hash, window_start).
-- ============================================================================

-- Sliding rate limit window 24-hour expiration purge index
CREATE INDEX rate_limit_buckets_expiry_idx
    ON public.rate_limit_buckets (expires_at);

COMMENT ON INDEX public.rate_limit_buckets_expiry_idx IS
    'Enables automated rolling deletion of expired sliding-window rate limit buckets older than 24 hours.';


-- ============================================================================
-- 10. ADMIN AUDIT LOGS INDEXES
-- Canonical Reference: docs/DATABASE_SCHEMA.md §5.12, §15 & Founder Decision M0-13
-- ============================================================================

-- Filter and paginate administrative audit events by action code and timestamp
CREATE INDEX admin_audit_logs_action_time_idx
    ON public.admin_audit_logs (action, created_at DESC);

COMMENT ON INDEX public.admin_audit_logs_action_time_idx IS
    'Powers administrative audit log filtering by action type and reverse-chronological pagination.';

-- Tenant audit inspector lookup index (Founder Decision M0-13 Alternative A)
CREATE INDEX admin_audit_logs_target_biz_idx
    ON public.admin_audit_logs (target_business_id);

COMMENT ON INDEX public.admin_audit_logs_target_biz_idx IS
    'Accelerates tenant lifecycle audit history queries for specific businesses.';

-- Single-actor audit history pagination index (Founder Decision M0-13 Option A+)
CREATE INDEX admin_audit_logs_actor_idx
    ON public.admin_audit_logs (actor_user_id, created_at DESC);

COMMENT ON INDEX public.admin_audit_logs_actor_idx IS
    'Optimizes administrative audit queries filtering by specific actor UUID in reverse chronological order.';
