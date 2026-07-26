# Voice channel wiring (Vapi → maritime-hosted brain)

Voice = the same Counter brain as WhatsApp/web, reached through a new channel —
**deployed on its own maritime host, separate from Wilson's instance.** Vapi is a
thin voice shell: it greets the caller, then on each turn invokes the
`ask_counter` custom tool, which Vapi posts to `/api/voice/tool`. That route
wraps the existing `askShopAgent()` brain — one source of truth, no menu
duplication. The `maritime` CLI runs **in-process** on the host (installed by
the [Dockerfile](../Dockerfile)), so the voice brain is fully self-contained:
no localhost, no cloudflared, no dependency on any other machine.

Vapi also supports **real inbound phone calls natively** (buy a number in the
dashboard, point it at the assistant — no Twilio, no SIP). So this branch ships
two voice paths off the same brain:

- **Web call** — a "📞 Call" button on the shop chat page (Vapi Web SDK).
- **Inbound phone** — customers dial a Vapi number.

> WhatsApp *voice calls* still aren't possible (WhatsApp audio isn't open to
> bots); WhatsApp stays text via the Hermes gateway ([`../whatsapp/README.md`](../whatsapp/README.md)).
> This voice branch is fully separate from Wilson's maritime agent — it runs on
> its own maritime host with its own front-door agent.

First shop wired: **Boston Kitchen Pizza** (`boston-kitchen-pizza`).

---

## 1. Deploy your own maritime host (this branch)

This repo's [Dockerfile](../Dockerfile) is what maritime.sh runs. Deploy the
`voice-elevenlabs` branch as a **new** hosted app — you'll get a URL like:

```
https://api.maritime.sh/a/<your-uuid>
```

In the maritime dashboard, set this host's env vars:

```
MARITIME_TOKEN=<your maritime token>          # so the in-process CLI can auth
MARITIME_FRONTDOOR_AGENT=mm-frontdoor2        # the template front-door (spawns per-shop agents); NOT Wilson's instance
ADMIN_SECRET=<anything>
# Optional, for the web widget:
VAPI_ASSISTANT_ID=<from step 3>
VAPI_PUBLIC_KEY=<from step 3>
```

> `mm-frontdoor2` is the shared **template** front-door agent — `maritime message
> --user shop_<slug>` spawns a dedicated per-shop brain off it. Using it here does
> not touch Wilson's running agents; it provisions your own `shop_boston-kitchen-pizza`
> brain on first call.

Smoke-test the host before wiring Vapi:

```bash
curl -X POST 'https://api.maritime.sh/a/<your-uuid>/api/chat' \
  -H 'content-type: application/json' \
  -d '{"slug":"boston-kitchen-pizza","message":"do you have a large hawaiian?"}'
# → {"reply":"..."}  (real grounded answer = brain works)
```

## 2. Create the Vapi assistant

1. **Assistants → Add Assistant → Custom.**
2. Paste the **System prompt** below.
3. **Add a tool** with the **`ask_counter`** custom-tool config below.
4. Set the assistant's **Server URL** to your host + this route:
   `https://api.maritime.sh/a/<your-uuid>/api/voice/tool?slug=boston-kitchen-pizza`
5. Copy the assistant id + your public key into the host's env (`VAPI_ASSISTANT_ID`,
   `VAPI_PUBLIC_KEY`) and redeploy.

### System prompt (paste verbatim)

```
You are the friendly, efficient voice agent working the counter at Boston Kitchen Pizza.
Customers reach you by phone or web call. Keep replies short and spoken — 1-3 sentences,
exact prices and times, never invent menu items or prices.

RULE: for EVERY question about the menu, prices, hours, ordering, or anything
shop-specific, you MUST call the `ask_counter` tool with the customer's words
(verbatim) and then speak back EXACTLY the `result` — no preamble, no additions,
no mention of tools or APIs. The tool is the only source of truth; never answer
from your own knowledge.

If the tool fails or returns nothing useful, say: "Sorry, give us one sec — try
again in a moment." and nothing else.

Speak naturally. Phone numbers come back spelled digit-by-digit — read them as
given. Links come back as "I'll send you the link" — never spell out a URL.
```

### Custom tool config (`ask_counter`)

| Field | Value |
|---|---|
| Type | Function |
| Name | `ask_counter` |
| Description | `Ask the Boston Kitchen Pizza counter agent a question (menu, prices, hours, ordering). Returns the spoken answer.` |
| Parameters | `message` (string, required) — "the customer's latest words, verbatim" |

The tool's `server.url` is NOT set on the tool itself — Vapi routes tool calls
through the assistant's **Server URL** (step 4), so they hit `/api/voice/tool`
with `message.type === "tool-calls"`. The server resolves each call and returns
`{ results: [{ toolCallId, result }] }`.

## 3. (Optional) Wire an inbound phone number

Vapi dashboard → **Phone Numbers → Buy / Import** a number, set its **Assistant**
to the one from step 2. Customers dial it → Vapi answers → same `ask_counter`
tool → same brain. No Twilio, no SIP.

## 4. Test end-to-end

1. **Route smoke-test (no Vapi):**
   ```bash
   curl -X POST 'https://api.maritime.sh/a/<your-uuid>/api/voice/tool?slug=boston-kitchen-pizza' \
     -H 'content-type: application/json' \
     -d '{"message":{"type":"tool-calls","toolCallList":[{"id":"test1","name":"ask_counter","arguments":{"message":"do you have a large hawaiian?"}}]}}'
   # → {"results":[{"toolCallId":"test1","result":"..."}]} with a real spoken answer
   ```
2. **Web call:** open `https://api.maritime.sh/a/<your-uuid>/s/boston-kitchen-pizza`,
   click **📞 Call**, grant mic, ask by voice.
3. **Phone:** dial the Vapi number.
4. **Trap check** (both paths): *"do you have a large Hawaiian?"* → explains
   large isn't offered, counter-offers medium ($19.95) / XL ($32), spoken.

---

## How it connects

```
/phone or browser mic/ ──Vapi──► assistant ──(tool call)──►
   POST /api/voice/tool?slug=boston-kitchen-pizza        (your maritime host)
        │  only message.type "tool-calls" answered; others ACK'd
        │  for each tool call: askShopAgent(shop, null, msg.arguments.message)
        │  askShopAgent shells out to the maritime CLI, which runs IN-PROCESS on this host
        ▼
   maritime message --user shop_boston-kitchen-pizza  → { reply }
        │ speakable(reply): URLs → "I'll send you the link", digits spelled
        ▼
   { results: [{ toolCallId, result }] }  ← Vapi speaks the result
```

- Brain = [`askShopAgent()`](../server.mjs) — shared with `/api/chat`, unchanged.
- Voice-specific transform = [`speakable()`](../server.mjs) (strip URLs, spell digits) — server-side, one place.
- Web widget + "📞 Call" button in [`../public/chat.html`](../public/chat.html); hides itself
  until `VAPI_ASSISTANT_ID` + `VAPI_PUBLIC_KEY` are set on the host.

## Local development (optional)

You can run the server locally, but the brain needs the `maritime` CLI installed
and a `MARITIME_TOKEN`. Without those, `/api/voice/tool` returns the fail-safe
("give us one sec") instead of real answers — the route mechanics still work and
can be tested with the curl in step 4. For a fully working voice demo, deploy to
maritime.sh (step 1).

```bash
npm install
npm start          # http://localhost:3300
```

## Known limitation: latency

`askShopAgent()` shells out to `maritime message --wait 55` (two model hops,
~20–40s). Live voice feels slow at that latency. v1 ships as-is — the system
prompt lets the assistant use a filler ("let me check with the counter…"). A
future pass could stream or shorten the wait; not in this branch.
