import { genealogyDateSortValue } from "./genealogy-date.js";

export const TREE_GEOMETRY = Object.freeze({
  cardWidth: 282,
  cardHeight: 158,
  partnerGap: 30,
  siblingGap: 54,
  familyGap: 94,
  rootGap: 140,
  levelGap: 116,
  margin: 120
});

function uniqueValid(ids, validIds) {
  return [...new Set((ids || []).filter(id => validIds.has(id)))];
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

function orderedMembers(ids, families, peopleById) {
  if (ids.length < 3) return [...ids];
  const degree = new Map(ids.map(id => [id, 0]));
  for (const family of families) {
    for (const id of family.partnerIds) {
      if (degree.has(id)) degree.set(id, degree.get(id) + family.partnerIds.length - 1);
    }
  }
  const hub = [...ids].sort((a, b) => degree.get(b) - degree.get(a))[0];
  const others = ids.filter(id => id !== hub).sort((a, b) => {
    const pa = peopleById.get(a), pb = peopleById.get(b);
    const dateA = genealogyDateSortValue(pa?.birthDateInfo, pa?.birthDate) ?? Number.MAX_SAFE_INTEGER;
    const dateB = genealogyDateSortValue(pb?.birthDateInfo, pb?.birthDate) ?? Number.MAX_SAFE_INTEGER;
    return dateA - dateB || `${pa?.lastName || ''}${pa?.firstName || ''}`.localeCompare(`${pb?.lastName || ''}${pb?.firstName || ''}`, "fr", { sensitivity: "base" });
  });
  const middle = Math.floor(others.length / 2);
  return [...others.slice(0, middle), hub, ...others.slice(middle)];
}

/**
 * Calcule un layout généalogique déterministe sans lire ni écrire de coordonnées.
 * Les composantes de partenaires forment des unités et chaque unité réserve la
 * largeur cumulée nécessaire à toutes ses sous-branches.
 */
export function calculateTreeLayout(people = [], rawFamilies = [], geometry = {}) {
  const g = { ...TREE_GEOMETRY, ...geometry };
  const peopleById = new Map(people.map(person => [person.id, person]));
  const validIds = new Set(peopleById.keys());
  const families = rawFamilies.map(family => ({
    ...family,
    partnerIds: uniqueValid(family.partnerIds, validIds),
    childIds: uniqueValid(family.childIds, validIds)
  })).filter(family => family.partnerIds.length || family.childIds.length);

  if (!people.length) {
    return { positions: new Map(), families, bounds: { x: 0, y: 0, width: 720, height: 460 }, geometry: g };
  }

  const dsu = createDisjointSet([...validIds]);
  for (const family of families) {
    const [first, ...partners] = family.partnerIds;
    if (first) partners.forEach(partner => dsu.union(first, partner));
  }

  const componentMembers = new Map();
  for (const id of validIds) {
    const root = dsu.find(id);
    if (!componentMembers.has(root)) componentMembers.set(root, []);
    componentMembers.get(root).push(id);
  }

  const levels = new Map([...validIds].map(id => [id, 0]));
  const maxPasses = Math.max(8, people.length * 3);
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

  const units = new Map();
  const unitByPerson = new Map();
  let unitIndex = 0;
  for (const memberIds of componentMembers.values()) {
    const id = `unit-${unitIndex++}`;
    const ordered = orderedMembers(memberIds, families, peopleById);
    const level = Math.max(...ordered.map(personId => levels.get(personId) || 0));
    const ownWidth = ordered.length * g.cardWidth + Math.max(0, ordered.length - 1) * g.partnerGap;
    units.set(id, { id, memberIds: ordered, level, ownWidth });
    ordered.forEach(personId => unitByPerson.set(personId, id));
  }

  const outgoingGroups = new Map([...units.keys()].map(id => [id, []]));
  const parentUnits = new Set();
  const childUnits = new Set();
  for (const family of families) {
    const parentUnitId = family.partnerIds.map(id => unitByPerson.get(id)).find(Boolean);
    if (!parentUnitId) continue;
    const children = [...new Set(family.childIds.map(id => unitByPerson.get(id)).filter(id => id && id !== parentUnitId))];
    if (!children.length) continue;
    outgoingGroups.get(parentUnitId).push({ familyId: family.id, unitIds: children });
    parentUnits.add(parentUnitId);
    children.forEach(id => childUnits.add(id));
  }

  function childSequence(unitId) {
    const seen = new Set(), sequence = [];
    for (const group of outgoingGroups.get(unitId) || []) {
      const fresh = group.unitIds.filter(id => !seen.has(id));
      fresh.forEach(id => seen.add(id));
      fresh.forEach((id, index) => sequence.push({ id, gapBefore: sequence.length ? (index === 0 ? g.familyGap : g.siblingGap) : 0 }));
    }
    return sequence;
  }

  const spanMemo = new Map();
  function spanFor(unitId, ancestors = new Set()) {
    if (spanMemo.has(unitId)) return spanMemo.get(unitId);
    const unit = units.get(unitId);
    if (!unit || ancestors.has(unitId)) return unit?.ownWidth || g.cardWidth;
    const nextAncestors = new Set(ancestors).add(unitId);
    const sequence = childSequence(unitId);
    let childrenWidth = 0;
    for (const entry of sequence) childrenWidth += entry.gapBefore + spanFor(entry.id, nextAncestors);
    const span = Math.max(unit.ownWidth, childrenWidth);
    spanMemo.set(unitId, span);
    return span;
  }

  const roots = [...units.keys()].filter(id => !childUnits.has(id));
  const orderedRoots = roots.length ? roots : [...units.keys()];
  orderedRoots.sort((a, b) => units.get(a).level - units.get(b).level);
  const positions = new Map(), placed = new Set();

  function placeUnit(unitId, left, ancestors = new Set()) {
    const unit = units.get(unitId);
    if (!unit || placed.has(unitId) || ancestors.has(unitId)) return;
    placed.add(unitId);
    const span = spanFor(unitId), center = left + span / 2;
    const ownLeft = center - unit.ownWidth / 2;
    unit.memberIds.forEach((personId, index) => positions.set(personId, {
      x: ownLeft + index * (g.cardWidth + g.partnerGap),
      y: unit.level * (g.cardHeight + g.levelGap),
      width: g.cardWidth,
      height: g.cardHeight,
      unitId
    }));
    const sequence = childSequence(unitId);
    const total = sequence.reduce((sum, entry) => sum + entry.gapBefore + spanFor(entry.id), 0);
    let childLeft = center - total / 2;
    const nextAncestors = new Set(ancestors).add(unitId);
    for (const entry of sequence) {
      childLeft += entry.gapBefore;
      placeUnit(entry.id, childLeft, nextAncestors);
      childLeft += spanFor(entry.id);
    }
  }

  let rootLeft = 0;
  for (const rootId of orderedRoots) {
    placeUnit(rootId, rootLeft);
    rootLeft += spanFor(rootId) + g.rootGap;
  }
  for (const unitId of units.keys()) {
    if (!placed.has(unitId)) {
      placeUnit(unitId, rootLeft);
      rootLeft += spanFor(unitId) + g.rootGap;
    }
  }

  let maxX = 0, maxY = 0;
  for (const position of positions.values()) {
    position.x += g.margin;
    position.y += g.margin;
    maxX = Math.max(maxX, position.x + position.width);
    maxY = Math.max(maxY, position.y + position.height);
  }
  return {
    positions,
    families,
    bounds: { x: 0, y: 0, width: Math.max(720, maxX + g.margin), height: Math.max(460, maxY + g.margin) },
    geometry: g
  };
}
