create table public.foods (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('usda', 'local', 'custom')),
  fdc_id bigint unique
    check (fdc_id is null or fdc_id > 0),
  description text not null
    check (length(trim(description)) > 0),
  category text,
  data_type text,
  brand_owner text,
  source_name text,
  source_reference text,
  source_notes text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint foods_source_fdc_id_check check (
    (source_type = 'usda' and fdc_id is not null)
    or (source_type in ('local', 'custom') and fdc_id is null)
  ),
  constraint foods_data_type_source_check check (
    data_type is null or source_type = 'usda'
  )
);

create index foods_description_prefix_idx
  on public.foods using btree (lower(description) text_pattern_ops);

create table public.food_nutrients (
  food_id uuid not null references public.foods(id) on delete cascade,
  nutrient_code text not null,
  nutrient_name text not null,
  fdc_nutrient_id integer,
  value numeric not null,
  unit text,
  reference_quantity numeric,
  reference_unit text,
  basis_source text,

  primary key (food_id, nutrient_code),
  unique (food_id, fdc_nutrient_id),

  constraint food_nutrients_reference_check check (
    (reference_quantity is null and reference_unit is null and basis_source is null)
    or (
      reference_quantity is not null
      and reference_quantity > 0
      and reference_unit is not null
      and reference_unit in ('g', 'ml')
      and basis_source is not null
      and basis_source in (
        'fdc_data_type',
        'fdc_branded_standardization',
        'source_documentation',
        'manual'
      )
    )
  )
);

alter table public.foods enable row level security;
alter table public.food_nutrients enable row level security;

revoke all on table public.foods, public.food_nutrients from anon, authenticated;
grant select, insert, update, delete
  on table public.foods, public.food_nutrients to service_role;
