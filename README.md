# tree-leads-3b

One lead intake for 3 B's Tree Removal. Three ways in:

| Channel | Endpoint | Auth |
| --- | --- | --- |
| Website form (preview site) | `POST /api/leads` (JSON, photos as data URLs) | CORS allowlist + honeypot + 10/hour/IP |
| Phone line 318-712-TREE (ElevenLabs agent server tool `save_lead`) | `POST /api/agent-lead` | `X-Lead-Token` header (ElevenLabs secret) |
| Website chat (same ElevenLabs agent, chat mode) | `POST /api/agent-lead` with `channel: "chat"` | same |
| Camille feedback (Blake or Shaun on 318-712-TREE) | `POST /api/agent-feedback` (ElevenLabs tool `save_feedback`) | same `X-Lead-Token` |

Each lead is saved to `tree_leads.leads` (+ `tree_leads.lead_photos`), then:

1. **Team email** (full card, photos attached + links, ballpark, map) To everyone in `LEAD_TEAM_EMAILS`.
2. **Customer confirmation** (if they gave an email): their details + ballpark, "our team will call you back", with `LEAD_TEAM_EMAILS` BCC'd.

## Who gets copies (one line)

`LEAD_TEAM_EMAILS` (Render env var, or the default in `config.js`). Comma-separated.
Add Blake: append his address after a comma.

Test leads: a name that starts with `TEST` (any case, e.g. "Test Shaun"), any phone with a 555 exchange (e.g. 337-555-0142), or a source detail containing "test" is stored with `test = true` and gets `TEST –` in every subject. The team alert goes only to shaun.brasher@gmail.com, never to Blake or the other team inboxes. A `TEST`-named lead also skips the homeowner confirmation email entirely. (555 and test-source leads still send the confirmation to the email typed in, BCC Shaun only.)

Feedback from Camille (`POST /api/agent-feedback`) is stored in `tree_leads.feedback` and emailed only to shaun.brasher@gmail.com, from `3bs@getpros.xyz`. It never creates a lead, never uses `LEAD_TEAM_EMAILS`, and never emails Blake. Nothing about the agent changes from a feedback call itself.

Allowed browser origins always include tree-lrl-credit-preview.onrender.com, 3bs.getpros.xyz, tree.getpros.xyz, getpros.xyz and www.getpros.xyz, on top of `ALLOWED_ORIGINS`.

Copy rules: never names a person as the caller, no "free", no "insured", no texting.

Sender: `3 B's Tree Removal <3bs@getpros.xyz>` (getpros.xyz is verified in Resend). If Resend refuses it, the alert retries from `3bs@lagniapperealmlabs.com`; a hustlestack.app `RESEND_FROM` env value is only a last resort so no alert is lost. Reply-to is unchanged.

Price ranges: only a trimming-only lead keeps a ballpark range. Any lead whose work includes removal, stumps, storm cleanup, land clearing or dirt work is stored and emailed with no range ("call for a ballpark").
