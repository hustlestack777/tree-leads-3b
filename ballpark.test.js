import test from "node:test";
import assert from "node:assert/strict";
import { computeBallpark, rangeMarkup, sizeMarkups } from "./ballpark.js";

// Made-up numbers only. Blake's real prices live in Render env vars, never in this repo.
const fake = {
  roundTo: 10,
  pruning: { bands: [{ key: "small", maxFt: 30, price: 100, cleanupPrice: 140, label: "Small" }, { maxFt: 999, callForBallpark: true, label: "Very large" }] },
  stumps: { bands: [{ maxIn: 999, price: 40 }] }
};
const m = { sizes: { small: 0.2, medium: 0.3, large: 0.3 }, other: 0.1 };

test("trim: each option starts at Blake's price, top is price plus the size markup", () => {
  const r = computeBallpark({ jobTypes: ["trim"], items: [{ kind: "tree", heightFt: 20 }] }, fake, m);
  assert.deepEqual(r.options.map((o) => [o.low, o.high]), [[100, 120], [140, 170]]);
});

test("stumps are call for a ballpark, pruning range unchanged", () => {
  const r = computeBallpark({ jobTypes: ["trim", "stump"], items: [{ kind: "tree", heightFt: 20 }, { kind: "stump", diameterIn: 10 }] }, fake, m);
  assert.deepEqual(r.options.map((o) => [o.low, o.high]), [[100, 120], [140, 170]]);
  assert.equal(r.callForBallpark, true);
  assert.equal(computeBallpark({ jobTypes: ["stump"], items: [{ kind: "stump", diameterIn: 10 }] }, fake, m).range, null);
});

test("removal gets no range and a callback", () => {
  const r = computeBallpark({ jobTypes: ["removal"], items: [{ kind: "tree", heightFt: 20 }] }, fake, m);
  assert.equal(r.range, null);
  assert.equal(r.reason, "removal");
});

test("no pricing configured gives no range", () => {
  assert.equal(computeBallpark({ jobTypes: ["trim"], items: [{ kind: "tree", heightFt: 20 }] }, null, m).range, null);
});

test("markup settings", () => {
  assert.deepEqual(sizeMarkups({ RANGE_MARKUP_SMALL: "0.3" }), { small: 0.3, medium: 0.35, large: 0.35 });
  assert.equal(rangeMarkup({}), 0.15);
});
