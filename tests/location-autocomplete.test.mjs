import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildGeoNamesUrl,
  createGeoNamesSearch,
  formatLocationSuggestion,
  normalizeGeoNamesLocation,
  sanitizeStoredLocation
} from "../js/location-autocomplete.js";

const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../css/design-system.css", import.meta.url), "utf8");

test("la requête GeoNames cible les localités et limite les suggestions", () => {
  const url = new URL(buildGeoNamesUrl("Var", { username: "familytree_test", maxResults: 20 }));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "api.geonames.org");
  assert.equal(url.searchParams.get("name_startsWith"), "Var");
  assert.equal(url.searchParams.get("featureClass"), "P");
  assert.equal(url.searchParams.get("maxRows"), "8");
  assert.equal(url.searchParams.get("lang"), "fr");
  assert.equal(url.searchParams.get("username"), "familytree_test");
  assert.ok(!url.href.includes("username=demo"));
});

test("le relais Cloudflare reçoit uniquement la recherche libre", () => {
  const url = new URL(buildGeoNamesUrl("Var", {
    endpoint: "https://family-tree-geonames.giovannoni-f.workers.dev/"
  }));
  assert.equal(url.searchParams.get("q"), "Var");
  assert.equal(url.searchParams.has("username"), false);
});

test("les résultats internationaux conservent nom, subdivision, pays et identifiant", () => {
  const varese = normalizeGeoNamesLocation({
    name: "Varese", adminName2: "Varese", adminName1: "Lombardie",
    countryName: "Italie", countryCode: "IT", geonameId: 3164699
  });
  assert.deepEqual(varese, {
    name: "Varese", region: "Lombardie", country: "Italie",
    countryCode: "IT", geonamesId: 3164699
  });
  assert.equal(formatLocationSuggestion(varese), "Varese — Lombardie, Italie");
});

test("une petite localité et des homonymes restent distinguables et mis en cache", async () => {
  const payload = {
    geonames: [
      { name: "Orino", adminName2: "Varese", adminName1: "Lombardie", countryName: "Italie", countryCode: "IT", geonameId: 3171919 },
      { name: "San Pietro", adminName1: "Sicile", countryName: "Italie", countryCode: "IT", geonameId: 1 },
      { name: "San Pietro", adminName1: "Toscane", countryName: "Italie", countryCode: "IT", geonameId: 2 }
    ]
  };
  let calls = 0;
  const search = createGeoNamesSearch({ username: "test_account", fetchImpl: async () => { calls += 1; return { ok: true, json: async () => payload }; } });
  const results = await search("Orino-test-cache");
  assert.equal(results.length, 3);
  assert.equal(formatLocationSuggestion(results[0]), "Orino — Varese, Lombardie, Italie");
  assert.notEqual(formatLocationSuggestion(results[1]), formatLocationSuggestion(results[2]));
  await search("Orino-test-cache");
  assert.equal(calls, 1);
});

test("une configuration absente n’empêche pas le modèle de saisie libre", async () => {
  const search = createGeoNamesSearch({ username: "", fetchImpl: async () => assert.fail("aucune requête ne doit partir") });
  await assert.rejects(search("Cabiaglio"), error => error.code === "geonames/not-configured");
  assert.equal(sanitizeStoredLocation("Cabiaglio"), null);
  assert.equal(sanitizeStoredLocation({ name: "Cabiaglio", country: "Italie" }).name, "Cabiaglio");
});

test("une erreur GeoNames reste une erreur locale à l’aide de saisie", async () => {
  const search = createGeoNamesSearch({ username: "test_account", fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(search("Erreur-service-unique"), /indisponible \(503\)/);
});

test("les cinq véritables lieux utilisent le composant commun et des métadonnées additives", () => {
  for (const id of ["place", "deathPlace", "unionPlace", "endPlace", "documentPlace"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(app, new RegExp(`${id}: \\{ textKey:`));
  }
  for (const key of ["birthPlaceInfo", "deathPlaceInfo", "unionPlaceInfo", "endPlaceInfo", "placeInfo"]) assert.match(app, new RegExp(key));
  assert.match(app, /applyLocationField\(data, "place", existing, !!id\)/);
  assert.match(app, /deleteField\(\)/);
});

test("le combobox et le dropdown reprennent le Design System et les interactions clavier", async () => {
  const component = await readFile(new URL("../js/location-autocomplete.js", import.meta.url), "utf8");
  for (const token of ["combobox", "aria-autocomplete", "aria-expanded", "ArrowDown", "ArrowUp", "Enter", "Escape", "pointerdown"]) assert.ok(component.includes(token));
  assert.match(css, /\.location-suggestions[\s\S]*var\(--color-surface\)[\s\S]*var\(--shadow-medium\)/);
  assert.match(css, /\.location-suggestion[\s\S]*var\(--control-md\)/);
});

test("les lieux de naissance et décès restent dans les blocs événementiels existants", () => {
  assert.match(html, /event-information-group[\s\S]*id="place"[\s\S]*<\/fieldset>/);
  assert.match(html, /event-information-group[\s\S]*id="deathPlace"[\s\S]*<\/fieldset>/);
  assert.match(html, /<meta name="geonames-username" content="giovannoni\.f">/);
  assert.match(html, /<meta name="geonames-endpoint" content="https:\/\/family-tree-geonames\.giovannoni-f\.workers\.dev\/">/);
});

test("une sélection reste détaillée dans le champ sans alourdir la valeur enregistrée", async () => {
  const component = await readFile(new URL("../js/location-autocomplete.js", import.meta.url), "utf8");
  assert.match(component, /input\.value = selected \? formatLocationSuggestion\(selected\) : input\.value/);
  assert.match(component, /text: selected\?\.name \|\| input\.value\.trim\(\)/);
  assert.match(component, /value !== formatLocationSuggestion\(selected\)/);
});
