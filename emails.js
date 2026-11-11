import { config } from "./config.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const SOURCE_LABEL = { web: "Website form", phone: "Phone call", chat: "Website chat" };

export function ballparkText(lead) {
  const lo = Number(lead.ballpark_low), hi = Number(lead.ballpark_high);
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi >= lo) return `${money(lo)} – ${money(hi)}`;
  return "";
}

function chicago(d) {
  return new Date(d).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " CT";
}

/** Rows shown on both emails, only the ones actually filled in. */
function detailRows(lead, { internal }) {
  const rows = [
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["Address", lead.address],
    ["Town", lead.town],
    ["Work needed", lead.job_types],
    ["Trees / limbs", lead.tree_count],
    ["Stumps", lead.stump_count],
    ["Storm / urgent", lead.urgent ? "Yes" : ""],
    ["What's near it", lead.hazards],
    ["Access", lead.access],
    ["How soon", lead.how_soon],
    ["Best day to call", lead.best_day],
    ["Best time to call", lead.best_time],
    ["Description", lead.description],
    ["Photos", lead.photo_count ? `${lead.photo_count}` : ""],
  ];
  if (internal) {
    rows.push(["Ballpark given", ballparkText(lead) || "None yet (give one on the callback)"]);
    rows.push(["Ballpark breakdown", lead.breakdown]);
    rows.push(["Came in through", SOURCE_LABEL[lead.source] || lead.source]);
    rows.push(["Page / campaign", lead.source_detail]);
    rows.push(["Map", lead.map_url]);
    rows.push(["Call summary", lead.call_summary]);
    rows.push(["Received", chicago(lead.created_at)]);
    rows.push(["Lead ID", lead.id]);
  }
  return rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "");
}

function table(rows) {
  return `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font:15px/1.4 Arial,sans-serif;width:100%;max-width:560px">` +
    rows.map(([k, v]) => {
      const val = /^https?:\/\//.test(String(v)) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v).replace(/\n/g, "<br>");
      return `<tr><td style="border-bottom:1px solid #e5e5e5;color:#555;white-space:nowrap;vertical-align:top"><b>${esc(k)}</b></td><td style="border-bottom:1px solid #e5e5e5">${val}</td></tr>`;
    }).join("") + `</table>`;
}

const textRows = (rows) => rows.map(([k, v]) => `${k}: ${v}`).join("\n");

export function buildTeamEmail(lead, photoLinks = []) {
  const tag = lead.test ? "TEST – " : "";
  const urgent = lead.urgent ? "URGENT – " : "";
  const where = lead.town || lead.address || "no address";
  const subject = `${tag}${urgent}New tree lead (${SOURCE_LABEL[lead.source] || lead.source}): ${lead.name || "No name"} – ${where}`;
  const rows = detailRows(lead, { internal: true });
  const links = photoLinks.length
    ? `<p style="font:15px Arial,sans-serif"><b>Photos:</b> ${photoLinks.map((u, i) => `<a href="${esc(u)}">Photo ${i + 1}</a>`).join(" · ")} (also attached)</p>`
    : "";
  const call = lead.phone ? `<p><a href="tel:${esc(String(lead.phone).replace(/[^\d+]/g, ""))}" style="display:inline-block;background:#1f5130;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font:bold 15px Arial,sans-serif">Call ${esc(lead.name || "customer")}</a></p>` : "";
  const html = `<div style="font:15px/1.4 Arial,sans-serif;color:#222">
<h2 style="margin:0 0 8px">${esc(urgent)}New tree lead</h2>
${call}${table(rows)}${links}
<p style="color:#666;font-size:13px">Review the photos and the map, then call the customer back at their best time and confirm the real price.</p></div>`;
  const text = `${urgent}New tree lead\n\n${textRows(rows)}\n${photoLinks.length ? "\nPhotos:\n" + photoLinks.join("\n") + "\n" : ""}\nReview the photos and the map, then call the customer back at their best time and confirm the real price.`;
  return { subject, html, text };
}

export function buildCustomerEmail(lead) {
  const first = String(lead.name || "").trim().split(/\s+/)[0] || "there";
  const range = ballparkText(lead);
  const subject = `${lead.test ? "TEST – " : ""}We got your tree request – ${config.BUSINESS_NAME}`;
  const rows = detailRows(lead, { internal: false }).filter(([k]) => k !== "Email");
  const rangeHtml = range
    ? `<p style="font-size:17px"><b>Your ballpark range: ${esc(range)}</b></p><p>That's a ballpark, not a final price. We'll confirm your real price when we call you back.</p>`
    : `<p>We'll go over a ballpark price with you when we call you back.</p>`;
  const rangeText = range
    ? `Your ballpark range: ${range}\nThat's a ballpark, not a final price. We'll confirm your real price when we call you back.`
    : `We'll go over a ballpark price with you when we call you back.`;
  const html = `<div style="font:15px/1.5 Arial,sans-serif;color:#222;max-width:560px">
<p>Hi ${esc(first)},</p>
<p>Thanks for reaching out to ${esc(config.BUSINESS_NAME)}. We got your request, and our team will call you back${lead.best_day || lead.best_time ? " at the time you picked" : " soon"}.</p>
${rangeHtml}
<p><b>Here's what you sent us:</b></p>
${table(rows)}
<p>Anything to add or change? Just reply to this email, or call us at <a href="tel:${config.PHONE_TEL}">${esc(config.PHONE_DISPLAY)}</a>.</p>
<p>${esc(config.BUSINESS_NAME)}<br>Serving ${esc(config.REGION)}<br>${esc(config.PHONE_DISPLAY)}</p></div>`;
  const text = `Hi ${first},\n\nThanks for reaching out to ${config.BUSINESS_NAME}. We got your request, and our team will call you back${lead.best_day || lead.best_time ? " at the time you picked" : " soon"}.\n\n${rangeText}\n\nHere's what you sent us:\n${textRows(rows)}\n\nAnything to add or change? Just reply to this email, or call us at ${config.PHONE_DISPLAY}.\n\n${config.BUSINESS_NAME}\nServing ${config.REGION}\n${config.PHONE_DISPLAY}`;
  return { subject, html, text };
}
