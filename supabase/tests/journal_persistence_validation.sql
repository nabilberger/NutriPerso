-- Transactional PostgreSQL regression checks for the journal persistence migration.
-- Run against a local Supabase database after applying migrations; this script rolls back all fixtures.
begin;

do $test$
declare
  v_user uuid := gen_random_uuid();
  v_day_a uuid := gen_random_uuid();
  v_day_b uuid := gen_random_uuid();
  v_day_confirm uuid := gen_random_uuid();
  v_root_snapshot text := 'sql-test-root-' || gen_random_uuid()::text;
  v_cross_day_snapshot text := 'sql-test-cross-day-' || gen_random_uuid()::text;
  v_confirm_snapshot text := 'sql-test-confirm-' || gen_random_uuid()::text;
  v_logical_void text := 'sql-test-void-' || gen_random_uuid()::text;
  v_logical_confirm text := 'sql-test-confirm-' || gen_random_uuid()::text;
  v_expected_draft jsonb;
  v_next_draft jsonb;
  v_bad_next_draft jsonb;
  v_snapshot jsonb;
  v_saved public.journal_days%rowtype;
  v_sqlstate text;
  v_message text;
begin
  insert into auth.users (id, aud, role, email)
  values (v_user, 'authenticated', 'authenticated', 'journal-sql-' || v_user::text || '@invalid.test');

  insert into public.journal_days (id, user_id, local_date, time_zone, revision, draft)
  values
    (v_day_a, v_user, date '2026-11-04', 'UTC', 1,
      jsonb_build_object('id', v_day_a::text, 'localDate', '2026-11-04', 'timeZone', 'UTC', 'revision', 1, 'meals', '[]'::jsonb)),
    (v_day_b, v_user, date '2026-11-05', 'UTC', 1,
      jsonb_build_object('id', v_day_b::text, 'localDate', '2026-11-05', 'timeZone', 'UTC', 'revision', 1, 'meals', '[]'::jsonb));

  -- A void predecessor is sufficient to exercise the history/day invariant without nutrition fixtures.
  insert into public.journal_meal_snapshots
    (snapshot_id, logical_meal_id, user_id, day_id, revision, predecessor_snapshot_id, status,
     local_date, time_zone, confirmed_at, engine_version, snapshot)
  values
    (v_root_snapshot, v_logical_void, v_user, v_day_a, 1, null, 'void', date '2026-11-04', 'UTC',
     timestamptz '2026-11-04 12:00:00+00', 'sql-test-v1',
     jsonb_build_object('snapshotId', v_root_snapshot, 'logicalMealId', v_logical_void,
       'dayId', v_day_a::text, 'revision', 1, 'status', 'void', 'localDate', '2026-11-04',
       'timeZone', 'UTC', 'confirmedAt', '2026-11-04T12:00:00Z', 'engineVersion', 'sql-test-v1',
       'supersedesSnapshotId', null, 'items', '[]'::jsonb, 'totals', '[]'::jsonb));

  begin
    insert into public.journal_meal_snapshots
      (snapshot_id, logical_meal_id, user_id, day_id, revision, predecessor_snapshot_id, status,
       local_date, time_zone, confirmed_at, engine_version, snapshot)
    values
      (v_cross_day_snapshot, v_logical_void, v_user, v_day_b, 2, v_root_snapshot, 'void', date '2026-11-05', 'UTC',
       timestamptz '2026-11-05 12:00:00+00', 'sql-test-v1',
       jsonb_build_object('snapshotId', v_cross_day_snapshot, 'logicalMealId', v_logical_void,
         'dayId', v_day_b::text, 'revision', 2, 'status', 'void', 'localDate', '2026-11-05',
         'timeZone', 'UTC', 'confirmedAt', '2026-11-05T12:00:00Z', 'engineVersion', 'sql-test-v1',
         'supersedesSnapshotId', v_root_snapshot, 'items', '[]'::jsonb, 'totals', '[]'::jsonb));
    raise exception 'Expected cross-day successor rejection';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    if v_message = 'Expected cross-day successor rejection'
      or (v_sqlstate <> '40001' and v_sqlstate <> '23503') then
      raise exception 'Unexpected cross-day validation result: SQLSTATE %, message %', v_sqlstate, v_message;
    end if;
  end;

  v_expected_draft := jsonb_build_object(
    'id', v_day_confirm::text, 'localDate', '2026-11-04', 'timeZone', 'UTC', 'revision', 1,
    'meals', jsonb_build_array(jsonb_build_object('id', v_logical_confirm, 'revision', 1,
      'kind', 'lunch', 'label', null, 'occurredAt', null, 'sortOrder', 0, 'items', '[]'::jsonb))
  );
  insert into public.journal_days (id, user_id, local_date, time_zone, revision, draft)
  values (v_day_confirm, v_user, date '2026-11-04', 'UTC', 1, v_expected_draft);

  v_snapshot := jsonb_build_object(
    'snapshotId', v_confirm_snapshot, 'logicalMealId', v_logical_confirm,
    'revision', 1, 'supersedesSnapshotId', null, 'dayId', v_day_confirm::text,
    'localDate', '2026-11-04', 'timeZone', 'UTC', 'mealKind', 'lunch', 'label', null,
    'occurredAt', null, 'sortOrder', 0, 'mealRevision', 1, 'dayRevision', 1,
    'confirmedAt', '2026-11-04T13:00:00Z', 'engineVersion', 'sql-test-v1',
    'status', 'confirmed', 'items', '[]'::jsonb, 'totals', '{}'::jsonb
  );
  v_bad_next_draft := jsonb_set(v_expected_draft, '{revision}', '2'::jsonb);

  begin
    perform * from public.append_journal_snapshot(v_user, v_day_confirm, 1, v_expected_draft,
      v_bad_next_draft, v_snapshot);
    raise exception 'Expected post-confirmation draft mismatch rejection';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    if v_message = 'Expected post-confirmation draft mismatch rejection'
      or v_message <> 'JOURNAL_DRAFT_SNAPSHOT_MISMATCH' then
      raise exception 'Unexpected post-confirmation draft validation result: SQLSTATE %, message %', v_sqlstate, v_message;
    end if;
  end;

  v_bad_next_draft := jsonb_set(
    jsonb_set(jsonb_set(v_expected_draft, '{revision}', '2'::jsonb), '{meals}', '[]'::jsonb),
    '{timeZone}', '"Europe/Paris"'::jsonb
  );
  begin
    perform * from public.append_journal_snapshot(v_user, v_day_confirm, 1, v_expected_draft,
      v_bad_next_draft, v_snapshot);
    raise exception 'Expected altered post-confirmation day metadata rejection';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    if v_message = 'Expected altered post-confirmation day metadata rejection'
      or v_message <> 'JOURNAL_DRAFT_SNAPSHOT_MISMATCH' then
      raise exception 'Unexpected altered post-confirmation draft validation result: SQLSTATE %, message %', v_sqlstate, v_message;
    end if;
  end;

  v_next_draft := jsonb_set(
    jsonb_set(v_expected_draft, '{revision}', '2'::jsonb), '{meals}', '[]'::jsonb
  );
  perform * from public.append_journal_snapshot(v_user, v_day_confirm, 1, v_expected_draft,
    v_next_draft, v_snapshot);
  select d.* into v_saved from public.journal_days d where d.id = v_day_confirm and d.user_id = v_user;
  if v_saved.revision <> 2 or v_saved.draft is distinct from v_next_draft then
    raise exception 'Valid confirmation did not persist the expected next draft';
  end if;
end
$test$;

rollback;
