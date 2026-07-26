# Voice channel wiring (Vapi)

Voice = the same Counter brain as WhatsApp/web, reached through a new channel.
The Vapi assistant is a **thin voice shell**: it greets the caller, then on each
turn invokes the `ask_counter` custom tool, which Vapi delivers to
`POST /api/voice/tool` as a tool-call webhook. That route wraps the existing
`askShopAgent()` brain — one source of truth, no menu duplication.

Vapi (unlike ElevenLabs) supports **real inbound phone calls natively**: you buy
a number in the Vapi dashboard and point it at the assistant — no Twilio, no SIP
trunk. So this branch ships two voice paths off the same brain:

- **Web call** — a "📞 Call" button on the shop chat page (Vapi Web SDK).
- **Inbound phone** — customers dial a Vapi number (buy/import in dashboard).

> WhatsApp *voice calls* still aren't possible (WhatsApp audio isn't open to
> bots); WhatsApp stays text via the Hermes gateway ([`../whatsapp/README.md`](../whatsapp/README.md)).

First shop wired: **Boston Kitchen Pizza** (`boston-kitchen-pizza`).

---

## 1. Add env vars (`.env`, gitignored)

```
VAPI_ASSISTANT_ID=<assistant id from dashboard>   # for the web widget
VAPI_PUBLIC_KEY=<public key from dashboard>        # safe for the browser
```

Restart `npm start` after editing `.env`.

## 2. Create the assistant in the Vapi dashboard

1. **Assistants → Add Assistant → Custom.**
2. Paste the **System prompt** below.
3. **Add a tool** using the **`ask_counter`** custom-tool config below.
4. Set the assistant's **Server URL** to your tunnel + this route:
   `https://<your-tunnel>.trycloudflare.com/api/voice/tool?slug=boston-kitchen-pizza`
   (Vapi posts all conversation events here; only `tool-calls` get a payload back.)
5. Copy the assistant id + your public key into `.env`.

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

The tool's `server.url` is NOT set here — Vapi routes tool calls through the
assistant's **Server URL** (step 4), so they hit `/api/voice/tool` with
`message.type === "tool-calls"`. The server resolves each call and returns
`{ results: [{ toolCallId, result }] }`.

## 3. Expose the server publicly (so Vapi can reach it)

```bash
npm start                                       # http://localhost:3300
cloudflared tunnel --url http://localhost:3300  # → https://<random>.trycloudflare.com
```

Use that URL in step 2's Server URL.

## 4. (Optional) Wire an inbound phone number

In the Vapi dashboard: **Phone Numbers → Buy / Import** a number, then set its
**Assistant** to the one you created. Customers dial it → Vapi answers with the
assistant → the same `ask_counter` tool → same brain. No Twilio, no SIP.

## 5. Test end-to-end

1. Smoke-test the route directly (no Vapi needed):
   ```bash
   curl -X POST 'http://localhost:3300/api/voice/tool?slug=boston-kitchen-pizza' \
     -H 'content-type: application/json' \
     -d '{"message":{"type":"tool-calls","toolCallList":[{"id":"test1","name":"ask_counter","arguments":{"message":"do you have a large hawaiian?"}}]}}'
   # → {"results":[{"toolCallId":"test1","result":"..."}]}
   ```
2. **Web call:** open `/s/boston-kitchen-pizza`, click **📞 Call**, grant mic,
   ask by voice.
3. **Phone:** dial the Vapi number and ask.
4. Trap check (both paths): *"do you have a large Hawaiian?"* → explains large
   isn't offered and counter-offers medium ($19.95) / XL ($32), spoken.

---

## How it connects back to the existing app

```
/phone or browser mic/ ──Vapi──► assistant ──(tool call)──►
   POST /api/voice/tool?slug=boston-kitchen-pizza       (server.mjs, NEW)
        │  only message.type "tool-calls" answered; others ACK'd
        │  for each tool call: askShopAgent(shop, null, msg.arguments.message)
        │  = SAME brain as /api/chat
        ▼
   maritime message --user shop_boston-kitchen-pizza  → { reply }
        │ speakable(reply): URLs → "I'll send you the link", digits spelled
        ▼
   { results: [{ toolCallId, result }] }  ← Vapi feeds result to the assistant to speak
```

- Brain = [`askShopAgent()`](../server.mjs) — unchanged, shared with `/api/chat`.
- Voice-specific transform = [`speakable()`](../server.mjs) (strip URLs, spell digits) — server-side, one place.
- Web widget + "📞 Call" button live in [`../public/chat.html`](../public/chat.html); the
  button hides itself until both `VAPI_ASSISTANT_ID` and `VAPI_PUBLIC_KEY` are set.

## Known limitation: latency

`askShopAgent()` shells out to `maritime message --wait 55` (two model hops,
~20–40s on WhatsApp). Live voice feels slow at that latency. v1 ships as-is —
the system prompt lets the assistant use a filler ("let me check with the
counter…"). A future pass could stream or shorten the wait; not in this branch.
