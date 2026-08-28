const MONTHS = new Map([
  ["januari", 1], ["februari", 2], ["maret", 3], ["april", 4],
  ["mei", 5], ["juni", 6], ["juli", 7], ["agustus", 8],
  ["september", 9], ["oktober", 10], ["november", 11], ["desember", 12],
]);

const DAY_MS = 86_400_000;
const pad = (value) => String(value).padStart(2, "0");

function dateAt(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(date, count) {
  return new Date(date.getTime() + count * DAY_MS);
}

function zonedToday(now, timezone) {
  const instant = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
    });
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((item) => item.type !== "literal").map((item) => [item.type, Number(item.value)]));
  return dateAt(parts.year, parts.month, parts.day);
}

function period(label, from, to, grain, comparisonKey, warnings) {
  return {
    label,
    from: formatDate(from),
    to: formatDate(to),
    grain,
    comparisonKey,
    ...(warnings?.length ? { warnings } : {}),
  };
}

function currentMonth(today, key = "current_month", label = "Bulan ini") {
  return period(label, dateAt(today.getUTCFullYear(), today.getUTCMonth() + 1, 1), today,
    "day", key);
}

function validIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = dateAt(Number(match[1]), Number(match[2]), Number(match[3]));
  return formatDate(date) === value ? date : null;
}

function explicitRange(question) {
  const match = /\b(\d{1,2})\s*(?:-|sampai|hingga)\s*(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\b/i.exec(question);
  if (!match) return null;
  const month = MONTHS.get(match[3].toLowerCase());
  const from = dateAt(Number(match[4]), month, Number(match[1]));
  const to = dateAt(Number(match[4]), month, Number(match[2]));
  if (from > to || from.getUTCMonth() + 1 !== month || to.getUTCMonth() + 1 !== month) return null;
  return {
    index: match.index,
    value: period(`${match[1]}-${match[2]} ${match[3]} ${match[4]}`, from, to,
      "day", "explicit_range"),
  };
}

function relativeCandidates(question, today) {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const weekday = today.getUTCDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  const thisMonday = addDays(today, -mondayOffset);
  const candidates = [
    ["hari ini", () => period("Hari ini", today, today, "day", "today")],
    ["kemarin", () => period("Kemarin", addDays(today, -1), addDays(today, -1), "day", "yesterday")],
    ["minggu lalu", () => period("Minggu lalu", addDays(thisMonday, -7), addDays(thisMonday, -1), "day", "previous_week")],
    ["minggu ini", () => period("Minggu ini", thisMonday, today, "day", "current_week")],
    ["bulan lalu", () => {
      const previousEnd = addDays(dateAt(year, month, 1), -1);
      return period("Bulan lalu", dateAt(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth() + 1, 1),
        previousEnd, "day", "previous_month");
    }],
    ["bulan ini", () => currentMonth(today)],
    ["tahun lalu", () => period("Tahun lalu", dateAt(year - 1, 1, 1), dateAt(year - 1, 12, 31),
      "month", "previous_year")],
    ["tahun ini", () => period("Tahun ini", dateAt(year, 1, 1), today, "month", "current_year")],
    ["aktual", () => currentMonth(today, "current", "Aktual")],
    ["saat ini", () => currentMonth(today, "current", "Aktual")],
    ["sekarang", () => currentMonth(today, "current", "Aktual")],
  ];

  return candidates.flatMap(([needle, build]) => {
    const index = question.indexOf(needle);
    return index === -1 ? [] : [{ index, value: build() }];
  });
}

function configuredDefault(defaults) {
  const value = defaults?.currentPeriod;
  const from = validIsoDate(value?.from);
  const to = validIsoDate(value?.to);
  if (!from || !to || from > to) return null;
  return period(
    typeof value.label === "string" && value.label.trim() ? value.label.trim() : "Periode dashboard",
    from,
    to,
    typeof value.grain === "string" && value.grain.trim() ? value.grain.trim() : "day",
    "configured_default",
    ["PERIOD_DEFAULTED"],
  );
}

export function resolvePeriods(question, now = new Date(), timezone = "Asia/Jakarta", defaults = {}) {
  const text = typeof question === "string" ? question.toLocaleLowerCase("id-ID") : "";
  const today = zonedToday(now, timezone);
  const candidates = relativeCandidates(text, today);
  const range = explicitRange(text);
  if (range) candidates.push(range);

  const resolved = candidates.sort((a, b) => a.index - b.index).map((item) => item.value);
  const unique = [...new Map(resolved.map((item) => [
    `${item.from}|${item.to}|${item.comparisonKey}`, item,
  ])).values()];
  if (unique.length) return unique;

  const configured = configuredDefault(defaults);
  if (configured) return [configured];
  const fallback = currentMonth(today, "current", "Aktual");
  fallback.warnings = ["PERIOD_DEFAULTED"];
  return [fallback];
}

