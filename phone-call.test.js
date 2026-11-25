import test from "node:test";
import assert from "node:assert/strict";
import { e164ish, callLabel, formatTalkTime, phoneCallLead, phoneCallSourceDetail, shouldSendPhoneTeamEmail, safeRecordingUrl } from "./phone-call.js";
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

test("shouldSendPhoneTeamEmail waits for sendTeamEmail on answered calls", () => {
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "answered", alreadyEmailed: false }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "answered", alreadyEmailed: false, sendTeamEmail: true }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "answered", alreadyEmailed: false, sendTeamEmail: true }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "ringing", alreadyEmailed: false }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "missed", alreadyEmailed: false }), true);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "canceled", alreadyEmailed: false }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: true, callStatus: "voicemail", alreadyEmailed: true }), false);
  assert.equal(shouldSendPhoneTeamEmail({ notify: false, callStatus: "answered", alreadyEmailed: true, sendTeamEmail: true }), false);
});

test("safeRecordingUrl allows only signed firewood listen links", () => {
  assert.match(
    safeRecordingUrl("https://firewood.delivery/api/3bs/recordings/REaabbccddeeff00112233445566778899?exp=1&sig=abc"),
    /^https:\/\/firewood\.delivery\/api\/3bs\/recordings\//,
  );
  assert.equal(safeRecordingUrl("https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx"), null);
  assert.equal(safeRecordingUrl("https://evil.example/api/3bs/recordings/RExx"), null);
  assert.equal(safeRecordingUrl("javascript:alert(1)"), null);
});

test("answered-call team email has time, caller, Blake answered, talk time, recording, and transcript; no customer copy", () => {
  const listen = "https://firewood.delivery/api/3bs/recordings/REaabbccddeeff00112233445566778899?exp=1&sig=abc";
  const e = buildAnsweredCallEmail({
    phone: "+13375550142",
    call_status: "answered",
    call_duration_seconds: 47,
    created_at: "2026-11-23T18:53:33Z",
    test: true,
    email: "customer@example.com",
    recording_url: listen,
    call_transcript: "Speaker 1: Hi, this is about a tree in Pineville.",
  });
  assert.match(e.subject, /^TEST – Blake answered: \+13375550142$/);
  assert.match(e.text, /Time: Nov 23, 2026, 12:53 PM CT/);
  assert.match(e.text, /Caller: \+13375550142/);
  assert.match(e.text, /Result: Blake answered/);
  assert.match(e.text, /Talk time: 47 seconds/);
  assert.match(e.text, /Recording: https:\/\/firewood\.delivery\/api\/3bs\/recordings\/REaabbccddeeff00112233445566778899/);
  assert.match(e.text, /Transcript: Speaker 1: Hi, this is about a tree in Pineville\./);
  assert.match(e.html, /Listen to recording/);
  assert.match(e.html, /href="https:\/\/firewood\.delivery\/api\/3bs\/recordings\/REaabbccddeeff00112233445566778899/);
  assert.match(e.text, /No customer email or text was sent/);
  assert.match(e.html, /Blake answered/);
  assert.doesNotMatch(e.subject + e.text + e.html, /New lead|We got your tree request|call you back with a price|4046|api\.twilio\.com|AuthToken/);
});

test("answered-call email says recording and transcript are not available when missing", () => {
  const e = buildAnsweredCallEmail({
    phone: "+13375550142",
    call_status: "answered",
    call_duration_seconds: 16,
    created_at: "2026-11-23T18:53:33Z",
  });
  assert.match(e.text, /Recording: not available/);
  assert.match(e.text, /Transcript: not available/);
  assert.doesNotMatch(e.html, /Listen to recording/);
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

test("phoneCallLead keeps a signed firewood recording link and drops raw Twilio media URLs", () => {
  const ok = phoneCallLead({
    conversation_id: "CA99",
    phone: "+13375550142",
    call_status: "answered",
    recording_url: "https://firewood.delivery/api/3bs/recordings/REaabbccddeeff00112233445566778899?exp=1&sig=abc",
    transcript: "Speaker 1: Hello",
  });
  assert.match(ok.recording_url, /^https:\/\/firewood\.delivery\/api\/3bs\/recordings\//);
  assert.equal(ok.call_transcript, "Speaker 1: Hello");
  const bad = phoneCallLead({
    conversation_id: "CA99",
    phone: "+13375550142",
    call_status: "answered",
    recording_url: "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RE1.mp3",
  });
  assert.equal(bad.recording_url, null);
});
