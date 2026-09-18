/**
 * Filtre d'arbre par branche familiale.
 *
 * Module pur : il ne lit ni n'écrit aucune donnée (Firestore, identifiants,
 * relations) et ne touche pas au DOM. À partir des people/families complets et
 * d'un patronyme, il identifie la ou les racines de la lignée (par le nom de
 * naissance `lastName` et les relations réelles), puis renvoie un sous-ensemble
 * à afficher par le moteur de layout existant.
 *
 * L'identification de la lignée n'utilise jamais `marriedName` : une personne
 * née Pianezza et mariée Giovannoni reste dans la lignée Pianezza.
 */

import { computeBranchView } from "./tree-branch-view.js";

/** Patronymes proposés dans le filtre. Liste configurable, sans identifiant de personne. */
export const LINEAGE_SURNAMES = ["Giovannoni", "Conti", "Pianezza", "Paglia", "Piolini"];

export function normalizeLineageName(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Année de naissance exploitable pour départager deux racines (null si inconnue). */
export function lineageBirthYear(person) {
  const info = person?.birthDateInfo;
  if (info) {
    for (const key of ["year", "startYear", "from"]) {
      if (Number.isFinite(info[key])) return info[key];
    }
    if (Array.isArray(info.years) && Number.isFinite(info.years[0])) return info.years[0];
  }
  const match = String(person?.birthDate || "").match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function parentsMap(people, families) {
  const byId = new Map(people.map(item => [item.id, item]));
  const parents = new Map();
  for (const family of families) {
    const partners = (family.partnerIds || []).filter(id => byId.has(id));
    for (const childId of (family.childIds || []).filter(id => byId.has(id))) {
      if (!parents.has(childId)) parents.set(childId, new Set());
      for (const partnerId of partners) parents.get(childId).add(partnerId);
    }
  }
  return { byId, parents };
}

function childrenMap(people, families) {
  const byId = new Map(people.map(item => [item.id, item]));
  const children = new Map();
  for (const family of families) {
    const partners = (family.partnerIds || []).filter(id => byId.has(id));
    for (const childId of (family.childIds || []).filter(id => byId.has(id))) {
      for (const partnerId of partners) {
        if (!children.has(partnerId)) children.set(partnerId, new Set());
        children.get(partnerId).add(childId);
      }
    }
  }
  return children;
}

function ancestorsOf(personId, parents) {
  const seen = new Set();
  const stack = [...(parents.get(personId) || [])];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const parentId of parents.get(current) || []) stack.push(parentId);
  }
  return seen;
}

function descendantsOf(personId, children) {
  const seen = new Set();
  const stack = [...(children.get(personId) || [])];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const childId of children.get(current) || []) stack.push(childId);
  }
  return seen;
}

/**
 * Racines de lignée pour un patronyme.
 *
 * Une racine est une personne dont le nom de naissance correspond au patronyme
 * et qui n'a aucun ancêtre enregistré portant aussi ce patronyme. Les racines
 * qui partagent une union (co-fondateurs, ex. X + Y Paglia) sont regroupées.
 * Les lignées réellement déconnectées restent des groupes distincts.
 */
export function findLineageRoots({ people = [], families = [], surname = "" } = {}) {
  const target = normalizeLineageName(surname);
  if (!target) return { surname: "", rootGroups: [] };
  const candidates = people.filter(person => normalizeLineageName(person?.lastName) === target);
  if (!candidates.length) return { surname, rootGroups: [] };

  const candidateIds = new Set(candidates.map(person => person.id));
  const { parents } = parentsMap(people, families);
  const hasMatchedAncestor = personId => {
    for (const ancestorId of ancestorsOf(personId, parents)) {
      if (candidateIds.has(ancestorId)) return true;
    }
    return false;
  };

  let roots = candidates.filter(person => !hasMatchedAncestor(person.id));
  if (!roots.length) roots = [...candidates];

  const rootIndex = new Map(roots.map((person, index) => [person.id, index]));
  const union = roots.map((_, index) => index);
  const find = index => {
    let root = index;
    while (union[root] !== root) root = union[root];
    while (union[index] !== index) {
      const next = union[index];
      union[index] = root;
      index = next;
    }
    return root;
  };
  const unite = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) union[rootB] = rootA;
  };
  for (const family of families) {
    const partners = (family.partnerIds || []).filter(id => rootIndex.has(id));
    for (let index = 1; index < partners.length; index++) {
      unite(rootIndex.get(partners[0]), rootIndex.get(partners[index]));
    }
  }

  const groups = new Map();
  roots.forEach((person, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(person);
  });

  const rootGroups = [...groups.values()]
    .map(group => {
      const sorted = [...group].sort((a, b) => {
        const yearA = lineageBirthYear(a);
        const yearB = lineageBirthYear(b);
        const valueA = yearA == null ? Infinity : yearA;
        const valueB = yearB == null ? Infinity : yearB;
        if (valueA !== valueB) return valueA - valueB;
        return String(a.id).localeCompare(String(b.id));
      });
      return { rootId: sorted[0].id, rootIds: sorted.map(person => person.id) };
    })
    .sort((a, b) => String(a.rootId).localeCompare(String(b.rootId)));

  return { surname, rootGroups };
}

/** Groupe de racines retenu : celui qui couvre le plus de descendants. */
export function resolveLineage({ people = [], families = [], surname = "" } = {}) {
  const { rootGroups } = findLineageRoots({ people, families, surname });
  if (!rootGroups.length) return null;
  const children = childrenMap(people, families);
  let best = rootGroups[0];
  let bestCount = -1;
  for (const group of rootGroups) {
    const covered = new Set();
    for (const rootId of group.rootIds) {
      for (const descendantId of descendantsOf(rootId, children)) covered.add(descendantId);
    }
    if (covered.size > bestCount) {
      bestCount = covered.size;
      best = group;
    }
  }
  return { surname, rootId: best.rootId, rootIds: best.rootIds, rootGroups };
}

/**
 * Portée complète d'un filtre de branche : racine(s), descendance illimitée,
 * conjoints nécessaires, sans ascendance des conjoints. Les unions sans enfant
 * visible et avec un seul partenaire visible sont écartées pour ne pas créer de
 * nœuds parasites. Renvoie `null` si le patronyme n'a aucune racine.
 */
export function computeLineageScope({ people = [], families = [], surname = "", ancestorDepth = 0 } = {}) {
  const info = resolveLineage({ people, families, surname });
  if (!info) return null;

  const scope = computeBranchView({ people, families, rootId: info.rootId, ancestorDepth });
  const visible = new Set(scope.visibleIds);
  for (const rootId of info.rootIds) {
    if (people.some(person => person.id === rootId)) visible.add(rootId);
  }

  const visiblePeople = people.filter(person => visible.has(person.id));
  const visibleFamilies = scope.families.filter(family => {
    const partners = (family.partnerIds || []).filter(id => visible.has(id));
    const children = (family.childIds || []).filter(id => visible.has(id));
    return partners.length >= 2 || children.length >= 1;
  });

  return {
    people: visiblePeople,
    families: visibleFamilies,
    visibleIds: visible,
    hiddenAncestorCounts: new Map(),
    rootId: info.rootId,
    rootIds: info.rootIds,
    lineage: { surname: info.surname, roots: info.rootIds },
    ancestorDepth
  };
}
