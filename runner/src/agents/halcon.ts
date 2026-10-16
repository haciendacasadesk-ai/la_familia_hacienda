import { db, say, enqueue, askJefe, type Task } from '../lib/db.js';
import { thinkJson, asArray } from '../lib/claude.js';
import { has } from '../lib/env.js';
import { countActiveListings } from '../lib/etsy.js';
import { etsyDemand, googleDemand, opportunity } from '../lib/demand.js';

const SYSTEM = `Je bent El Halcón, trendonderzoeker van een Etsy-trendstudio voor wall art (posters, canvas, metal prints), wereldwijde Engelstalige markt.
Je bedenkt zoektermen zoals echte Etsy-kopers ze typen: Engels, 2–5 woorden, specifiek (stijl + onderwerp + ruimte of producttype).
Je vermijdt merknamen, titels, personages en namen van artiesten. Je volgt de aanwijzingen van El Consigliere over wat vermeden moet worden.`;

/** Stap 1: per goedgekeurd trendthema 12 long-tail zoektermen bedenken. */
export async function expand(_t: Task) {
  const { data: trends, error } = await db.from('trends').select('id, theme, pillar, ip_notes').eq('status', 'screened');
  if (error) throw error;
  if (!trends?.length) {
    await say('halcon', 'patron', 'rapport', 'Geen gescreende trends om zoektermen voor te maken.');
    return { keywords: 0 };
  }
  const raw = await thinkJson<unknown>('halcon', SYSTEM,
    `Maak per thema 12 Etsy-zoektermen. Geef JSON: [{"theme": "...", "keywords": ["..."]}].\n\n${trends.map((t) => `- ${t.theme} [${t.pillar}]${t.ip_notes ? ` — Consigliere: ${t.ip_notes}` : ''}`).join('\n')}`,
    { tier: 'fast', maxTokens: 8000 });
  const out = asArray<{ theme: string; keywords: string[] }>(raw);

  let n = 0;
  for (const row of out) {
    const tr = trends.find((t) => t.theme === row.theme);
    if (!tr) continue;
    const rows = [...new Set(row.keywords.map((k) => k.toLowerCase().trim()))].map((keyword) => ({ trend_id: tr.id, keyword }));
    const { data } = await db.from('keywords').upsert(rows, { onConflict: 'keyword', ignoreDuplicates: true }).select('id');
    n += data?.length ?? 0;
  }
  await say('halcon', 'patron', 'rapport', `${n} zoektermen klaar voor meting.`);
  await enqueue('halcon', 'halcon.measure');
  return { keywords: n };
}

/** Stap 2: aanbod (exact, Etsy API) en vraag (zodra gekoppeld) meten, kansscore berekenen. */
export async function measure(_t: Task) {
  if (!has.etsy()) {
    await say('halcon', 'mecanico', 'alarm', 'Ik kan het aanbod niet meten: Etsy-sleutels ontbreken. Meting uitgesteld.');
    await enqueue('halcon', 'halcon.measure', {}, new Date(Date.now() + 6 * 3600_000));
    return { skipped: 'etsy-niet-gekoppeld' };
  }
  const { data: kws, error } = await db.from('keyword_latest').select('keyword_id, keyword, theme, measured_at');
  if (error) throw error;
  const stale = (kws ?? []).filter((k) => !k.measured_at || Date.now() - Date.parse(k.measured_at) > 7 * 86400_000);
  if (!stale.length) return { measured: 0 };

  const list = stale.map((k) => k.keyword);
  const [etsyVol, googleVol] = await Promise.all([etsyDemand.monthlyVolume(list), googleDemand.monthlyVolume(list)]);

  let measured = 0;
  for (const k of stale) {
    let listings: number | null = null;
    try { listings = await countActiveListings(k.keyword); } catch (e) { console.error('[halcon]', (e as Error).message); continue; }
    const e = etsyVol.get(k.keyword) ?? null, g = googleVol.get(k.keyword) ?? null;
    await db.from('keyword_metrics').insert({
      keyword_id: k.keyword_id, etsy_active_listings: listings, demand_etsy_est: e, demand_google: g,
      growth_12w: null, opportunity: opportunity({ listings, etsy: e, google: g, growth: null }),
    });
    measured++;
  }

  const demandLive = etsyDemand.configured() || googleDemand.configured();
  await say('halcon', 'patron', 'rapport', demandLive
    ? `${measured} zoektermen gemeten, kansscores bijgewerkt.`
    : `${measured} zoektermen gemeten op aanbod. Vraagdata ontbreekt nog, dus nog geen kansscores.`);
  if (demandLive) await enqueue('patron', 'patron.review_trends');
  return { measured };
}

/** Stap 3 (Patrón): de beste kansen ter goedkeuring naar de Jefe. */
export async function reviewTrends(_t: Task) {
  const { data } = await db.from('keyword_latest').select('*').not('opportunity', 'is', null).order('opportunity', { ascending: false }).limit(50);
  if (!data?.length) return { proposed: 0 };
  const cut = Math.max(1, Math.ceil(data.length * 0.1));
  const top = data.slice(0, cut);
  const byTrend = new Map<number, typeof top>();
  for (const r of top) byTrend.set(r.trend_id, [...(byTrend.get(r.trend_id) ?? []), r]);
  for (const [trendId, rows] of byTrend) {
    await askJefe('patron', 'trend', `Trend: ${rows[0].theme}`,
      rows.map((r) => `"${r.keyword}": ${r.etsy_active_listings} listings, vraag ${r.demand_etsy_est ?? '–'} (Etsy) / ${r.demand_google ?? '–'} (Google)`).join(' · '),
      { trend_id: trendId, keywords: rows.map((r) => r.keyword) });
  }
  return { proposed: byTrend.size };
}
