import { genealogyDateSortValue } from "./genealogy-date.js";

/**
 * Moteur de layout hybride (isolé, expérimental).
 *
 * Objectifs par rapport à l'ancien `tree-layout.js` (gardé intact comme
 * fallback) :
 *  - modéliser chaque union comme un nœud interne distinct (pas de fusion
 *    transitive des conjoints) ;
 *  - garantir une seule revendication de largeur par sous-branche (fin de la
 *    double réservation quand les deux conjoints ont leurs propres parents) ;
 *  - remplacer la réservation en bande pleine par un placement à contours
 *    inspiré des tidy-trees ;
 *  - rester déterministe quel que soit l'ordre des tableaux d'entrée.
 *
 * Le module est pur : aucune lecture/écriture Firestore, aucun DOM. Il
 * n'expose que des personnes en sortie (les union-nodes restent internes).
 */

export const TREE_LAYOUT_GEOMETRY = Object.freeze({
  cardWidth: 282,
  cardHeight: 158,
  partnerGap: 30,
  siblingGap: 54,
  familyGap: 94,
  branchGap: 140,
  generationGap: 116,
  levelGap: 116,
  componentGap: 180,
  margin: 120
});

function uniqueValid(ids, validIds) {
  return [...new Set((ids || []).filter(id => validIds.has(id)))];
}

function compareKeys(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index], right = b[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

function personKey(person) {
  const date = genealogyDateSortValue(person?.birthDateInfo, person?.birthDate);
  return [
    Number.isFinite(date) ? date : Number.MAX_SAFE_INTEGER,
    String(person?.lastName || "").toLowerCase(),
    String(person?.firstName || "").toLowerCase(),
    String(person?.middleName || "").toLowerCase(),
    String(person?.id || "")
  ];
}

function createDisjointSet(ids) {
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  return { find, union };
}

function computeLevels(people, families) {
  const levels = new Map(people.map(item => [item.id, 0]));
  const maxPasses = Math.max(8, people.length * 2 + families.length);
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const family of families) {
      const parentLevel = Math.max(0, ...family.partnerIds.map(id => levels.get(id) || 0));
      for (const partnerId of family.partnerIds) {
        if ((levels.get(partnerId) || 0) < parentLevel) {
          levels.set(partnerId, parentLevel);
          changed = true;
        }
      }
      for (const childId of family.childIds) {
        if ((levels.get(childId) || 0) <= parentLevel) {
          levels.set(childId, parentLevel + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return levels;
}

function orderMembers(memberIds, linkCount, peopleById) {
  const sorted = [...memberIds].sort((a, b) => compareKeys(personKey(peopleById.get(a)), personKey(peopleById.get(b))));
  if (sorted.length < 3) return sorted;
  let hub = sorted[0];
  for (const id of sorted) if ((linkCount.get(id) || 0) > (linkCount.get(hub) || 0)) hub = id;
  const others = sorted.filter(id => id !== hub);
  const middle = Math.floor(others.length / 2);
  return [...others.slice(0, middle), hub, ...others.slice(middle)];
}

function requiredShift(accumulated, incoming, gap) {
  let shift = 0;
  for (const [depth, range] of incoming) {
    const current = accumulated.get(depth);
    if (current) shift = Math.max(shift, current.max + gap - range.min);
  }
  return Math.max(0, shift);
}

function shiftContour(contour, shift) {
  const next = new Map();
  for (const [depth, range] of contour) next.set(depth, { min: range.min + shift, max: range.max + shift });
  return next;
}

function mergeContours(target, source) {
  const next = new Map(target);
  for (const [depth, range] of source) {
    const current = next.get(depth);
    if (!current) next.set(depth, { min: range.min, max: range.max });
    else next.set(depth, { min: Math.min(current.min, range.min), max: Math.max(current.max, range.max) });
  }
  return next;
}

function emptyLayout(geometry, families) {
  return {
    positions: new Map(),
    families,
    bounds: { x: 0, y: 0, width: 720, height: 460 },
    geometry,
    unionOrigins: new Map()
  };
}

/**
 * Calcule le layout hybride. Interface identique à l'ancien moteur :
 * `{ positions, families, bounds, geometry }` (+ `unionOrigins`).
 */
export function calculateTreeLayout(peopleInput = [], familiesInput = [], geometry = {}, options = {}) {
  const g = { ...TREE_LAYOUT_GEOMETRY, ...geometry };
  const people = [...peopleInput];
  const peopleById = new Map(people.map(item => [item.id, item]));
  const validIds = new Set(peopleById.keys());
  const families = familiesInput.map(family => ({
    ...family,
    partnerIds: uniqueValid(family.partnerIds, validIds),
    childIds: uniqueValid(family.childIds, validIds)
  })).filter(family => family.partnerIds.length || family.childIds.length);

  if (!people.length) return emptyLayout(g, families);

  const levels = computeLevels(people, families);

  // --- Une seule revendication : union-nodes distincts + blocs de conjoints ---
  const partnerSet = createDisjointSet([...validIds]);
  const linkCount = new Map();
  for (const family of families) {
    const [first, ...rest] = family.partnerIds;
    if (first) rest.forEach(partner => partnerSet.union(first, partner));
    for (const partnerId of family.partnerIds) linkCount.set(partnerId, (linkCount.get(partnerId) || 0) + Math.max(0, family.partnerIds.length - 1));
  }

  const membersByRoot = new Map();
  for (const person of people) {
    const root = partnerSet.find(person.id);
    if (!membersByRoot.has(root)) membersByRoot.set(root, []);
    membersByRoot.get(root).push(person.id);
  }

  const groups = [...membersByRoot.values()].map(memberIds => {
    const ordered = orderMembers(memberIds, linkCount, peopleById);
    return { ordered, key: personKey(peopleById.get([...memberIds].sort((a, b) => compareKeys(personKey(peopleById.get(a)), personKey(peopleById.get(b))))[0])) };
  });
  groups.sort((a, b) => compareKeys(a.key, b.key) || a.ordered.length - b.ordered.length);

  const blocks = new Map();
  const blockByPerson = new Map();
  groups.forEach((group, index) => {
    const id = `block-${index}`;
    const rank = Math.max(0, ...group.ordered.map(personId => levels.get(personId) || 0));
    const block = {
      id,
      key: group.key,
      memberIds: group.ordered,
      rank,
      width: group.ordered.length * g.cardWidth + Math.max(0, group.ordered.length - 1) * g.partnerGap,
      unionIds: [],
      incoming: [],
      parentUnionId: null
    };
    blocks.set(id, block);
    group.ordered.forEach(personId => blockByPerson.set(personId, id));
  });

  // Union-nodes internes (aucune carte, aucune persistance).
  const unions = new Map();
  const unionList = [];
  families.forEach((family, index) => {
    if (!family.partnerIds.length) return;
    const partners = [...family.partnerIds].sort((a, b) => compareKeys(personKey(peopleById.get(a)), personKey(peopleById.get(b))));
    const anchor = partners[0];
    const blockId = blockByPerson.get(anchor);
    const rank = Math.max(0, ...partners.map(id => levels.get(id) || 0));
    const id = `union-${family.id ?? index}`;
    const union = {
      id,
      familyId: family.id ?? null,
      family,
      partnerIds: partners,
      childIds: [...family.childIds],
      rank,
      blockId,
      childBlockCandidates: [],
      childBlockIds: [],
      key: [rank, ...personKey(peopleById.get(anchor)), String(family.id || index)]
    };
    unions.set(id, union);
    unionList.push(union);
    blocks.get(blockId).unionIds.push(id);
  });

  for (const block of blocks.values()) {
    block.unionIds.sort((a, b) => compareKeys(unions.get(a).key, unions.get(b).key));
  }

  for (const union of unionList) {
    const candidates = new Set();
    for (const childId of union.childIds) {
      const childBlock = blockByPerson.get(childId);
      if (!childBlock || childBlock === union.blockId) continue;
      candidates.add(childBlock);
    }
    union.childBlockCandidates = [...candidates].sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key));
    for (const childBlock of union.childBlockCandidates) blocks.get(childBlock).incoming.push(union.id);
  }

  for (const block of blocks.values()) {
    block.incoming.sort((a, b) => compareKeys(unions.get(a).key, unions.get(b).key));
    block.parentUnionId = block.incoming.length ? block.incoming[0] : null;
  }

  for (const union of unionList) {
    union.childBlockIds = union.childBlockCandidates.filter(childBlock => blocks.get(childBlock).parentUnionId === union.id);
  }

  // --- Composantes faiblement connexes (partenariats + filiations) ---
  // Calculées une fois : stables quel que soit l'ordre de rendu des sous-arbres.
  const componentSet = createDisjointSet([...validIds]);
  for (const family of families) {
    const anchors = family.partnerIds;
    if (anchors.length) {
      for (let index = 1; index < anchors.length; index++) componentSet.union(anchors[0], anchors[index]);
      for (const childId of family.childIds) componentSet.union(anchors[0], childId);
    } else {
      const [firstChild, ...restChildren] = family.childIds;
      if (firstChild) restChildren.forEach(childId => componentSet.union(firstChild, childId));
    }
  }

  const blocksByComponent = new Map();
  for (const block of blocks.values()) {
    const root = componentSet.find(block.memberIds[0]);
    if (!blocksByComponent.has(root)) blocksByComponent.set(root, []);
    blocksByComponent.get(root).push(block);
  }

  function reachableBlocks(rootId) {
    const seen = new Set();
    const stack = [rootId];
    while (stack.length) {
      const blockId = stack.pop();
      if (seen.has(blockId)) continue;
      seen.add(blockId);
      const block = blocks.get(blockId);
      for (const unionId of block.unionIds) for (const childBlock of unions.get(unionId).childBlockIds) stack.push(childBlock);
    }
    return seen;
  }

  function canonicalRootIds(blocksOfComponent) {
    const roots = blocksOfComponent.filter(block => !block.parentUnionId);
    const list = (roots.length ? roots : [blocksOfComponent.slice().sort((a, b) => compareKeys(a.key, b.key))[0]]).map(block => block.id);
    const reached = new Set();
    list.forEach(rootId => reachableBlocks(rootId).forEach(id => reached.add(id)));
    for (const block of blocksOfComponent) {
      if (!reached.has(block.id)) {
        list.push(block.id);
        reachableBlocks(block.id).forEach(id => reached.add(id));
      }
    }
    return [...new Set(list)].sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key));
  }

  // --- Ordonnancement des RACINES d'une composante (macros-branches reliées) ---
  // Une composante peut contenir plusieurs racines primaires (forêt) reliées par
  // des liens secondaires. Leur ordre purement canonique peut intercaler une
  // macro-branche entre deux autres pourtant reliées. On construit un graphe
  // d'affinité entre racines (nombre de ponts secondaires) puis on ordonne les
  // racines pour rapprocher les branches reliées, chaque macro-branche restant
  // un bloc rigide. L'ordre n'est appliqué que si `compareCost` l'accepte.
  const rootOrderOverrides = new Map();
  const ROOT_ORDER_EXHAUSTIVE_LIMIT = 8;

  function optimizeRootOrder(rootIds, affinity) {
    const edges = [];
    for (const [a, neighbors] of affinity) {
      for (const [b, weight] of neighbors) {
        if (compareKeys(blocks.get(a).key, blocks.get(b).key) < 0) edges.push([a, b, weight]);
      }
    }
    if (!edges.length) return rootIds;
    const costOf = order => {
      const position = new Map(order.map((id, index) => [id, index]));
      let total = 0;
      for (const [a, b, weight] of edges) {
        const positionA = position.get(a), positionB = position.get(b);
        if (positionA === undefined || positionB === undefined) continue;
        total += weight * Math.abs(positionA - positionB);
      }
      return total;
    };
    const count = rootIds.length;
    if (count <= ROOT_ORDER_EXHAUSTIVE_LIMIT) {
      // Recherche exhaustive déterministe ; à coût égal, l'ordre canonique
      // initial est conservé (tie-breaker).
      let best = [...rootIds], bestCost = costOf(best);
      const permute = (array, start) => {
        if (start === count) {
          const candidateCost = costOf(array);
          if (candidateCost < bestCost) { bestCost = candidateCost; best = [...array]; }
          return;
        }
        for (let index = start; index < count; index++) {
          [array[start], array[index]] = [array[index], array[start]];
          permute(array, start + 1);
          [array[start], array[index]] = [array[index], array[start]];
        }
      };
      permute([...rootIds], 0);
      return best;
    }
    // Au-delà du seuil : heuristique d'insertion déterministe en O(n^2).
    const ordered = [rootIds[0]];
    for (let index = 1; index < count; index++) {
      const id = rootIds[index];
      let bestPosition = ordered.length, bestCost = Infinity;
      for (let position = 0; position <= ordered.length; position++) {
        const candidate = [...ordered.slice(0, position), id, ...ordered.slice(position)];
        const candidateCost = costOf(candidate);
        if (candidateCost < bestCost) { bestCost = candidateCost; bestPosition = position; }
      }
      ordered.splice(bestPosition, 0, id);
    }
    return ordered;
  }

  function reorderRoots() {
    const parentBlockOf = new Map();
    for (const block of blocks.values()) {
      if (block.parentUnionId) parentBlockOf.set(block.id, unions.get(block.parentUnionId).blockId);
    }
    const primaryRootOf = blockId => {
      let current = blockId;
      const seen = new Set();
      while (parentBlockOf.get(current) && !seen.has(current)) { seen.add(current); current = parentBlockOf.get(current); }
      return current;
    };
    let changed = false;
    for (const [componentKey, blocksOfComponent] of blocksByComponent) {
      const rootIds = canonicalRootIds(blocksOfComponent);
      if (rootIds.length < 2) continue;
      const affinity = new Map(rootIds.map(id => [id, new Map()]));
      let hasAffinity = false;
      for (const block of blocksOfComponent) {
        if (block.incoming.length < 2) continue;
        const rootBlock = primaryRootOf(block.id);
        for (const unionId of block.incoming) {
          if (unionId === block.parentUnionId) continue;
          const otherRoot = primaryRootOf(unions.get(unionId).blockId);
          if (!affinity.has(rootBlock) || !affinity.has(otherRoot) || rootBlock === otherRoot) continue;
          affinity.get(rootBlock).set(otherRoot, (affinity.get(rootBlock).get(otherRoot) || 0) + 1);
          affinity.get(otherRoot).set(rootBlock, (affinity.get(otherRoot).get(rootBlock) || 0) + 1);
          hasAffinity = true;
        }
      }
      if (!hasAffinity) continue;
      const nextOrder = optimizeRootOrder(rootIds, affinity);
      if (nextOrder.some((id, index) => id !== rootIds[index])) {
        rootOrderOverrides.set(componentKey, nextOrder);
        changed = true;
      }
    }
    return changed;
  }

  // --- Placement à contours ---
  function runLayout() {
  const layoutMemo = new Map();
  const layoutStack = new Set();

  function layoutBlock(blockId) {
    if (layoutMemo.has(blockId)) return layoutMemo.get(blockId);
    if (layoutStack.has(blockId)) return { nodes: [], contour: new Map(), selfCenter: 0 };
    layoutStack.add(blockId);
    const block = blocks.get(blockId);
    const entries = [];
    for (const unionId of block.unionIds) {
      const union = unions.get(unionId);
      union.childBlockIds.forEach((childBlock, index) => entries.push({
        blockId: childBlock,
        gapBefore: index === 0 ? (entries.length ? g.familyGap : 0) : g.siblingGap
      }));
    }

    const placed = entries.map(entry => ({ entry, layout: layoutBlock(entry.blockId) }));
    let contour = new Map();
    const nodes = [];
    for (const { entry, layout } of placed) {
      const shift = contour.size ? requiredShift(contour, layout.contour, entry.gapBefore) : 0;
      for (const node of layout.nodes) nodes.push({ id: node.id, depth: node.depth, x: node.x + shift });
      contour = mergeContours(contour, shiftContour(layout.contour, shift));
      layout.shiftedCenter = layout.selfCenter + shift;
    }

    let center = 0;
    if (placed.length) {
      const centers = placed.map(item => item.layout.shiftedCenter);
      center = (Math.min(...centers) + Math.max(...centers)) / 2;
    }
    const blockLeft = center - block.width / 2;
    block.memberIds.forEach((personId, index) => nodes.push({
      id: personId,
      depth: block.rank,
      x: blockLeft + index * (g.cardWidth + g.partnerGap)
    }));
    contour = addToContour(contour, block.rank, blockLeft, blockLeft + block.width);

    const result = { nodes, contour, selfCenter: center };
    layoutStack.delete(blockId);
    layoutMemo.set(blockId, result);
    return result;
  }

  const components = [];
  for (const [componentKey, blocksOfComponent] of blocksByComponent) {
    const canonicalIds = canonicalRootIds(blocksOfComponent);
    const override = rootOrderOverrides.get(componentKey);
    let rootIds = canonicalIds;
    if (override) {
      const available = new Set(canonicalIds);
      const ordered = override.filter(id => available.has(id));
      const seen = new Set(ordered);
      for (const id of canonicalIds) if (!seen.has(id)) { ordered.push(id); seen.add(id); }
      rootIds = ordered;
    }

    const nodes = [];
    let contour = new Map();
    rootIds.forEach((rootId, index) => {
      const sub = layoutBlock(rootId);
      const gapBefore = index === 0 ? 0 : g.branchGap;
      const shift = contour.size ? requiredShift(contour, sub.contour, gapBefore) : 0;
      for (const node of sub.nodes) nodes.push({ id: node.id, depth: node.depth, x: node.x + shift });
      contour = mergeContours(contour, shiftContour(sub.contour, shift));
    });
    if (!nodes.length) continue;

    const minX = Math.min(...nodes.map(node => node.x));
    const maxX = Math.max(...nodes.map(node => node.x + g.cardWidth));
    const minDepth = Math.min(...nodes.map(node => node.depth));
    const maxDepth = Math.max(...nodes.map(node => node.depth));
    const rowHeight = g.cardHeight + g.generationGap;
    components.push({
      key: blocks.get(canonicalIds[0]).key,
      nodes: nodes.map(node => ({ id: node.id, x: node.x - minX, depth: node.depth - minDepth })),
      width: maxX - minX,
      height: (maxDepth - minDepth) * rowHeight + g.cardHeight
    });
  }
  components.sort((a, b) => compareKeys(a.key, b.key));

  // Empaquetage compact des composantes réellement indépendantes.
  const targetWidth = Math.max(900, ...components.map(component => component.width));
  let shelfX = 0, shelfY = 0, shelfHeight = 0;
  for (const component of components) {
    if (shelfX > 0 && shelfX + component.width > targetWidth) {
      shelfY += shelfHeight + g.componentGap;
      shelfX = 0;
      shelfHeight = 0;
    }
    component.offsetX = shelfX;
    component.offsetY = shelfY;
    shelfX += component.width + g.componentGap;
    shelfHeight = Math.max(shelfHeight, component.height);
  }

  const rowHeight = g.cardHeight + g.generationGap;
  const positions = new Map();
  for (const component of components) {
    for (const node of component.nodes) {
      positions.set(node.id, {
        x: component.offsetX + node.x + g.margin,
        y: component.offsetY + node.depth * rowHeight + g.margin,
        width: g.cardWidth,
        height: g.cardHeight,
        unitId: blockByPerson.get(node.id)
      });
    }
  }

  // Origine géométrique propre à chaque union (pour le renderer).
  const unionOrigins = new Map();
  for (const union of unionList) {
    const partners = union.partnerIds.map(id => positions.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
    if (!partners.length) continue;
    const first = partners[0], last = partners[partners.length - 1];
    const key = union.familyId ?? union.id;
    unionOrigins.set(key, {
      x: (first.x + first.width + last.x) / 2,
      y: Math.max(...partners.map(partner => partner.y + partner.height))
    });
  }

  let maxX = 0, maxY = 0;
  for (const position of positions.values()) {
    maxX = Math.max(maxX, position.x + position.width);
    maxY = Math.max(maxY, position.y + position.height);
  }

  return {
    positions,
    families,
    bounds: { x: 0, y: 0, width: Math.max(720, maxX + g.margin), height: Math.max(460, maxY + g.margin) },
    geometry: g,
    unionOrigins
  };
  }

  // --- Ordonnancement structurel des sous-branches (heuristique locale déterministe) ---
  // Objectif : rapprocher des sous-arbres reliés par un lien secondaire (ex. un
  // conjoint dont les parents sont dans une autre branche) sans changer la
  // généalogie ni les règles de placement. Le réordonnancement n'est conservé
  // que si le coût global (croisements, liens extrêmes, longueur totale,
  // compacité) est strictement meilleur ; sinon la baseline reste intacte.

  function reorderUnions() {
    const parentBlockOf = new Map();
    for (const block of blocks.values()) {
      if (block.parentUnionId) parentBlockOf.set(block.id, unions.get(block.parentUnionId).blockId);
    }
    const ancestorChain = blockId => {
      const chain = [];
      let current = blockId;
      while (current) { chain.push(current); current = parentBlockOf.get(current) || null; }
      return chain;
    };
    const edgesByUnion = new Map();
    const addEdge = (unionId, a, b) => {
      if (!a || !b || a === b) return;
      if (!edgesByUnion.has(unionId)) edgesByUnion.set(unionId, new Map());
      const adjacency = edgesByUnion.get(unionId);
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    };

    for (const block of blocks.values()) {
      if (block.incoming.length < 2) continue;
      const chainBlock = ancestorChain(block.id);
      const depthInChain = new Map(chainBlock.map((id, depth) => [id, depth]));
      for (const unionId of block.incoming) {
        if (unionId === block.parentUnionId) continue;
        const otherBlock = unions.get(unionId).blockId;
        const chainOther = ancestorChain(otherBlock);
        let lca = null;
        for (const id of chainOther) { if (depthInChain.has(id)) { lca = id; break; } }
        if (!lca) continue;
        const branchOther = chainOther[chainOther.indexOf(lca) - 1] ?? otherBlock;
        const depthLca = depthInChain.get(lca);
        const branchBlock = depthLca > 0 ? chainBlock[depthLca - 1] : block.id;
        if (!branchOther || !branchBlock || branchOther === branchBlock) continue;
        for (const lcaUnionId of blocks.get(lca).unionIds) {
          const childIds = unions.get(lcaUnionId).childBlockIds;
          if (childIds.includes(branchOther) && childIds.includes(branchBlock)) { addEdge(lcaUnionId, branchOther, branchBlock); break; }
        }
      }
    }

    let changed = false;
    for (const [unionId, adjacency] of edgesByUnion) {
      const order = unions.get(unionId).childBlockIds;
      const parent = new Map(order.map(id => [id, id]));
      const find = id => { let root = id; while (parent.get(root) !== root) root = parent.get(root); while (parent.get(id) !== id) { const next = parent.get(id); parent.set(id, root); id = next; } return root; };
      const unite = (a, b) => { const rootA = find(a), rootB = find(b); if (rootA !== rootB) parent.set(rootB, rootA); };
      for (const [a, neighbors] of adjacency) for (const b of neighbors) if (parent.has(a) && parent.has(b)) unite(a, b);
      const familiesByRoot = new Map();
      for (const id of order) { const root = find(id); if (!familiesByRoot.has(root)) familiesByRoot.set(root, []); familiesByRoot.get(root).push(id); }
      if (familiesByRoot.size <= 1) continue;
      const groupList = [...familiesByRoot.values()].map(ids => {
        const sorted = [...ids].sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key));
        return { ids, key: blocks.get(sorted[0]).key };
      }).sort((a, b) => compareKeys(a.key, b.key));
      const nextOrder = [];
      for (const group of groupList) {
        const remaining = new Set(group.ids);
        let current = [...group.ids].sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key))[0];
        nextOrder.push(current); remaining.delete(current);
        while (remaining.size) {
          const neighbors = [...(adjacency.get(current) || [])].filter(id => remaining.has(id)).sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key));
          const pick = neighbors[0] ?? [...remaining].sort((a, b) => compareKeys(blocks.get(a).key, blocks.get(b).key))[0];
          nextOrder.push(pick); remaining.delete(pick); current = pick;
        }
      }
      if (nextOrder.some((id, index) => id !== order[index])) { unions.get(unionId).childBlockIds = nextOrder; changed = true; }
    }
    return changed;
  }

  function orientation(ax, ay, bx, by, cx, cy) {
    return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  }
  function segmentsIntersect(a, b) {
    const same = (px, py, qx, qy) => px === qx && py === qy;
    if (same(a.x1, a.y1, b.x1, b.y1) || same(a.x1, a.y1, b.x2, b.y2) || same(a.x2, a.y2, b.x1, b.y1) || same(a.x2, a.y2, b.x2, b.y2)) return false;
    const o1 = orientation(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
    const o2 = orientation(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
    const o3 = orientation(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
    const o4 = orientation(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
    return o1 !== o2 && o3 !== o4;
  }
  function countCrossings(segmentsByFamily) {
    const all = [];
    segmentsByFamily.forEach((segments, familyIndex) => segments.forEach(segment => all.push({ ...segment, familyIndex })));
    if (all.length > 8000) return 0;
    let count = 0;
    for (let left = 0; left < all.length; left++) {
      for (let right = left + 1; right < all.length; right++) {
        if (all[left].familyIndex === all[right].familyIndex) continue;
        if (segmentsIntersect(all[left], all[right])) count++;
      }
    }
    return count;
  }
  function layoutCost(layout) {
    const positions = layout.positions;
    const segmentsByFamily = [];
    let totalLink = 0, maxLink = 0;
    for (const family of layout.families) {
      const partners = (family.partnerIds || []).map(id => positions.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
      if (!partners.length) continue;
      const segments = [];
      for (let index = 0; index < partners.length - 1; index++) {
        const left = partners[index], right = partners[index + 1];
        const y = (left.y + right.y) / 2 + left.height / 2;
        const segment = { x1: left.x + left.width, y1: y, x2: right.x, y2: y };
        segments.push(segment);
        const length = Math.abs(segment.x2 - segment.x1);
        totalLink += length; maxLink = Math.max(maxLink, length);
      }
      const first = partners[0], last = partners[partners.length - 1];
      const origin = { x: (first.x + first.width + last.x) / 2, y: (first.y + last.y) / 2 + first.height / 2 };
      const children = (family.childIds || []).map(id => ({ id, position: positions.get(id) })).filter(item => item.position).map(item => ({ id: item.id, x: item.position.x + item.position.width / 2, y: item.position.y }));
      if (children.length) {
        const busY = Math.min(...children.map(child => child.y)) - g.generationGap / 2;
        const vertical = Math.abs(origin.y - busY);
        segments.push({ x1: origin.x, y1: origin.y, x2: origin.x, y2: busY });
        totalLink += vertical; maxLink = Math.max(maxLink, vertical);
        const allX = [origin.x, ...children.map(child => child.x)];
        const minX = Math.min(...allX), maxX = Math.max(...allX);
        if (maxX - minX > 0.5) { segments.push({ x1: minX, y1: busY, x2: maxX, y2: busY }); totalLink += maxX - minX; maxLink = Math.max(maxLink, maxX - minX); }
        for (const child of children) {
          const childLength = Math.abs(child.y - busY);
          segments.push({ x1: child.x, y1: busY, x2: child.x, y2: child.y });
          totalLink += childLength; maxLink = Math.max(maxLink, childLength);
        }
      }
      segmentsByFamily.push(segments);
    }
    return { collisions: 0, crossings: countCrossings(segmentsByFamily), maxLink: Math.round(maxLink), totalLink: Math.round(totalLink), width: layout.bounds.width };
  }
  function compareCost(candidate, baseline) {
    for (const key of ["collisions", "crossings", "maxLink", "totalLink", "width"]) {
      if (candidate[key] !== baseline[key]) return candidate[key] < baseline[key] ? -1 : 1;
    }
    return 0;
  }

  const baseline = runLayout();
  baseline.reordered = false;
  if (options.reorder === false || people.length > 3000) return baseline;
  let best = baseline;
  let bestCost = null;
  // Coût calculé paresseusement : aucune dépense si aucune réorganisation n'est
  // proposée (cas courant des arbres à racine unique).
  const currentCost = () => (bestCost !== null ? bestCost : (bestCost = layoutCost(best)));

  // Deux optimisations complémentaires, chacune validée par `compareCost` :
  //  - reorderUnions : ordre des sous-branches à l'intérieur d'un sous-arbre ;
  //  - reorderRoots  : ordre des racines (macros-branches) d'une composante.
  // En cas de rejet, l'état est restauré pour garder une base déterministe.
  const unionOrderSnapshot = new Map();
  for (const union of unionList) unionOrderSnapshot.set(union.id, [...union.childBlockIds]);
  const restoreUnionOrders = () => {
    for (const [unionId, order] of unionOrderSnapshot) unions.get(unionId).childBlockIds = [...order];
  };
  const accept = candidate => {
    if (!validateLayout(candidate, { peopleCount: people.length }).valid) return false;
    const candidateCost = layoutCost(candidate);
    if (compareCost(candidateCost, currentCost()) < 0) { best = candidate; bestCost = candidateCost; return true; }
    return false;
  };

  if (reorderUnions() && !accept(runLayout())) restoreUnionOrders();
  if (reorderRoots() && !accept(runLayout())) rootOrderOverrides.clear();

  best.reordered = best !== baseline;
  if (bestCost !== null) best.cost = bestCost;
  return best;
}

function addToContour(contour, depth, min, max) {
  const current = contour.get(depth);
  if (!current) contour.set(depth, { min, max });
  else contour.set(depth, { min: Math.min(current.min, min), max: Math.max(current.max, max) });
  return contour;
}

/**
 * Vérifie un layout : coordonnées finies, au moins une position si des
 * personnes existent, et zéro chevauchement de cartes.
 */
export function validateLayout(layout, options = {}) {
  const positions = layout?.positions;
  const expected = Number.isFinite(options.peopleCount) ? options.peopleCount : null;
  const report = { valid: true, collisions: 0, collisionPairs: [], nonFinite: [], missing: 0, boundsValid: true };
  if (!(positions instanceof Map)) {
    return { ...report, valid: false };
  }
  const entries = [...positions.entries()];
  if (expected !== null && expected > 0 && entries.length === 0) {
    report.valid = false;
    report.missing = expected;
  }
  for (const [id, position] of entries) {
    if (!position || !["x", "y", "width", "height"].every(key => Number.isFinite(position[key]))) {
      report.nonFinite.push(id);
    }
  }
  for (let left = 0; left < entries.length; left++) {
    for (let right = left + 1; right < entries.length; right++) {
      const a = entries[left][1], b = entries[right][1];
      if (!a || !b) continue;
      const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
      if (overlap) {
        report.collisions += 1;
        if (report.collisionPairs.length < 20) report.collisionPairs.push([entries[left][0], entries[right][0]]);
      }
    }
  }
  const bounds = layout?.bounds;
  report.boundsValid = !!bounds && ["x", "y", "width", "height"].every(key => Number.isFinite(bounds[key]) && bounds[key] >= 0) && bounds.width > 0 && bounds.height > 0;
  report.valid = report.valid && report.nonFinite.length === 0 && report.collisions === 0 && report.boundsValid;
  return report;
}
