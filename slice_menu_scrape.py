#!/usr/bin/env python3
"""Scrape a full Slice (slicelife.com) restaurant menu, including every size
variant and every modifier/topping option, and print JSON to stdout.

How it works
------------
Slice has no *public* menu API - the gateway rejects unkeyed calls with
INVALID_API_KEY. But two things make a clean HTTP-only scrape possible:

1. The menu page server-renders its Redux store into `<script id="state">`,
   which holds every category, product, and size variant with base prices.
2. The same page ships the storefront's public API gateway key in an inline
   config script (the same class of publishable client key as the Stripe
   `pk_live_...` next to it). Reading it from the page at runtime means the
   scraper keeps working when Slice rotates it - never hardcode it.

With that key, `/services/core/api/v3/menus/<slug>/product-types` accepts
repeated `id=` params and returns the whole modifier graph in one request:
addon groups, selections, and per-option prices.

Prices from the API are integer cents; the Redux state uses decimal strings.

Usage
-----
    python3 slice_menu_scrape.py <slice_menu_url>

Prints one JSON object to stdout (items + modifiers + shop metadata).
Warnings go to stderr.
"""

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126 Safari/537.36"
)
API_ROOT = "https://consumer.prod.slicelife.com/services/core/api/v3/menus"
# Keep request URLs well under common 8KB limits; 165 ids was ~2KB.
CHUNK = 120


def fetch(url, headers=None, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def slug_from_url(url):
    """https://slicelife.com/restaurants/ma/cambridge/02141/name/menu -> ma/cambridge/02141/name"""
    parts = urllib.parse.urlparse(url).path.strip("/").split("/")
    if "restaurants" not in parts:
        raise ValueError(f"not a Slice restaurant URL: {url}")
    rest = parts[parts.index("restaurants") + 1 :]
    if rest and rest[-1] in ("menu", "info", "reviews"):
        rest = rest[:-1]
    return "/".join(rest)


def extract_state(html):
    """Pull the SSR Redux store out of <script id="state">."""
    m = re.search(
        r"window\.__SLICE_REDUX_STATE__\s*=\s*(\{.*?\});?\s*window\.__SLICE_BREAKPOINT",
        html,
        re.S,
    )
    if not m:
        raise RuntimeError("Redux state not found - Slice changed its page shape")
    return json.loads(m.group(1))


def extract_api_key(html):
    """Read the public API gateway key from the page's inline config blob."""
    m = re.search(r'"AUTH0_CONSUMER_API_GATEWAY_KEY"\s*:\s*"([^"]+)"', html)
    return m.group(1) if m else None


def menu_from_state(state):
    menus = state.get("menus", {}).get("menus", {})
    if not menus:
        raise RuntimeError("no menu in state - is the shop live?")
    return next(iter(menus.values()))["value"]


def fetch_product_types(slug, ids, api_key):
    """Batch-fetch the modifier graph. Returns merged relationship maps."""
    types, addons, selections = {}, {}, {}
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i : i + CHUNK]
        q = urllib.parse.urlencode([("id", n) for n in chunk])
        url = f"{API_ROOT}/{slug}/product-types?{q}"
        data = json.loads(fetch(url, {"x-api-key": api_key, "Accept": "application/json"}))
        for pt in data.get("productTypes", []):
            types[pt["id"]] = pt
        rel = data.get("relationships", {})
        # Addons repeat across product types; dedupe by id.
        for a in rel.get("addons", []):
            addons[a["id"]] = a
        for s in rel.get("selections", []):
            selections[s["id"]] = s
    return types, addons, selections


def money(cents):
    return f"{cents / 100:.2f}" if isinstance(cents, (int, float)) else ""


def build(menu, types, addons, selections):
    """Flatten into one row per size variant + one row per modifier option."""
    items, mods = [], []
    for cat in menu.get("categories", []):
        category = cat.get("name", "")
        for prod in cat.get("groupedProducts", []):
            variants = prod.get("productTypes") or [
                {"id": None, "name": "", "price": prod.get("basePrice")}
            ]
            for v in variants:
                pt = types.get(v.get("id"), {})
                groups = [addons[i] for i in pt.get("addonIds", []) if i in addons]
                items.append(
                    {
                        "category": category,
                        "item": prod.get("name", ""),
                        "size": v.get("name", ""),
                        "price": str(v.get("price", "")),
                        "description": prod.get("description", "") or "",
                        "best_seller": prod.get("isBestSeller", False),
                        "modifier_groups": " | ".join(g["name"] for g in groups),
                        "modifier_options": sum(len(g.get("selectionIds", [])) for g in groups),
                        "product_id": prod.get("id", ""),
                        "variant_id": v.get("id", "") or "",
                    }
                )
                for g in groups:
                    for sid in g.get("selectionIds", []):
                        sel = selections.get(sid)
                        if not sel:
                            continue
                        prices = sel.get("prices") or [{}]
                        mods.append(
                            {
                                "category": category,
                                "item": prod.get("name", ""),
                                "size": v.get("name", ""),
                                "group": g.get("name", ""),
                                "required": bool(g.get("required", False)),
                                "max_select": g.get("limit", "") or "",
                                "option": sel.get("name", ""),
                                "option_price": money(prices[0].get("price", 0)),
                            }
                        )
    return items, mods


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    url = sys.argv[1]
    slug = slug_from_url(url)

    html = fetch(url)
    state = extract_state(html)
    menu = menu_from_state(state)
    shop = state.get("shop", {}).get("shops", {}).get(slug, {}).get("value", {})

    variant_ids = [
        pt["id"]
        for c in menu.get("categories", [])
        for p in c.get("groupedProducts", [])
        for pt in (p.get("productTypes") or [])
    ]

    api_key = extract_api_key(html)
    types = addons = selections = {}
    if api_key and variant_ids:
        try:
            types, addons, selections = fetch_product_types(slug, variant_ids, api_key)
        except urllib.error.HTTPError as e:
            print(f"warning: modifier API returned {e.code}; base prices only", file=sys.stderr)
    elif not api_key:
        print("warning: no API key in page; base prices only", file=sys.stderr)

    items, mods = build(menu, types, addons, selections)

    payload = {
        "shop": shop.get("name", ""),
        "shopMeta": shop,
        "slug": slug,
        "phone": shop.get("phone", ""),
        "items": items,
        "modifiers": mods,
        "menu": menu,
        "productTypes": list(types.values()),
        "addons": list(addons.values()),
        "selections": list(selections.values()),
    }

    print(
        f"{shop.get('name', slug)}: {len({i['product_id'] for i in items})} products, "
        f"{len(items)} size variants, {len(mods)} modifier options",
        file=sys.stderr,
    )
    json.dump(payload, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
