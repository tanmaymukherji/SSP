alter table public.selco_vendors
  add column if not exists legacy_products_links text,
  add column if not exists contact_notes text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
