import test from "node:test";
import assert from "node:assert/strict";
import { campaignLabel, buildTeamEmail } from "./emails.js";

const web = (detail) => ({ source: "web", source_detail: detail, name: "Jane", town: "DeRidder", created_at: new Date().toISOString(), id: "x" });

test("organic reel link via src", () => {
  const l = web("/?src=fbreel1122 · src=fbreel1122 · v=a");
  assert.equal(campaignLabel(l), "FB reel Nov 22");
  const e = buildTeamEmail(l);
  assert.match(e.text, /^Source: FB reel Nov 22$/m);
  assert.match(e.subject, /\[FB reel Nov 22\]$/);
});
test("utm link", () => {
  assert.equal(campaignLabel(web("/?utm_source=facebook&utm_medium=reel&utm_campaign=blake_reel_nov22 · src=lrl · v=a · utm_source=facebook&utm_medium=reel&utm_campaign=blake_reel_nov22")), "FB reel Nov 22");
});
test("boost link", () => {
  assert.equal(campaignLabel(web("/?src=fbboost1122&utm_source=facebook&utm_medium=paid_social&utm_campaign=blake_reel_nov22 · src=fbboost1122 · v=a")), "FB reel Nov 22 (boost)");
});
test("no campaign = no Source row, subject unchanged", () => {
  const l = web("/ · src=lrl · v=a");
  assert.equal(campaignLabel(l), "");
  const e = buildTeamEmail(l);
  assert.doesNotMatch(e.text, /^Source:/m);
  assert.equal(e.subject, "New lead: Jane – DeRidder");
});
test("phone lead untouched", () => {
  assert.equal(campaignLabel({ source: "phone", source_detail: "318-712-TREE" }), "");
});
