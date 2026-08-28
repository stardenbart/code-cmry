// Translasi hasil DAX/ExecuteQueries menjadi label bisnis yang manusiawi.
//
// Nama measure teknis (mis. 'MeasureTable'[OT_HOURS]) tidak boleh muncul pada
// jawaban user. Modul ini memetakan setiap binding ke label manusia dan
// mengenali keempat bentuk identifier: 'Table'[Measure], Table[Measure],
// [Measure], dan Measure — juga key JSON ExecuteQueries yang memakai bentuk itu.
//
// Prioritas label: human_name KPI (bila ada) > caption visual > identifier yang
// di-humanize. Nilai dimensi TIDAK diubah; hanya nama kolom.

// Ambil nama measure inti dari bentuk apa pun -> lowercase kanonik.
export function canonicalKey(raw) {
  let s = String(raw ?? "").trim();
  const m = s.match(/\[([^\]]*)\]\s*$/); // ambil isi [...] terakhir
  if (m) s = m[1];
  s = s.replace(/^['"`]+|['"`]+$/g, "").trim();
  return s.toLowerCase();
}

// Humanize identifier teknis: buang table prefix & bracket, pisah underscore /
// camelCase, jadikan kalimat Sentence case.
export function humanizeIdentifier(raw) {
  let s = String(raw ?? "");
  const m = s.match(/\[([^\]]*)\]\s*$/);
  if (m) s = m[1];
  s = s.replace(/^['"`]+|['"`]+$/g, "");
  s = s
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "Nilai";
  s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelOf(binding) {
  const human = (binding.humanName || "").trim();
  if (human) return human;
  const caption = (binding.displayCaption || "").trim();
  if (caption) return caption;
  return humanizeIdentifier(binding.measureName);
}

function variantKeys(tableName, measureName) {
  const t = tableName ? String(tableName) : "";
  const measure = String(measureName ?? "");
  const keys = [];
  if (t) {
    keys.push(`'${t}'[${measure}]`);
    keys.push(`${t}[${measure}]`);
  }
  keys.push(`[${measure}]`);
  keys.push(measure);
  return keys;
}

export function buildLabelMap(bindings = []) {
  const map = new Map();
  for (const b of bindings) {
    if (!b || !b.measureName) continue;
    const label = labelOf(b);
    for (const k of variantKeys(b.tableName, b.measureName)) {
      if (!map.has(k)) map.set(k, label);
    }
    const ck = canonicalKey(b.measureName);
    if (!map.has(ck)) map.set(ck, label);
  }
  return map;
}

function bindingForColumn(bindings, columnKey) {
  const ck = canonicalKey(columnKey);
  return bindings.find((b) => canonicalKey(b.measureName) === ck) || null;
}

function dimensionLabelMap(dimensions = []) {
  const map = new Map();
  for (const dimension of dimensions) {
    const table = String(dimension?.table || "").trim();
    const column = String(dimension?.column || "").trim();
    const label = String(dimension?.humanName || column).trim();
    if (!column || !label) continue;
    for (const variant of variantKeys(table, column)) map.set(variant, label);
    map.set(canonicalKey(column), label);
  }
  return map;
}

export function labelDaxRows({ rows = [], bindings = [], dimensions = [] } = {}) {
  const map = buildLabelMap(bindings);
  const dimensionMap = dimensionLabelMap(dimensions);
  const keys = rows.length ? Object.keys(rows[0]) : [];

  // Label awal per kolom (measure -> label; selain itu -> humanize).
  const columns = keys.map((key) => {
    const label = map.get(key) || map.get(canonicalKey(key))
      || dimensionMap.get(key) || dimensionMap.get(canonicalKey(key))
      || humanizeIdentifier(key);
    return { key, label };
  });

  // Pastikan header unik: kolom dengan label sama diberi suffix pembeda yang
  // jelas (nama dashboard bila ada, kalau tidak nomor urut).
  const counts = {};
  for (const c of columns) counts[c.label] = (counts[c.label] || 0) + 1;
  const seen = {};
  for (const c of columns) {
    if (counts[c.label] > 1) {
      seen[c.label] = (seen[c.label] || 0) + 1;
      const b = bindingForColumn(bindings, c.key);
      const suffix = b && b.dashboardName ? ` (${b.dashboardName})` : ` (${seen[c.label]})`;
      c.label += suffix;
    }
  }

  const outRows = rows.map((r) => {
    const o = {};
    for (const c of columns) o[c.label] = r[c.key];
    return o;
  });
  return { rows: outRows, columns };
}

export function describeKpi(binding = {}) {
  return {
    name: labelOf(binding),
    definition: binding.definition || "",
    unit: binding.unit || null,
    numberFormat: binding.numberFormat || null,
  };
}
