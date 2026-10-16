import { env, has } from './env.js';

const BASE = 'https://openapi.etsy.com/v3/application';

// Etsy vraagt keystring en shared secret samen, gescheiden door een dubbele punt.
// https://developers.etsy.com/documentation/essentials/authentication
function headers(accessToken?: string): Record<string, string> {
  const h: Record<string, string> = { 'x-api-key': `${env.etsyKeystring}:${env.etsySharedSecret}` };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}

let lastCall = 0;
/** Houdt ruim afstand van de rate limit (nieuwe apps: rond 5 calls/sec). */
async function throttle() {
  const wait = lastCall + 250 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function get<T>(path: string, params: Record<string, string | number> = {}, accessToken?: string): Promise<T> {
  if (!has.etsy()) throw new Error('Etsy is nog niet gekoppeld: ETSY_KEYSTRING en ETSY_SHARED_SECRET ontbreken.');
  await throttle();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: headers(accessToken) });
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    return get(path, params, accessToken);
  }
  if (!res.ok) throw new Error(`Etsy ${res.status} op ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/**
 * Aanbod: hoeveel actieve listings er op Etsy zijn voor een zoekterm.
 * Gebruikt de officiële API (scrapen is niet toegestaan). Exact getal uit het veld `count`.
 */
export async function countActiveListings(keyword: string): Promise<number> {
  const r = await get<{ count: number }>('/listings/active', { keywords: keyword, limit: 1 });
  return r.count;
}

/** Bewijs van vraag bij concurrenten: favorieten op de best gevonden listings voor een zoekterm. */
export async function topListingSignals(keyword: string, limit = 25) {
  const r = await get<{ results: Array<{ listing_id: number; title: string; num_favorers?: number; price?: { amount: number; divisor: number; currency_code: string } }> }>(
    '/listings/active',
    { keywords: keyword, limit, sort_on: 'score' },
  );
  return r.results.map((l) => ({
    id: l.listing_id,
    title: l.title,
    favorites: l.num_favorers ?? null,
    price: l.price ? l.price.amount / l.price.divisor : null,
    currency: l.price?.currency_code ?? null,
  }));
}
