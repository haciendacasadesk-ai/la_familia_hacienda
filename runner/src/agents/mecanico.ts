import { db, say, enqueue, setting, type Task } from '../lib/db.js';
import { has } from '../lib/env.js';
import { etsyDemand, googleDemand } from '../lib/demand.js';

/** Gezondheidscheck: welke koppelingen staan, en hoeveel AI-budget is vandaag gebruikt. */
export async function health(_t: Task) {
  const missing: string[] = [];
  if (!has.etsy()) missing.push('Etsy (Seller App-sleutels)');
  else if (!(await setting<{ connected?: boolean }>('etsy_connection', {})).connected) missing.push('Etsy-shop (klik "Koppel Etsy" in het Bureau)');
  if (!has.gelato()) missing.push('Gelato (API-sleutel)');
  if (!has.gemini()) missing.push('Gemini (GEMINI_API_KEY)');
  if (!etsyDemand.configured() && !googleDemand.configured()) missing.push('vraagdata (keyword-tool of Keyword Planner)');

  await publishStatus();

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());

  await say('mecanico', 'patron', missing.length ? 'alarm' : 'rapport',
    missing.length ? `Nog niet gekoppeld: ${missing.join(', ')}.` : `Alle koppelingen actief. ${count ?? 0} AI-aanroepen vandaag.`);

  await enqueue('mecanico', 'mecanico.health', {}, new Date(Date.now() + 6 * 3600_000));
  return { missing };
}

/** Zet de echte status van alle koppelingen in settings, zodat het dashboard die kan tonen (zonder sleutels). */
export async function publishStatus() {
  const etsyConn = await setting<{ connected?: boolean; shop_id?: number }>('etsy_connection', {});
  await db.from('settings').upsert({ key: 'integrations', value: {
    etsy_keys: has.etsy(),
    etsy_shop: Boolean(etsyConn.connected),
    gelato: has.gelato(),
    cloudflare: has.cloudflare(),
    gemini: has.gemini(),
    demand: etsyDemand.configured() || googleDemand.configured(),
    at: new Date().toISOString(),
  } });
}
