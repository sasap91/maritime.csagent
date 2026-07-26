# Counter — sundai.club submission (paste-ready)

## Title
**Counter**

## One-liner (card text)
Text a real Boston pizza shop on WhatsApp — its own hosted agent answers with exact prices, real hours, and tap-to-order links.

## Tags
`agents` · `LLM` · `WhatsApp` · `Maritime` · `customer service` · `small business` · `a2a`

## Links
- Repo: https://github.com/sasap91/maritime.csagent
- Live app (Maritime-hosted): https://api.maritime.sh/a/69e578d9-7e05-4d65-bb11-91b39df74a9e
- Web chat: https://wilsonwu-ai.github.io/counter-demo/

## Writeup (two paragraphs — paste into the description field)

Counter gives every mom & pop shop its own dedicated, persistent customer-service agent — reachable where customers already are: WhatsApp. We onboarded two real Boston pizza shops from their public menus (Boston Kitchen Pizza in the Theater District and Kendall House of Pizza, two blocks from this hackathon) and you can text either one right now. The agents are grounded, not vibes: they quote exact prices from a 60-item menu, catch footnotes a human phone-order taker would miss (ask Boston Kitchen for a *large* Hawaiian — it politely explains large isn't offered and counter-offers the medium at $19.95 or XL at $32), handle conflicting data honestly (Kendall's Google listing and menu site disagree about Sunday hours; the agent says so and gives you the phone number), and sell like an owner would: order intent triggers a pickup-or-delivery question, pickup gets recommended (ready faster, and direct ordering keeps margin with the shop instead of the apps), and the reply carries tappable links — ChowNow direct and a `tel:` phone number for pickup, DoorDash/GrubHub deep-links for delivery. Questions the agent can't answer get written to its persistent memory as an owner FAQ backlog — the shop owner gets a list of what customers actually wanted to know. Onboarding shop #3 is one form (or paste a menu URL and our extractor auto-fills it); every shop's grounding lives in versioned Markdown source files in the repo.

The architecture is Maritime end-to-end, with one deliberate exception. Each shop's brain is a dedicated persistent agent provisioned through Maritime's front door — one `maritime message --user shop_<slug>` call *is* the provisioning system (unknown id → new agent; no provisioning code exists in this repo). The Counter API and web app are a zero-dependency Node server built and hosted on Maritime from this repo's Dockerfile; the static frontend is on GitHub Pages calling it cross-origin. WhatsApp runs through a Hermes gateway (QR-paired via the WhatsApp Web protocol — no Business API, no Twilio) whose agent relays each customer message verbatim to the Counter API and returns the reply word-for-word; the runtime models are GPT-5.4 (Maritime's OpenClaw template, on the event's LLM credits) with an xAI relay wrapper, and the whole system was built with Claude. The day was a live-fire exercise in platform reliability: we hit and documented three Maritime launch-day bugs (source-build workers down, a registry bug that destroys running containers on every redeploy — making agents effectively immutable, so we shipped fresh agents per change behind a stable frontend — and a proxy that 400s CORS preflights, which we dodged by making every browser POST a simple request), plus one genuinely educational failure of our own: Maritime's per-user front-door agents share one memory store, and Kendall's agent briefly quoted Boston Kitchen's hours — so grounding now travels inline with every call instead of trusting agent memory. Ask us about any of these; the error logs went to the Maritime team.

## Team
- **Sasa** — repo owner · Hermes gateway / WhatsApp (co-lead)
- **David** — agent quality, shop-data sourcing
- **Kelvin** — agent quality, database
- **Allan** — frontend, onboarding + link-extract flow
- **Rohan** — frontend, onboarding
- **Wilson Wu** — launch lead / GTM, Maritime plumbing, demo, writeup
- **Brandon** — idea

Built at Sundai × Maritime (Hack 133), MIT, July 26, 2026.
