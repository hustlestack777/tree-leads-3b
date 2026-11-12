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


## Ballpark ranges (`POST /api/ballpark`)

Same contract as the LRL credit preview: after the contact form (name, phone, consent), returns a trimming range or a callback. Prices come from `TREE_PRICING_JSON` and the `RANGE_MARKUP_*` env vars on this service, never from the repo or the page.

CORS uses the same `ALLOWED_ORIGINS` list as `POST /api/leads`.

### Get Pros origins — list only, do not apply yet

When the Get Pros preview (and later the live domain) is ready, add these to the Render `ALLOWED_ORIGINS` env var on `tree-leads-3b-4omg` (comma-separated, no trailing slashes):

- `https://getpros.xyz`
- `https://www.getpros.xyz`
- the Cloudflare `workers.dev` preview origin, once the Worker is deployed (for example `https://getpros-router.<account>.workers.dev`)

Also update `SITE_URL` to `https://getpros.xyz/3bs-tree-removal/` so follow-up links in emails point at the magnet.

Copy these env vars from the preview service `tree-lrl-credit-preview` onto this service before relying on `/api/ballpark` in production: `TREE_PRICING_JSON`, `RANGE_MARKUP` (optional), `RANGE_MARKUP_SMALL`, `RANGE_MARKUP_MEDIUM`, `RANGE_MARKUP_LARGE`. Do not change live env vars until that cutover is approved.

ElevenLabs allowed-website origins to add at the same time (Camille on 3 B's, and Gigi on Acadiana), not applied yet:

- `https://getpros.xyz`
- `https://www.getpros.xyz`
- the same `workers.dev` preview origin
