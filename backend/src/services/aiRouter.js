// ─────────────────────────────────────────────────────────────────────────────
// Chooses which CIA tier answers a question.
//
// Deliberately deterministic: asking a model to rate complexity would spend the
// quota this routing exists to protect, and would be impossible to audit when a
// user asks "why did it answer shallowly?".
//
// The real payoff is not token count — measured, the tiers cost almost the same
// per call. Free-tier limits are counted PER MODEL, so routing light questions to
// the fast tier preserves the deep tier's daily allowance for questions that
// actually need it. See docs/CODE-AI-OPTIMIZATION-PLAN.md §5.
// ─────────────────────────────────────────────────────────────────────────────

import { TIERS } from "./aiProvider.js";

const SIGNALS = [
  {
    // Scored to reach the "mendalam" threshold on its own: a root-cause question
    // is exactly the case the deep tier exists for, and answering it shallowly is
    // the failure mode users notice most.
    id: "rca",
    score: 5,
    label: "pertanyaan akar masalah",
    re: /\bkenapa\b|\bmengapa\b|\bwhy\b|akar masalah|root cause|penyebab|\bnaik\b|\bturun\b|meningkat|menurun|anomali|abnormal|melonjak|lonjakan|\bdrop\b/i,
  },
  {
    id: "advice",
    score: 5,
    label: "minta rekomendasi/proyeksi",
    re: /\bsaran\b|rekomendasi|sebaiknya|bagaimana cara|langkah|prediksi|proyeksi|forecast|antisipasi|perbaiki|improve|optimasi/i,
  },
  {
    id: "compare",
    score: 2,
    label: "perbandingan/tren",
    re: /bandingkan|dibanding|perbandingan|\btren\b|\btrend\b|pola\b|korelasi|hubungan antara|month over month|\bmom\b|\byoy\b|sejak|selama/i,
  },
  {
    id: "followup",
    score: 2,
    label: "lanjutan percakapan",
    re: /kalau begitu|berarti|\btadi\b|sebelumnya kamu|lanjutkan|jelaskan lebih|detail(?:kan)?\b|elaborasi|maksudnya/i,
  },
];

const SIMPLE_LOOKUP =
  /^(berapa|apa|siapa|kapan|mana|yang mana|tampilkan|sebutkan|list|top|jumlah|total)\b/i;

/**
 * @param {object} input
 * @param {string} input.question
 * @param {object} input.snapshot        sanitized or raw snapshot
 * @param {number} input.historyTurns
 * @param {object} [input.knowledge]     { text } — used to spot [Blocked] KPIs
 * @returns {{ tier: string, score: number, reasons: string[] }}
 */
export function classify({ question, snapshot, historyTurns = 0, knowledge }) {
  const q = String(question || "");
  const words = q.trim().split(/\s+/).filter(Boolean).length;
  const reasons = [];
  let score = 0;
  let semanticScore = 0;   // signals from the QUESTION, not from data size

  for (const signal of SIGNALS) {
    if (signal.id === "followup" && historyTurns === 0) continue;
    if (signal.re.test(q)) {
      score += signal.score;
      semanticScore += signal.score;
      reasons.push(signal.label);
    }
  }

  const pagesRead = Array.isArray(snapshot?.pagesRead) ? snapshot.pagesRead.length : 1;
  if (pagesRead > 1) {
    score += 2;
    reasons.push(`${pagesRead} halaman`);
  }

  // Data size is a weak complexity signal now that the row budget governor caps
  // the prompt regardless of table size — "berapa totalnya?" over 500 rows is
  // still a one-number lookup. Kept at +1 only because reasoning across many
  // groups is marginally harder than across three.
  const totalRows = (snapshot?.visuals || []).reduce(
    (sum, v) => sum + (Array.isArray(v?.rows) ? v.rows.length : 0),
    0
  );
  if (totalRows > 200) {
    score += 1;
    reasons.push(`${totalRows} baris data`);
  }

  if (knowledge?.text && /\[Blocked\]|\[Needs confirmation\]/.test(knowledge.text)) {
    score += 1;
    reasons.push("KPI perlu konfirmasi");
  }

  if (words > 25) {
    score += 1;
    reasons.push("pertanyaan panjang");
  }

  // The discount is blocked by signals from the QUESTION only. A short lookup is
  // still a lookup when the table behind it happens to be large — otherwise every
  // question on a big dashboard would be billed at the deep tier.
  // "Apa saran perbaikan?" is short and starts with "apa", but it is not a lookup.
  if (semanticScore === 0 && words < 10 && SIMPLE_LOOKUP.test(q.trim())) {
    score -= 3;
    reasons.push("pertanyaan lookup singkat");
  }

  const tier = score <= 0 ? "cepat" : score <= 4 ? "standar" : "mendalam";
  return { tier, score, reasons };
}

/**
 * Applies the user's override and any quota-driven downgrade on top of the
 * automatic choice.
 *
 * @param {object} opts
 * @param {string} opts.requested   "auto" | tier name
 * @param {object} opts.classified  result of classify()
 * @param {object} [opts.quota]     result of aiQuota.summary()
 */
export function resolveTier({ requested = "auto", classified, quota }) {
  let tier = classified.tier;
  const reasons = [...classified.reasons];
  let downgraded = null;

  if (requested && requested !== "auto" && TIERS.includes(requested)) {
    return {
      tier: requested,
      score: classified.score,
      reasons: ["dipilih manual oleh user"],
      downgraded: null,
      auto: false,
    };
  }

  // Quota-driven degradation — announced, never silent.
  // The deep tier has only 20 requests/day on the free plan, so it degrades far
  // earlier than the 500/day tiers: below 40% left (i.e. 8 of 20 remaining) only
  // strongly analytical questions still earn it.
  if (quota && tier === "mendalam") {
    const deep = quota.perTier?.find((t) => t.tier === "mendalam");

    if (deep?.rpm?.exhausted) {
      tier = "standar";
      downgraded = `batas ${deep.rpm.limit} permintaan/menit tier Mendalam tercapai`;
    } else if (deep && deep.remainingPct <= 0) {
      tier = "standar";
      downgraded = `jatah harian tier Mendalam habis (${deep.used}/${deep.limit})`;
    } else if (deep && deep.remainingPct < 40 && classified.score < 8) {
      tier = "standar";
      downgraded = `sisa tier Mendalam tinggal ${deep.used}/${deep.limit} — disimpan untuk pertanyaan yang lebih kompleks`;
    }
  }

  // Standard tier out of per-minute headroom → fall back to the fast tier
  if (quota && tier === "standar") {
    const std = quota.perTier?.find((t) => t.tier === "standar");
    if (std?.rpm?.exhausted || std?.remainingPct <= 0) {
      tier = "cepat";
      downgraded = downgraded || `tier Standar sedang penuh (${std.used}/${std.limit} hari ini)`;
    }
  }

  if (quota?.overall && quota.overall.remainingPct < 5) {
    tier = "cepat";
    downgraded = `kuota harian tinggal ${quota.overall.remainingPct}%`;
  }

  return { tier, score: classified.score, reasons, downgraded, auto: true };
}

/**
 * Decides whether a fast-tier answer looks too weak and deserves one retry at a
 * higher tier. Capped at a single escalation by the caller.
 */
export function shouldEscalate({ answer, tier, classified, snapshotHasData }) {
  if (tier === "mendalam") return false;
  const text = String(answer || "");

  // Claims the data is missing while the snapshot clearly has rows
  if (snapshotHasData && /tidak (ada|tersedia|cukup) data|data tidak (ada|tersedia)/i.test(text)) {
    return true;
  }
  // Suspiciously short for a question that scored as analytical
  if (classified.score >= 3 && text.length < 120) return true;
  // Analytical question answered without citing a single number
  if (classified.score >= 3 && !/\d/.test(text)) return true;

  return false;
}
