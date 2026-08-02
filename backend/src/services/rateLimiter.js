// ─────────────────────────────────────────────────────────────────────────────
// In-memory sliding-window rate limiter, keyed per user.
//
// Deliberately NOT backed by ai_chat_logs: a user could otherwise reset their own
// quota by clearing their chat history. Per-process state is enough here — the
// backend runs as a single PM2 process, and the limiter only protects the shared
// Gemini free-tier quota from accidental hammering, it is not a security control.
// ─────────────────────────────────────────────────────────────────────────────

const buckets = new Map(); // key -> number[] (timestamps, ms)

const MAX_KEYS = 5000; // guards against unbounded growth

/**
 * Records one hit and reports whether it is allowed.
 *
 * @param {string|number} key          usually the user id
 * @param {number} maxRequests
 * @param {number} windowSeconds
 * @param {number} [now]
 * @returns {{ allowed: boolean, remaining: number, retryAfterSeconds: number }}
 */
export function hit(key, maxRequests, windowSeconds, now = Date.now()) {
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  const recent = (buckets.get(key) || []).filter((t) => t > cutoff);

  if (recent.length >= maxRequests) {
    buckets.set(key, recent);
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  recent.push(now);
  buckets.set(key, recent);

  // Opportunistic cleanup so idle users don't accumulate forever
  if (buckets.size > MAX_KEYS) {
    for (const [k, times] of buckets) {
      if (!times.some((t) => t > cutoff)) buckets.delete(k);
      if (buckets.size <= MAX_KEYS) break;
    }
  }

  return {
    allowed: true,
    remaining: maxRequests - recent.length,
    retryAfterSeconds: 0,
  };
}

/** Current usage without recording a hit. */
export function peek(key, windowSeconds, now = Date.now()) {
  const cutoff = now - windowSeconds * 1000;
  return (buckets.get(key) || []).filter((t) => t > cutoff).length;
}

/** Test/ops helper. */
export function reset(key) {
  if (key === undefined) buckets.clear();
  else buckets.delete(key);
}
