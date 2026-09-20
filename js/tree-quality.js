import { normalizeGenealogyDate } from "./genealogy-date.js";

export const QUALITY_CATEGORIES = Object.freeze({
  missing: "missing",
  chronology: "chronology",
  duplicates: "duplicates",
  relations: "relations"
});

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeOf(person, prefix = "") {
  const text = prefix ? person?.[`${prefix}Place`] : person?.place;
  const info = prefix ? person?.[`${prefix}PlaceInfo`] : person?.birthPlaceInfo;
  return String(text || info?.name || "").trim();
}

function dateInterval(value, legacyExact = "") {
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type === "exact") {
    const day = Number(date.value.replaceAll("-", ""));
    return { min: day, max: day, type: date.type };
  }
  if (date.type === "year" || date.type === "about") return { min: date.year * 10000 + 101, max: date.year * 10000 + 1231, type: date.type };
  if (date.type === "between") return { min: date.from * 10000 + 101, max: date.to * 10000 + 1231, type: date.type };
  return null;
}

function personDate(person, prefix) {
  return dateInterval(person?.[`${prefix}DateInfo`], person?.[`${prefix}Date`] || "");
}

function dateLabel(date) {
  if (!date) return "date inconnue";
  if (date.min === date.max) return String(date.min);
  return `${Math.floor(date.min / 10000)}–${Math.floor(date.max / 10000)}`;
}

function addDiagnostic(diagnostics, category, message, peopleIds = [], familyId = "", field = "") {
  diagnostics.push({
    id: `${category}:${familyId || peopleIds.join(":")}:${diagnostics.length}`,
    category,
    message,
    peopleIds: [...peopleIds],
    ...(familyId ? { familyId } : {}),
    ...(field ? { field } : {})
  });
}

function hasDeathEvidence(person) {
  return Boolean(personDate(person, "death") || placeOf(person, "death"));
}

function compatibleBirthDates(left, right) {
  const a = personDate(left, "birth"), b = personDate(right, "birth");
  if (!a || !b || a.max < b.min || b.max < a.min) return false;
  const placeA = normalizeText(placeOf(left)), placeB = normalizeText(placeOf(right));
  return (placeA && placeB && placeA === placeB) || (a.type === "exact" && b.type === "exact" && a.min === b.min);
}

function detectMissing(people, diagnostics) {
  for (const person of people) {
    const name = `${person.firstName || ""} ${person.lastName || ""}`.trim() || "Personne sans nom";
    if (!String(person.firstName || "").trim()) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Prénom non renseigné`, [person.id], "", "firstName");
    if (!String(person.lastName || "").trim()) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Nom de naissance non renseigné`, [person.id], "", "lastName");
    if (!personDate(person, "birth")) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Date de naissance non renseignée`, [person.id], "", "birthDate");
    if (!placeOf(person)) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Lieu de naissance non renseigné`, [person.id], "", "birthPlace");
    if (hasDeathEvidence(person)) {
      if (!personDate(person, "death")) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Date de décès non renseignée`, [person.id], "", "deathDate");
      if (!placeOf(person, "death")) addDiagnostic(diagnostics, QUALITY_CATEGORIES.missing, `${name} · Lieu de décès non renseigné`, [person.id], "", "deathPlace");
    }
  }
}

function detectChronology(people, families, diagnostics) {
  const byId = new Map(people.map(person => [person.id, person]));
  for (const person of people) {
    const birth = personDate(person, "birth"), death = personDate(person, "death");
    if (birth && death && birth.min > death.max) addDiagnostic(diagnostics, QUALITY_CATEGORIES.chronology, `${person.firstName || "Personne"} ${person.lastName || ""} · Naissance certainement postérieure au décès`, [person.id]);
  }
  for (const family of families) {
    const union = dateInterval(family.unionDateInfo, family.marriageDate || family.unionDate || "");
    if (!union) continue;
    for (const personId of family.partnerIds || []) {
      const person = byId.get(personId);
      if (!person) continue;
      const birth = personDate(person, "birth"), death = personDate(person, "death");
      const name = `${person.firstName || "Personne"} ${person.lastName || ""}`.trim();
      if (birth && union.max < birth.min) addDiagnostic(diagnostics, QUALITY_CATEGORIES.chronology, `${name} · Union datée avant sa naissance (${dateLabel(union)})`, [personId], family.id);
      if (death && union.min > death.max) addDiagnostic(diagnostics, QUALITY_CATEGORIES.chronology, `${name} · Union datée après son décès (${dateLabel(union)})`, [personId], family.id);
    }
  }
}

function detectDuplicates(people, diagnostics) {
  const groups = new Map();
  for (const person of people) {
    const key = normalizeText(`${person.firstName || ""} ${person.lastName || ""}`);
    if (!key || !person.firstName || !person.lastName) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  for (const candidates of groups.values()) {
    for (let index = 0; index < candidates.length; index++) {
      for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex++) {
        const left = candidates[index], right = candidates[otherIndex];
        if (!compatibleBirthDates(left, right)) continue;
        addDiagnostic(diagnostics, QUALITY_CATEGORIES.duplicates, `Doublon potentiel · ${left.firstName} ${left.lastName}`, [left.id, right.id]);
      }
    }
  }
}

function detectRelations(people, families, diagnostics) {
  const peopleIds = new Set(people.map(person => person.id));
  for (const family of families) {
    const partners = Array.isArray(family.partnerIds) ? family.partnerIds : [];
    const children = Array.isArray(family.childIds) ? family.childIds : [];
    for (const id of [...partners, ...children]) {
      if (!peopleIds.has(id)) addDiagnostic(diagnostics, QUALITY_CATEGORIES.relations, `Personne référencée mais introuvable dans le foyer`, [id], family.id);
    }
    for (const id of partners) {
      if (children.includes(id)) addDiagnostic(diagnostics, QUALITY_CATEGORIES.relations, `Même personne présente comme partenaire et enfant dans le même foyer`, [id], family.id);
    }
    for (const link of Array.isArray(family.parentChildLinks) ? family.parentChildLinks : []) {
      if (!partners.includes(link.parentId) || !children.includes(link.childId)) addDiagnostic(diagnostics, QUALITY_CATEGORIES.relations, `Filiation incohérente avec les membres du foyer`, [link.parentId, link.childId], family.id);
    }
  }
}

export function analyzeTreeQuality({ people = [], families = [] } = {}) {
  const diagnostics = [];
  const peopleSnapshot = people.map(person => ({ ...person }));
  const familiesSnapshot = families.map(family => ({ ...family }));
  detectMissing(peopleSnapshot, diagnostics);
  detectChronology(peopleSnapshot, familiesSnapshot, diagnostics);
  detectDuplicates(peopleSnapshot, diagnostics);
  detectRelations(peopleSnapshot, familiesSnapshot, diagnostics);
  const counts = Object.fromEntries(Object.values(QUALITY_CATEGORIES).map(category => [category, diagnostics.filter(item => item.category === category).length]));
  return { diagnostics, counts, total: diagnostics.length };
}
