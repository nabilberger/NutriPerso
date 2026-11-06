\echo 'Personal foods: exact values, unknowns, ownership, atomic revisions, archive and portions'
BEGIN;

DO $test$
DECLARE
 owner_id uuid:='10000000-0000-4000-8000-000000000001';
 other_id uuid:='10000000-0000-4000-8000-000000000002';
 v_food_id uuid:='60000000-0000-4000-8000-000000000001';
 doc jsonb; updated jsonb; old_doc jsonb; recipe_before jsonb; v_recipe_id uuid:='70000000-0000-4000-8000-000000000001'; rows_count int;
BEGIN
 doc:=jsonb_build_object('id',v_food_id,'name','Purée personnelle SQL','category','Maison','reference','Étiquette','notes','Synthétique',
 'revision',1,'archived',false,'basis','g','nutrients',jsonb_build_object(
 'energy',jsonb_build_object('value','123.123456789012345678','unit','kcal'),
 'protein',jsonb_build_object('value','0','unit','g'),
 'carbohydrate',jsonb_build_object('value',null,'unit','g'),
 'fat',jsonb_build_object('value','5','unit','g'),
 'fiber',jsonb_build_object('value','2','unit','g')),
 'portions',jsonb_build_array(jsonb_build_object('id','spoon','label','Cuillère','unit','tablespoon','amount','15.5','basis','g')));
 INSERT INTO public.foods(id,source_type,fdc_id,description) VALUES('60000000-0000-4000-8000-000000000050','usda',9000050,'Shared USDA');
 BEGIN
  PERFORM public.save_personal_food(owner_id,'60000000-0000-4000-8000-000000000050',0,jsonb_set(doc,'{id}','"60000000-0000-4000-8000-000000000050"'));
  RAISE EXCEPTION 'Personal RPC overwrote a shared USDA entry';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.save_personal_food(owner_id,v_food_id,0,doc);
 PERFORM public.save_personal_food(owner_id,v_food_id,0,doc);
 IF (SELECT count(*) FROM public.foods WHERE id=v_food_id)<>1 OR (SELECT count(*) FROM public.food_nutrients n WHERE n.food_id=v_food_id)<>4 THEN RAISE EXCEPTION 'Retry duplicated food or invented unknown nutrients';END IF;
 IF (SELECT value FROM public.food_nutrients n WHERE n.food_id=v_food_id AND nutrient_code='energy')<>123.123456789012345678::numeric THEN RAISE EXCEPTION 'Source precision lost';END IF;
 IF (SELECT value FROM public.food_nutrients n WHERE n.food_id=v_food_id AND nutrient_code='protein')<>0 THEN RAISE EXCEPTION 'Real zero lost';END IF;
 PERFORM public.save_recipe_draft(owner_id,v_recipe_id,0,jsonb_build_object('id',v_recipe_id,'name','Recette source personnelle','revision',1,'servings','1','finalWeight',null,'ingredients',jsonb_build_array(jsonb_build_object('id','i','foodId','catalog:'||v_food_id,'position',0,'quantity',jsonb_build_object('kind','serving','amount','1','unit','tablespoon','equivalenceId','spoon')))));
 recipe_before:=jsonb_build_object('schemaVersion','1','snapshotId','personal-source-recipe-s1','engineVersion','sql-contract-test','confirmedAt','2026-11-06T12:00:00Z',
 'recipe',jsonb_build_object('id',v_recipe_id,'name','Recette source personnelle','revision',1,'servings','1','finalWeight',null),'allocation',jsonb_build_object('kind','total'),
 'ingredients',jsonb_build_array(jsonb_build_object('ingredientId','i','food',jsonb_build_object('foodId','catalog:'||v_food_id),'enteredQuantity',jsonb_build_object('kind','serving','amount','1','unit','tablespoon','equivalenceId','spoon'),'equivalenceSnapshot',doc->'portions'->0,'sourceNutrients',doc->'nutrients')),'referenceTotals','[]'::jsonb,'totals','[]'::jsonb);
 PERFORM public.append_recipe_snapshot(owner_id,v_recipe_id,1,null,recipe_before);
 INSERT INTO public.food_nutrients(food_id,nutrient_code,nutrient_name,value,unit,reference_quantity,reference_unit,basis_source) VALUES
 (v_food_id,'name:total-lipid-fat:g','Legacy fat alias',99,'g',100,'g','manual'),(v_food_id,'calcium','Calcium',12,'mg',100,'g','manual');
 old_doc:=doc;
 updated:=jsonb_set(jsonb_set(doc,'{revision}','2'),'{nutrients,fat,value}','null');
 updated:=jsonb_set(updated,'{portions,0,amount}','"20"');
 PERFORM public.save_personal_food(owner_id,v_food_id,1,updated);
 IF EXISTS(SELECT 1 FROM public.food_nutrients n WHERE n.food_id=v_food_id AND nutrient_code IN('fat','name:total-lipid-fat:g')) THEN RAISE EXCEPTION 'Unknown nutrient retained old known value';END IF;
 BEGIN
  PERFORM public.save_personal_food(owner_id,v_food_id,1,jsonb_set(updated,'{name}','"Stale overwrite"'));
  RAISE EXCEPTION 'Stale write accepted';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN
  PERFORM public.save_personal_food(other_id,v_food_id,2,jsonb_set(updated,'{revision}','3'));
  RAISE EXCEPTION 'Foreign write accepted';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.archive_personal_food(other_id,v_food_id,2)) THEN RAISE EXCEPTION 'Foreign archive accepted';END IF;
 BEGIN
  PERFORM public.save_personal_food(owner_id,v_food_id,2,jsonb_set(jsonb_set(updated,'{revision}','3'),'{portions,0,amount}','"0"'));
  RAISE EXCEPTION 'Invalid equivalence accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF (SELECT revision FROM public.foods WHERE id=v_food_id)<>2 OR (SELECT personal_document FROM public.foods WHERE id=v_food_id)<>updated THEN RAISE EXCEPTION 'Failed save partially changed document';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.food_nutrients n WHERE n.food_id=v_food_id AND nutrient_code='calcium' AND value=12) THEN RAISE EXCEPTION 'Legacy micronutrient removed';END IF;
 -- Force an error AFTER the food update by an isolated test trigger on the nutrient table.
 EXECUTE 'CREATE FUNCTION public.fail_personal_test() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE=''22023'',MESSAGE=''synthetic nutrient failure''; END $f$';
 EXECUTE 'CREATE TRIGGER personal_test_failure BEFORE INSERT ON public.food_nutrients FOR EACH ROW EXECUTE FUNCTION public.fail_personal_test()';
 BEGIN
  PERFORM public.save_personal_food(owner_id,v_food_id,2,jsonb_set(updated,'{revision}','3'));
  RAISE EXCEPTION 'Synthetic failure not propagated';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 EXECUTE 'DROP TRIGGER personal_test_failure ON public.food_nutrients';
 EXECUTE 'DROP FUNCTION public.fail_personal_test()';
 IF (SELECT revision FROM public.foods WHERE id=v_food_id)<>2 OR (SELECT count(*) FROM public.food_nutrients n WHERE n.food_id=v_food_id)<>4 THEN RAISE EXCEPTION 'Atomic rollback failed';END IF;
 PERFORM public.archive_personal_food(owner_id,v_food_id,2);
 PERFORM public.archive_personal_food(owner_id,v_food_id,2);
 IF NOT EXISTS(SELECT 1 FROM public.foods WHERE id=v_food_id AND archived AND revision=3 AND personal_document->>'archived'='true') THEN RAISE EXCEPTION 'Archive/retry failed';END IF;
 BEGIN
  PERFORM public.save_personal_food(owner_id,v_food_id,3,jsonb_set(updated,'{revision}','4'));
  RAISE EXCEPTION 'Archived food resurrected';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 IF old_doc->>'revision'<>'1' OR old_doc#>>'{portions,0,amount}'<>'15.5' THEN RAISE EXCEPTION 'Old value changed';END IF;
 IF (SELECT snapshot FROM public.recipe_snapshots WHERE snapshot_id='personal-source-recipe-s1') IS DISTINCT FROM recipe_before THEN RAISE EXCEPTION 'Historical recipe snapshot changed';END IF;
 RAISE NOTICE 'PASS: exact decimals, unknown vs zero, versioned portions, stale/foreign rejection, atomic rollback, idempotent archive';
END
$test$;
ROLLBACK;
DO $test$
DECLARE signature text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.save_personal_food(uuid,uuid,bigint,jsonb)','public.archive_personal_food(uuid,uuid,bigint)'] LOOP
  IF has_function_privilege('anon',signature,'EXECUTE') OR has_function_privilege('authenticated',signature,'EXECUTE') OR NOT has_function_privilege('service_role',signature,'EXECUTE') THEN RAISE EXCEPTION 'Unsafe personal food RPC permissions';END IF;
 END LOOP;
END
$test$;

-- Two asynchronous sessions race on the same expected revision under the actual service role.
CREATE EXTENSION IF NOT EXISTS dblink;
DO $concurrent$
DECLARE v_id uuid:='60000000-0000-4000-8000-000000000099'; owner_id uuid:='10000000-0000-4000-8000-000000000001'; doc jsonb; wins int:=0; n int;
BEGIN
 doc:=jsonb_build_object('id',v_id,'name','Concurrent seed','category','','reference','','notes','','revision',1,'archived',false,'basis','g','portions','[]'::jsonb,'nutrients',jsonb_build_object(
 'energy',jsonb_build_object('value',null,'unit','kcal'),'protein',jsonb_build_object('value','10','unit','g'),'carbohydrate',jsonb_build_object('value',null,'unit','g'),'fat',jsonb_build_object('value',null,'unit','g'),'fiber',jsonb_build_object('value',null,'unit','g')));
 PERFORM public.save_personal_food(owner_id,v_id,0,doc);
END
$concurrent$;
DO $concurrent$
DECLARE owner_id uuid:='10000000-0000-4000-8000-000000000001'; v_id uuid:='60000000-0000-4000-8000-000000000099'; doc jsonb; wins int; n int;
BEGIN
 SELECT personal_document INTO doc FROM public.foods WHERE id=v_id;
 PERFORM dblink_connect('personal_writer_a','host=127.0.0.1 dbname=nutriperso_test user=postgres password=local-only-nutriperso');
 PERFORM dblink_connect('personal_writer_b','host=127.0.0.1 dbname=nutriperso_test user=postgres password=local-only-nutriperso');
 PERFORM dblink_exec('personal_writer_a','SET ROLE service_role');PERFORM dblink_exec('personal_writer_b','SET ROLE service_role');
 PERFORM dblink_send_query('personal_writer_a',format('SELECT description,pg_sleep(0.2) FROM public.save_personal_food(%L,%L,1,%L::jsonb)',owner_id,v_id,doc||jsonb_build_object('name','Writer A','revision',2)));
 PERFORM dblink_send_query('personal_writer_b',format('SELECT description,pg_sleep(0.2) FROM public.save_personal_food(%L,%L,1,%L::jsonb)',owner_id,v_id,doc||jsonb_build_object('name','Writer B','revision',2)));
 SELECT count(*) INTO wins FROM dblink_get_result('personal_writer_a',false) AS t(description text,delay text);
 SELECT count(*) INTO n FROM dblink_get_result('personal_writer_b',false) AS t(description text,delay text);wins:=wins+n;
 PERFORM dblink_disconnect('personal_writer_a');PERFORM dblink_disconnect('personal_writer_b');
 IF wins<>1 OR (SELECT revision FROM public.foods WHERE id=v_id)<>2 THEN RAISE EXCEPTION 'Concurrent writers did not produce exactly one winner';END IF;
 DELETE FROM public.foods WHERE id=v_id;
 RAISE NOTICE 'PASS: actual concurrent service-role writers: one revision wins, the stale writer is rejected';
END
$concurrent$;
