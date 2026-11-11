// Offline test of the Grok backup: mock ElevenLabs, mock Grok realtime, fake Twilio. No network, no keys.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("router, failover and Grok bridge", async () => {
  // Mock ElevenLabs inbound_call: healthy unless ?fail.
  let elMode = "ok";
  const el = http.createServer((req, res) => {
    if (elMode === "down") { res.writeHead(503); return res.end("down"); }
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream track="inbound_track" url="wss://api.us.elevenlabs.io/v1/convai/conversation"><Parameter name="conversation_id" value="conv_x" /></Stream></Connect></Response>');
  });
  const elPort = await listen(el);

  // Mock Grok realtime.
  const grokSeen = { session: null, audioIn: 0, auth: null, items: [] };
  const grokHttp = http.createServer();
  const gwss = new WebSocketServer({ server: grokHttp });
  gwss.on("connection", (ws, req) => {
    grokSeen.auth = req.headers.authorization;
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "session.update") grokSeen.session = m.session;
      if (m.type === "conversation.item.create") grokSeen.items.push(m.item);
      if (m.type === "input_audio_buffer.append") {
        grokSeen.audioIn++;
        if (grokSeen.audioIn === 3) {
          ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: Buffer.from([0xff, 0x7f]).toString("base64") }));
          ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "I got a big oak" }));
          ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.updated", item_id: "u1", transcript: "I got a big oak leaning on my shed" }));
          ws.send(JSON.stringify({ type: "response.function_call_arguments.done", name: "save_lead", call_id: "c1", arguments: JSON.stringify({ name: "Leaky Lindsay", phone: "3185550100", description: "Big oak leaning on shed", ballpark_low: 700, ballpark_high: 1500 }) }));
        }
        if (grokSeen.audioIn === 6) ws.send(JSON.stringify({ type: "response.function_call_arguments.done", name: "end_call", call_id: "c2", arguments: "{}" }));
      }
    });
  });
  const grokPort = await listen(grokHttp);

  Object.assign(process.env, {
    XAI_API_KEY: "test-key", GROK_REALTIME_URL: `ws://127.0.0.1:${grokPort}`, EL_INBOUND_URL: `http://127.0.0.1:${elPort}/twilio/inbound_call`,
    STREAM_SECRET: "s3cret", EL_MIN_SECS: "2", TWILIO_AUTH_TOKEN: "",
  });
  const { registerVoice } = await import("../voice.js");
  const leads = [];
  const app = express();
  const srv = http.createServer(app);
  const port = await listen(srv);
  const base = `http://127.0.0.1:${port}`;
  registerVoice(app, srv, { intake: async (l) => { leads.push(l); return { id: "lead1" }; }, agentLead: (b) => b, publicUrl: () => base, log: { log() {}, error() {} } });
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }).then((r) => r.text());

  // 1. ElevenLabs healthy: its TwiML comes back with our action added.
  let t = await post("/twilio/voice", { CallSid: "CA1", From: "+13185550100", To: "+13187128733" });
  assert.match(t, /<Connect action="http:\/\/127\.0\.0\.1:\d+\/twilio\/el-ended" method="POST"><Stream/);
  assert.match(t, /convai\/conversation/);

  // 2. Stream ended almost at once (no credits): roll to Grok.
  t = await post("/twilio/el-ended", { CallSid: "CA1", From: "+13185550100" });
  assert.match(t, /\/twilio\/grok-stream/);
  // 2b. A long ElevenLabs call that ends normally just hangs up.
  await post("/twilio/voice", { CallSid: "CA2", From: "+13185550100" });
  await wait(2100);
  assert.match(await post("/twilio/el-ended", { CallSid: "CA2" }), /<Hangup\/>/);

  // 3. ElevenLabs down: straight to Grok. Fallback URL too.
  elMode = "down";
  assert.match(await post("/twilio/voice", { CallSid: "CA3", From: "+1" }), /grok-stream/);
  assert.match(await post("/twilio/fallback", { CallSid: "CA3", From: "+1" }), /grok-stream/);

  // 4. Bridge: fake Twilio media stream using the token from the Grok TwiML.
  const tok = /name="t" value="([^"]+)"/.exec(t)[1];
  const tw = new WebSocket(`ws://127.0.0.1:${port}/twilio/grok-stream`);
  const fromBridge = [];
  tw.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    fromBridge.push(m);
    if (m.event === "mark") tw.send(JSON.stringify({ event: "mark", streamSid: "MZ1", mark: { name: m.mark.name } })); // playback done
  });
  await new Promise((r) => tw.on("open", r));
  tw.send(JSON.stringify({ event: "start", start: { streamSid: "MZ1", callSid: "CA1", customParameters: { t: tok, from: "+13185550100" } } }));
  const closed = new Promise((r) => tw.on("close", r));
  for (let i = 0; i < 8; i++) { tw.send(JSON.stringify({ event: "media", media: { payload: Buffer.alloc(160, 0xff).toString("base64") } })); await wait(60); }
  await Promise.race([closed, wait(4000)]);

  assert.equal(grokSeen.auth, "Bearer test-key");
  assert.equal(grokSeen.session.voice, "ara");
  assert.equal(grokSeen.session.audio.input.format.type, "audio/pcmu");
  assert.equal(grokSeen.session.audio.output.format.type, "audio/pcmu");
  assert.deepEqual(grokSeen.session.tools.map((x) => x.name), ["save_lead", "end_call"]);
  assert.match(grokSeen.session.instructions, /Central & Southwest Louisiana/);
  assert.match(grokSeen.session.instructions, /Southern woman/);
  assert.match(grokSeen.session.instructions, /SHARED knowledge/);
  assert.equal(grokSeen.items[0].type, "force_message");
  assert.ok(grokSeen.audioIn >= 6, "caller audio reached Grok");
  assert.ok(fromBridge.some((m) => m.event === "media" && m.streamSid === "MZ1"), "Grok audio reached Twilio");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].conversation_id, "grok-CA1");
  assert.equal(leads[0].caller_phone, "+13185550100");
  assert.equal(leads[0].channel, "phone");
  assert.equal(tw.readyState, WebSocket.CLOSED, "end_call hung up");

  // 5. A stream with a bad token is refused.
  const bad = new WebSocket(`ws://127.0.0.1:${port}/twilio/grok-stream`);
  await new Promise((r) => bad.on("open", r));
  const badClosed = new Promise((r) => bad.on("close", r));
  bad.send(JSON.stringify({ event: "start", start: { streamSid: "MZ9", callSid: "CA9", customParameters: { t: "1.nope" } } }));
  await Promise.race([badClosed, wait(2000)]);
  assert.equal(bad.readyState, WebSocket.CLOSED);

  for (const s of [srv, el, grokHttp]) s.close();
  gwss.close();
});

test("no key: polite message, no stream", async () => {
  const { grokTwiml, voiceConfig } = await import("../voice.js");
  const cfg = { ...voiceConfig(), XAI_API_KEY: "" };
  const t = grokTwiml(cfg, "https://x.example", "CA1", "+1");
  assert.match(t, /<Say>/);
  assert.doesNotMatch(t, /Stream/);
  assert.doesNotMatch(t, /\bfree\b|insured|text/i);
});

test("Twilio signature is enforced when TWILIO_AUTH_TOKEN is set", async () => {
  process.env.TWILIO_AUTH_TOKEN = "tok123";
  process.env.XAI_API_KEY = "k";
  const { registerVoice, twilioSignature } = await import("../voice.js");
  const app = express();
  const srv = http.createServer(app);
  const port = await listen(srv);
  const base = `http://127.0.0.1:${port}`;
  registerVoice(app, srv, { intake: async () => ({}), agentLead: (b) => b, publicUrl: () => base, log: { log() {}, error() {} } });
  const params = { CallSid: "CA5", From: "+13185550100" };
  const send = (sig) => fetch(base + "/twilio/fallback", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(sig ? { "X-Twilio-Signature": sig } : {}) }, body: new URLSearchParams(params) });
  assert.equal((await send(null)).status, 403);
  assert.equal((await send(twilioSignature("tok123", base + "/twilio/fallback", params))).status, 200);
  srv.close();
  process.env.TWILIO_AUTH_TOKEN = "";
});
