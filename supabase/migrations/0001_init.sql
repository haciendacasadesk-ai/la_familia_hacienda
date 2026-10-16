-- La Familia · basisschema
-- Alles wat de agents doen staat hier: berichten, taken, goedkeuringen, trends, metingen, designs, listings, orders en geld.

create extension if not exists pgcrypto;

-- Agents --------------------------------------------------------------------
create table public.agents (
  id            text primary key,
  name          text not null,
  role          text not null,
  room          text not null,
  reports_to    text references public.agents(id),
  autonomy      text not null default 'met_goedkeuring'
                check (autonomy in ('schaduw','met_goedkeuring','steekproef','autonoom','uit')),
  active        boolean not null default true,
  sleep_reason  text,
  created_at    timestamptz not null default now()
);

-- Berichtenbus: elk bericht is een lijn tussen twee mensjes in De Hacienda ---
create table public.messages (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  from_agent  text not null,          -- agent-id, of 'jefe' / 'etsy' / 'gelato'
  to_agent    text not null,
  type        text not null check (type in ('opdracht','rapport','goedkeuring','veto','alarm','geld','order')),
  body        text not null,
  meta        jsonb not null default '{}'::jsonb
);
create index messages_created_idx on public.messages (created_at desc);

-- Takenwachtrij ---------------------------------------------------------------
create table public.tasks (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  agent       text not null references public.agents(id),
  kind        text not null,          -- bijv. 'halcon.expand', 'halcon.measure'
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'queued'
              check (status in ('queued','running','done','failed','waiting_approval','cancelled')),
  run_after   timestamptz not null default now(),
  attempts    int not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  result      jsonb,
  error       text
);
create index tasks_queue_idx on public.tasks (status, run_after);

-- Pakt atomair de volgende taak (veilig met meerdere runners)
create or replace function public.claim_task()
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare t public.tasks;
begin
  select * into t from public.tasks
   where status = 'queued' and run_after <= now()
   order by run_after, id
   for update skip locked
   limit 1;
  if not found then return null; end if;
  update public.tasks
     set status = 'running', started_at = now(), attempts = attempts + 1
   where id = t.id
  returning * into t;
  return t;
end $$;

-- Bureau van de Jefe --------------------------------------------------------
create table public.approvals (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  requested_by  text not null,
  kind          text not null,         -- 'trend', 'design', 'budget', 'store', ...
  title         text not null,
  detail        text,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at    timestamptz,
  note          text
);

-- Trends en metingen (El Halcón) ---------------------------------------------
create table public.trends (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  pillar      text not null check (pillar in ('esthetiek','publiek_domein','huisdieren')),
  theme       text not null unique,
  status      text not null default 'candidate'
              check (status in ('candidate','screened','measured','approved','rejected','retired')),
  ip_risk     text check (ip_risk in ('laag','middel','hoog')),
  ip_notes    text,
  notes       text
);

create table public.keywords (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  trend_id    bigint references public.trends(id) on delete cascade,
  keyword     text not null unique
);

create table public.keyword_metrics (
  id                    bigserial primary key,
  measured_at           timestamptz not null default now(),
  keyword_id            bigint not null references public.keywords(id) on delete cascade,
  etsy_active_listings  int,          -- exact, via Etsy Open API
  demand_etsy_est       int,          -- geschat Etsy-zoekvolume (keyword-tool)
  demand_google         int,          -- Google Keyword Planner
  growth_12w            numeric,      -- relatieve groei, bijv. 0.18 = +18%
  opportunity           numeric       -- vraag / aanbod × groei
);
create index keyword_metrics_kw_idx on public.keyword_metrics (keyword_id, measured_at desc);

create or replace view public.keyword_latest with (security_invoker = true) as
select distinct on (k.id)
  k.id as keyword_id, k.keyword, t.id as trend_id, t.theme, t.pillar, t.ip_risk,
  m.measured_at, m.etsy_active_listings, m.demand_etsy_est, m.demand_google, m.growth_12w, m.opportunity
from public.keywords k
join public.trends t on t.id = k.trend_id
left join public.keyword_metrics m on m.keyword_id = k.id
order by k.id, m.measured_at desc nulls last;

-- Designs, listings, orders --------------------------------------------------
create table public.designs (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  trend_id    bigint references public.trends(id),
  title       text not null,
  stage       text not null default 'brief'
              check (stage in ('brief','design','keuring','ip','mockup','klaar','live','offline','afgekeurd')),
  prompt      text,
  image_path  text,                   -- Supabase Storage
  qc          jsonb,
  ip_check    jsonb
);

create table public.listings (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  design_id        bigint references public.designs(id),
  etsy_listing_id  bigint unique,
  state            text not null default 'concept' check (state in ('concept','draft','active','inactive')),
  title            text,
  tags             text[],
  price_cents      int,
  margin           numeric
);

create table public.orders (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  etsy_receipt_id  bigint unique,
  gelato_order_id  text,
  status           text not null default 'nieuw',
  country          text,
  totals           jsonb
);

-- Geld (El Banquero) -----------------------------------------------------------
create table public.ledger (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  kind          text not null check (kind in ('verkoop','verzending_klant','etsy_transactie','etsy_betaling','etsy_listing','gelato_product','gelato_verzending','ai','overig')),
  amount_cents  int not null,          -- inkomsten positief, kosten negatief
  currency      text not null default 'EUR',
  ref           text
);

create table public.ai_usage (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  agent          text not null,
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0
);

-- Instellingen -----------------------------------------------------------------
create table public.settings (
  key    text primary key,
  value  jsonb not null
);

-- Geheimen van koppelingen: alleen de runner (service role) mag hierbij ------
create table public.etsy_tokens (
  shop_id        bigint primary key,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);

-- Beveiliging ------------------------------------------------------------------
-- Het dashboard leest als ingelogde gebruiker (jij). De runner gebruikt de service role en omzeilt RLS.
do $$
declare t text;
begin
  foreach t in array array['agents','messages','tasks','approvals','trends','keywords','keyword_metrics','designs','listings','orders','ledger','ai_usage','settings','etsy_tokens']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['agents','messages','tasks','approvals','trends','keywords','keyword_metrics','designs','listings','orders','ledger','ai_usage','settings']
  loop
    execute format('create policy "jefe leest" on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

create policy "jefe beslist" on public.approvals for update to authenticated using (true) with check (true);
create policy "jefe stuurt berichten" on public.messages for insert to authenticated with check (from_agent = 'jefe');
create policy "jefe zet taken klaar" on public.tasks for insert to authenticated with check (true);

-- Live updates naar het dashboard
alter publication supabase_realtime add table public.messages, public.tasks, public.approvals, public.designs, public.keyword_metrics;
