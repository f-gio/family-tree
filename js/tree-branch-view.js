/**
 * Filtre de rendu « Voir la branche ».
 *
 * Module pur : il ne lit ni n'écrit aucune donnée (Firestore, identifiants,
 * relations) et ne touche pas au DOM. Il reçoit en entrée les people/families
 * complets et renvoie un sous-ensemble à afficher par le moteur de layout
 * existant, qui ignore totalement qu'un filtre est appliqué.
 */

export const DEFAULT_ANCESTOR_DEPTH = 3;
export const ALL_ANCESTORS = "all";

function parentsOf(personId, families, valid) {
  const parents = new Set();
  for (const family of families) {
    if (!(family.childIds || []).includes(personId)) continue;
    for (const id of family.partnerIds || []) if (valid(id)) parents.add(id);
  }
  return parents;
}

function childrenOf(personId, families, valid) {
  const children = new Set();
  for (const family of families) {
    if (!(family.partnerIds || []).includes(personId)) continue;
    for (const id of family.childIds || []) if (valid(id)) children.add(id);
  }
  return children;
}

function countHiddenAncestors(personId, families, valid, visible) {
  const seen = new Set();
  const stack = [personId];
  while (stack.length) {
    const current = stack.pop();
    for (const parentId of parentsOf(current, families, valid)) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      stack.push(parentId);
    }
  }
  let hidden = 0;
  for (const id of seen) if (!visible.has(id)) hidden += 1;
  return hidden;
}

/**
 * Calcule le sous-ensemble visible pour une personne racine.
 * Ascendance bornée par `ancestorDepth`, descendance illimitée, conjoints
 * strictement nécessaires. Renvoie des copies filtrées sans muter l'entrée.
 */
export function computeBranchView({ people = [], families = [], rootId = null, ancestorDepth = DEFAULT_ANCESTOR_DEPTH } = {}) {
  const byId = new Map(people.map(item => [item.id, item]));
  const valid = id => byId.has(id);
  const disabled = !rootId || !byId.has(rootId);
  if (disabled) {
    return {
      people,
      families,
      visibleIds: new Set(byId.keys()),
      hiddenAncestorCounts: new Map(),
      rootId: null,
      ancestorDepth
    };
  }

  const depth = ancestorDepth === ALL_ANCESTORS || ancestorDepth === Infinity
    ? Infinity
    : Math.max(0, Number(ancestorDepth) || 0);
  const visible = new Set([rootId]);
  const ancestorLine = new Set([rootId]);

  let frontier = new Set([rootId]);
  for (let level = 0; level < depth && frontier.size; level++) {
    const next = new Set();
    for (const id of frontier) {
      for (const parentId of parentsOf(id, families, valid)) {
        if (visible.has(parentId)) continue;
        visible.add(parentId);
        ancestorLine.add(parentId);
        next.add(parentId);
      }
    }
    frontier = next;
  }

  const queue = [];
  for (const childId of childrenOf(rootId, families, valid)) {
    if (visible.has(childId)) continue;
    visible.add(childId);
    queue.push(childId);
  }
  while (queue.length) {
    const id = queue.shift();
    for (const childId of childrenOf(id, families, valid)) {
      if (visible.has(childId)) continue;
      visible.add(childId);
      queue.push(childId);
    }
  }

  // Conjoints nécessaires : co-parents d'une filiation visible, ou union directe
  // de la personne racine. Les familles propres au conjoint restent exclues.
  let changed = true;
  while (changed) {
    changed = false;
    for (const family of families) {
      const partners = (family.partnerIds || []).filter(valid);
      if (!partners.length) continue;
      const hasVisiblePartner = partners.some(id => visible.has(id));
      const hasVisibleChild = (family.childIds || []).some(id => visible.has(id));
      const isRootUnion = partners.includes(rootId);
      if (!isRootUnion && !(hasVisiblePartner && hasVisibleChild)) continue;
      for (const partnerId of partners) {
        if (visible.has(partnerId)) continue;
        visible.add(partnerId);
        changed = true;
      }
    }
  }

  const hiddenAncestorCounts = new Map();
  for (const id of ancestorLine) {
    const parents = [...parentsOf(id, families, valid)];
    if (!parents.length) continue;
    if (parents.every(parentId => visible.has(parentId))) continue;
    const hidden = countHiddenAncestors(id, families, valid, visible);
    if (hidden > 0) hiddenAncestorCounts.set(id, hidden);
  }

  return {
    people: people.filter(item => visible.has(item.id)),
    families: families.filter(family =>
      (family.partnerIds || []).some(id => visible.has(id)) ||
      (family.childIds || []).some(id => visible.has(id))
    ),
    visibleIds: visible,
    hiddenAncestorCounts,
    rootId,
    ancestorDepth: depth === Infinity ? ALL_ANCESTORS : depth
  };
}
