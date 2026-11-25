// Phone-forward lead upsert for 318-712-TREE.
// Used by firewood.delivery's /api/3bs/forward webhook (not the Camille AI).
// Every inbound call is stored as source=phone. Team email is sent when notify
// is true (missed / voicemail / canceled) or when the call was answered.
// Answered-call mail is a short team-only alert (no customer email or text).
export const CALL_STATUSES = ["ringing", "answered", "missed", "voicemail", "canceled", "failed"];

export function e164ish(phone) {
  const d = String(phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `+1${d}` : null;
}

export function callLabel(status, duration, voicemailUrl) {
  const s = String(status || "");
  if (s === "answered") {
    const sec = Number(duration);
    return Number.isFinite(sec) && sec > 0 ? `Answered, ${sec}s` : "Answered";
  }
  if (s === "voicemail") return voicemailUrl ? "Missed – voicemail left" : "Missed – voicemail (no recording)";
  if (s === "missed" || s === "canceled") return voicemailUrl ? "Missed – voicemail left" : "Missed";
  if (s === "failed") return "Failed to connect";
  if (s === "ringing") return "Ringing";
  return s || "";
}


/** Human talk time for an answered-call alert, or null if unknown. */
export function formatTalkTime(duration) {
  if (duration == null || duration === "") return null;
  const sec = Math.round(Number(duration));
  if (!Number.isFinite(sec) || sec < 0) return null;
  if (sec < 60) return sec === 1 ? "1 second" : `${sec} seconds`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const min = m === 1 ? "1 minute" : `${m} minutes`;
  if (s === 0) return min;
  return `${min} ${s === 1 ? "1 second" : `${s} seconds`}`;
}

/** Send a team alert once: on notify (missed/voicemail/canceled) or when Blake answered. */
export function shouldSendPhoneTeamEmail({ notify, callStatus, alreadyEmailed } = {}) {
  if (alreadyEmailed) return false;
  if (String(callStatus || "").toLowerCase() === "answered") return true;
  return notify === true;
}

export function phoneCallSourceDetail({ callSid, status, test } = {}) {
  const parts = ["318-712-TREE", "forwarded to cell"];
  if (status) parts.push(`status=${status}`);
  if (test) parts.push("source=test");
  if (callSid) parts.push(`call ${String(callSid).slice(0, 80)}`);
  return parts.join(" · ").slice(0, 400);
}

/** Build the lead fields for an upsert. Does not touch the database. */
export function phoneCallLead(body = {}) {
  const phone = e164ish(body.phone || body.From || body.caller_phone) || String(body.phone || body.From || "").trim() || null;
  const callSid = String(body.conversation_id || body.CallSid || "").trim();
  const status = CALL_STATUSES.includes(String(body.call_status || "").toLowerCase())
    ? String(body.call_status).toLowerCase()
    : null;
  const duration = Number(body.duration ?? body.call_duration_seconds);
  const voicemailUrl = String(body.voicemail_url || "").trim() || null;
  const testHint = body.test === true || /\btest\b/i.test(String(body.source_detail || ""));
  const summary = String(body.summary || callLabel(status, duration, voicemailUrl) || "").slice(0, 2000) || null;
  return {
    source: "phone",
    source_detail: phoneCallSourceDetail({ callSid, status, test: testHint }).slice(0, 400),
    external_id: callSid ? `phone:${callSid.slice(0, 100)}` : null,
    phone,
    name: String(body.name || "").trim().slice(0, 120) || null,
    call_status: status,
    call_duration_seconds: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    voicemail_url: voicemailUrl && /^https:\/\//i.test(voicemailUrl) ? voicemailUrl.slice(0, 500) : null,
    call_summary: summary,
    description: voicemailUrl && /^https:\/\//i.test(voicemailUrl) ? `Voicemail: ${voicemailUrl}`.slice(0, 4000) : null,
    raw: body,
  };
}
