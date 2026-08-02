// ─────────────────────────────────────────────────────────────────────────────
// Data sanitization for anything sent to Google Gemini.
//
// WHY: on the Gemini API free tier, prompts may be used by Google to improve
// their products. Paid tiers / Vertex AI do not carry that term. Sanitization is
// defence-in-depth, NOT a substitute for a paid key when the numbers themselves
// are confidential — operational figures are the analysis, so they must be sent.
// What this module removes is IDENTITY: people, trading partners, contact
// details, document numbers.
//
// HOW: two-way pseudonymization.
//   outbound  "PT Sumber Makmur"  ->  "SUPPLIER_7f3a"
//   inbound   "SUPPLIER_7f3a"     ->  "PT Sumber Makmur"
// The model reasons over stable tokens; the user still reads real names. Tokens
// are HMAC-derived, so the same value always maps to the same token across turns
// without persisting a lookup table anywhere.
//
// Contact details and national ID numbers are dropped outright (one-way) — they
// are never needed to analyse a dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { looksNumeric } from "./tabular.js";

const flag = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return !/^(0|false|off|no)$/i.test(v);
};

export const SANITIZER_CONFIG = {
  get enabled()        { return flag("AI_SANITIZE", true); },
  get moneyMode()      { return (process.env.AI_SANITIZE_MONEY || "off").toLowerCase(); }, // off | relative
  get sendKnowledge()  { return flag("AI_SEND_DOMAIN_KNOWLEDGE", true); },
};

// ── Column classification ────────────────────────────────────────────────────
// Vocabulary is taken from the actual workspace inventory in
// knowledge/powerbi-analyst/semantic-model-registry.md — the models really do
// contain Dim_Karyawan (NC/Deviasi), error-NIK staging tables (Lembur Plant),
// db_complaints (Data Room Quality), api_saran (DB - SSCI), db_Safety with Lost
// Time Injury (Data Room Safety), and supplier ranking / FM Price (PPIC-DS,
// Emission CMD). Order matters: the first match wins.
const COLUMN_RULES = [
  // ── Never sent, never reversible ──
  // Contact details & national identifiers
  { kind: "drop", re: /e-?mail|telp|telepon|phone|\bhp\b|whatsapp|\bwa\b|\bnik\b|no\.?\s?ktp|\bktp\b|npwp|rekening|account\s?no|password|passwd|\btoken\b|api[_\s-]?key/i },
  { kind: "drop", re: /alamat|address|domisili/i },
  // Compensation — highly sensitive HR data (Lembur Plant: "biaya yang dibayar")
  { kind: "drop", re: /\bgaji\b|salary|\bupah\b|payroll|tunjangan|\bthr\b|insentif|incentive|take[\s-]?home|slip/i },
  // Health / injury — special-category personal data (db_Safety: Lost Time Injury)
  { kind: "drop", re: /korban|victim|cedera|\binjury\b|\bluka\b|medis|medical|penyakit|diagnos|\blti\b|kecelakaan\s?(orang|personal)/i },

  // ── Pseudonymized (reversible) ──
  // Trading partners BEFORE people: "Nama Supplier" / "Customer Name" contain a
  // person keyword ("nama"/"name") but identify an organisation, not a person.
  { kind: "org", re: /supplier|vendor|pemasok|customer|pelanggan|klien|\bclient\b|distributor|principal|outlet|\btoko\b|kontraktor|contractor|ekspedisi|forwarder|peternak|\bkoperasi\b|\bloper\b/i },
  // People (Dim_Karyawan, operator, PIC, approver…)
  { kind: "person", re: /\bnama\b|\bname\b|karyawan|employee|pegawai|operator|pekerja|\bpic\b|petugas|pengguna|\buser\b|atasan|supervisor|manager|penanggung\s?jawab|teknisi|inspektor|approver|requester|pemohon|pelapor/i },
  // Document / transaction identifiers (PurchaseOrder, PurchaseRequisition, GR/GI).
  // Matches both orders: "No PO" and "PO No" / "Batch No".
  { kind: "id", re: /no\.?[_\s-]?(po|do|pr|so|sj|dok|doc|invoice|inv|faktur|batch|lot|seri|serial|reg)\b|\b(po|do|pr|so|sj|dok|doc|invoice|inv|faktur|batch|lot|seri|serial)[_\s.-]?(no|number|#)\b|\bserial\b|barcode|\bimei\b|no\.?\s?polisi|nopol|\bnpk\b/i },

  // ── Free text: scrubbed and length-capped, never sent whole ──
  // api_saran (suggestion box), complaint text, NC root-cause notes
  { kind: "freetext", re: /keterangan|catatan|\bremark|komentar|comment|\bsaran\b|deskripsi|description|uraian|\bnotes?\b|complaint|keluhan|penyebab|root\s?cause|tindakan|\baction\b|temuan|kronologi/i },

  // ── Money ──
  { kind: "money", re: /rupiah|\bidr\b|\brp\b|harga|\bbiaya\b|\bcost\b|price|amount|\bnilai\b|budget|anggaran|revenue|omzet|penjualan|sales|saving|\bmio\b/i },
];

// Machine/asset identifiers look like IDs but are not confidential, and masking
// them would make the answer unreadable ("MESIN_a1b2 rusak 18 kali").
const KEEP_OVERRIDE = /mesin|machine|\bline\b|equipment|asset|\bunit\b|\bplant\b|\bshift\b|\barea\b|departemen|department|kategori|category|produk|product|material|\bsku\b|tanggal|\bdate\b|bulan|month|tahun|year|jam|hour/i;

export function classifyColumn(name) {
  const raw = String(name || "");
  for (const rule of COLUMN_RULES) {
    if (!rule.re.test(raw)) continue;
    // A machine/asset/date column never gets pseudonymized or dropped
    if (rule.kind !== "drop" && KEEP_OVERRIDE.test(raw)) return "keep";
    if (rule.kind === "drop" && KEEP_OVERRIDE.test(raw) && !/e-?mail|telp|phone|\bnik\b|ktp|npwp|password|token/i.test(raw)) return "keep";
    return rule.kind;
  }
  return "keep";
}

// ── Value-level scrubbing (applies everywhere, one-way) ──────────────────────
const VALUE_PATTERNS = [
  { label: "[EMAIL]",  re: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g },
  { label: "[NPWP]",   re: /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g },
  { label: "[TELP]",   re: /(?:\+?62|0)8\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,5}\b/g },
  // A long run of digits is an identifier only when it stands alone. The
  // lookarounds stop it swallowing the fractional part of a measurement:
  // "11.052631578947368" must stay a number, not become "11.[NO_ID]".
  { label: "[NO_ID]",  re: /(?<![\d.,])\d{10,}(?![\d.,])/g },
];

const NON_IDENTIFIER = /^(\s*|-|—|n\/?a|null|nil|kosong|\(blank\)|blank|total|grand total|subtotal|semua|all|others?|lain-?lain|\d+([.,]\d+)?%?)$/i;

const parseIdNumber = (v) => {
  const s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (!s) return NaN;
  // Indonesian format: "." thousands, "," decimals
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/(\d)\.(?=\d{3}\b)/g, "$1");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Creates a per-request sanitizer.
 *
 * @param {object} [opts]
 * @param {string} [opts.secret]    HMAC secret (defaults to JWT_SECRET)
 * @param {string} [opts.moneyMode] "off" | "relative"
 */
export function createSanitizer(opts = {}) {
  const secret = opts.secret || process.env.JWT_SECRET || "jwt_secret_key";
  const moneyMode = opts.moneyMode || SANITIZER_CONFIG.moneyMode;

  const forward = new Map();  // original (lowercased) -> token
  const reverse = new Map();  // token -> original
  const stats = { pseudonymized: 0, dropped: 0, moneyColumns: 0, uniqueEntities: 0, truncatedText: 0 };

  const PREFIX = { person: "ORANG", org: "MITRA", id: "DOK" };

  function tokenFor(value, kind) {
    const original = String(value).trim();
    const key = `${kind}:${original.toLowerCase()}`;
    if (forward.has(key)) return forward.get(key);

    const digest = crypto.createHmac("sha256", secret).update(key).digest("hex").slice(0, 4);
    let token = `${PREFIX[kind] || "DATA"}_${digest}`;

    // Collision: same token, different original — extend until unique
    let extra = 4;
    while (reverse.has(token) && reverse.get(token) !== original && extra <= 12) {
      extra += 2;
      token = `${PREFIX[kind] || "DATA"}_${crypto.createHmac("sha256", secret).update(key).digest("hex").slice(0, extra)}`;
    }

    forward.set(key, token);
    reverse.set(token, original);
    stats.uniqueEntities += 1;
    return token;
  }

  /** One-way removal of contact details / national IDs from any string. */
  function scrubValue(text) {
    let out = String(text ?? "");

    // A measurement is never a contact detail or an identifier. Skipping these
    // outright also protects long decimals that Power BI exports at full float
    // precision (e.g. "11.052631578947368").
    if (looksNumeric(out)) return out;

    for (const { label, re } of VALUE_PATTERNS) {
      if (re.test(out)) {
        out = out.replace(re, label);
        stats.dropped += 1;
      }
      re.lastIndex = 0;
    }
    return out;
  }

  function pseudonymizeCell(value, kind) {
    const raw = String(value ?? "");
    if (!raw.trim() || NON_IDENTIFIER.test(raw.trim())) return raw;
    stats.pseudonymized += 1;
    return tokenFor(raw, kind);
  }

  /** Replaces already-known real values inside free text with their tokens. */
  function maskKnownEntities(text) {
    let out = String(text ?? "");
    if (!reverse.size) return out;
    // Longest first, so "PT Sumber Makmur Jaya" wins over "PT Sumber Makmur"
    const originals = [...reverse.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [token, original] of originals) {
      if (original.length < 3) continue;
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(escaped, "gi"), token);
    }
    return out;
  }

  /** Question / history text: drop contacts, then mask entities we already know. */
  function sanitizeText(text) {
    return maskKnownEntities(scrubValue(text));
  }

  const FREETEXT_MAX = Number(process.env.AI_FREETEXT_MAX_CHARS ?? 160);

  function sanitizeFreetext(value) {
    const scrubbed = maskKnownEntities(scrubValue(value));
    if (scrubbed.length <= FREETEXT_MAX) return scrubbed;
    stats.truncatedText += 1;
    return `${scrubbed.slice(0, FREETEXT_MAX)}…`;
  }

  /**
   * Pass 1 — register every identity in the snapshot before any free text is
   * processed, so a supplier named in visual 1's notes column is still masked when
   * that supplier only appears as a proper column value in visual 5.
   */
  function registerEntities(snapshot) {
    for (const visual of snapshot?.visuals || []) {
      const columns = Array.isArray(visual.columns) ? visual.columns : [];
      const kinds = columns.map(classifyColumn);
      columns.forEach((_, i) => {
        if (!["person", "org", "id"].includes(kinds[i])) return;
        for (const row of visual.rows || []) {
          const cell = row?.[i];
          const raw = String(cell ?? "").trim();
          if (!raw || NON_IDENTIFIER.test(raw)) continue;
          tokenFor(raw, kinds[i]);
        }
      });
    }
  }

  function sanitizeVisual(visual) {
    const columns = Array.isArray(visual.columns) ? visual.columns : [];
    const kinds = columns.map(classifyColumn);

    const keepIdx = [];
    const outColumns = [];
    columns.forEach((col, i) => {
      if (kinds[i] === "drop") return;            // column removed entirely
      keepIdx.push(i);
      outColumns.push(scrubValue(col));
    });

    const droppedCols = columns.length - outColumns.length;
    if (droppedCols > 0) stats.dropped += droppedCols;

    // Money columns in "relative" mode: absolute values -> share of column total
    const moneyTotals = {};
    if (moneyMode === "relative") {
      keepIdx.forEach((srcIdx, outIdx) => {
        if (kinds[srcIdx] !== "money") return;
        const total = (visual.rows || []).reduce((sum, row) => {
          const n = parseIdNumber(row?.[srcIdx]);
          return Number.isFinite(n) ? sum + Math.abs(n) : sum;
        }, 0);
        if (total > 0) {
          moneyTotals[outIdx] = total;
          stats.moneyColumns += 1;
        }
      });
    }

    const rows = (visual.rows || []).map((row) =>
      keepIdx.map((srcIdx, outIdx) => {
        const kind = kinds[srcIdx];
        const cell = row?.[srcIdx];

        if (kind === "person" || kind === "org" || kind === "id") {
          return pseudonymizeCell(cell, kind);
        }
        if (kind === "freetext") {
          return sanitizeFreetext(cell);
        }
        if (kind === "money" && moneyTotals[outIdx]) {
          const n = parseIdNumber(cell);
          if (!Number.isFinite(n)) return "[NILAI]";
          return `${((Math.abs(n) / moneyTotals[outIdx]) * 100).toFixed(1)}%`;
        }
        return scrubValue(cell);
      })
    );

    const outColumnsLabelled = outColumns.map((col, outIdx) =>
      moneyTotals[outIdx] ? `${col} (% dari total kolom)` : col
    );

    return {
      ...visual,
      title: scrubValue(visual.title),
      columns: outColumnsLabelled,
      rows,
      droppedColumns: droppedCols || undefined,
    };
  }

  /** Filter/slicer descriptions look like "Table.Column = a, b" */
  function sanitizeFilterLine(line) {
    const raw = String(line ?? "");
    const m = raw.match(/^(.*?)\s(=|bukan|\S+)\s([\s\S]*)$/);
    if (!m) return scrubValue(raw);

    const [, label, op, values] = m;
    const kind = classifyColumn(label);

    if (kind === "drop") {
      stats.dropped += 1;
      return `${label} ${op} [DISAMARKAN]`;
    }
    if (kind === "person" || kind === "org" || kind === "id") {
      const masked = values
        .split(",")
        .map((v) => {
          const trimmed = v.trim();
          const suffix = trimmed.match(/\(\+\d+ lainnya\)$/)?.[0];
          if (suffix) return suffix;
          return pseudonymizeCell(trimmed, kind);
        })
        .join(", ");
      return `${label} ${op} ${masked}`;
    }
    return scrubValue(raw);
  }

  function sanitizeSnapshot(snapshot) {
    if (!snapshot) return snapshot;

    registerEntities(snapshot);                                   // pass 1
    const visuals = (snapshot.visuals || []).map(sanitizeVisual); // pass 2

    return {
      ...snapshot,
      visuals,
      filters: (snapshot.filters || []).map(sanitizeFilterLine),
      slicers: (snapshot.slicers || []).map(sanitizeFilterLine),
      pageNotes: (snapshot.pageNotes || []).map(scrubValue),
    };
  }

  /**
   * The domain-knowledge pack is internal documentation, and an audit of
   * knowledge/powerbi-analyst/ found three things in it that must not leave the
   * network:
   *   1. the Azure tenant GUID (semantic-model-registry.md header)
   *   2. named suppliers ("Supplier AJI", "Supplier Bangun Lestari" in SKILL.md)
   *   3. hardcoded product/quality spec bands ("% TS 16,01 - 16,3",
   *      "Standar CMD 1 (51)") — trade-secret thresholds, and useless to the model
   *      anyway because the values it compares against come from the snapshot.
   */
  function sanitizeKnowledge(text) {
    let out = String(text ?? "");
    if (!out) return out;

    // 1) Any GUID (tenant / workspace / model ids)
    out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, () => {
      stats.dropped += 1;
      return "[GUID_DIHAPUS]";
    });

    // 2) Named suppliers — pseudonymized so the model can still reason about them
    out = out.replace(/\bSupplier\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,3})\b/g, (match, name) => {
      // Skip generic phrases like "Supplier Dairy Service" (a dashboard name)
      if (/^(Dairy|Scorecards?|Ranking|Name|Data|Report|Dashboard)\b/i.test(name)) return match;
      return `Supplier ${tokenFor(name, "org")}`;
    });

    // 3) Numeric spec bands and hardcoded standards
    out = out
      .replace(/(%\s*(?:TS|pH|Brix|Suhu)\s*)[\d.,]+(?:\s*-\s*[\d.,]+)?/gi, (m, head) => {
        stats.dropped += 1;
        return `${head}[SPEC]`;
      })
      .replace(/(Standar\s+CMD\s*\d\s*)\(\s*\d+\s*\)/gi, (m, head) => {
        stats.dropped += 1;
        return `${head}([SPEC])`;
      })
      .replace(/\bCMD\s*([23])\s*\(\s*\d{2,}\s*\)/gi, (m, line) => {
        stats.dropped += 1;
        return `CMD ${line} ([SPEC])`;
      });

    return scrubValue(out);
  }

  /** Turns tokens in the model's answer back into the real values. */
  function restore(text) {
    let out = String(text ?? "");
    if (!reverse.size) return out;
    for (const [token, original] of reverse) {
      out = out.replace(new RegExp(token, "g"), original);
    }
    return out;
  }

  return {
    enabled: true,
    moneyMode,
    sanitizeSnapshot,
    sanitizeText,
    sanitizeKnowledge,
    restore,
    stats,
    // Testing/inspection only — never log or return these values
    _reverse: reverse,
  };
}

/** No-op sanitizer, used when AI_SANITIZE is disabled. */
export function createPassthrough() {
  return {
    enabled: false,
    moneyMode: "off",
    sanitizeSnapshot: (s) => s,
    sanitizeText: (t) => t,
    sanitizeKnowledge: (t) => t,
    restore: (t) => t,
    stats: { pseudonymized: 0, dropped: 0, moneyColumns: 0, uniqueEntities: 0, truncatedText: 0 },
    _reverse: new Map(),
  };
}

export function getSanitizer(opts = {}) {
  return SANITIZER_CONFIG.enabled ? createSanitizer(opts) : createPassthrough();
}
