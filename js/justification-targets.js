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
  "family.parentChild.relationship": "Lien parent-enfant"
});

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

function addPersonTargets(person, targets, exclusions) {
  if (!person || typeof person !== "object" || Array.isArray(person) || typeof person.id !== "string" || !person.id.trim()) {
    exclusions.push({ owner: { kind: "person", id: person?.id ?? null }, path: ["people"], reason: "identifiant Personne absent ou invalide" });
    return;
  }
  const owner = makeOwner("person", person);
  for (const definition of PERSON_SCALAR_TARGETS) addTarget(targets, exclusions, makeScalarTarget({
    owner, ownerCollection: "people", record: person, definition
  }));

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
export function enumerateJustificationTargets({ people = [], families = [] } = {}) {
  if (!Array.isArray(people)) throw new TypeError("people doit être un tableau");
  if (!Array.isArray(families)) throw new TypeError("families doit être un tableau");
  const targets = [];
  const excluded = [];
  for (const person of people) addPersonTargets(person, targets, excluded);
  for (const family of families) addFamilyTargets(family, targets, excluded);
  const safeTargets = removeCollidingTargets(targets, excluded);
  excluded.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { schemaVersion: JUSTIFICATION_TARGETS_SCHEMA_VERSION, targets: safeTargets, excluded };
}
