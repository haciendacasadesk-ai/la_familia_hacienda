-- Harde grens op AI-aanroepen per dag (de motor stopt de agents tot de volgende dag)
insert into public.settings (key, value) values ('ai_daily_cap_calls', '200')
on conflict (key) do update set value = excluded.value;
delete from public.settings where key = 'ai_daily_cap_usd';
