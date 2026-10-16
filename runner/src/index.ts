import { db, say, enqueue, type Task } from './lib/db.js';
import { env, has } from './lib/env.js';
import * as consigliere from './agents/consigliere.js';
import * as halcon from './agents/halcon.js';
import * as mecanico from './agents/mecanico.js';
import * as plaza from './agents/plaza.js';
import { publishStatus } from './agents/mecanico.js';
import { startServer } from './server.js';

// Welke agent wat kan. Nieuwe taken komen hier bij naarmate agents live gaan.
const handlers: Record<string, (t: Task) => Promise<unknown>> = {
  'consigliere.screen_trends': consigliere.screenTrends,
  'halcon.expand': halcon.expand,
  'halcon.measure': halcon.measure,
  'patron.review_trends': halcon.reviewTrends,
  'mecanico.health': mecanico.health,
  'capo.plan_collection': plaza.planCollection,
  'artista.create': plaza.createDesign,
  'inspector.check': plaza.inspect,
  'consigliere.check_design': plaza.checkDesign,
  'pregonero.publish': plaza.publish,
};

const MAX_ATTEMPTS = 3;

async function runOne(): Promise<boolean> {
  const { data, error } = await db.rpc('claim_task');
  if (error) { console.error('[runner] claim_task:', error.message); return false; }
  const task = data as Task | null;
  if (!task?.id) return false;

  const fn = handlers[task.kind];
  if (!fn) {
    await db.from('tasks').update({ status: 'failed', error: `Onbekende taak: ${task.kind}`, finished_at: new Date().toISOString() }).eq('id', task.id);
    return true;
  }
  console.log(`[runner] ${task.agent} → ${task.kind} (#${task.id})`);
  try {
    const result = await fn(task);
    await db.from('tasks').update({ status: 'done', result: result ?? null, finished_at: new Date().toISOString() }).eq('id', task.id);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[runner] #${task.id} mislukt:`, msg);
    const retry = task.attempts < MAX_ATTEMPTS;
    await db.from('tasks').update({
      status: retry ? 'queued' : 'failed',
      error: msg,
      run_after: new Date(Date.now() + 60_000 * task.attempts).toISOString(),
    }).eq('id', task.id);
    if (!retry) await say('mecanico', 'patron', 'alarm', `Taak ${task.kind} van ${task.agent} faalt na ${MAX_ATTEMPTS} pogingen: ${msg.slice(0, 160)}`);
  }
  return true;
}

/** Verwerkt beslissingen van de Jefe uit het Bureau. */
async function processDecisions() {
  const { data } = await db.from('approvals').select('*').neq('status', 'pending').is('note', null).limit(20);
  for (const a of data ?? []) {
    const yes = a.status === 'approved';
    if (a.kind === 'trend' && a.payload?.trend_id) {
      await db.from('trends').update({ status: yes ? 'approved' : 'rejected' }).eq('id', a.payload.trend_id);
      if (yes) { await say('patron', 'capo', 'opdracht', `Jefe keurde goed: ${a.title.replace(/^Trend: /, '')}. Maak een collectieplan.`); await enqueue('capo', 'capo.plan_collection', { trend_id: a.payload.trend_id }); }
      else await say('patron', 'halcon', 'veto', `Jefe wees af: ${a.title}.`);
    }
    if (a.kind === 'design' && a.payload?.design_id) {
      if (yes) { await say('patron', 'pregonero', 'opdracht', `Jefe keurde goed: ${a.title.replace(/^Design: /, '')}. Zet het klaar als concept.`); await enqueue('pregonero', 'pregonero.publish', { design_id: a.payload.design_id }); }
      else { await db.from('designs').update({ stage: 'afgekeurd', notes: 'afgewezen door de Jefe' }).eq('id', a.payload.design_id); await say('patron', 'artista', 'veto', `Jefe wees af: ${a.title.replace(/^Design: /, '')}.`); }
    }
    await db.from('approvals').update({ note: yes ? 'verwerkt: goedgekeurd' : 'verwerkt: afgewezen' }).eq('id', a.id);
  }
}

async function boot() {
  // Zorg dat de Mecánico altijd een gezondheidscheck in de planning heeft
  const { count } = await db.from('tasks').select('id', { count: 'exact', head: true }).eq('kind', 'mecanico.health').in('status', ['queued', 'running']);
  if (!count) await enqueue('mecanico', 'mecanico.health');
  // Staan er nog ongescreende trends en is er geen screening onderweg? Dan opnieuw klaarzetten.
  const { count: cand } = await db.from('trends').select('id', { count: 'exact', head: true }).eq('status', 'candidate');
  const { count: busy } = await db.from('tasks').select('id', { count: 'exact', head: true }).eq('kind', 'consigliere.screen_trends').in('status', ['queued', 'running']);
  if (cand && !busy) await enqueue('consigliere', 'consigliere.screen_trends');
  // Zijn de Etsy-sleutels er nu wel? Dan hoeven uitgestelde metingen niet langer te wachten.
  if (has.etsy()) await db.from('tasks').update({ run_after: new Date().toISOString() }).eq('kind', 'halcon.measure').eq('status', 'queued');
  await publishStatus();
  await say('mecanico', 'patron', 'rapport', 'De motor draait. La Familia is wakker.');
}

process.on('unhandledRejection', (e) => console.error('[runner] onafgehandelde fout:', e));

async function main() {
  const once = process.argv.includes('--once');
  if (!once) startServer();
  for (let i = 1; ; i++) {
    try { await boot(); break; }
    catch (e) {
      console.error(`[runner] opstarten mislukt (poging ${i}):`, (e as Error).message);
      if (once || i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  do {
    try {
      await processDecisions();
      while (await runOne()) { /* werk de wachtrij af */ }
    } catch (e) {
      console.error('[runner]', (e as Error).message);
    }
    if (!once) await new Promise((r) => setTimeout(r, env.pollMs));
  } while (!once);
}

main().catch((e) => { console.error('[runner] gestopt:', (e as Error).message); process.exit(1); });
