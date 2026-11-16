import { normalizedParentChildLinks, normalizeFiliationType } from "./family-relations.js";

/**
 * Prépare l'ajout explicite d'un second parent au foyer monoparental d'un
 * enfant. Seul cet enfant est déplacé : les autres enfants du foyer source
 * restent rattachés au parent existant. Un foyer existant avec le couple est
 * réutilisé lorsqu'il ne contient pas déjà l'enfant.
 */
export function planSecondParentAddition({
  families = [],
  sourceFamilyId = "",
  childId = "",
  addedParentId = "",
  existingParentFiliation = "unknown",
  addedParentFiliation = "unknown",
  familyFields = {}
} = {}) {
  const source = families.find(family => family?.id === sourceFamilyId);
  if (!source) return { ok: false, error: "Le foyer monoparental est introuvable." };
  const sourceParents = [...new Set(Array.isArray(source.partnerIds) ? source.partnerIds : [])];
  const sourceChildren = [...new Set(Array.isArray(source.childIds) ? source.childIds : [])];
  if (sourceParents.length !== 1) return { ok: false, error: "L’ajout d’un second parent n’est disponible que pour un foyer monoparental." };
  const existingParentId = sourceParents[0];
  if (!childId || !sourceChildren.includes(childId)) return { ok: false, error: "L’enfant n’appartient plus à ce foyer." };
  if (!addedParentId) return { ok: false, error: "Choisissez le second parent." };
  if (addedParentId === childId || addedParentId === existingParentId) return { ok: false, error: "Choisissez une personne différente de l’enfant et du parent existant." };

  const target = families.find(family => family.id !== sourceFamilyId
    && new Set(family.partnerIds || []).size === 2
    && (family.partnerIds || []).includes(existingParentId)
    && (family.partnerIds || []).includes(addedParentId));
  if (target && (target.childIds || []).includes(childId)) {
    return { ok: false, error: "Cet enfant est déjà rattaché au foyer de ces deux parents." };
  }

  const childHomes = families.filter(family => (family.childIds || []).includes(childId));
  if (childHomes.length !== 1 || childHomes[0].id !== sourceFamilyId) {
    return { ok: false, error: "Les liens de cet enfant ont changé. Fermez la modale et vérifiez sa famille." };
  }

  const sourceChildrenAfter = sourceChildren.filter(id => id !== childId);
  const sourceAfter = { ...source, childIds: sourceChildrenAfter };
  const sourceUpdate = {
    childIds: sourceChildrenAfter,
    parentChildLinks: normalizedParentChildLinks(sourceAfter)
  };

  const targetParents = target ? [...new Set(target.partnerIds)] : [existingParentId, addedParentId];
  const targetChildren = [...new Set([...(target?.childIds || []), childId])];
  const targetAfter = { ...(target || {}), partnerIds: targetParents, childIds: targetChildren };
  const targetLinks = normalizedParentChildLinks(targetAfter).map(link => {
    if (link.childId !== childId) return link;
    if (link.parentId === existingParentId) return { ...link, type: normalizeFiliationType(existingParentFiliation) };
    if (link.parentId === addedParentId) return { ...link, type: normalizeFiliationType(addedParentFiliation) };
    return link;
  });

  const familyUpdate = {
    partnerIds: targetParents,
    childIds: targetChildren,
    parentChildLinks: targetLinks,
    ...familyFields
  };
  if (target) return { ok: true, sourceFamilyId, sourceUpdate, targetFamilyId: target.id, familyUpdate, createFamily: null };

  const createFamily = {
    partnerIds: targetParents,
    childIds: [childId],
    relationType: "unknown",
    unionDateInfo: { type: "unknown" },
    unionPlace: "",
    endType: "none",
    endDateInfo: { type: "unknown" },
    endPlace: "",
    parentChildLinks: targetLinks,
    ...familyFields
  };
  return { ok: true, sourceFamilyId, sourceUpdate, targetFamilyId: "", familyUpdate: null, createFamily };
}
