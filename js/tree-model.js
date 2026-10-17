/* Helpers purs pour le modèle multi-arbres.
   Les personnes restent uniques : treeId absent/null signifie l'arbre principal. */

export const MAIN_TREE_ID = "main";
export const UNASSIGNED_TREE_STATE = "unassigned";
export const UNASSIGNED_TREE_CHOICE = "!unassigned!";
export const TREE_LIFECYCLE_ACTIVE = "active";
export const TREE_LIFECYCLE_DELETING = "deleting";

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
/* 20 mises à jour = 4 % du plafond Firestore de 500 écritures par transaction.
   Le budget de 100 documents lus borne la taille/durée des relectures relationnelles
   et réserve une marge pour les validations et écritures atomiques. */
export const MAX_MULTI_TREE_TRANSFER_PEOPLE = 20;
export const MAX_MULTI_TREE_TRANSFER_READS = 100;

export function isValidTreeId(treeId) {
  return typeof treeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(treeId);
}

export function getTreeLifecycleState(tree = {}) {
  if (!Object.prototype.hasOwnProperty.call(tree || {}, "lifecycleState")) return TREE_LIFECYCLE_ACTIVE;
  return tree.lifecycleState === TREE_LIFECYCLE_ACTIVE || tree.lifecycleState === TREE_LIFECYCLE_DELETING
    ? tree.lifecycleState
    : "invalid";
}

/* Le contrôle de suppression porte sur la référence explicite, pas sur
   l'appartenance normalisée ni la visibilité. Une paire incohérente qui pointe
   encore vers l'arbre est donc toujours un bloqueur. */
export function getTreeDeletionMemberReport(people = [], treeId) {
  if (!isValidTreeId(treeId) || treeId === MAIN_TREE_ID || !Array.isArray(people)) {
    throw new Error("L'arbre à vérifier est invalide");
  }
  const members = people.filter(item => item?.treeId === treeId);
  return {
    memberIds: members.map(item => item.id).filter(id => typeof id === "string" && id.length > 0),
    count: members.length,
    invalidMembershipIds: members.filter(item => getPersonTreeMembership(item).type !== "assigned")
      .map(item => item.id).filter(id => typeof id === "string" && id.length > 0)
  };
}

export function getPersonTreeId(person = {}) {
  if (Object.prototype.hasOwnProperty.call(person || {}, "treeAssignmentState")) return null;
  if (person?.treeId == null) return MAIN_TREE_ID;
  return isValidTreeId(person.treeId) ? person.treeId : null;
}

/* Les valeurs historiques treeId absent/null/main restent affectées au principal.
   La désaffectation n'est reconnue que si le marqueur et treeId vide concordent. */
export function getPersonTreeMembership(person = {}) {
  if (Object.prototype.hasOwnProperty.call(person || {}, "treeAssignmentState")) {
    return person.treeAssignmentState === UNASSIGNED_TREE_STATE && person.treeId === ""
      ? { type: "unassigned", treeId: null }
      : { type: "unavailable", treeId: null };
  }
  const treeId = getPersonTreeId(person);
  return treeId
    ? { type: "assigned", treeId }
    : { type: "unavailable", treeId: null };
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
  return people.filter(person => {
    const membership = getPersonTreeMembership(person);
    return membership.type === "assigned" && membership.treeId === requested;
  });
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

/* Les objets relationnels (parentChildLinks, links) peuvent être reçus avec un
   ordre de propriétés différent selon la source (cache local, relecture,
   transaction) alors qu'ils expriment la même relation. JSON.stringify étant
   sensible à cet ordre d'insertion, une normalisation canonique — clés d'objets
   triées, appliquée de façon récursive — est réservée au calcul de l'empreinte :
   une même relation produit ainsi la même empreinte quelle que soit la source,
   sans masquer une différence de valeurs réelle (parent, enfant, type, nombre
   de relations). Le tableau lui-même garde son ordre : l'échange de deux
   relations distinctes reste une modification détectable. */
function canonicalRelationValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRelationValue);
  if (value && typeof value === "object") {
    const canonical = {};
    for (const key of Object.keys(value).sort()) canonical[key] = canonicalRelationValue(value[key]);
    return canonical;
  }
  return value;
}

export function canonicalFamilyRelationData(family = {}) {
  return Object.fromEntries([...FAMILY_PERSON_ARRAY_FIELDS, ...FAMILY_LINK_FIELDS]
    .map(field => [field, family[field] == null ? null : canonicalRelationValue(family[field])]));
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
      if (!person) return false;
      const membership = getPersonTreeMembership(person);
      return membership.type !== "assigned" || membership.treeId !== source;
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
    const treePeople = getTreePeople(people, treeId);
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

  const sourceMembership = getPersonTreeMembership(person);
  if (sourceMembership.type === "unavailable") throw new Error("L'appartenance actuelle de cette personne est invalide ou indisponible");
  const sourceTreeId = sourceMembership.type === "assigned" ? sourceMembership.treeId : null;
  const knownTrees = trees.filter(tree => isValidTreeId(tree?.id) && tree.id !== MAIN_TREE_ID);
  if (sourceMembership.type === "assigned" && sourceTreeId !== MAIN_TREE_ID && !knownTrees.some(tree => tree.id === sourceTreeId)) {
    throw new Error("L'arbre actuel de cette personne est indisponible");
  }
  const destination = normalizeRequestedTreeId(destinationTreeId);
  if (!destination) throw new Error("L'arbre de destination est invalide");
  if (sourceMembership.type === "assigned" && destination === sourceTreeId) throw new Error("Choisissez un arbre différent de l'arbre actuel");
  const destinationTree = destination === MAIN_TREE_ID ? null : knownTrees.find(tree => tree.id === destination);
  if (destination !== MAIN_TREE_ID && !destinationTree) {
    throw new Error("L'arbre de destination est indisponible");
  }
  if (destinationTree && getTreeLifecycleState(destinationTree) !== TREE_LIFECYCLE_ACTIVE) {
    throw new Error("L'arbre de destination est en cours de suppression ou indisponible.");
  }

  const peopleById = new Map(people.filter(item => typeof item?.id === "string").map(item => [item.id, item]));
  const knownTreeIds = new Set([MAIN_TREE_ID, ...knownTrees.map(tree => tree.id)]);
  const affectedFamilies = families.filter(family => familyPersonIds(family).includes(personId))
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
  const treeIds = new Set([MAIN_TREE_ID, ...knownTrees.map(tree => tree.id)]);
  const afterPeople = people.map(item => {
    if (item.id !== personId) return item;
    const assigned = { ...item, treeId: destination };
    delete assigned.treeAssignmentState;
    if (sourceMembership.type === "unassigned") assigned.inTree = true;
    return assigned;
  });
  const plannedFamilies = affectedFamilies.map(family => {
    const memberIds = familyPersonIds(family);
    const members = memberIds.map(id => {
      const member = peopleById.get(id);
      const membership = member ? getPersonTreeMembership(member) : null;
      return {
        id,
        name: member ? personDisplayName(member) : "Personne introuvable",
        treeId: membership?.type === "assigned" ? membership.treeId : null,
        assignmentState: membership?.type || "unresolved",
        inTree: member?.inTree !== false,
        exists: !!member
      };
    });
    const unresolvedPersonIds = members.filter(member => !member.exists).map(member => member.id);
    const unassignedPersonIds = members.filter(member => member.assignmentState === "unassigned").map(member => member.id);
    const invalidMembershipIds = members.filter(member => member.exists
      && (member.assignmentState === "unavailable"
        || (member.assignmentState === "assigned" && !knownTreeIds.has(member.treeId)))).map(member => member.id);
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
      unassignedPersonIds,
      invalidMembershipIds,
      visibilityChange,
      relationData: canonicalFamilyRelationData(family)
    };
  });

  const familyReferences = plannedFamilies.map(family => ({
    familyId: family.familyId,
    memberIds: family.memberIds,
    members: family.members.map(member => ({ id: member.id, name: member.name, treeId: member.treeId, assignmentState: member.assignmentState, inTree: member.inTree, exists: member.exists })),
    relations: family.relationData
  }));
  const sourceTreeName = sourceMembership.type === "unassigned"
    ? "Aucun arbre"
    : sourceTreeId === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === sourceTreeId)?.name || "Arbre indisponible";
  const destinationTreeName = destination === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === destination)?.name || "Arbre indisponible";
  return {
    personId,
    personName: personDisplayName(person),
    personInTree: person.inTree !== false,
    sourceMembershipType: sourceMembership.type,
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
      unassignedRelatedCount: plannedFamilies.reduce((sum, family) => sum + family.unassignedPersonIds.length, 0),
      invalidMembershipCount: plannedFamilies.reduce((sum, family) => sum + family.invalidMembershipIds.length, 0)
    },
    fingerprint: JSON.stringify({
      personId, personName: personDisplayName(person), personInTree: person.inTree !== false,
      sourceMembershipType: sourceMembership.type, sourceTreeId, destinationTreeId: destination,
      sourceTreeName, destinationTreeName, familyReferences
    })
  };
}

/* Plan pur d'un transfert explicite de plusieurs personnes d'un même arbre.
   Les tableaux nuls/absents/main sont normalisés par getPersonTreeId ; aucune
   donnée d'entrée n'est mutée. Le fingerprint partage la canonicalisation 4C. */
export function prepareMultipleTreeTransferPlan({ personIds = [], people = [], families = [], trees = [], destinationTreeId } = {}) {
  if (!Array.isArray(personIds) || !personIds.length) throw new Error("Sélectionnez au moins une personne à transférer.");
  if (personIds.length > MAX_MULTI_TREE_TRANSFER_PEOPLE) {
    throw new Error(`La sélection est limitée à ${MAX_MULTI_TREE_TRANSFER_PEOPLE} personnes par transfert.`);
  }
  if (new Set(personIds).size !== personIds.length) throw new Error("La sélection contient des personnes en double.");
  if (!personIds.every(id => typeof id === "string" && id.length > 0)
    || !Array.isArray(people) || !Array.isArray(families) || !Array.isArray(trees)) {
    throw new Error("Les données du transfert multiple sont invalides.");
  }

  const peopleById = new Map(people.filter(item => typeof item?.id === "string").map(item => [item.id, item]));
  const selectedPeople = personIds.map(id => {
    const item = peopleById.get(id);
    if (!item) throw new Error("Une personne sélectionnée n'existe plus. Recommencez la sélection.");
    return item;
  });
  const sourceMembership = getPersonTreeMembership(selectedPeople[0]);
  if (sourceMembership.type !== "assigned") throw new Error("Les personnes sans arbre ou à appartenance invalide ne peuvent pas être incluses dans un transfert multiple.");
  const sourceTreeId = sourceMembership.treeId;
  if (selectedPeople.some(item => {
    const membership = getPersonTreeMembership(item);
    return membership.type !== "assigned" || membership.treeId !== sourceTreeId;
  })) {
    throw new Error("Toutes les personnes sélectionnées doivent appartenir au même arbre source.");
  }

  const knownTrees = trees.filter(tree => isValidTreeId(tree?.id) && tree.id !== MAIN_TREE_ID);
  if (sourceTreeId !== MAIN_TREE_ID && !knownTrees.some(tree => tree.id === sourceTreeId)) {
    throw new Error("L'arbre source n'est plus disponible. Recommencez la sélection.");
  }
  const destination = normalizeRequestedTreeId(destinationTreeId);
  if (!destination) throw new Error("L'arbre de destination est invalide.");
  if (destination === sourceTreeId) throw new Error("Choisissez un arbre différent de l'arbre source.");
  const destinationTree = destination === MAIN_TREE_ID ? null : knownTrees.find(tree => tree.id === destination);
  if (destination !== MAIN_TREE_ID && !destinationTree) {
    throw new Error("L'arbre de destination est indisponible.");
  }
  if (destinationTree && getTreeLifecycleState(destinationTree) !== TREE_LIFECYCLE_ACTIVE) {
    throw new Error("L'arbre de destination est en cours de suppression ou indisponible.");
  }

  const selectedIds = new Set(personIds);
  const canonicalIds = [...selectedIds].sort((a, b) => a.localeCompare(b));
  const affectedFamilies = families.filter(family => familyPersonIds(family).some(id => selectedIds.has(id)))
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
  const familyIds = affectedFamilies.map(family => typeof family?.id === "string" ? family.id : null);
  if (familyIds.some(id => !id)) throw new Error("Un foyer concerné n'a pas d'identifiant valide.");

  const allMemberIds = new Set(canonicalIds);
  for (const family of affectedFamilies) for (const id of familyPersonIds(family)) allMemberIds.add(id);
  const readTreeIds = [...new Set([sourceTreeId, destination])].filter(id => id !== MAIN_TREE_ID);
  const readDocumentCount = allMemberIds.size + familyIds.length + readTreeIds.length;
  if (readDocumentCount > MAX_MULTI_TREE_TRANSFER_READS) {
    throw new Error(`Les relations concernent trop de documents (${readDocumentCount}) pour une transaction sûre. Réduisez la sélection.`);
  }

  const treeIds = new Set([MAIN_TREE_ID, ...knownTrees.map(tree => tree.id)]);
  const afterPeople = people.map(item => selectedIds.has(item.id) ? { ...item, treeId: destination } : item);
  const plannedFamilies = affectedFamilies.map(family => {
    const memberIds = familyPersonIds(family);
    const members = memberIds.map(id => {
      const member = peopleById.get(id);
      const membership = member ? getPersonTreeMembership(member) : null;
      return {
        id,
        name: member ? personDisplayName(member) : "Personne introuvable",
        treeId: membership?.type === "assigned" ? membership.treeId : null,
        assignmentState: membership?.type || "unresolved",
        inTree: member?.inTree !== false,
        exists: !!member,
        selected: selectedIds.has(id)
      };
    });
    const beforeVisibleTreeIds = visibleFamilyTreeIds(family, people, treeIds);
    const afterVisibleTreeIds = visibleFamilyTreeIds(family, afterPeople, treeIds);
    const selectedMemberIds = memberIds.filter(id => selectedIds.has(id));
    const otherTreeMemberIds = members.filter(member => member.exists && member.assignmentState === "assigned"
      && member.treeId !== sourceTreeId && member.treeId !== destination).map(member => member.id);
    const unassignedMemberIds = members.filter(member => member.assignmentState === "unassigned").map(member => member.id);
    const invalidMembershipIds = members.filter(member => member.exists && member.assignmentState === "unavailable").map(member => member.id);
    return {
      familyId: family.id,
      memberIds,
      members,
      selectedMemberIds,
      unselectedMemberIds: memberIds.filter(id => !selectedIds.has(id)),
      otherTreeMemberIds,
      unassignedMemberIds,
      invalidMembershipIds,
      internalToSelection: memberIds.length > 0 && memberIds.every(id => selectedIds.has(id)),
      beforeVisibleTreeIds,
      afterVisibleTreeIds,
      relationData: canonicalFamilyRelationData(family)
    };
  });

  const canonicalSelectedPeople = canonicalIds.map(id => {
    const item = peopleById.get(id);
    return { id, name: personDisplayName(item), treeId: getPersonTreeId(item), assignmentState: "assigned", inTree: item.inTree !== false, exists: true };
  });
  const sourceTreeName = sourceTreeId === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === sourceTreeId)?.name || "Arbre indisponible";
  const destinationTreeName = destination === MAIN_TREE_ID ? "Arbre familial" : knownTrees.find(tree => tree.id === destination)?.name || "Arbre indisponible";
  const familyReferences = plannedFamilies.map(family => ({
    familyId: family.familyId,
    memberIds: family.memberIds,
    members: family.members.map(({ id, name, treeId, assignmentState, inTree, exists }) => ({ id, name, treeId, assignmentState, inTree, exists })),
    relations: family.relationData
  }));
  const fingerprint = JSON.stringify({
    personIds: canonicalIds,
    selectedPeople: canonicalSelectedPeople,
    sourceTreeId,
    destinationTreeId: destination,
    sourceTreeName,
    destinationTreeName,
    familyReferences
  });

  return {
    personIds: canonicalIds,
    selectedPeople: canonicalSelectedPeople,
    sourceTreeId,
    destinationTreeId: destination,
    sourceTreeName,
    destinationTreeName,
    affectedFamilies: plannedFamilies,
    readDocumentCount,
    summary: {
      selectedCount: canonicalIds.length,
      affectedFamilyCount: plannedFamilies.length,
      internalFamilyCount: plannedFamilies.filter(family => family.internalToSelection).length,
      boundaryFamilyCount: plannedFamilies.filter(family => !family.internalToSelection).length,
      otherTreeLinkCount: plannedFamilies.filter(family => family.otherTreeMemberIds.length).length,
      unassignedRelatedCount: plannedFamilies.reduce((sum, family) => sum + family.unassignedMemberIds.length, 0),
      hiddenSelectionCount: canonicalSelectedPeople.filter(item => !item.inTree).length
    },
    fingerprint
  };
}
