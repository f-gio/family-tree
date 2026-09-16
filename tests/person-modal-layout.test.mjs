import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "css", "design-system.css"), "utf8");
const app = readFileSync(join(root, "js", "app.js"), "utf8");

assert.match(css, /--modal-xl:\s*57\.5rem/);
assert.match(html, /<dialog class="person-dialog modal-xl"/);
assert.match(css, /dialog\.modal-xl\s*\{\s*width:\s*min\(var\(--modal-xl\), calc\(100% - 3rem\)\)/);

assert.match(html, /class="compact-photo-uploader identity-photo"/);
assert.match(html, /class="compact-photo-trigger"/);
assert.match(html, /id="personPhotoActionLabel">Ajouter une photo/);
assert.match(app, /personPhotoActionLabel"\)\.textContent = value \? "Modifier la photo" : "Ajouter une photo"/);
assert.match(app, /Compression automatique · 5 Ko maximum\./);

assert.equal((html.match(/life-fields-grid event-information-group/g) || []).length, 2);
assert.equal((html.match(/>Type de date</g) || []).length, 0);
assert.match(html, /aria-label="Format de la date de naissance"/);
assert.match(html, /aria-label="Format de la date de décès"/);
assert.match(css, /\.event-information-group\s*\{[\s\S]*?border:\s*var\(--border-subtle\)/);
assert.match(css, /\.event-information-group:has\(\.genealogy-date\[data-date-type="between"\]\)/);

for (const id of [
  "personPhotoFile", "removePersonPhotoBtn", "firstName", "middleName", "lastName",
  "marriedName", "gender", "branch", "birthDate", "birthYear", "birthYearFrom",
  "birthYearTo", "place", "deathDate", "deathYear", "deathYearFrom", "deathYearTo",
  "deathPlace", "notes", "savePersonBtn", "deleteBtn"
]) assert.ok(html.includes(`id="${id}"`), `Contrôle historique absent : ${id}`);

assert.match(css, /@media \(max-width: 760px\)[\s\S]*?dialog\.modal-xl/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.identity-fields\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(css, /@media \(max-width: 560px\)[\s\S]*?dialog\.modal-xl/);

console.log("Mise en page de la modale Personne : OK");
