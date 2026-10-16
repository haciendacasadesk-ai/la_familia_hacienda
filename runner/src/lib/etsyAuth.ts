import { createHash, randomBytes } from 'node:crypto';
import { db, say, enqueue } from './db.js';
import { env, has } from './env.js';

// Etsy OAuth 2.0 met PKCE. https://developers.etsy.com/documentation/essentials/authentication
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
export const SCOPES = 'listings_r listings_w listings_d shops_r shops_w transactions_r transactions_w';

const b64url = (b: Buffer) => b.toString('base64url');

export function redirectUri() {
  if (!env.publicUrl) throw new Error('PUBLIC_URL ontbreekt: het openbare adres van de motor (Railway → Settings → Networking).');
  return `${env.publicUrl.replace(/\/$/, '')}/etsy/callback`;
}

/** Start: controleert de state van het dashboard, maakt de geheime verifier en geeft de Etsy-URL terug. */
export async function startAuth(state: string): Promise<string> {
  if (!has.etsy()) throw new Error('ETSY_KEYSTRING en ETSY_SHARED_SECRET ontbreken in Railway.');
  const { data: row } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle();
  if (!row || row.used_at || Date.now() - Date.parse(row.created_at) > 10 * 60_000) throw new Error('Deze koppellink is verlopen. Start opnieuw vanuit De Hacienda.');
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  await db.from('oauth_states').update({ verifier }).eq('state', state);
  const u = new URL('https://www.etsy.com/oauth/connect');
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.etsyKeystring!,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Etsy token ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

/** Callback: wisselt de code in voor tokens en slaat ze op bij de shop. */
export async function finishAuth(code: string, state: string): Promise<{ shopId: number }> {
  const { data: row } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle();
  if (!row?.verifier || row.used_at) throw new Error('Onbekende of al gebruikte koppeling.');
  await db.from('oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);

  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: env.etsyKeystring!,
    redirect_uri: redirectUri(),
    code,
    code_verifier: row.verifier,
  });

  const me = await fetch('https://openapi.etsy.com/v3/application/users/me', {
    headers: { 'x-api-key': `${env.etsyKeystring}:${env.etsySharedSecret}`, Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json() as Promise<{ user_id: number; shop_id?: number }>);
  if (!me.shop_id) throw new Error('Dit Etsy-account heeft (nog) geen actieve shop.');

  await db.from('etsy_tokens').upsert({
    shop_id: me.shop_id,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  await db.from('settings').upsert({ key: 'etsy_connection', value: { connected: true, shop_id: me.shop_id, at: new Date().toISOString() } });
  await say('mecanico', 'patron', 'rapport', `Etsy gekoppeld (shop ${me.shop_id}). De familie mag nu concept-listings plaatsen en orders lezen.`);
  await enqueue('halcon', 'halcon.measure');
  await db.from('settings').update({ value: { ...(await db.from('settings').select('value').eq('key', 'integrations').maybeSingle()).data?.value, etsy_shop: true } }).eq('key', 'integrations');
  return { shopId: me.shop_id };
}

/** Geeft een geldig access token; ververst automatisch (Etsy-tokens verlopen na 1 uur). */
export async function accessToken(): Promise<{ token: string; shopId: number }> {
  const { data: t } = await db.from('etsy_tokens').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!t) throw new Error('Etsy is nog niet gekoppeld via De Hacienda.');
  if (Date.parse(t.expires_at) - Date.now() > 5 * 60_000) return { token: t.access_token, shopId: t.shop_id };
  try {
    const tok = await tokenRequest({ grant_type: 'refresh_token', client_id: env.etsyKeystring!, refresh_token: t.refresh_token });
    await db.from('etsy_tokens').update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('shop_id', t.shop_id);
    return { token: tok.access_token, shopId: t.shop_id };
  } catch (e) {
    await db.from('settings').upsert({ key: 'etsy_connection', value: { connected: false, reason: 'verversen mislukt' } });
    await say('mecanico', 'patron', 'alarm', 'Etsy-koppeling verlopen. De Jefe moet opnieuw koppelen in De Hacienda.');
    throw e;
  }
}
