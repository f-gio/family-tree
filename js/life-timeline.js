import { formatGenealogyDate, genealogyDateSortValue } from "./genealogy-date.js";
import { formatCompactPlace } from "./place-format.js";
import { normalizeRelationType, normalizeEndType, RELATION_TYPE_LABELS, END_TYPE_LABELS } from "./family-relations.js";

function personName(item) {
  return [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ");
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
      return {
        id: `union-${family.id}`,
        type: "union",
        title: relationType === "unknown" ? "Union" : RELATION_TYPE_LABELS[relationType],
        date: unionDate,
        detail: [partners.length ? `avec ${partners.join(" et ")}` : "", endDetail].filter(Boolean).join(" · "),
        sortValue: genealogyDateSortValue(family.unionDateInfo, family.marriageDate || family.unionDate)
      };
    })
    .sort((a, b) => (a.sortValue ?? Number.MAX_SAFE_INTEGER) - (b.sortValue ?? Number.MAX_SAFE_INTEGER));
  events.push(...unions);

  const deathDate = formatGenealogyDate(person.deathDateInfo, person.deathDate);
  const deathPlace = formatCompactPlace(person.deathPlace, person.deathPlaceInfo);
  if (deathDate !== "—" || deathPlace) {
    events.push({ id: "death", type: "death", title: "Décès", date: deathDate, detail: deathPlace, sortValue: genealogyDateSortValue(person.deathDateInfo, person.deathDate) });
  }

  return events;
}