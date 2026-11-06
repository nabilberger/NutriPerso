begin;
insert into auth.users(id)values('11000000-0000-4000-8000-000000000001') on conflict do nothing;
set local role service_role;
select public.reserve_photo_analysis('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',5,'test-flash');
do $$begin
 begin perform public.reserve_photo_analysis('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',5,'test-flash');raise exception 'duplicate accepted';exception when others then if sqlerrm='duplicate accepted' then raise;end if;end;
end$$;
select public.finish_photo_analysis('11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002',123);
do $$begin
 if (select tokens from public.photo_analysis_usage where id='11000000-0000-4000-8000-000000000002')<>123 then raise exception 'usage lost';end if;
end$$;
-- Seed 45 DH in this UTC month, ensure the global ceiling cannot be exceeded.
insert into public.photo_analysis_usage(id,user_id,reserved_dh,model) select gen_random_uuid(),'11000000-0000-4000-8000-000000000001',5,'test' from generate_series(1,9);
do $$begin
 begin perform public.reserve_photo_analysis('11000000-0000-4000-8000-000000000001',gen_random_uuid(),0.01,'test');raise exception 'budget exceeded';exception when others then if sqlerrm='budget exceeded' then raise;end if;end;
 if (select (public.photo_analysis_usage()->>'reservedDh')::numeric)<>50 then raise exception 'budget wrong';end if;
end$$;
reset role;
set local role authenticated;
do $$begin
 begin perform public.reserve_photo_analysis('11000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'test');raise exception 'client bypass';exception when insufficient_privilege then null;end;
 begin perform * from public.photo_analysis_usage;raise exception 'client access';exception when insufficient_privilege then null;end;
end$$;
rollback;
