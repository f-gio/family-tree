import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, app, rules, referenceRules] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("firestore.rules", root), "utf8"),
  readFile(new URL("../family-tree-v17-interaction-language/firestore.rules", root), "utf8")
]);

// 23 et 29 — adaptation réelle et progressive, au-delà d'un couple desktop/mobile.
for (const width of [1180, 980, 760, 560, 390]) {
  assert.ok(css.includes(`max-width: ${width}px`), `Point d'adaptation manquant : ${width}px`);
}
assert.match(css, /\.directory-filter-panel\s*\{[\s\S]*?position:\s*fixed/);
assert.match(css, /@media \(max-width: 560px\)[\s\S]*?width:\s*100vw;[\s\S]*?height:\s*100dvh/);
assert.match(css, /\.content-grid\.list-mode \.content-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(css, /body\s*\{\s*overflow-x:\s*hidden/);

// 24 — clavier mobile adapté aux recherches, années, adresses et URL.
assert.match(html, /id="loginEmail"[^>]+inputmode="email"[^>]+autocomplete="username"/);
assert.match(html, /id="documentUrl"[^>]+inputmode="url"[^>]+autocomplete="url"[^>]+autocapitalize="none"/);
assert.match(html, /id="directoryBirthFilter"[^>]+inputmode="numeric"[^>]+pattern="\[0-9\]\*"/);
assert.match(app, /"unionYear"[\s\S]*?field\.inputMode = "numeric"/);
assert.match(app, /profileDisplayName: \{ autocomplete: "name", autocapitalize: "words" \}/);

// 25 — focus, noms accessibles, onglets et navigation clavier.
assert.match(css, /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible/);
assert.match(css, /@media \(forced-colors: active\)/);
assert.match(html, /class="btn icon-btn"[^>]+aria-label="Fermer"/);
assert.match(html, /class="person-section-nav" role="tablist"/);
assert.match(app, /settingsNav\?\.setAttribute\("role", "tablist"\)/);
assert.match(app, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
assert.match(app, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);

// 26 — les actions deviennent explicites sans confondre modification et ajout.
assert.match(html, />Ajouter le partenaire</);
assert.match(html, />Ajouter l’enfant</);
assert.match(html, />Ajouter le parent</);
assert.match(app, /<span>Modifier la relation<\/span>/);

// 27 — transitions courtes et désactivables.
assert.match(css, /@keyframes ft-reveal/);
assert.match(css, /dialog\[open\]\s*\{\s*animation: ft-dialog-in 150ms/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

// 28 — structure stable et état de chargement annoncé.
assert.match(css, /content-visibility:\s*auto/);
assert.match(css, /\.loading-surface::before[\s\S]*?content:\s*"Chargement…"/);
assert.match(app, /setAttribute\("aria-busy", String\(loading\)\)/);
assert.match(app, /function updateReadyViews\(\)/);

// Les identifiants HTML restent uniques.
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert.deepEqual([...new Set(duplicates)], []);

// Aucun changement de règles ou de modèle Firebase dans cette exécution.
assert.equal(rules, referenceRules);
assert.doesNotMatch(app, /\b(addDoc|updateDoc|setDoc|deleteDoc)\([^\n]+(?:responsive|accessibility|viewport)/i);

console.log("Responsive et accessibilité sections 23–29 : OK");
