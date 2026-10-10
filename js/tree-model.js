/* Helpers purs pour le modèle multi-arbres.
   Les personnes restent uniques : treeId absent/null signifie l'arbre principal. */

export const MAIN_TREE_ID = "main";

const FAMILY_PERSON_ARRAY_FIELDS = Object.freeze([
  "partnerIds",
  "childIds",
  "parentIds",
  "spouseIds",
  "personIds",
  "memberIds"
]);
const FAMILY_LINK_FIELDS = Object.freeze(["parentChildLinks", "links"]);
const LINK_PERSON_FIELDS = Object.freeze(["parentId", "childId", "personId", "fromId", "toId"]);

export function isValidTreeId(treeId) {
  return typeof treeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(treeId);
}

export function getPersonTreeId(person = {}) {
  if (person?.treeId == null) return MAIN_TREE_ID;
  return isValidTreeId(person.treeId) ? person.treeId : null;
}

function normalizeRequestedTreeId(treeId) {
  if (treeId == null) return MAIN_TREE_ID;
  return isValidTreeId(treeId) ? treeId : null;
}

function personIdsInFamily(family = {}) {
  const ids = new Set();
  for (const field of FAMILY_PERSON_ARRAY_FIELDS) {
    if (!Array.isArray(family[field])) continue;
    for (const id of family[field]) if (typeof id === "string" && id.length) ids.add(id);
  }
  for (const field of FAMILY_LINK_FIELDS) {
    if (!Array.isArray(family[field])) continue;
    for (const link of family[field]) {
      if (!link || typeof link !== "object") continue;
      for (const key of LINK_PERSON_FIELDS) {
        const id = link[key];
        if (typeof id === "string" && id.length) ids.add(id);
      }
    }
  }
  return [...ids];
}

export function getTreePeople(people = [], treeId = MAIN_TREE_ID) {
  const requested = normalizeRequestedTreeId(treeId);
  if (!requested || !Array.isArray(people)) return [];
  return people.filter(person => getPersonTreeId(person) === requested);
}

export function getTreeMemberIds(people = [], treeId = MAIN_TREE_ID) {
  return [...new Set(getTreePeople(people, treeId)
    .map(person => person?.id)
    .filter(id => typeof id === "string" && id.length > 0))];
}

/* Une famille est rendue seulement si toutes ses références de personne sont
   présentes dans le sous-ensemble. Un lien inter-arbres ne peut donc pas
   importer implicitement une personne ni créer une filiation dans le rendu. */
export function getTreeFamilies(families = [], treePeople = []) {
  if (!Array.isArray(families) || !Array.isArray(treePeople)) return [];
  const memberIds = new Set(treePeople.map(person => person?.id).filter(id => typeof id === "string" && id.length));
  return families.filter(family => {
    const refs = personIdsInFamily(family);
    return refs.length > 0 && refs.every(id => memberIds.has(id));
  });
}

/* Prépare uniquement un aperçu de transfert secondaire → main. Ne mute rien et
   n'effectue aucune écriture. Les liens sortants et références orphelines sont
   exposés pour une confirmation/stratégie explicite dans un lot ultérieur. */
export function prepareTreeTransferPlan({ people = [], families = [], sourceTreeId, destinationTreeId = MAIN_TREE_ID } = {}) {
  const source = normalizeRequestedTreeId(sourceTreeId);
  const destination = normalizeRequestedTreeId(destinationTreeId);
  if (!source) throw new Error("L'arbre source est invalide");
  if (source === MAIN_TREE_ID) throw new Error("L'arbre principal ne peut pas être transféré ou supprimé");
  if (!destination) throw new Error("L'arbre de destination est invalide");
  if (source === destination) throw new Error("Les arbres source et destination doivent être différents");

  const sourcePeople = getTreePeople(people, source);
  const personIds = getTreeMemberIds(people, source);
  const sourceIds = new Set(personIds);
  const peopleById = new Map(people.filter(person => typeof person?.id === "string").map(person => [person.id, person]));
  const interTreeLinks = [];

  for (const family of families) {
    const refs = personIdsInFamily(family);
    const sourcePersonIds = refs.filter(id => sourceIds.has(id));
    if (!sourcePersonIds.length) continue;
    const outsidePersonIds = refs.filter(id => !sourceIds.has(id));
    if (!outsidePersonIds.length) continue;
    const unresolvedPersonIds = outsidePersonIds.filter(id => !peopleById.has(id));
    const otherTreePersonIds = outsidePersonIds.filter(id => {
      const person = peopleById.get(id);
      return person && getPersonTreeId(person) !== source;
    });
    interTreeLinks.push({
      familyId: typeof family?.id === "string" ? family.id : null,
      sourcePersonIds,
      otherTreePersonIds,
      unresolvedPersonIds
    });
  }

  return {
    sourceTreeId: source,
    destinationTreeId: destination,
    personIds,
    count: sourcePeople.length,
    interTreeLinks
  };
}
