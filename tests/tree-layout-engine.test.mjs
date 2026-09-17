import test from "node:test";
import assert from "node:assert/strict";
import { calculateTreeLayout as layoutEngine, validateLayout, TREE_LAYOUT_GEOMETRY } from "../js/tree-layout-engine.js";
import { calculateTreeLayout as legacyLayout } from "../js/tree-layout.js";
import { unionConnection } from "../js/tree-renderer.js";
import { computeBranchView, DEFAULT_ANCESTOR_DEPTH } from "../js/tree-branch-view.js";

function person(id, extra = {}) {
  return { firstName: id, lastName: "Test", birthDateInfo: { type: "year", year: 1900 }, ...extra, id };
}
function family(id, partnerIds, childIds, extra = {}) {
  return { id, partnerIds, childIds, ...extra };
}
function check(people, families, label) {
  const layout = layoutEngine(people, families);
  assert.equal(layout.positions.size, people.length, `${label} : toutes les personnes positionnées`);
  const report = validateLayout(layout, { peopleCount: people.length });
  assert.deepEqual(report.nonFinite, [], `${label} : coordonnées finies`);
  assert.equal(report.collisions, 0, `${label} : zéro collision (${JSON.stringify(report.collisionPairs)})`);
  assert.ok(report.boundsValid, `${label} : bounds valides`);
  return layout;
}
function linkMetrics(layout) {
  let total = 0, max = 0;
  const add = value => { if (Number.isFinite(value)) { total += Math.abs(value); max = Math.max(max, Math.abs(value)); } };
  for (const family of layout.families) {
    const connection = unionConnection(family, layout.positions, layout.geometry);
    if (!connection) continue;
    for (const segment of connection.segments) add(segment.x2 - segment.x1);
    if (connection.children.length) {
      add(connection.busY - connection.origin.y);
      add(connection.bar.maxX - connection.bar.minX);
      for (const child of connection.children) add(child.y - connection.busY);
    }
  }
  return { total: Math.round(total), max: Math.round(max) };
}
function familyLinkLength(family, layout) {
  const connection = unionConnection(family, layout.positions, layout.geometry);
  if (!connection) return 0;
  let length = 0;
  for (const segment of connection.segments) length += Math.abs(segment.x2 - segment.x1);
  if (connection.children.length) {
    length += Math.abs(connection.busY - connection.origin.y) + Math.abs(connection.bar.maxX - connection.bar.minX);
    for (const child of connection.children) length += Math.abs(child.y - connection.busY);
  }
  return Math.round(length);
}
function seededShuffle(list, seed = 1) {
  const copy = [...list];
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
function positionsSnapshot(layout) {
  return [...layout.positions.entries()].map(([id, position]) => [id, position.x, position.y]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
function largeGenealogy(depth = 4, childrenPerFamily = 4) {
  const generatedPeople = [], generatedFamilies = [];
  let personIndex = 0, familyIndex = 0;
  const addPerson = level => {
    const id = `g${personIndex++}`;
    generatedPeople.push(person(id, { firstName: `P${personIndex}`, birthDateInfo: { type: "year", year: 1800 + level * 28 + (personIndex % 20) } }));
    return id;
  };
  let couples = [[addPerson(0), addPerson(0)]];
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const partners of couples) {
      const childIds = [];
      for (let index = 0; index < childrenPerFamily; index++) {
        const child = addPerson(level + 1), spouse = addPerson(level + 1);
        childIds.push(child);
        next.push([child, spouse]);
      }
      generatedFamilies.push(family(`gf${familyIndex++}`, partners, childIds));
    }
    couples = next;
  }
  return { people: generatedPeople, families: generatedFamilies };
}

// --- A. couple + enfant unique ---
const fixtureA = {
  people: [person("p1"), person("p2"), person("c1")],
  families: [family("f1", ["p1", "p2"], ["c1"])]
};
test("A. couple + enfant unique", () => {
  const layout = check(fixtureA.people, fixtureA.families, "A");
  const p1 = layout.positions.get("p1"), p2 = layout.positions.get("p2"), c1 = layout.positions.get("c1");
  assert.equal(p1.y, p2.y);
  assert.equal(Math.abs(p1.x - p2.x), TREE_LAYOUT_GEOMETRY.cardWidth + TREE_LAYOUT_GEOMETRY.partnerGap);
  assert.ok(c1.y > p1.y);
});

// --- B. couple + 4 enfants ---
const fixtureB = {
  people: [person("p1"), person("p2"), person("c1"), person("c2"), person("c3"), person("c4")],
  families: [family("f1", ["p1", "p2"], ["c1", "c2", "c3", "c4"])]
};
test("B. couple + 4 enfants", () => {
  const layout = check(fixtureB.people, fixtureB.families, "B");
  const xs = ["c1", "c2", "c3", "c4"].map(id => layout.positions.get(id).x);
  assert.equal(new Set(xs).size, 4);
});

// --- C. 3 générations ---
const fixtureC = {
  people: [person("gp1"), person("gp2"), person("p1"), person("p2"), person("c1")],
  families: [family("f1", ["gp1", "gp2"], ["p1"]), family("f2", ["p1", "p2"], ["c1"])]
};
test("C. 3 générations alignées", () => {
  const layout = check(fixtureC.people, fixtureC.families, "C");
  assert.ok(layout.positions.get("p1").y > layout.positions.get("gp1").y);
  assert.ok(layout.positions.get("c1").y > layout.positions.get("p1").y);
});

// --- D. 4 générations ---
const fixtureD = {
  people: [person("gp1"), person("gp2"), person("p1"), person("p2"), person("c1"), person("s1"), person("d1")],
  families: [family("f1", ["gp1", "gp2"], ["p1"]), family("f2", ["p1", "p2"], ["c1"]), family("f3", ["c1", "s1"], ["d1"])]
};
test("D. 4 générations", () => {
  const layout = check(fixtureD.people, fixtureD.families, "D");
  const depths = ["gp1", "p1", "c1", "d1"].map(id => layout.positions.get(id).y);
  assert.equal(new Set(depths).size, 4);
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
});

// --- E. branche profonde + branche courte ---
const fixtureE = (() => {
  const people = [person("root1"), person("root2"), person("deep1"), person("deep2"), person("deep3"), person("deep4"), person("deep5"), person("sp1"), person("sp2"), person("short1")];
  const families = [
    family("f0", ["root1", "root2"], ["deep1", "short1"]),
    family("f1", ["deep1", "sp1"], ["deep2"]),
    family("f2", ["deep2", "sp2"], ["deep3"]),
    family("f3", ["deep3"], ["deep4"]),
    family("f4", ["deep4"], ["deep5"])
  ];
  return { people, families };
})();
test("E. branche profonde à côté d'une branche courte", () => {
  const layout = check(fixtureE.people, fixtureE.families, "E");
  assert.ok(layout.positions.get("deep5").y > layout.positions.get("deep1").y);
  assert.equal(layout.positions.get("short1").y, layout.positions.get("deep1").y);
});

// --- F. A-B + A-C avec enfants distincts ---
const fixtureF = {
  people: [person("a"), person("b"), person("c"), person("ab1"), person("ab2"), person("ac1"), person("ac2")],
  families: [family("fAB", ["a", "b"], ["ab1", "ab2"]), family("fAC", ["a", "c"], ["ac1", "ac2"])]
};
test("F. familles recomposées A-B / A-C", () => {
  const layout = check(fixtureF.people, fixtureF.families, "F");
  assert.equal(layout.positions.get("a").y, layout.positions.get("b").y);
  assert.equal(layout.positions.get("a").y, layout.positions.get("c").y);
  const ab = unionConnection(layout.families[0], layout.positions, layout.geometry);
  const ac = unionConnection(layout.families[1], layout.positions, layout.geometry);
  assert.deepEqual(ab.children.map(child => child.id).sort(), ["ab1", "ab2"]);
  assert.deepEqual(ac.children.map(child => child.id).sort(), ["ac1", "ac2"]);
});

// --- G. A avec 3 conjoints ---
const fixtureG = {
  people: [person("a"), person("b"), person("c"), person("d"), person("x"), person("y"), person("z")],
  families: [family("f1", ["a", "b"], ["x"]), family("f2", ["a", "c"], ["y"]), family("f3", ["a", "d"], ["z"])]
};
test("G. une personne, trois unions", () => {
  const layout = check(fixtureG.people, fixtureG.families, "G");
  const a = layout.positions.get("a");
  assert.equal(["b", "c", "d"].filter(id => layout.positions.get(id).y === a.y).length, 3);
  assert.equal(new Set([a, layout.positions.get("b"), layout.positions.get("c"), layout.positions.get("d")].map(p => p.x)).size, 4);
});

// --- H. double réservation : les deux conjoints ont leurs parents enracinés ---
const fixtureH = (() => {
  const people = [person("gpA1"), person("gpA2"), person("xA"), person("gpB1"), person("gpB2"), person("yB"), person("c1"), person("s1"), person("c2"), person("s2")];
  const families = [
    family("fA", ["gpA1", "gpA2"], ["xA"]),
    family("fB", ["gpB1", "gpB2"], ["yB"]),
    family("fXY", ["xA", "yB"], ["c1", "c2"])
  ];
  for (const [prefix, parents] of [["a", ["c1", "s1"]], ["b", ["c2", "s2"]]]) {
    const childIds = [];
    for (let index = 0; index < 4; index++) { const child = person(`c${prefix}${index}`); people.push(child); childIds.push(child.id); }
    families.push(family(`fc${prefix}`, parents, childIds));
  }
  return { people, families };
})();
test("H. une seule revendication quand les deux conjoints ont leurs parents", () => {
  const modern = layoutEngine(fixtureH.people, fixtureH.families);
  const legacy = legacyLayout(fixtureH.people, fixtureH.families);
  assert.equal(validateLayout(modern, { peopleCount: fixtureH.people.length }).collisions, 0);
  // L'ancien moteur réserve deux fois le sous-arbre commun : le nouveau doit être plus compact.
  assert.ok(modern.bounds.width <= legacy.bounds.width, `largeur new ${modern.bounds.width} vs old ${legacy.bounds.width}`);
  assert.ok(modern.bounds.width < legacy.bounds.width, `réduction attendue : new ${modern.bounds.width} vs old ${legacy.bounds.width}`);
});

// --- I. 15 descendants à côté d'une branche sans descendant ---
const fixtureI = (() => {
  const people = [person("root1"), person("root2"), person("fertile"), person("sterile"), person("f_sp")];
  const families = [family("f0", ["root1", "root2"], ["fertile", "sterile"])];
  let parents = ["fertile", "f_sp"];
  for (let level = 0; level < 4; level++) {
    const childIds = [];
    for (let index = 0; index < 4; index++) {
      const child = person(`d${level}_${index}`);
      people.push(child);
      childIds.push(child.id);
    }
    families.push(family(`fi${level}`, parents, childIds));
    parents = [childIds[0]];
  }
  return { people, families };
})();
test("I. 15 descendants à côté d'une branche stérile", () => {
  const layout = check(fixtureI.people, fixtureI.families, "I");
  assert.ok(layout.positions.get("sterile").y === layout.positions.get("fertile").y);
});

// --- J. plusieurs composantes indépendantes ---
const fixtureJ = {
  people: [person("a1"), person("a2"), person("a3"), person("b1"), person("b2"), person("b3")],
  families: [family("fa", ["a1", "a2"], ["a3"]), family("fb", ["b1", "b2"], ["b3"])]
};
test("J. plusieurs composantes", () => {
  const layout = check(fixtureJ.people, fixtureJ.families, "J");
  assert.ok(layout.bounds.width > 0 && layout.bounds.height > 0);
});

// --- Q / R. connexions par union ---
test("Q. chaque enfant appartient au connecteur de sa propre union", () => {
  const layout = layoutEngine(fixtureF.people, fixtureF.families);
  for (const family of fixtureF.families) {
    const connection = unionConnection(family, layout.positions, layout.geometry);
    assert.deepEqual(connection.children.map(child => child.id).sort(), [...family.childIds].sort());
  }
});
test("R. aucune fratrie graphique ne mélange plusieurs unions", () => {
  const layout = layoutEngine(fixtureF.people, fixtureF.families);
  const [ab, ac] = layout.families;
  const abConnection = unionConnection(ab, layout.positions, layout.geometry);
  const acConnection = unionConnection(ac, layout.positions, layout.geometry);
  const acIds = new Set(ac.childIds);
  assert.ok(abConnection.children.every(child => !acIds.has(child.id)));
  const abIds = new Set(ab.childIds);
  assert.ok(acConnection.children.every(child => !abIds.has(child.id)));
  assert.ok(abConnection.bar.maxX >= abConnection.bar.minX && acConnection.bar.maxX >= acConnection.bar.minX);
});

// --- K. 100+ personnes ---
test("K. 100+ personnes", () => {
  const dataset = largeGenealogy(3, 4);
  assert.ok(dataset.people.length >= 100);
  check(dataset.people, dataset.families, "K");
});

// --- L. 500+ personnes + performance ---
test("L. 500+ personnes", () => {
  const dataset = largeGenealogy(4, 4);
  assert.ok(dataset.people.length > 500);
  const started = performance.now();
  check(dataset.people, dataset.families, "L");
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `layout 500+ en ${Math.round(elapsed)} ms`);
});

// --- M. déterminisme par permutation ---
test("M. ordre des tableaux sans effet (déterminisme)", () => {
  const dataset = largeGenealogy(3, 3);
  const base = layoutEngine(dataset.people, dataset.families);
  const shuffled = layoutEngine(seededShuffle(dataset.people, 7), seededShuffle(dataset.families, 13));
  assert.deepEqual(positionsSnapshot(shuffled), positionsSnapshot(base));
});
test("M. déterminisme aussi sur une recomposition", () => {
  const base = layoutEngine(fixtureG.people, fixtureG.families);
  const shuffled = layoutEngine(seededShuffle(fixtureG.people, 3), seededShuffle(fixtureG.families, 5));
  assert.deepEqual(positionsSnapshot(shuffled), positionsSnapshot(base));
});

// --- N/O/P consolidés via `check` sur tous les fixtures ---
test("N/O/P. coordonnées finies, layout non vide, zéro collision (consolidé)", () => {
  const fixtures = [fixtureA, fixtureB, fixtureC, fixtureD, fixtureE, fixtureF, fixtureG, fixtureH, fixtureI, fixtureJ];
  for (const fixture of fixtures) {
    const layout = check(fixture.people, fixture.families, "consolidé");
    const report = validateLayout(layout, { peopleCount: fixture.people.length });
    assert.ok(report.valid);
  }
});

// --- 18. Voir la branche ---
test("18. Voir la branche reste valide à toutes les profondeurs", () => {
  const dataset = largeGenealogy(4, 3);
  const rootId = dataset.people[11]?.id || dataset.people[0].id;
  for (const depth of [1, 2, 3, DEFAULT_ANCESTOR_DEPTH, "all"]) {
    const scope = computeBranchView({ people: dataset.people, families: dataset.families, rootId, ancestorDepth: depth });
    const layout = layoutEngine(scope.people, scope.families);
    const report = validateLayout(layout, { peopleCount: scope.people.length });
    assert.ok(report.valid && report.collisions === 0, `branche profondeur ${depth}`);
    assert.equal(layout.positions.size, scope.people.length);
  }
});

// --- 17. sécurité : données invalides, jamais d'arbre vide ---
test("17. le moteur ne renvoie jamais un layout vide avec des personnes valides", () => {
  for (const fixture of [fixtureA, fixtureF, fixtureH, fixtureI]) {
    const layout = layoutEngine(fixture.people, fixture.families);
    assert.ok(layout.positions.size > 0);
  }
  const empty = layoutEngine([], []);
  assert.equal(empty.positions.size, 0);
});

// --- Réordonnancement structurel : branche reliée éloignée + grosse branche intermédiaire ---
const fixtureReorder = (() => {
  const list = [], fam = [];
  let sequence = 0;
  const make = (year, tag) => { const id = `${tag}${sequence++}`; list.push(person(id, { firstName: tag, birthDateInfo: { type: "year", year } })); return id; };
  const r1 = make(1800, "Root"), r2 = make(1801, "RootS");
  const A = make(1810, "A"), As = make(1811, "AS"), A1 = make(1840, "A1");
  const C = make(1820, "Conti"), Cs = make(1821, "ContiS");
  const Pm = make(1830, "Pia"), Ps = make(1831, "PiaS"), Pin = make(1841, "Pin");
  fam.push(family("fRoot", [r1, r2], [A, C, Pm]));
  fam.push(family("fA", [A, As], [A1]));
  const contiKids = [];
  for (let index = 0; index < 6; index++) contiKids.push(make(1842 + index, `Conti${index}`));
  fam.push(family("fC", [C, Cs], contiKids));
  fam.push(family("fP", [Pm, Ps], [Pin]));
  fam.push(family("fA1", [A1, Pin], []));
  return { people: list, families: fam, ids: { pin: Pin, pia: Pm, conti: C } };
})();

test("réordonnancement : rapproche une branche reliée séparée par une grosse branche", () => {
  const baseline = layoutEngine(fixtureReorder.people, fixtureReorder.families, {}, { reorder: false });
  const optimized = layoutEngine(fixtureReorder.people, fixtureReorder.families);
  assert.equal(validateLayout(optimized, { peopleCount: fixtureReorder.people.length }).collisions, 0);
  assert.equal(optimized.reordered, true);
  const unionP = fixtureReorder.families.find(item => item.id === "fP");
  const baselineLink = familyLinkLength(unionP, baseline);
  const optimizedLink = familyLinkLength(unionP, optimized);
  assert.ok(optimizedLink < baselineLink, `lien fP ${optimizedLink} < ${baselineLink} attendu`);
  const pin = optimized.positions.get(fixtureReorder.ids.pin), pia = optimized.positions.get(fixtureReorder.ids.pia), conti = optimized.positions.get(fixtureReorder.ids.conti);
  assert.ok(Math.abs(pin.x - pia.x) < Math.abs(pin.x - conti.x), "la famille reliée doit être rapprochée par la structure");
  const shuffled = layoutEngine(seededShuffle(fixtureReorder.people, 23), seededShuffle(fixtureReorder.families, 29));
  assert.deepEqual(positionsSnapshot(shuffled), positionsSnapshot(optimized));
});

test("réordonnancement : aucune modification quand aucune permutation n'améliore", () => {
  const baseline = layoutEngine(fixtureA.people, fixtureA.families, {}, { reorder: false });
  const optimized = layoutEngine(fixtureA.people, fixtureA.families);
  assert.equal(optimized.reordered, false);
  assert.deepEqual(positionsSnapshot(optimized), positionsSnapshot(baseline));
});

test("réordonnancement : non-régression globale (liens, collisions, déterminisme)", () => {
  const dataset = largeGenealogy(3, 4);
  const baseline = layoutEngine(dataset.people, dataset.families, {}, { reorder: false });
  const optimized = layoutEngine(dataset.people, dataset.families);
  assert.equal(validateLayout(optimized, { peopleCount: dataset.people.length }).collisions, 0);
  const baseMetrics = linkMetrics(baseline), optimizedMetrics = linkMetrics(optimized);
  assert.ok(optimizedMetrics.total <= baseMetrics.total, `total ${optimizedMetrics.total} <= ${baseMetrics.total}`);
  assert.ok(optimizedMetrics.max <= baseMetrics.max, `max ${optimizedMetrics.max} <= ${baseMetrics.max}`);
  assert.deepEqual(positionsSnapshot(layoutEngine(seededShuffle(dataset.people, 11), seededShuffle(dataset.families, 17))), positionsSnapshot(optimized));
});

// --- Ordonnancement des RACINES d'une composante (macros-branches reliées) ---
// Cas structurel reproduit : plusieurs racines primaires reliées par des ponts
// secondaires. Aucun nom/ID réel n'est utilisé.
function buildRootCase(rootCount, bridges, wideByRoot = {}) {
  const list = [], families = [];
  let sequence = 0;
  const make = (year, tag) => { const id = `${tag}${sequence++}`; list.push(person(id, { firstName: tag, birthDateInfo: { type: "year", year } })); return id; };
  const roots = [];
  for (let index = 0; index < rootCount; index++) roots.push({ a: make(1800 + index * 10, "Ra"), b: make(1800 + index * 10 + 1, "Rb"), children: [] });
  const addChild = (index, year) => { const id = make(year, "Ch"); roots[index].children.push(id); return id; };
  for (let index = 0; index < rootCount; index++) for (let count = 0; count < (wideByRoot[index] || 0); count++) addChild(index, 1850 + index * 10 + count);
  bridges.forEach(([left, right], bridgeIndex) => {
    const child = addChild(left, 1900 + bridgeIndex * 2), spouse = addChild(right, 1900 + bridgeIndex * 2 + 1);
    families.push(family(`bridge${bridgeIndex}`, [child, spouse], []));
  });
  for (let index = 0; index < rootCount; index++) families.push(family(`root${index}`, [roots[index].a, roots[index].b], roots[index].children));
  return { people: list, families, roots: roots.map(root => root.a) };
}
function assertBetween(value, a, b, label) {
  assert.ok((value > a && value < b) || (value > b && value < a), `${label} : ${value} doit être entre ${a} et ${b}`);
}

test("root ordering : place la racine-pont entre ses deux macros-branches reliées", () => {
  const fixture = buildRootCase(3, [[0, 1], [0, 2]], { 1: 6 });
  const baseline = layoutEngine(fixture.people, fixture.families, {}, { reorder: false });
  const optimized = layoutEngine(fixture.people, fixture.families);
  assert.equal(validateLayout(optimized, { peopleCount: fixture.people.length }).collisions, 0);
  assert.equal(optimized.reordered, true);
  const [bridgeRoot, firstMacro, secondMacro] = fixture.roots.map(id => optimized.positions.get(id).x);
  assertBetween(bridgeRoot, firstMacro, secondMacro, "racine-pont au milieu");
  const baseMetrics = linkMetrics(baseline), optimizedMetrics = linkMetrics(optimized);
  assert.ok(optimizedMetrics.max < baseMetrics.max, `linkLengthMax ${optimizedMetrics.max} < ${baseMetrics.max}`);
  assert.ok(optimizedMetrics.total <= baseMetrics.total, `linkLengthTotal ${optimizedMetrics.total} <= ${baseMetrics.total}`);
  assert.ok(optimized.bounds.width <= baseline.bounds.width * 1.15, `largeur ${optimized.bounds.width} vs ${baseline.bounds.width}`);
  assert.deepEqual(positionsSnapshot(layoutEngine(seededShuffle(fixture.people, 41), seededShuffle(fixture.families, 43))), positionsSnapshot(optimized));
});

test("root ordering : aucun pont entre racines laisse l'ordre canonique", () => {
  const baseline = layoutEngine(fixtureJ.people, fixtureJ.families, {}, { reorder: false });
  const optimized = layoutEngine(fixtureJ.people, fixtureJ.families);
  assert.equal(optimized.reordered, false);
  assert.deepEqual(positionsSnapshot(optimized), positionsSnapshot(baseline));
});

test("root ordering : deux racines reliées déjà adjacentes restent canoniques", () => {
  const fixture = buildRootCase(2, [[0, 1]]);
  const baseline = layoutEngine(fixture.people, fixture.families, {}, { reorder: false });
  const optimized = layoutEngine(fixture.people, fixture.families);
  assert.equal(optimized.reordered, false);
  assert.deepEqual(positionsSnapshot(optimized), positionsSnapshot(baseline));
});

test("root ordering : quatre racines et plusieurs affinités (déterminisme)", () => {
  const fixture = buildRootCase(4, [[0, 2], [2, 1], [1, 3]]);
  const optimized = layoutEngine(fixture.people, fixture.families);
  assert.equal(validateLayout(optimized, { peopleCount: fixture.people.length }).collisions, 0);
  assert.equal(optimized.reordered, true);
  assert.deepEqual(positionsSnapshot(layoutEngine(seededShuffle(fixture.people, 5), seededShuffle(fixture.families, 7))), positionsSnapshot(optimized));
});

test("root ordering : plusieurs ponts entre les mêmes racines (déterminisme)", () => {
  const fixture = buildRootCase(3, [[0, 1], [0, 1], [0, 2]], { 1: 6 });
  const baseline = layoutEngine(fixture.people, fixture.families, {}, { reorder: false });
  const optimized = layoutEngine(fixture.people, fixture.families);
  assert.equal(validateLayout(optimized, { peopleCount: fixture.people.length }).collisions, 0);
  assert.equal(optimized.reordered, true);
  assert.ok(linkMetrics(optimized).total <= linkMetrics(baseline).total, "le coût global ne se dégrade pas");
  assert.deepEqual(positionsSnapshot(layoutEngine(seededShuffle(fixture.people, 19), seededShuffle(fixture.families, 23))), positionsSnapshot(optimized));
});

test("root ordering : 12 racines sans explosion combinatoire", () => {
  const permutation = [0, 5, 2, 8, 1, 6, 3, 9, 4, 7, 10, 11], bridges = [];
  for (let index = 0; index < permutation.length - 1; index++) bridges.push([permutation[index], permutation[index + 1]]);
  const fixture = buildRootCase(12, bridges);
  const started = performance.now();
  const optimized = layoutEngine(fixture.people, fixture.families);
  const elapsed = performance.now() - started;
  assert.equal(validateLayout(optimized, { peopleCount: fixture.people.length }).collisions, 0);
  assert.ok(elapsed < 2000, `12 racines en ${Math.round(elapsed)} ms`);
  assert.deepEqual(positionsSnapshot(layoutEngine(seededShuffle(fixture.people, 3), seededShuffle(fixture.families, 5))), positionsSnapshot(optimized));
});

// --- 16. baseline OLD vs NEW ---
test("16. baseline OLD vs NEW (métriques)", () => {
  const report = {};
  for (const [name, fixture] of Object.entries({ A: fixtureA, F: fixtureF, H: fixtureH, I: fixtureI, large: largeGenealogy(3, 4) })) {
    const modern = layoutEngine(fixture.people, fixture.families);
    const legacy = legacyLayout(fixture.people, fixture.families);
    const modernLinks = linkMetrics(modern), legacyLinks = linkMetrics(legacy);
    report[name] = {
      old: { width: legacy.bounds.width, height: legacy.bounds.height, ...legacyLinks },
      new: { width: modern.bounds.width, height: modern.bounds.height, ...modernLinks }
    };
  }
  const small = largeGenealogy(3, 4);
  const t0 = performance.now();
  layoutEngine(small.people, small.families);
  const smallMs = Math.round((performance.now() - t0) * 100) / 100;
  const big = largeGenealogy(4, 4);
  const t1 = performance.now();
  layoutEngine(big.people, big.families);
  const bigMs = Math.round((performance.now() - t1) * 100) / 100;
  process.stdout.write(`\nBASELINE OLD/NEW\n${JSON.stringify({ metrics: report, performanceMs: { "170 personnes": smallMs, "682 personnes": bigMs } }, null, 2)}\n`);
});

console.log("Moteur de layout hybride : tests terminés");
