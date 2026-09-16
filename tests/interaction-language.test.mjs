import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { icon, emptyState, setButtonPending } from "../js/ui-components.js";

const root = new URL("../", import.meta.url);
const [html, css, app, renderer, rules, previousRules] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/tree-renderer.js", root), "utf8"),
  readFile(new URL("firestore.rules", root), "utf8"),
  readFile(new URL("../family-tree-v16-modals-forms/firestore.rules", root), "utf8")
]);

// 17 — visibilité de l'état du système.
assert.match(html, /id="toast"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
assert.match(app, /function toast\(message, type = "success"\)/);
assert.match(app, /setButtonPending\(\$\("saveDocumentBtn"\), true\)/);
assert.match(app, /setButtonPending\(saveButton, true\)/);
assert.match(css, /\.toast\[data-type="success"\]/);
assert.match(css, /\.status\[data-state="loading"\]/);

// 18 — actions destructives et distinction suppression/dissociation.
assert.match(app, /Dissocier ce partenaire/);
assert.match(app, /Dissocier ce lien parent-enfant/);
assert.match(app, /Supprimer définitivement ce document/);
assert.match(app, /Supprimer définitivement cette tâche/);
assert.match(app, /Sa fiche et ses liens resteront disponibles/);
assert.match(css, /\.modal-actions > \.btn\.danger/);

// 19 — menus et navigation.
assert.match(html, /aria-haspopup="menu"/);
assert.match(html, /id="accountDropdown" role="menu"/);
assert.match(app, /event\.key !== "Escape"/);
assert.match(app, /setAttribute\("aria-current", "page"\)/);

// 20 — états vides.
assert.match(app, /emptyState\(\{ iconName: "people", title: "Aucune personne trouvée"/);
assert.match(app, /data-empty-add-document/);
assert.match(app, /data-empty-add-task/);
assert.match(renderer, /emptyState\(\{/);
assert.match(css, /\.empty-state-action/);

// 21 — cartes et conteneurs.
assert.match(css, /:where\(\.content-card, \.directory-entry, \.relation-card/);
assert.match(css, /\.content-card:hover/);
assert.match(css, /var\(--border-subtle\)/);

// 22 — famille SVG, tailles et accessibilité des boutons icônes.
for (const id of ["tree", "people", "document", "tasks", "close", "trash", "unlink", "eye", "edit"]) {
  assert.ok(html.includes(`id="icon-${id}"`), `Icône manquante : ${id}`);
}
assert.match(css, /\.ui-icon \{/);
assert.match(css, /\.ui-icon-sm/);
assert.match(css, /\.ui-icon-lg/);
const closeButtons = [...html.matchAll(/<button class="btn icon-btn"[^>]*data-close=[^>]*>/g)].map(match => match[0]);
assert.ok(closeButtons.length >= 8);
for (const button of closeButtons) {
  assert.match(button, /aria-label="Fermer"/);
  assert.match(button, /title="Fermer"/);
}

assert.match(icon("edit"), /#icon-edit/);
assert.match(icon("inconnu"), /#icon-info/);
assert.match(emptyState({ title: "Vide", description: "Description" }), /class="empty-state"/);

const mockButton = {
  textContent: "Enregistrer",
  dataset: {},
  disabled: false,
  attributes: new Map(),
  setAttribute(name, value) { this.attributes.set(name, value); },
  removeAttribute(name) { this.attributes.delete(name); }
};
setButtonPending(mockButton, true);
assert.equal(mockButton.disabled, true);
assert.equal(mockButton.attributes.get("aria-busy"), "true");
setButtonPending(mockButton, false);
assert.equal(mockButton.disabled, false);
assert.equal(mockButton.textContent, "Enregistrer");

// La couche d'interaction ne modifie ni les règles ni le modèle Firebase.
assert.equal(rules, previousRules);
assert.doesNotMatch(app, /\balert\s*\(/);

console.log("Langage d’interaction sections 17–22 : OK");
