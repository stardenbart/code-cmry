// ─────────────────────────────────────────────────────────────────────────────
// Answer cache for CODE AI.
//
// The non-negotiable rule: a cache key MUST include a fingerprint of the data the
// answer was derived from. Keying on the question text alone would serve July's
// numbers to someone who has since moved the slicer to August — exactly the
// failure the "data berubah, klik Refresh" indicator exists to prevent.
//
// Entries are shared per dashboard, not per user: the same question from two
// managers should not be paid for twice. The caller re-checks dashboard access
// before serving, so sharing never widens who can see what.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";

const MAX_ENTRIES = Number(process.env.AI_CACHE_MAX_ENTRIES ?? 500);

const TTL_MS = {
  cepat:    Number(process.env.AI_CACHE_TTL_CEPAT_MIN    ?? 360) * 60_000, // 6 jam
  standar:  Number(process.env.AI_CACHE_TTL_STANDAR_MIN  ?? 120) * 60_000, // 2 jam
  mendalam: Number(process.env.AI_CACHE_TTL_MENDALAM_MIN ?? 30) * 60_000,  // 30 menit
};

export const CACHE_ENABLED = !/^(0|false|off|no)$/i.test(process.env.AI_CACHE || "");

const store = new Map(); // key -> { answer, meta, expiresAt, hits, createdAt }

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);

/** Normalizes a question so trivial wording differences still hit the cache. */
export function normalizeQuestion(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    // Possessive/emphatic suffix: "totalnya" and "total nya" must collapse to the
    // same form, otherwise trivially different wording misses the cache.
    .replace(/(\p{L}{3,})nya\b/gu, "$1")
    .replace(/\b(tolong|coba|mohon|dong|ya|nih|sih|kak|pak|bu|nya|lah|kah|pun)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint of the data an answer depends on. Any change to the visible rows,
 * the active filters, or the set of pages read invalidates the entry.
 */
export function snapshotFingerprint(snapshot) {
  if (!snapshot) return "none";

  const parts = [
    (snapshot.pagesRead || []).join("|"),
    (snapshot.filters || []).join("|"),
    (snapshot.slicers || []).join("|"),
  ];

  for (const v of snapshot.visuals || []) {
    const rows = Array.isArray(v.rows) ? v.rows : [];
    parts.push(
      [
        v.title,
        v.pageName || "",
        rows.length,
        (v.columns || []).join(","),
        // Hash the values themselves — same row count with different numbers
        // must produce a different fingerprint.
        sha(JSON.stringify(rows)),
      ].join("~")
    );
  }

  return sha(parts.join("\n"));
}

export function cacheKey({ dashboardId, question, snapshot, tier }) {
  return sha([dashboardId, normalizeQuestion(question), snapshotFingerprint(snapshot), tier].join("::"));
}

export function get(key) {
  if (!CACHE_ENABLED) return null;
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  entry.hits += 1;
  // Refresh LRU position
  store.delete(key);
  store.set(key, entry);

  return {
    answer: entry.answer,
    meta: entry.meta,
    ageSeconds: Math.round((Date.now() - entry.createdAt) / 1000),
    hits: entry.hits,
  };
}

export function set(key, { answer, meta, tier }) {
  if (!CACHE_ENABLED) return;

  if (store.size >= MAX_ENTRIES) {
    // Evict oldest (insertion order = LRU thanks to the re-set in get())
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }

  store.set(key, {
    answer,
    meta,
    tier,
    createdAt: Date.now(),
    expiresAt: Date.now() + (TTL_MS[tier] ?? TTL_MS.standar),
    hits: 0,
  });
}

/** Drops every entry for one dashboard — used when its data is known to change. */
export function invalidateDashboard(dashboardId) {
  let removed = 0;
  for (const [key, entry] of store) {
    if (entry.meta?.dashboardId === dashboardId) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function stats() {
  let hits = 0;
  for (const e of store.values()) hits += e.hits;
  return { entries: store.size, totalHits: hits, enabled: CACHE_ENABLED, maxEntries: MAX_ENTRIES };
}

export function clear() {
  store.clear();
}
