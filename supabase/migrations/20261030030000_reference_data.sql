-- ============================================================================
-- QR_review — Supabase PostgreSQL Schema Migration
-- Migration: 20261030030000_reference_data.sql
-- Task: M2-T08 — Production Reference Data & Local Seed Personas
-- Gate: A — Production Reference Data Implementation (Targeted Correction)
-- Target System: PostgreSQL 17 / Supabase Local & Cloud Engine
--
-- Authoritative Specifications:
--   docs/ROADMAP.md (v1.1) Task M2-T08
--   docs/DATABASE_SCHEMA.md (v1.1) §5.1 (business_categories), §5.3 (survey_questions), §5.4 (survey_options)
--   docs/PRD.md (v1.1) §7.1, FR-CUST-003 (Category-Specific 3-MCQ Accessible Survey)
--   docs/API_SPEC.md (v1.2) §7.2 (API-PUB-02: Category Questionnaire Retrieval)
--   AGENTS.md §5 Invariant 2 (Strict 3-MCQ Cap), Invariant 5 (Grounded AI Draft)
--   Founder Decisions:
--     M0-06: Schema design amendments (survey_options.is_active soft retirement)
--     M0-07: Active Survey Question Replacement (immutable versioning, display_order 1..3)
--     M0-08: Survey Option Activation Semantics (mandatory neutral N/A per question)
--
-- Core Invariants Enforced:
--   1. Production-Safe Reference Data ONLY: Zero mock merchants, zero test users,
--      and zero mock customer feedback in this migration.
--   2. Exactly 3 active questions per published category vertical (salon, cafe).
--   3. Exactly 4 active options per question:
--      - Exactly 3 ordinary choices (sentiment positive/negative, is_neutral_na = FALSE, display_order 1..3)
--      - Exactly 1 explicitly neutral N/A choice ('Not applicable / Not sure', is_neutral_na = TRUE, display_order 4)
--   4. Unique sequential display order (1, 2, 3, 4) for options within each question.
--   5. Stable, deterministic UUIDs for all question and option reference records.
--   6. Idempotent insertion using ON CONFLICT (id) DO NOTHING to prevent silent
--      overwriting of historical published questionnaires (no UPSERTs).
--   7. Fully atomic execution within a single migration transaction.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Canonical Business Categories (public.business_categories)
-- ============================================================================
-- Initial pilot cohort strictly limited to salons and cafes per AGENTS.md §1 & PRD §7.1.

INSERT INTO public.business_categories (
    id,
    display_name,
    description,
    is_active,
    created_at
)
VALUES
    (
        'salon',
        'Salon & Spa',
        'Hair salons, barbershops, beauty parlors, and wellness spas',
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        'cafe',
        'Cafe & Bistro',
        'Coffee shops, artisanal cafes, bakeries, and quick-service bistros',
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. Canonical Survey Questions (public.survey_questions)
-- ============================================================================
-- Exactly 3 active questions per category vertical (display_order 1, 2, 3).
-- Enforces Founder Decision M0-07 and CHECK (display_order BETWEEN 1 AND 3).

-- ----------------------------------------------------------------------------
-- 2.1 Vertical: Salon & Spa ('salon')
-- ----------------------------------------------------------------------------
INSERT INTO public.survey_questions (
    id,
    category_id,
    question_text,
    display_order,
    is_active,
    created_at
)
VALUES
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c'::uuid,
        'salon',
        'How was your hair or beauty service today?',
        1,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d'::uuid,
        'salon',
        'How was the staff hospitality and cleanliness?',
        2,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e'::uuid,
        'salon',
        'What stood out most about your visit?',
        3,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 2.2 Vertical: Cafe & Bistro ('cafe')
-- ----------------------------------------------------------------------------
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c'::uuid,
        'cafe',
        'What did you enjoy most at our cafe?',
        1,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'::uuid,
        'cafe',
        'How was our staff service and preparation time?',
        2,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e'::uuid,
        'cafe',
        'How was the seating comfort and cafe vibe?',
        3,
        TRUE,
        '2026-10-30 00:00:00+00'::timestamptz
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 3. Canonical Survey Options (public.survey_options)
-- ============================================================================
-- Exactly 4 options per question:
--   - Options 1..3: Ordinary selectable experience choices (positive / negative)
--   - Option 4: Explicit neutral N/A option ('Not applicable / Not sure', is_neutral_na = TRUE)
-- Neutral N/A options are excluded from the AI review prompt per PRD FR-CUST-003.

-- ----------------------------------------------------------------------------
-- 3.1 Salon Q1: Service Experience (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c)
-- ----------------------------------------------------------------------------
INSERT INTO public.survey_options (
    id,
    question_id,
    option_text,
    emoji_anchor,
    sentiment_label,
    is_neutral_na,
    is_active,
    display_order,
    created_at
)
VALUES
    (
        '1a2b3c4d-0001-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c'::uuid,
        'Masterful & Precise',
        '✂️',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0001-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c'::uuid,
        'Good / Met Expectations',
        '👍',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0001-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c'::uuid,
        'Service took too long',
        '⏳',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0001-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 3.2 Salon Q2: Hospitality & Cleanliness (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d)
-- ----------------------------------------------------------------------------
    (
        '1a2b3c4d-0002-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d'::uuid,
        'Warm & Attentive team',
        '😊',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0002-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d'::uuid,
        'Clean & hygienic station',
        '✨',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0002-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d'::uuid,
        'Crowded / High waiting time',
        '👥',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0002-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5d'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 3.3 Salon Q3: Standout Highlights (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e)
-- ----------------------------------------------------------------------------
    (
        '1a2b3c4d-0003-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e'::uuid,
        'Great styling advice',
        '💡',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0003-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e'::uuid,
        'Calm & relaxing ambience',
        '🌿',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0003-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e'::uuid,
        'Pricing was higher than expected',
        '🏷️',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0003-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5e'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 3.4 Cafe Q1: Food & Beverages (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c)
-- ----------------------------------------------------------------------------
    (
        '1a2b3c4d-0004-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c'::uuid,
        'Specialty coffee & espresso',
        '☕',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0004-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c'::uuid,
        'Freshly baked pastries & food',
        '🥐',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0004-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c'::uuid,
        'Beverage was cold / delayed',
        '⏳',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0004-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6c'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 3.5 Cafe Q2: Staff Hospitality & Speed (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d)
-- ----------------------------------------------------------------------------
    (
        '1a2b3c4d-0005-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'::uuid,
        'Super prompt & courteous staff',
        '⚡',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0005-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'::uuid,
        'Warm barista recommendation',
        '😊',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0005-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'::uuid,
        'Slow counter / order mix-up',
        '⏳',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0005-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6d'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    ),

-- ----------------------------------------------------------------------------
-- 3.6 Cafe Q3: Ambience & Workspace (id: 8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e)
-- ----------------------------------------------------------------------------
    (
        '1a2b3c4d-0006-4000-8000-000000000001'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e'::uuid,
        'Cozy atmosphere & good music',
        '🎵',
        'positive',
        FALSE,
        TRUE,
        1,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0006-4000-8000-000000000002'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e'::uuid,
        'Work-friendly with good Wi-Fi',
        '💻',
        'positive',
        FALSE,
        TRUE,
        2,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0006-4000-8000-000000000003'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e'::uuid,
        'Too crowded / noisy space',
        '📢',
        'negative',
        FALSE,
        TRUE,
        3,
        '2026-10-30 00:00:00+00'::timestamptz
    ),
    (
        '1a2b3c4d-0006-4000-8000-000000000004'::uuid,
        '8f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b6e'::uuid,
        'Not applicable / Not sure',
        '🤷',
        'neutral',
        TRUE,
        TRUE,
        4,
        '2026-10-30 00:00:00+00'::timestamptz
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
