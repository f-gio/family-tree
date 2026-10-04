// Tests de la section « Démarches » : module pur, markup HTML, CSS et glue app.js.
// Exécution : node --test tests/procedures.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PROCEDURE_TYPES,
  PROCEDURE_STATUSES,
  PROCEDURE_ACTION_TYPES,
  ACTION_DIRECTIONS,
  procedureTypeLabel,
  procedureStatusLabel,
  procedureActionTypeLabel,
  actionDirectionLabel,
  isProcedureClosed,
  DOSSIER_MIN_QUERY_LENGTH,
  procedureSearchText,
  filterAndSortProcedures,
  sortProcedureActions
} from "../js/procedures.js";

const root = new URL("..", import.meta.url);
const [html, css, app, multiselect] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("js/person-multiselect.js", root), "utf8")
]);

// --- Types, statuts et actions (source unique centralisée) ---

test("les types de démarche couvrent les 8 valeurs du cahier des charges", () => {
  assert.deepEqual(Object.values(PROCEDURE_TYPES), [
    "Recherche généalogique", "Correspondance", "Rendez-vous", "Démarche administrative",
    "Consultation d’archives", "Appel", "Recherche en ligne", "Autre"
  ]);
});

test("les statuts couvrent les 7 valeurs du cahier des charges", () => {
  assert.deepEqual(Object.values(PROCEDURE_STATUSES), [
    "À préparer", "En cours", "En attente", "Réponse reçue", "Rendez-vous prévu", "Terminé", "Abandonné"
  ]);
});

test("les 12 types d’action de la chronologie sont définis", () => {
  assert.equal(Object.keys(PROCEDURE_ACTION_TYPES).length, 12);
  assert.deepEqual(Object.values(PROCEDURE_ACTION_TYPES), [
    "Email envoyé", "Email reçu", "Rendez-vous demandé", "Rendez-vous confirmé", "Appel",
    "Visite d’archives", "Consultation de registre", "Recherche en ligne", "Note",
    "Document envoyé", "Document reçu", "Autre"
  ]);
});

test("le sens envoyé/reçu est centralisé", () => {
  assert.deepEqual(Object.values(ACTION_DIRECTIONS), ["Non pertinent", "Envoyé", "Reçu"]);
  assert.equal(actionDirectionLabel("sent"), "Envoyé");
  assert.equal(actionDirectionLabel("inconnu"), "Non pertinent");
});

test("les définitions ne sont pas dupliquées entre index.html et le module", () => {
  // Le module est l'unique source : le formulaire et les filtres HTML listent les mêmes valeurs.
  assert.equal((html.match(/Recherche gén/g) || []).length, 2); // filtre de liste + formulaire
  assert.ok(html.includes('id="dossierTypeFilter"'));
  assert.ok(html.includes('id="dossierStatusFilter"'));
});

test("les helpers de label tolèrent une valeur inconnue", () => {
  assert.equal(procedureTypeLabel("inconnu"), "Autre");
  assert.equal(procedureStatusLabel("inconnu"), "À préparer");
  assert.equal(procedureActionTypeLabel("inconnu"), "Autre");
});

test("les statuts terminés et abandonnés sont reconnus comme clos", () => {
  assert.equal(isProcedureClosed("done"), true);
  assert.equal(isProcedureClosed("abandoned"), true);
  assert.equal(isProcedureClosed("progress"), false);
  assert.equal(isProcedureClosed(""), false);
});

// --- Recherche et tri ---

test("procedureSearchText inclut titre, organisme, contact et personnes liées", () => {
  const text = procedureSearchText({
    title: "Acte de décès de Rosa Conti",
    organization: "Commune de Turin",
    personIds: ["p1"]
  }, id => id === "p1" ? "Rosa Conti" : id);
  assert.ok(text.includes("rosa conti"));
  assert.ok(text.includes("commune de turin"));
});

test("la recherche est insensible aux accents", () => {
  // « à Turin » est trouvé en saisissant « a turin » (pas de correspondance mot à mot : sous-chaîne).
  const items = [{ title: "Demande d’acte à Turin", updatedAtSort: 5 }];
  assert.equal(filterAndSortProcedures(items, {}, "a turin").length, 1);
  assert.equal(filterAndSortProcedures(items, {}, "acte").length, 1);
  assert.equal(filterAndSortProcedures(items, {}, "Milan").length, 0);
});

test("les dossiers ouverts précèdent les dossiers terminés ou abandonnés", () => {
  const result = filterAndSortProcedures([
    { title: "Ancien dossier", status: "done", updatedAtSort: 100 },
    { title: "Nouvelle demande", status: "prepare", updatedAtSort: 1 },
    { title: "Piste abandonnée", status: "abandoned", updatedAtSort: 99 }
  ]);
  // Ouverts d'abord ; dans le groupe fermé, tri par mise à jour décroissante (100 puis 99).
  assert.deepEqual(result.map(item => item.title), ["Nouvelle demande", "Ancien dossier", "Piste abandonnée"]);
});

test("le filtre type/statut combiné à la recherche fonctionne", () => {
  const items = [
    { title: "Codice fiscale", type: "administrative", status: "progress", updatedAtSort: 10 },
    { title: "Registre militaire", type: "research", status: "progress", updatedAtSort: 12 },
    { title: "Rendez-vous archives", type: "archive", status: "appointment", updatedAtSort: 11 }
  ];
  assert.deepEqual(filterAndSortProcedures(items, { type: "research", status: "progress" }, "").map(item => item.title), ["Registre militaire"]);
  assert.deepEqual(filterAndSortProcedures(items, { type: "administrative" }, "codice").map(item => item.title), ["Codice fiscale"]);
});

test("la chronologie est triée par date puis création puis titre", () => {
  const result = sortProcedureActions([
    { title: "B", date: "2026-03-01", createdAtSort: 1 },
    { title: "A", date: "2026-03-01", createdAtSort: 0 },
    { title: "Sans date", createdAtSort: 99 },
    { title: "Premier", date: "2026-02-01", createdAtSort: 50 }
  ]);
  assert.deepEqual(result.map(item => item.title), ["Premier", "A", "B", "Sans date"]);
});

test("le tri chronologique ne mutme pas la liste d'entrée", () => {
  const actions = [{ title: "B", date: "2026-01-01" }, { title: "A", date: "2026-01-02" }];
  const copy = [...actions];
  sortProcedureActions(actions);
  assert.deepEqual(actions, copy);
});

// --- Navigation et vues ---

test("l'entrée de navigation Démarches existe avec l'état aria", () => {
  assert.match(html, /<button class="nav-btn" type="button" data-view="dossiers" aria-pressed="false"><span class="nav-icon" aria-hidden="true"><svg class="ui-icon"><use href="#icon-procedures"><\/use><\/svg><\/span><span>Démarches<\/span><\/button>/);
});

test("le mode mobile comporte cinq colonnes de navigation", () => {
  assert.match(html, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(html, /\.nav-btn\{min-width:0;min-height:44px/);
});

test("la vue Démarches possède une structure complète", () => {
  assert.ok(html.includes('id="dossiersView"'));
  assert.ok(html.includes('<h2 class="page-title">Démarches</h2>'));
  assert.match(html, /<h2 class="page-title">Démarches<\/h2>\s*<p>Centralisez vos recherches/);
  assert.match(html, /id="addDossierBtn"[^>]*>￼?/);
  assert.ok(html.includes('<span>Nouvelle démarche</span></button>'));
  assert.match(html, /id="dossierSearch"[^>]*type="text"/, "recherche sans type=native-search");
  assert.ok(html.includes('id="clearDossierSearchBtn"'));
  assert.ok(html.includes('id="proceduresList"'));
});

test("l'icône sprite Démarches existe", () => {
  assert.ok(html.includes('<symbol id="icon-procedures"'));
});

// --- Formulaire dossier ---

test("le formulaire dossier couvre les sections demandées", () => {
  assert.ok(html.includes("Objet de la démarche"));
  assert.ok(html.includes("Organisme et contact"));
  assert.ok(html.includes("Personnes éventuellement liées"));
  assert.match(html, /<h4>Suivi<\/h4>/);
  assert.ok(html.includes(">Notes<"));
  assert.ok(html.includes(">Résultat ou conclusion<"));
  assert.match(html, /id="dossierTitle" required/);
  assert.match(html, /id="dossierForm"/);
  assert.match(html, /id="deleteDossierBtn" hidden/);
  const openDossierForm = app.slice(app.indexOf("function openDossierForm("), app.indexOf("\n}", app.indexOf("function openDossierForm(")) + 2);
  assert.match(openDossierForm, /\$\("deleteDossierBtn"\)\.hidden = true;/);
  assert.doesNotMatch(html.slice(html.indexOf('<dialog class="modal-dossier"'), html.indexOf("</dialog>", html.indexOf('<dialog class="modal-dossier"'))), /id="dossierMenuBtn"/);
});

test("la sélection des personnes est une recherche multisélection accessible", () => {
  // Plus aucune case à cocher : un composant de recherche avec chips.
  assert.match(html, /id="dossierPeopleList" data-multiselect-people/);
  assert.match(html, /id="dossierPeopleInput" type="text" role="combobox" aria-expanded="false" aria-controls="dossierPeopleResults" aria-autocomplete="list"/);
  assert.match(html, /id="dossierPeopleResults" role="listbox" aria-label="Personnes correspondant à la recherche" hidden/);
  assert.ok(!html.includes('type="checkbox" value="'), "plus de cases à cocher de personnes dans la modale");
  assert.ok(!css.includes(".dossier-people"), "l'ancienne interface à cases à cocher a été retirée du CSS");
  assert.match(app, /const dossierPeoplePicker = createAppPersonPicker\("dossier"\);/);
  assert.match(app, /data\.personIds = dossierPeoplePicker\.getSelected\(\);/);
});

test("la recherche de personnes porte sur prénom, second prénom, nom, nom d'usage et branche", () => {
  assert.match(app, /searchable\(`\$\{item\.firstName\} \$\{item\.middleName \|\| ""\} \$\{item\.lastName\} \$\{item\.marriedName \|\| ""\} \$\{item\.branch \|\| ""\}`\)/);
  assert.match(app, /const PERSON_PICKER_MAX_RESULTS = 8;/);
  assert.match(app, /source\(\)[\s\S]*?selectedIds\.has\(item\.id\)/);
});

test("la recherche ne démarre qu'à partir de 2 caractères (0/1 = rien)", () => {
  assert.match(app, /import \{[^}]*DOSSIER_MIN_QUERY_LENGTH[^}]*\} from "\.\/procedures\.js"/);
  assert.match(app, /if \(text\.length < DOSSIER_MIN_QUERY_LENGTH\) return \[\];/);
  assert.match(app, /minQueryLength: DOSSIER_MIN_QUERY_LENGTH/);
  assert.match(multiselect, /String\(input\.value\)\.trim\(\)\.length < minQueryLength/);
  assert.equal(DOSSIER_MIN_QUERY_LENGTH, 2);
});

test("la fermeture passe bien par aria-expanded=false", () => {
  assert.match(multiselect, /function closeResults\(\) \{[\s\S]*?renderResults\(\);/);
  assert.match(multiselect, /results\.hidden = true;\s*input\.setAttribute\("aria-expanded", "false"\);/);
});

test("les résultats proposent un contexte dates et branche", () => {
  assert.match(app, /function personSuggestionLabel\(item\)/);
  assert.match(app, /Branche \$\{item\.branch\}/);
  assert.match(app, /function personYears\(item\)/);
});

test("les personnes déjà sélectionnées ne sont plus proposées et pas de doublon", () => {
  assert.match(app, /filter\(item => !selectedIds\.has\(item\.id\)\)/);
  assert.match(multiselect, /if \(!id \|\| selectedIds\.has\(id\)\) return;/);
});

test("les personnes non résolues restent visibles dans les chips sans crash", () => {
  assert.match(app, /dossierPeoplePicker\.setSelected\(item\?\.personIds \|\| \[\]\);/);
  assert.match(multiselect, /selectedIds = new Set\(ids\);/);
  assert.ok(!app.includes("people.some(personEntry => personEntry.id === value)"));
});

test("clavier multiselect : flèches, Entrée et Échap", () => {
  assert.match(multiselect, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(multiselect, /activate\(event\.key === "ArrowDown" \? 1 : -1\)/);
  assert.match(multiselect, /if \(event\.key === "Enter" && matches\.length\)[\s\S]*?add\(matches\[highlightedIndex\]\?\.id\)/);
  assert.match(multiselect, /event\.key === "Escape" && !results\.hidden/);
});

test("la restauration à l'édition recharge la sélection existante", () => {
  assert.match(app, /dossierPeoplePicker\.setSelected\(item\?\.personIds \|\| \[\]\);/);
  assert.match(multiselect, /renderChips\(\);\s*input\.value = "";\s*closeResults\(\);/);
});

// --- Actions email (formulaire conditionnel) ---

test("les champs email spécifiques existent et sont conditionnels", () => {
  assert.ok(html.includes('id="procedureActionEmailGroup" hidden'));
  assert.ok(html.includes('id="procedureActionEmailFrom"'));
  assert.ok(html.includes('id="procedureActionEmailTo"'));
  assert.ok(html.includes('id="procedureActionEmailSubject"'));
  assert.ok(html.includes('id="procedureActionEmailFull"'));
  assert.ok(html.includes('id="procedureActionTimeGroup" hidden'));
  assert.match(app, /function syncProcedureActionEmailFields\(\)/);
  assert.match(app, /"procedureActionType"\)\.addEventListener\("change", syncProcedureActionEmailFields\)/);
});

test("préremplissage email sans écraser une valeur existante", () => {
  assert.match(app, /if \(!\$\("procedureActionEmailFrom"\)\.value\.trim\(\)\) \$\("procedureActionEmailFrom"\)\.value = defaults\.from \|\| "";/);
  assert.match(app, /if \(!\$\("procedureActionEmailTo"\)\.value\.trim\(\)\) \$\("procedureActionEmailTo"\)\.value = defaults\.to \|\| "";/);
});

test("emails : Sens masqué et direction implicite envoyé/reçu", () => {
  // le champ Sens disparaît (label masqué), jamais « none » pour un email
  assert.match(app, /\$\("procedureActionDirection"\)\.closest\("label"\)\?\.toggleAttribute\("hidden", emailMode\);/);
  assert.match(app, /\$\("procedureActionDirection"\)\.value = type === "email-sent" \? "sent" : "received";/);
  assert.match(app, /data\.direction = data\.type === "email-sent" \? "sent" : "received";/);
});

test("emails : Titre générique masqué, Objet reste dans emailSubject", () => {
  assert.match(app, /\$\("procedureActionTitleField"\)\.closest\("label"\)\?\.toggleAttribute\("hidden", emailMode\);/);
  assert.ok(html.includes('id="procedureActionEmailSubject"')); // Objet conservé
  // le champ générique existe toujours dans le modèle (aucune suppression)
  assert.ok(html.includes('id="procedureActionTitleField"'));
});

test("emails : libellé « Notes / résumé », stockage inchangé dans text", () => {
  assert.match(app, /textLabel\.firstChild\.nodeValue = emailMode \? "Notes \/ résumé" : "Résumé ou texte";/);
  assert.ok(html.includes('id="procedureActionText"')); // champ générique inchangé
  // pas de nouveau champ Firestore pour le résumé email
  assert.ok(!html.includes('id="procedureActionEmailSummary"'));
});

test("desktop : la zone scrollable laisse l’Auteur entièrement visible au-dessus du footer", () => {
  assert.match(css, /#procedureActionDialog \.modal-scroll \{\s*\n\s*padding-bottom: var\(--space-12\);\s*\n\s*overflow-x: clip;\s*\n\s*\}/);
});

test("les champs email sont facultatifs et additifs, jamais obligatoires", () => {
  assert.ok(!html.includes('id="procedureActionEmailSubject" required'));
  assert.ok(!html.includes('id="procedureActionEmailFull" required'));
  assert.ok(!app.includes("emailSubject:") || /data\.emailSubject = \$\("procedureActionEmailSubject"\)\.value\.trim\(\);/.test(app));
});

test("les pièces jointes restent hors périmètre", () => {
  assert.ok(!html.includes("procedureActionEmailAttachment"));
  assert.ok(!app.includes("procedureAttachment"));
  assert.ok(!app.includes("documentChunks, \"procedure"));
});

// --- Chronologie émail ---

test("le contenu complet est replié par défaut avec bascule sûre (texte, jamais HTML brut)", () => {
  assert.match(app, /data-toggle-email-action="\$\{action\.id\}" aria-expanded="false"/);
  assert.match(app, /data-email-full-block="\$\{action\.id\}" hidden/);
  assert.match(app, /function safeMultiline\(value = ""\) \{[\s\S]*?return esc\(value\);/s);
  assert.ok(app.includes("safeMultiline(action.emailFull)"), "contenu email toujours rendu via safeMultiline (esc + pre-line)");
  assert.match(css, /\.procedure-action-email-full \{[\s\S]*?white-space: pre-line;/);
});

test("deux emails = deux actions distinctes ; l'ordre reste celui de la chronologie", () => {
  assert.match(app, /isEmailAction\(action\.type\)/);
  assert.match(app, /sortProcedureActions\(snapshot\.docs\.map/);
});

// --- Legacy ---

test("une action ancienne sans champs email reste lisible", () => {
  assert.match(app, /isEmailAction\(action\.type\) && action\.emailFull/);
  assert.match(app, /isEmailAction\(action\.type\) \? action\.time : ""/);
  assert.match(app, /isEmailAction\(action\.type\) && action\.emailSubject/);
});

test("l'enregistrement écriv updatedAt, updatedBy et updatedByName", () => {
  assert.match(app, /data\.updatedAt = serverTimestamp\(\);/);
  assert.match(app, /data\.updatedBy = auth\.currentUser\?\.uid \|\| "";/);
  assert.match(app, /data\.updatedByName = currentUserProfile\?\.displayName \|\| "";/);
  assert.match(app, /createdAt: serverTimestamp\(\), createdBy:/);
});

// --- Vue détaillée et chronologie ---

test("la vue détaillée présente titre, suivi, chronologie et bouton d'action", () => {
  assert.ok(html.includes('id="procedureDetailDialog"'));
  assert.ok(html.includes('id="procedureTimeline"'));
  assert.ok(html.includes('<span>Ajouter une action</span>'));
  assert.ok(html.includes('id="procedureActionForm"'));
  assert.ok(html.includes('id="deleteProcedureActionBtn" role="menuitem" hidden'));
  assert.ok(html.includes('id="procedureActionDirection"'));
  assert.ok(html.includes('id="procedureActionAuthor"'));
  assert.match(html, /id="procedureActionMenuBtn"[^>]*hidden/);
  assert.match(html, /id="procedureActionMenu" role="menu"[^>]*hidden[\s\S]*?id="deleteProcedureActionBtn" role="menuitem" hidden/);
  const footer = html.slice(html.indexOf('class="modal-actions modal-form-actions"', html.indexOf('id="procedureActionForm"')), html.indexOf("</form>", html.indexOf('id="procedureActionForm"')));
  assert.doesNotMatch(footer, /deleteProcedureActionBtn/);
});

test("la suppression d’une action de chronologie ne cible que son document feuille", () => {
  const remove = app.slice(app.indexOf("async function removeProcedureAction("), app.indexOf("\n}", app.indexOf("async function removeProcedureAction(")) + 2);
  assert.match(remove, /deleteDoc\(doc\(db, "procedures", activeDossierId, "actions", id\)\)/);
  assert.doesNotMatch(remove, /deleteCollection|recursiveDelete|deleteDoc\(doc\(db, "procedures", activeDossierId\)/);
});

test("aucun sujet de démarche n'est intrusif dans la modale Personne publiée", () => {
  // La modale Personne ne doit pas être modifiée dans cette exécution.
  assert.match(html, /<h3 id="dialogTitle">Nouvelle personne<\/h3>/);
  assert.ok(!html.includes("Démarches liées"));
});

// --- GLue app.js ---

test("la collection procedures et sa sous-collection actions sont adressées", () => {
  assert.match(app, /procedures: collection\(db, "procedures"\)/);
  assert.match(app, /collection\(db, "procedures", id, "actions"\)/);
  assert.match(app, /collection\(db, "procedures", activeDossierId, "actions"\)/);
});

test("setView, l'abonnement et les états de surface incluent les dossiers", () => {
  assert.match(app, /\$\("dossiersView"\)\.hidden = view !== "dossiers";/);
  assert.match(app, /if \(loadedProcedures\) \{/);
  assert.match(app, /"tasksList", "proceduresList"\]\.forEach\(id => setLoadingSurface\(id, true\)\)/);
  assert.match(app, /setLoadingSurface\("proceduresList", false\)/);
});

test("la suppression d'un dossier demande une confirmation explicite", () => {
  assert.match(app, /Supprimer définitivement cette démarche \? Sa chronologie/);
  assert.match(app, /Supprimer définitivement cette action \?/);
});

test("la vue n'impose aucun placeholder personne factice", () => {
  assert.ok(!app.includes("Aucune personne</h4>"));
  assert.match(app, /persons\.length \? procedureDetailBlock\("Personnes/);
});

// --- Design System ---

test("le CSS Démarches utilise les tokens existants et une largeur bornée pour la modale", () => {
  assert.ok(css.includes(".procedures-list {"));
  assert.ok(css.includes(".procedure-item {"));
  assert.ok(css.includes(".procedure-action-item"));
  assert.ok(css.includes(".person-multiselect {"));
  assert.ok(css.includes(".person-multiselect-chip-remove"));
  assert.match(css, /dialog\.modal-dossier \{ width: min\(1040px, calc\(100vw - 48px\)\); max-width: 1040px; \}/);
  assert.match(css, /\.procedure-action-email-full \{[\s\S]*?white-space: pre-line;/);
  assert.ok(!css.includes(".dossier-people {"), "l'ancienne interface à cases à cocher n'a pas de style résiduel");
});

// --- Refonte hiérarchie de la vue détaillée (déployée avec les Démarches) ---

test("header du dossier : badges type/statut au 1er niveau, métadonnée au 2e", () => {
  assert.ok(html.includes('id="procedureDetailBadges"'));
  assert.match(app, /\$\("procedureDetailBadges"\)\.innerHTML = `<span class="procedure-tag">/);
  assert.match(app, /procedure-tag procedure-status\$\{isProcedureClosed\(item\.status\) \? " is-closed" : ""\}/);
  assert.match(app, /\$\("procedureDetailMeta"\)\.innerHTML = formatPersonModInfo\(item\) \? `Dernière modification : \$\{formatPersonModInfo\(item\)\}` : "";/);
  assert.ok(!app.includes("procedureTypeLabel(item.type))} · "), "plus de phrase unique type·statut·date dans le header");
});

test("informations du dossier : aucun bloc vide, aucune ligne factice", () => {
  assert.match(app, /\.filter\(\(\[, value\]\) => value\)/);
  assert.match(app, /persons\.length \? procedureDetailBlock\("/);
  assert.ok(!app.includes("Organisme: \"—\""));
  assert.match(css, /\.procedure-detail:empty \{ display: none; \}/);
});

test("carte action : stamp date·heure, type, correspondant pertinent", () => {
  assert.match(app, /function actionStamp\(date, time\)/);
  assert.match(app, /dateLabel = date \? formatShortDate\(date\) : "Sans date"/);
  assert.match(app, /return time \? `\$\{dateLabel\} · \$\{esc\(time\)\}` : dateLabel/);
  assert.match(app, /function actionCorrespondent\(action\)/);
  assert.match(app, /`À : \$\{action\.emailTo\}`/);
  assert.match(app, /`De : \$\{action\.emailFrom\}`/);
});

test("carte email : objet = titre principal, direction non affichée (stockée)", () => {
  assert.match(app, /isEmailAction\(action\.type\) && action\.emailSubject/);
  assert.ok(app.includes('<h5 class="procedure-action-title">'));
  assert.ok(!app.includes("procedure-action-direction"), "direction plus rendue (redondante)");
  assert.ok(!app.includes("procedure-action-email-subject"), "plus de ligne « Objet : » ; l'objet devient le titre");
});

test("carte : auteur discret, Modifier/Supprimer dans la carte", () => {
  assert.match(app, /Ajouté par \$\{esc\(action\.author\)\}/);
  assert.match(app, /data-edit-procedure-action="\$\{action\.id\}"/);
  assert.match(app, /data-remove-procedure-action="\$\{action\.id\}"/);
  assert.match(css, /\.procedure-action-tools \{[^}]*justify-self: end;/);
  // le footer global reste réservé au dossier
  assert.ok(html.includes('id="editDossierBtn"'));
  assert.ok(html.includes("Fermer</button>"));
});
