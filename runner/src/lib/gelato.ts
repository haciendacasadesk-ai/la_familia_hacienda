import { env, has } from './env.js';
import { setting } from './db.js';

// https://dashboard.gelato.com/docs/ecommerce/products/create-from-template/
const BASE = 'https://ecommerce.gelatoapis.com/v1';

interface GelatoCfg { store_id: string; template_id: string; placeholder: string }

async function cfg(): Promise<GelatoCfg> {
  const c = await setting<GelatoCfg | null>('gelato', null);
  if (!c?.store_id || !c.template_id) throw new Error('Gelato-template of store ontbreekt in de instellingen.');
  return c;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!has.gelato()) throw new Error('GELATO_API_KEY ontbreekt in Railway.');
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-API-KEY': env.gelatoApiKey!, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Gelato ${res.status} op ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export interface GelatoProduct { id: string; status: string; externalId: string | null; previewUrl?: string }

/**
 * Maakt een product van het postertemplate. Niet zichtbaar in de store (isVisibleInTheOnlineStore=false),
 * zodat het als concept klaarstaat en de Jefe zelf publiceert.
 */
export async function createFromTemplate(p: { title: string; description: string; tags: string[]; fileUrl: string }): Promise<GelatoProduct> {
  const c = await cfg();
  const tmpl = await call<{ variants: Array<{ id: string; imagePlaceholders?: Array<{ name: string }> }> }>(
    'GET', `/templates/${c.template_id}`);
  const variants = tmpl.variants.map((v) => ({
    templateVariantId: v.id,
    imagePlaceholders: (v.imagePlaceholders?.length ? v.imagePlaceholders.map((ph) => ph.name) : [c.placeholder])
      .map((name) => ({ name, fileUrl: p.fileUrl, fitMethod: 'slice' })),
  }));
  return call<GelatoProduct>('POST', `/stores/${c.store_id}/products:create-from-template`, {
    templateId: c.template_id,
    title: p.title,
    description: p.description,
    tags: p.tags.slice(0, 13).map((t) => t.slice(0, 20)),
    isVisibleInTheOnlineStore: false,
    variants,
  });
}

export async function getProduct(id: string): Promise<GelatoProduct> {
  const c = await cfg();
  return call<GelatoProduct>('GET', `/stores/${c.store_id}/products/${id}`);
}
