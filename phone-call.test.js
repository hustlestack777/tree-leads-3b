import test from "node:test";
import assert from "node:assert/strict";
import { e164ish, callLabel, formatTalkTime, phoneCallLead, phoneCallSourceDetail, shouldSendPhoneTeamEmail } from "./phone-call.js";
import { buildAnsweredCallEmail, buildTeamEmail } from "./emails.js";

test("e164ish normalizes 10-digit and 1+10 numbers", () => {
  assert.equal(e164ish("337-555-0142"), "+13375550142");
  assert.equal(e164ish("+13375550142"), "+13375550142");
  assert.equal(e164ish("1 (337) 555-0142"), "+13375550142");
  assert.equal(e164ish("555"), null);
});

test("phoneCallLead is source=phone and keys off CallSid", () => {
  const lead = phoneCallLead({
    conversation_id: "CA123",
    phone: "+13375550142",
    call_status: "ringing",
    test: true,
  });
  assert.equal(lead.source, "phone");
  assert.equal(lead.external_id, "phone:CA123");
  assert.equal(lead.phone, "+13375550142");
  assert.equal(lead.call_status, "ringing");
  assert.match(lead.source_detail, /source=test/);
  assert.match(lead.source_detail, /318-712-TREE/);
  assert.doesNotMatch(lead.source_detail, /\+1\d{10}|\d{3}-\d{3}-\d{4}/);
});

test("voicemail URL is stored only for https links", () => {
  const ok = phoneCallLead({ conversation_id: "CA1", phone: "3375550142", call_status: "voicemail", voicemail_url: "https://api.twilio.com/recordings/RE1" });
  assert.equal(ok.voicemail_url, "https://api.twilio.com/recordings/RE1");
  assert.match(ok.description, /Voicemail: https:\/\/api\.twilio\.com\/recordings\/RE1/);
  const bad = phoneCallLead({ conversation_id: "CA1", phone: "3375550142", call_status: "voicemail", voicemail_url: "javascript:alert(1)" });
  assert.equal(bad.voicemail_url, null);
});

test("callLabel wording", () => {
  assert.equal(callLabel("answered", 47), "Answered, 47s");
  assert.equal(callLabel("voicemail", 0, "https://x"), "Missed – voicemail left");
  assert.equal(callLabel("missed"), "Missed");
  assert.equal(callLabel("canceled"), "Missed");
});

test("team email for a missed call uses Missed call subject and includes the voicemail link", () => {
  const lead = {
    source: "phone",
    phone: "+13375550142",
    call_status: "voicemail",
    call_duration_seconds: 12,
    voicemail_url: "https://api.twilio.com/recordings/RE1",
    call_summary: "Missed – voicemail left",
    created_at: "2026-11-23T18:00:00Z",
    id: "lead-test-1",
    test: true,
  };
  const e = buildTeamEmail(lead);
  assert.match(e.subject, /TEST – /);
  assert.match(e.subject, /Missed call: \+13375550142/);
  assert.match(e.text, /Voicemail: https:\/\/api\.twilio\.com\/recordings\/RE1/);
  assert.match(e.text, /Call result: voicemail \(12s\)/);
  assert.match(e.text, /Came in through: Phone call/);
  assert.doesNotMatch(e.subject + e.text + e.html, /AI assistant|Camille/);
  assert.doesNotMatch(e.subject + e.text + e.html, /4046/);
});

test("source detail never includes a personal number", () => {
  const d = phoneCallSourceDetail({ callSid: "CA9", status: "answered", test: false });
  assert.doesNotMatch(d, /\+1\d{10}/);
  assert.doesNotMatch(d, /Camille|AI/);
});

test("formatTalkTime", () => {
  assert.equal(formatTalkTime(1), "1 second");
  assert.equal(formatTalkTime(47), "47 seconds");
  assert.equal(formatTalkTime(75), "1 minute 15 seconds");
  assert.equal(formatTalkTime(120), "2 minutes");
  assert.equal(formatTalkTime(null), null);
});

test("shouldSendPhoneTeamEmail emails answered calls even when notify is false", () => {
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "answered", alreadyEmailed: false }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "answered", alreadyEmailed: false }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "ringing", alreadyEmailed: false }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "missed", alreadyEmailed: false }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "canceled", alreadyEmailed: false }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "voicemail", alreadyEmailed: true }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "answered", alreadyEmailed: true }), false);
});

test("answered-call team email has time, caller, Blake answered, and talk time; no customer copy", () => {
  const e = buildAnsweredCallEmail({
    phone: "+13375550142",
    call_status: "answered",
    call_duration_seconds: 47,
    created_at: "2026-11-23T18:53:33Z",
    test: true,
    email: "customer@example.com",
  });
  assert.match(e.subject, /^TEST – Blake answered: \+13375550142$/);
  assert.match(e.text, /Time: Nov 23, 2026, 12:53 PM CT/);
  assert.match(e.text, /Caller: \+13375550142/);
  assert.match(e.text, /Result: Blake answered/);
  assert.match(e.text, /Talk time: 47 seconds/);
  assert.match(e.text, /No customer email or text was sent/);
  assert.match(e.html, /Blake answered/);
  assert.doesNotMatch(e.subject + e.text + e.html, /New lead|We got your tree request|call you back with a price|4046/);
});

test("answered-call email omits talk time when duration is missing", () => {
  const e = buildAnsweredCallEmail({
    phone: "+13374059945",
    call_status: "answered",
    created_at: "2026-11-23T18:53:33Z",
  });
  assert.equal(e.subject, "Blake answered: +13374059945");
  assert.doesNotMatch(e.text, /Talk time:/);
  assert.doesNotMatch(e.subject, /TEST/);
});
