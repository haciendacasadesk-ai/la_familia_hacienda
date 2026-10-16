-- La Familia · Etsy-koppeling (OAuth met PKCE)
-- Het dashboard maakt een eenmalige 'state' aan; de motor maakt daar de geheime verifier bij en stuurt je naar Etsy.

create table public.oauth_states (
  state       text primary key,
  provider    text not null default 'etsy',
  verifier    text,                      -- alleen door de motor ingevuld, nooit leesbaar voor het dashboard
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);
alter table public.oauth_states enable row level security;
create policy "jefe start koppeling" on public.oauth_states
  for insert to authenticated with check (created_by = auth.uid() and verifier is null);

-- Status van de koppeling, zichtbaar in het dashboard (zonder tokens)
insert into public.settings (key, value) values ('etsy_connection', '{"connected": false}')
on conflict (key) do nothing;
