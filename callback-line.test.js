import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomerEmail } from "./emails.js";

const base = { source: "phone", name: "Jane Doe", email: "jane@example.com", town: "DeRidder", created_at: new Date().toISOString(), id: "x" };

test("customer email uses the locked callback line, never 'soon'", () => {
  for (const lead of [base, { ...base, best_day: "Tuesday", best_time: "afternoon" }]) {
    const e = buildCustomerEmail(lead);
    for (const body of [e.text, e.html]) {
      assert.match(body, /our team will call you back with a price/);
      assert.doesNotMatch(body, /call you back soon/);
    }
  }
  assert.match(buildCustomerEmail({ ...base, best_day: "Tuesday" }).text, /call you back with a price at the time you picked\./);
});
