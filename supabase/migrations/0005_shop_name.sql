-- Store 1 heet PaperParlorCrafts
update public.settings
   set value = jsonb_set(value, '{name}', '"PaperParlorCrafts"')
 where key = 'store_1';
