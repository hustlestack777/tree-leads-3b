import crypto from "node:crypto";
import express from "express";
import { Resend } from "resend";
import { config } from "./config.js";
import { db, migrate } from "./db.js";
import { buildCustomerEmail, buildTeamEmail } from "./emails.js";

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "20mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
const s = (v, max = 2000) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null; };
const validEmail = (e) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const TEST_LEAD_INBOX = "shaun.brasher@gmail.com";
const isTest = (lead) => {
  const d = String(lead.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return (d.length === 10 && d.slice(3, 6) === "555") || /\btest\b/i.test(lead.source_detail || "");
};

// CORS for the website form.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => res.type("text").send("3 B's lead intake is running."));
app.get("/health", (_req, res) => res.json({ ok: true }));

function decodePhotos(list) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : []).slice(0, MAX_PHOTOS)) {
    const m = /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,(.+)$/s.exec(String(p?.dataUrl || ""));
    if (!m) continue;
    const bytes = Buffer.from(m[2], "base64");
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) continue;
    out.push({ filename: s(p.name, 120) || `photo-${out.length + 1}.jpg`, contentType: m[1], bytes });
  }
  return out;
}

async function rateLimited(ip) {
  const r = await db().query(
    `WITH ins AS (INSERT INTO tree_leads.rate (ip) VALUES ($1)) SELECT count(*)::int AS n FROM tree_leads.rate WHERE ip = $1 AND at > now() - interval '1 hour'`,
    [ip],
  );
  db().query(`DELETE FROM tree_leads.rate WHERE at < now() - interval '1 day'`).catch(() => {});
  return r.rows[0].n > 10;
}

/** Save one lead from any channel, then email the team and the customer. */
async function intake(lead, photos) {
  const id = crypto.randomUUID();
  const photoKey = crypto.randomBytes(18).toString("base64url");
  lead.test = isTest(lead);
  const ins = await db().query(
    `INSERT INTO tree_leads.leads (id, source, source_detail, external_id, test, name, phone, email, address, town, lat, lon, map_url,
       job_types, tree_count, stump_count, urgent, hazards, access, how_soon, best_day, best_time, description, breakdown,
       ballpark_low, ballpark_high, call_summary, photo_count, photo_key, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
     ON CONFLICT (external_id) DO NOTHING RETURNING id, created_at`,
    [id, lead.source, lead.source_detail, lead.external_id || null, lead.test, lead.name, lead.phone, lead.email, lead.address, lead.town,
      lead.lat, lead.lon, lead.map_url, lead.job_types, lead.tree_count, lead.stump_count, !!lead.urgent, lead.hazards, lead.access,
      lead.how_soon, lead.best_day, lead.best_time, lead.description, lead.breakdown, lead.ballpark_low, lead.ballpark_high,
      lead.call_summary, photos.length, photoKey, lead.raw || null],
  );
  if (!ins.rows.length) return { id: null, duplicate: true };
  lead.id = id;
  lead.created_at = ins.rows[0].created_at;
  lead.photo_count = photos.length;
  for (const [i, p] of photos.entries()) {
    await db().query(`INSERT INTO tree_leads.lead_photos (lead_id, idx, filename, content_type, bytes) VALUES ($1,$2,$3,$4,$5)`,
      [id, i, p.filename, p.contentType, p.bytes]);
  }
  const mail = await sendEmails(lead, photos, photoKey);
  await db().query(`UPDATE tree_leads.leads SET team_email_id=$2, customer_email_id=$3, email_error=$4 WHERE id=$1`,
    [id, mail.teamId, mail.customerId, mail.error]);
  return { id, ...mail };
}

async function sendEmails(lead, photos, photoKey) {
  if (!process.env.RESEND_API_KEY) return { teamId: null, customerId: null, error: "RESEND_API_KEY is not set" };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const base = config.PUBLIC_URL.replace(/\/$/, "");
  const photoLinks = base ? photos.map((_, i) => `${base}/photo/${lead.id}/${i}?k=${photoKey}`) : [];
  const team = buildTeamEmail(lead, photoLinks);
  const errors = [];
  let teamId = null, customerId = null;
  // Test leads (555 phone or "test" source) go to Shaun only, never to Blake or any other team inbox.
  const teamTo = lead.test ? [TEST_LEAD_INBOX] : config.LEAD_TEAM_EMAILS;
  const send = async (label, payload, key) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await resend.emails.send(payload, { idempotencyKey: key });
      if (!error) return data?.id || null;
      if (attempt) errors.push(`${label}: ${error.message}`);
    }
    return null;
  };
  teamId = await send("team", {
    from: config.RESEND_FROM,
    to: teamTo,
    replyTo: validEmail(lead.email) ? lead.email : undefined,
    subject: team.subject, html: team.html, text: team.text,
    attachments: photos.map((p) => ({ filename: p.filename, content: p.bytes })),
  }, `tree-team/${lead.id}`);
  if (validEmail(lead.email)) {
    const c = buildCustomerEmail(lead);
    customerId = await send("customer", {
      from: config.RESEND_FROM,
      to: [lead.email],
      bcc: [...new Set([...(lead.test ? [] : [...config.LEAD_TEAM_EMAILS, ...config.CUSTOMER_BCC]), TEST_LEAD_INBOX].map((e) => e.toLowerCase()))]
        .filter((e) => e !== String(lead.email).toLowerCase()),
      replyTo: config.REPLY_TO.length ? config.REPLY_TO : undefined,
      subject: c.subject, html: c.html, text: c.text,
    }, `tree-customer/${lead.id}`);
  }
  return { teamId, customerId, error: errors.join("; ") || null };
}

// (1) Website form.
app.post("/api/leads", async (req, res) => {
  try {
    const b = req.body || {};
    if (s(b.website)) return res.json({ ok: true }); // honeypot
    const name = s(b.name, 120), phone = s(b.phone, 40);
    if (!name || !phone || phone.replace(/\D/g, "").length < 10) return res.status(400).json({ ok: false, error: "Name and a 10-digit phone are required." });
    if (await rateLimited(req.ip || "?")) return res.status(429).json({ ok: false, error: "Too many requests." });
    const lat = Number(b.lat), lon = Number(b.lon);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0;
    const lead = {
      source: b.channel === "chat" ? "chat" : "web",
      source_detail: s([b.page, b.source && `src=${b.source}`, b.variant && `v=${b.variant}`, b.utm && Object.entries(b.utm).map(([k, v]) => `${k}=${v}`).join("&")].filter(Boolean).join(" · "), 400),
      name, phone, email: validEmail(s(b.email, 200)) ? s(b.email, 200) : null,
      address: s(b.address, 300), town: s(b.town, 120),
      lat: hasPoint ? lat : null, lon: hasPoint ? lon : null,
      map_url: hasPoint ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}` : (s(b.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : null),
      job_types: s(Array.isArray(b.jobTypeLabels) ? b.jobTypeLabels.join(", ") : b.jobTypeLabels, 300),
      tree_count: s(b.treeCount, 20), stump_count: s(b.stumpCount, 20),
      urgent: !!b.stormUrgent, hazards: s(b.hazards, 500), access: s(b.access || b.comments, 800),
      how_soon: s(b.howSoon, 80), best_day: s(b.bestDay, 80), best_time: s(b.bestTime, 80),
      description: s(b.notes, 4000),
      breakdown: s(Array.isArray(b.breakdown) ? b.breakdown.map((l) => `${l.label}: $${l.low}–$${l.high}`).join("; ") : null, 1000),
      ballpark_low: int(b.rangeLow), ballpark_high: int(b.rangeHigh),
      raw: { ...b, photos: undefined },
    };
    const photos = decodePhotos(b.photos);
    const r = await intake(lead, photos);
    res.json({ ok: true, id: r.id, emailed: !!r.teamId, customerEmailed: !!r.customerId, photos: photos.length });
  } catch (e) {
    console.error("web lead failed", e);
    res.status(500).json({ ok: false, error: "Could not save the lead." });
  }
});

// (2) Phone agent / chat agent server tool. ElevenLabs calls this with the details the caller gave.
app.post("/api/agent-lead", async (req, res) => {
  const token = process.env.AGENT_TOOL_TOKEN;
  const given = String(req.headers["x-lead-token"] || "");
  if (!token || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    return res.status(401).json({ ok: false });
  }
  try {
    const b = req.body || {};
    const channel = String(b.channel || "phone").toLowerCase().includes("chat") ? "chat" : "phone";
    const lead = {
      source: channel,
      source_detail: s(b.conversation_id ? `conversation ${b.conversation_id}` : channel === "phone" ? "318-712-TREE" : "website chat", 200),
      external_id: s(b.conversation_id, 120) ? `${channel}:${s(b.conversation_id, 120)}` : null,
      name: s(b.name, 120), phone: s(b.phone || b.caller_phone, 40),
      email: validEmail(s(b.email, 200)) ? s(b.email, 200) : null,
      address: s(b.address, 300), town: s(b.town || b.parish, 120),
      map_url: s(b.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : null,
      job_types: s(b.job_type, 300), tree_count: s(b.tree_count, 40), stump_count: s(b.stump_count, 40),
      urgent: b.urgent === true || /^(true|yes)$/i.test(String(b.urgent || "")),
      hazards: s(b.hazards, 500), access: s(b.access, 500), how_soon: s(b.how_soon, 80),
      best_day: s(b.best_day, 80), best_time: s(b.best_time || b.best_callback_time, 80),
      description: s(b.description, 4000),
      ballpark_low: int(b.ballpark_low), ballpark_high: int(b.ballpark_high),
      call_summary: s(b.summary, 2000), raw: b,
    };
    const r = await intake(lead, []);
    res.json({ ok: true, saved: !!r.id || r.duplicate, message: "Lead saved. Tell the caller our team will call them back." });
  } catch (e) {
    console.error("agent lead failed", e);
    res.status(500).json({ ok: false, message: "Could not save. Keep taking details; our team still gets the call record." });
  }
});

// Photo links in the team email (unguessable key per lead).
app.get("/photo/:id/:idx", async (req, res) => {
  try {
    const r = await db().query(
      `SELECT p.content_type, p.bytes FROM tree_leads.lead_photos p JOIN tree_leads.leads l ON l.id = p.lead_id
       WHERE p.lead_id = $1 AND p.idx = $2 AND l.photo_key = $3`, [req.params.id, Number(req.params.idx), String(req.query.k || "")]);
    if (!r.rows.length) return res.sendStatus(404);
    res.type(r.rows[0].content_type).set("Cache-Control", "private, max-age=86400").send(r.rows[0].bytes);
  } catch { res.sendStatus(404); }
});

const port = Number(process.env.PORT || 10000);
migrate().then(() => console.log("tree_leads schema ready")).catch((e) => console.error("migrate failed", e.message));
app.listen(port, () => console.log(`tree leads listening on ${port}`));
