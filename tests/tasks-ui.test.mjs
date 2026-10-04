// Tests ciblés de l'interface Actions : markup, CSS responsive et comportements délégués.
// Exécution : node --test tests/tasks-ui.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const [html, css, app] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8")
]);

test("Actions : filtres Statut, Responsable et Échéance sont uniques", () => {
  for (const id of ["taskStatusFilter", "taskAssigneeFilter", "taskDueFilter"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} doit apparaître une fois`);
  }
  assert.doesNotMatch(html, /id="taskPriorityFilter"/);
});

test("Actions : Mes actions est un bouton filtre aria-pressed", () => {
  assert.match(html, /<button class="tool-toggle" type="button" id="myTasksFilter" aria-pressed="false"><svg class="ui-icon" aria-hidden="true"><use href="#icon-check"><\/use><\/svg><span>Mes actions<\/span><\/button>/);
  assert.match(app, /const mine = \$\("myTasksFilter"\)\.getAttribute\("aria-pressed"\) === "true";/);
  assert.match(app, /\$\("myTasksFilter"\)\.addEventListener\("click", \(\) => \{[\s\S]*?setAttribute\("aria-pressed", String\(!active\)\);[\s\S]*?renderTasks\(\);/);
  assert.ok(css.includes(".tool-toggle.is-active"));
});

test("Actions : la tuile entière ouvre la fiche à la souris et au clavier", () => {
  assert.match(app, /<article class="task-row\$\{late \? " is-late" : ""\}\$\{done \? " is-done" : ""\}\" data-task-row="\$\{item\.id\}" data-primary-tile/);
  assert.match(app, /row\.setAttribute\("tabindex", "0"\);[\s\S]*?row\.setAttribute\("role", "group"\);/);
  assert.match(app, /function openTaskById\(id\)[\s\S]*?if \(item\) openTask\(item\);/);
  assert.match(app, /preparePrimaryTileActivation\(event, row, \$\("taskDialog"\)\);\s*openTaskById\(row\.dataset\.taskRow\);/);
  assert.match(app, /if \(!row \|\| event\.target !== row \|\| !\["Enter", " "\]\.includes\(event\.key\)\) return;[\s\S]*?event\.preventDefault\(\);\s*openTaskById\(row\.dataset\.taskRow\);/);
});

test("Actions : le menu secondaire réutilise la suppression existante sans ouvrir la tuile", () => {
  const menuAction = app.slice(app.indexOf('const menuAction = event.target.closest?.("[data-tile-menu-action]")'), app.indexOf('return false;', app.indexOf('const menuAction = event.target.closest?.("[data-tile-menu-action]")')));
  assert.match(menuAction, /event\.stopPropagation\(\);[\s\S]*?performTileContextAction\(menuAction\);/);
  assert.match(app, /tileContextMenuMarkup\("task", item\.id, item\.title[^\n]*\[\{ key: "delete", label: "Supprimer"/);
  assert.match(app, /async function removeTaskFromList\(id\) \{ return removeTaskById\(id, false\); \}/);
  assert.match(app, /function removeTaskById\(id, closeDialog = false\)[\s\S]*?Supprimer définitivement cette action/);
});

test("Actions : menu contextuel utilisable au clavier et calé dans la fenêtre", () => {
  assert.match(app, /class="tile-context-toggle" type="button" data-tile-menu-toggle aria-haspopup="menu" aria-expanded="false"/);
  assert.match(app, /if \(event\.key === "Escape"\)[\s\S]*?closeTileContextMenu\(true\);/);
  assert.match(app, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(app, /const left = Math\.max\(8, Math\.min\(viewportWidth - bounds\.width - 8, anchor\.right - bounds\.width\)\);/);
  assert.match(css, /\.tile-context-menu \{\s*position: fixed;/);
  assert.match(css, /\.tile-context-toggle \{[\s\S]*?display: grid;[\s\S]*?place-items: center;[\s\S]*?min-width: var\(--control-touch\);[\s\S]*?min-height: var\(--control-touch\);/);
  assert.match(app, /<span class="tile-context-glyph" aria-hidden="true"><span class="tile-context-dot"><\/span><span class="tile-context-dot"><\/span><span class="tile-context-dot"><\/span><\/span>/);
  assert.match(css, /\.tile-context-glyph \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?line-height: 0;/);
  assert.match(css, /\.tile-context-dot \{[\s\S]*?width: 3px;[\s\S]*?height: 3px;[\s\S]*?border-radius: 50%;/);
});

test("Actions : le menu secondaire est distinct du clic principal et la tuile a un focus visible", () => {
  assert.match(app, /document\.addEventListener\("click", async event => \{[\s\S]*?const menuAction = event\.target\.closest\?\.\("\[data-tile-menu-action\]"\);[\s\S]*?event\.stopPropagation\(\);/);
  assert.match(app, /\.tile-context-actions"\)\) \{\s*preparePrimaryTileActivation/);
  assert.match(css, /\.task-row\[tabindex="0"\]:focus-visible \{ outline: 3px solid/);
  assert.match(css, /\.task-actions \{[\s\S]*?justify-self: end;/);
  assert.doesNotMatch(css, /\.task-actions::after/);
});

test("Actions : chaque ligne est une tuile séparée sans séparateur interne", () => {
  assert.match(css, /#tasksList:has\(\.task-row\) \{[\s\S]*?gap: var\(--space-2\);[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(css, /\.task-row \{[\s\S]*?border: var\(--border-subtle\);[\s\S]*?border-radius: var\(--radius-md\);[\s\S]*?box-shadow: none;/);
  assert.doesNotMatch(css, /#tasksList \.task-row \+ \.task-row::before/);
  assert.match(css, /\.task-row\.is-late \{\s*background: color-mix\(in srgb, var\(--color-danger-soft\) 55%, var\(--color-surface\)\);\s*box-shadow: inset 3px 0 var\(--color-danger\);/);
  assert.match(css, /\.task-row\.is-done \{ background: color-mix\(in srgb, var\(--color-brand-soft\) 65%, var\(--color-surface\)\); \}/);
  assert.match(css, /#tasksList \.task-row \.task-actions \{\s*grid-column: 6 \/ 8;/);
});

test("Footer modale Action : deux décisions dans le footer, suppression dans le menu du header", () => {
  const modal = html.slice(html.indexOf('<dialog class="modal-md" id="taskDialog"'), html.indexOf("</dialog>", html.indexOf('<dialog class="modal-md" id="taskDialog"')));
  assert.match(modal, /id="taskMenuBtn"[^>]*aria-haspopup="menu"[^>]*hidden/);
  assert.match(modal, /id="taskActionMenu" role="menu"[^>]*hidden/);
  assert.match(modal, /id="deleteTaskBtn" role="menuitem" hidden/);
  const footer = modal.slice(modal.indexOf('class="modal-actions modal-form-actions"'));
  assert.doesNotMatch(footer, /deleteTaskBtn/);
  assert.match(footer, />Annuler<\/button>[\s\S]*?>Enregistrer<\/button>/);
  assert.match(css, /\.modal-form-actions \.right \.btn \{\s*width: 100%;\s*min-height: var\(--control-touch\);/);
  assert.match(css, /\.modal-form-actions \.right \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});
