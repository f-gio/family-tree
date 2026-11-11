import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/design-system.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const archive = readFileSync(new URL("../js/backup-archive.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const candidateRules = readFileSync(new URL("../FACT_HYPOTHESES_RULES.candidate.rules", import.meta.url), "utf8");
const rulesDoc = readFileSync(new URL("../FACT_HYPOTHESES_RULES.md", import.meta.url), "utf8");

test("les quatre boutons de gestion couvrent date et lieu de naissance et de décès", () => {
  const fields = [...html.matchAll(/data-fact-hypothesis-field="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(fields, ["birth.date", "birth.place", "death.date", "death.place"]);
  /* Correction de visibilité : `hidden` et `data-fact-hypothesis-manage` sont
     portés par le MÊME conteneur (le synchroniseur démasque donc le porteur de
     `hidden`) ; le bouton ne conserve que son champ. */
  const wrappers = html.match(/<div class="fact-hypothesis-manage" data-fact-hypothesis-manage hidden><button class="btn small" type="button" data-fact-hypothesis-field="/g);
  assert.equal(wrappers?.length, 4, "quatre conteneurs masqués portant data-fact-hypothesis-manage");
  assert.doesNotMatch(html, /<button[^>]*data-fact-hypothesis-manage/);
  assert.match(html, /<use href="#icon-git-compare-arrows"><\/use><\/svg><span>Gérer les hypothèses<\/span>/g);
  assert.match(html, /Gérer les hypothèses — Date de naissance/);
  assert.match(html, /Gérer les hypothèses — Lieu de décès/);
});

test("le dialogue d'hypothèses possède son coquille, sa zone de contenu et son icône", () => {
  assert.match(html, /<dialog class="modal-lg modal-mobile-sheet modal-mobile-sheet--form" id="factHypothesesDialog" aria-labelledby="factHypothesesTitle">/);
  assert.match(html, /id="factHypothesesContent"/);
  assert.match(html, /data-close="factHypothesesDialog"/);
  assert.match(html, /<symbol id="icon-git-compare-arrows" viewBox="0 0 24 24">/);
  assert.match(html, /Une seule hypothèse retenue par information/);
});

test("les styles couvrent l'indicateur de frise, les lignes de dialogue et la feuille mobile", () => {
  assert.match(css, /\.timeline-hypothesis-indicator \{/);
  assert.match(css, /\.life-event-hypotheses \{/);
  assert.match(css, /\.fact-hypothesis-row \{/);
  assert.match(css, /\.fact-hypothesis-status\[data-status="retained"\]/);
  assert.match(css, /\.fact-hypothesis-manage \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /dialog#factHypothesesDialog\.modal-mobile-sheet \{/);
  assert.match(css, /dialog#factHypothesesDialog\.modal-mobile-sheet--form \{ max-height: 86dvh; \}/);
  for (const token of ["--color-accent", "--color-danger", "--color-surface-soft", "--border-subtle", "--radius-md", "--text-xs"]) {
    assert.ok(css.includes(`var(${token})`), `token ${token} utilisé par les styles des hypothèses`);
  }
});

test("l'application charge le cache une fois et tolère des règles non publiées", () => {
  assert.match(app, /import \{[^}]*countFactHypothesesForEvent[^}]*\} from "\.\/fact-hypotheses\.js"/);
  assert.match(app, /import \{ createFactHypothesesStore \} from "\.\/fact-hypotheses-store\.js"/);
  assert.match(app, /async function loadFactHypothesesOnce\(\)/);
  assert.match(app, /factHypothesesState = error\?\.code === "permission-denied" \? "denied" : "error"/);
  assert.match(app, /loadFactHypothesesOnce\(\);/);
  assert.match(app, /function resetFactHypothesesCache\(\)/);
  assert.match(app, /resetFactHypothesesCache\(\);/);
  assert.match(app, /button\.hidden = !factHypothesesAvailable\(\)/);
});

test("l'indicateur de frise et le détail de consultation affichent les hypothèses", () => {
  assert.match(app, /timeline-hypothesis-indicator/);
  assert.match(app, /countFactHypothesesForEvent\(hypotheses, event\.type\)/);
  assert.match(app, /timelineItemHtml\(event, \{ interactive: true, hypotheses: itemHypotheses \}\)/);
  assert.match(app, /lifeEventConsultationMarkup\(event, \{ showHypotheses: true \}\)/);
  assert.match(app, /lifeEventConsultationMarkup\(event, \{ compact: true, showHypotheses: true \}\)/);
  assert.match(app, /life-event-hypotheses/);
  assert.match(app, /hypothèse\$\{hypothesisCount > 1 \? "s" : ""\}/);
});

test("le garde-fou bloque l'édition directe d'un champ suivi", () => {
  assert.match(app, /function factHypothesisGuardIssues\(personId, data, existing\)/);
  assert.match(app, /const guardedFields = factHypothesisGuardIssues\(id, data, existing\);/);
  assert.match(app, /ce champ est suivi par des hypothèses/);
  assert.match(app, /l’édition directe est bloquée afin de préserver l’historique/);
  assert.match(app, /Gérer les hypothèses » dans le champ/);
});

test("le dialogue pilote le store avec ancre attendue et justification", () => {
  for (const action of ["new", "cancel-form", "correct", "retain", "reexamine", "reject", "delete", "restore"]) {
    assert.ok(app.includes(`data-fact-hypothesis-action="${action}"`) || app.includes(`action === "${action}"`), `action ${action} câblée`);
  }
  assert.match(app, /if \(status === "rejected"\) actions\.push\(\["retain", "Retenir"\], \["reexamine", "Réexaminer"\], \["delete", "Supprimer"\]\)/);
  assert.match(app, /factHypothesesFormMode = \{ mode: "reexamine", hypothesisId \}/);
  assert.match(app, /factHypothesesStore\.reexamineHypothesis\(\{/);
  assert.match(app, /reexamine: "Réexaminer cette hypothèse"/);
  assert.match(app, /mode\.mode === "reexamine"/);
  assert.match(app, /"Réexaminer"/);
  assert.match(app, /La justification est obligatoire : l’hypothèse redevient une alternative/);
  assert.match(app, /factHypothesesStore\.setRetained\(\{[\s\S]{0,300}expectedAnchor: factHypothesisAnchorOf\(personId, fieldKey\)/);
  assert.match(app, /factHypothesesStore\.deleteHypothesis\(\{[\s\S]{0,200}expectedAnchor/);
  assert.match(app, /factHypothesesStore\.createHypothesis\(\{ personId, fieldKey, value: normalized\.value, justification, actorUid \}\)/);
  assert.match(app, /factHypothesesStore\.correctValue\(/);
  assert.match(app, /applyLocalFactHypothesisPatch\(/);
  assert.match(app, /readGenealogyDateForm\("hypo"\)/);
  assert.match(app, /setGenealogyDateForm\("hypo", hypothesis\.value\)/);
  assert.match(app, /La justification est obligatoire|justification est obligatoire|remplacement échange la retenue actuelle/);
});

test("la sauvegarde capture les deux collections et la prévisualisation détecte les conflits", () => {
  assert.match(app, /if \(factHypothesesAvailable\(\)\) names\.push\("factHypotheses", "factHypothesisRevisions"\)/);
  assert.match(app, /current\.factHypotheses = factHypotheses\.map\(item => item\.id\)/);
  assert.match(app, /detectFactHypothesisConflicts\(\{ peopleRecords: people, hypotheses: factHypotheses \}\)/);
  assert.match(archive, /"factHypotheses", "factHypothesisRevisions"/);
  assert.match(archive, /L'ancre \$\{fieldKey\} de \$\{person\.id\} référence une hypothèse absente/);
  assert.match(archive, /collections\.factHypothesisRevisions \|\| \[\]/);
});

test("la prévisualisation v5 annonce explicitement l'indisponibilité de la restauration", () => {
  /* Message exigé, visible avant toute tentative de restauration. */
  assert.match(app, /Prévisualisation uniquement — La restauration de cette archive n’est pas encore disponible/);
  assert.match(app, /Aucune écriture ne sera exécutée depuis cette interface ; seule la vérification du plan, des conflits et de l’intégrité est proposée/);
  assert.doesNotMatch(app, /L’intégration serveur requise pour les données officielles n’est pas disponible/);
  /* Retour explicite du parcours v5 avant toute écriture. */
  assert.match(app, /showV5RestorePreview\(archive\);[\s\S]{0,400}?return;/);
  assert.match(app, /Prévisualisation uniquement/);
  /* Aucun bouton d'écriture dans la coquille de prévisualisation. */
  const start = html.indexOf('id="restorePreviewDialog"');
  assert.ok(start > 0, "dialogue de prévisualisation présent");
  const region = html.slice(start, html.indexOf("</dialog>", start));
  assert.equal((region.match(/<button/g) || []).length, 1, "seul le bouton Fermer");
  assert.doesNotMatch(region, /Restaurer|Importer|Confirmer|Exécuter/);
  assert.match(region, /Aucune donnée n’a été écrite/);
});

test("les règles du dépôt restent gelées et le bloc candidat est cohérent", () => {
  assert.equal(rules.includes("factHypotheses"), false, "firestore.rules du dépôt non modifié");
  assert.equal(rules.includes("retainedHypothesis"), false, "aucun amendement people dans le dépôt gelé");
  assert.match(rulesDoc, /NON publié/);
  assert.match(rulesDoc, /fact-hypotheses-rules\.mjs/);
  assert.ok(candidateRules.includes("match /factHypotheses/{hypothesisId}"), "collections candidat présentes");
  assert.ok(candidateRules.includes("&& validFactHypothesisAnchorAfter(personId);"), "condition people création");
  assert.ok(candidateRules.includes("&& unanchoredRetainedReleasedAfter()"), "condition people mise à jour");
  assert.equal(candidateRules.includes(".every("), false, "aucune fonction d'ordre supérieur (inexistante dans les rules)");
  assert.ok(candidateRules.indexOf("function validFactHypothesisCreate") < candidateRules.indexOf("match /factHypotheses/{hypothesisId}"), "helpers définis avant usage");
});

test("le dialogue associe les attestations existantes avec les trois rôles", () => {
  assert.match(app, /FACT_HYPOTHESIS_ROLE, FACT_HYPOTHESIS_ROLE_LABELS, FACT_HYPOTHESIS_STATUS_LABELS/);
  assert.match(app, /function factHypothesisAttestationsMarkup\(hypothesis, \{ readOnly = false \} = \{\}\)/);
  assert.match(app, /factHypothesisAttestationsMarkup\(hypothesis, \{ readOnly: status === "deleted" \}\)/);
  assert.match(app, /data-fact-hypothesis-action="toggle-attestations"/);
  assert.match(app, /data-fact-hypothesis-action="attestation-add"/);
  assert.match(app, /data-fact-hypothesis-action="attestation-remove"/);
  assert.match(app, /data-fh-attestation-role="\$\{esc\(entry\.attestationId \|\| ""\)\}"/);
  assert.match(app, /data-fh-attestation-pick/);
  assert.match(app, /data-fh-attestation-new-role/);
  assert.match(app, /attachAttestation\(\{ personId, fieldKey, hypothesisId, attestationId, role, actorUid \}\)/);
  assert.match(app, /attachAttestation\(\{ personId, fieldKey, hypothesisId, attestationId, role: "context", remove: true, actorUid \}\)/);
  assert.match(app, /Attestation introuvable/);
  assert.match(app, /Référence conservée :/);
  assert.match(app, /Aucune attestation sur ce fait : créez-en une depuis la fiche/);
  assert.match(app, /factHypothesesAttestationsOpen = new Set\(\)/);
  assert.match(app, /Rôle de l’attestation mis à jour/);
  const labels = readFileSync(new URL("../js/fact-hypotheses.js", import.meta.url), "utf8");
  assert.match(labels, /supports: "Appuie"/);
  assert.match(labels, /contradicts: "Contredit"/);
  assert.match(labels, /context: "Contexte"/);
});

test("le dialogue ne crée jamais d'attestation et replie la zone par défaut", () => {
  const start = app.indexOf("function factHypothesisAttestationsMarkup");
  const end = app.indexOf("function factHypothesisRowMarkup", start);
  assert.ok(start > 0 && end > start, "fonction d'attestation localisable");
  const body = app.slice(start, end);
  for (const forbidden of ["journeyAttestationAddButtonMarkup", "data-journey-attestation-add", "lifeEventWriteAttestations", "journeyAttestationFormMarkup"]) {
    assert.equal(body.includes(forbidden), false, `aucune création d'attestation depuis le dialogue (${forbidden})`);
  }
  assert.match(body, /if \(!open\) return `<div class="fact-hypothesis-attestation-zone">\$\{toggle\}<\/div>`;/, "zone repliée par défaut");
  assert.match(body, /const readOnly = false|readOnly \? "" :/);
});

test("les styles des attestations restent lisibles et tactiles sur mobile", () => {
  assert.match(css, /\.fact-hypothesis-attestation \{/);
  assert.match(css, /\.fact-hypothesis-attestation\.is-missing \{ border-color: var\(--color-danger\); \}/);
  assert.match(css, /\.fact-hypothesis-role\[data-role="supports"\]/);
  assert.match(css, /\.fact-hypothesis-role\[data-role="contradicts"\]/);
  assert.match(css, /\.fact-hypothesis-attestation-add \{/);
  assert.match(css, /\.fact-hypothesis-attestation-zone \.field \{ max-width: 100%; min-height: var\(--control-touch\); \}/);
  assert.match(css, /\.fact-hypothesis-manage \.btn,\r?\n\s*\.fact-hypothesis-attestation-zone \.btn,\r?\n\s*\.fact-hypothesis-attestation-zone \.field,\r?\n\s*\.fact-hypothesis-actions \.btn,\r?\n\s*\.fact-hypothesis-form-zone \.btn,\r?\n\s*\.fact-hypothesis-form-zone \.field \{ min-height: var\(--control-touch\); \}/);
  assert.match(css, /flex-wrap: wrap/);
});
