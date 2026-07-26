// Shop scrape: Slice URLs → slice_menu_scrape.py; everything else → DOM heuristics.
import * as cheerio from 'cheerio';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'slice_menu_scrape.py');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const clean = (s) =>
  (s || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

function isSliceUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'slicelife.com' || host.endsWith('.slicelife.com');
  } catch {
    return false;
  }
}

// ── Generic DOM scrape ──────────────────────────────────────────────────────

function parseJsonLd($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      blocks.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch { /* ignore bad json-ld */ }
  });
  const flat = [];
  for (const b of blocks) {
    if (b && Array.isArray(b['@graph'])) flat.push(...b['@graph']);
    else if (b) flat.push(b);
  }
  return flat;
}

function typeOf(node) {
  const t = node?.['@type'];
  if (!t) return [];
  return (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
}

function findBiz(nodes) {
  const prefer = ['restaurant', 'localbusiness', 'foodestablishment', 'bakery', 'cafe', 'barorpub'];
  return (
    nodes.find((n) => typeOf(n).some((t) => prefer.includes(t))) ||
    nodes.find((n) => typeOf(n).some((t) => t.includes('restaurant') || t.includes('food'))) ||
    null
  );
}

function scrapeName($, biz) {
  if (biz?.name) return clean(String(biz.name));
  const og = clean($('meta[property="og:title"]').attr('content'));
  if (og) return og.replace(/\s*[|\-–—].*$/, '').trim() || og;
  const h1 = clean($('h1').first().text());
  if (h1) return h1;
  const title = clean($('title').first().text());
  return title.replace(/\s*[|\-–—].*$/, '').trim() || title;
}

function scrapeContact($, biz) {
  const parts = [];
  if (biz?.address) {
    const a = biz.address;
    if (typeof a === 'string') parts.push(clean(a));
    else if (a && typeof a === 'object') {
      parts.push(
        clean(
          [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
            .filter(Boolean)
            .join(', '),
        ),
      );
    }
  }
  const phone = biz?.telephone || biz?.phone;
  if (phone) parts.push(clean(String(phone)));

  const tels = [];
  $('a[href^="tel:"]').each((_, el) => {
    const t = clean($(el).attr('href')?.replace(/^tel:/i, '') || $(el).text());
    if (t) tels.push(t);
  });
  if (!phone && tels[0]) parts.push(tels[0]);

  if (parts.length < 2) {
    $('[class*="address"], [class*="Address"], [itemprop="address"], footer, [class*="contact"], [class*="Contact"]').each((_, el) => {
      const t = clean($(el).text());
      if (/\d{1,5}\s+\w+/.test(t) && t.length < 180 && !parts.some((p) => p.includes(t.slice(0, 40)))) {
        const m = t.match(/\d{1,5}\s+[\w\s.#,-]{5,80}(?:MA|NY|CA|TX|\d{5})?/i);
        if (m) parts.push(clean(m[0]));
      }
    });
  }

  return uniq(parts).join(' · ').slice(0, 400);
}

function scrapeHours($, biz) {
  const fromLd = [];
  const spec = biz?.openingHoursSpecification;
  if (Array.isArray(spec)) {
    for (const s of spec) {
      const days = [].concat(s.dayOfWeek || []).map((d) => String(d).replace(/^.*\//, '').slice(0, 3));
      const open = s.opens || '';
      const close = s.closes || '';
      if (days.length && open) fromLd.push(`${days.join(', ')} ${open}–${close}`);
    }
  }
  if (biz?.openingHours) {
    const oh = biz.openingHours;
    fromLd.push(...(Array.isArray(oh) ? oh : [oh]).map((x) => clean(String(x))));
  }
  if (fromLd.length) return uniq(fromLd).join('; ').slice(0, 500);

  const chunks = [];
  $('[class*="hour"], [class*="Hour"], [class*="open"], [class*="Open"], [class*="schedule"], [class*="Schedule"], [itemprop="openingHours"]').each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 8 && t.length < 400 && /\d/.test(t) && /(am|pm|open|mon|tue|wed|thu|fri|sat|sun|:)/i.test(t)) {
      chunks.push(t);
    }
  });
  return uniq(chunks).slice(0, 5).join(' · ').slice(0, 500);
}

const CTA_RE = /\b(order|add(?:\s+to\s+cart)?|buy|select|customize)\b/gi;
const priceMatches = (s) => s.match(/\$\s?\d+(?:\.\d{2})?/g) || [];

function formatMenuLine(raw) {
  let t = clean(raw);
  if (!t) return null;
  t = t.replace(CTA_RE, ' ').replace(/\s+/g, ' ').trim();
  const prices = priceMatches(t);
  if (prices.length !== 1) return null;
  const price = prices[0].replace(/\s+/g, '');
  let name = clean(t.replace(/\$\s?\d+(?:\.\d{2})?/g, ' '));
  name = name.replace(/^[\-–—:,.|]+|[\-–—:,.|]+$/g, '').trim();
  if (!name || name.length < 2 || name.length > 80) return null;
  if (/^\d/.test(name)) return null;
  if (/cookie|privacy|copyright|sign in|log in/i.test(name)) return null;
  return `${name} — ${price}`;
}

function scrapeMenu($) {
  const lines = [];

  const structured = [];
  $(
    '.menu-item-info, [class*="menu-item"], [class*="MenuItem"], [class*="menu_item"], [itemtype*="MenuItem"]',
  ).each((_, el) => {
    const $el = $(el);
    const title = clean(
      $el.find('.menu-item-title, [class*="item-title"], [class*="ItemTitle"], [class*="item-name"], [itemprop="name"]').first().text()
      || $el.find('h2, h3, h4, p').first().text(),
    );
    const price = clean(
      $el.find('.menu-item-price, [class*="item-price"], [class*="ItemPrice"], [itemprop="price"]').first().text(),
    );
    if (title && priceMatches(price).length === 1) {
      const line = formatMenuLine(`${title} ${price}`);
      if (line) structured.push(line);
    }
  });
  if (structured.length < 3) {
    $('.menu-item-title, [class*="menu-item-title"]').each((_, el) => {
      const title = clean($(el).text());
      const price = clean(
        $(el).siblings('.menu-item-price-holder, .menu-item-price, [class*="price"]').first().text()
        || $(el).parent().find('.menu-item-price, [class*="item-price"]').first().text(),
      );
      const line = formatMenuLine(`${title} ${price}`);
      if (line) structured.push(line);
    });
  }
  if (structured.length) lines.push(...structured);

  if (lines.length < 3) {
    const roots = $('[class*="menu"], [class*="Menu"], [id*="menu"], [id*="Menu"], [itemtype*="Menu"], main, article');
    const scope = roots.length ? roots : $.root();
    scope.find('li, tr, p, div').each((_, el) => {
      const $el = $(el);
      if ($el.children().length > 4) return;
      const line = formatMenuLine($el.text());
      if (line) lines.push(line);
    });
  }

  if (lines.length < 3) {
    $('body').find('li, p, span, div').each((_, el) => {
      if ($(el).children().length > 3) return;
      const line = formatMenuLine($(el).text());
      if (line) lines.push(line);
    });
  }

  return uniq(lines).slice(0, 200).join('\n').slice(0, 8000);
}

function scrapePolicies($) {
  const bits = [];
  $('[class*="polic"], [class*="Polic"], [class*="faq"], [class*="Faq"], [class*="FAQ"], [class*="delivery"], [class*="Delivery"], [class*="about"], [class*="About"]').each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 20 && t.length < 800 && /(deliver|cash|card|gluten|allergen|pickup|takeout|order)/i.test(t)) {
      bits.push(t.slice(0, 400));
    }
  });
  return uniq(bits).slice(0, 3).join('\n').slice(0, 2000);
}

async function scrapeDomUrl(url) {
  const parsed = new URL(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(parsed.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${parsed.href}`);
    html = await res.text();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Timed out fetching URL (15s).');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (html.length > 1_500_000) html = html.slice(0, 1_500_000);

  const $ = cheerio.load(html);
  const ld = parseJsonLd($);
  const biz = findBiz(ld);
  $('script, style, noscript, svg, iframe').remove();

  const name = scrapeName($, biz);
  const contact = scrapeContact($, biz);
  const hours = scrapeHours($, biz);
  const menu = scrapeMenu($);
  const policies = scrapePolicies($);

  const warnings = [];
  if (!name) warnings.push('Could not find shop name');
  if (!hours) warnings.push('Could not find hours');
  if (!menu) warnings.push('Could not find menu items with prices (page may be JS-rendered)');
  if (!contact) warnings.push('Could not find address/phone');
  if (!policies) warnings.push('No policies/FAQ block found');
  const bodyText = clean($('body').text());
  if (bodyText.length < 80 && !menu) {
    warnings.push('Page HTML looks thin — likely a JS SPA');
  }

  return {
    name: name.slice(0, 80),
    hours: hours.slice(0, 500),
    menu,
    policies,
    contact: contact.slice(0, 400),
    warnings,
  };
}

// ── Slice scrape (Python) ───────────────────────────────────────────────────

function formatSliceMenu(items, mods) {
  const byCat = new Map();
  for (const row of items) {
    const cat = row.category || 'Menu';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(row);
  }

  const modsByKey = new Map();
  for (const m of mods || []) {
    const key = `${m.category}\0${m.item}\0${m.size || ''}`;
    if (!modsByKey.has(key)) modsByKey.set(key, new Map());
    const groups = modsByKey.get(key);
    if (!groups.has(m.group)) groups.set(m.group, []);
    const price = m.option_price ? ` +$${m.option_price}` : '';
    groups.get(m.group).push(`${m.option}${price}`);
  }

  const lines = [];
  for (const [cat, rows] of byCat) {
    lines.push(`${cat.toUpperCase()}:`);
    const byItem = new Map();
    for (const r of rows) {
      if (!byItem.has(r.item)) byItem.set(r.item, []);
      byItem.get(r.item).push(r);
    }
    for (const [item, variants] of byItem) {
      const priced = variants
        .map((v) => {
          const p = String(v.price || '').replace(/^\$/, '');
          if (!p) return v.size || null;
          return v.size ? `${v.size} $${p}` : `$${p}`;
        })
        .filter(Boolean);
      let line = priced.length ? `${item} ${priced.join(' / ')}` : item;
      if (variants[0]?.description) line += ` — ${variants[0].description}`;
      lines.push(line);

      for (const v of variants) {
        const key = `${v.category}\0${v.item}\0${v.size || ''}`;
        const groups = modsByKey.get(key);
        if (!groups?.size) continue;
        for (const [gname, opts] of groups) {
          const shown = opts.slice(0, 24);
          const more = opts.length > shown.length ? ` (+${opts.length - shown.length} more)` : '';
          lines.push(`  ${gname}: ${shown.join(', ')}${more}`);
        }
        break;
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim().slice(0, 8000);
}

function formatSliceHours(shopMeta) {
  const h = shopMeta?.hours || shopMeta?.openingHours || shopMeta?.schedule;
  if (!h) return '';
  if (typeof h === 'string') return h.slice(0, 500);
  if (Array.isArray(h)) return h.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ').slice(0, 500);
  return '';
}

function formatSliceContact(data, shopMeta) {
  const parts = [];
  const loc = shopMeta?.location || {};
  const addr = [loc.address, loc.city, loc.shopState, loc.zipcode].filter(Boolean).join(', ');
  if (addr) parts.push(addr);
  const phone = data.phone || shopMeta?.phone;
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    const pretty =
      digits.length === 10
        ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        : phone;
    parts.push(pretty);
  }
  parts.push('order online at slicelife.com');
  return parts.join(' · ').slice(0, 400);
}

async function scrapeSliceUrl(url) {
  let href = url.replace(/\/$/, '');
  if (!/\/(menu|info|reviews)$/.test(href)) href += '/menu';

  try {
    const { stdout, stderr } = await execFileAsync('python3', [SCRIPT, href], {
      timeout: 90000,
      maxBuffer: 16 * 1048576,
      env: process.env,
    });
    if (stderr?.trim()) console.warn('[slice-scrape]', stderr.trim());

    const data = JSON.parse(stdout);
    const items = data.items || [];
    const mods = data.modifiers || [];
    const shopMeta = data.shopMeta || {};
    const name = data.shop || shopMeta.name || '';
    const hours = formatSliceHours(shopMeta);
    const menu = formatSliceMenu(items, mods);
    const contact = formatSliceContact(data, shopMeta);

    const warnings = [];
    if (stderr?.includes('warning:')) warnings.push(...stderr.split('\n').filter((l) => l.includes('warning:')));
    if (!name) warnings.push('Could not find shop name');
    if (!hours) warnings.push('Hours not in Slice payload — fill in manually');
    if (!menu) warnings.push('Could not find menu items');
    if (!items.length) warnings.push('No size variants scraped');

    return {
      name: String(name).slice(0, 80),
      hours: hours.slice(0, 500),
      menu,
      policies: 'Dine-in, takeout, and delivery via Slice. Never invent items or prices; if unsure, tell the customer to call the shop.',
      contact,
      warnings,
      meta: {
        slug: data.slug,
        products: new Set(items.map((i) => i.product_id)).size,
        variants: items.length,
        modifiers: mods.length,
      },
    };
  } catch (e) {
    const msg = e.stderr?.toString?.() || e.message || String(e);
    throw new Error(msg.slice(0, 400));
  }
}

/**
 * Fetch a URL and scrape restaurant-ish fields.
 * Slice → full menu via Python; other sites → DOM heuristics.
 * @param {string} url
 * @returns {Promise<{name:string,hours:string,menu:string,policies:string,contact:string,warnings:string[]}>}
 */
export async function scrapeShopUrl(url) {
  const parsed = new URL(url);
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Only http/https URLs are supported.');
  if (isSliceUrl(parsed.href)) return scrapeSliceUrl(parsed.href);
  return scrapeDomUrl(parsed.href);
}
