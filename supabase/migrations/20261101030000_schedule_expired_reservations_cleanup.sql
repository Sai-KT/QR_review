-- Migration: 20261101030000_schedule_expired_reservations_cleanup.sql
-- Task: M4-T04 Implement Eight-Second Hard Generation Deadline, Quota Recovery & Expired Reservation Cleanup
-- Milestone: M4 — AI Review Generation & Economic Quota Controls
-- Canonical References:
--   docs/DATABASE_SCHEMA.md (v1.1) §5.9, §12
--   docs/API_SPEC.md (v1.2) §7.4, §12 (RPC-INT-02, RPC-INT-03, RPC-INT-04)
--   docs/SECURITY.md (v1.1) §8 (Two-Phase Quota Protocol & Stale Reservation Sweep)
--   docs/ROADMAP.md (v1.1) Task M4-T04
--   Founder Decision M0-12 (Option B Temporary Draft Retention & Recovery Authorization A)

-- 1. Automated Stale Generation Quota Reservation & Draft Buffer Cleanup via pg_cron
-- Schedules public.purge_expired_reservations() to run once per minute ('* * * * *')
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expired_reservations_cleanup') THEN
        PERFORM cron.unschedule('expired_reservations_cleanup');
    END IF;

    PERFORM cron.schedule(
        'expired_reservations_cleanup',
        '* * * * *',
        'SELECT public.purge_expired_reservations();'
    );
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron job scheduling deferred: %', SQLERRM;
END $$;

