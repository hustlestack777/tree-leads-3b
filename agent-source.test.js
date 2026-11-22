import test from "node:test";
import assert from "node:assert/strict";
import { agentSourceDetail } from "./agent-source.js";
import { campaignLabel } from "./emails.js";

const chat = (b) => ({ source: "chat", source_detail: agentSourceDetail(b, "chat") });

test("chat from the organic reel link is labeled FB reel Nov 22", () => {
  const b = { conversation_id: "conv_1", page_src: "fbreel1122", page_source_detail: "/?src=fbreel1122 · src=fbreel1122 · v=a" };
  assert.equal(agentSourceDetail(b, "chat"), "conversation conv_1 · /?src=fbreel1122 · src=fbreel1122 · v=a");
  assert.equal(campaignLabel(chat(b)), "FB reel Nov 22");
});
test("chat from the boost link is labeled (boost)", () => {
  const b = { conversation_id: "conv_2", page_src: "fbboost1122", page_utm: "utm_source=facebook&utm_medium=paid_social&utm_campaign=blake_reel_nov22" };
  assert.equal(campaignLabel(chat(b)), "FB reel Nov 22 (boost)");
});
test("page_src only still tags the lead", () => {
  assert.equal(agentSourceDetail({ page_src: "FBREEL1122" }, "chat"), "website chat · src=fbreel1122");
});
test("unresolved {{placeholders}} and phone calls stay as before", () => {
  assert.equal(agentSourceDetail({ conversation_id: "c", page_src: "{{page_src}}", page_source_detail: "{{page_source_detail}}" }, "chat"), "conversation c");
  assert.equal(agentSourceDetail({}, "phone"), "318-712-TREE");
  assert.equal(campaignLabel({ source: "phone", source_detail: agentSourceDetail({ conversation_id: "c" }, "phone") }), "");
});
