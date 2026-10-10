import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFirestoreRulesSafety } from "./firestore-rules-invariants.mjs";

// Fixtures v18 : snapshots historiques des modules gelés. Les règles Firestore
// évoluent additivement; leurs invariants de sécurité sont vérifiés ci-dessous
// sans comparer tout le fichier aux règles antérieures à Démarches.
const root = new URL("../", import.meta.url);
const reference = new URL("tests/fixtures/v18/", root);
const read = path => readFile(new URL(path, root), "utf8");
const readReference = path => readFile(new URL(path, reference), "utf8");
const normalizeLineEndings = value => value.replace(/\r\n/g, "\n");

const [html, css, app, renderer, rules] = await Promise.all([
  read("index.html"), read("css/design-system.css"), read("js/app.js"),
  read("js/tree-renderer.js"), read("firestore.rules")
]);

// 30 — invariants de sécurité Firestore + modules généalogiques gelés.
assertFirestoreRulesSafety(rules);
for (const file of [
  "js/tree-camera.js", "js/tree-layout.js", "js/family-relations.js",
  "js/genealogy-date.js", "js/directory-utils.js", "js/document-utils.js"
]) assert.equal(normalizeLineEndings(await read(file)), normalizeLineEndings(await readReference(file)), `${file} ne devait pas changer`);
for (const collection of ["people", "families", "documents", "tasks", "users"]) {
  assert.match(app, new RegExp(`${collection}: collection\\(db, "${collection}"\\)`));
}
assert.match(app, /onAuthStateChanged\(auth/);
assert.match(app, /createTreeCamera\(/);
assert.match(app, /createTreeRenderer\(/);
assert.match(app, /calculateTreeLayout\(/);

// 31 — mutualisation raisonnable : token tactile commun et composants existants.
assert.match(css, /--control-touch:\s*2\.75rem/);
assert.ok((css.match(/var\(--control-touch\)/g) || []).length >= 12);
assert.match(app, /emptyState\(/);
assert.match(app, /setButtonPending\(/);
assert.match(app, /documentDisplayLabel\(/);

// Prévention de la soumission implicite, y compris dans les fragments dynamiques.
for (const [name, source] of [["index.html", html], ["app.js", app], ["tree-renderer.js", renderer]]) {
  const buttons = [...source.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
  const missingType = buttons.filter(button => !/\btype=(?:"button"|'button'|"submit"|'submit')/.test(button));
  assert.deepEqual(missingType, [], `${name} contient un bouton sans type explicite`);
}
assert.match(app, /type="button" data-remove-\$\{removeType\}/);
assert.match(app, /\[data-remove-partner\],\[data-remove-child\]/);

// 32 — présence et conventions des écrans/parcours demandés.
for (const id of [
  "appMain", "directoryView", "documentsView", "tasksView", "personDialog",
  "personIdentityPanel", "personRelationsPanel", "personDocumentsPanel",
  "documentDialog", "directoryDocumentsDialog", "accountDropdown"
]) assert.ok(html.includes(`id="${id}"`), `Écran ou composant manquant : ${id}`);

assert.match(html, /person-section-nav" role="tablist"/);
assert.match(html, /id="personIdentityPanel" role="tabpanel"/);
assert.match(html, /id="personRelationsPanel" role="tabpanel"/);
assert.match(html, /id="personDocumentsPanel" role="tabpanel"/);
assert.match(app, /directorySearch/);
for (const id of [
  "directoryFirstNameFilter", "directoryMarriedNameFilter", "directoryGenderFilter",
  "directoryBranchFilter", "directoryBirthPlaceFilter", "directoryBirthYearFromFilter",
  "directoryBirthYearToFilter", "directoryDeathPlaceFilter", "directoryDeathYearFromFilter",
  "directoryDeathYearToFilter", "directoryDeathInfoFilter"
]) assert.ok(html.includes(`id="${id}"`) && app.includes(`$("${id}")`), `Filtre Annuaire manquant : ${id}`);
assert.match(app, /data-mode="list"|setContentMode/);
assert.match(app, /data-mode="cards"|setContentMode/);
assert.match(app, /confirm\("Supprimer définitivement/);
assert.match(app, /confirm\("Retirer cette personne de l’arbre/);
assert.match(app, /emptyState\(\{ iconName: "people"/);
assert.match(app, /emptyState\(\{ iconName: "document"/);
assert.match(app, /emptyState\(\{ iconName: "tasks"/);

// Hiérarchie, CTA, modales, feedback, erreurs, accessibilité et responsive.
assert.match(css, /\.btn\.primary/);
assert.match(css, /\.btn\.danger/);
assert.match(css, /dialog\[open\][\s\S]*?display:\s*flex/);
assert.match(css, /\.modal-scroll[\s\S]*?overflow:\s*auto/);
assert.match(html, /id="toast" role="status" aria-live="polite"/);
assert.match(css, /\.field\[aria-invalid="true"\]/);
assert.match(css, /:focus-visible/);
assert.match(css, /@media \(max-width: 760px\)/);
assert.match(css, /@media \(max-width: 560px\)/);
assert.match(css, /@media \(max-width: 390px\)/);

// Identifiants uniques et références ARIA résolues.
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length);
const idSet = new Set(ids);
for (const match of html.matchAll(/\b(?:aria-controls|aria-labelledby)="([^"]+)"/g)) {
  for (const target of match[1].split(/\s+/)) assert.ok(idSet.has(target), `Référence ARIA introuvable : ${target}`);
}

console.log("QA finale sections 30–34 : OK");
