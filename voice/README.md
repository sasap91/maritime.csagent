# Voice channel wiring (ElevenLabs Conversational AI)

Voice = the same Counter brain as WhatsApp/web, reached through a new channel.
The ElevenLabs agent is a **thin voice shell**: it greets the caller, then for
every turn calls the `ask_counter` webhook tool, which hits
`POST /api/voice/answer` → the existing `askShopAgent()` brain. One source of
truth — no menu duplication, no second briefing to maintain.

> ElevenLabs Conversational AI cannot make **WhatsApp voice calls** (WhatsApp
> audio isn't open to bots). WhatsApp stays text via the Hermes gateway
> (see [`../whatsapp/README.md`](../whatsapp/README.md)). Voice here is a
> browser-mic widget on the shop's chat page — the "📞 Call" button. A real
> inbound phone number (Twilio → SIP → ElevenLabs) is a future addition; this
> branch ships the widget path only.

First shop wired: **Boston Kitchen Pizza** (`boston-kitchen-pizza`), mirroring
the WhatsApp demo.

---

## 1. Add env vars (`.env`, gitignored)

```
ELEVENLABS_AGENT_ID=agent_xxxxx          # public agent id from the dashboard
ELEVENLABS_TOOL_SECRET=anything-you-pick # optional shared secret; gates the webhook via x-tool-secret header
```

Restart `npm start` after editing `.env`.

## 2. Create the agent in the ElevenLabs dashboard

1. **Conversational AI → Create Agent.**
2. **Advanced tab → Authentication disabled + Public agent** (both required for the widget to embed).
3. Paste the **System prompt** below into the agent's prompt.
4. **Add a tool** (Webhook) using the **`ask_counter`** config below.
5. Copy the agent's public id into `.env` as `ELEVENLABS_AGENT_ID`.

### System prompt (paste verbatim)

```
You are the friendly, efficient voice agent working the counter at Boston Kitchen Pizza.
Customers are calling you by voice. Keep replies short and spoken — 1-3 sentences,
exact prices and times, never invent menu items or prices.

RULE: for EVERY question about the menu, prices, hours, ordering, or anything
shop-specific, you MUST call the `ask_counter` tool with the customer's words
(verbatim, JSON-escaped) and then speak back EXACTLY the `result` field — no
preamble, no additions, no mention of tools or APIs. The tool is the only source
of truth; never answer from your own knowledge.

If the tool fails or returns nothing useful, say: "Sorry, give us one sec — try
again in a moment." and nothing else.

Speak naturally. Phone numbers are already spelled out digit-by-digit in the
reply; just read them as given. Links are read as "I'll send you the link" — do
not spell out URLs.
```

### Webhook tool config (`ask_counter`)

| Field | Value |
|---|---|
| Name | `ask_counter` |
| Description | `Ask the Boston Kitchen Pizza counter agent a question (menu, prices, hours, ordering). Returns the spoken answer.` |
| Method | `POST` |
| URL | `https://<your-tunnel>.trycloudflare.com/api/voice/answer?slug=boston-kitchen-pizza` |
| Content type | `application/json` |
| Body param | `message` (string) — "the customer's latest words, verbatim" |
| Header (optional) | `x-tool-secret: <ELEVENLABS_TOOL_SECRET>` (only if you set the secret) |

In the agent prompt, tell the model (already in the system prompt above):
*"Always call `ask_counter` before answering menu/price/hours/order questions;
speak the `result` field back to the customer."*

## 3. Expose the server publicly (so ElevenLabs can reach the tool)

```bash
npm start                                  # http://localhost:3300
cloudflared tunnel --url http://localhost:3300   # → https://<random>.trycloudflare.com
```

Put that URL into the tool's URL field (step 2).

## 4. Test end-to-end

1. Smoke-test the route directly (no ElevenLabs needed):
   ```bash
   curl -X POST 'http://localhost:3300/api/voice/answer?slug=boston-kitchen-pizza' \
     -H 'content-type: application/json' \
     -d '{"parameters":{"message":"do you have a large hawaiian?"}}'
   # → {"result":"..."}  (same grounded answer the web/WhatsApp chat gives)
   ```
2. Open `/s/boston-kitchen-pizza`, click **📞 Call**, grant mic, and ask by voice.
3. Trap check: *"do you have a large Hawaiian?"* → should explain large isn't
   offered and counter-offer medium ($19.95) / XL ($32), spoken.

---

## How it connects back to the existing app

```
/browser mic/ ──ElevenLabs widget──► ElevenLabs agent ──(tool call)──►
   POST /api/voice/answer?slug=boston-kitchen-pizza          (server.mjs, NEW)
        │  internally calls askShopAgent(shop, null, msg)    (SAME brain as /api/chat)
        ▼
   maritime message --user shop_boston-kitchen-pizza  → { reply }
        │ speakable(reply): URLs → "I'll send you the link", digits spelled out
        ▼
   { result }  ← spoken to the caller
```

- Brain = [`askShopAgent()`](../server.mjs) — unchanged, shared with `/api/chat`.
- Voice-specific transform = [`speakable()`](../server.mjs) (strip URLs, spell digits) — server-side, one place.
- Widget embed + "📞 Call" button live in [`../public/chat.html`](../public/chat.html); the
  button hides itself until `ELEVENLABS_AGENT_ID` is set.

## Known limitation: latency

`askShopAgent()` shells out to `maritime message --wait 55` (two model hops,
~20–40s on WhatsApp). Live voice feels slow at that latency. v1 ships as-is —
the system prompt lets the agent use a filler ("let me check with the counter…").
A future pass could stream or shorten the wait; not in this branch.
