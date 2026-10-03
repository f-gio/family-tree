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

function mediaBlockContaining(source, marker, query = "@media (max-width: 760px)") {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Règle absente : ${marker}`);
  const start = source.lastIndexOf(query, markerIndex);
  assert.notEqual(start, -1, `Bloc responsive absent pour : ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Bloc CSS non fermé pour : ${marker}`);
}

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

test("Actions : les lignes réutilisent l'édition et ne s'ouvrent qu'en mobile", () => {
  assert.match(app, /<article class="task-row\$\{late \? " is-late" : ""\}\$\{done \? " is-done" : ""\}" data-task-row="\$\{item\.id\}"/);
  assert.match(app, /function openTaskById\(id\)[\s\S]*?if \(item\) openTask\(item\);/);
  assert.match(app, /taskMobileViewport\.matches && row && !event\.target\.closest\("button, a, input, select, textarea, summary/);
  assert.match(app, /if \(editButton\) \{\s*openTaskById\(editButton\.dataset\.editTask\);/);
  assert.match(app, /if \(!taskMobileViewport\.matches \|\| !row \|\| event\.target !== row \|\| !\["Enter", " "\]\.includes\(event\.key\)\) return;/);
});

test("Actions : × arrête explicitement la propagation avant le code d'ouverture", () => {
  const start = app.indexOf('$("tasksList").onclick = async event => {');
  const edit = app.indexOf("const editButton", start);
  const rowOpen = app.indexOf('const row = event.target.closest(".task-row[data-task-row]")', start);
  assert.ok(start !== -1 && edit > start && rowOpen > edit);
  const deletion = app.slice(start, edit);
  assert.match(deletion, /event\.stopPropagation\(\);[\s\S]*?if \(id && confirm\([\s\S]*?\n\s*return;/);
  assert.match(app, /<button class="btn icon-btn small danger task-delete" type="button" data-delete-task="\$\{item\.id\}" aria-label="Supprimer l’action"/);
});

test("Actions : Ouvrir reste dans le markup desktop et son masquage est mobile uniquement", () => {
  assert.match(app, /<button class="btn small" type="button" data-edit-task="\$\{item\.id\}">Ouvrir<\/button>/);
  const mobile = mediaBlockContaining(css, ".task-actions [data-edit-task]");
  assert.match(mobile, /\.task-actions \[data-edit-task\] \{ visibility: hidden; \}/);
  assert.equal((css.match(/\.task-actions \[data-edit-task\]/g) || []).length, 1);
});

test("Actions mobile : fermeture après tap efface le focus restauré, le clavier le conserve", () => {
  assert.match(app, /const pointerActivated = taskRowPointerActivation \|\| event\.detail > 0;/);
  assert.match(app, /if \(pointerActivated\) \{\s*event\.preventDefault\(\);[\s\S]*?document\.activeElement\.blur\(\);/);
  assert.match(app, /\$\("taskDialog"\)\.addEventListener\("close", \(\) => \{[\s\S]*?if \(row\.isConnected && document\.activeElement === row\) row\.blur\(\);/);
  assert.match(app, /taskDialogPointerReturnFocusRow = null;\s*event\.preventDefault\(\);\s*openTaskById\(row\.dataset\.taskRow\);/);
  assert.match(css, /\.task-row\[tabindex="0"\]:focus-visible \{ outline: 2px solid var\(--color-focus\);/);
});

test("Footer mobile de la modale Action : boutons présents, rangée finale en deux colonnes", () => {
  const modal = html.slice(html.indexOf('<dialog class="modal-md" id="taskDialog"'), html.indexOf("</dialog>", html.indexOf('<dialog class="modal-md" id="taskDialog"')));
  assert.match(modal, /id="deleteTaskBtn"[^>]*hidden/);
  assert.match(modal, />Annuler<\/button>/);
  assert.match(modal, />Enregistrer<\/button>/);
  const mobile = mediaBlockContaining(css, "#taskDialog .modal-actions");
  assert.match(mobile, /#taskDialog \.modal-actions \{\s*display: grid;/);
  assert.match(mobile, /#taskDialog \.modal-actions > #deleteTaskBtn \{\s*grid-column: 1 \/ -1;[\s\S]*?min-height: var\(--control-touch\);/);
  assert.match(mobile, /#taskDialog \.modal-actions > \.right \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(mobile, /#taskDialog \.modal-actions \.right \.btn \{[\s\S]*?min-height: var\(--control-touch\);/);
});
