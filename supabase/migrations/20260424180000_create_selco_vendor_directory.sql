create extension if not exists pgcrypto;

create table if not exists public.selco_vendor_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  requested_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  vendor_count integer not null default 0,
  product_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.selco_vendors (
  id uuid primary key default gen_random_uuid(),
  portal_vendor_id text not null unique,
  vendor_name text not null,
  about_vendor text,
  website_details text,
  location_text text,
  city text,
  state text,
  country text,
  service_locations text[] not null default '{}',
  tags text[] not null default '{}',
  portal_vendor_link text,
  portal_contact_name text,
  portal_email text,
  portal_phone text,
  website_email text,
  website_phone text,
  website_address text,
  final_contact_email text,
  final_contact_phone text,
  final_contact_address text,
  contact_source_url text,
  website_status text,
  products_count integer not null default 0,
  search_text text,
  raw_vendor jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.selco_products (
  id uuid primary key default gen_random_uuid(),
  portal_product_id text not null unique,
  portal_vendor_id text not null references public.selco_vendors(portal_vendor_id) on delete cascade,
  vendor_name text not null,
  product_name text not null,
  product_description text,
  product_link text,
  tags text[] not null default '{}',
  search_text text,
  raw_product jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists selco_vendors_name_idx on public.selco_vendors (lower(vendor_name));
create index if not exists selco_vendors_tags_idx on public.selco_vendors using gin (tags);
create index if not exists selco_products_vendor_idx on public.selco_products (portal_vendor_id);
create index if not exists selco_products_name_idx on public.selco_products (lower(product_name));
create index if not exists selco_products_tags_idx on public.selco_products using gin (tags);

alter table public.selco_vendor_sync_runs enable row level security;
alter table public.selco_vendors enable row level security;
alter table public.selco_products enable row level security;

drop policy if exists "selco vendors are public" on public.selco_vendors;
drop policy if exists "selco products are public" on public.selco_products;

create policy "selco vendors are public"
on public.selco_vendors
for select
to anon, authenticated
using (true);

create policy "selco products are public"
on public.selco_products
for select
to anon, authenticated
using (true);
