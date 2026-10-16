# La Familia · De Hacienda

Een organisatie van AI-agents die print-on-demand Etsy-stores runt, met Gelato als productiepartner. Het dashboard (De Hacienda) laat live zien wie waaraan werkt en wie met wie praat.

Store 1: **PrintCabinet**, een trendstudio voor wall art met drie pijlers (esthetiek-drops, klassiekers en publiek domein, huisdieren per ras). Alleen trends met bewezen vraag en weinig aanbod.

## Onderdelen

| Map | Wat |
| --- | --- |
| `supabase/migrations` | Databaseschema en startdata: agents, berichtenbus, takenwachtrij, goedkeuringen, trends, metingen, designs, listings, orders, boekhouding |
| `runner` | De motor (Node/TypeScript). Pakt taken uit de wachtrij en laat de agents werken via de Claude API |
| `dashboard` | De Hacienda. Simuleert zonder configuratie, speelt live de echte berichten af met `config.js` |

## Wat er nu live kan

1. **El Consigliere** screent trendthema's op IP-risico. Hoog risico gaat er direct uit.
2. **El Halcón** bedenkt per thema 12 Etsy-zoektermen en meet het aanbod exact via de Etsy API.
3. **El Patrón** stuurt de top 10% kansen naar het Bureau van de Jefe, zodra er vraagdata is.
4. **El Mecánico** meldt elke 6 uur welke koppelingen nog ontbreken.

Vraagdata (zoekvolume) zit er bewust nog niet in: we koppelen pas een bron als er een abonnement of account is. Zonder vraag geen kansscore; liever geen getal dan een verzonnen getal.

## Opzetten

### 1. Database

1. Open je Supabase-project → **SQL Editor**.
2. Plak en run `supabase/migrations/0001_init.sql`, daarna `0002_seed.sql`.
3. **Authentication → Providers → Email**: aan. Zet bij **Authentication → Sign In / Providers** nieuwe aanmeldingen uit nadat je zelf bent ingelogd, zodat niemand anders een account kan maken.

### 2. Motor

```bash
cd runner
cp .env.example .env   # vul in
npm install
npm run dev            # lokaal, of: npm run once voor één ronde
```

De motor moet altijd draaien. Lokaal is prima om te testen; voor 24/7 zet je hem op een kleine server (Railway, Render, Fly.io of een eigen machine). Start-commando: `npm run build && npm start`.

### 3. Dashboard

1. Kopieer `dashboard/config.example.js` naar `dashboard/config.js` en vul de URL en de **anon** key in.
2. Host de map `dashboard` als statische site (Netlify, Vercel of GitHub Pages).
3. Voeg die URL toe bij Supabase → **Authentication → URL Configuration → Redirect URLs**.

## Regels die in de code zitten

- Geen publicatie zonder groen licht van El Inspector én El Consigliere (komt met de Artista).
- Minimummarge 20%, geen advertenties (`settings`).
- Maximaal 5 nieuwe listings per dag.
- Elke AI-aanroep wordt gelogd per agent (`ai_usage`).
- Sleutels staan alleen in `.env` van de motor; het dashboard kent alleen de anon key.

_The term 'Etsy' is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc._
