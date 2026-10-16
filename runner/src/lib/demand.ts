/**
 * Vraag-meting. Etsy deelt zelf geen zoekvolumes, dus vraag komt altijd uit een schatting.
 * El Halcón weegt twee bronnen tegen elkaar: geschat Etsy-volume (keyword-tool) en Google Keyword Planner.
 *
 * Bewust nog niet ingevuld: we koppelen pas een bron als de Jefe er een abonnement of account voor heeft.
 * Tot die tijd geeft elke bron `null` terug en meet El Halcón alleen het aanbod (exact via de Etsy API).
 */
export interface DemandSource {
  name: string;
  configured(): boolean;
  monthlyVolume(keywords: string[]): Promise<Map<string, number | null>>;
}

const none = (name: string): DemandSource => ({
  name,
  configured: () => false,
  monthlyVolume: async (kws) => new Map(kws.map((k) => [k, null])),
});

// TODO: koppelen zodra gekozen. Opties: Keyword Tool API (geschat Etsy-volume), Google Ads API (Keyword Planner).
export const etsyDemand: DemandSource = none('keyword-tool (Etsy, geschat)');
export const googleDemand: DemandSource = none('Google Keyword Planner');

/**
 * Kansscore: vraag gedeeld door aanbod, gewogen met groei.
 * Zonder vraagdata geen score: liever geen getal dan een verzonnen getal.
 */
export function opportunity(opts: { listings: number | null; etsy: number | null; google: number | null; growth: number | null }): number | null {
  const { listings, etsy, google, growth } = opts;
  if (listings == null) return null;
  const demand = etsy != null && google != null ? Math.sqrt(etsy * google) : etsy ?? google;
  if (demand == null) return null;
  const g = growth == null ? 1 : Math.max(0.25, 1 + growth);
  return (demand / Math.max(listings, 1)) * g * 1000; // per 1000 listings, leesbaarder
}
