import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { env } from './env.js';
import { db } from './db.js';

let genai: GoogleGenAI | null = null;
function client() {
  if (!env.geminiKey) throw new Error('GEMINI_API_KEY ontbreekt in Railway.');
  genai ??= new GoogleGenAI({ apiKey: env.geminiKey });
  return genai;
}

async function generateOnce(prompt: string, aspectRatio: string): Promise<Buffer> {
  const res = await client().models.generateContent({
    model: env.geminiImageModel,
    contents: prompt,
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '4K' } },
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img?.inlineData?.data) {
    const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'onbekend';
    throw new Error(`Gemini gaf geen afbeelding terug (reden: ${reason}).`);
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

/**
 * Maakt een staand 4:5-beeld in 4K. Ondersteunt het model 4:5 niet,
 * dan valt hij terug op 3:4 en snijdt hij netjes bij naar 4:5.
 */
export async function generatePoster(prompt: string): Promise<{ png: Buffer; width: number; height: number }> {
  let raw: Buffer;
  try {
    raw = await generateOnce(prompt, '4:5');
  } catch (e) {
    const msg = (e as Error).message;
    if (!/aspect|ratio|INVALID_ARGUMENT|400/i.test(msg)) throw e;
    raw = await generateOnce(prompt, '3:4');
  }
  const img = sharp(raw);
  const meta = await img.metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  // bijsnijden naar exact 4:5 (midden)
  let cw = w, ch = Math.round(w * 5 / 4);
  if (ch > h) { ch = h; cw = Math.round(h * 4 / 5); }
  const png = await img.extract({ left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch }).png().toBuffer();
  return { png, width: cw, height: ch };
}

/** Kleine JPEG voor de ogen van de Inspector en de Consigliere (scheelt tokens). */
export async function preview(png: Buffer, max = 1024): Promise<string> {
  return (await sharp(png).resize({ width: max, height: max, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()).toString('base64');
}

/** Slaat een design op in Supabase Storage en geeft de publieke URL terug (die Gelato kan ophalen). */
export async function store(designId: number, png: Buffer): Promise<{ path: string; url: string }> {
  const path = `plaza1/${designId}-${Date.now()}.png`;
  const { error } = await db.storage.from('designs').upload(path, png, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(`Opslaan mislukt: ${error.message}`);
  const { data } = db.storage.from('designs').getPublicUrl(path);
  return { path, url: data.publicUrl };
}

export async function load(path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from('designs').download(path);
  if (error || !data) throw new Error(`Design niet gevonden: ${path}`);
  return Buffer.from(await data.arrayBuffer());
}
