import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "css", "design-system.css"), "utf8");
const formUi = readFileSync(join(root, "js", "form-ui.js"), "utf8");

for (const token of ["--modal-sm", "--modal-md", "--modal-lg", "--modal-xl", "--modal-max-height"]) {
  assert.ok(css.includes(token), `Token modal absent : ${token}`);
}

for (const rule of [
  "dialog[open]",
  ".modal-scroll",
  ".person-section-panel",
  ".modal-actions",
  ".form-section-heading",
  '.field[aria-invalid="true"]',
  ".field-error",
]) assert.ok(css.includes(rule), `Règle absente : ${rule}`);

assert.match(html, /class="person-dialog modal-xl"/);
assert.match(html, /class="modal-body person-modal-form" id="personForm"/);
assert.equal((html.match(/class="modal-body modal-form"/g) || []).length, 3);
assert.equal((html.match(/class="person-section-panel"/g) || []).length, 3);

for (const heading of [
  "Identification",
  "Source du document",
  "Association et notes",
  "Organisation",
  "Détails du suivi",
]) assert.ok(html.includes(`<h4>${heading}</h4>`), `Section absente : ${heading}`);

for (const redundantHeading of ["Événements de vie", "Informations complémentaires"]) {
  assert.ok(!html.includes(`<h4>${redundantHeading}</h4>`), `Titre redondant présent : ${redundantHeading}`);
}

assert.match(html, /id="endDetailsFields" hidden/);
assert.ok((html.match(/data-date-panel="[^"]+" hidden/g) || []).length >= 10);
assert.doesNotMatch(html, /data-date-panel="(?:birth|death)-unknown"/);
assert.match(html, /src="\.\/js\/form-ui\.js"/);

for (const behavior of [
  "showFieldError",
  "clearFieldError",
  "validateGenealogyDate",
  "documentForm",
  "signupForm",
  'setAttribute("aria-invalid"',
  'setAttribute("aria-describedby"',
]) assert.ok(formUi.includes(behavior), `Validation absente : ${behavior}`);

console.log("Modales et formulaires sections 8–16 : OK");
