// ─────────────────────────────────────────────────────────────────────────────
// Single entry point for every CIA model call.
//
// Everything above this layer speaks in TIERS ("cepat" / "standar" / "mendalam").
// Only this file knows which vendor model backs a tier — so switching to a paid
// tier or Vertex AI is a config change here, not a rewrite across the codebase.
//
// Also owns the per-user queue and the 429 backoff, so no caller can accidentally
// fire concurrent requests at the same free-tier quota.
// ─────────────────────────────────────────────────────────────────────────────

import { askGemini, GeminiError, normalizeModel } from "../config/gemini.js";

export const TIERS = ["cepat", "standar", "mendalam"];

export const TIER_LABELS = {
  cepat:    "CIA Cepat",
  standar:  "CIA Standar",
  mendalam: "CIA Mendalam",
};

/**
 * Tier → vendor model. The only place these ids appear outside config.
 *
 * Chosen from the ACTUAL free-tier limits observed in Google AI Studio
 * (2026-08-02), not from model quality alone:
 *
 *   gemini-3.6-flash        5 RPM /  20 RPD   ← scarce, reserve for deep work
 *   gemini-3.5-flash        5 RPM /  20 RPD   ← equally scarce
 *   gemini-3.5-flash-lite  15 RPM / 500 RPD
 *   gemini-3.1-flash-lite  15 RPM / 500 RPD
 *
 * Quota is counted PER MODEL, so putting "cepat" and "standar" on two different
 * lite models gives 1000 requests/day instead of 500, and leaves the 20/day
 * flash allowance entirely to "mendalam". Using 3.5-flash for "standar" would
 * have burnt the scarce allowance on routine comparisons.
 */
export const TIER_MODELS = {
  cepat:    process.env.AI_MODEL_CEPAT    || "gemini-3.1-flash-lite",
  standar:  process.env.AI_MODEL_STANDAR  || "gemini-3.5-flash-lite",
  mendalam: process.env.AI_MODEL_MENDALAM || "gemini-3.6-flash",
};

const TIER_THINKING = {
  cepat:    "low",
  standar:  "low",
  mendalam: process.env.AI_THINKING_MENDALAM || "high",
};

const TIER_MAX_OUTPUT = {
  cepat:    Number(process.env.AI_OUTPUT_CEPAT    ?? 1024),
  standar:  Number(process.env.AI_OUTPUT_STANDAR  ?? 2048),
  mendalam: Number(process.env.AI_OUTPUT_MENDALAM ?? 4096),
};

export function tierModel(tier) {
  return normalizeModel(TIER_MODELS[tier] || TIER_MODELS.standar);
}

export function nextTier(tier) {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

// ── Per-user queue ───────────────────────────────────────────────────────────
// Serializes a user's requests so two browser tabs cannot double-spend quota.
const queues = new Map();

function enqueue(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(job, job);
  // Keep the chain alive but don't leak rejections into the next job
  queues.set(key, run.then(() => {}, () => {}));
  return run;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RETRY_DELAYS = (process.env.AI_RETRY_DELAYS_MS || "1000,2000,4000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/**
 * Calls the model for a tier, queued per user and retried on transient 429s.
 *
 * @param {object}   opts
 * @param {string}   opts.tier
 * @param {string}   opts.apiKey
 * @param {string|number} opts.queueKey        usually the user id
 * @param {string}   opts.systemInstruction
 * @param {Array}    opts.history
 * @param {string}   opts.question
 * @param {(info: object) => void} [opts.onRetry]
 * @returns {Promise<{text, model, tier, usage, attempts, retried}>}
 */
export async function callAI({
  tier = "standar",
  apiKey,
  queueKey = "global",
  systemInstruction,
  history = [],
  question,
  maxOutputTokens,      // overrides the tier default (e.g. JSON needs more room)
  onRetry,
}) {
  const model = tierModel(tier);

  return enqueue(`u:${queueKey}`, async () => {
    let attempt = 0;
    let lastError;

    // attempt 0 plus one per configured delay
    while (attempt <= RETRY_DELAYS.length) {
      try {
        const result = await askGemini({
          apiKey,
          model,
          systemInstruction,
          history,
          question,
          thinkingLevel: TIER_THINKING[tier],
          maxOutputTokens: maxOutputTokens ?? TIER_MAX_OUTPUT[tier],
        });
        return { ...result, tier, attempts: attempt + 1, retried: attempt > 0 };
      } catch (err) {
        lastError = err;

        const retryable =
          err instanceof GeminiError &&
          (err.code === "QUOTA" || err.status === 429 || err.status === 503 || err.code === "TIMEOUT");

        if (!retryable || attempt === RETRY_DELAYS.length) break;

        const delay = RETRY_DELAYS[attempt];
        onRetry?.({ attempt: attempt + 1, delay, reason: err.code || err.status });
        await sleep(delay);
        attempt += 1;
      }
    }

    throw lastError;
  });
}

/** Queue depth for a user — surfaced in the UI as "menunggu giliran". */
export function queueDepth(queueKey) {
  return queues.has(`u:${queueKey}`) ? 1 : 0;
}
