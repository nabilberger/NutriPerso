begin;
insert into auth.users(id) values ('15000000-0000-4000-8000-000000000001');
set local role service_role;
insert into public.waist_measurements(user_id, measured_on, waist_cm)
values ('15000000-0000-4000-8000-000000000001', '2026-11-07', 81.2);
do $$ begin
  if (select waist_cm from public.waist_measurements where measured_on='2026-11-07') <> 81.2 then
    raise exception 'waist precision lost';
  end if;
  begin
    insert into public.waist_measurements(user_id, measured_on, waist_cm)
    values ('15000000-0000-4000-8000-000000000001', '2026-11-07', 5);
    raise exception 'invalid waist accepted';
  exception when check_violation then null;
  end;
end $$;
delete from public.waist_measurements where user_id='15000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform * from public.waist_measurements;
    raise exception 'client bypass';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
