// Counter — every mom & pop shop gets its own customer-service agent.
// Onboard a shop → a dedicated Maritime agent is spawned via the project
// front door (`maritime message --user shop_<slug>`) and briefed with the
// shop's menu/hours/policies. Customers chat with it at /s/<slug>.
// Built at the Sundai x Maritime hack (MIT, 2026-07-26).
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(__dirname, '.env')); } catch { /* shell env */ }

const PORT = process.env.PORT || 3300;
const FRONTDOOR = process.env.MARITIME_FRONTDOOR_AGENT || 'mm-frontdoor2';
const ADMIN = process.env.ADMIN_SECRET || 'sundai';

// ── Disk-backed shops registry ──────────────────────────────────────────────
const DATA = join(__dirname, 'data');
await mkdir(DATA, { recursive: true });
const SHOPS_F = join(DATA, 'shops.json');
const SEED_F = join(__dirname, 'seed-shops.json');
// First boot on a fresh clone: load the committed seed (real onboarded shops)
// so teammates get Boston Kitchen Pizza + Kendall House of Pizza out of the box.
let shops = existsSync(SHOPS_F)
  ? JSON.parse(readFileSync(SHOPS_F, 'utf8'))
  : existsSync(SEED_F)
    ? JSON.parse(readFileSync(SEED_F, 'utf8'))
    : {};
const persist = () => writeFile(SHOPS_F, JSON.stringify(shops, null, 2));

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shop';

// ── Maritime bridge (CLI — validated path) ──────────────────────────────────
function maritime(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile('maritime', args, { env: process.env, timeout: timeoutMs, maxBuffer: 4 * 1048576 },
      (err, stdout, stderr) => {
        if (err && !stdout) return reject(new Error((stderr || err.message).slice(0, 300)));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('bad maritime output: ' + stdout.slice(0, 200))); }
      });
  });
}

const shopUserId = (slug) => 'shop_' + slug;

function briefing(shop) {
  return `You are the customer service agent working the counter at "${shop.name}". Store everything below in your permanent memory — you will serve this shop's customers from now on.

HOURS: ${shop.hours}
ADDRESS/PHONE: ${shop.contact}
MENU:
${shop.menu}
POLICIES / FAQ:
${shop.policies || '(none given)'}

How to behave: reply like a friendly, efficient person behind the counter texting a customer — warm, brief (1-3 sentences unless listing menu items), specific prices and times from the menu above. Never invent menu items or prices. If asked something you don't know, say you'll check with the owner, and record the question in your memory so the owner can answer it later.

How to handle ORDER INTENT (customer wants to order / asks how to order / is ready to buy): first ask one question — "Pickup or delivery?" — and gently recommend pickup when natural (it's ready faster and supports the shop directly). Then share the EXACT link(s) for their choice from the ORDERING info in the policies above: full URLs pasted into the message, never a vague "order online". Always write phone numbers in full digits like (617) 555-0100 so they are tappable on a phone. Confirm you have memorized the shop details.`;
}

async function askShopAgent(shop, history, message) {
  const convo = (history || [])
    .slice(-6)
    .map((h) => `${h.role === 'user' ? 'Customer' : 'You'}: ${h.text}`)
    .join('\n');
  // Grounding is inlined on EVERY call. The front-door agents share one memory
  // store across user ids (verified 2026-07-26), so relying on memorized
  // briefings cross-contaminates shops — Kendall once quoted BKP's hours.
  const grounding = `You are the counter agent for ${shop.name} — ONLY this shop, for this entire reply. If your memory mentions other shops, IGNORE them completely. Answer ONLY from the data below.
HOURS: ${shop.hours}
ADDRESS/PHONE: ${shop.contact}
MENU: ${shop.menu}
POLICIES/ORDERING: ${shop.policies}
Selling: on order intent, ask "Pickup or delivery?" once; recommend pickup when natural (ready faster, supports the shop directly); then share the EXACT ordering URL(s) and full phone number from POLICIES above.
Style: warm, brief, like texting a customer. Exact prices only — never invent. Unknown → say you'll check with the owner and note the question in your memory tagged [${shop.slug}].`;
  const prompt = `${grounding}\n\n${convo ? `Conversation so far:\n${convo}\n` : ''}Customer: ${message}\nReply to the customer now (reply text only, nothing else).`;
  const res = await maritime([
    'message', FRONTDOOR, '--user', shopUserId(shop.slug), '--wait', '55', '--json', prompt,
  ], 70000);
  if (res.status !== 'replied' || !res.reply) throw new Error('agent still ' + (res.status || 'unavailable') + ' — try again in a few seconds');
  return res.reply;
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
const readBody = (req) => new Promise((resolve) => {
  let d = ''; req.on('data', (c) => (d += c));
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
});
// CORS: the static frontend lives on GitHub Pages and calls this API cross-origin.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
const page = async (res, file, vars = {}) => {
  let html = await readFile(join(__dirname, 'public', file), 'utf8');
  for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{${k}}}`, v);
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html'))
      return page(res, 'onboard.html');

    if (req.method === 'GET' && url.pathname === '/shops') return page(res, 'shops.html');

    if (req.method === 'GET' && url.pathname.startsWith('/s/')) {
      const shop = shops[url.pathname.slice(3)];
      if (!shop) { res.writeHead(404); return res.end('no such shop — onboard it at /'); }
      return page(res, 'chat.html', {
        SLUG: shop.slug, NAME: shop.name, HOURS: shop.hours,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/shops')
      return send(res, 200, Object.values(shops).map(({ slug, name, hours, at }) => ({ slug, name, hours, at })));

    if (req.method === 'POST' && url.pathname === '/api/shops') {
      const { name, hours, menu, policies, contact } = await readBody(req);
      if (!name?.trim() || !hours?.trim() || !menu?.trim())
        return send(res, 400, { error: 'Shop name, hours, and menu are required.' });
      const slug = slugify(name);
      if (shops[slug]) return send(res, 409, { error: `"${slug}" already onboarded — chat at /s/${slug}` });
      const shop = {
        slug, name: name.trim().slice(0, 80), hours: hours.trim().slice(0, 200),
        menu: menu.trim().slice(0, 4000), policies: (policies || '').trim().slice(0, 2000),
        contact: (contact || '').trim().slice(0, 200), at: new Date().toISOString(),
      };
      shops[slug] = shop;
      await persist();
      // Spawn + brief the shop's dedicated agent (fire-and-forget; messages queue)
      maritime(['message', FRONTDOOR, '--user', shopUserId(slug), '--wait', '0', '--json', briefing(shop)], 30000)
        .then(() => console.log(`[maritime] agent spawned + briefed for ${slug}`))
        .catch((e) => console.error(`[maritime] brief failed for ${slug}:`, e.message));
      return send(res, 200, { ok: true, slug, chatUrl: `/s/${slug}` });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const { slug, message, history } = await readBody(req);
      const shop = shops[slug];
      if (!shop) return send(res, 404, { error: 'no such shop' });
      if (!message?.trim()) return send(res, 400, { error: 'empty message' });
      const reply = await askShopAgent(shop, history, message.trim().slice(0, 1000));
      return send(res, 200, { reply });
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const { secret } = await readBody(req);
      if (secret !== ADMIN) return send(res, 403, { error: 'bad secret' });
      shops = {}; await persist();
      return send(res, 200, { ok: true });
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e?.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`\n  Counter →  http://localhost:${PORT}   directory: /shops   (front door: ${FRONTDOOR})\n`),
);
