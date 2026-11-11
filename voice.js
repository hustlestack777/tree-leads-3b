// Grok Voice backup answerer for 318-712-TREE.
// ElevenLabs answers first. Grok (voice "ara") takes the call when ElevenLabs can't:
//   POST /twilio/voice     optional router: forwards the call to ElevenLabs and adds a <Connect action>
//                          so a stream that dies in the first seconds (no credits, outage) rolls to Grok.
//   POST /twilio/el-ended  Twilio calls this when the ElevenLabs stream ends.
//   POST /twilio/fallback  for Twilio's "Primary handler fails" (Fallback URL): straight to Grok.
//   WS   /twilio/grok-stream  Twilio Media Streams <-> wss://api.x.ai/v1/realtime bridge (G.711 mu-law both ways).
// Nothing here is wired to the phone number until Twilio's webhook settings point at it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));

export const voiceConfig = () => ({
  XAI_API_KEY: env("XAI_API_KEY", ""),
  GROK_REALTIME_URL: env("GROK_REALTIME_URL", "wss://api.x.ai/v1/realtime?model=grok-voice-latest"),
  GROK_VOICE: env("GROK_VOICE", "ara"),
  GROK_REASONING: env("GROK_REASONING", ""), // "none" for lowest latency; empty = model default
  GROK_BACKUP_ENABLED: env("GROK_BACKUP_ENABLED", "true") !== "false",
  EL_INBOUND_URL: env("EL_INBOUND_URL", "https://api.us.elevenlabs.io/twilio/inbound_call"),
  EL_TIMEOUT_MS: Number(env("EL_TIMEOUT_MS", "5000")),
  // An ElevenLabs stream that ends sooner than this after the call came in is treated as a failure.
  EL_MIN_SECS: Number(env("EL_MIN_SECS", "12")),
  MAX_CALL_SECS: Number(env("GROK_MAX_CALL_SECS", "420")),
  TWILIO_AUTH_TOKEN: env("TWILIO_AUTH_TOKEN", ""),
  STREAM_SECRET: env("STREAM_SECRET", env("AGENT_TOOL_TOKEN", "")) || crypto.randomBytes(32).toString("hex"),
  FIRST_MESSAGE: env("GROK_FIRST_MESSAGE", "Hey, thanks for calling 3 B's Tree Removal! This is the 3 B's AI assistant. How can we help you today?"),
});

const PHONE_ADDENDUM = `
# This call (phone, backup line)
- You are on a live phone call. Keep every turn to one or two short sentences.
- Call the save_lead tool once you have the caller's name, callback number and a short description of the job. Call it again only if they add something important. If the call is ending early, call it with whatever you have. Never say the lead was texted; say our team will call them back.
- Call the end_call tool only after you've read their details back and they say goodbye or there's nothing else, or they clearly want to hang up. Say a short goodbye first.
- There is no transfer tool and no texting. Never book a job or set a time.`;

export function buildInstructions() {
  const prompt = fs.readFileSync(path.join(dir, "grok/prompt.md"), "utf8").trim();
  const kb = fs.readFileSync(path.join(dir, "grok/kb.md"), "utf8").trim();
  return `${prompt}\n${PHONE_ADDENDUM}\n\n# Knowledge doc: 3 B's Tree Removal SHARED knowledge\n${kb}\n`;
}

export const TOOLS = [
  {
    type: "function",
    name: "save_lead",
    description: "Save this caller's tree job as a lead for our team. Call it once you have the caller's name and callback phone and a short description of the job (photos are optional; a spoken description is enough). Call it again only if they add something important. If the call is ending early, call it with whatever you have.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's name." },
        phone: { type: "string", description: "Best callback number, digits only, as confirmed by the caller." },
        email: { type: "string", description: "Caller's email if they gave one. Empty if not given." },
        address: { type: "string", description: "Job address as read back and confirmed, including town." },
        town: { type: "string", description: "Town and parish." },
        job_type: { type: "string", description: "Work needed, e.g. tree removal, trimming, stump grinding, storm cleanup." },
        tree_count: { type: "string", description: "How many trees or limbs." },
        stump_count: { type: "string", description: "How many stumps, if any." },
        urgent: { type: "boolean", description: "True if a tree is on or threatening a house, car, or power line, or blocking a road or driveway." },
        hazards: { type: "string", description: "What the tree is near: house, power line, fence, pool, shed, etc." },
        access: { type: "string", description: "Access: gate width, backyard, slope, can a truck get close." },
        how_soon: { type: "string", description: "How soon they need it done." },
        best_callback_time: { type: "string", description: "Best day and time for our team to call back." },
        description: { type: "string", description: "The caller's description of the job in plain words, including tree sizes." },
        ballpark_low: { type: "integer", description: "Low end of the ballpark range you gave in dollars, or 0 if none." },
        ballpark_high: { type: "integer", description: "High end of the ballpark range you gave in dollars, or 0 if none." },
        summary: { type: "string", description: "Two or three sentence summary for our team: the job, the ballpark you gave, and anything special." },
      },
      required: ["name", "phone", "description"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "Hang up. Only after the caller's details have been read back and the caller says goodbye or confirms there's nothing else, or the caller clearly wants to hang up. Never during an emergency safety instruction.",
    parameters: { type: "object", properties: { reason: { type: "string" } } },
  },
];

// ---- Twilio request signature (validated when TWILIO_AUTH_TOKEN is set) ----
export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}
function validTwilio(req, cfg, publicUrl) {
  if (!cfg.TWILIO_AUTH_TOKEN) return true;
  const url = publicUrl.replace(/\/$/, "") + req.originalUrl;
  const want = twilioSignature(cfg.TWILIO_AUTH_TOKEN, url, req.body || {});
  const got = String(req.headers["x-twilio-signature"] || "");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// ---- Short-lived token so only streams we handed out can open a Grok session ----
export function streamToken(secret, callSid, ttlSecs = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSecs;
  const mac = crypto.createHmac("sha256", secret).update(`${callSid}.${exp}`).digest("base64url");
  return `${exp}.${mac}`;
}
export function checkStreamToken(secret, callSid, token) {
  const [exp, mac] = String(token || "").split(".");
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  const want = crypto.createHmac("sha256", secret).update(`${callSid}.${exp}`).digest("base64url");
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}

export function grokTwiml(cfg, publicUrl, callSid, from) {
  if (!cfg.GROK_BACKUP_ENABLED || !cfg.XAI_API_KEY || !publicUrl) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thanks for calling 3 B's Tree Removal. We can't pick up right this second. Please call back in a few minutes, or use the quote form on our website, and our team will call you back.</Say><Hangup/></Response>`;
  }
  const ws = publicUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/twilio/grok-stream";
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(ws)}">` +
    `<Parameter name="t" value="${xml(streamToken(cfg.STREAM_SECRET, callSid))}"/>` +
    `<Parameter name="from" value="${xml(from || "")}"/></Stream></Connect><Hangup/></Response>`;
}

export function registerVoice(app, server, { intake, agentLead, publicUrl, log = console }) {
  const cfg = voiceConfig();
  const base = () => (publicUrl() || "").replace(/\/$/, "");
  const started = new Map(); // CallSid -> ms when the call reached us
  const form = express.urlencoded({ extended: false });
  const twiml = (res, body) => res.type("text/xml").send(body);
  const sweep = () => { const cut = Date.now() - 3600_000; for (const [k, v] of started) if (v < cut) started.delete(k); };

  app.post("/twilio/fallback", form, (req, res) => {
    if (!validTwilio(req, cfg, base())) return res.sendStatus(403);
    log.log(`[voice] fallback -> grok call=${req.body.CallSid} err=${req.body.ErrorCode || ""}`);
    twiml(res, grokTwiml(cfg, base(), req.body.CallSid, req.body.From));
  });

  app.post("/twilio/voice", form, async (req, res) => {
    if (!validTwilio(req, cfg, base())) return res.sendStatus(403);
    const sid = req.body.CallSid;
    started.set(sid, Date.now()); sweep();
    try {
      const r = await fetch(cfg.EL_INBOUND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(req.body).toString(),
        signal: AbortSignal.timeout(cfg.EL_TIMEOUT_MS),
      });
      const body = await r.text();
      if (!r.ok || !/<Connect[\s>]/.test(body)) throw new Error(`ElevenLabs ${r.status}: ${body.slice(0, 160)}`);
      const action = `${base()}/twilio/el-ended`;
      log.log(`[voice] call=${sid} -> elevenlabs`);
      return twiml(res, body.replace(/<Connect(\s|>)/, `<Connect action="${xml(action)}" method="POST"$1`));
    } catch (e) {
      log.error(`[voice] call=${sid} elevenlabs failed, using grok: ${e.message}`);
      return twiml(res, grokTwiml(cfg, base(), sid, req.body.From));
    }
  });

  app.post("/twilio/el-ended", form, (req, res) => {
    if (!validTwilio(req, cfg, base())) return res.sendStatus(403);
    const sid = req.body.CallSid;
    const t0 = started.get(sid);
    started.delete(sid);
    const secs = t0 ? (Date.now() - t0) / 1000 : Infinity;
    if (secs < cfg.EL_MIN_SECS) {
      log.error(`[voice] call=${sid} elevenlabs stream ended after ${secs.toFixed(1)}s, rolling to grok`);
      return twiml(res, grokTwiml(cfg, base(), sid, req.body.From));
    }
    twiml(res, `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url.startsWith("/twilio/grok-stream")) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, cfg, { intake, agentLead, log }));
  });
  return { cfg };
}

/** One phone call: Twilio media stream in, Grok realtime session out. */
export function bridge(twilio, cfg, { intake, agentLead, log = console }) {
  let streamSid = null, callSid = null, from = "", grok = null, ready = false, closed = false;
  let leadSaved = false, hangupPending = false, markN = 0;
  const early = [];
  const transcript = [];
  const callerLine = new Map();
  const pendingMarks = new Map();
  const t0 = Date.now();
  const toTwilio = (m) => twilio.readyState === WebSocket.OPEN && twilio.send(JSON.stringify(m));
  const toGrok = (m) => grok && grok.readyState === WebSocket.OPEN && grok.send(JSON.stringify(m));
  let maxTimer = null;

  const finish = async (why) => {
    if (closed) return; closed = true;
    clearTimeout(maxTimer);
    log.log(`[grok] call=${callSid} ended (${why}) after ${((Date.now() - t0) / 1000).toFixed(0)}s, lead=${leadSaved}`);
    try { grok && grok.close(); } catch {}
    try { twilio.close(); } catch {}
    // Safety net: a call that drops before save_lead still becomes a lead if the caller said anything.
    if (!leadSaved && callSid && transcript.some((l) => l.startsWith("Caller:"))) {
      try {
        await intake(agentLead({
          conversation_id: `grok-${callSid}`, caller_phone: from, channel: "phone", name: "Caller (call ended early)",
          phone: from, description: transcript.join("\n").slice(0, 3900),
          summary: "Grok backup line: the call ended before all details were saved. Transcript attached.",
        }), []);
      } catch (e) { log.error("[grok] partial lead failed", e.message); }
    }
  };

  const startGrok = () => {
    grok = new WebSocket(cfg.GROK_REALTIME_URL, { headers: { Authorization: `Bearer ${cfg.XAI_API_KEY}` } });
    grok.on("open", () => {
      const session = {
        voice: cfg.GROK_VOICE,
        instructions: buildInstructions(),
        turn_detection: { type: "server_vad" },
        audio: {
          input: { format: { type: "audio/pcmu" }, transcription: { model: "grok-transcribe" } },
          output: { format: { type: "audio/pcmu" } },
        },
        tools: TOOLS,
      };
      if (cfg.GROK_REASONING) session.reasoning = { effort: cfg.GROK_REASONING };
      toGrok({ type: "session.update", session });
      toGrok({ type: "conversation.item.create", item: { type: "force_message", role: "assistant", content: [{ type: "output_text", text: cfg.FIRST_MESSAGE }] } });
      transcript.push(`Agent: ${cfg.FIRST_MESSAGE}`);
      ready = true;
      for (const p of early.splice(0)) toGrok({ type: "input_audio_buffer.append", audio: p });
    });
    grok.on("message", async (raw) => {
      let ev; try { ev = JSON.parse(String(raw)); } catch { return; }
      switch (ev.type) {
        case "response.output_audio.delta":
        case "response.audio.delta":
          if (streamSid && ev.delta) toTwilio({ event: "media", streamSid, media: { payload: ev.delta } });
          break;
        case "input_audio_buffer.speech_started": // barge-in
          if (streamSid) toTwilio({ event: "clear", streamSid });
          break;
        case "response.output_audio_transcript.done":
          if (ev.transcript) transcript.push(`Agent: ${ev.transcript}`);
          break;
        case "conversation.item.input_audio_transcription.updated": // cumulative per item
        case "conversation.item.input_audio_transcription.completed":
          if (ev.transcript) {
            const k = ev.item_id || `n${transcript.length}`;
            if (callerLine.has(k)) transcript[callerLine.get(k)] = `Caller: ${ev.transcript}`;
            else { callerLine.set(k, transcript.length); transcript.push(`Caller: ${ev.transcript}`); }
          }
          break;
        case "response.function_call_arguments.done": {
          let args = {}; try { args = JSON.parse(ev.arguments || "{}"); } catch {}
          let output = { ok: true };
          if (ev.name === "save_lead") {
            try {
              const r = await intake(agentLead({ ...args, conversation_id: `grok-${callSid}`, caller_phone: from, channel: "phone" }), []);
              leadSaved = true;
              output = { ok: true, saved: !!r.id || !!r.duplicate, message: "Lead saved. Tell the caller our team will call them back." };
            } catch (e) {
              log.error("[grok] save_lead failed", e.message);
              output = { ok: false, message: "Could not save. Keep taking details; our team still gets the call record." };
            }
          } else if (ev.name === "end_call") {
            hangupPending = true;
            if (streamSid) toTwilio({ event: "mark", streamSid, mark: { name: "hangup" } });
            else finish("end_call");
            setTimeout(() => finish("end_call timeout"), 8000);
          }
          toGrok({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) } });
          if (!hangupPending) {
            // Let queued audio finish before the next turn, so replies don't overlap.
            if (!streamSid) toGrok({ type: "response.create" });
            else {
              const name = `tool-${++markN}`;
              let done = false;
              const go = () => { if (done) return; done = true; pendingMarks.delete(name); toGrok({ type: "response.create" }); };
              pendingMarks.set(name, go);
              toTwilio({ event: "mark", streamSid, mark: { name } });
              setTimeout(go, 4000);
            }
          }
          break;
        }
        case "error":
          log.error(`[grok] call=${callSid} error`, JSON.stringify(ev.error || ev).slice(0, 300));
          break;
      }
    });
    grok.on("close", (code) => finish(`grok closed ${code}`));
    grok.on("error", (e) => { log.error(`[grok] ws error ${e.message}`); finish("grok error"); });
  };

  twilio.on("message", (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.event === "start") {
      streamSid = m.start.streamSid; callSid = m.start.callSid;
      const p = m.start.customParameters || {};
      from = p.from || "";
      if (!cfg.XAI_API_KEY || !checkStreamToken(cfg.STREAM_SECRET, callSid, p.t)) {
        log.error(`[grok] rejected stream call=${callSid}`);
        return finish("bad token or no key");
      }
      maxTimer = setTimeout(() => finish("max duration"), cfg.MAX_CALL_SECS * 1000);
      startGrok();
    } else if (m.event === "media" && m.media?.payload) {
      if (ready) toGrok({ type: "input_audio_buffer.append", audio: m.media.payload });
      else if (early.length < 100) early.push(m.media.payload);
    } else if (m.event === "mark") {
      const n = m.mark?.name;
      if (n === "hangup" && hangupPending) finish("end_call");
      else if (pendingMarks.has(n)) pendingMarks.get(n)();
    } else if (m.event === "stop") finish("twilio stop");
  });
  twilio.on("close", () => finish("twilio closed"));
}
