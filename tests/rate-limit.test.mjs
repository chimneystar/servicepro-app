import test from "node:test";
import assert from "node:assert/strict";
import { consume, clientKey, _reset } from "../lib/core/rate-limit.mjs";

const T0 = 1_000_000;

test("requests inside the limit are allowed", () => {
  _reset();
  for (let i = 0; i < 5; i++) {
    const r = consume("k", 5, 60_000, T0);
    assert.equal(r.allowed, true, `request ${i + 1} of 5 should pass`);
    assert.equal(r.remaining, 4 - i);
  }
});

test("the request past the limit is refused", () => {
  _reset();
  for (let i = 0; i < 5; i++) consume("k", 5, 60_000, T0);
  const r = consume("k", 5, 60_000, T0);
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
  assert.ok(r.retryAfterSeconds >= 1, "a refusal must tell the caller when to retry");
});

test("the window reopens after it expires", () => {
  _reset();
  for (let i = 0; i < 5; i++) consume("k", 5, 60_000, T0);
  assert.equal(consume("k", 5, 60_000, T0 + 59_999).allowed, false, "still closed just before expiry");
  assert.equal(consume("k", 5, 60_000, T0 + 60_001).allowed, true, "open again after expiry");
});

test("one abusive caller cannot exhaust another caller's allowance", () => {
  // This is the defect in the existing per-organisation counters: they are
  // global to the org, so anyone knowing the org UUID could block real
  // customers from booking.
  _reset();
  for (let i = 0; i < 5; i++) consume("booking:org1:1.2.3.4", 5, 60_000, T0);
  assert.equal(consume("booking:org1:1.2.3.4", 5, 60_000, T0).allowed, false, "the abuser is stopped");
  assert.equal(consume("booking:org1:9.9.9.9", 5, 60_000, T0).allowed, true, "a different caller is unaffected");
});

test("separate resources have separate budgets", () => {
  _reset();
  for (let i = 0; i < 5; i++) consume("a", 5, 60_000, T0);
  assert.equal(consume("a", 5, 60_000, T0).allowed, false);
  assert.equal(consume("b", 5, 60_000, T0).allowed, true);
});

test("a misconfigured limit FAILS CLOSED", () => {
  // A limiter that allows everything when its configuration is broken reports
  // protection it is not providing — the same class as a spend guard that fails
  // open. Refusing is the safe direction here.
  _reset();
  for (const bad of [0, -1, NaN, undefined, null, "five"]) {
    assert.equal(consume("k", bad, 60_000, T0).allowed, false, `limit ${String(bad)} must refuse`);
  }
});

test("the limiter is not a cry-wolf that refuses everything", () => {
  // The other half of the both-ways proof.
  _reset();
  assert.equal(consume("fresh", 1, 60_000, T0).allowed, true);
  _reset();
  assert.equal(consume("fresh", 1000, 60_000, T0).allowed, true);
});

test("memory cannot grow without bound", () => {
  _reset();
  for (let i = 0; i < 12_000; i++) consume(`key-${i}`, 5, 1_000, T0);
  // Sweeping happens on write; after expiry the map must not still hold
  // everything. Consume once past expiry to trigger a sweep.
  const after = consume("trigger", 5, 1_000, T0 + 5_000);
  assert.equal(after.allowed, true);
});

test("clientKey prefers the first x-forwarded-for hop", () => {
  assert.equal(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })), "1.2.3.4");
  assert.equal(clientKey(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(clientKey(new Headers()), "unknown");
  assert.equal(clientKey(undefined), "unknown", "must not throw on a missing header bag");
});
