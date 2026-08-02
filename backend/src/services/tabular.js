// ─────────────────────────────────────────────────────────────────────────────
// Tabular helpers for the row budget governor.
//
// The critical guarantee: aggregate statistics are computed from EVERY row the
// browser captured, even when only a sample of rows is put in the prompt. That
// removes the classic truncation failure — a model summing the sample and calling
// it the total.
// ─────────────────────────────────────────────────────────────────────────────

/** Parses Indonesian ("1.022,63") and English ("1,022.63") number formats. */
export function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;

  let s = String(value ?? "").trim();
  if (!s) return NaN;

  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  s = s.replace(/[^\d.,]/g, "");          // strip Rp, %, spaces, units
  if (!s || !/\d/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point
    s = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,5" → decimal; "1,022" with 3 digits after → thousands
    s = /,\d{3}$/.test(s) && s.length > 4 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    s = /\.\d{3}$/.test(s) && s.length > 4 ? s.replace(/\./g, "") : s;
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

const NUMERIC_RATIO = 0.6;

// parseNumber is deliberately lenient (it strips "Rp", "%", units) so it must NOT
// be used to decide whether a column is numeric: "Mesin 0" and "CMD 1" would both
// parse to a number and a label column would be mistaken for a metric.
const NUMERIC_SHAPE = /^[-(]?\s*(?:rp|idr|usd|\$)?\s*[\d][\d.,\s]*\s*(?:%|jam|hari|menit|kg|ton|liter|m3|pcs)?\s*\)?$/i;

/** True when the raw text itself looks like a number, not merely contains one. */
export function looksNumeric(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (!NUMERIC_SHAPE.test(s)) return false;
  return Number.isFinite(parseNumber(s));
}

/** Column indexes whose values are predominantly numeric. */
export function detectNumericColumns(columns, rows) {
  const out = [];
  for (let c = 0; c < columns.length; c += 1) {
    let numeric = 0;
    let filled = 0;
    for (const row of rows) {
      const raw = String(row?.[c] ?? "").trim();
      if (!raw) continue;
      filled += 1;
      if (looksNumeric(raw)) numeric += 1;
    }
    if (filled > 0 && numeric / filled >= NUMERIC_RATIO) out.push(c);
  }
  return out;
}

const fmt = (n) => {
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 0 : abs >= 10 ? 2 : 3;
  return n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
};

/** total / mean / median / min / max over ALL rows for one column. */
export function columnStats(rows, index) {
  const values = [];
  for (const row of rows) {
    const n = parseNumber(row?.[index]);
    if (Number.isFinite(n)) values.push(n);
  }
  if (!values.length) return null;

  values.sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

  return {
    count: values.length,
    total,
    mean: total / values.length,
    median,
    min: values[0],
    max: values[values.length - 1],
    text: `total ${fmt(total)} | rata-rata ${fmt(total / values.length)} | median ${fmt(median)} | maks ${fmt(values[values.length - 1])} | min ${fmt(values[0])}`,
  };
}

/** Sums `valueIdx` grouped by `keyIdx`, biggest first. */
export function groupTotals(rows, keyIdx, valueIdx, limit = 6) {
  const totals = new Map();
  let grand = 0;

  for (const row of rows) {
    const key = String(row?.[keyIdx] ?? "").trim() || "(kosong)";
    const n = parseNumber(row?.[valueIdx]);
    if (!Number.isFinite(n)) continue;
    totals.set(key, (totals.get(key) || 0) + n);
    grand += n;
  }
  if (!totals.size || grand === 0) return null;

  const sorted = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);

  const parts = shown.map(([k, v]) => `${k} = ${fmt(v)} (${((v / grand) * 100).toFixed(0)}%)`);
  if (rest.length) {
    const restSum = rest.reduce((s, [, v]) => s + v, 0);
    parts.push(`${rest.length} lainnya = ${fmt(restSum)} (${((restSum / grand) * 100).toFixed(0)}%)`);
  }
  return { groups: sorted.length, text: parts.join(" | ") };
}

/**
 * Picks the column to rank by: the numeric column with the widest spread,
 * which is almost always the metric the user cares about.
 */
export function pickRankColumn(columns, rows, numericIdx) {
  if (!numericIdx.length) return -1;
  let best = numericIdx[0];
  let bestSpread = -1;

  for (const idx of numericIdx) {
    const stats = columnStats(rows, idx);
    if (!stats) continue;
    // Ignore columns that look like years or counters of 1
    const looksLikeYear = stats.min >= 1900 && stats.max <= 2200 && Number.isInteger(stats.mean);
    if (looksLikeYear) continue;
    const spread = Math.abs(stats.max - stats.min);
    if (spread > bestSpread) { bestSpread = spread; best = idx; }
  }
  return best;
}

/** First low-cardinality text column — the natural grouping dimension. */
export function pickGroupColumn(columns, rows, numericIdx) {
  const numeric = new Set(numericIdx);
  for (let c = 0; c < columns.length; c += 1) {
    if (numeric.has(c)) continue;
    const distinct = new Set(rows.map((r) => String(r?.[c] ?? "").trim()));
    if (distinct.size >= 2 && distinct.size <= Math.max(8, rows.length / 10)) return c;
  }
  return -1;
}

export { fmt as formatNumber };
