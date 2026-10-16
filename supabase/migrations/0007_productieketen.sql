-- La Familia · productieketen: Gelato-template, opslag voor designs, en ruimte voor beoordelingen

-- Gelato: template en store van PaperParlorCrafts
insert into public.settings (key, value) values
  ('gelato', '{"store_id": "50eaa9e2-0529-4ba6-8001-9d55a1d94e3f", "template_id": "65beb9f1-f204-4ecc-884d-ae79f4284a40", "placeholder": "artwork"}')
on conflict (key) do update set value = excluded.value;

-- Hoeveel designs de Capo per collectie laat maken
insert into public.settings (key, value) values ('designs_per_collection', '3')
on conflict (key) do nothing;

-- Opslag voor designs. Publiek leesbaar: Gelato moet de bestanden kunnen ophalen.
insert into storage.buckets (id, name, public) values ('designs', 'designs', true)
on conflict (id) do nothing;

-- Extra velden op designs
alter table public.designs
  add column if not exists image_url  text,
  add column if not exists attempts   int not null default 0,
  add column if not exists notes      text;

-- Listings: koppeling met Gelato
alter table public.listings
  add column if not exists gelato_product_id text,
  add column if not exists gelato_status     text;

-- De Jefe mag vanuit De Hacienda een collectie starten
create policy "jefe start collectie" on public.tasks
  for insert to authenticated with check (agent = 'capo' and kind = 'capo.plan_collection');
