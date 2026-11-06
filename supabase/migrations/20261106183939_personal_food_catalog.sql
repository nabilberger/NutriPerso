-- Extend the existing catalogue. Never update confirmed meal/recipe snapshots.
ALTER TABLE public.foods
 ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0 AND revision<=9007199254740991),
 ADD COLUMN archived boolean NOT NULL DEFAULT false,
 ADD COLUMN personal_document jsonb;
DO $migration$
DECLARE owner_id uuid; owners bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.foods WHERE source_type='custom') THEN
  SELECT count(*) INTO owners FROM auth.users;
  IF owners<>1 THEN RAISE EXCEPTION 'Personal catalogue ownership backfill requires exactly one proven Auth owner; found %',owners; END IF;
  SELECT id INTO owner_id FROM auth.users;
  UPDATE public.foods SET user_id=owner_id WHERE source_type='custom';
 END IF;
END
$migration$;
ALTER TABLE public.foods ADD CONSTRAINT foods_personal_owner CHECK(
 (source_type='custom' AND user_id IS NOT NULL) OR (source_type<>'custom' AND user_id IS NULL));
ALTER TABLE public.foods ADD CONSTRAINT foods_personal_document_identity CHECK(personal_document IS NULL OR (
 source_type='custom' AND jsonb_typeof(personal_document)='object'
 AND (personal_document->>'id') IS NOT DISTINCT FROM id::text
 AND (personal_document->>'revision') IS NOT DISTINCT FROM revision::text
 AND (personal_document->>'name') IS NOT DISTINCT FROM description
 AND (personal_document->>'archived') IS NOT DISTINCT FROM archived::text));
CREATE INDEX foods_personal_owner_idx ON public.foods(user_id,archived,updated_at DESC) WHERE user_id IS NOT NULL;
CREATE POLICY foods_owner_select ON public.foods FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
-- Table access remains service-only; this policy does not grant Data API privileges.
CREATE FUNCTION public.save_personal_food(p_user_id uuid,p_food_id uuid,p_expected_revision bigint,p_document jsonb)
RETURNS SETOF public.foods LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE current_food public.foods%rowtype; row_exists boolean; datum jsonb; portion jsonb; code text;
BEGIN
 IF p_user_id IS NULL OR p_food_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
  OR jsonb_typeof(p_document) IS DISTINCT FROM 'object'
  OR p_document->>'id' IS DISTINCT FROM p_food_id::text
  OR p_document->>'revision' IS DISTINCT FROM (p_expected_revision+1)::text
  OR p_document->>'archived' IS DISTINCT FROM 'false'
  OR jsonb_typeof(p_document->'name') IS DISTINCT FROM 'string' OR length(btrim(p_document->>'name')) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(p_document->'category') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_document->'reference') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_document->'notes') IS DISTINCT FROM 'string'
  OR p_document->>'basis' IS NULL OR p_document->>'basis' NOT IN('g','ml')
  OR jsonb_typeof(p_document->'nutrients') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_document->'portions') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_INVALID'; END IF;
 FOREACH code IN ARRAY ARRAY['energy','protein','carbohydrate','fat','fiber'] LOOP
  datum:=p_document->'nutrients'->code;
  IF jsonb_typeof(datum) IS DISTINCT FROM 'object' OR NOT(datum?'value')
   OR datum->>'unit' IS NULL
   OR (code='energy' AND datum->>'unit' NOT IN('kcal','kJ'))
   OR (code<>'energy' AND datum->>'unit' NOT IN('g','mg'))
   OR (datum->'value'<>'null'::jsonb AND (jsonb_typeof(datum->'value') IS DISTINCT FROM 'string'
    OR datum->>'value' !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_NUTRIENT_INVALID'; END IF;
 END LOOP;
 IF jsonb_array_length(p_document->'portions')>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_PORTION_INVALID'; END IF;
 FOR portion IN SELECT value FROM jsonb_array_elements(p_document->'portions') LOOP
  IF jsonb_typeof(portion->'id') IS DISTINCT FROM 'string' OR btrim(portion->>'id')=''
   OR jsonb_typeof(portion->'label') IS DISTINCT FROM 'string' OR btrim(portion->>'label')=''
   OR portion->>'unit' IS NULL OR portion->>'unit' NOT IN('piece','slice','teaspoon','tablespoon','custom')
   OR portion->>'basis' IS NULL OR portion->>'basis' NOT IN('g','ml') OR NOT(portion?'amount')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_PORTION_INVALID'; END IF;
  IF portion->'amount'<>'null'::jsonb THEN
   IF jsonb_typeof(portion->'amount') IS DISTINCT FROM 'string' OR portion->>'amount' !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_PORTION_INVALID'; END IF;
   IF (portion->>'amount')::numeric<=0 OR (portion->>'amount')::numeric>1000000
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_PORTION_INVALID'; END IF;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(p_document->'portions'))<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_document->'portions'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PERSONAL_FOOD_PORTION_DUPLICATE'; END IF;
 SELECT * INTO current_food FROM public.foods WHERE id=p_food_id FOR UPDATE; row_exists:=FOUND;
 IF row_exists THEN
  IF current_food.user_id IS DISTINCT FROM p_user_id OR current_food.source_type<>'custom' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PERSONAL_FOOD_OWNER'; END IF;
  IF current_food.revision=p_expected_revision+1 AND current_food.personal_document=p_document THEN RETURN NEXT current_food;RETURN;END IF;
  IF current_food.archived OR current_food.revision<>p_expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PERSONAL_FOOD_CONFLICT'; END IF;
  UPDATE public.foods SET description=p_document->>'name',category=nullif(p_document->>'category',''),source_reference=nullif(p_document->>'reference',''),source_notes=nullif(p_document->>'notes',''),
   revision=p_expected_revision+1,personal_document=p_document,updated_at=now() WHERE id=p_food_id RETURNING * INTO current_food;
 ELSE
  IF p_expected_revision<>0 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PERSONAL_FOOD_CONFLICT';END IF;
  INSERT INTO public.foods(id,source_type,description,user_id,revision,personal_document,category,source_name,source_reference,source_notes,imported_at)
   VALUES(p_food_id,'custom',p_document->>'name',p_user_id,1,p_document,nullif(p_document->>'category',''),'Saisie personnelle',nullif(p_document->>'reference',''),nullif(p_document->>'notes',''),now()) RETURNING * INTO current_food;
 END IF;
 -- Replace the five editable nutrients atomically, preserving unrelated legacy micronutrients.
 DELETE FROM public.food_nutrients WHERE food_id=p_food_id AND(fdc_nutrient_id IN(1008,2047,2048,1003,1004,1005,1079)
  OR nutrient_code ~ '^(name:)?(energy|energie|protein|proteines|carbohydrate|carbohydrates|carbohydrate-by-difference|glucides|fat|total-lipid-fat|lipides|fiber|fibres)(:|$)');
 FOREACH code IN ARRAY ARRAY['energy','protein','carbohydrate','fat','fiber'] LOOP
  datum:=p_document->'nutrients'->code;
  IF datum->'value'<>'null'::jsonb THEN
   INSERT INTO public.food_nutrients(food_id,nutrient_code,nutrient_name,value,unit,reference_quantity,reference_unit,basis_source)
    VALUES(p_food_id,code,code,(datum->>'value')::numeric,datum->>'unit',100,p_document->>'basis','manual');
  END IF;
 END LOOP;
 RETURN NEXT current_food;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PERSONAL_FOOD_CONFLICT';
END
$function$;
CREATE FUNCTION public.archive_personal_food(p_user_id uuid,p_food_id uuid,p_expected_revision bigint)
RETURNS SETOF public.foods LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE current_food public.foods%rowtype;
BEGIN
 SELECT * INTO current_food FROM public.foods WHERE id=p_food_id AND user_id=p_user_id AND source_type='custom' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 IF current_food.archived THEN RETURN NEXT current_food;RETURN;END IF;
 IF p_expected_revision IS NULL OR current_food.revision<>p_expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='PERSONAL_FOOD_CONFLICT';END IF;
 UPDATE public.foods SET archived=true,revision=revision+1,updated_at=now(),personal_document=CASE WHEN personal_document IS NULL THEN NULL ELSE
  jsonb_set(jsonb_set(personal_document,'{archived}','true'::jsonb),'{revision}',to_jsonb(revision+1)) END WHERE id=p_food_id RETURNING * INTO current_food;
 RETURN NEXT current_food;
END
$function$;
REVOKE ALL ON FUNCTION public.save_personal_food(uuid,uuid,bigint,jsonb),public.archive_personal_food(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_personal_food(uuid,uuid,bigint,jsonb),public.archive_personal_food(uuid,uuid,bigint) TO service_role;
