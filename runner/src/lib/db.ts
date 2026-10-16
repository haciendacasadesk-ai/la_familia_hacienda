import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Service role: de runner mag alles, ook de tabellen die het dashboard niet ziet.
export const db = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type MsgType = 'opdracht' | 'rapport' | 'goedkeuring' | 'veto' | 'alarm' | 'geld' | 'order';

export interface Task {
  id: number;
  agent: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Een bericht op de bus. Het dashboard laat het mensje ervoor lopen. */
export async function say(from: string, to: string, type: MsgType, body: string, meta: Record<string, unknown> = {}) {
  const { error } = await db.from('messages').insert({ from_agent: from, to_agent: to, type, body, meta });
  if (error) console.error('[bus]', error.message);
}

/** Zet een nieuwe taak in de wachtrij. */
export async function enqueue(agent: string, kind: string, payload: Record<string, unknown> = {}, runAfter?: Date) {
  const { error } = await db.from('tasks').insert({ agent, kind, payload, run_after: (runAfter ?? new Date()).toISOString() });
  if (error) throw new Error(`[queue] ${error.message}`);
}

/** Vraagt de Jefe om een beslissing in het Bureau. */
export async function askJefe(requestedBy: string, kind: string, title: string, detail: string, payload: Record<string, unknown> = {}) {
  const { error } = await db.from('approvals').insert({ requested_by: requestedBy, kind, title, detail, payload });
  if (error) throw new Error(`[bureau] ${error.message}`);
  await say(requestedBy, 'jefe', 'goedkeuring', `Ter goedkeuring: ${title}`);
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
