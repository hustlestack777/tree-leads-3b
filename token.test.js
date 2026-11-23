import test from "node:test";
import assert from "node:assert/strict";
import { headerTokenMatches } from "./token.js";

test("matches either accepted secret, and rejects a third", () => {
  const agent = "agent-secret-aaaaaaaa";
  const phone = "phone-secret-bbbbbbbb";
  assert.equal(headerTokenMatches(agent, agent, phone), true);
  assert.equal(headerTokenMatches(phone, agent, phone), true);
  assert.equal(headerTokenMatches("wrong-secret-cccccccc", agent, phone), false);
  assert.equal(headerTokenMatches(agent, agent), true);
  assert.equal(headerTokenMatches(phone, agent), false);
});

test("rejects missing or blank secrets and empty header", () => {
  assert.equal(headerTokenMatches("abc", ""), false);
  assert.equal(headerTokenMatches("abc"), false);
  assert.equal(headerTokenMatches("", "abc"), false);
  assert.equal(headerTokenMatches("ab", "abc"), false);
});

test("AGENT_TOOL_TOKEN still works when PHONE_FORWARD_TOKEN is unset", () => {
  assert.equal(headerTokenMatches("only-agent", "only-agent", undefined), true);
  assert.equal(headerTokenMatches("only-agent", "only-agent", ""), true);
});
