import { createServer } from 'node:http';
import { env } from './lib/env.js';
import { startAuth, finishAuth } from './lib/etsyAuth.js';

/** Kleine webserver voor de motor: gezondheidscheck en de Etsy-koppeling. */
export function startServer() {
  const page = (title: string, body: string, ok = true) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#16100d;color:#efdfc3;font:16px system-ui;padding:16px">
<div style="max-width:460px;text-align:center"><h1 style="font-family:Georgia,serif;color:${ok ? '#f0a830' : '#e2513f'}">${title}</h1><p>${body}</p>
${env.dashboardUrl ? `<p><a style="color:#f0a830" href="${env.dashboardUrl}">Terug naar De Hacienda</a></p>` : ''}</div></body>`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (code: number, html: string) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    try {
      if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }

      if (url.pathname === '/etsy/connect') {
        const state = url.searchParams.get('state');
        if (!state) return send(400, page('Koppelen mislukt', 'Geen state meegegeven. Start vanuit De Hacienda.', false));
        const to = await startAuth(state);
        res.writeHead(302, { Location: to }); res.end(); return;
      }

      if (url.pathname === '/etsy/callback') {
        const err = url.searchParams.get('error');
        if (err) return send(400, page('Koppelen geannuleerd', `Etsy gaf terug: ${err}.`, false));
        const code = url.searchParams.get('code'), state = url.searchParams.get('state');
        if (!code || !state) return send(400, page('Koppelen mislukt', 'Etsy stuurde geen code terug.', false));
        const { shopId } = await finishAuth(code, state);
        if (env.dashboardUrl) { res.writeHead(302, { Location: `${env.dashboardUrl.replace(/\/$/, '')}/#etsy-gekoppeld` }); res.end(); return; }
        return send(200, page('Etsy gekoppeld', `Shop ${shopId} is gekoppeld aan La Familia.`));
      }

      send(404, page('Niet gevonden', 'Hier woont alleen de motor van La Familia.', false));
    } catch (e) {
      send(500, page('Koppelen mislukt', (e as Error).message.replace(/</g, '&lt;'), false));
    }
  });
  server.listen(env.port, () => console.log(`[server] luistert op poort ${env.port}`));
}
