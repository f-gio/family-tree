import { formatGenealogyDate, genealogyDateSortValue, normalizeGenealogyDate } from "./genealogy-date.js";
import { countryNameToIsoAlpha3, formatCompactPlace, toIsoAlpha3 } from "./place-format.js";
import { normalizeRelationType, normalizeEndType, RELATION_TYPE_LABELS, END_TYPE_LABELS } from "./family-relations.js";
import { formatLifeDate, lifeDateSortValue, lifeEventKindLabel } from "./life-journey.js";

function personName(item) {
  return [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ");
}

function normalizedEventFact(value = "") {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");
}

function isFundamentalJourneyEvent(entry = {}) {
  const kind = normalizedEventFact(entry.kind);
  const label = normalizedEventFact(entry.label);
  return ["birth", "death", "marriage", "union"].includes(kind)
    || ["naissance", "deces", "mariage", "union"].includes(label);
}

function journeyEventPlace(entry = {}) {
  const place = String(entry.place || "").trim();
  if (!place) return "";
  const code = toIsoAlpha3(entry.countryCode) || countryNameToIsoAlpha3(entry.country);
  return formatCompactPlace(place, { name: place, countryCode: code });
}

function exactUtcDate(value, legacyExact = "") {
  const date = normalizeGenealogyDate(value, legacyExact);
  if (date.type !== "exact") return null;
  const [year, month, day] = date.value.split("-").map(Number);
  const utc = new Date(Date.UTC(0, month - 1, day));
  utc.setUTCFullYear(year);
  return utc;
}

/**
 * Âge en années révolues à un événement. Le calcul n'a lieu que si la date de
 * naissance ET la date de l'événement sont complètes et exactes : toute date
 * partielle, approximative ou inconnue renvoie null, tout comme un résultat
 * négatif. L'âge n'est jamais ajouté à la naissance.
 */
export function lifeEventAgeAt(person, eventValue, eventLegacy = "") {
  const birth = exactUtcDate(person?.birthDateInfo, person?.birthDate);
  const event = exactUtcDate(eventValue, eventLegacy);
  if (!birth || !event) return null;
  let age = event.getUTCFullYear() - birth.getUTCFullYear();
  const beforeAnniversary = event.getUTCMonth() < birth.getUTCMonth()
    || (event.getUTCMonth() === birth.getUTCMonth() && event.getUTCDate() < birth.getUTCDate());
  if (beforeAnniversary) age -= 1;
  return age >= 0 ? age : null;
}

/**
 * Jalons de vie d'une personne : naissance, union(s) avec leurs partenaires et
 * leur éventuelle fin, décès. Seuls les événements réellement renseignés sont
 * retournés, dans l'ordre du parcours de vie (unions triées par date).
 * Pure : aucune dépendance DOM/Firestore, réutilisable par les tests.
 */
export function lifeTimelineEvents(person, { people = [], families = [] } = {}) {
  if (!person) return [];
  const byId = new Map(people.map(item => [item.id, item]));
  const events = [];

  const birthDate = formatGenealogyDate(person.birthDateInfo, person.birthDate);
  const birthPlace = formatCompactPlace(person.place, person.birthPlaceInfo);
  if (birthDate !== "—" || birthPlace) {
    events.push({ id: "birth", type: "birth", title: "Naissance", date: birthDate, detail: birthPlace, sortValue: genealogyDateSortValue(person.birthDateInfo, person.birthDate) });
  }

  // Une union n'existe que pour un couple : la personne doit être explicitement
  // dans `partnerIds` du foyer, et le foyer doit avoir exactement un autre
  // adulte (le conjoint), dont la fiche existe. Être enfant, parent ou ancêtre
  // d'une famille ne crée jamais d'événement « Union ».
  const unions = (families || [])
    .filter(family => {
      const partners = family.partnerIds || [];
      if (!partners.includes(person.id)) return false;
      const coParents = partners.filter(id => id !== person.id);
      return coParents.length === 1 && byId.has(coParents[0]);
    })
    .map(family => {
      const partners = (family.partnerIds || [])
        .filter(id => id !== person.id)
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(personName);
      const relationType = normalizeRelationType(family.relationType);
      const endType = normalizeEndType(family.endType);
      const leading = endType === "none" || endType === "unknown" ? "" : END_TYPE_LABELS[endType].toLocaleLowerCase("fr-FR");
      const endDate = formatGenealogyDate(family.endDateInfo, family.separationDate || family.divorceDate);
      const endDetail = leading ? (endDate === "—" ? leading : `${leading} · ${endDate}`) : "";
      const unionDate = formatGenealogyDate(family.unionDateInfo, family.marriageDate || family.unionDate);
      const age = lifeEventAgeAt(person, family.unionDateInfo, family.marriageDate || family.unionDate);
      return {
        id: `union-${family.id}`,
        type: "union",
        title: relationType === "unknown" ? "Union" : RELATION_TYPE_LABELS[relationType],
        date: unionDate,
        detail: [partners.length ? `avec ${partners.join(" et ")}` : "", endDetail].filter(Boolean).join(" · "),
        age,
        sortValue: genealogyDateSortValue(family.unionDateInfo, family.marriageDate || family.unionDate)
      };
    })
    .sort((a, b) => (a.sortValue ?? Number.MAX_SAFE_INTEGER) - (b.sortValue ?? Number.MAX_SAFE_INTEGER));
  events.push(...unions);

  const deathDate = formatGenealogyDate(person.deathDateInfo, person.deathDate);
  const deathPlace = formatCompactPlace(person.deathPlace, person.deathPlaceInfo);
  if (deathDate !== "—" || deathPlace) {
    events.push({
      id: "death",
      type: "death",
      title: "Décès",
      date: deathDate,
      detail: deathPlace,
      age: lifeEventAgeAt(person, person.deathDateInfo, person.deathDate),
      sortValue: genealogyDateSortValue(person.deathDateInfo, person.deathDate)
    });
  }

  const detailedEvents = (Array.isArray(person.lifeEvents) ? person.lifeEvents : [])
    .filter(entry => entry?.showInLifeTimeline === true && !isFundamentalJourneyEvent(entry))
    .map(entry => {
      const kindLabel = lifeEventKindLabel(entry.kind) || String(entry.kind || "Événement");
      const customLabel = String(entry.label || "").replace(/\s+/g, " ").trim();
      const title = customLabel || kindLabel;
      const additionalKind = customLabel && normalizedEventFact(customLabel) !== normalizedEventFact(kindLabel) ? kindLabel : "";
      const place = journeyEventPlace(entry);
      const description = String(entry.description || "").trim();
      const detail = [additionalKind, place, description].filter(Boolean).join(" · ");
      return {
        id: `detailed-event-${entry.id}`,
        entryId: entry.id,
        type: "journey-event",
        title,
        date: formatLifeDate(entry.dateInfo),
        detail,
        age: lifeEventAgeAt(person, entry.dateInfo),
        sortValue: lifeDateSortValue(entry.dateInfo)
      };
    });
  detailedEvents.sort((left, right) => {
    if (left.sortValue == null && right.sortValue == null) return 0;
    if (left.sortValue == null) return 1;
    if (right.sortValue == null) return -1;
    return left.sortValue - right.sortValue;
  });
  for (const detailedEvent of detailedEvents) {
    if (detailedEvent.sortValue == null) {
      events.push(detailedEvent);
      continue;
    }
    const insertionIndex = events.findIndex(event => event.sortValue != null && event.sortValue > detailedEvent.sortValue);
    if (insertionIndex < 0) events.push(detailedEvent);
    else events.splice(insertionIndex, 0, detailedEvent);
  }
  return events;
}
