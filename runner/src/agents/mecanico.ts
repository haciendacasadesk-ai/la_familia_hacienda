import { db, say, enqueue, type Task } from '../lib/db.js';
import { has } from '../lib/env.js';
import { etsyDemand, googleDemand } from '../lib/demand.js';

/** Gezondheidscheck: welke koppelingen staan, en hoeveel AI-budget is vandaag gebruikt. */
export async function health(_t: Task) {
  const missing: string[] = [];
  if (!has.etsy()) missing.push('Etsy (Seller App-sleutels)');
  if (!has.gelato()) missing.push('Gelato (API-sleutel)');
  if (!etsyDemand.configured() && !googleDemand.configured()) missing.push('vraagdata (keyword-tool of Keyword Planner)');

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());

  await say('mecanico', 'patron', missing.length ? 'alarm' : 'rapport',
    missing.length ? `Nog niet gekoppeld: ${missing.join(', ')}.` : `Alle koppelingen actief. ${count ?? 0} AI-aanroepen vandaag.`);

  await enqueue('mecanico', 'mecanico.health', {}, new Date(Date.now() + 6 * 3600_000));
  return { missing };
}
