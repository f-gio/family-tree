import { normalizedParentChildLinks, normalizeFiliationType, parentChildLinkType } from "./family-relations.js";

/* Le modèle de données relie les parents aux enfants par le produit cartésien
   `partnerIds × childIds` : un lien individuel ne peut pas être « éteint » au
   sein d'un même couple. La dissociation individuelle déplace donc l'enfant
   vers un foyer de l'autre parent, en conservant l'union d'origine (même
   identifiant, mêmes dates, mêmes attestations) et le type de filiation du
   parent conservé. Aucune fiche personne, aucun document et aucune autre
   relation ne sont touchés. */

const SINGLE_PARENT_UNION = Object.freeze({
  relationType: "unknown",
  unionDateInfo: Object.freeze({ type: "unknown" }),
  unionPlace: "",
  endType: "none",
  endDateInfo: Object.freeze({ type: "unknown" }),
  endPlace: ""
});

export function dissociationConfirmationMessage(parentName = "", childName = "") {
  return `Dissocier ${parentName} de ${childName} ? Seul leur lien de filiation sera retiré. `
    + "Leurs fiches, leurs sources et leurs documents restent enregistrés, "
    + "et les autres liens de chaque personne sont conservés.";
}

/**
 * Prépare la dissociation d'un seul lien parent-enfant.
 * Retourne { ok: false, error } ou { ok: true, familyId, familyUpdate, newFamily }.
 * `familyUpdate` s'applique au foyer d'origine ; `newFamily` est le foyer
 * monoparental créé pour l'autre parent (null quand il n'y en a pas).
 */
export function planParentDissociation(family = {}, parentId = "", childId = "") {
  const partners = [...new Set(Array.isArray(family.partnerIds) ? family.partnerIds : [])];
  const children = [...new Set(Array.isArray(family.childIds) ? family.childIds : [])];
  if (!parentId || !childId) return { ok: false, error: "Personne à dissocier manquante." };
  if (parentId === childId) return { ok: false, error: "Un lien parent-enfant ne peut pas relier une personne à elle-même." };
  if (!partners.includes(parentId)) return { ok: false, error: "Ce parent n’appartient plus à ce foyer." };
  if (!children.includes(childId)) return { ok: false, error: "Cet enfant n’appartient plus à ce foyer." };

  const remainingChildren = children.filter(id => id !== childId);
  const remainingPartners = partners.filter(id => id !== parentId);
  const familyUpdate = {
    childIds: remainingChildren,
    parentChildLinks: normalizedParentChildLinks({ ...family, childIds: remainingChildren })
  };
  if (!remainingPartners.length) return { ok: true, familyId: family.id || "", familyUpdate, newFamily: null };

  return {
    ok: true,
    familyId: family.id || "",
    familyUpdate,
    newFamily: {
      partnerIds: remainingPartners,
      childIds: [childId],
      ...SINGLE_PARENT_UNION,
      parentChildLinks: remainingPartners.map(id => ({
        parentId: id,
        childId,
        type: normalizeFiliationType(parentChildLinkType(family, id, childId))
      }))
    }
  };
}
