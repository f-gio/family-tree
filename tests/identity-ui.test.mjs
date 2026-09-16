import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "css", "design-system.css"), "utf8");
const app = readFileSync(join(root, "js", "app.js"), "utf8");

const identity = html.match(/<section class="person-section-panel" id="personIdentityPanel"[\s\S]*?<\/section>\s*<section class="person-section-panel" id="personRelationsPanel"/)?.[0] || "";
assert.ok(identity, "L’onglet Identité doit être présent");

// Ordre desktop demandé : photo, prénoms, noms, sexe/branche, naissance, décès.
const orderedMarkers = [
  "identity-photo", 'id="firstName"', 'id="middleName"', 'id="lastName"',
  'id="marriedName"', 'id="gender"', 'id="branch"',
  '<legend>Naissance</legend>', '<legend>Décès</legend>', 'id="notes"'
];
let previous = -1;
for (const marker of orderedMarkers) {
  const position = identity.indexOf(marker);
  assert.ok(position > previous, `Ordre incorrect pour ${marker}`);
  previous = position;
}

assert.match(identity, /Nom d’usage<input[^>]+id="marriedName"/);
assert.ok(!identity.includes("Nom d’épouse"));
assert.ok(!identity.includes("Noms et informations utilisées"));
assert.ok(!identity.includes("Conservez uniquement le niveau"));
assert.ok(!identity.includes("La date sera affichée"));
assert.equal((identity.match(/\bidentity-life-section\b/g) || []).length, 2);
assert.match(identity, /<label class="life-place">Lieu de naissance/);
assert.match(identity, /<label class="life-place">Lieu de décès/);

// La compatibilité de données est conservée : même id et même propriété historique.
assert.match(app, /const personFields = \[[^\]]*"marriedName"/);
assert.match(app, /\$\("marriedNameField"\)\.hidden = false/);
assert.ok(!app.includes('$("marriedName").value = $("lastName").value'));

for (const selector of [
  ".identity-overview", ".identity-fields", ".compact-photo-uploader",
  ".identity-life-section", ".event-information-group", ".identity-notes"
]) assert.ok(css.includes(selector), `Style Identité absent : ${selector}`);

assert.match(css, /\.identity-overview\s*\{[\s\S]*?grid-template-columns:\s*minmax\(7\.5rem, 8\.25rem\) minmax\(0, 1fr\)/);
assert.match(css, /\.identity-fields\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.identity-overview\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.identity-fields\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);

console.log("Structure et UI de l’onglet Identité : OK");
