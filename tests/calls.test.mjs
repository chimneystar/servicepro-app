import test from "node:test";
import assert from "node:assert/strict";
import {
  callNeedsFollowUp,
  escapeXml,
  formatUsPhone,
  mapVoiceStatus,
  normalizeUsPhone,
} from "../lib/core/calls.mjs";

test("United States phone numbers normalize to E.164", () => {
  assert.equal(normalizeUsPhone("(512) 555-0199"), "+15125550199");
  assert.equal(normalizeUsPhone("1-512-555-0199"), "+15125550199");
  assert.equal(normalizeUsPhone("555-0199"), "");
  assert.equal(formatUsPhone("+15125550199"), "(512) 555-0199");
});

test("voice-provider states become stable call-center states", () => {
  assert.equal(mapVoiceStatus("in-progress"), "in_progress");
  assert.equal(mapVoiceStatus("completed"), "completed");
  assert.equal(mapVoiceStatus("no-answer", "inbound"), "missed");
  assert.equal(mapVoiceStatus("busy", "outbound"), "failed");
});

test("missed and callback outcomes stay in the follow-up queue", () => {
  assert.equal(callNeedsFollowUp("missed"), true);
  assert.equal(callNeedsFollowUp("completed", "callback"), true);
  assert.equal(callNeedsFollowUp("completed", "booked"), false);
});

test("TwiML values are escaped before rendering", () => {
  assert.equal(escapeXml("A&B <test>"), "A&amp;B &lt;test&gt;");
});
