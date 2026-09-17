import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatCompactPlace } from "../js/place-format.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../css/design-system.css", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const autocomplete = await readFile(new URL("../js/location-autocomplete.js", import.meta.url), "utf8");

test("la modale Personne conserve sa variante large, ses onglets et son footer", () => {
  assert.match(html, /<dialog class="person-dialog modal-xl"/);
  for (const section of ["identity", "relations", "documents"]) {
    assert.match(html, new RegExp(`data-person-section="${section}"`));
  }
  assert.match(html, /class="modal-actions person-actions"/);
  assert.match(css, /dialog\.modal-xl\s*\{\s*width:\s*min\(var\(--modal-xl\), calc\(100% - 3rem\)\)/);
  assert.match(css, /\.person-modal-form[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.person-section-panel[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.modal-actions[\s\S]*?flex:\s*0 0 auto/);
});

test("l'identité, la photo compacte et les deux événements restent inchangés", () => {
  for (const id of ["firstName", "middleName", "lastName", "marriedName", "gender", "branch", "personPhotoFile", "place", "deathPlace"]) {
    assert.ok(html.includes(`id="${id}"`), `champ manquant : ${id}`);
  }
  assert.match(html, /compact-photo-uploader identity-photo/);
  assert.equal((html.match(/event-information-group/g) || []).length, 2);
  for (const prefix of ["birth", "death"]) {
    for (const type of ["exact", "year", "about", "between", "unknown"]) {
      assert.match(html, new RegExp(`data-date-prefix="${prefix}" data-date-type="${type}"`));
    }
  }
});

test("GeoNames reste une aide facultative et conserve l'affichage détaillé", () => {
  assert.match(autocomplete, /formatLocationSuggestion/);
  assert.match(autocomplete, /`\$\{normalized\.name\} — \$\{context\.join\(", "\)\}`/);
  assert.match(autocomplete, /Suggestions indisponibles · la saisie libre reste disponible\./);
  assert.match(autocomplete, /getValue\(\)[\s\S]*?text:\s*selected\?\.name \|\| input\.value\.trim\(\)/);
  assert.ok(!app.includes("await searchPlaces"), "aucune recherche silencieuse ne doit être lancée à l'affichage");
});

test("les lieux structurés et historiques conservent le comportement attendu", () => {
  assert.equal(formatCompactPlace("Varese", { name: "Varese", country: "Italie", countryCode: "IT" }), "Varese (ITA)");
  assert.equal(formatCompactPlace("Orino"), "Orino");
  assert.equal(formatCompactPlace("", null), "");
});

test("les adaptations responsive de la modale et de l'autocomplete sont présentes", () => {
  for (const breakpoint of ["760px", "560px"]) assert.ok(css.includes(`max-width: ${breakpoint}`));
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?dialog\.modal-xl/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.identity-fields\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.location-suggestions[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.location-suggestion[\s\S]*?min-height:\s*var\(--control-md\)/);
});

test("la sauvegarde reste additive et sans migration globale", () => {
  for (const key of ["birthPlaceInfo", "deathPlaceInfo", "unionPlaceInfo", "endPlaceInfo", "placeInfo"]) assert.ok(app.includes(key));
  assert.match(app, /applyLocationField\(data, "place", existing, !!id\)/);
  assert.match(app, /applyLocationField\(data, "deathPlace", existing, !!id\)/);
  assert.ok(!/migration|migratePeople|rewriteAll/i.test(app));
});
