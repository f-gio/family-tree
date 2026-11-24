/* Registre pur des cibles généalogiques structurées (lot R1).
   Énumère les emplacements présents/absents sans lire Firestore, muter les
   personnes ou foyers, ni créer de Preuve, Attestation ou Conclusion.
   Les affirmations libres et déductions documentaires ne sont pas des cibles
   de ce registre. */

import { buildFactIdentityId, buildLegacyParentChildIdentityId } from "./genealogy-identities.js";
import { normalizedParentChildLinks } from "./family-relations.js";
import { NAME_VARIANT_KINDS, nameVariantLabel } from "./person-name-variants.js";

export const JUSTIFICATION_TARGETS_SCHEMA_VERSION = 1;

export const JUSTIFICATION_VALUE_STATES = Object.freeze([
  "present", "absent", "explicit-unknown", "conflict"
]);

const PERSON_SCALAR_TARGETS = Object.freeze([
  { key: "firstName", type: "person.name.given", label: "Prénom", valueType: "text", factType: "name.given" },
  { key: "middleName", type: "person.name.middle", label: "Second prénom", valueType: "text" },
  { key: "lastName", type: "person.name.birthSurname", label: "Nom de naissance", valueType: "text", factType: "name.birthSurname" },
  { key: "marriedName", type: "person.name.usageSurname", label: "Nom d’usage", valueType: "text" },
  { key: "gender", type: "person.gender", label: "Sexe/genre enregistré", valueType: "text" },
  { key: "birthDateInfo", fallback: ["birthDate"], type: "person.birth.date", label: "Date de naissance", valueType: "date", factType: "birth.date", legacyFactType: "birth" },
  { key: "place", companion: "birthPlaceInfo", type: "person.birth.place", label: "Lieu de naissance", valueType: "place", factType: "birth.place", legacyFactType: "birth" },
  { key: "deathDateInfo", fallback: ["deathDate"], type: "person.death.date", label: "Date de décès", valueType: "date", factType: "death.date", legacyFactType: "death" },
  { key: "deathPlace", companion: "deathPlaceInfo", type: "person.death.place", label: "Lieu de décès", valueType: "place", factType: "death.place", legacyFactType: "death" }
]);

const FAMILY_SCALAR_TARGETS = Object.freeze([
  { key: "relationType", type: "family.union.type", label: "Type d’union", valueType: "enum" },
  { key: "unionDateInfo", fallback: ["marriageDate", "unionDate"], type: "family.union.date", label: "Date d’union", valueType: "date" },
  { key: "unionPlace", companion: "unionPlaceInfo", type: "family.union.place", label: "Lieu d’union", valueType: "place" },
  { key: "endType", type: "family.union.endType", label: "Type de fin d’union", valueType: "enum" },
  { key: "endDateInfo", fallback: ["separationDate", "divorceDate"], type: "family.union.endDate", label: "Date de fin d’union", valueType: "date" },
  { key: "endPlace", companion: "endPlaceInfo", type: "family.union.endPlace", label: "Lieu de fin d’union", valueType: "place" }
]);

const PERSON_RESIDENCE_TARGETS = Object.freeze([
  { targetType: "person.residence.date", label: "Date/période de résidence", valueType: "date", key: "dateInfo" },
  { targetType: "person.residence.place", label: "Lieu de résidence", valueType: "place", key: "place" },
  { targetType: "person.residence.address", label: "Adresse de résidence", valueType: "text", key: "address" }
]);

const PERSON_PROFESSION_TARGETS = Object.freeze([
  { targetType: "person.profession.label", label: "Profession/activité", valueType: "text", key: "label" },
  { targetType: "person.profession.date", label: "Date/période de profession", valueType: "date", key: "dateInfo" },
  { targetType: "person.profession.place", label: "Lieu de profession", valueType: "place", key: "place" }
]);

const PERSON_LIFE_EVENT_TARGETS = Object.freeze([
  { targetType: "person.lifeEvent.kind", label: "Type d’événement de vie", valueType: "text", key: "kind" },
  { targetType: "person.lifeEvent.label", label: "Intitulé d’événement de vie", valueType: "text", key: "label" },
  { targetType: "person.lifeEvent.date", label: "Date/période d’événement de vie", valueType: "date", key: "dateInfo" },
  { targetType: "person.lifeEvent.place", label: "Lieu d’événement de vie", valueType: "place", key: "place" }
]);

const NAME_VARIANT_TARGET_LABELS = Object.freeze({
  given: "Variante de prénom",
  family: "Variante de nom"
});

const AD_HOC_TARGET_LABELS = Object.freeze({
  "family.union.partners": "Partenaires de l’union",
  "family.parentChild.relationship": "Lien parent-enfant",
  /* Relations précises (lot attestations) : le libellé dynamique du registre
     porte le nom de l'autre personne ; ces libellés servent de repli
     d'affichage d'un `factType` persisté. */
  "family.parentChild.parent": "Est le parent de…",
  "family.parentChild.child": "Est l’enfant de…",
  "family.sibling": "Frère ou sœur de…",
  "family.union.spouse": "Conjoint de…",
  "person.death.aliveAt": "Vivant à cette date",
  "person.death.deceasedAt": "Déjà décédé à cette date"
});

/* Catégories d'affichage du sélecteur d'information. Elles organisent le
   choix sans jamais être des faits cliquables. */
export const JUSTIFICATION_CATEGORIES = Object.freeze([
  { key: "identity", label: "Identité" },
  { key: "birth", label: "Naissance" },
  { key: "death", label: "Décès et état de vie" },
  { key: "family", label: "Famille et filiation" },
  { key: "residence", label: "Résidence" },
  { key: "profession", label: "Profession" },
  { key: "journey", label: "Parcours" }
]);

const TARGET_CATEGORY_RULES = Object.freeze([
  ["person.birth", "birth"],
  ["person.death", "death"],
  ["person.residence", "residence"],
  ["person.profession", "profession"],
  ["person.lifeEvent", "journey"],
  ["person.name", "identity"],
  ["person.gender", "identity"],
  ["family.union", "family"],
  ["family.parentChild", "family"],
  ["family.sibling", "family"]
]);

/** Catégorie d'affichage d'un type de cible. Aucune catégorie n'est une
    affirmation : elles servent uniquement à organiser les choix. */
export function justificationTargetCategory(targetType) {
  const type = typeof targetType === "string" ? targetType : "";
  for (const [prefix, category] of TARGET_CATEGORY_RULES) {
    if (type.startsWith(prefix)) return category;
  }
  return "identity";
}

/**
 * Libellé français par type de cible. Il sert à présenter un `factType` de
 * Preuve construit sur `targetType` sans exposer l'identifiant technique dans
 * l'interface. Les libellés sont ceux réellement utilisés par le registre.
 */
export const JUSTIFICATION_TARGET_LABELS = Object.freeze({
  ...Object.fromEntries([...PERSON_SCALAR_TARGETS, ...FAMILY_SCALAR_TARGETS].map(definition => [definition.type, definition.label])),
  ...Object.fromEntries([...PERSON_RESIDENCE_TARGETS, ...PERSON_PROFESSION_TARGETS, ...PERSON_LIFE_EVENT_TARGETS].map(definition => [definition.targetType, definition.label])),
  ...Object.fromEntries(Object.entries(NAME_VARIANT_TARGET_LABELS).map(([kind, label]) => [`person.nameVariant.${kind}`, label])),
  ...AD_HOC_TARGET_LABELS
});

function cloneValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.values(value).some(hasValue);
  return true;
}

function valueState(value, { unknownString = false } = {}) {
  if (!hasValue(value)) return "absent";
  if ((unknownString && value === "unknown") || (value && typeof value === "object" && value.type === "unknown")) return "explicit-unknown";
  return "present";
}

function fullName(person = {}) {
  return [person.firstName, person.middleName, person.lastName].filter(value => typeof value === "string" && value.trim()).join(" ")
    || person.id;
}

function locationValue(text, details) {
  return {
    text: typeof text === "string" ? text : "",
    details: details && typeof details === "object" ? cloneValue(details) : null
  };
}

function dateValue(structured, legacyValues = []) {
  const legacy = legacyValues.map(({ key, value }) => ({ key, value: typeof value === "string" ? value : "" }));
  const meaningfulLegacy = legacy.filter(entry => entry.value.trim());
  const structuredPresent = hasValue(structured);
  const legacyPresent = meaningfulLegacy.length > 0;
  const hasConflict = structured?.type === "unknown" && legacyPresent;
  const state = hasConflict ? "conflict"
    : structuredPresent ? valueState(structured)
      : legacyPresent ? "present" : "absent";
  return {
    value: { structured: structuredPresent ? cloneValue(structured) : null, legacy },
    valueState: state
  };
}

function makeOwner(kind, record) {
  return { kind, id: record.id, label: kind === "person" ? fullName(record) : `Famille ${record.id}` };
}

function exactFactId(ownerKind, ownerId, factType) {
  return factType ? buildFactIdentityId(ownerKind, ownerId, factType) : null;
}

function makeScalarTarget({ owner, ownerCollection, record, definition }) {
  const factId = exactFactId(owner.kind, owner.id, definition.factType);
  const id = factId || buildFactIdentityId(`${owner.kind}.r1`, owner.id, definition.type);
  const path = { collection: ownerCollection, documentId: owner.id, fields: [definition.key] };
  if (definition.fallback?.length) path.fallbackFields = [...definition.fallback];
  if (definition.companion) path.companionFields = [definition.companion];

  let state;
  let value;
  if (definition.valueType === "date") {
    const legacy = (definition.fallback || []).map(key => ({ key, value: record[key] }));
    ({ value, valueState: state } = dateValue(record[definition.key], legacy));
    path.fields = [definition.key, ...(definition.fallback || [])];
  } else if (definition.valueType === "place") {
    value = locationValue(record[definition.key], record[definition.companion]);
    state = hasValue(value) ? "present" : "absent";
    path.fields = [definition.key, definition.companion];
  } else {
    value = cloneValue(record[definition.key] ?? null);
    state = valueState(value, { unknownString: definition.valueType === "enum" });
  }

  const legacyFactCandidates = definition.legacyFactType
    ? [{
        factId: buildFactIdentityId(owner.kind, owner.id, definition.legacyFactType),
        factType: definition.legacyFactType,
        compatibility: "ambiguous",
        reason: `Le type historique « ${definition.legacyFactType} » ne distingue pas cette cible précise.`
      }]
    : [];

  return {
    id,
    targetType: definition.type,
    label: definition.label,
    valueType: definition.valueType,
    owner,
    path,
    value,
    valueState: state,
    factId,
    factIdentityCompatibility: factId ? "exact" : "no-exact-existing-type",
    legacyFactCandidates,
    identityStrategy: factId ? "existing-fact-id" : "owner-and-field-r1"
  };
}

function repeatedTargetId(ownerKind, ownerId, collection, memberId, targetType) {
  /* La collection et l'ID persistant du membre sont des composantes séparées
     par JSON.stringify : aucun séparateur présent dans les IDs ne peut créer
     une collision, et l'ordre du tableau n'intervient pas. */
  const stableMember = JSON.stringify([ownerId, memberId]);
  return buildFactIdentityId(`${ownerKind}.${collection}`, stableMember, targetType);
}

function addRepeatedField(targets, exclusions, { owner, ownerCollection, collection, entry, targetType, label, valueType, key, companion = null }) {
  const id = repeatedTargetId(owner.kind, owner.id, collection, entry.id, targetType);
  const path = { collection: ownerCollection, documentId: owner.id, fields: [collection, entry.id, key] };
  if (companion) path.companionFields = [collection, entry.id, companion];
  let value;
  let state;
  if (valueType === "date") {
    value = cloneValue(entry[key] ?? null);
    state = value?.type === "unknown" ? "explicit-unknown" : valueState(value);
  } else if (valueType === "place") {
    value = {
      place: typeof entry.place === "string" ? entry.place : "",
      region: typeof entry.region === "string" ? entry.region : "",
      country: typeof entry.country === "string" ? entry.country : "",
      ...(entry.countryCode ? { countryCode: cloneValue(entry.countryCode) } : {})
    };
    state = hasValue(value) ? "present" : "absent";
    path.fields = [collection, entry.id, "place", "region", "country", ...(entry.countryCode ? ["countryCode"] : [])];
  } else {
    value = cloneValue(entry[key] ?? null);
    state = valueState(value, { unknownString: valueType === "enum" });
  }
  targets.push({
    id, targetType, label, valueType, owner, path, value, valueState: state,
    factId: null,
    factIdentityCompatibility: "no-exact-existing-type",
    legacyFactCandidates: [],
    identityStrategy: "owner-and-persisted-entry-id"
  });
}

function repeatedRecords(owner, collection, record, targets, exclusions, definitions) {
  const entries = record[collection];
  if (entries === undefined || entries === null) return;
  if (!Array.isArray(entries)) {
    exclusions.push({ owner, path: [collection], reason: "le champ n'est pas un tableau" });
    return;
  }
  const counts = new Map();
  for (const entry of entries) if (typeof entry?.id === "string" && entry.id.trim()) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      exclusions.push({ owner, path: [collection], reason: "entrée répétée invalide" });
      continue;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      exclusions.push({ owner, path: [collection], reason: "identifiant persistant absent ; aucune identité n'est inventée" });
      continue;
    }
    if (entry && typeof entry.id === "string" && counts.get(entry.id) > 1) {
      exclusions.push({ owner, path: [collection, entry.id], reason: "identifiant d'entrée dupliqué ; association ambiguë" });
      continue;
    }
    for (const definition of definitions) {
      addRepeatedField(targets, exclusions, {
        owner, ownerCollection: owner.kind === "person" ? "people" : "families",
        collection, entry, ...definition
      });
    }
  }
}

function addTarget(targets, exclusions, target) {
  targets.push(target);
  if (!JUSTIFICATION_VALUE_STATES.includes(target.valueState)) {
    exclusions.push({ owner: target.owner, path: target.path.fields, reason: `état de valeur non reconnu : ${target.valueState}` });
  }
}

/* ---- Décès et état de vie à une date (lot attestations) ----
   Ces deux cibles n'ont aucune valeur sur la Personne : la date de référence
   appartient à l'association documentaire et reste stockée sur la Preuve.
   Aucun champ de décès n'est lu, proposé ni modifié ici. */
function addVitalStatusTargets(owner, person, targets, exclusions) {
  for (const definition of [
    { factKind: "death.aliveAt", type: "person.death.aliveAt", label: "Vivant à cette date" },
    { factKind: "death.deceasedAt", type: "person.death.deceasedAt", label: "Déjà décédé à cette date" }
  ]) {
    const factId = buildFactIdentityId("person", person.id, definition.factKind);
    addTarget(targets, exclusions, {
      id: factId,
      targetType: definition.type,
      label: definition.label,
      valueType: "reference-date",
      owner,
      path: { collection: "people", documentId: person.id, fields: [] },
      value: null,
      valueState: "absent",
      factId,
      factIdentityCompatibility: "exact",
      legacyFactCandidates: [],
      identityStrategy: "owner-and-claim-kind"
    });
  }
}

/* ---- Relations familiales précises ----
   L'identité encode les deux extrêmes dans l'ordre (sujet d'abord) et le type
   de relation : aucune ambiguité de Foyer, aucune collision entre « A est le
   père de C » et « C est l'enfant de A », ni entre « A est sœur de B » et
   « B est sœur de A ». Aucune relation n'est créée ni modifiée : le registre
   décrit les liens déjà présents dans l'arbre. */
function relationTargetId(kind, endpoints, targetType) {
  return buildFactIdentityId(`relation.${kind}.r1`, JSON.stringify(endpoints), targetType);
}

function parentRoleLabel(gender) {
  return gender === "F" ? "la mère" : gender === "M" ? "le père" : "le parent";
}

function addRelationTargets(person, families, peopleById, targets, exclusions) {
  const owner = makeOwner("person", person);
  const seen = new Set();
  const push = target => {
    if (seen.has(target.id)) return;
    seen.add(target.id);
    addTarget(targets, exclusions, target);
  };
  const nameOf = id => {
    const other = peopleById.get(id);
    return other ? fullName(other) : id;
  };
  const makeRelationTarget = ({ id, type, label, family, value, pathFields }) => ({
    id,
    targetType: type,
    label,
    valueType: "relationship",
    owner,
    path: { collection: "families", documentId: family.id, fields: pathFields },
    value,
    valueState: "present",
    factId: id,
    factIdentityCompatibility: "exact",
    legacyFactCandidates: [],
    identityStrategy: "relation-endpoints"
  });

  for (const family of families) {
    if (!family || typeof family !== "object" || Array.isArray(family)) continue;
    const partners = Array.isArray(family.partnerIds) ? family.partnerIds.filter(id => typeof id === "string" && id.trim()) : [];
    const children = Array.isArray(family.childIds) ? family.childIds.filter(id => typeof id === "string" && id.trim()) : [];
    if (!partners.includes(person.id) && !children.includes(person.id)) continue;
    const familyId = typeof family.id === "string" && family.id.trim() ? family.id.trim() : null;
    if (!familyId) continue;
    const linkType = (parentId, childId) => {
      const explicit = (Array.isArray(family.parentChildLinks) ? family.parentChildLinks : [])
        .find(link => link?.parentId === parentId && link?.childId === childId);
      return explicit && ["biological", "adoptive", "uncertain", "unknown"].includes(explicit.type) ? explicit.type : "unknown";
    };

    if (partners.includes(person.id)) {
      for (const childId of children) {
        if (childId === person.id) continue;
        push(makeRelationTarget({
          id: relationTargetId("parentchild", [person.id, childId], "family.parentChild.parent"),
          type: "family.parentChild.parent",
          label: `Est ${parentRoleLabel(person.gender)} de ${nameOf(childId)}`,
          family,
          value: { familyId, parentId: person.id, childId, type: linkType(person.id, childId) },
          pathFields: ["partnerIds", person.id, "childIds", childId]
        }));
      }
      for (const partnerId of partners) {
        if (partnerId === person.id) continue;
        push(makeRelationTarget({
          id: relationTargetId("spouse", [person.id, partnerId], "family.union.spouse"),
          type: "family.union.spouse",
          label: `Est le conjoint de ${nameOf(partnerId)}`,
          family,
          value: { familyId, partnerIds: [...partners].sort() },
          pathFields: ["partnerIds"]
        }));
      }
    }

    if (children.includes(person.id)) {
      for (const parentId of partners) {
        if (parentId === person.id) continue;
        push(makeRelationTarget({
          id: relationTargetId("parentchild", [person.id, parentId], "family.parentChild.child"),
          type: "family.parentChild.child",
          label: `Est l’enfant de ${nameOf(parentId)}`,
          family,
          value: { familyId, parentId, childId: person.id, type: linkType(parentId, person.id) },
          pathFields: ["childIds", person.id, "partnerIds", parentId]
        }));
      }
      for (const siblingId of children) {
        if (siblingId === person.id) continue;
        push(makeRelationTarget({
          id: relationTargetId("sibling", [person.id, siblingId], "family.sibling"),
          type: "family.sibling",
          label: `Est le frère ou la sœur de ${nameOf(siblingId)}`,
          family,
          value: { familyId, personIds: [person.id, siblingId].sort() },
          pathFields: ["childIds"]
        }));
      }
    }
  }
}

function addPersonTargets(person, families = [], peopleById = new Map(), targets, exclusions) {
  if (!person || typeof person !== "object" || Array.isArray(person) || typeof person.id !== "string" || !person.id.trim()) {
    exclusions.push({ owner: { kind: "person", id: person?.id ?? null }, path: ["people"], reason: "identifiant Personne absent ou invalide" });
    return;
  }
  const owner = makeOwner("person", person);
  for (const definition of PERSON_SCALAR_TARGETS) addTarget(targets, exclusions, makeScalarTarget({
    owner, ownerCollection: "people", record: person, definition
  }));

  /* Cibles de déclaration documentaire sans événement Personne sous-jacent.
     Elles garantissent un catalogue commun même si profession/résidence/parcours
     ne sont pas encore renseignés, sans fabriquer d'entrée généalogique. */
  for (const definition of [
    { targetType: "person.residence.place", label: "Lieu de résidence", valueType: "place" },
    { targetType: "person.profession.label", label: "Profession/activité", valueType: "text" },
    { targetType: "person.lifeEvent.label", label: "Événement du parcours", valueType: "text" }
  ]) {
    const factId = buildFactIdentityId("person.claim.r1", person.id, definition.targetType);
    addTarget(targets, exclusions, {
      id: factId, factId, targetType: definition.targetType, label: definition.label,
      valueType: definition.valueType, owner,
      path: { collection: "people", documentId: person.id, fields: [] },
      value: null, valueState: "absent", factIdentityCompatibility: "exact",
      legacyFactCandidates: [], identityStrategy: "owner-and-claim-kind"
    });
  }

  const variants = person.nameVariants;
  if (variants != null && !Array.isArray(variants)) exclusions.push({ owner, path: ["nameVariants"], reason: "le champ n'est pas un tableau" });
  if (Array.isArray(variants)) {
    const counts = new Map();
    for (const variant of variants) if (typeof variant?.id === "string" && variant.id.trim()) counts.set(variant.id, (counts.get(variant.id) || 0) + 1);
    for (const variant of variants) {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        exclusions.push({ owner, path: ["nameVariants"], reason: "variante invalide" });
        continue;
      }
      if (typeof variant.id !== "string" || !variant.id.trim()) {
        exclusions.push({ owner, path: ["nameVariants"], reason: "identifiant persistant de variante absent ; aucune identité n'est inventée" });
        continue;
      }
      if (counts.get(variant.id) > 1) {
        exclusions.push({ owner, path: ["nameVariants", variant.id], reason: "identifiant de variante dupliqué" });
        continue;
      }
      if (!NAME_VARIANT_KINDS.includes(variant.kind) || typeof variant.value !== "string") {
        exclusions.push({ owner, path: ["nameVariants", variant.id], reason: "type ou valeur de variante invalide" });
        continue;
      }
      addTarget(targets, exclusions, {
        id: repeatedTargetId("person", person.id, "nameVariants", variant.id, `name.variant.${variant.kind}`),
        targetType: `person.nameVariant.${variant.kind}`,
        label: NAME_VARIANT_TARGET_LABELS[variant.kind] || `Variante de ${nameVariantLabel(variant.kind)}`,
        valueType: "text",
        owner,
        path: { collection: "people", documentId: person.id, fields: ["nameVariants", variant.id, "value"] },
        value: variant.value,
        valueState: valueState(variant.value),
        factId: null,
        factIdentityCompatibility: "no-exact-existing-type",
        legacyFactCandidates: [],
        identityStrategy: "owner-and-persisted-entry-id"
      });
    }
  }

  repeatedRecords(owner, "residences", person, targets, exclusions, PERSON_RESIDENCE_TARGETS);
  repeatedRecords(owner, "professions", person, targets, exclusions, PERSON_PROFESSION_TARGETS);
  repeatedRecords(owner, "lifeEvents", person, targets, exclusions, PERSON_LIFE_EVENT_TARGETS);
  addVitalStatusTargets(owner, person, targets, exclusions);
  addRelationTargets(person, families, peopleById, targets, exclusions);
}

function addFamilyTargets(family, targets, exclusions) {
  if (!family || typeof family !== "object" || Array.isArray(family) || typeof family.id !== "string" || !family.id.trim()) {
    exclusions.push({ owner: { kind: "family", id: family?.id ?? null }, path: ["families"], reason: "identifiant Foyer absent ou invalide" });
    return;
  }
  const owner = makeOwner("family", family);
  const rawPartners = Array.isArray(family.partnerIds) ? family.partnerIds : [];
  const rawChildren = Array.isArray(family.childIds) ? family.childIds : [];
  const partnersValid = Array.isArray(family.partnerIds) && rawPartners.every(id => typeof id === "string" && id.trim())
    && new Set(rawPartners).size === rawPartners.length;
  const childrenValid = Array.isArray(family.childIds) && rawChildren.every(id => typeof id === "string" && id.trim())
    && new Set(rawChildren).size === rawChildren.length;
  if ((family.partnerIds != null && !Array.isArray(family.partnerIds)) || !partnersValid) {
    exclusions.push({ owner, path: ["partnerIds"], reason: "membres de Foyer invalides ou dupliqués ; cibles relationnelles exclues" });
  }
  if ((family.childIds != null && !Array.isArray(family.childIds)) || !childrenValid) {
    exclusions.push({ owner, path: ["childIds"], reason: "membres de Foyer invalides ou dupliqués ; cibles relationnelles exclues" });
  }
  const partners = partnersValid ? [...rawPartners] : [];
  const children = childrenValid ? [...rawChildren] : [];
  const explicitLinks = Array.isArray(family.parentChildLinks) ? family.parentChildLinks : [];
  if (family.parentChildLinks != null && !Array.isArray(family.parentChildLinks)) {
    exclusions.push({ owner, path: ["parentChildLinks"], reason: "le champ n'est pas un tableau" });
  }
  const explicitLinkCounts = new Map();
  for (const link of explicitLinks) {
    if (!link || typeof link.parentId !== "string" || !link.parentId.trim()
      || typeof link.childId !== "string" || !link.childId.trim()) {
      exclusions.push({ owner, path: ["parentChildLinks"], reason: "extrémités de lien familial absentes" });
      continue;
    }
    const key = JSON.stringify([link.parentId, link.childId]);
    explicitLinkCounts.set(key, (explicitLinkCounts.get(key) || 0) + 1);
    if (!partners.includes(link.parentId) || !children.includes(link.childId)) {
      exclusions.push({ owner, path: ["parentChildLinks", link.parentId, link.childId], reason: "lien stocké hors des partnerIds/childIds courants" });
    }
  }

  /* Le schéma legacy utilise familyId + partnerIds/childIds, sans ID de lien
     distinct. Le helper historique fournit une identité dérivée stable pour
     un même triplet, pas une identité relationnelle immuable si le lien est
     recréé dans un autre Foyer. */
  for (const link of partnersValid && childrenValid ? normalizedParentChildLinks(family) : []) {
    if (!link.parentId?.trim() || !link.childId?.trim()) {
      exclusions.push({ owner, path: ["parentChildLinks"], reason: "extrémité de relation manquante" });
      continue;
    }
    const explicit = explicitLinks.find(item => item?.parentId === link.parentId && item?.childId === link.childId);
    if (explicitLinkCounts.get(JSON.stringify([link.parentId, link.childId])) > 1) {
      exclusions.push({ owner, path: ["parentChildLinks", link.parentId, link.childId], reason: "lien stocké en double ; cible relationnelle ambiguë" });
      continue;
    }
    const typePresent = explicit && ["biological", "adoptive", "uncertain", "unknown"].includes(explicit.type);
    const id = buildLegacyParentChildIdentityId(family.id, link.parentId, link.childId);
    addTarget(targets, exclusions, {
      id,
      targetType: "family.parentChild.relationship",
      label: "Lien parent-enfant",
      valueType: "relationship",
      owner,
      path: {
        collection: "families", documentId: family.id,
        fields: ["partnerIds", link.parentId, "childIds", link.childId, "parentChildLinks", "type"]
      },
      value: {
        familyId: family.id, parentId: link.parentId, childId: link.childId,
        type: typePresent ? link.type : "unknown",
        typeValueState: typePresent ? link.type === "unknown" ? "explicit-unknown" : "present" : "absent"
      },
      valueState: "present",
      factId: null,
      factIdentityCompatibility: "legacy-derived-relation-id",
      legacyFactCandidates: [],
      identityStrategy: "legacy-family-parent-child-tuple"
    });
  }

  if (partners.length !== 2) return;
  const unionDefinitions = [
    { key: "partnerIds", type: "family.union.partners", label: "Partenaires de l’union", valueType: "relationship", value: partners },
    ...FAMILY_SCALAR_TARGETS.map(definition => ({ ...definition, value: undefined }))
  ];
  for (const definition of unionDefinitions) {
    const resolved = definition.key === "partnerIds" ? {
      value: [...partners], state: "present", pathFields: ["partnerIds"]
    } : definition.valueType === "date" ? (() => {
      const legacy = (definition.fallback || []).map(key => ({ key, value: family[key] }));
      const result = dateValue(family[definition.key], legacy);
      return { value: result.value, state: result.valueState, pathFields: [definition.key, ...(definition.fallback || [])] };
    })() : definition.valueType === "place" ? (() => {
      const value = locationValue(family[definition.key], family[definition.companion]);
      return { value, state: hasValue(value) ? "present" : "absent", pathFields: [definition.key, definition.companion] };
    })() : {
      value: cloneValue(family[definition.key] ?? null),
      state: valueState(family[definition.key]),
      pathFields: [definition.key]
    };
    addTarget(targets, exclusions, {
      id: buildFactIdentityId("family.r1", family.id, definition.type),
      targetType: definition.type,
      label: definition.label,
      valueType: definition.valueType,
      owner,
      path: { collection: "families", documentId: family.id, fields: resolved.pathFields },
      value: resolved.value,
      valueState: resolved.state,
      factId: null,
      factIdentityCompatibility: "no-exact-existing-type",
      legacyFactCandidates: [],
      identityStrategy: "family-id-and-field"
    });
  }
}

function removeCollidingTargets(targets, exclusions) {
  const grouped = new Map();
  for (const target of targets) {
    if (!grouped.has(target.id)) grouped.set(target.id, []);
    grouped.get(target.id).push(target);
  }
  const safe = [];
  for (const [id, items] of grouped) {
    if (items.length === 1) safe.push(items[0]);
    else for (const item of items) exclusions.push({
      owner: item.owner, path: item.path.fields, targetId: id,
      reason: "collision d'identifiant calculé ; cible exclue plutôt qu'associée de façon ambiguë"
    });
  }
  return safe.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Énumère les cibles structurées dont l'identité est dérivable sans écrire ni
 * inventer de champs. Les personnes/foyers absents et les entrées répétées
 * sans ID (ou avec ID dupliqué) sont rapportés dans `excluded`.
 * Les affirmations libres, attestations et objets documentaires ne sont pas des
 * cibles ici : ils ont des responsabilités distinctes à arbitrer ultérieurement.
 */
export function enumerateJustificationTargets({ people = [], families = [], includeFamilyTargets = true } = {}) {
  if (!Array.isArray(people)) throw new TypeError("people doit être un tableau");
  if (!Array.isArray(families)) throw new TypeError("families doit être un tableau");
  const targets = [];
  const excluded = [];
  const peopleById = new Map();
  for (const person of people) {
    if (person && typeof person === "object" && typeof person.id === "string") peopleById.set(person.id, person);
  }
  for (const person of people) addPersonTargets(person, families, peopleById, targets, excluded);
  if (includeFamilyTargets) for (const family of families) addFamilyTargets(family, targets, excluded);
  const safeTargets = removeCollidingTargets(targets, excluded);
  for (const target of safeTargets) target.category = justificationTargetCategory(target.targetType);
  excluded.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { schemaVersion: JUSTIFICATION_TARGETS_SCHEMA_VERSION, targets: safeTargets, excluded };
}
