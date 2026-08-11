// Fixed-window rate limiting.
//
// WHY: every unauthenticated endpoint in this app was unthrottled. The two
// exceptions were ad-hoc per-organisation counters, which are themselves a
// denial-of-service vector — anyone who knows an organisation's UUID (it is in
// the public booking URL) could saturate the counter and block that business's
// real customers from booking.
//
// This limiter keys on the CALLER as well as the resource, so one abusive client
// cannot exhaust everyone else's allowance.
//
// SCOPE, stated honestly: this is an in-process store. On a single instance it
// is exact; across several serverless instances each holds its own window, so
// the effective limit is (limit x instances). That is a large improvement over
// no limit at all and adds no infrastructure, but it is NOT a distributed
// limiter — the durable version belongs in Postgres or Redis and is tracked as
// its own ledger item. Anything security-critical must not rely on this alone.
//
// Tests: tests/rate-limit.test.mjs

/** @type {Map<string, { count: number, resetAt: number }>} */
const windows = new Map();

// Bound the map so a flood of unique keys cannot grow memory without limit.
const MAX_KEYS = 10_000;

function sweep(now) {
  if (windows.size < MAX_KEYS) return;
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
  // Still oversized after removing expired entries: drop the oldest.
  if (windows.size >= MAX_KEYS) {
    const excess = windows.size - Math.floor(MAX_KEYS / 2);
    let dropped = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/**
 * Consume one unit against `key`.
 *
 * @param {string} key      caller + resource, e.g. "booking:<org>:<ip>"
 * @param {number} limit    permitted requests per window
 * @param {number} windowMs window length in milliseconds
 * @param {number} [now]    injectable clock, for tests
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, retryAfterSeconds: number }}
 */
export function consume(key, limit, windowMs, now = Date.now()) {
  if (!Number.isFinite(limit) || limit <= 0) {
    // A misconfigured limit must FAIL CLOSED. A limiter that silently allows
    // everything when its configuration is wrong is worse than none, because it
    // reports protection it is not providing.
    return { allowed: false, remaining: 0, resetAt: now, retryAfterSeconds: 1 };
  }

  sweep(now);
  const entry = windows.get(key);

  if (!entry || entry.resetAt <= now) {
    const resetAt = now + windowMs;
    windows.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, retryAfterSeconds: 0 };
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
    retryAfterSeconds: 0,
  };
}

/** Test-only: forget all windows. */
export function _reset() {
  windows.clear();
}

/**
 * Best-effort client identity from proxy headers.
 *
 * These headers are attacker-controlled in general, but on Vercel and similar
 * platforms the edge overwrites x-forwarded-for with the real peer. Never treat
 * this as authentication — it is only for spreading a quota.
 */
export function clientKey(headers) {
  const get = (name) =>
    (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) ?? "";
  const forwarded = String(get("x-forwarded-for")).split(",")[0].trim();
  return forwarded || String(get("x-real-ip")).trim() || "unknown";
}
