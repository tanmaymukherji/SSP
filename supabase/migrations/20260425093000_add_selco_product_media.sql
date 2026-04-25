alter table public.selco_products
  add column if not exists product_image_url text,
  add column if not exists product_specifications jsonb not null default '[]'::jsonb;
