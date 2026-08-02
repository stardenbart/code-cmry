// ─────────────────────────────────────────────────────────────────────────────
// CODE AI Navigator — the assistant on the home screen.
//
// Different job from the dashboard assistant: it never reads dashboard DATA. It
// only knows the CATALOGUE (title, department, description, who owns it, whether
// this user may open it) and helps people find the right dashboard, understand a
// term, or reach the right PIC.
//
// That makes it cheap: the whole catalogue of 44 dashboards costs roughly the
// same as one small visual, so navigator questions run on the fast tier and
// barely touch the daily allowance.
// ─────────────────────────────────────────────────────────────────────────────

const stripHtml = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const DESC_MAX = Number(process.env.AI_NAV_DESC_CHARS ?? 220);

/**
 * Renders the dashboard catalogue for the prompt.
 *
 * @param {Array} dashboards  [{ id, title, department, description, hasAccess, pic_emails }]
 */
export function buildCatalog(dashboards) {
  const byDept = new Map();
  for (const d of dashboards) {
    const dept = d.department || "Lainnya";
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(d);
  }

  const lines = ["=== KATALOG DASHBOARD CODE ==="];
  for (const [dept, items] of byDept) {
    lines.push(`\n## ${dept}`);
    for (const d of items) {
      const desc = stripHtml(d.description).slice(0, DESC_MAX);
      // "punya PIC" only — the addresses themselves stay server-side
      const flags = [
        d.hasAccess ? null : "USER BELUM PUNYA AKSES",
        d.pic?.length ? "ada PIC" : null,
      ].filter(Boolean);
      lines.push(
        `- [id:${d.id}] ${d.title}${flags.length ? `  (${flags.join(", ")})` : ""}` +
        (desc ? `\n    ${desc}` : "")
      );
    }
  }
  return lines.join("\n");
}

export function buildNavigatorPrompt({ userName, userDept, catalog, glossary }) {
  return [
    'Kamu adalah "CODE AI Navigator" — pemandu platform CODE (Cimory Operational Digital Enhancement) di CMD Plant Sentul.',
    `Kamu membantu ${userName || "user"}${userDept ? ` dari departemen ${userDept}` : ""} menemukan dashboard yang tepat.`,
    "",
    "TUGASMU:",
    "1. Arahkan user ke dashboard yang paling relevan dengan kebutuhannya. Boleh lebih dari satu.",
    "2. Jelaskan singkat APA yang bisa dilihat di dashboard itu, supaya user tahu apakah itu yang dia cari.",
    "3. Kalau user menanyakan arti istilah/KPI, jelaskan singkat memakai GLOSARIUM di bawah.",
    "4. ONBOARDING: kalau user baru/bertanya \"dashboard apa yang perlu saya pantau\", pilihkan 3-5 dashboard paling relevan untuk departemennya, urut dari yang paling penting, dan katakan kenapa.",
    "5. PETA DATA: kalau user bertanya \"data apa saja yang ada di CODE\", ringkas cakupannya per departemen (bukan daftar 44 judul satu per satu).",
    "6. PIC: kalau user bertanya siapa yang harus dihubungi, sebutkan dashboard yang relevan lalu katakan PIC-nya akan ditampilkan di kartu di bawah jawabanmu. JANGAN menulis alamat email — kamu memang tidak diberi datanya.",
    "7. Kalau tidak ada dashboard yang cocok, katakan terus terang — jangan mengarang nama dashboard.",
    "",
    "ATURAN WAJIB:",
    "- HANYA gunakan dashboard yang ada di KATALOG. Dilarang keras menyebut nama dashboard di luar katalog.",
    "- Kamu TIDAK punya akses ke isi/angka dashboard. Jangan pernah menyebut angka, tren, atau kesimpulan data. Kalau user bertanya angka, arahkan dia membuka dashboardnya lalu memakai tombol CODE AI di dalam dashboard tersebut.",
    "- Kalau dashboard ditandai (USER BELUM PUNYA AKSES), tetap sebutkan, tapi jelaskan bahwa user perlu request akses dulu.",
    // The cap exists because a long numbered list inside `answer` used to blow
    // the output budget and truncate the JSON. Coverage questions are the one
    // case that genuinely needs more room — summarising 44 dashboards across ~10
    // departments in 70 words forces the model to drop most of them.
    "- Jawab ringkas: maksimal 70 kata untuk field `answer`. Khusus pertanyaan cakupan data (\"data apa saja yang tersedia\"), boleh sampai 130 kata dan sebutkan nama departemennya.",
    "- Bahasa Indonesia.",
    "- Maksimal 4 dashboard, dan `reason` maksimal 15 kata per dashboard.",
    "- Jangan menulis daftar dashboard bernomor panjang di dalam `answer` — detailnya sudah ditampilkan sebagai kartu terpisah dari field `dashboards`. Cukup satu kalimat pengantar.",
    "- Jangan menampilkan `[id:NN]` di dalam jawabanmu — id itu hanya untuk sistem.",
    "",
    "FORMAT OUTPUT — WAJIB JSON VALID, tanpa teks lain, tanpa markdown fence:",
    "{",
    '  "answer": "jawaban singkat untuk user",',
    '  "dashboards": [{ "id": 44, "reason": "alasan singkat kenapa dashboard ini cocok" }],',
    '  "followUp": ["saran pertanyaan lanjutan", "maksimal 2"]',
    "}",
    'Kalau tidak ada dashboard yang relevan, isi "dashboards" dengan array kosong.',
    "",
    catalog,
    glossary ? `\n=== GLOSARIUM ISTILAH ===\n${glossary}` : "",
  ].join("\n");
}

const unescapeJsonString = (s) =>
  s.replace(/\\n/g, "\n")
   .replace(/\\t/g, "\t")
   .replace(/\\"/g, '"')
   .replace(/\\\\/g, "\\");

/**
 * Salvages a reply whose JSON is incomplete — typically because the model hit
 * its output limit mid-object. The prose is still perfectly usable; only the
 * buttons are lost. Without this the raw `{ "answer": "...` would be shown to
 * the user verbatim.
 */
function salvage(raw) {
  const answerMatch = raw.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!answerMatch) return null;

  const answer = unescapeJsonString(answerMatch[1]).trim();
  if (answer.length < 5) return null;

  // Dashboard ids that made it into the truncated text are still trustworthy —
  // resolveDashboardRefs validates them against the catalogue anyway.
  const dashboards = [...raw.matchAll(/"id"\s*:\s*(\d+)\s*,\s*"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => ({ id: Number(m[1]), reason: unescapeJsonString(m[2]) }));

  return { answer, dashboards, followUp: [], salvaged: true };
}

/** Extracts the JSON object from a model reply that may be fenced or padded. */
export function parseNavigatorReply(text) {
  const raw = String(text || "").trim();

  const candidates = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim(),
  ];

  const braced = raw.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && typeof parsed.answer === "string") {
        return {
          answer: parsed.answer.trim(),
          dashboards: Array.isArray(parsed.dashboards) ? parsed.dashboards : [],
          followUp: Array.isArray(parsed.followUp) ? parsed.followUp.slice(0, 2) : [],
        };
      }
    } catch { /* try the next shape */ }
  }

  // Incomplete JSON — recover the prose rather than showing braces to the user
  const rescued = salvage(raw);
  if (rescued) return { ...rescued, malformed: true };

  // Not JSON at all. If it still looks like structured output, never show it raw.
  if (/^[\s]*[{[]/.test(raw)) {
    return {
      answer: "Maaf, jawabannya tidak lengkap. Coba tanyakan sekali lagi dengan kalimat yang lebih spesifik.",
      dashboards: [],
      followUp: [],
      malformed: true,
    };
  }

  // Plain prose — the model ignored the format but the answer is readable.
  return { answer: raw, dashboards: [], followUp: [], malformed: true };
}

/**
 * Keeps only references to dashboards that really exist, and attaches the data
 * the UI needs to render a button (never trusting ids the model invented).
 */
export function resolveDashboardRefs(refs, dashboards) {
  const byId = new Map(dashboards.map((d) => [Number(d.id), d]));
  const seen = new Set();
  const out = [];

  for (const ref of refs) {
    const id = Number(ref?.id);
    const dash = byId.get(id);
    if (!dash || seen.has(id)) continue;
    seen.add(id);

    out.push({
      id: dash.id,
      title: dash.title,
      department: dash.department,
      hasAccess: Boolean(dash.hasAccess),
      canAskAI: Boolean(dash.hasAccess && dash.reportGuid),
      reason: String(ref.reason || "").slice(0, 200),
      // Attached from the database, never from the model
      pic: Array.isArray(dash.pic) ? dash.pic : [],
    });
  }
  return out;
}
