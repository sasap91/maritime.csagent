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

To build (gateway owner validates which wiring Hermes supports — both are plausible from the CLI surface, neither is verified yet):

1. **Webhook wiring:** Hermes gateway receives a WhatsApp message → `hermes webhook` posts it to this server (`POST /api/chat` with the shop's slug) → reply goes back out via `hermes send -t whatsapp:<chat_id>`.
2. **Agent-tool wiring:** the Hermes agent itself handles the WhatsApp conversation and calls Counter's API (or `maritime message` directly) as a tool.

MVP routing assumption (per PRD): one gateway, one shop — the paired number IS Boston Kitchen Pizza's number for the demo. Multi-shop routing is stretch.

## Demo plan (8pm) — see PRD §6

Phone up → message the shop → exact price live → **ask for a large Hawaiian** (it catches the unavailable size and counter-offers) → onboard an audience-suggested shop in 60s → ask the agent what it *couldn't* answer today (owner FAQ backlog from Maritime memory).
