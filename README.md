# Counter — Maritime Customer Service Agents (Hack 133)

**Every mom & pop shop gets its own agent behind the counter.** Onboard a shop once (name, hours, menu, policies) → a dedicated persistent [Maritime](https://maritime.sh) agent is spawned for it → customers ask it anything and get grounded answers with exact prices.

Live PRD: [Google Doc](https://docs.google.com/document/d/1mv9iSciGaHw2XbTbfcQx8pRb0CLwKr7Y/edit) · Sundai × Maritime hack, MIT, 2026-07-26

| Who | Role | Owns today |
|---|---|---|
| Wilson Wu | Launch lead / GTM | Maritime plumbing (validated), demo script, restaurant domain, writeup |
| Brandon | Idea owner | — |
| Sasa & Wilson | **Hermes gateway / WhatsApp** | QR pairing, message routing, channel reliability |
| David & Kelvin | Agent quality | Briefing/grounding, unknown-question memory, tone, database |
| Allan & Rohan | Frontend / onboarding | Onboard form + directory polish, QR codes for tables |

## 🍕 ELI5 — what did we actually build?

You know how when you call a pizza shop, the line is busy, and the person answering the phone is also the person making the pizzas?

**We gave the shop a helper who never puts you on hold.**

- You **text the shop on WhatsApp** (or open a small chat page) like you'd text a friend: *"how much is a large pepperoni?"*
- **The shop's own agent answers in seconds** — and it *really* knows the shop: the actual menu, actual prices, actual hours. It never makes things up. Ask Boston Kitchen Pizza for a **large Hawaiian** and it politely tells you that size doesn't exist — and offers the medium ($19.95) or XL ($32) that do.
- Want to order? It asks **"pickup or delivery?"** and texts you the right link to tap — and it recommends pickup first, like a good employee would, because direct orders keep more money with the shop than the delivery apps do.
- Stumped? It **writes the question down for the owner** — so the shop learns what customers keep asking.

The part that makes this a *platform* and not a chatbot: **every shop gets its OWN agent** — a separate, persistent brain per shop, hosted on [Maritime](https://maritime.sh). Adding shop #3 is one form (or just paste a menu link and it fills itself in). We onboarded **two real Boston pizza shops** today from their public menus, and you can talk to both right now.

▶️ **Watch:** [20-second demo](demo/counter-demo-20s.mp4) · [Boston Kitchen Pizza demo](demo/boston-kitchen-pizza-demo_v2.mp4)
💬 **Try it:** [web chat](https://wilsonwu-ai.github.io/counter-demo/) — pick a shop, ask anything

**How a message travels (the slightly-bigger-kid version):** your WhatsApp text → the **Hermes gateway** (the shop's phone line) → the **Counter API** hosted on Maritime (the switchboard) → the **shop's dedicated Maritime agent** (the brain, with the menu in its head) → back to your phone with the answer. Four hops, ~10–30 seconds, no human needed — and the shop owner never touched a line of code.

## ⚠️ The web chat is a PROTOTYPE. The product is WhatsApp.

What's in this repo today is the working spine: onboarding → per-shop Maritime agent → grounded Q&A, demoed through a throwaway web chat UI. The MVP we present replaces that UI with **WhatsApp via the Hermes gateway** (see PRD §4). The plumbing to keep: `POST /api/chat {slug, message}` → shop's agent → reply. The WhatsApp integration calls that same endpoint (or the front door directly).

## What already works (verified live)

Two real shops onboarded from their public menus, seeded in this repo:

- **Boston Kitchen Pizza** (1 Stuart St, Theater District) — full menu with M/L/XL sizing. Verified: XL 2-topping $32 ✓, open-til-2:30am Fridays ✓, and the trap question — *"can I get a large Hawaiian?"* → correctly says large is unavailable and offers medium $19.95 / XL $32. It knows the menu's footnotes.
- **Kendall House of Pizza** (201 Third St, 2 blocks from iHQ) — verified exact prices and honest handling of conflicting Sunday hours.

Grounding rule learned the hard way: an **unbriefed** agent invented an $18.99 price. Briefings must be confirmed by the agent, never fire-and-forget.

Committed source material for seeded shops lives under `shop-data/<shop-slug>/`.
A seed can set `sources.menu` and `sources.hours` to repository-relative files;
the server loads those files as the agent's grounding information at startup.
New or maintained Markdown sources should follow the versioned contract in
`.agents/skills/answer-menu-hours/references/shop-source-schema.md`.

## Architecture

```
customer ──(today: web chat /s/<slug>)──► POST /api/chat ─► maritime message
         ──(MVP:  WhatsApp via Hermes)──►                    --user shop_<slug>
                                                             │
owner ──► onboard form (/) ──► POST /api/shops ──► spawn + brief agent
                                                   (menu lives in the agent's
                                                    persistent Maritime memory)
```

- One `maritime message --user shop_<slug>` call **is** the provisioning system: unknown shop id → new persistent agent. No provisioning code exists in this repo.
- Front-door agent: an OpenClaw template agent on Maritime (persists memory across messages — validated; ZeroClaw does not persist, don't swap it in).
- Maritime **source builds are down today** (503) — templates are unaffected, which is why the agents are template-spawned and this web app runs laptop+tunnel.

## Run it

The Maritime credentials are on Wilson's account — **the server runs on Wilson's laptop; use the tunnel URL he posts in Discord to try it.** Clone + contribute code via git; don't ask for the mk_ key in chat.

```bash
npm install
# .env (gitignored): ANTHROPIC_API_KEY, MARITIME_TOKEN, MARITIME_FRONTDOOR_AGENT, ADMIN_SECRET
npm start                  # http://localhost:3300 — seeds both real shops on first boot
```

- Onboard a shop: `/` · Chat: `/s/boston-kitchen-pizza` · Directory: `/shops`
- Public URL: `cloudflared tunnel --url http://localhost:3300`

## WhatsApp integration (the actual MVP — owners: Sasa & Wilson)

Validated so far: `hermes whatsapp` pairs a real WhatsApp number via QR code (no Business API, no Twilio). `hermes gateway` manages the messaging gateway (WhatsApp/Telegram/Discord); `hermes send` does outbound.

**WIRED AND VERIFIED (2:15pm):** WhatsApp number paired via `hermes whatsapp` QR (separate bot number, allowed users `*` — anyone can text it). Routing is agent-relay: a scoped mode appended to Hermes's `~/.hermes/SOUL.md` makes the gateway agent relay every customer message verbatim to `POST /api/chat {slug: boston-kitchen-pizza}` and reply with exactly the returned text (fail-safe: "call (617) 482-0085" if the API is down). Verified headless end-to-end — the large-Hawaiian trap answer came back word-for-word through the full chain (Hermes → Counter → Maritime agent).

Ops notes: gateway + Counter + tunnel all run on Wilson's laptop (`hermes gateway run` must stay in a foreground terminal). WhatsApp replies take ~20–40s (two model hops). One gateway = one shop for the demo; multi-shop routing (route by keyword or per-shop numbers) is stretch. Replies carry a "⚕ Hermes Agent" prefix.

## Demo plan (8pm) — see PRD §6

Phone up → message the shop → exact price live → **ask for a large Hawaiian** (it catches the unavailable size and counter-offers) → onboard an audience-suggested shop in 60s → ask the agent what it *couldn't* answer today (owner FAQ backlog from Maritime memory).
