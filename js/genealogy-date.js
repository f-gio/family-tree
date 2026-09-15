export const GENEALOGY_DATE_TYPES = Object.freeze(["exact", "year", "about", "between", "unknown"]);

function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 9999 ? year : null;
}

function validExact(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : "";
}

export function normalizeGenealogyDate(value, legacyExact = "") {
  if (value && typeof value === "object" && GENEALOGY_DATE_TYPES.includes(value.type)) {
    if (value.type === "exact") return validExact(value.value) ? { type: "exact", value: value.value } : { type: "unknown" };
    if (value.type === "year" || value.type === "about") {
      const year = validYear(value.year);
      return year ? { type: value.type, year } : { type: "unknown" };
    }
    if (value.type === "between") {
      const from = validYear(value.from), to = validYear(value.to);
      return from && to && from <= to ? { type: "between", from, to } : { type: "unknown" };
    }
    return { type: "unknown" };
  }
  const exact = validExact(legacyExact || value);
  return exact ? { type: "exact", value: exact } : { type: "unknown" };
}

export function formatGenealogyDate(value, legacyExact = "", locale = "fr-FR") {
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type === "unknown") return "—";
  if (date.type === "year") return String(date.year);
  if (date.type === "about") return `vers ${date.year}`;
  if (date.type === "between") return `entre ${date.from} et ${date.to}`;
  const [year, month, day] = date.value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function genealogyDateYears(value, legacyExact = "") {
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type === "exact") return [Number(date.value.slice(0, 4))];
  if (date.type === "year" || date.type === "about") return [date.year];
  if (date.type === "between") return [date.from, date.to];
  return [];
}

export function genealogyDateSortValue(value, legacyExact = "") {
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type === "exact") return Number(date.value.replaceAll("-", ""));
  if (date.type === "year" || date.type === "about") return date.year * 10000 + 500;
  if (date.type === "between") return Math.round((date.from + date.to) / 2) * 10000 + 500;
  return null;
}

export function genealogyDateMatchesYear(value, legacyExact, year) {
  const searched = validYear(year);
  if (!searched) return true;
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type === "between") return searched >= date.from && searched <= date.to;
  return genealogyDateYears(date).includes(searched);
}

export function genealogyDateSearchText(value, legacyExact = "") {
  return formatGenealogyDate(value, legacyExact);
}
