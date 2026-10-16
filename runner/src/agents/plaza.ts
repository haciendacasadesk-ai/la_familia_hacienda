import { db, say, enqueue, askJefe, setting, type Task } from '../lib/db.js';
import { thinkJson, lookJson, asArray } from '../lib/claude.js';
import { generatePoster, preview, store, load } from '../lib/images.js';
import { createFromTemplate } from '../lib/gelato.js';

/* ---------------- El Capo: van trend naar collectieplan ---------------- */

const CAPO = `Je bent El Capo, store owner van PaperParlorCrafts: een Etsy-trendstudio voor wall art (staande posters, 4:5) voor een wereldwijd Engelstalig publiek.
Merkstijl: sfeervol, verzameld, "rooms with a story". Diep pruim, papierwit, oker en salie passen bij het merk, maar elke collectie mag zijn eigen palet hebben.
Je schrijft design-briefs voor El Artista, die beelden maakt met een AI-beeldmodel.
Regels: geen tekst in het beeld tenzij heel kort en essentieel; geen merken, logo's, bekende personages, beroemdheden, handtekeningen of stijlen van levende kunstenaars; volg de vermijdpunten van El Consigliere.
Een goede prompt beschrijft onderwerp, compositie, stijl/techniek (bijv. gouache, ets, linosnede, vintage botanische plaat), palet, licht en sfeer, en vraagt om een volledig beeld zonder rand, lijst of watermerk.`;

export async function planCollection(t: Task) {
  const trendId = Number(t.payload.trend_id);
  const { data: tr } = await db.from('trends').select('*').eq('id', trendId).maybeSingle();
  if (!tr) throw new Error(`Trend ${trendId} bestaat niet.`);
  if (tr.ip_risk === 'hoog' || tr.status === 'rejected') {
    await say('consigliere', 'capo', 'veto', `Geen collectie voor "${tr.theme}": afgewezen door de IP-screening.`);
    return { skipped: 'ip' };
  }
  const n = await setting<number>('designs_per_collection', 3);
  const { data: kws } = await db.from('keywords').select('keyword').eq('trend_id', trendId).limit(12);

  const raw = await thinkJson<unknown>('capo', CAPO,
    `Trend: ${tr.theme} (pijler: ${tr.pillar}).\nConsigliere: ${tr.ip_notes ?? 'geen opmerkingen'}\nZoektermen van kopers: ${(kws ?? []).map((k) => k.keyword).join(', ') || 'nog niet bekend'}\n\n` +
    `Maak ${n} verschillende designs die samen een collectie vormen (zelfde palet en techniek, ander onderwerp). ` +
    `Geef een JSON-lijst: [{"title": korte Engelse werktitel, "prompt": Engelse beeldprompt van 60–120 woorden}].`,
    { tier: 'strong', maxTokens: 3000 });
  const briefs = asArray<{ title: string; prompt: string }>(raw).slice(0, n);

  for (const b of briefs) {
    const { data: d, error } = await db.from('designs').insert({ trend_id: trendId, title: b.title, prompt: b.prompt, stage: 'design' }).select('id').single();
    if (error) throw error;
    await enqueue('artista', 'artista.create', { design_id: d.id });
  }
  await db.from('trends').update({ status: 'approved' }).eq('id', trendId);
  await say('capo', 'artista', 'opdracht', `${briefs.length} designs voor de collectie "${tr.theme}": ${briefs.map((b) => b.title).join(', ')}.`);
  return { designs: briefs.length };
}

/* ---------------- El Artista: het beeld maken ---------------- */

export async function createDesign(t: Task) {
  const id = Number(t.payload.design_id);
  const { data: d } = await db.from('designs').select('*').eq('id', id).maybeSingle();
  if (!d) throw new Error(`Design ${id} bestaat niet.`);
  const extra = d.notes ? `\n\nVerbeterpunten van de vorige poging: ${d.notes}` : '';
  const prompt = `${d.prompt}${extra}\n\nPortrait wall art print, full-bleed composition filling the whole canvas, no border, no frame, no mockup, no watermark, no signature, no text unless explicitly requested.`;

  const { png, width, height } = await generatePoster(prompt);
  const { path, url } = await store(id, png);
  await db.from('designs').update({ image_path: path, image_url: url, stage: 'keuring', attempts: (d.attempts ?? 0) + 1 }).eq('id', id);
  await say('artista', 'inspector', 'goedkeuring', `Ter keuring: ${d.title} (${width}×${height} px).`);
  await enqueue('inspector', 'inspector.check', { design_id: id });
  return { width, height };
}

/* ---------------- El Inspector: kwaliteit ---------------- */

const INSPECTOR = `Je bent El Inspector, kwaliteitscontroleur van een wall-art-shop. Je beoordeelt of een AI-beeld goed genoeg is om als poster te verkopen.
Afkeuren bij: vervormde handen, gezichten of dieren; onleesbare of verminkte tekst; zichtbare watermerken, handtekeningen of randen; vreemde artefacten; onderwerp afgesneden; rommelige compositie; kleuren die vies of vlak ogen.
Je bent kritisch maar redelijk: een kleine onvolkomenheid die niemand op een poster ziet is geen reden om af te keuren.`;

export async function inspect(t: Task) {
  const id = Number(t.payload.design_id);
  const { data: d } = await db.from('designs').select('*').eq('id', id).maybeSingle();
  if (!d?.image_path) throw new Error(`Design ${id} heeft geen beeld.`);
  const png = await load(d.image_path);
  const r = await lookJson<{ pass: boolean; score: number; issues: string[] }>('inspector', INSPECTOR,
    `Design: "${d.title}". Geef JSON: {"pass": true/false, "score": 1-10, "issues": [korte punten in het Nederlands]}.`,
    await preview(png), { tier: 'fast' });

  await db.from('designs').update({ qc: r }).eq('id', id);
  if (r.pass && r.score >= 7) {
    await db.from('designs').update({ stage: 'ip' }).eq('id', id);
    await say('inspector', 'consigliere', 'goedkeuring', `Kwaliteit ${r.score}/10: ${d.title}. Door naar IP-check.`);
    await enqueue('consigliere', 'consigliere.check_design', { design_id: id });
    return r;
  }
  return reject(d, 'inspector', `kwaliteit ${r.score}/10: ${r.issues.join('; ')}`);
}

/* ---------------- El Consigliere: IP-check van het beeld ---------------- */

const CONSIGLIERE_BEELD = `Je bent El Consigliere. Je controleert of een beeld veilig te verkopen is op Etsy.
Afkeuren bij: herkenbare merken of logo's, bekende (film/game/strip)personages, beroemdheden, tekst die een bekende quote of slogan is, kunstwerken die herkenbaar lijken op een bestaand modern werk, handtekeningen of watermerken van anderen.
Publiek-domeinstijlen (vintage botanische platen, oude etsen) zijn prima.`;

export async function checkDesign(t: Task) {
  const id = Number(t.payload.design_id);
  const { data: d } = await db.from('designs').select('*').eq('id', id).maybeSingle();
  if (!d?.image_path) throw new Error(`Design ${id} heeft geen beeld.`);
  const png = await load(d.image_path);
  const r = await lookJson<{ pass: boolean; risk: 'laag' | 'middel' | 'hoog'; notes: string }>('consigliere', CONSIGLIERE_BEELD,
    `Design: "${d.title}". Geef JSON: {"pass": true/false, "risk": "laag"|"middel"|"hoog", "notes": één korte zin in het Nederlands}.`,
    await preview(png), { tier: 'strong' });

  await db.from('designs').update({ ip_check: r }).eq('id', id);
  if (!r.pass || r.risk === 'hoog') return reject(d, 'consigliere', `IP-risico: ${r.notes}`, false);

  await db.from('designs').update({ stage: 'mockup' }).eq('id', id);
  await askJefe('patron', 'design', `Design: ${d.title}`,
    `Kwaliteit ${d.qc?.score ?? '?'}/10 · IP-risico ${r.risk}. ${r.notes}`,
    { design_id: id, image_url: d.image_url });
  return r;
}

/** Afkeuren: nog een poging met verbeterpunten (max 3 in totaal), anders afgekeurd. */
async function reject(d: { id: number; title: string; attempts: number }, by: string, why: string, retry = true) {
  if (retry && (d.attempts ?? 0) < 3) {
    await db.from('designs').update({ stage: 'design', notes: why }).eq('id', d.id);
    await say(by, 'artista', 'veto', `Opnieuw: ${d.title}. ${why}`);
    await enqueue('artista', 'artista.create', { design_id: d.id });
    return { retry: true };
  }
  await db.from('designs').update({ stage: 'afgekeurd', notes: why }).eq('id', d.id);
  await say(by, 'capo', 'veto', `Afgekeurd: ${d.title}. ${why}`);
  return { rejected: true };
}

/* ---------------- El Pregonero: listing klaarzetten via Gelato ---------------- */

const PREGONERO = `Je bent El Pregonero, publisher van PaperParlorCrafts op Etsy (wall art, wereldwijd, Engels).
Je schrijft listings die gevonden worden: de titel begint met de belangrijkste zoekterm, is natuurlijk leesbaar en maximaal 140 tekens.
Precies 13 tags, elk maximaal 20 tekens, geen herhaling van losse woorden als het kan, alleen zoektermen die kopers echt typen.
De beschrijving (Engels) opent met wat het is en voor welke kamer, noemt dat het een print zonder lijst is, verwijst naar de formaten in de listing, en eindigt met deze zin: "Designed by Paper Parlor using AI tools from our own prompts and art direction, then printed to order by our production partner."
Geen merknamen, geen beloftes die we niet kunnen waarmaken.`;

export async function publish(t: Task) {
  const id = Number(t.payload.design_id);
  const { data: d } = await db.from('designs').select('*, trends(theme)').eq('id', id).maybeSingle();
  if (!d?.image_url) throw new Error(`Design ${id} heeft geen beeld.`);
  const { data: kws } = await db.from('keyword_latest').select('keyword, etsy_active_listings, opportunity').eq('trend_id', d.trend_id).order('opportunity', { ascending: false, nullsFirst: false }).limit(15);

  const L = await thinkJson<{ title: string; tags: string[]; description: string }>('pregonero', PREGONERO,
    `Design: "${d.title}". Trend: ${d.trends?.theme ?? ''}.\nBeeldprompt: ${d.prompt}\n` +
    `Gemeten zoektermen (minder listings = minder concurrentie): ${(kws ?? []).map((k) => `${k.keyword} (${k.etsy_active_listings ?? '?'})`).join(', ') || 'nog niet gemeten'}\n\n` +
    `Geef JSON: {"title": "...", "tags": [13 tags], "description": "..."}.`,
    { tier: 'fast', maxTokens: 2000 });

  const product = await createFromTemplate({ title: L.title.slice(0, 140), description: L.description, tags: L.tags, fileUrl: d.image_url });
  await db.from('listings').insert({ design_id: id, state: 'concept', title: L.title, tags: L.tags, gelato_product_id: product.id, gelato_status: product.status });
  await db.from('designs').update({ stage: 'klaar' }).eq('id', id);
  await say('pregonero', 'capo', 'rapport', `Concept klaar in Gelato: "${L.title}". Gelato zet het als niet-zichtbaar product in Etsy; publiceren doet de Jefe.`);
  return { gelato: product.id, status: product.status };
}

/* ---------------- El Patrón: dagelijks de volgende collectie starten ---------------- */

/**
 * Kiest zelf de volgende trend als er niet te veel werk op de plank ligt.
 * Met vraagdata: hoogste kansscore. Zonder vraagdata (tijdelijk): laagste IP-risico en het minste aanbod op Etsy.
 */
export async function dailyCollection(_t: Task) {
  const perDay = await setting<number>('collections_per_day', 1);
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count: startedToday } = await db.from('tasks').select('id', { count: 'exact', head: true })
    .eq('kind', 'capo.plan_collection').gte('created_at', since.toISOString());
  const { count: waiting } = await db.from('approvals').select('id', { count: 'exact', head: true })
    .eq('status', 'pending').eq('kind', 'design');

  let started = false;
  if ((startedToday ?? 0) < perDay && (waiting ?? 0) < 6) {
    const { data: trends } = await db.from('trends').select('id, theme, ip_risk').eq('status', 'screened');
    if (trends?.length) {
      const { data: kw } = await db.from('keyword_latest').select('trend_id, etsy_active_listings, opportunity');
      const score = (id: number) => {
        const rows = (kw ?? []).filter((k) => k.trend_id === id);
        const opp = rows.map((r) => r.opportunity).filter((v): v is number => v != null);
        if (opp.length) return { opp: Math.max(...opp), supply: 0 };
        const sup = rows.map((r) => r.etsy_active_listings).filter((v): v is number => v != null);
        return { opp: null as number | null, supply: sup.length ? sup.reduce((a, b) => a + b, 0) / sup.length : Infinity };
      };
      const risk = (r: string | null) => (r === 'laag' ? 0 : r === 'middel' ? 1 : 2);
      const ranked = trends.map((t) => ({ ...t, ...score(t.id) })).sort((a, b) =>
        (b.opp ?? -1) - (a.opp ?? -1) || risk(a.ip_risk) - risk(b.ip_risk) || a.supply - b.supply);
      const pick = ranked[0];
      const why = pick.opp != null ? `hoogste kansscore (${pick.opp.toFixed(1)})` : `laag IP-risico en ${Number.isFinite(pick.supply) ? `gemiddeld ${Math.round(pick.supply).toLocaleString('nl-NL')} listings` : 'nog niet gemeten aanbod'}`;
      await say('patron', 'capo', 'opdracht', `Volgende collectie: ${pick.theme}. Gekozen op ${why}.`);
      await enqueue('capo', 'capo.plan_collection', { trend_id: pick.id });
      started = true;
    }
  }
  // morgen om 07:00 UTC weer
  const next = new Date(); next.setUTCDate(next.getUTCDate() + (started ? 1 : 0)); next.setUTCHours(7, 0, 0, 0);
  if (next <= new Date()) next.setUTCHours(next.getUTCHours() + 6);
  await enqueue('patron', 'patron.daily_collection', {}, next);
  return { started };
}
