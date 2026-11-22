// source_detail for phone/chat agent leads (ElevenLabs save_lead tool -> /api/agent-lead).
// The website chat widget passes the page's tags as dynamic variables (page_src, page_utm,
// page_source_detail); the agent's save_lead tool forwards them in the body. That puts
// "src=fbreel1122" etc. in source_detail, so campaignLabel() labels chat leads like form leads.
const unresolved = (v) => /\{\{.*\}\}/.test(String(v || ""));
const clean = (v, max) => {
  if (v === undefined || v === null || unresolved(v)) return "";
  return String(v).replace(/[\r\n]+/g, " ").trim().slice(0, max);
};

export function agentSourceDetail(b = {}, channel = "phone") {
  const base = b.conversation_id ? `conversation ${String(b.conversation_id).slice(0, 120)}` : channel === "phone" ? "318-712-TREE" : "website chat";
  const detail = clean(b.page_source_detail, 300);
  const src = clean(b.page_src, 60).toLowerCase();
  const utm = clean(b.page_utm, 200);
  let tags = detail;
  if (!tags && (src || utm)) tags = [src && `src=${src}`, utm].filter(Boolean).join(" · ");
  if (tags && src && !/(^|[\s·&?])src=/.test(tags)) tags = `src=${src} · ${tags}`;
  return [base, tags].filter(Boolean).join(" · ").slice(0, 400);
}
