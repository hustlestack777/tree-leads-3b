# tree-leads-3b

One lead intake for 3 B's Tree Removal. Three ways in:

| Channel | Endpoint | Auth |
| --- | --- | --- |
| Website form (preview site) | `POST /api/leads` (JSON, photos as data URLs) | CORS allowlist + honeypot + 10/hour/IP |
| Phone line 318-712-TREE (ElevenLabs agent server tool `save_lead`) | `POST /api/agent-lead` | `X-Lead-Token` header (ElevenLabs secret) |
| Website chat (same ElevenLabs agent, chat mode) | `POST /api/agent-lead` with `channel: "chat"` | same |

Each lead is saved to `tree_leads.leads` (+ `tree_leads.lead_photos`), then:

1. **Team email** (full card, photos attached + links, ballpark, map) To everyone in `LEAD_TEAM_EMAILS`.
2. **Customer confirmation** (if they gave an email): their details + ballpark, "our team will call you back", with `LEAD_TEAM_EMAILS` BCC'd.

## Who gets copies (one line)

`LEAD_TEAM_EMAILS` (Render env var, or the default in `config.js`). Comma-separated.
Add Blake: append his address after a comma.

Test leads: any phone with a 555 exchange (e.g. 337-555-0142) gets `TEST –` in every subject.

Copy rules: never names a person as the caller, no "free", no "insured", no texting.

## Grok Voice backup (voice "ara") — built, NOT wired to the phone yet

ElevenLabs answers 318-712-TREE first. `voice.js` adds a Grok Voice backup that uses the same script
(`grok/prompt.md` + `grok/kb.md`, copied from ElevenLabs agent `agent_1801m75zbr7eey6vcnxrtrasw18e` and
knowledge doc `RLa58R7I4wkOSQmbLKLY`, persona switched to a woman for Ara) and saves leads through the same
`intake()` as `/api/agent-lead` (no token needed, same process).

| Route | Use |
| --- | --- |
| `POST /twilio/voice` | Optional router to use as the number's voice URL. Forwards the call to ElevenLabs' `inbound_call`, adds `<Connect action=/twilio/el-ended>`. If ElevenLabs errors or times out (5 s), Grok answers. |
| `POST /twilio/el-ended` | Twilio hits this when the ElevenLabs stream ends. Ended within `EL_MIN_SECS` (12 s) of the call arriving = ElevenLabs failed (e.g. no credits), so Grok picks up. Otherwise hang up. |
| `POST /twilio/fallback` | For Twilio's Fallback URL ("primary handler fails"). Straight to Grok. |
| `WS /twilio/grok-stream` | Twilio Media Streams <-> `wss://api.x.ai/v1/realtime?model=grok-voice-latest`, G.711 mu-law both ways, server VAD, barge-in, `save_lead` + `end_call` tools, partial lead if the call drops. |

Env: `XAI_API_KEY` (required for Grok; without it the backup says a short sorry-call-back message and hangs up),
`TWILIO_AUTH_TOKEN` (recommended: turns on Twilio signature checks), optional `GROK_VOICE` (default `ara`),
`GROK_REASONING` (`none` = lower latency), `EL_MIN_SECS`, `EL_TIMEOUT_MS`, `GROK_MAX_CALL_SECS` (420).
Streams need a short-lived HMAC token minted from `STREAM_SECRET` (falls back to `AGENT_TOOL_TOKEN`).

Tests: `npm test` (offline: mock ElevenLabs, mock Grok, fake Twilio).

Hosting note: this service is on Render's free plan, which sleeps after ~15 min idle and takes up to a minute to
wake. A sleeping backup can't answer a call in time; it needs to stay awake (Starter plan) before Twilio points at it.
