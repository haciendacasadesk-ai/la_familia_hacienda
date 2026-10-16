-- Margedoel aangescherpt: 50% brutomarge in Gelato (verkoopprijs = 2× kostprijs).
-- Na Etsy-kosten komt dat neer op ongeveer 30–35% netto; El Banquero bewaakt die nettogrens.
update public.settings
   set value = '{"min": 0.30, "max": 0.40, "gelato_gross": 0.50}'
 where key = 'margin';
