import Anthropic from '@anthropic-ai/sdk';
import { env } from './env.js';
import { db, setting, say } from './db.js';

const client = new Anthropic({ apiKey: env.anthropicKey });

export type Tier = 'strong' | 'fast';

/**
 * Laat een agent denken. Elke aanroep wordt gelogd per agent,
 * zodat El Banquero de AI-kosten meeneemt in de winst.
 */
let alarmed = '';
/** Harde dagelijkse grens op het aantal AI-aanroepen (settings.ai_daily_cap_calls). */
async function checkBudget() {
  const cap = await setting<number>('ai_daily_cap_calls', 200);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
  if ((count ?? 0) >= cap) {
    const day = since.toISOString().slice(0, 10);
    if (alarmed !== day) { alarmed = day; await say('banquero', 'patron', 'geld', `AI-plafond bereikt (${cap} aanroepen vandaag). Agents pauzeren tot morgen.`); }
    throw new Error(`AI-dagplafond bereikt (${cap})`);
  }
}

export async function think(agent: string, system: string, prompt: string, opts: { tier?: Tier; maxTokens?: number } = {}): Promise<string> {
  await checkBudget();
  const model = opts.tier === 'strong' ? env.modelStrong : env.modelFast;
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 2000,
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  await db.from('ai_usage').insert({
    agent,
    model,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
  });
  if (res.stop_reason === 'max_tokens') console.warn(`[${agent}] antwoord afgekapt op max_tokens (${opts.maxTokens ?? 2000})`);
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

/** Laat een agent naar een afbeelding kijken (JPEG, base64) en JSON teruggeven. */
export async function lookJson<T>(agent: string, system: string, prompt: string, jpegBase64: string, opts: { tier?: Tier; maxTokens?: number } = {}): Promise<T> {
  await checkBudget();
  const model = opts.tier === 'fast' ? env.modelFast : env.modelStrong;
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1500,
    system: system + '\n\nAntwoord uitsluitend met geldige JSON in precies de gevraagde vorm, zonder uitleg ervoor of erna.',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
      { type: 'text', text: prompt },
    ] }],
  });
  await db.from('ai_usage').insert({ agent, model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
  const txt = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
  try { return extractJson(txt) as T; } catch { throw new Error(`${agent} gaf geen geldige JSON terug: ${txt.slice(0, 160)}`); }
}

/** Haalt JSON uit een antwoord, ook als er tekst omheen staat of het in een codeblok zit. */
function extractJson(txt: string): unknown {
  const fenced = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : txt).trim();
  try { return JSON.parse(body); } catch { /* verder zoeken */ }
  const starts = [body.indexOf('['), body.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('geen JSON gevonden');
  const start = Math.min(...starts);
  const end = Math.max(body.lastIndexOf(']'), body.lastIndexOf('}'));
  return JSON.parse(body.slice(start, end + 1));
}

/** Zelfde als think(), maar verwacht JSON terug. */
export async function thinkJson<T>(agent: string, system: string, prompt: string, opts: { tier?: Tier; maxTokens?: number } = {}): Promise<T> {
  const txt = await think(agent, system + '\n\nAntwoord uitsluitend met geldige JSON in precies de gevraagde vorm, zonder uitleg ervoor of erna.', prompt, opts);
  try {
    return extractJson(txt) as T;
  } catch {
    throw new Error(`${agent} gaf geen geldige JSON terug (mogelijk afgekapt): ${txt.slice(0, 160)}`);
  }
}

/** Accepteert een lijst, of een object met één lijst erin (bijv. {"beoordelingen": [...]}). */
export function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') {
    const arr = Object.values(v as Record<string, unknown>).find(Array.isArray);
    if (arr) return arr as T[];
  }
  throw new Error('verwachtte een lijst');
}
