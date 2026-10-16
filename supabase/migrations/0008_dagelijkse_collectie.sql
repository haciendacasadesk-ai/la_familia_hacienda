-- El Patrón start zelf collecties: maximaal zoveel per dag (en niet als er al 6 designs op de Jefe wachten)
insert into public.settings (key, value) values ('collections_per_day', '1')
on conflict (key) do nothing;
