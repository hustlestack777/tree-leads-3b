/* Server-side ballpark ranges for the 3 B's quote form.
   No prices live in this repo. Blake's numbers come from the TREE_PRICING_JSON
   environment variable on Render, and the range width comes from RANGE_MARKUP
   (0.15 = 15%). The range is only returned after the contact form is sent.

   Rules (Shaun approved 11/11 10:13 PM CT):
   - Blake's tree prices are PRUNING / TRIMMING only.
   - Tree removal has no price yet, so removal jobs get no range and a callback quote.
   - Each option (no cleanup, with cleanup) gets its own range. It starts at Blake's
     price for that option. The top is his price plus the size's markup, rounded to the
     nearest roundTo (default $50). Markups are env settings: RANGE_MARKUP_SMALL (0.25),
     RANGE_MARKUP_MEDIUM (0.35), RANGE_MARKUP_LARGE (0.35).
   - Tight-access add-ons go on top ("we'll confirm on the call").
   - Removals, stumps, storm cleanup and dirt work: no range, "call for a ballpark." */

const CALLBACK_LABELS = { emergency: "Storm cleanup", dirt: "Skid steer dirt work", clearing: "Lot or land clearing", grading: "Grading or leveling", pad: "House pad or driveway pad", drainage: "Drainage or ditch work", haul: "Debris haul-off", other: "Other work" };
const DEFAULT_MARKUP = 0.15;
const DEFAULT_ROUND = 50;

export function loadPricing(env = process.env) {
  const raw = env.TREE_PRICING_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function markupFrom(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : fallback;
}

export function rangeMarkup(env = process.env) {
  return markupFrom(env.RANGE_MARKUP, DEFAULT_MARKUP);
}

/** Per-size markups for pruning. */
export function sizeMarkups(env = process.env) {
  return {
    small: markupFrom(env.RANGE_MARKUP_SMALL, 0.25),
    medium: markupFrom(env.RANGE_MARKUP_MEDIUM, 0.35),
    large: markupFrom(env.RANGE_MARKUP_LARGE, 0.35),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundHigh(amount, markup, roundTo) {
  const step = num(roundTo) > 0 ? num(roundTo) : DEFAULT_ROUND;
  const high = Math.round((amount * (1 + markup)) / step) * step;
  return Math.max(high, Math.round(amount));
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** items: [{kind:"tree", heightFt} | {kind:"stump", diameterIn}], jobTypes: ["trim","removal",...] */
/** markups: { sizes: {small, medium, large}, other } */
export function computeBallpark(input, pricing, markups) {
  const types = new Set((Array.isArray(input && input.jobTypes) ? input.jobTypes : []).map(String));
  const items = Array.isArray(input && input.items) ? input.items.slice(0, 40) : [];
  const emergency = Boolean(input && input.stormUrgent);
  const trees = items.filter((m) => m && m.kind === "tree");
  const stumps = items.filter((m) => m && m.kind === "stump");
  const lines = [];

  // Removals (and storm-damaged trees that aren't a trim) get a callback quote, no range.
  const removal = types.has("removal") || (trees.length > 0 && !types.has("trim") && types.has("emergency"));
  if (removal) {
    trees.forEach((t, i) => lines.push({ label: `Tree removal ${i + 1}`, callback: true }));
    stumps.forEach((s, i) => lines.push({ label: `Stump grinding ${i + 1}`, callback: true }));
    ["clearing", "grading", "pad", "drainage", "haul", "other", "dirt", "emergency"].forEach((t) => { if (types.has(t)) lines.push({ label: CALLBACK_LABELS[t], callback: true }); });
    return { range: null, callback: true, reason: "removal", lines };
  }

  if (!pricing) {
    return { range: null, callback: true, reason: "unavailable", lines: [] };
  }

  const roundTo = pricing.roundTo;
  const sizes = (markups && markups.sizes) || sizeMarkups({});
  const otherMarkup = markups && Number.isFinite(markups.other) ? markups.other : DEFAULT_MARKUP;
  const emergencyMult = emergency && num(pricing.stormEmergencyMult) > 0 ? num(pricing.stormEmergencyMult) : 1;
  let callForBallpark = false;
  // Pruning: two options, each its own range.
  const opt = { noCleanup: { low: 0, high: 0 }, withCleanup: { low: 0, high: 0 } };
  let prunedTrees = 0;

  if (types.has("trim")) {
    const bands = (pricing.pruning && pricing.pruning.bands) || [];
    trees.forEach((t, i) => {
      const h = clampInt(t.heightFt, 5, 200, 40);
      const band = bands.find((b) => h <= num(b.maxFt)) || bands[bands.length - 1];
      if (!band || band.callForBallpark || band.price == null) {
        callForBallpark = true;
        lines.push({ label: `Trim tree ${i + 1} · ~${h} ft${band && band.label ? " · " + band.label : ""}`, callForBallpark: true });
        return;
      }
      const markup = Number.isFinite(sizes[band.key]) ? sizes[band.key] : otherMarkup;
      let mult = emergencyMult;
      if (t.nearHouse && num(pricing.nearStructure) > 0) mult *= num(pricing.nearStructure);
      if (t.nearLines && num(pricing.nearLines) > 0) mult *= num(pricing.nearLines);
      const base = num(band.price);
      const clean = band.cleanupPrice != null ? num(band.cleanupPrice) : base;
      // Range comes from Blake's own price; tight access / storm go on top of both ends.
      const extra = (p) => Math.round(p * mult) - p;
      opt.noCleanup.low += base + extra(base);
      opt.noCleanup.high += roundHigh(base, markup, roundTo) + extra(base);
      opt.withCleanup.low += clean + extra(clean);
      opt.withCleanup.high += roundHigh(clean, markup, roundTo) + extra(clean);
      prunedTrees += 1;
      lines.push({ label: `Trim tree ${i + 1} · ~${h} ft · ${band.label || ""}`.trim() + (mult !== 1 ? " · access/storm add-on, we'll confirm on the call" : "") });
    });
  }

  // Only pruning has Blake-approved ranges. Stumps, storm cleanup and dirt work are
  // "call for a ballpark" (Shaun, 11/11 10:20 PM CT).
  const addOn = 0;
  stumps.forEach((st, i) => {
    const d = clampInt(st.diameterIn, 2, 120, 18);
    lines.push({ label: `Stump grinding ${i + 1} · ${d}"`, callForBallpark: true });
  });
  if (stumps.length) callForBallpark = true;
  Object.keys(CALLBACK_LABELS).forEach((t) => {
    if (types.has(t)) { lines.push({ label: CALLBACK_LABELS[t], callForBallpark: true }); callForBallpark = true; }
  });

  if (prunedTrees) {
    const options = [
      { id: "no-cleanup", label: "Trimming, no cleanup", low: opt.noCleanup.low + addOn, high: opt.noCleanup.high + addOn },
      { id: "with-cleanup", label: "Trimming with cleanup", low: opt.withCleanup.low + addOn, high: opt.withCleanup.high + addOn },
    ];
    return {
      range: { low: options[0].low, high: options[1].high },
      options,
      addOns: addOn > 0,
      callback: false,
      callForBallpark,
      lines,
    };
  }
  return { range: null, callback: true, reason: callForBallpark ? "call" : "none", lines };
}
