BEGIN;
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  saved public.meal_templates;
  count_rows integer;
  owner_a uuid := '10000000-0000-4000-8000-000000000001';
  owner_b uuid := '10000000-0000-4000-8000-000000000002';
  template_a uuid := '20000000-0000-4000-8000-000000000001';
  template_b uuid := '20000000-0000-4000-8000-000000000002';
BEGIN
  -- Explicit creation and first immutable revision.
  SELECT * INTO saved FROM public.save_meal_template_atomic(
    owner_a, template_a, 'Déjeuner', 1,
    jsonb_build_object('id',template_a::text,'name','Déjeuner','revision','1','meal',jsonb_build_object('items','[]'::jsonb)), NULL
  );
  IF saved.user_id <> owner_a OR saved.revision <> 1 THEN RAISE EXCEPTION 'create owner/revision mismatch'; END IF;

  -- Rename is an atomic revision append.
  SELECT * INTO saved FROM public.save_meal_template_atomic(
    owner_a, template_a, 'Déjeuner maison', 2,
    jsonb_build_object('id',template_a::text,'name','Déjeuner maison','revision','2','meal',jsonb_build_object('items','[]'::jsonb)), 1
  );
  SELECT count(*) INTO count_rows FROM public.meal_template_revisions WHERE template_id=template_a AND user_id=owner_a;
  IF count_rows <> 2 THEN RAISE EXCEPTION 'expected two immutable revisions, got %', count_rows; END IF;

  -- Stale concurrent update must conflict and leave the current version untouched.
  BEGIN
    PERFORM * FROM public.save_meal_template_atomic(
      owner_a, template_a, 'Stale edit', 2,
      jsonb_build_object('id',template_a::text,'name','Stale edit','revision','2','meal',jsonb_build_object('items','[]'::jsonb)), 1
    );
    RAISE EXCEPTION 'stale update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '40001' THEN NULL;
  END;
  SELECT revision INTO count_rows FROM public.meal_templates WHERE id=template_a AND user_id=owner_a;
  IF count_rows <> 2 THEN RAISE EXCEPTION 'stale update changed current model'; END IF;

  -- Same model ID cannot be assigned to another account.
  BEGIN
    PERFORM * FROM public.save_meal_template_atomic(
      owner_b, template_a, 'Other account', 1,
      jsonb_build_object('id',template_a::text,'name','Other account','revision','1','meal',jsonb_build_object('items','[]'::jsonb)), NULL
    );
    RAISE EXCEPTION 'cross-account duplicate unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT count(*) INTO count_rows FROM public.meal_templates WHERE user_id=owner_b AND id=template_a;
  IF count_rows <> 0 THEN RAISE EXCEPTION 'model leaked across accounts'; END IF;

  -- Independent account can create its own model.
  PERFORM * FROM public.save_meal_template_atomic(
    owner_b, template_b, 'Collation', 1,
    jsonb_build_object('id',template_b::text,'name','Collation','revision','1','meal',jsonb_build_object('items','[]'::jsonb)), NULL
  );

  -- User-requested deletion removes the current model but retains archived revisions.
  DELETE FROM public.meal_templates WHERE user_id=owner_a AND id=template_a;
  SELECT count(*) INTO count_rows FROM public.meal_templates WHERE user_id=owner_a AND id=template_a;
  IF count_rows <> 0 THEN RAISE EXCEPTION 'model deletion failed'; END IF;
  SELECT count(*) INTO count_rows FROM public.meal_template_revisions WHERE user_id=owner_a AND template_id=template_a;
  IF count_rows <> 2 THEN RAISE EXCEPTION 'deleted model history was not retained'; END IF;
END
$test$;

ROLLBACK;
