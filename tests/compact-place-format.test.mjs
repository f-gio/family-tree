import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatCompactPlace, toIsoAlpha3 } from "../js/place-format.js";

const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const renderer = await readFile(new URL("../js/tree-renderer.js", import.meta.url), "utf8");

test("convertit les codes pays alpha-2 structurés en ISO alpha-3", () => {
  assert.equal(toIsoAlpha3("IT"), "ITA");
  assert.equal(toIsoAlpha3("FR"), "FRA");
  assert.equal(toIsoAlpha3("TR"), "TUR");
  assert.equal(toIsoAlpha3("DE"), "DEU");
  assert.equal(toIsoAlpha3("US"), "USA");
  assert.equal(toIsoAlpha3("ita"), "ITA");
  assert.equal(toIsoAlpha3("XX"), "");
});

test("formate une sélection GeoNames structurée pour la lecture rapide", () => {
  assert.equal(formatCompactPlace("Varese", {
    name: "Varese", country: "Italie", countryCode: "IT", geonamesId: 3164699
  }), "Varese (ITA)");
  assert.equal(formatCompactPlace("Paris", { name: "Paris", countryCode: "FR" }), "Paris (FRA)");
  assert.equal(formatCompactPlace("Istanbul", { name: "Istanbul", countryCode: "TR" }), "Istanbul (TUR)");
});

test("préserve strictement une ancienne valeur texte sans inventer son pays", () => {
  assert.equal(formatCompactPlace("Orino"), "Orino");
  assert.equal(formatCompactPlace(" Cabiaglio ", null), "Cabiaglio");
});

test("gère les métadonnées partielles, les valeurs vides et les lieux longs", () => {
  assert.equal(formatCompactPlace("Varese", { name: "Varese", country: "Italie" }), "Varese");
  assert.equal(formatCompactPlace("", { name: "", countryCode: "IT" }), "");
  assert.equal(formatCompactPlace("", null), "");
  const longName = "Saint-Remy-en-Bouzemont-Saint-Genest-et-Isson";
  assert.equal(formatCompactPlace(longName, { name: longName, countryCode: "FR" }), `${longName} (FRA)`);
  assert.ok(!formatCompactPlace("", {}).match(/undefined|null|\(\)/));
});

test("l'arbre utilise le formateur commun pour naissance et décès", () => {
  assert.match(renderer, /import \{ formatCompactPlace \} from "\.\/place-format\.js"/);
  assert.match(renderer, /formatCompactPlace\(place, placeInfo\)/);
  assert.match(renderer, /person\.birthPlaceInfo/);
  assert.match(renderer, /person\.deathPlaceInfo/);
});

test("les aperçus documentaires réutilisent le même formateur", () => {
  assert.match(app, /import \{ formatCompactPlace \} from "\.\/place-format\.js"/);
  assert.match(app, /formatCompactPlace\(item\.place, item\.placeInfo\)/);
});

test("l'Annuaire Liste et Cartes ne reçoit pas un lieu qu'il n'affichait pas", () => {
  const directoryRenderer = app.match(/function renderDirectory\(\)[\s\S]*?function openDirectoryDocuments/)?.[0] || "";
  assert.ok(directoryRenderer.includes("directory-entry"));
  assert.ok(!directoryRenderer.includes("birthPlaceInfo"));
  assert.ok(!directoryRenderer.includes("deathPlaceInfo"));
  assert.ok(!directoryRenderer.includes("formatCompactPlace"));
});

