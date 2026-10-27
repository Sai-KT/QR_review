-- Migration: 20261027144016_extensions_and_enums.sql
-- Task: M2-T01 Deploy PostgreSQL Extensions & Domain Enums Migration
-- Milestone: M2 — Database, Security & Core Stored Procedures
-- Operating Mode: Founder-Authorized Gate A (SQL Authoring Only)
-- Canonical References: docs/DATABASE_SCHEMA.md (v1.1) and src/types/database.ts

-- ============================================================================
-- 1. PostgreSQL Schema & Extensions Configuration
-- ============================================================================

-- Ensure the dedicated 'extensions' schema exists
CREATE SCHEMA IF NOT EXISTS extensions;

-- Precondition Guard: Assert extensions are not already installed in an improper schema
DO $$
DECLARE
    v_ext_schema text;
BEGIN
    -- Check uuid-ossp
    SELECT n.nspname INTO v_ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE e.extname = 'uuid-ossp';

    IF v_ext_schema IS NOT NULL AND v_ext_schema <> 'extensions' THEN
        RAISE EXCEPTION 'Extension "uuid-ossp" is already installed in schema "%", expected schema "extensions". Relocate or resolve before applying migration.', v_ext_schema;
    END IF;

    -- Check pgcrypto
    SELECT n.nspname INTO v_ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE e.extname = 'pgcrypto';

    IF v_ext_schema IS NOT NULL AND v_ext_schema <> 'extensions' THEN
        RAISE EXCEPTION 'Extension "pgcrypto" is already installed in schema "%", expected schema "extensions". Relocate or resolve before applying migration.', v_ext_schema;
    END IF;
END;
$$;

-- Enable approved cryptographic and UUID extensions in 'extensions' schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- Postcondition Guard: Verify extensions reside strictly in 'extensions' schema
DO $$
DECLARE
    v_ext_schema text;
BEGIN
    SELECT n.nspname INTO v_ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE e.extname = 'uuid-ossp';

    IF v_ext_schema IS DISTINCT FROM 'extensions' THEN
        RAISE EXCEPTION 'Postcondition failed: Extension "uuid-ossp" is not in schema "extensions" (found: %)', v_ext_schema;
    END IF;

    SELECT n.nspname INTO v_ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON e.extnamespace = n.oid
    WHERE e.extname = 'pgcrypto';

    IF v_ext_schema IS DISTINCT FROM 'extensions' THEN
        RAISE EXCEPTION 'Postcondition failed: Extension "pgcrypto" is not in schema "extensions" (found: %)', v_ext_schema;
    END IF;
END;
$$;

-- ============================================================================
-- 2. Domain Enums Creation & Structural Compatibility Guards (Option 1)
-- ============================================================================

DO $$
DECLARE
    v_typtype "char";
    v_existing_labels text[];
    v_expected_account_status text[] := ARRAY['active', 'pilot', 'suspended']::text[];
    v_expected_plan_tier text[] := ARRAY['setup_package', 'standard_recurring']::text[];
    v_expected_subscription_status text[] := ARRAY['pilot', 'active', 'past_due', 'canceled']::text[];
    v_expected_event_name text[] := ARRAY[
        'EVENT_QR_PAGE_VIEW',
        'EVENT_SURVEY_COMPLETED',
        'EVENT_GENERATION_REQUESTED',
        'EVENT_GENERATION_SUCCESS',
        'EVENT_COPY_ATTEMPTED',
        'EVENT_COPY_SUCCESS',
        'EVENT_GOOGLE_REDIRECT_CLICK',
        'EVENT_GOOGLE_BYPASS_CLICK'
    ]::text[];
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. public.account_status_type ('active', 'pilot', 'suspended')
    -- ------------------------------------------------------------------------
    SELECT t.typtype INTO v_typtype
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'account_status_type' AND n.nspname = 'public';

    IF v_typtype IS NULL THEN
        CREATE TYPE public.account_status_type AS ENUM ('active', 'pilot', 'suspended');
    ELSIF v_typtype <> 'e' THEN
        RAISE EXCEPTION 'Type "public.account_status_type" exists but is not an enum (typtype: %).', v_typtype;
    ELSE
        SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
        INTO v_existing_labels
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typname = 'account_status_type' AND n.nspname = 'public';

        IF v_existing_labels IS DISTINCT FROM v_expected_account_status THEN
            RAISE EXCEPTION 'Incompatible enum members for "public.account_status_type": found %, expected %',
                v_existing_labels, v_expected_account_status;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 2. public.plan_tier_type ('setup_package', 'standard_recurring')
    -- ------------------------------------------------------------------------
    SELECT t.typtype INTO v_typtype
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'plan_tier_type' AND n.nspname = 'public';

    IF v_typtype IS NULL THEN
        CREATE TYPE public.plan_tier_type AS ENUM ('setup_package', 'standard_recurring');
    ELSIF v_typtype <> 'e' THEN
        RAISE EXCEPTION 'Type "public.plan_tier_type" exists but is not an enum (typtype: %).', v_typtype;
    ELSE
        SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
        INTO v_existing_labels
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typname = 'plan_tier_type' AND n.nspname = 'public';

        IF v_existing_labels IS DISTINCT FROM v_expected_plan_tier THEN
            RAISE EXCEPTION 'Incompatible enum members for "public.plan_tier_type": found %, expected %',
                v_existing_labels, v_expected_plan_tier;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 3. public.subscription_status_type ('pilot', 'active', 'past_due', 'canceled')
    -- ------------------------------------------------------------------------
    SELECT t.typtype INTO v_typtype
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'subscription_status_type' AND n.nspname = 'public';

    IF v_typtype IS NULL THEN
        CREATE TYPE public.subscription_status_type AS ENUM ('pilot', 'active', 'past_due', 'canceled');
    ELSIF v_typtype <> 'e' THEN
        RAISE EXCEPTION 'Type "public.subscription_status_type" exists but is not an enum (typtype: %).', v_typtype;
    ELSE
        SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
        INTO v_existing_labels
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typname = 'subscription_status_type' AND n.nspname = 'public';

        IF v_existing_labels IS DISTINCT FROM v_expected_subscription_status THEN
            RAISE EXCEPTION 'Incompatible enum members for "public.subscription_status_type": found %, expected %',
                v_existing_labels, v_expected_subscription_status;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 4. public.event_name_type (8 Canonical PRD Event Names)
    -- ------------------------------------------------------------------------
    SELECT t.typtype INTO v_typtype
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE t.typname = 'event_name_type' AND n.nspname = 'public';

    IF v_typtype IS NULL THEN
        CREATE TYPE public.event_name_type AS ENUM (
            'EVENT_QR_PAGE_VIEW',
            'EVENT_SURVEY_COMPLETED',
            'EVENT_GENERATION_REQUESTED',
            'EVENT_GENERATION_SUCCESS',
            'EVENT_COPY_ATTEMPTED',
            'EVENT_COPY_SUCCESS',
            'EVENT_GOOGLE_REDIRECT_CLICK',
            'EVENT_GOOGLE_BYPASS_CLICK'
        );
    ELSIF v_typtype <> 'e' THEN
        RAISE EXCEPTION 'Type "public.event_name_type" exists but is not an enum (typtype: %).', v_typtype;
    ELSE
        SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
        INTO v_existing_labels
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        JOIN pg_namespace n ON t.typnamespace = n.oid
        WHERE t.typname = 'event_name_type' AND n.nspname = 'public';

        IF v_existing_labels IS DISTINCT FROM v_expected_event_name THEN
            RAISE EXCEPTION 'Incompatible enum members for "public.event_name_type": found %, expected %',
                v_existing_labels, v_expected_event_name;
        END IF;
    END IF;
END;
$$;

-- ============================================================================
-- 3. Enum Documentation Comments
-- ============================================================================

COMMENT ON TYPE public.account_status_type IS 'Canonical account status for businesses: active, pilot, suspended.';
COMMENT ON TYPE public.plan_tier_type IS 'Commercial plan tier for business subscriptions: setup_package, standard_recurring.';
COMMENT ON TYPE public.subscription_status_type IS 'Lifecycle status for business subscriptions: pilot, active, past_due, canceled.';
COMMENT ON TYPE public.event_name_type IS 'Taxonomy of 8 canonical customer journey and analytics funnel events.';
