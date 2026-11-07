import { normalizeGenealogyDate, formatGenealogyDate, genealogyDateSortValue } from "./genealogy-date.js";

export const LIFE_DATE_TYPES = Object.freeze(["exact", "year", "about", "before", "after", "attested", "between", "unknown"]);

const LIFE_EXTENDED_DATE_TYPES = new Set(["before", "after", "attested"]);

export const LIFE_EVENT_KINDS = Object.freeze(["census", "migration", "military", "studies", "other"]);

const LIFE_EVENT_KIND_LABELS = Object.freeze({
  census: "Recensement",
  migration: "Migration / déplacement",
  military: "Service militaire",
  studies: "Études / formation",
  other: "Autre événement"
});

export function lifeEventKindLabel(kind) {
  return LIFE_EVENT_KIND_LABELS[kind] || "";
}

export function normalizeLifeDate(value) {
  if (value && typeof value === "object" && LIFE_EXTENDED_DATE_TYPES.has(value.type)) {
    const exact = normalizeGenealogyDate({ type: "exact", value: value.value });
    if (exact.type === "exact") return { type: value.type, value: exact.value };
    return { type: "unknown" };
  }
  return normalizeGenealogyDate(value);
}

export function formatLifeDate(value) {
  const date = normalizeLifeDate(value);
  if (date.type === "before") return `avant ${formatGenealogyDate({ type: "exact", value: date.value })}`;
  if (date.type === "after") return `après ${formatGenealogyDate({ type: "exact", value: date.value })}`;
  if (date.type === "attested") return `attesté le ${formatGenealogyDate({ type: "exact", value: date.value })}`;
  return formatGenealogyDate(date);
}

export function lifeDateSortValue(value) {
  const date = normalizeLifeDate(value);
  if (LIFE_EXTENDED_DATE_TYPES.has(date.type)) return Number(date.value.replaceAll("-", ""));
  return genealogyDateSortValue(date);
}

export function buildLifeDate({ type, value = "", year = "", from = "", to = "" } = {}) {
  if (!LIFE_DATE_TYPES.includes(type)) return { ok: false, error: "Format de date inconnu." };
  if (type === "unknown") return { ok: true, date: { type: "unknown" } };
  if (type === "exact" || type === "before" || type === "after" || type === "attested") {
    const text = String(value || "").trim();
    if (!text) return { ok: true, date: null };
    const exact = normalizeGenealogyDate({ type: "exact", value: text });
    if (exact.type !== "exact") return { ok: false, error: "Choisissez une date valide." };
    return { ok: true, date: { type, value: exact.value } };
  }
  if (type === "year" || type === "about") {
    const text = String(year || "").trim();
    if (!text) return { ok: true, date: null };
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9999) return { ok: false, error: "Saisissez une année entre 1 et 9999." };
    return { ok: true, date: { type, year: parsed } };
  }
  const fromText = String(from || "").trim();
  const toText = String(to || "").trim();
  if (!fromText && !toText) return { ok: true, date: null };
  if (!fromText || !toText) return { ok: false, error: "Renseignez les deux bornes de la période." };
  const fromYear = Number(fromText);
  const toYear = Number(toText);
  if (!Number.isInteger(fromYear) || fromYear < 1 || fromYear > 9999 || !Number.isInteger(toYear) || toYear < 1 || toYear > 9999) {
    return { ok: false, error: "Saisissez des années entre 1 et 9999." };
  }
  if (fromYear > toYear) return { ok: false, error: "La première borne doit précéder la seconde." };
  return { ok: true, date: { type: "between", from: fromYear, to: toYear } };
}

export function personLifeList(person = {}, key) {
  return Array.isArray(person?.[key]) ? person[key] : [];
}

export function lifeAttestations(entry = {}) {
  return Array.isArray(entry?.attestations) ? entry.attestations : [];
}

export function validateLifeResidence(input = {}) {
  const errors = {};
  if (!String(input.place || "").trim()) errors.place = "Indiquez la commune ou le lieu.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateLifeProfession(input = {}) {
  const errors = {};
  if (!String(input.label || "").trim()) errors.label = "Indiquez la profession ou l'activité.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateLifeEvent(input = {}) {
  const errors = {};
  if (!LIFE_EVENT_KINDS.includes(input.kind)) errors.kind = "Choisissez un type d'événement.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function validateLifeAttestation(input = {}) {
  const errors = {};
  if (!input.date || input.date.type === "unknown") errors.date = "Choisissez la date de l'attestation.";
  return { ok: Object.keys(errors).length === 0, errors };
}

export function hasSimilarLifeAttestation(attestations = [], candidate = {}) {
  const candidateDate = formatLifeDate(candidate.date);
  if (!candidate.date || candidate.date.type === "unknown") return false;
  return lifeAttestations({ attestations }).some(attestation => attestation.id !== candidate.id
    && formatLifeDate(attestation.date) === candidateDate);
}

export function toggleIdInList(list = [], id) {
  const ids = Array.isArray(list) ? list.filter(value => typeof value === "string" && value) : [];
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}

export function compareLifeEntries(a = {}, b = {}) {
  const left = lifeDateSortValue(a.dateInfo);
  const right = lifeDateSortValue(b.dateInfo);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}
