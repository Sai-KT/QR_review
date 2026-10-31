-- ============================================================================
-- Migration: 20261101010000_harden_public_qr_resolver.sql
-- Description: Harden public QR resolver stored procedure privileges and subscription default (M3-T01).
-- Specification: docs/API_SPEC.md (v1.2) §7.1, docs/DATABASE_SCHEMA.md (v1.1) §5.1, §5.7, docs/SECURITY.md (v1.1)
-- ============================================================================

-- 1. Recreate get_public_business_by_qr with default subscription status 'pilot' and hardened security definer context
CREATE OR REPLACE FUNCTION public.get_public_business_by_qr(p_qr_id TEXT)
RETURNS TABLE (
    public_qr_id TEXT,
    name TEXT,
    logo_url TEXT,
    category_id TEXT,
    google_review_url TEXT,
    whatsapp_number TEXT,
    is_active BOOLEAN,
    account_status TEXT,
    subscription_status TEXT,
    is_direct_google_only BOOLEAN,
    is_suspended BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.public_qr_id,
        b.name,
        b.logo_url,
        b.category_id,
        -- Strictly suppress outbound URLs if account is suspended or inactive (DEC-M3-05)
        CASE
            WHEN b.account_status = 'suspended' OR b.is_active IS NOT TRUE THEN NULL
            ELSE b.google_review_url
        END AS google_review_url,
        CASE
            WHEN b.account_status = 'suspended' OR b.is_active IS NOT TRUE THEN NULL
            ELSE b.whatsapp_number
        END AS whatsapp_number,
        b.is_active,
        b.account_status::TEXT,
        -- Schema default is 'pilot' for active trial merchants (DATABASE_SCHEMA §5.7)
        COALESCE(s.subscription_status::TEXT, 'pilot') AS subscription_status,
        -- Lapsed subscription or past_due triggers direct-Google-only mode (DEC-M3-04)
        (COALESCE(s.subscription_status::TEXT, 'pilot') IN ('past_due', 'canceled')) AS is_direct_google_only,
        -- Suspended account flag
        (b.account_status = 'suspended' OR b.is_active IS NOT TRUE) AS is_suspended
    FROM public.businesses b
    LEFT JOIN LATERAL (
        SELECT sub.subscription_status
        FROM public.subscriptions sub
        WHERE sub.business_id = b.id
        ORDER BY sub.created_at DESC
        LIMIT 1
    ) s ON TRUE
    WHERE b.public_qr_id = p_qr_id;
END;
$$;

COMMENT ON FUNCTION public.get_public_business_by_qr(TEXT) IS
    'Restricted server-side projection resolving public business profile and commercial status by public_qr_id (M3-T01). Invoked exclusively by Edge Function service_role client.';

-- 2. Explicitly revoke execution from public roles and grant strictly to service_role
REVOKE ALL ON FUNCTION public.get_public_business_by_qr(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_business_by_qr(TEXT) TO service_role;

-- 3. Confirm rate limiting RPC and table privileges are strictly bound to service_role
REVOKE ALL ON FUNCTION public.check_exact_rate_limit(TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_exact_rate_limit(TEXT, TEXT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.purge_expired_rate_limit_events(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limit_events(INT, INT) TO service_role;

REVOKE ALL ON TABLE public.rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.rate_limit_events TO service_role;
