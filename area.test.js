import test from "node:test";
import assert from "node:assert/strict";
import { areaFlag } from "./area.js";
import { buildTeamEmail, buildCustomerEmail } from "./emails.js";

const lead = (x) => ({ source: "web", name: "Jane Doe", phone: "3375550100", email: "jane@example.com", created_at: new Date().toISOString(), id: "x", ...x });

test("main-area towns are not flagged", () => {
  for (const [lat, lon] of [[30.8463, -93.2891], [31.1435, -93.261], [31.3113, -92.4451], [30.2224, -92.6571], [30.816, -92.6604], [31.5688, -93.4843]]) {
    assert.equal(areaFlag({ lat, lon }).status, "main");
  }
  assert.equal(areaFlag({ town: "Leesville" }).status, "main");
});

test("next parish over still makes a lead, flagged outside main area for Blake", () => {
  const cases = [
    lead({ address: "1 Main St, Lake Charles, LA", town: "Lake Charles", lat: 30.2266, lon: -93.2174 }),
    lead({ address: "1 Front St, Natchitoches, LA", town: "Natchitoches", lat: 31.7607, lon: -93.0863 }),
    lead({ address: "1 Main St, Sulphur, LA", town: "Sulphur", lat: 30.2366, lon: -93.3774 }),
    lead({ address: "1 Main St, Marksville, LA", town: "Marksville", lat: 31.1279, lon: -92.0662 }),
    lead({ address: "1 Main St, Ville Platte, LA", town: "Ville Platte", lat: 30.6891, lon: -92.2715 }),
    lead({ source: "phone", address: "Lake Charles", town: "Lake Charles" }),
  ];
  for (const l of cases) {
    assert.equal(areaFlag(l).status, "outside", l.town);
    const team = buildTeamEmail(l);
    assert.match(team.subject, /\[Outside main area\]$/);
    assert.match(team.text, /^Area: Outside main area.*Blake decides\.$/m);
    const cust = buildCustomerEmail(l);
    assert.match(cust.text, /our team will call you back with a price/);
    assert.doesNotMatch(cust.text + cust.html, /outside|don't serve|do not serve|not serve|main area/i);
  }
});
