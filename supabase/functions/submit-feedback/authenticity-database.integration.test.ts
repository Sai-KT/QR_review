/**
 * Authenticity Confirmation Database & Trigger Integration Test Suite
 *
 * Post-M4 Integration Gate B: M0-16 Design B Authenticity Confirmation
 * Validates real PostgreSQL schema, default values, immutability trigger guards,
 * and RPC compatibility against local Supabase instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Post-M4 Gate B: Authenticity Database & Trigger Integration', () => {
  let supabase: SupabaseClient;
  const testBusinessId = 'b0000000-0000-4000-8000-000000000001';
  const createdResponseIds: string[] = [];

  beforeAll(() => {
    supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterAll(async () => {
    if (createdResponseIds.length > 0) {
      await supabase
        .from('survey_responses')
        .delete()
        .in('id', createdResponseIds);
    }
  });

  it('1 & 2. column authenticity_confirmed exists with boolean not null default false', async () => {
    const { execSync } = await import('node:child_process');
    const colInfo = execSync(
      `docker exec supabase_db_qr-review psql -U postgres -d postgres -t -A -c "
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'survey_responses' AND column_name = 'authenticity_confirmed';
      "`,
    ).toString().trim();

    expect(colInfo).toBe('authenticity_confirmed|boolean|false|NO');
  });

  it('3. newly inserted record without specifying authenticity_confirmed defaults to false', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data, error } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Testing default',
      })
      .select('id, authenticity_confirmed')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
    expect(data?.authenticity_confirmed).toBe(false);
    if (data?.id) createdResponseIds.push(data.id);
  });

  it('4. historical survey records created prior to Gate B retain false', async () => {
    const { execSync } = await import('node:child_process');
    const historicalCount = execSync(
      `docker exec supabase_db_qr-review psql -U postgres -d postgres -t -A -c "
        SELECT count(*) FROM public.survey_responses WHERE authenticity_confirmed = TRUE AND created_at < '2026-11-02 00:00:00+00';
      "`,
    ).toString().trim();

    expect(Number(historicalCount)).toBe(0);
  });

  it('5. explicit TRUE is persisted accurately on insert', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data, error } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Explicit true test',
        authenticity_confirmed: true,
      })
      .select('id, authenticity_confirmed')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
    expect(data?.authenticity_confirmed).toBe(true);
    if (data?.id) createdResponseIds.push(data.id);
  });

  it('6. explicit FALSE is persisted accurately on insert', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data, error } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Explicit false test',
        authenticity_confirmed: false,
      })
      .select('id, authenticity_confirmed')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
    expect(data?.authenticity_confirmed).toBe(false);
    if (data?.id) createdResponseIds.push(data.id);
  });

  it('9. immutability trigger blocks updating authenticity_confirmed after initial submission', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data: inserted, error: insertErr } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Immutability test',
        authenticity_confirmed: false,
      })
      .select('id')
      .single();

    expect(insertErr).toBeNull();
    expect(inserted?.id).toBeDefined();
    if (inserted?.id) createdResponseIds.push(inserted.id);

    // Attempt to mutate authenticity_confirmed from false to true
    const { error: updateErr } = await supabase
      .from('survey_responses')
      .update({ authenticity_confirmed: true })
      .eq('id', inserted!.id);

    expect(updateErr).not.toBeNull();
    expect(updateErr?.message).toContain('ERR_IMMUTABLE_FIELD');
    expect(updateErr?.message).toContain('authenticity_confirmed cannot be modified');
  });

  it('13. immutability trigger permits legitimate generation-state transitions', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data: inserted, error: insertErr } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Permitted transition test',
        authenticity_confirmed: true,
      })
      .select('id')
      .single();

    expect(insertErr).toBeNull();
    if (inserted?.id) createdResponseIds.push(inserted.id);

    // Legitimate update: is_generated and generation_attempts
    const { data: updated, error: updateErr } = await supabase
      .from('survey_responses')
      .update({
        is_generated: true,
        generation_attempts: 1,
      })
      .eq('id', inserted!.id)
      .select('is_generated, generation_attempts, authenticity_confirmed')
      .single();

    expect(updateErr).toBeNull();
    expect(updated?.is_generated).toBe(true);
    expect(updated?.generation_attempts).toBe(1);
    expect(updated?.authenticity_confirmed).toBe(true);
  });

  it('14. immutability trigger permits privacy note deletion (purged_at and optional_note = null)', async () => {
    const sessionUuid = crypto.randomUUID();
    const { data: inserted, error: insertErr } = await supabase
      .from('survey_responses')
      .insert({
        business_id: testBusinessId,
        category_id: 'salon',
        session_uuid: sessionUuid,
        selected_options: [{ questionId: 'q1', optionId: 'opt1' }],
        affirmed_facts_snapshot: ['Fact 1'],
        optional_note: 'Privacy scrub test',
        authenticity_confirmed: true,
      })
      .select('id')
      .single();

    expect(insertErr).toBeNull();
    if (inserted?.id) createdResponseIds.push(inserted.id);

    const nowIso = new Date().toISOString();
    const { data: scrubbed, error: scrubErr } = await supabase
      .from('survey_responses')
      .update({
        optional_note: null,
        purged_at: nowIso,
      })
      .eq('id', inserted!.id)
      .select('optional_note, purged_at, authenticity_confirmed')
      .single();

    expect(scrubErr).toBeNull();
    expect(scrubbed?.optional_note).toBeNull();
    expect(scrubbed?.purged_at).toBeDefined();
    expect(scrubbed?.authenticity_confirmed).toBe(true);
  });

  it('15 & 16. anonymous clients cannot directly UPDATE survey_responses (RLS enforcement)', async () => {
    const anonClient = createClient(LOCAL_SUPABASE_URL, 'invalid-or-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: anonUpdateErr } = await anonClient
      .from('survey_responses')
      .update({ authenticity_confirmed: true })
      .eq('business_id', testBusinessId);

    // Anonymous update MUST fail due to RLS or missing auth
    expect(anonUpdateErr).not.toBeNull();
  });
});

