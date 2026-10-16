import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Ontbrekende omgevingsvariabele: ${name}. Zie .env.example.`);
  return v;
}
const opt = (name: string) => process.env[name] || undefined;

export const env = {
  supabaseUrl: req('SUPABASE_URL'),
  supabaseServiceKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  anthropicKey: req('ANTHROPIC_API_KEY'),
  // Sterk model voor beslissingen, licht model voor routinewerk
  modelStrong: opt('CLAUDE_MODEL_STRONG') ?? 'claude-opus-5-5',
  modelFast: opt('CLAUDE_MODEL_FAST') ?? 'claude-sonnet-5-5',
  etsyKeystring: opt('ETSY_KEYSTRING'),
  etsySharedSecret: opt('ETSY_SHARED_SECRET'),
  gelatoApiKey: opt('GELATO_API_KEY'),
  cloudflareAccountId: opt('CLOUDFLARE_ACCOUNT_ID'),
  cloudflareToken: opt('CLOUDFLARE_API_TOKEN'),
  falKey: opt('FAL_KEY'),
  pollMs: Number(opt('POLL_MS') ?? 5000),
  port: Number(opt('PORT') ?? 8080),
  // Openbaar adres van de motor (Railway → Settings → Networking → Generate Domain), bijv. https://la-familia.up.railway.app
  publicUrl: opt('PUBLIC_URL'),
  // Adres van De Hacienda op Vercel, om na het koppelen naar terug te sturen
  dashboardUrl: opt('DASHBOARD_URL'),
};

export const has = {
  etsy: () => Boolean(env.etsyKeystring && env.etsySharedSecret),
  gelato: () => Boolean(env.gelatoApiKey),
  cloudflare: () => Boolean(env.cloudflareAccountId && env.cloudflareToken),
  fal: () => Boolean(env.falKey),
};
