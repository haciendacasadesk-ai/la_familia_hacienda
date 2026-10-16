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
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}

/** Zelfde als think(), maar verwacht JSON terug (in een ```json-blok of kaal). */
export async function thinkJson<T>(agent: string, system: string, prompt: string, opts: { tier?: Tier; maxTokens?: number } = {}): Promise<T> {
  const txt = await think(agent, system + '\n\nAntwoord uitsluitend met geldige JSON, zonder uitleg.', prompt, opts);
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : txt).trim();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${agent} gaf geen geldige JSON terug: ${raw.slice(0, 200)}`);
  }
}
