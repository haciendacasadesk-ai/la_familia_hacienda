-- La Familia · startdata: de familie, de regels en de eerste meetlijst

insert into public.agents (id, name, role, room, reports_to, autonomy, active, sleep_reason) values
  ('patron',        'El Patrón',        'CEO',                 'kantoor', null,          'met_goedkeuring', true,  null),
  ('banquero',      'El Banquero',      'Finance',             'kluis',   'patron',      'met_goedkeuring', true,  null),
  ('consigliere',   'El Consigliere',   'Compliance en IP',    'bib',     'patron',      'met_goedkeuring', true,  null),
  ('escribano',     'El Escribano',     'Archief',             'bib',     'patron',      'uit',             false, 'Fase 3'),
  ('halcon',        'El Halcón',        'Onderzoeker',         'toren',   'patron',      'met_goedkeuring', true,  null),
  ('sombra',        'La Sombra',        'Concurrentiespion',   'toren',   'halcon',      'uit',             false, 'Fase 3'),
  ('mecanico',      'El Mecánico',      'Operations',          'werk',    'patron',      'autonoom',        true,  null),
  ('voz',           'La Voz',           'Klantenservice',      'radio',   'patron',      'met_goedkeuring', true,  null),
  ('promotor',      'El Promotor',      'Marketing',           'radio',   'patron',      'uit',             false, 'Geen ads'),
  ('capo',          'El Capo',          'Store owner Plaza 1', 'plaza1',  'patron',      'met_goedkeuring', true,  null),
  ('artista',       'El Artista',       'Designer',            'plaza1',  'capo',        'met_goedkeuring', true,  null),
  ('fotografo',     'El Fotógrafo',     'Mockups',             'plaza1',  'capo',        'met_goedkeuring', true,  null),
  ('pregonero',     'El Pregonero',     'Publisher',           'plaza1',  'capo',        'met_goedkeuring', true,  null),
  ('cartero',       'El Cartero',       'Orderafhandeling',    'plaza1',  'capo',        'met_goedkeuring', true,  null),
  ('transportista', 'El Transportista', 'POD-coördinator',     'garage',  'patron',      'met_goedkeuring', true,  null),
  ('inspector',     'El Inspector',     'Kwaliteitscontrole',  'garage',  'patron',      'met_goedkeuring', true,  null);

insert into public.settings (key, value) values
  ('margin',               '{"min": 0.20, "max": 0.30}'),
  ('ads_enabled',          'false'),
  ('max_new_listings_day', '5'),
  ('ai_daily_cap_usd',     '5'),
  ('market',               '"wereldwijd"'),
  ('store_1',              '{"name": "PrintCabinet", "concept": "trendstudio", "pod": "gelato"}');

insert into public.trends (pillar, theme) values
  ('esthetiek',      'Dark academia studieprints'),
  ('esthetiek',      'Plum Noir en dark florals'),
  ('esthetiek',      'Plaid en countryside'),
  ('esthetiek',      'Cozymaxxing leeshoek'),
  ('publiek_domein', 'Gotische klassiekers (Brontë, Poe)'),
  ('publiek_domein', 'Vintage botanische platen'),
  ('huisdieren',     'Opkomende hondenrassen in line-art'),
  ('huisdieren',     'Katten in herfstsferen');

-- Eerste opdracht: El Consigliere screent de meetlijst, daarna maakt El Halcón zoektermen
insert into public.tasks (agent, kind, payload) values ('consigliere', 'consigliere.screen_trends', '{}');
