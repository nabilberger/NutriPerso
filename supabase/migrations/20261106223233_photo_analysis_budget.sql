-- Prepared only. No remote application is authorized.
create table public.photo_analysis_usage (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 reserved_dh numeric not null check (reserved_dh > 0 and reserved_dh <= 5),
 model text not null,
 tokens bigint check (tokens >= 0)
);
alter table public.photo_analysis_usage enable row level security;
revoke all on public.photo_analysis_usage from public, anon, authenticated;
grant select, insert, update on public.photo_analysis_usage to service_role;

create function public.reserve_photo_analysis(p_user uuid,p_id uuid,p_cost numeric,p_model text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(681403210);
 if p_cost is null or p_cost <= 0 or p_cost > 5 or p_model is null or length(p_model)>100 then raise exception 'invalid configuration'; end if;
 if exists(select 1 from public.photo_analysis_usage where id=p_id) then raise exception 'already attempted'; end if;
 if (select count(*) from public.photo_analysis_usage where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= 20 then raise exception 'daily cap'; end if;
 if (select coalesce(sum(reserved_dh),0) from public.photo_analysis_usage where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') + p_cost > 50 then raise exception 'monthly budget'; end if;
 insert into public.photo_analysis_usage(id,user_id,reserved_dh,model)values(p_id,p_user,p_cost,p_model);
end $$;
create function public.finish_photo_analysis(p_user uuid,p_id uuid,p_tokens bigint)
returns void language sql security invoker set search_path='' as $$
 update public.photo_analysis_usage set tokens=p_tokens where id=p_id and user_id=p_user;
$$;
create function public.photo_analysis_usage()
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('reservedDh',coalesce(sum(reserved_dh),0),'requests',count(*),'tokens',coalesce(sum(tokens),0)) from public.photo_analysis_usage
 where created_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
$$;
revoke all on function public.reserve_photo_analysis(uuid,uuid,numeric,text),public.finish_photo_analysis(uuid,uuid,bigint),public.photo_analysis_usage() from public,anon,authenticated;
grant execute on function public.reserve_photo_analysis(uuid,uuid,numeric,text),public.finish_photo_analysis(uuid,uuid,bigint),public.photo_analysis_usage() to service_role;
