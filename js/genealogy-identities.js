/* Identités stables des faits et des relations généalogiques.
   Module pur : aucune dépendance DOM, Firebase ou réseau.

   Les identifiants de faits dépendent seulement de la cible et du type de fait,
   jamais de sa valeur courante. Les identifiants de relation explicites doivent
   être alloués et persistés par la future couche de stockage. Ces helpers seuls
   ne rendent pas une relation persistante entre deux sessions.
*/

export const PARENT_CHILD_RELATION_STATES = Object.freeze({
  ACTIVE: "active",
  INVALIDATED: "invalidated"
});

function requiredPart(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} doit être une chaîne non vide`);
  }
  return value;
}

function encodePart(value) {
  // encodeURIComponent ne code pas « ~ », utilisé comme séparateur ci-dessous.
  return encodeURIComponent(value).replace(/~/g, "%7E");
}

function stableTupleId(prefix, parts) {
  return `${prefix}~${parts.map(encodePart).join("~")}`;
}

/**
 * Construit l'identifiant déterministe d'un emplacement de fait.
 * `factValue` n'est volontairement pas un paramètre : une valeur vide ou
 * corrigée ne change donc jamais l'identité de l'emplacement.
 *
 * Exemple d'appel : buildFactIdentityId("person", personId, "birth.date").
 * La taxonomie factKind reste définie par le contrat fonctionnel du module.
 */
export function buildFactIdentityId(subjectKind, subjectId, factKind) {
  return stableTupleId("fact", [
    requiredPart(subjectKind, "subjectKind"),
    requiredPart(subjectId, "subjectId"),
    requiredPart(factKind, "factKind")
  ]);
}

/**
 * Clé de compatibilité déterministe pour un lien parent-enfant encore porté
 * par families/{familyId}. Elle reste stable tant que familyId, parentId et
 * childId restent identiques (y compris si l'ordre des listes change).
 * Si le lien est recréé sous un autre familyId, cette clé change : un registre
 * relationnel persistant sera nécessaire pour préserver l'ancienne identité.
 */
export function buildLegacyParentChildIdentityId(familyId, parentId, childId) {
  return stableTupleId("legacy-parent-child", [
    requiredPart(familyId, "familyId"),
    requiredPart(parentId, "parentId"),
    requiredPart(childId, "childId")
  ]);
}

/**
 * Crée la forme d'un enregistrement relationnel indépendant à partir d'un ID
 * déjà alloué par la couche de persistance. Ne génère ni n'enregistre l'ID.
 */
export function createParentChildRelationRecord({
  relationshipId,
  familyId,
  parentId,
  childId
} = {}) {
  const id = requiredPart(relationshipId, "relationshipId");
  const family = requiredPart(familyId, "familyId");
  const parent = requiredPart(parentId, "parentId");
  const child = requiredPart(childId, "childId");
  if (parent === child) throw new Error("Une relation parent-enfant ne peut pas relier une personne à elle-même");
  return {
    id,
    kind: "parent-child",
    familyId: family,
    parentId: parent,
    childId: child,
    state: PARENT_CHILD_RELATION_STATES.ACTIVE,
    invalidatedAt: null,
    invalidationReason: ""
  };
}

/**
 * Produit un tombstone local en conservant l'identifiant et les participants.
 * La persistance du résultat et l'écriture de son historique restent à la
 * future couche de stockage ; aucune suppression ou écriture n'est faite ici.
 */
export function invalidateParentChildRelation(relation, { at = null, reason = "" } = {}) {
  if (!relation || typeof relation !== "object") throw new TypeError("Relation parent-enfant invalide");
  requiredPart(relation.id, "relation.id");
  if (relation.kind !== "parent-child") throw new TypeError("Le type de relation doit être parent-child");
  requiredPart(relation.familyId, "relation.familyId");
  requiredPart(relation.parentId, "relation.parentId");
  requiredPart(relation.childId, "relation.childId");
  if (relation.parentId === relation.childId) throw new Error("Une relation parent-enfant ne peut pas relier une personne à elle-même");
  if (relation.state !== PARENT_CHILD_RELATION_STATES.ACTIVE) {
    throw new Error("Seule une relation active peut être invalidée");
  }
  if (at !== null && typeof at !== "string" && !(at instanceof Date)) {
    throw new TypeError("at doit être une date ou null");
  }
  if (typeof reason !== "string") throw new TypeError("reason doit être une chaîne");

  return {
    ...relation,
    state: PARENT_CHILD_RELATION_STATES.INVALIDATED,
    invalidatedAt: at,
    invalidationReason: reason
  };
}
