import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, app, relations, rules] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/family-relations.js", root), "utf8"),
  readFile(new URL("firestore.rules", root), "utf8")
]);

test("l’onglet présente une seule action d’ajout et trois catégories lisibles", () => {
  assert.match(html, /id="toggleRelationBuilderBtn"[^>]+aria-expanded="false"/);
  assert.match(html, /Parents|data-relation-kind="parent"/);
  assert.match(html, /Partenaire|data-relation-kind="partner"/);
  assert.match(html, /Enfant|data-relation-kind="child"/);
  assert.match(app, /relationGroup\("Parents"/);
  assert.match(app, /relationGroup\("Partenaires et unions"/);
  assert.match(app, /relationGroup\("Enfants"/);
});

test("les informations inconnues sont retirées des résumés synthétiques", () => {
  assert.match(app, /value !== "—"/);
  assert.match(app, /value !== "Non précisé"/);
  assert.match(app, /relationType === "unknown" \? ""/);
  assert.match(app, /unionDate === "—" \? ""/);
  assert.match(app, /item\?\.gender === "F" \? "Mère"/);
});

test("le parcours d’ajout révèle uniquement le formulaire choisi", () => {
  assert.match(app, /function setRelationBuilderKind/);
  assert.match(app, /panel\.hidden = panel\.dataset\.relationAddPanel !== normalized/);
  assert.match(html, /data-relation-add-panel="parent"/);
  assert.match(html, /data-relation-add-panel="partner" hidden/);
  assert.match(html, /data-relation-add-panel="child" hidden/);
});

test("deux parents peuvent être reliés en une seule opération sans changer le modèle", () => {
  assert.match(html, /id="parent2Select"/);
  assert.match(app, /const parentIds = \[firstParentId, secondParentId\]\.filter\(Boolean\)/);
  assert.match(app, /await linkChildToParents\(activeId, parentIds, "", linkTypes\)/);
  assert.match(relations, /parentChildLinks/);
  assert.match(rules, /match \/families\/\{familyId\}/);
});

test("les actions explicites remplacent les menus à trois points", () => {
  assert.match(app, /data-family-card-toggle/);
  assert.match(app, /data-edit-family="\$\{esc\(family\.id\)\}"/);
  assert.match(app, /class="btn tertiary danger"/);
  assert.match(app, /Dissocier ce partenaire/);
  assert.match(app, /Dissocier cet enfant/);
  assert.doesNotMatch(app, /relation-actions-menu/);
  assert.match(css, /\.relation-actions-popover/);
  assert.match(css, /\.family-card-chevron:focus-visible/);
  assert.match(app, /Ses liens avec les deux parents seront retirés/);
});

test("l’édition ciblée d’une filiation préserve les autres liens du foyer", () => {
  assert.match(app, /const relevantLinks = normalizedParentChildLinks\(family\)\.filter/);
  assert.match(app, /const editedLinks = new Map/);
  assert.match(app, /normalizedParentChildLinks\(family\)\.map\(link => \(\{ \.\.\.link, type:/);
});

test("la présentation reste adaptée au mobile", () => {
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.relations-overview \{[^}]*flex-direction: column/);
  assert.match(css, /\.relation-add-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.family-card-chevron \{[^}]*width: var\(--control-touch\)/);
});
