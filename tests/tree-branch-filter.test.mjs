import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LINEAGE_SURNAMES } from "../js/family-lineage.js";

const root = new URL("../", import.meta.url);
const [html, app, lineage] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/family-lineage.js", root), "utf8")
]);

test("A. le filtre est présent à droite de la recherche, dans la même zone de contrôles", () => {
  const toolbar = html.match(/<section class="toolbar">([\s\S]*?)<\/section>/);
  assert.ok(toolbar, "barre de recherche introuvable");
  const body = toolbar[1];
  const searchIndex = body.indexOf('id="search"');
  const filterIndex = body.indexOf('id="treeBranchFilter"');
  const resetIndex = body.indexOf('id="resetBtn"');
  assert.ok(searchIndex >= 0 && filterIndex > searchIndex && resetIndex > filterIndex,
    "le filtre doit être placé entre la recherche et le bouton Effacer");
  assert.ok(!html.includes('data-view="lineage"'), "aucune entrée de navigation ajoutée");
  assert.ok(!html.includes("Arbre global"), "pas de menu « Arbres » ni de bandeau de lignée");
});

test("B. options exactement : Toutes les branches puis les cinq patronymes", () => {
  const select = html.match(/<select[^>]*id="treeBranchFilter"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, "sélecteur de branche introuvable");
  const options = [...select[1].matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(match => ({ value: match[1], label: match[2] }));
  assert.deepEqual(options.map(option => option.label), ["Toutes les branches", ...LINEAGE_SURNAMES]);
  assert.deepEqual(options.slice(1).map(option => option.value), LINEAGE_SURNAMES);
});

test("C. valeur par défaut = Toutes les branches", () => {
  const options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
  const filterOption = options.find(option => option[2] === "Toutes les branches");
  assert.ok(filterOption);
  assert.equal(filterOption[1], "");
  assert.ok(!/selected/.test(html.match(/<option[^>]*>Toutes les branches<\/option>/)[0]));
});

test("D. changement de filtre → portée recalculée et caméra ajustée, sans bouton Appliquer", () => {
  assert.match(app, /\$\("treeBranchFilter"\)\.onchange\s*=/);
  assert.match(app, /lineageSurname\s*=\s*\$\("treeBranchFilter"\)\.value/);
  assert.match(app, /lineageSurname[\s\S]{0,160}renderTree\(\)[\s\S]{0,80}camera\.fit\(\)/);
  assert.ok(!html.includes("Appliquer"), "aucun bouton Appliquer");
});

test("E. recherche + filtre : la recherche porte sur la portée affichée", () => {
  assert.match(app, /const scopePeople = currentScope\?\.people \|\| treePeople\(\)/);
  assert.match(app, /scopePeople\.filter\(/);
  assert.match(app, /currentScope = scope;/);
});

test("F. responsive : filtre aligné desktop, empilé mobile, sans débordement", () => {
  assert.match(html, /\.toolbar\{display:grid;grid-template-columns:minmax\(190px,1fr\) auto auto/);
  assert.match(html, /\.toolbar-branch \.field\{width:auto;min-width:168px;margin-top:0\}/);
  assert.match(html, /\.toolbar-branch \.field\{min-height:44px\}/);
  assert.match(html, /@media\(max-width:760px\)\{\.toolbar #search\{grid-column:1;grid-row:1\}\.toolbar #resetBtn\{grid-column:2;grid-row:1\}\.toolbar \.toolbar-branch\{grid-column:1\/-1;grid-row:2\}/);
});

test("G. « Voir sa branche » remet le filtre à Toutes les branches", () => {
  assert.match(app, /function activateBranchView[\s\S]*?lineageSurname = "";[\s\S]*?\$\("treeBranchFilter"\)\.value = "";/);
  assert.match(app, /if \(view === "tree" && !branchView\)/);
});

test("H. aucune écriture Firestore et module sans accès DOM", () => {
  assert.doesNotMatch(lineage, /\b(collection|addDoc|updateDoc|deleteDoc|setDoc|writeBatch|runTransaction)\s*\(/);
  assert.doesNotMatch(lineage, /\bfirebase\b/i);
  assert.doesNotMatch(lineage, /\b(document|window)\b/);
  assert.match(app, /import \{ computeLineageScope \} from "\.\/family-lineage\.js"/);
});

console.log("Filtre de branche (interface et intégration) : OK");
