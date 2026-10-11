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

export function familyPersonIds(family = {}) {
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
    const refs = familyPersonIds(family);
    return refs.length > 0 && refs.every(id => memberIds.has(id));
  });
}

function familyVisibleInTree(family, people, treeId) {
  const members = getTreePeople(people, treeId);
  if (getTreeFamilies([family], members).length !== 1) return false;
  const visibleIds = new Set(members.filter(person => person?.inTree !== false).map(person => person?.id));
  const partners = (family.partnerIds || []).filter(id => visibleIds.has(id));
  const children = (family.childIds || []).filter(id => visibleIds.has(id));
  // Le layout dessine une union à partir de deux partenaires, ou une filiation
  // lorsqu'au moins un parent et un enfant sont visibles. Une personne masquée
  // ne supprime donc pas arbitrairement les autres arêtes encore dessinables.
  return partners.length > 1 || (partners.length > 0 && children.length > 0);
}

function personDisplayName(person = {}) {
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ") || "Personne sans nom";
}

/* Prépare un aperçu descriptif du transfert global d'un arbre secondaire vers
   main. Ne mute rien et n'effectue aucune écriture. */
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
    const refs = familyPersonIds(family);
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

function visibleFamilyTreeIds(family, people, treeIds) {
  return [...treeIds].filter(treeId => {
    const treePeople = people.filter(person => getPersonTreeId(person) === treeId);
    return familyVisibleInTree(family, treePeople, treeId);
  });
}

/* Plan pur pour déplacer UNE personne existante. Le fingerprint couvre
   l'appartenance et les références des foyers concernés afin que l'interface
   puisse refuser une confirmation dont l'aperçu a vieilli. */
export function prepareIndividualTreeTransferPlan({ personId, people = [], families = [], trees = [], destinationTreeId } = {}) {
  if (typeof personId !== "string" || !personId) throw new Error("La personne à déplacer est introuvable");
  if (!Array.isArray(people) || !Array.isArray(families) || !Array.isArray(trees)) throw new Error("Les données du transfert sont invalides");
  const person = people.find(item => item?.id === personId);
  if (!person) throw new Error("La personne à déplacer est introuvable");

  const sourceTreeId = getPersonTreeId(person);
  if (!sourceTreeId) throw new Error("L'arbre actuel de cette personne est invalide ou indisponible");
  const knownTrees = trees.filter(tree => isValidTreeId(tree?.id) && tree.id !== MAIN_TREE_ID);
  if (sourceTreeId !== MAIN_TREE_ID && !knownTrees.some(tree => tree.id === sourceTreeId)) {
    throw new Error("L'arbre actuel de cette personne est indisponible");
  }
  const destination = normalizeRequestedTreeId(destinationTreeId);
  if (!destination) throw new Error("L'arbre de destination est invalide");
  if (destination === sourceTreeId) throw new Error("Choisissez un arbre différent de l'arbre actuel");
  if (destination !== MAIN_TREE_ID && !knownTrees.some(tree => tree.id === destination)) {
    throw new Error("L'arbre de destination est indisponible");
  }

  const peopleById = new Map(people.filter(item => typeof item?.id === "string").map(item => [item.id, item]));
  const knownTreeIds = new Set([MAIN_TREE_ID, ...knownTrees.map(tree => tree.id)]);
  const affectedFamilies = families.filter(family => familyPersonIds(family).includes(personId))
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
  const treeIds = new Set([MAIN_TREE_ID, ...knownTrees.map(tree => tree.id)]);
  const afterPeople = people.map(item => item.id === personId ? { ...item, treeId: destination } : item);
  const plannedFamilies = affectedFamilies.map(family => {
    const memberIds = familyPersonIds(family);
    const members = memberIds.map(id => {
      const member = peopleById.get(id);
      return {
        id,
        name: member ? personDisplayName(member) : "Personne introuvable",
        treeId: member ? getPersonTreeId(member) : null,
        inTree: member?.inTree !== false,
        exists: !!member
      };
    });
    const unresolvedPersonIds = members.filter(member => !member.exists).map(member => member.id);
    const invalidMembershipIds = members.filter(member => member.exists
      && (!member.treeId || !knownTreeIds.has(member.treeId))).map(member => member.id);
    const beforeVisibleTreeIds = visibleFamilyTreeIds(family, people, treeIds);
    const afterVisibleTreeIds = visibleFamilyTreeIds(family, afterPeople, treeIds);
    const wasVisible = beforeVisibleTreeIds.length > 0;
    const willBeVisible = afterVisibleTreeIds.length > 0;
    const visibilityChange = wasVisible && !willBeVisible
      ? "becomes-hidden"
      : !wasVisible && willBeVisible
        ? "becomes-visible"
        : wasVisible && willBeVisible
          ? "remains-visible"
          : "remains-hidden";
    return {
      familyId: typeof family.id === "string" ? family.id : null,
      memberIds,
      members,
      beforeVisibleTreeIds,
      afterVisibleTreeIds,
      unresolvedPersonIds,
      invalidMembershipIds,
      visibilityChange,
      relationData: Object.fromEntries([...FAMILY_PERSON_ARRAY_FIELDS, ...FAMILY_LINK_FIELDS]
        .map(field => [field, family[field] == null ? null : family[field]]))
    };
  });

  const familyReferences = plannedFamilies.map(family => ({
    familyId: family.familyId,
    memberIds: family.memberIds,
    members: family.members.map(member => ({ id: member.id, name: member.name, treeId: member.treeId, inTree: member.inTree, exists: member.exists })),
    relations: family.relationData
  }));
  const sourceTreeName = sourceTreeId === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === sourceTreeId)?.name || "Arbre indisponible";
  const destinationTreeName = destination === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === destination)?.name || "Arbre indisponible";
  return {
    personId,
    personName: personDisplayName(person),
    personInTree: person.inTree !== false,
    sourceTreeId,
    destinationTreeId: destination,
    sourceTreeName,
    destinationTreeName,
    affectedFamilies: plannedFamilies,
    summary: {
      affectedFamilyCount: plannedFamilies.length,
      remainsVisibleCount: plannedFamilies.filter(family => family.visibilityChange === "remains-visible").length,
      becomesHiddenCount: plannedFamilies.filter(family => family.visibilityChange === "becomes-hidden").length,
      becomesVisibleCount: plannedFamilies.filter(family => family.visibilityChange === "becomes-visible").length,
      unresolvedReferenceCount: plannedFamilies.reduce((sum, family) => sum + family.unresolvedPersonIds.length, 0),
      invalidMembershipCount: plannedFamilies.reduce((sum, family) => sum + family.invalidMembershipIds.length, 0)
    },
    fingerprint: JSON.stringify({
      personId, personName: personDisplayName(person), personInTree: person.inTree !== false,
      sourceTreeId, destinationTreeId: destination, sourceTreeName, destinationTreeName, familyReferences
    })
  };
}
