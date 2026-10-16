import { db, say, enqueue, type Task } from '../lib/db.js';
import { thinkJson } from '../lib/claude.js';

const SYSTEM = `Je bent El Consigliere, compliance- en IP-bewaker van een Etsy-store met print-on-demand wall art (wereldwijde markt).
Je beoordeelt trendthema's op risico voor merkrecht en auteursrecht, en op Etsy-beleid (Creativity Standards, productiepartner, AI-melding).
Hoog risico: titels, personages, beelden of logo's uit films, series, games of moderne boeken; namen van artiesten of merken; quotes van moderne auteurs; uitspraken die vaak als merk zijn geregistreerd.
Laag risico: algemene esthetiek en stijlen, eigen illustraties, natuur, dieren, werken die publiek domein zijn (vóór 1929 gepubliceerd of anderszins vrij) zolang er niets van moderne verfilmingen in zit.
Je bent streng: bij twijfel 'middel'. Je kunt geen merkregisters raadplegen; zeg dat erbij als een term gecontroleerd moet worden.`;

interface Screen { theme: string; risk: 'laag' | 'middel' | 'hoog'; notes: string; avoid: string[] }

export async function screenTrends(_t: Task) {
  const { data: trends, error } = await db.from('trends').select('id, theme, pillar').eq('status', 'candidate');
  if (error) throw error;
  if (!trends?.length) return { screened: 0 };

  const out = await thinkJson<Screen[]>('consigliere', SYSTEM,
    `Beoordeel deze trendthema's. Geef per thema: theme (exact overnemen), risk, notes (max 2 zinnen, Nederlands), avoid (lijst van concrete dingen die de designer moet vermijden).\n\n${trends.map((t) => `- ${t.theme} [${t.pillar}]`).join('\n')}`,
    { tier: 'strong' });

  let ok = 0;
  for (const s of out) {
    const tr = trends.find((t) => t.theme === s.theme);
    if (!tr) continue;
    const status = s.risk === 'hoog' ? 'rejected' : 'screened';
    await db.from('trends').update({ ip_risk: s.risk, ip_notes: `${s.notes}${s.avoid?.length ? ` Vermijden: ${s.avoid.join(', ')}.` : ''}`, status }).eq('id', tr.id);
    if (s.risk === 'hoog') await say('consigliere', 'halcon', 'veto', `Afgewezen: ${s.theme}. ${s.notes}`);
    else ok++;
  }
  await say('consigliere', 'halcon', 'rapport', `${ok} van ${trends.length} trends door de IP-screening. Je kunt zoektermen maken.`);
  await enqueue('halcon', 'halcon.expand');
  return { screened: out.length, passed: ok };
}
