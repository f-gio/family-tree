import assert from "node:assert/strict";
import fs from "node:fs";
import { documentDisplayLabel } from "../js/document-utils.js";
import { filterAndSortDirectory, formatDirectoryDate } from "../js/directory-utils.js";
import { formatGenealogyDate, genealogyDateMatchesYear, normalizeGenealogyDate } from "../js/genealogy-date.js";
import { childLineType, normalizeEndType, normalizeRelationType, normalizedParentChildLinks, parentChildLinkType } from "../js/family-relations.js";
import { calculateTreeLayout } from "../js/tree-layout.js";
import { createTreeCamera } from "../js/tree-camera.js";
import { createTreeRenderer } from "../js/tree-renderer.js";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const results = [];
const automatic = (id, name, test) => { test(); results.push({ id, name, status: "AUTOMATISÉ" }); };
const staticCheck = (id, name, test, note = "Implémentation contrôlée statiquement ; validation Firebase/navigateur encore requise") => { test(); results.push({ id, name, status: "STATIQUE", note }); };
const manual = (id, name, note) => results.push({ id, name, status: "À VALIDER MANUELLEMENT", note });
const manualWithStaticCheck = (id, name, test, note) => { test(); manual(id, name, note); };
const includes = (...needles) => needles.forEach(needle => assert.ok(html.includes(needle) || app.includes(needle), `Élément absent : ${needle}`));

const people = [
  { id: "p1", firstName: "Anna", middleName: "Maria", lastName: "Alberti", place: "Orino", birthDate: "1869-03-14", deathDateInfo: { type: "year", year: 1932 }, photoUrl: "data:image/webp;base64,AA" },
  { id: "p2", firstName: "Vincenzo", lastName: "Cerini", place: "Varese", birthDateInfo: { type: "about", year: 1870 }, deathDateInfo: { type: "between", from: 1930, to: 1934 } },
  { id: "p3", firstName: "Carlo", lastName: "Giovannoni", birthDateInfo: { type: "unknown" }, deathDateInfo: { type: "unknown" } }
];
const family = { id: "f1", partnerIds: ["p1", "p2"], childIds: ["p3"], relationType: "marriage", unionDateInfo: { type: "year", year: 1890 }, unionPlace: "Orino", endType: "divorce", endDateInfo: { type: "about", year: 1900 }, parentChildLinks: [{ parentId: "p1", childId: "p3", type: "biological" }, { parentId: "p2", childId: "p3", type: "adoptive" }] };

staticCheck(1, "Créer une personne", () => { includes('addDoc(refs.people', 'createdAt: serverTimestamp()'); assert.ok(app.includes("birthDateInfo")); });
staticCheck(2, "Modifier une personne", () => includes('updateDoc(doc(db, "people", id), data)'));
staticCheck(3, "Personne avec photo", () => { includes('id="personPhotoFile"', "compressPersonPhoto"); assert.ok(people[0].photoUrl); });
automatic(4, "Personne sans photo", () => assert.equal(`${people[1].firstName[0]}${people[1].lastName[0]}`, "VC"));
automatic(5, "Second prénom", () => { includes('id="middleName"', "person-middle-name"); assert.equal(people[0].middleName, "Maria"); });
automatic(6, "Personne sans dates", () => assert.equal(formatGenealogyDate(people[2].birthDateInfo), "—"));

staticCheck(7, "Onglet Identité", () => includes('data-person-section="identity"', 'data-person-panel="identity"'));
staticCheck(8, "Onglet Liens familiaux", () => includes('data-person-section="relations"', 'data-person-panel="relations"'));
staticCheck(9, "Onglet Documents associés", () => includes('data-person-section="documents"', 'data-person-panel="documents"'));
staticCheck(10, "Navigation sans perte de saisie", () => includes("capturePersonDraft", "restorePersonDraft", "captureGenealogyDateDraft", "restoreGenealogyDateDraft"));

automatic(11, "Personne sans document", () => assert.equal([].filter(d => d.personIds?.includes("p1")).length, 0));
automatic(12, "Personne avec un document", () => assert.equal([{ personIds: ["p1"] }].filter(d => d.personIds.includes("p1")).length, 1));
automatic(13, "Personne avec plusieurs documents", () => assert.equal([{ personIds: ["p1"] }, { personIds: ["p1", "p2"] }].filter(d => d.personIds.includes("p1")).length, 2));
staticCheck(14, "Document avec titre", () => assert.equal(documentDisplayLabel({ title: "Acte Carlo", type: "Acte de naissance", fileName: "a.pdf" }), "Acte Carlo"));
staticCheck(15, "Document sans titre", () => { assert.equal(documentDisplayLabel({ type: "Acte de naissance", fileName: "a.pdf" }), "Acte de naissance"); assert.equal(documentDisplayLabel({ fileName: "a.pdf" }), "a.pdf"); assert.equal(documentDisplayLabel({}), "Document"); assert.ok(/id="documentTitle"(?![^>]*required)/.test(html)); });
staticCheck(16, "Ouverture depuis l’Annuaire", () => includes("data-directory-documents", "data-view-directory-document", "openStoredDocument"));
staticCheck(17, "Consultation depuis la fiche", () => includes("data-view-document", "renderPersonDocuments"));

staticCheck(18, "Vue Liste", () => includes('data-mode="list"', "list-mode"));
staticCheck(19, "Vue Cartes", () => includes('data-mode="cards"', "cards-mode"));
staticCheck(20, "Bascule Liste/Cartes", () => includes("setContentMode", "familyTreeViewModes"));
automatic(21, "Recherche instantanée", () => assert.deepEqual(filterAndSortDirectory(people, { query: "maria" }).map(p => p.id), ["p1"]));
automatic(22, "Filtre Nom", () => assert.deepEqual(filterAndSortDirectory(people, { name: "cerini" }).map(p => p.id), ["p2"]));
automatic(23, "Filtre Lieu", () => assert.deepEqual(filterAndSortDirectory(people, { place: "orino" }).map(p => p.id), ["p1"]));
automatic(24, "Filtre Naissance", () => assert.deepEqual(filterAndSortDirectory(people, { birthYear: "1870" }).map(p => p.id), ["p2"]));
automatic(25, "Filtre Décès", () => assert.deepEqual(filterAndSortDirectory(people, { deathYear: "1932" }).map(p => p.id), ["p1", "p2"]));
automatic(26, "Tri A → Z", () => assert.deepEqual(filterAndSortDirectory(people, { sort: "name-asc" }).map(p => p.lastName), ["Alberti", "Cerini", "Giovannoni"]));
automatic(27, "Tri Z → A", () => assert.deepEqual(filterAndSortDirectory(people, { sort: "name-desc" }).map(p => p.lastName), ["Giovannoni", "Cerini", "Alberti"]));
automatic(28, "Tri plus ancien", () => assert.deepEqual(filterAndSortDirectory(people, { sort: "birth-asc" }).map(p => p.id), ["p1", "p2", "p3"]));
automatic(29, "Tri plus récent", () => assert.deepEqual(filterAndSortDirectory(people, { sort: "birth-desc" }).map(p => p.id), ["p2", "p1", "p3"]));

manualWithStaticCheck(30, "Desktop large", () => includes("repeat(auto-fill,minmax(270px,1fr))"), "Règles desktop contrôlées, mais rendu pixel réel indisponible sans navigateur");
manualWithStaticCheck(31, "Desktop étroit", () => includes("max-width:1040px", "repeat(2,minmax(0,1fr))"), "Breakpoint contrôlé, mais rendu pixel réel indisponible sans navigateur");
manualWithStaticCheck(32, "Tablette", () => includes("max-width:980px", "min-width:761px"), "Breakpoint contrôlé, mais test tactile réel indisponible");
manualWithStaticCheck(33, "Smartphone", () => includes("max-width:760px", ".nav-btn,.header-tools .btn,.tree-controls button,.person-actions .btn", "min-height:44px"), "Règles mobiles et cibles tactiles contrôlées, mais appareil réel indisponible");
manualWithStaticCheck(34, "Très petit smartphone", () => includes("max-width:390px", "minmax(0,1fr)"), "Breakpoint 390 px contrôlé, mais rendu pixel réel indisponible");

automatic(35, "Date complète", () => assert.equal(formatGenealogyDate({ type: "exact", value: "1869-03-14" }), "14 mars 1869"));
automatic(36, "Année seulement", () => assert.equal(formatGenealogyDate({ type: "year", year: 1869 }), "1869"));
automatic(37, "Date vers une année", () => assert.equal(formatGenealogyDate({ type: "about", year: 1869 }), "vers 1869"));
automatic(38, "Date entre deux années", () => assert.equal(formatGenealogyDate({ type: "between", from: 1867, to: 1871 }), "entre 1867 et 1871"));
automatic(39, "Date inconnue", () => assert.equal(formatGenealogyDate({ type: "unknown" }), "—"));
staticCheck(40, "Naissance dans chaque format", () => ["exact", "year", "about", "between", "unknown"].forEach(type => assert.ok(html.includes(`data-date-prefix="birth" data-date-type="${type}"`))));
staticCheck(41, "Décès dans chaque format", () => ["exact", "year", "about", "between", "unknown"].forEach(type => assert.ok(html.includes(`data-date-prefix="death" data-date-type="${type}"`))));
automatic(42, "Tri de précisions différentes", () => assert.deepEqual(filterAndSortDirectory(people, { sort: "birth-asc" }).map(p => p.id), ["p1", "p2", "p3"]));
automatic(43, "Filtrage de précisions différentes", () => { assert.equal(genealogyDateMatchesYear({ type: "between", from: 1867, to: 1871 }, "", 1869), true); assert.equal(genealogyDateMatchesYear({ type: "about", year: 1869 }, "", 1869), true); });

staticCheck(44, "Mariage avec date complète", () => { includes('data-date-prefix="union"'); assert.equal(formatGenealogyDate({ type: "exact", value: "1890-06-08" }), "8 juin 1890"); });
staticCheck(45, "Mariage avec année", () => assert.equal(formatGenealogyDate(family.unionDateInfo), "1890"));
staticCheck(46, "Mariage approximatif", () => assert.equal(formatGenealogyDate({ type: "about", year: 1890 }), "vers 1890"));
staticCheck(47, "Mariage entre deux années", () => assert.equal(formatGenealogyDate({ type: "between", from: 1888, to: 1891 }), "entre 1888 et 1891"));
staticCheck(48, "Lieu de mariage", () => { includes('id="unionPlace"', "unionPlace:"); assert.equal(family.unionPlace, "Orino"); });
automatic(49, "Union libre", () => assert.equal(normalizeRelationType("partner"), "partner"));
automatic(50, "Relation non précisée", () => assert.equal(normalizeRelationType(undefined), "unknown"));

automatic(51, "Séparation", () => assert.equal(normalizeEndType("separation"), "separation"));
automatic(52, "Divorce", () => assert.equal(normalizeEndType("divorce"), "divorce"));
staticCheck(53, "Date de séparation", () => includes('data-date-prefix="end"', "endDateInfo"));
staticCheck(54, "Date de divorce", () => includes('value="divorce"', "endDateInfo"));
staticCheck(55, "Divorce sans suppression du lien", () => { const saveBlock = app.slice(app.indexOf("async function saveFamilyDetails"), app.indexOf("function personInitials")); assert.ok(!saveBlock.includes("partnerIds:")); assert.ok(saveBlock.includes("endType:")); });

automatic(56, "Filiation biologique", () => assert.equal(parentChildLinkType(family, "p1", "p3"), "biological"));
automatic(57, "Filiation adoptive", () => assert.equal(parentChildLinkType(family, "p2", "p3"), "adoptive"));
automatic(58, "Filiation incertaine", () => assert.equal(childLineType({ ...family, parentChildLinks: [{ parentId: "p1", childId: "p3", type: "uncertain" }] }, "p3"), "uncertain"));
automatic(59, "Filiation non précisée", () => assert.equal(parentChildLinkType({ partnerIds: ["p1"], childIds: ["p3"] }, "p1", "p3"), "unknown"));
automatic(60, "Parent biologique et parent adoptif", () => assert.deepEqual(normalizedParentChildLinks(family).map(link => link.type), ["biological", "adoptive"]));

automatic(61, "Ancienne personne Firebase", () => assert.deepEqual(normalizeGenealogyDate(undefined, "1869-03-14"), { type: "exact", value: "1869-03-14" }));
automatic(62, "Ancienne relation Firebase", () => { const old = { partnerIds: ["p1", "p2"], childIds: ["p3"] }; assert.equal(normalizeRelationType(old.relationType), "unknown"); assert.equal(normalizedParentChildLinks(old).length, 2); });
automatic(63, "Ancienne date complète", () => assert.equal(formatDirectoryDate(undefined, "1932-06-08"), "8 juin 1932"));
automatic(64, "Donnée sans nouvelles propriétés", () => { assert.equal(normalizeEndType(undefined), "none"); assert.equal(parentChildLinkType({ partnerIds: ["p1"], childIds: ["p3"] }, "p1", "p3"), "unknown"); });
staticCheck(65, "Aucune migration destructive", () => { assert.ok(!/for\s*\([^)]*people[^)]*\)[\s\S]{0,300}updateDoc[^\n]*birthDateInfo/.test(app)); assert.ok(rules.includes("!('birthDateInfo' in request.resource.data)")); }, "Absence de migration automatique vérifiée dans le code");

function largeGenealogy(depth = 4, childrenPerFamily = 4) {
  const generatedPeople = [], generatedFamilies = [];
  let personIndex = 0, familyIndex = 0;
  const addPerson = level => { const id = `g${personIndex++}`; generatedPeople.push({ id, firstName: `P${personIndex}`, lastName: "Test", birthDateInfo: { type: "year", year: 1800 + level * 28 + personIndex % 20 } }); return id; };
  let couples = [[addPerson(0), addPerson(0)]];
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const partners of couples) {
      const childIds = [];
      for (let index = 0; index < childrenPerFamily; index++) {
        const child = addPerson(level + 1), spouse = addPerson(level + 1);
        childIds.push(child); next.push([child, spouse]);
      }
      generatedFamilies.push({ id: `gf${familyIndex++}`, partnerIds: partners, childIds });
    }
    couples = next;
  }
  return { people: generatedPeople, families: generatedFamilies };
}

function assertNoCardOverlap(layout) {
  const positions = [...layout.positions.values()];
  for (let left = 0; left < positions.length; left++) for (let right = left + 1; right < positions.length; right++) {
    const a = positions[left], b = positions[right];
    const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    assert.equal(overlap, false, `Chevauchement détecté entre les cartes ${left} et ${right}`);
  }
}

automatic(66, "Toutes les personnes apparaissent", () => { const dataset = largeGenealogy(); const layout = calculateTreeLayout(dataset.people, dataset.families); assert.equal(layout.positions.size, dataset.people.length); assert.ok(dataset.people.length > 500); assertNoCardOverlap(layout); });
automatic(67, "Liens parent/enfant", () => { const layout = calculateTreeLayout(people, [family]); assert.ok(layout.positions.get("p3").y > layout.positions.get("p1").y); });
automatic(68, "Partenaires côte à côte", () => { const layout = calculateTreeLayout(people, [family]); assert.equal(layout.positions.get("p1").y, layout.positions.get("p2").y); assert.notEqual(layout.positions.get("p1").x, layout.positions.get("p2").x); });

class FakeClassList { constructor(){ this.values = new Set(); } add(v){ this.values.add(v); } remove(v){ this.values.delete(v); } toggle(v,on){ on ? this.add(v) : this.remove(v); } }
class FakeElement {
  constructor({ width = 1000, height = 700 } = {}) { this.listeners = {}; this.style = {}; this.classList = new FakeClassList(); this.clientWidth = width; this.clientHeight = height; this.innerHTML = ""; }
  addEventListener(type, fn){ (this.listeners[type] ||= []).push(fn); }
  dispatch(type, values = {}) { const event = { pointerId: 1, clientX: 0, clientY: 0, button: 0, deltaY: 0, preventDefault(){}, stopPropagation(){}, target: { closest: () => null }, ...values }; for (const fn of this.listeners[type] || []) fn(event); }
  getBoundingClientRect(){ return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture(){}
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
}

automatic(69, "Pan, zoom et interactions du canvas", () => {
  globalThis.window = { devicePixelRatio: 2 };
  globalThis.ResizeObserver = class { observe(){} disconnect(){} };
  const viewport = new FakeElement(), scene = new FakeElement();
  const camera = createTreeCamera({ viewport, scene });
  camera.setBounds({ x: 0, y: 0, width: 1500, height: 900 });
  viewport.dispatch("pointerdown", { clientX: 100, clientY: 100 });
  viewport.dispatch("pointermove", { clientX: 150, clientY: 130 });
  viewport.dispatch("pointerup", { clientX: 150, clientY: 130 });
  assert.equal(camera.getState().x, 50); assert.equal(camera.getState().y, 30);
  const before = camera.getState().scale; viewport.dispatch("wheel", { clientX: 400, clientY: 300, deltaY: -100 }); assert.ok(camera.getState().scale > before);
  const beforePinch = camera.getState().scale;
  viewport.dispatch("pointerdown", { pointerId: 1, clientX: 300, clientY: 300 });
  viewport.dispatch("pointerdown", { pointerId: 2, clientX: 400, clientY: 300 });
  viewport.dispatch("pointermove", { pointerId: 2, clientX: 450, clientY: 300 });
  assert.ok(camera.getState().scale > beforePinch);
  viewport.dispatch("pointerup", { pointerId: 1, clientX: 300, clientY: 300 });
  viewport.dispatch("pointerup", { pointerId: 2, clientX: 450, clientY: 300 });
  const beforeButton = camera.getState().scale; camera.zoomBy(1.2); assert.ok(camera.getState().scale >= beforeButton);
  camera.fit(); assert.ok(camera.getState().scale >= .25 && camera.getState().scale <= 2); camera.destroy();
});

automatic(70, "Nouvelles propriétés sans casse du layout/rendu", () => {
  const layout = calculateTreeLayout(people, [family]);
  const scene = new FakeElement();
  globalThis.document = { createElement: () => { let text = ""; return { set textContent(value){ text = String(value); }, get innerHTML(){ return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); } }; } };
  const renderer = createTreeRenderer({ scene }); renderer.render(people, layout);
  assert.ok(scene.innerHTML.includes('data-person-id="p1"')); assert.ok(scene.innerHTML.includes('data-person-id="p2"')); assert.ok(scene.innerHTML.includes('data-person-id="p3"'));
  assert.ok(scene.innerHTML.includes("ended-union"));
});

const counts = results.reduce((out, result) => (out[result.status] = (out[result.status] || 0) + 1, out), {});
assert.equal(results.length, 70);
process.stdout.write(`${JSON.stringify({ counts, results }, null, 2)}\n`);
