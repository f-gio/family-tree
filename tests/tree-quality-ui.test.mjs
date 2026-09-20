import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, app, qualitySource] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/tree-quality.js", root), "utf8")
]);

test("l'Annuaire expose le contrôle de l'arbre sans modifier la toolbar principale", () => {
  assert.match(html, /id="treeQualityBtn"/);
  assert.match(html, /Contrôle de l’arbre/);
  assert.match(app, /analyzeTreeQuality\(\{ people, families \}\)/);
});

test("la vue de diagnostic possède une structure accessible et responsive", () => {
  assert.match(html, /id="treeQualityDialog"[^>]+aria-labelledby="treeQualityTitle"/);
  assert.match(html, /id="treeQualityContent"/);
  assert.match(css, /\.tree-quality-dialog\[open\]/);
  assert.match(css, /\.tree-quality-item-actions/);
});

test("les actions de diagnostic réutilisent l'ouverture de fiche existante", () => {
  assert.match(app, /data-quality-person/);
  assert.match(app, /openPerson\(item, "directory"\)/);
});

test("le contrôle est purement local et ne crée aucune écriture Firestore", () => {
  assert.doesNotMatch(qualitySource, /\b(addDoc|updateDoc|setDoc|deleteDoc|writeBatch|collection|onSnapshot)\b/);
});

test("les entrées manquantes sont agrégées par personne", () => {
  assert.match(app, /function aggregateMissing/);
  assert.ok(app.includes("Non renseigné : "), "préfixe d'agrégation manquant");
  assert.ok(app.includes("MISSING_FIELD_LABELS"), "table de correspondance manquante");
  assert.ok(app.includes("MISSING_FIELD_ORDER"), "ordre des champs manquant");
});

test("la table de correspondance utilise des codes de champs structurés", () => {
  assert.ok(app.includes('firstName: "Prénom"'), "mapping firstName manquant");
  assert.ok(app.includes('birthDate: "Date de naissance"'), "mapping birthDate manquant");
  assert.ok(app.includes('deathPlace: "Lieu de décès"'), "mapping deathPlace manquant");
});

test("aggregateMissing utilise item.field et ne parse plus item.message", () => {
  assert.ok(app.includes("item.field"), "utilisation de item.field manquante");
  assert.doesNotMatch(app, /aggregateMissing[\s\S]*?replace\(\/\^\.\* · \//, "parsing résiduel du message détecté");
});

test("une personne avec plusieurs champs manquants produit une seule entrée", () => {
  assert.ok(app.includes("new Set()"), "utilisation de Set pour dédupliquer");
});

test("le rendu manquant ne répète pas le nom de la personne", () => {
  assert.match(app, /Non renseigné : \$\{/);
  assert.doesNotMatch(app, /Non renseigné : \$\{entry\.fields\.join\(" · "\) ·/);
});

test("test anti-parsing : le message ne détermine pas le libellé", () => {
  assert.doesNotMatch(app, /aggregateMissing[\s\S]*?item\.message\.trim\(\)\.replace/, "détectée dépendance au message");
});

test("les catégories sont affichées sous forme d'accordéons", () => {
  assert.match(app, /<details class="tree-quality-category">/);
  assert.match(app, /<summary>/);
  assert.match(css, /\.tree-quality-category > summary/);
});

test("les 4 catégories sont toujours présentes, même à zéro", () => {
  assert.ok(app.includes("is-empty"), "classe état vide manquante");
  assert.ok(app.includes("tree-quality-category-count"), "classe compteur manquante");
  assert.match(css, /\.tree-quality-category\.is-empty/);
});

test("le compteur est aligné sur la même ligne que le titre", () => {
  assert.ok(app.includes("tree-quality-category-title"), "classe titre manquante");
  assert.match(css, /\.tree-quality-category-title\s*\{[^}]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /\.tree-quality-category-count\s*\{[^}]*flex:\s*0\s+0\s+auto/);
});

test("les catégories vides sont non expansibles mais restent visibles", () => {
  assert.match(app, /<div class="tree-quality-category is-empty">/);
  assert.doesNotMatch(app, /<details class="tree-quality-category is-empty">/);
});

test("le contenu d'une catégorie ouverte est dans un conteneur scrollable", () => {
  assert.ok(app.includes("tree-quality-category-content"), "conteneur de contenu manquant");
  assert.match(css, /\.tree-quality-category-content\s*\{[\s\S]*?max-height/);
  assert.match(css, /\.tree-quality-category-content\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("Voir la fiche ne revient pas à la ligne", () => {
  assert.match(css, /\.tree-quality-item-actions\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.tree-quality-item-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  assert.ok(app.includes("Voir la fiche"), "libellé bouton manquant");
});

test("un indicateur de scroll mobile est présent", () => {
  assert.ok(app.includes("tree-quality-scroll"), "conteneur scroll manquant");
  assert.ok(app.includes("tree-quality-scroll-indicator"), "indicateur scroll manquant");
  assert.match(css, /\.tree-quality-scroll-indicator/);
  assert.match(css, /pointer-events:\s*none/);
  assert.ok(app.includes("initTreeQualityScroll"), "initialisation scroll manquante");
});

test("les catégories sont affichées sous forme d'accordéons", () => {
  assert.match(app, /<details class="tree-quality-category">/);
  assert.match(app, /<summary>/);
  assert.match(css, /\.tree-quality-category > summary/);
});

test("les 4 catégories sont toujours présentes, même à zéro", () => {
  assert.ok(app.includes("is-empty"), "classe état vide manquante");
  assert.ok(app.includes("tree-quality-category-count"), "classe compteur manquante");
  assert.match(css, /\.tree-quality-category\.is-empty/);
});

test("le compteur est aligné sur la même ligne que le titre", () => {
  assert.ok(app.includes("tree-quality-category-title"), "classe titre manquante");
  assert.match(css, /\.tree-quality-category-title\s*\{[^}]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /\.tree-quality-category-count\s*\{[^}]*flex:\s*0\s+0\s+auto/);
});

test("les catégories vides sont non expansibles mais restent visibles", () => {
  assert.match(app, /<div class="tree-quality-category is-empty">/);
  assert.doesNotMatch(app, /<details class="tree-quality-category is-empty">/);
});

test("le contenu d'une catégorie ouverte est dans un conteneur scrollable", () => {
  assert.ok(app.includes("tree-quality-category-content"), "conteneur de contenu manquant");
  assert.match(css, /\.tree-quality-category-content\s*\{[\s\S]*?max-height/);
  assert.match(css, /\.tree-quality-category-content\s*\{[\s\S]*?overflow-y:\s*auto/);
});

console.log("Tree quality UI : tests terminés");
