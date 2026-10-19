import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator, collection, addDoc, updateDoc, deleteDoc, deleteField, doc, getDoc, getDocFromServer, getDocs, getDocsFromServer, query, where, setDoc, onSnapshot, serverTimestamp, writeBatch, runTransaction, Bytes } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { calculateTreeLayout } from "./tree-layout.js";
import { calculateTreeLayout as calculateHybridTreeLayout, validateLayout as validateHybridLayout } from "./tree-layout-engine.js";
import { createTreeRenderer } from "./tree-renderer.js";
import { treeExportRasterDimensions, treeExportSvg } from "./tree-export.js";
import { captureTreeExportCards } from "./tree-export-cards.js";
import { lifeTimelineEvents } from "./life-timeline.js";
import { createTreeCamera } from "./tree-camera.js";
import { computeBranchView, DEFAULT_ANCESTOR_DEPTH, ALL_ANCESTORS } from "./tree-branch-view.js";
import { computeLineageScope, normalizeLineageName } from "./family-lineage.js";
import { MAIN_TREE_ID, UNASSIGNED_TREE_STATE, UNASSIGNED_TREE_CHOICE, TREE_LIFECYCLE_ACTIVE, TREE_LIFECYCLE_DELETING, MAX_MULTI_TREE_TRANSFER_PEOPLE, MAX_MULTI_TREE_TRANSFER_READS, getTreeLifecycleState, getTreeDeletionMemberReport, getPersonTreeId, getPersonTreeMembership, getTreePeople, getTreeFamilies, isValidTreeId, familyPersonIds, prepareIndividualTreeTransferPlan, prepareMultipleTreeTransferPlan } from "./tree-model.js";
import { documentDisplayLabel } from "./document-utils.js";
import { directoryPersonName, formatDirectoryDate } from "./directory-utils.js";
import { filterAndSortDirectory, countActiveDirectoryFilters, directoryTreeLabel, DIRECTORY_UNASSIGNED_TREE_FILTER } from "./directory-advanced.js";
import { filterAndSortProcedures, sortProcedureActions, procedureTypeLabel, procedureStatusLabel, procedureActionTypeLabel, isProcedureClosed, DOSSIER_MIN_QUERY_LENGTH } from "./procedures.js";
import { normalizeGenealogyDate, formatGenealogyDate, genealogyDateSearchText, genealogyDateYears } from "./genealogy-date.js";
import { RELATION_TYPE_LABELS, END_TYPE_LABELS, FILIATION_TYPE_LABELS, normalizeRelationType, normalizeEndType, normalizeFiliationType, normalizedParentChildLinks, parentChildLinkType } from "./family-relations.js";
import { icon, emptyState, setButtonPending, withButtonPending } from "./ui-components.js";
import { createLocationAutocomplete, geoNamesEndpointFromDocument, geoNamesUsernameFromDocument } from "./location-autocomplete.js";
import { formatCompactPlace } from "./place-format.js";
import { createPersonMultiSelect } from "./person-multiselect.js";
import { analyzeTreeQuality } from "./tree-quality.js";
import { FILE_CHUNK_BYTES, MAX_FILE_BYTES, formatBytes, base64ToBytes, importedDataFields, importedTreeData, validateFamilyDataset, validateTreeDataset, documentChunkId, splitBytesIntoChunks, concatByteArrays, collectChunkParts, sliceIntoBatches, parseBackupManifestText } from "./backup-utils.js";
import { firebaseConfigurationMatchesEnvironment, resolveFirebaseEnvironment, environmentFeatureFlags } from "./firebase-environment.js";
import { TRANSFER_DIAGNOSTIC_STAGES, resolveTransferDiagnosticEnabled, buildTransferDiagnosticReport } from "./transfer-diagnostic.js";
import { createGenealogyCollaborationStore } from "./genealogy-collaboration-firestore.js";
import { createGenealogyProof, validateGenealogyProof } from "./genealogy-proofs.js";
import { createConclusionRevision, createConclusionHead } from "./fact-conclusions.js";
import { createSourceDocument } from "./source-document-model.js";
import { createPageTextRevision } from "./document-transcription.js";
import { BACKUP_ARCHIVE_VERSION, createBackupArchiveManifest, compareBackupCaptureMarkers, generateBackupZip, readBackupZip, prepareBackupRestorePlan } from "./backup-archive.js";

const firebaseEnvironment = resolveFirebaseEnvironment(window.location);
if (!firebaseEnvironment.allowed || !firebaseConfigurationMatchesEnvironment(firebaseEnvironment.environment, firebaseEnvironment.firebaseConfig)) {
  const authScreen = document.getElementById("authScreen");
  if (authScreen) {
    authScreen.hidden = false;
    authScreen.replaceChildren();
    const message = document.createElement("section");
    message.className = "auth-card firebase-environment-error";
    message.setAttribute("role", "alert");
    const title = document.createElement("h2");
    title.textContent = "Environnement Firebase non autorisé";
    const detail = document.createElement("p");
    detail.textContent = "Cette adresse n’est pas configurée pour accéder à Firebase. Aucune connexion n’a été ouverte.";
    message.append(title, detail);
    authScreen.append(message);
  }
  throw new Error(`Initialisation Firebase refusée : ${firebaseEnvironment.reason || "configuration invalide"}`);
}

document.documentElement.dataset.firebaseEnvironment = firebaseEnvironment.environment;
const featureFlags = environmentFeatureFlags(firebaseEnvironment.environment);
if (!featureFlags.showProcedures) {
  document.documentElement.classList.add("procedures-hidden");
  document.querySelectorAll('[data-view="dossiers"]').forEach(button => {
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
  });
}
const environmentBadgeAuth = document.getElementById("environmentBadgeAuth");
const environmentBadgeApp = document.getElementById("environmentBadgeApp");
if (firebaseEnvironment.environment === "recette") {
  if (environmentBadgeAuth) environmentBadgeAuth.hidden = false;
  if (environmentBadgeApp) environmentBadgeApp.hidden = false;
}

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseEnvironment.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
if (firebaseEnvironment.environment === "local") {
  connectAuthEmulator(auth, `http://${firebaseEnvironment.emulators.auth.host}:${firebaseEnvironment.emulators.auth.port}`, { disableWarnings: true });
  connectFirestoreEmulator(db, firebaseEnvironment.emulators.firestore.host, firebaseEnvironment.emulators.firestore.port);
}
const refs = {
  people: collection(db, "people"),
  families: collection(db, "families"),
  documents: collection(db, "documents"),
  tasks: collection(db, "tasks"),
  users: collection(db, "users"),
  trees: collection(db, "trees"),
  procedures: collection(db, "procedures"),
  sourceDocuments: collection(db, "sourceDocuments"),
  sourceRevisions: collection(db, "sourceRevisions"),
  transcriptionHeads: collection(db, "transcriptionHeads"),
  transcriptionRevisions: collection(db, "transcriptionRevisions"),
  genealogyProofs: collection(db, "genealogyProofs"),
  genealogyProofRevisions: collection(db, "genealogyProofRevisions"),
  factConclusions: collection(db, "factConclusions"),
  conclusionRevisions: collection(db, "conclusionRevisions"),
  genealogyProposals: collection(db, "genealogyProposals"),
  genealogyEvents: collection(db, "genealogyEvents"),
  genealogyNotifications: collection(db, "genealogyNotifications")
};
const genealogyStore = createGenealogyCollaborationStore(db, { doc, runTransaction, serverTimestamp });

let people = [], families = [], documents = [], tasks = [];
let procedures = [];
let genealogyRecords = {
  sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
  genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [],
  genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
};
let genealogyLoaded = false;
let genealogyCollectionErrors = new Set();
let treeMetadata = [];
let activeTreeId = MAIN_TREE_ID;
let treeCatalogState = "idle";
let treeCatalogMessage = "";
let invalidTreeMetadataCount = 0;
const treeDeletionInProgress = new Set();
const treeRecoveryInProgress = new Set();
let activeId = null, currentLayout = null, automaticPositions = new Map();
let personDialogSource = "tree";
let personCreationTreeId = MAIN_TREE_ID;
let pendingPersonCreateId = "";
let personFormSaving = false;
let personTreeTransferState = null;
let personTreeTransferSaving = false;
let multipleTreeTransferState = null;
let multipleTreeTransferSaving = false;
let cameraPositioned = false, focusAfterRender = null;
let branchView = null;
let lineageSurname = "";
let currentScope = null;
let loadedPeople = false, loadedFamilies = false, loadedDocuments = false, loadedTasks = false;
let loadedProcedures = false;
let activeDossierId = "";
let procedureActionUnsub = null;
let procedureActionsCache = [];
let unsubs = [];
let profileUnsub = null, adminUsersUnsub = null, activeDataUid = "";
let currentUserProfile = null, primaryAdminUid = "", adminUsersCache = [], currentProfilePhoto = "";
let manualOffsets = readOffsets();
let treeLayoutEngine = "hybrid";
let activeViewerUrl = "";
let activePersonSection = "identity";
let activeGenealogyItem = null;
let genealogyZoom = 1;
let activeGenealogyPageId = "";
let activeGenealogyPhotoId = "";
let documentReturnContext = null;
let documentFileMarkedForRemoval = false;
let familyDetailsReturnContext = null;
const MAX_PERSON_PHOTO_BYTES = 5 * 1024;
const viewModes = readViewModes();
const directoryViewViewport = window.matchMedia("(max-width: 760px)");
const directoryViewPreferenceKeys = Object.freeze({
  mobile: "familyTreeDirectoryViewMobile",
  desktop: "familyTreeDirectoryViewDesktop"
});
const personFields = ["firstName", "middleName", "lastName", "marriedName", "gender", "branch", "place", "deathPlace", "photoUrl", "notes"];
const taskFields = ["title", "status", "priority", "assignee", "dueDate", "description", "comments"];
const locationControls = {};
const locationFieldDefinitions = {
  place: { textKey: "place", infoKey: "birthPlaceInfo" },
  deathPlace: { textKey: "deathPlace", infoKey: "deathPlaceInfo" },
  unionPlace: { textKey: "unionPlace", infoKey: "unionPlaceInfo" },
  endPlace: { textKey: "endPlace", infoKey: "endPlaceInfo" },
  documentPlace: { textKey: "place", infoKey: "placeInfo" }
};

function configureResponsiveFormSemantics() {
  ["birthYear", "birthYearFrom", "birthYearTo", "deathYear", "deathYearFrom", "deathYearTo", "unionYear", "unionYearFrom", "unionYearTo", "endYear", "endYearFrom", "endYearTo"].forEach(id => {
    const field = $(id);
    if (!field) return;
    field.inputMode = "numeric";
    field.setAttribute("pattern", "[0-9]*");
  });
  Object.keys(locationFieldDefinitions).forEach(id => {
    const field = $(id);
    if (!field) return;
    field.autocomplete = "off";
    field.setAttribute("autocapitalize", "words");
  });
  Object.entries({
    profileDisplayName: { autocomplete: "name", autocapitalize: "words" },
    profileEmail: { autocomplete: "email", inputmode: "email", autocapitalize: "none" }
  }).forEach(([id, attributes]) => {
    const field = $(id);
    if (!field) return;
    Object.entries(attributes).forEach(([name, value]) => field.setAttribute(name, value));
  });
  document.querySelectorAll("[data-date-control] .date-type-switch").forEach(group => {
    const prefix = group.closest("[data-date-control]")?.dataset.dateControl;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", prefix === "union" ? "Précision de la date de l’union" : prefix === "end" ? "Précision de la date de fin de relation" : `Précision de la date de ${prefix === "birth" ? "naissance" : "décès"}`);
  });
  const settingsNav = document.querySelector(".settings-nav");
  settingsNav?.setAttribute("role", "tablist");
  document.querySelectorAll("[data-settings-tab]").forEach(button => {
    const tab = button.dataset.settingsTab;
    const panel = tab === "profile" ? $("profileSettingsPanel") : $("securitySettingsPanel");
    const tabId = `${tab}SettingsTab`;
    button.id ||= tabId;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panel.id);
    const active = tab === "profile";
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
  });
}

configureResponsiveFormSemantics();

function initializeLocationAutocompletes() {
  const username = geoNamesUsernameFromDocument();
  const endpoint = geoNamesEndpointFromDocument();
  for (const inputId of Object.keys(locationFieldDefinitions)) {
    const input = $(inputId);
    if (input) locationControls[inputId] = createLocationAutocomplete({ input, username, endpoint });
  }
}

function setLocationField(inputId, text = "", placeInfo = null) {
  const control = locationControls[inputId];
  if (control) control.setValue(text, placeInfo);
  else if ($(inputId)) $(inputId).value = text || "";
}

function readLocationField(inputId) {
  return locationControls[inputId]?.getValue() || { text: $(inputId)?.value.trim() || "", placeInfo: null };
}

function applyLocationField(data, inputId, existing = null, allowDelete = false) {
  const definition = locationFieldDefinitions[inputId];
  const value = readLocationField(inputId);
  data[definition.textKey] = value.text;
  if (value.placeInfo) data[definition.infoKey] = value.placeInfo;
  else if (allowDelete && existing?.[definition.infoKey]) data[definition.infoKey] = deleteField();
  return value;
}

initializeLocationAutocompletes();

function readOffsets() {
  try { return JSON.parse(localStorage.getItem("familyTreeManualOffsets") || "{}"); }
  catch { return {}; }
}

function readViewModes() {
  try { return JSON.parse(localStorage.getItem("familyTreeViewModes") || "{}") || {}; }
  catch { return {}; }
}

function directoryViewContext() {
  return directoryViewViewport.matches ? "mobile" : "desktop";
}

function readDirectoryViewPreference(context = directoryViewContext()) {
  try {
    const mode = localStorage.getItem(directoryViewPreferenceKeys[context]);
    return mode === "cards" || mode === "list" ? mode : null;
  } catch {
    return null;
  }
}

function defaultDirectoryView(context = directoryViewContext()) {
  return readDirectoryViewPreference(context) || (context === "mobile" ? "cards" : "list");
}

function applyDirectoryViewPreference() {
  setContentMode("directory", defaultDirectoryView(), false);
}

function saveOffsets() {
  localStorage.setItem("familyTreeManualOffsets", JSON.stringify(manualOffsets));
}

const DIRECTORY_SORT_OPTIONS = ["name-asc", "name-desc", "birth-asc", "birth-desc"];

function readDirectorySort() {
  try {
    const value = localStorage.getItem("familyTreeDirectorySort");
    return DIRECTORY_SORT_OPTIONS.includes(value) ? value : "name-asc";
  } catch {
    return "name-asc";
  }
}

function saveDirectorySort(value) {
  try { localStorage.setItem("familyTreeDirectorySort", value); }
  catch { /* Le tri courant reste appliqué sans stockage local. */ }
}

function esc(value = "") {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function searchable(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatPersonModInfo(item) {
  if (!item?.updatedAt?.toDate) return "";
  const date = item.updatedAt.toDate();
  const formatted = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    + " à " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const author = item.updatedByName;
  return author ? `${formatted} · ${esc(author)}` : formatted;
}

/* Métadonnée de modification pour le header de la modale Personne :
   source identique à formatPersonModInfo (updatedAt Firestore + auteur
   réel), sans aucun fallback sur la date actuelle. */
function personModMetaParts(item = {}) {
  if (!item?.updatedAt?.toDate) return null;
  const date = item.updatedAt.toDate();
  const long = "Dernière modification : " + date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    + " à " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const short = "Modifiée le " + date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const author = item.updatedByName;
  return {
    long: author ? `${long} · ${esc(author)}` : long,
    short: author ? `${short} · ${esc(author)}` : short
  };
}

function dateInfoOf(item, prefix) {
  return normalizeGenealogyDate(item?.[`${prefix}DateInfo`], item?.[`${prefix}Date`]);
}

function setGenealogyDateType(prefix, type = "unknown") {
  document.querySelectorAll(`[data-date-prefix="${prefix}"]`).forEach(button => {
    const active = button.dataset.dateType === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll(`[data-date-panel^="${prefix}-"]`).forEach(panel => { panel.hidden = panel.dataset.datePanel !== `${prefix}-${type === "about" ? "year" : type}`; });
  const control = document.querySelector(`[data-date-control="${prefix}"]`);
  if (control) control.dataset.dateType = type;
}

function setGenealogyDateForm(prefix, value, legacyExact = "") {
  const date = normalizeGenealogyDate(value, legacyExact);
  for (const suffix of ["Date", "Year", "YearFrom", "YearTo"]) if ($(`${prefix}${suffix}`)) $(`${prefix}${suffix}`).value = "";
  if (date.type === "exact") $(`${prefix}Date`).value = date.value;
  if (date.type === "year" || date.type === "about") $(`${prefix}Year`).value = date.year;
  if (date.type === "between") { $(`${prefix}YearFrom`).value = date.from; $(`${prefix}YearTo`).value = date.to; }
  setGenealogyDateType(prefix, date.type);
}

function captureGenealogyDateDraft(prefix) {
  return { type: document.querySelector(`[data-date-control="${prefix}"]`)?.dataset.dateType || "unknown", exact: $(`${prefix}Date`)?.value || "", year: $(`${prefix}Year`)?.value || "", from: $(`${prefix}YearFrom`)?.value || "", to: $(`${prefix}YearTo`)?.value || "" };
}

function restoreGenealogyDateDraft(prefix, draft) {
  if (!draft) return setGenealogyDateForm(prefix, null);
  if ($(`${prefix}Date`)) $(`${prefix}Date`).value = draft.exact || "";
  if ($(`${prefix}Year`)) $(`${prefix}Year`).value = draft.year || "";
  if ($(`${prefix}YearFrom`)) $(`${prefix}YearFrom`).value = draft.from || "";
  if ($(`${prefix}YearTo`)) $(`${prefix}YearTo`).value = draft.to || "";
  setGenealogyDateType(prefix, draft.type);
}

function readGenealogyDateForm(prefix) {
  const type = document.querySelector(`[data-date-control="${prefix}"]`)?.dataset.dateType || "unknown";
  let value = { type };
  if (type === "exact") value.value = $(`${prefix}Date`).value;
  if (type === "year" || type === "about") value.year = Number($(`${prefix}Year`).value);
  if (type === "between") { value.from = Number($(`${prefix}YearFrom`).value); value.to = Number($(`${prefix}YearTo`).value); }
  const normalized = normalizeGenealogyDate(value);
  if (type !== "unknown" && normalized.type === "unknown") throw new Error(type === "between" ? "Renseignez une période valide, avec l’année de début avant l’année de fin" : "Renseignez une date valide");
  return normalized;
}

function setContentMode(section, mode, persist = true) {
  const normalized = mode === "list" ? "list" : "cards";
  const list = $(`${section}List`);
  if (!list) return;
  list.classList.toggle("list-mode", normalized === "list");
  list.classList.toggle("cards-mode", normalized === "cards");
  document.querySelectorAll(`[data-switch="${section}"] [data-mode]`).forEach(button => {
    const active = button.dataset.mode === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  viewModes[section] = normalized;
  if (!persist) return;
  if (section === "directory") {
    try { localStorage.setItem(directoryViewPreferenceKeys[directoryViewContext()], normalized); }
    catch { /* Le choix de vue reste utilisable sans accès au stockage local. */ }
    return;
  }
  const storedModes = { ...viewModes };
  delete storedModes.directory;
  try { localStorage.setItem("familyTreeViewModes", JSON.stringify(storedModes)); }
  catch { /* Le stockage des préférences est facultatif. */ }
}

let toastTimer = 0;
function toast(message, type = "success") {
  const normalizedType = ["success", "error", "info"].includes(type) ? type : "info";
  const toastElement = $("toast");
  toastElement.dataset.type = normalizedType;
  toastElement.setAttribute("role", normalizedType === "error" ? "alert" : "status");
  $("toastIcon").innerHTML = icon(normalizedType === "error" ? "error" : normalizedType === "success" ? "check" : "info");
  $("toastMessage").textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), normalizedType === "error" ? 4200 : 2800);
}

async function runSafely(action, fallback = "Action impossible") {
  try { return await action(); }
  catch (error) {
    console.error(error);
    toast(error.message || fallback, "error");
    return null;
  }
}

function setActionLabel(button, label, iconName = "") {
  if (!button) return;
  button.innerHTML = `${iconName ? icon(iconName) : ""}<span>${esc(label)}</span>`;
}

function tileContextMenuMarkup(kind, id, label, actions) {
  const items = actions.map(action => `<button class="tile-context-menu-item${action.danger ? " is-danger" : ""}" type="button" role="menuitem" data-tile-menu-action="${action.key}" data-tile-menu-kind="${kind}" data-tile-menu-id="${esc(id)}">${icon(action.icon)}<span>${esc(action.label)}</span></button>`).join("");
  return `<div class="tile-context-actions"><button class="tile-context-toggle" type="button" data-tile-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Actions secondaires pour ${esc(label)}" title="Actions"><span class="tile-context-glyph" aria-hidden="true"><span class="tile-context-dot"></span><span class="tile-context-dot"></span><span class="tile-context-dot"></span></span></button><div class="tile-context-menu" role="menu" hidden>${items}</div></div>`;
}

let openTileContextGroup = null;
const primaryTileFocusReturn = new WeakMap();
let pendingPrimaryTilePointer = null;
let pendingTileContextPointerGroup = null;
let pendingTileContextPointerTimer = 0;

function clearPendingTileContextPointer() {
  if (pendingTileContextPointerTimer) clearTimeout(pendingTileContextPointerTimer);
  pendingTileContextPointerTimer = 0;
  pendingTileContextPointerGroup = null;
}

function closeTileContextMenu(restoreFocus = false) {
  if (!openTileContextGroup) return;
  clearPendingTileContextPointer();
  const group = openTileContextGroup;
  const toggle = group.querySelector("[data-tile-menu-toggle]");
  const menu = group.querySelector(".tile-context-menu");
  if (menu) menu.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
  group.closest(".directory-entry, .content-card")?.classList.remove("tile-context-open");
  openTileContextGroup = null;
  if (restoreFocus) toggle?.focus({ preventScroll: true });
}

function showTileContextMenu(toggle) {
  const group = toggle.closest(".tile-context-actions");
  const menu = group?.querySelector(".tile-context-menu");
  if (!group || !menu) return;
  if (openTileContextGroup === group) {
    closeTileContextMenu(true);
    return;
  }
  closeTileContextMenu();
  group.closest(".directory-entry, .content-card")?.classList.add("tile-context-open");
  menu.hidden = false;
  const anchor = toggle.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(8, Math.min(viewportWidth - bounds.width - 8, anchor.right - bounds.width));
  const below = anchor.bottom + 4;
  const maxTop = Math.max(8, viewportHeight - bounds.height - 8);
  const above = anchor.top - bounds.height - 4;
  const top = below + bounds.height <= viewportHeight - 8 ? below : Math.max(8, Math.min(maxTop, above));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  toggle.setAttribute("aria-expanded", "true");
  openTileContextGroup = group;
  menu.querySelector('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
}

async function performTileContextAction(button) {
  const { tileMenuKind: kind, tileMenuAction: action, tileMenuId: id } = button.dataset;
  if (kind === "directory" && action === "delete") {
    return runSafely(() => removeDirectoryPersonPermanently(id), "Suppression de la personne impossible");
  }
  if (kind === "document" && action === "edit") {
    const item = documents.find(value => value.id === id);
    if (!item) return false;
    openDocument(item);
    return true;
  }
  if (kind === "document" && action === "delete") {
    return runSafely(() => removeDocument(id), "Suppression du document impossible");
  }
  if (kind === "procedure" && action === "edit") {
    const item = procedures.find(value => value.id === id);
    if (!item) return false;
    openDossierForm(item);
    return true;
  }
  if (kind === "task" && action === "delete") {
    return runSafely(() => removeTaskFromList(id), "Suppression de l’action impossible");
  }
  return false;
}

document.addEventListener("click", async event => {
  const toggle = event.target.closest?.("[data-tile-menu-toggle]");
  if (toggle) {
    event.preventDefault();
    event.stopPropagation();
    showTileContextMenu(toggle);
    return;
  }
  const menuAction = event.target.closest?.("[data-tile-menu-action]");
  if (menuAction) {
    event.preventDefault();
    event.stopPropagation();
    clearPendingTileContextPointer();
    const group = menuAction.closest(".tile-context-actions");
    const toggleButton = group?.querySelector("[data-tile-menu-toggle]");
    const restoresToTrigger = ["document", "procedure"].includes(menuAction.dataset.tileMenuKind) && menuAction.dataset.tileMenuAction === "edit";
    closeTileContextMenu(restoresToTrigger);
    const completed = await performTileContextAction(menuAction);
    if (menuAction.dataset.tileMenuAction === "delete") {
      if (completed === true) {
        const searchId = { directory: "directorySearch", document: "documentSearch", task: "taskSearch" }[menuAction.dataset.tileMenuKind];
        $(searchId)?.focus({ preventScroll: true });
      } else toggleButton?.focus({ preventScroll: true });
    }
    return;
  }
  if (openTileContextGroup && !openTileContextGroup.contains(event.target)) closeTileContextMenu();
}, true);

document.addEventListener("keydown", event => {
  if (!openTileContextGroup) return;
  const menu = openTileContextGroup.querySelector(".tile-context-menu");
  const toggle = openTileContextGroup.querySelector("[data-tile-menu-toggle]");
  const items = [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeTileContextMenu(true);
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
    event.preventDefault();
    if (event.key === "Home") items[0].focus();
    else if (event.key === "End") items[items.length - 1].focus();
    else if (event.key === "ArrowDown") items[(index + 1 + items.length) % items.length].focus();
    else items[(index - 1 + items.length) % items.length].focus();
  } else if (toggle && !openTileContextGroup.contains(event.target)) {
    closeTileContextMenu();
  }
}, true);

document.addEventListener("focusin", event => {
  if (!openTileContextGroup || openTileContextGroup.contains(event.target)) return;
  /* WebKit tactile peut déplacer le focus vers la tuile sous-jacente entre
     touchend et le click synthétique du bouton. Garder la cible menu dans le
     DOM jusqu’au click correspondant, puis fermer dans le handler d’action. */
  if (pendingTileContextPointerGroup === openTileContextGroup) return;
  closeTileContextMenu();
}, true);
window.addEventListener("resize", () => closeTileContextMenu());
window.addEventListener("scroll", () => closeTileContextMenu(), true);

document.addEventListener("pointerdown", event => {
  const tile = event.target.closest?.("[data-primary-tile]");
  pendingPrimaryTilePointer = tile && !event.target.closest("button, a, input, select, textarea, summary, .tile-context-actions") ? tile : null;
  clearPendingTileContextPointer();
  if (openTileContextGroup?.contains(event.target)) {
    const group = openTileContextGroup;
    pendingTileContextPointerGroup = group;
    pendingTileContextPointerTimer = setTimeout(() => {
      if (pendingTileContextPointerGroup !== group) return;
      clearPendingTileContextPointer();
      if (openTileContextGroup === group && !group.contains(document.activeElement)) closeTileContextMenu();
    }, 1000);
  }
}, true);
document.addEventListener("pointercancel", () => {
  pendingPrimaryTilePointer = null;
  clearPendingTileContextPointer();
}, true);

function preparePrimaryTileActivation(event, tile, dialog) {
  const pointer = pendingPrimaryTilePointer === tile || event.detail > 0;
  pendingPrimaryTilePointer = null;
  if (!pointer) {
    primaryTileFocusReturn.delete(dialog);
    return;
  }
  event.preventDefault();
  if (tile.contains(document.activeElement)) document.activeElement.blur();
  primaryTileFocusReturn.set(dialog, tile);
}

for (const dialogId of ["personDialog", "documentViewerDialog", "taskDialog", "procedureDetailDialog"]) {
  $(dialogId).addEventListener("close", () => {
    const tile = primaryTileFocusReturn.get($(dialogId));
    primaryTileFocusReturn.delete($(dialogId));
    if (tile) requestAnimationFrame(() => { if (tile.isConnected && document.activeElement === tile) tile.blur(); });
  });
}

function person(id) { return people.find(item => item.id === id); }
function treePeople() { return people.filter(item => item.inTree !== false); }
function nameOf(id) {
  const item = person(id);
  return item ? [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ") : "Personne supprimée";
}

function clearTreeScopedFilters() {
  branchView = null;
  lineageSurname = "";
  focusAfterRender = null;
  if ($("treeBranchFilter")) $("treeBranchFilter").value = "";
}

function treeCatalogStatusText() {
  if (treeCatalogState === "error") return treeCatalogMessage || "Les arbres secondaires sont indisponibles. L’arbre familial principal reste affiché.";
  if (treeCatalogState !== "ready") return "";
  const knownIds = new Set(treeMetadata.map(item => item.id));
  const unresolved = people.filter(item => {
    const membership = getPersonTreeMembership(item);
    return membership.type === "unavailable"
      || (membership.type === "assigned" && membership.treeId !== MAIN_TREE_ID && !knownIds.has(membership.treeId));
  });
  const messages = [];
  if (treeCatalogMessage) messages.push(treeCatalogMessage);
  if (unresolved.length) messages.push(`${unresolved.length} fiche${unresolved.length > 1 ? "s" : ""} présente${unresolved.length > 1 ? "nt" : ""} une appartenance indéterminée ou une référence vers un arbre absent. Ces anomalies sont signalées séparément et ne sont attribuées à aucun arbre sans référence explicite.`);
  return messages.join(" ");
}

function updateTreeSelectorOptions() {
  const select = $("treeSelect");
  const status = $("treeCatalogStatus");
  if (!select) return false;
  const knownIds = new Set(treeMetadata.map(item => item.id));
  const wasActiveUnavailable = activeTreeId !== MAIN_TREE_ID
    && (treeCatalogState === "error" || (treeCatalogState === "ready" && !knownIds.has(activeTreeId)));
  if (wasActiveUnavailable) {
    activeTreeId = MAIN_TREE_ID;
    clearTreeScopedFilters();
    if (treeCatalogState === "ready") treeCatalogMessage = "L’arbre sélectionné n’est plus disponible. L’arbre familial principal est affiché.";
  }
  select.innerHTML = `<option value="${MAIN_TREE_ID}">Arbre familial</option>${treeMetadata.map(item => {
    const deleting = getTreeLifecycleState(item) === TREE_LIFECYCLE_DELETING;
    return `<option value="${esc(item.id)}">${esc(item.name)}${deleting ? " · Suppression en cours" : ""}</option>`;
  }).join("")}`;
  select.value = activeTreeId;
  updateDirectoryTreeOptions();
  updatePersonTreeOptions();
  if (status) {
    const message = treeCatalogStatusText();
    status.textContent = message;
    status.hidden = !message;
  }
  updateTreeActionButtons();
  return wasActiveUnavailable;
}

function updateDirectoryTreeOptions() {
  const select = $("directoryTreeFilter");
  if (!select) return;
  const previous = select.value || "all";
  const available = previous === "all" || previous === MAIN_TREE_ID || previous === DIRECTORY_UNASSIGNED_TREE_FILTER || treeMetadata.some(item => item.id === previous);
  const options = [
    '<option value="all">Tous les arbres</option>',
    `<option value="${DIRECTORY_UNASSIGNED_TREE_FILTER}">Sans arbre</option>`,
    `<option value="${MAIN_TREE_ID}">Arbre familial</option>`,
    ...treeMetadata.map(item => `<option value="${esc(item.id)}"${getTreeLifecycleState(item) !== TREE_LIFECYCLE_ACTIVE ? " disabled" : ""}>${esc(item.name)}${getTreeLifecycleState(item) === TREE_LIFECYCLE_DELETING ? " · Suppression en cours" : ""}</option>`)
  ];
  if (!available && previous !== DIRECTORY_UNASSIGNED_TREE_FILTER) options.push(`<option value="${esc(previous)}">Arbre indisponible</option>`);
  select.innerHTML = options.join("");
  select.value = previous;
}

function updatePersonTreeOptions() {
  const select = $("personTreeSelect");
  if (!select) return;
  const previous = select.value || MAIN_TREE_ID;
  const available = previous === UNASSIGNED_TREE_CHOICE || previous === MAIN_TREE_ID || treeMetadata.some(item => item.id === previous);
  const options = [
    `<option value="${UNASSIGNED_TREE_CHOICE}">Aucun arbre</option>`,
    `<option value="${MAIN_TREE_ID}">Arbre familial</option>`,
    ...treeMetadata.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
  ];
  if (!available) options.push(`<option value="${esc(previous)}">Arbre indisponible</option>`);
  select.innerHTML = options.join("");
  select.value = previous;
}

function updateTreeBranchOptions() {
  const select = $("treeBranchFilter");
  if (!select) return;
  const namesByKey = new Map();
  for (const item of getTreePeople(treePeople(), activeTreeId)) {
    const name = typeof item.lastName === "string" ? item.lastName.trim() : "";
    const key = normalizeLineageName(name);
    if (key && !namesByKey.has(key)) namesByKey.set(key, name);
  }
  const names = [...namesByKey.values()].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  const selectedKey = normalizeLineageName(lineageSurname);
  const selected = names.find(name => normalizeLineageName(name) === selectedKey) || "";
  lineageSurname = selected;
  select.innerHTML = '<option value="">Toutes les branches</option>' + names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  select.value = selected;
}

function setActiveTree(treeId) {
  const available = treeId === MAIN_TREE_ID || treeMetadata.some(item => item.id === treeId);
  if (!available || treeId === activeTreeId) return;
  activeTreeId = treeId;
  clearTreeScopedFilters();
  if (activeId && !getTreePeople(treePeople(), activeTreeId).some(item => item.id === activeId)) activeId = null;
  updateTreeSelectorOptions();
  updateTreeBranchOptions();
  if (loadedPeople && loadedFamilies) {
    cameraPositioned = true;
    renderTree();
    camera.fit();
  }
}

function isAdminUser() {
  return auth.currentUser?.uid === primaryAdminUid || currentUserProfile?.role === "admin";
}

function normalizeTreeName(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isDuplicateTreeName(name, excludeId = null) {
  const normalized = normalizeTreeName(name);
  return treeMetadata.some(item => item.id !== excludeId && normalizeTreeName(item.name) === normalized);
}

function updateTreeActionButtons() {
  const trigger = $("manageTreesBtn");
  const createBtn = $("manageTreeCreateBtn");
  const renameBtn = $("manageTreeRenameBtn");
  const deleteBtn = $("manageTreeDeleteBtn");
  const recoverBtn = $("manageTreeRecoverBtn");
  const deleteNotice = $("manageTreeDeleteNotice");
  const manager = $("treeManagement");
  if (!trigger) return;
  const admin = isAdminUser();
  manager.hidden = !admin;
  trigger.hidden = !admin;
  trigger.disabled = treeCatalogState !== "ready";
  createBtn.disabled = treeCatalogState !== "ready";
  createBtn.title = treeCatalogState === "ready" ? "Créer un arbre" : "Catalogue des arbres indisponible";
  const activeTree = treeMetadata.find(item => item.id === activeTreeId);
  const lifecycleState = activeTree ? getTreeLifecycleState(activeTree) : "invalid";
  const isSecondary = activeTreeId !== MAIN_TREE_ID && !!activeTree;
  const deleting = isSecondary && lifecycleState === TREE_LIFECYCLE_DELETING;
  const busy = treeDeletionInProgress.has(activeTreeId) || treeRecoveryInProgress.has(activeTreeId);
  renameBtn.disabled = treeCatalogState !== "ready" || !isSecondary || lifecycleState !== TREE_LIFECYCLE_ACTIVE || busy;
  renameBtn.title = isSecondary ? "Renommer l’arbre actuel" : "L’arbre principal ne peut pas être renommé";
  deleteBtn.hidden = deleting;
  deleteBtn.disabled = treeCatalogState !== "ready" || !isSecondary || lifecycleState !== TREE_LIFECYCLE_ACTIVE || busy;
  deleteBtn.title = activeTreeId === MAIN_TREE_ID
    ? "L’arbre principal ne peut pas être supprimé."
    : lifecycleState === "invalid" ? "État de l’arbre invalide : action indisponible."
      : "Supprimer l’arbre secondaire actuel";
  recoverBtn.hidden = !deleting;
  recoverBtn.disabled = treeCatalogState !== "ready" || !deleting || busy;
  recoverBtn.title = deleting ? "Récupérer l’arbre verrouillé" : "Aucun verrou à récupérer";
  const deleteReason = activeTreeId === MAIN_TREE_ID
    ? "L’arbre familial principal ne peut pas être supprimé."
    : !isSecondary ? "Sélectionnez un arbre secondaire disponible."
        : busy ? "Opération sur l’arbre en cours…"
        : lifecycleState === TREE_LIFECYCLE_DELETING
        ? "Suppression en cours ou interrompue. Si elle est bloquée, un administrateur peut récupérer cet arbre."
        : lifecycleState !== TREE_LIFECYCLE_ACTIVE
          ? "L’état de cet arbre est invalide ; aucune action de gestion n’est autorisée."
          : "La suppression sera vérifiée sur les données Firestore après verrouillage de l’arbre.";
  deleteNotice.textContent = deleteReason;
  if (!admin) setTreeManagementMenu(false);
}

function openTreeDialog(mode = "create", treeId = null) {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (treeCatalogState !== "ready") return toast("Le catalogue des arbres est indisponible", "error");
  if (mode === "rename" && treeId === MAIN_TREE_ID) return toast("L’arbre familial principal ne peut pas être renommé", "error");
  $("treeForm").reset();
  $("treeId").value = "";
  $("treeDialogTitle").textContent = mode === "rename" ? "Renommer l'arbre" : "Créer un arbre";
  if (mode === "rename" && treeId) {
    const tree = treeMetadata.find(item => item.id === treeId);
    if (!tree) return toast("Arbre introuvable", "error");
    $("treeId").value = treeId;
    $("treeName").value = tree.name;
    $("treeDescription").value = tree.description || "";
  }
  $("treeDialog").showModal();
  setTimeout(() => $("treeName").focus(), 30);
}

function setTreeManagementMenu(open, restoreFocus = false) {
  const trigger = $("manageTreesBtn");
  const popover = $("treeManagementPopover");
  const items = [...popover.querySelectorAll("button:not([hidden]):not([disabled])")];
  const nextOpen = Boolean(open && !trigger.hidden && !trigger.disabled);
  popover.hidden = !nextOpen;
  trigger.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    popover.style.left = "";
    popover.style.right = "";
    const bounds = popover.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    if (bounds.left < 8) {
      popover.style.left = "0";
      popover.style.right = "auto";
    } else if (bounds.right > viewportWidth - 8) {
      popover.style.left = "auto";
      popover.style.right = "0";
    }
    items[0]?.focus({ preventScroll: true });
  } else {
    popover.style.left = "";
    popover.style.right = "";
    if (restoreFocus && !trigger.hidden) trigger.focus({ preventScroll: true });
  }
}

function newTreeDeletionToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Impossible de générer un jeton de verrouillage sécurisé dans ce navigateur.");
}

function runTreeLifecycleTransaction(treeRef, operation) {
  return runTransaction(db, operation);
}

function readTreeLifecycleDocument(treeRef) {
  return getDocFromServer(treeRef);
}

function readTreeDeletionMembers(treeId) {
  return getDocsFromServer(query(refs.people, where("treeId", "==", treeId)));
}

function refreshAfterTreeRemoval(treeId) {
  const focusWasInManager = $("treeManagementPopover").contains(document.activeElement);
  treeMetadata = treeMetadata.filter(tree => tree.id !== treeId);
  if (activeTreeId === treeId) {
    activeTreeId = MAIN_TREE_ID;
    clearTreeScopedFilters();
    activeId = null;
  }
  updateTreeSelectorOptions();
  updateTreeBranchOptions();
  if (loadedPeople && loadedFamilies) {
    cameraPositioned = true;
    renderTree();
    camera.fit();
  }
  if (loadedPeople && !$('directoryView').hidden) renderDirectory();
  if (focusWasInManager && !$("manageTreesBtn").hidden) $("manageTreesBtn").focus({ preventScroll: true });
}

function updateCachedTreeLifecycle(treeId, lifecycleState, token = null) {
  const tree = treeMetadata.find(item => item.id === treeId);
  if (!tree) return;
  tree.lifecycleState = lifecycleState;
  if (lifecycleState === TREE_LIFECYCLE_DELETING) tree.deletionToken = token;
  else {
    delete tree.deletionToken;
    delete tree.deletionStartedAt;
    delete tree.deletionStartedBy;
  }
  updateTreeSelectorOptions();
}

function restoreTreeManagementFocusIfNeeded() {
  const focused = document.activeElement;
  if (!focused || !["manageTreeDeleteBtn", "manageTreeRecoverBtn"].includes(focused.id)) return;
  if (!focused.hidden && !focused.disabled) return;
  const recovery = $("manageTreeRecoverBtn");
  if (!recovery.hidden && !recovery.disabled) recovery.focus({ preventScroll: true });
  else if (!$("manageTreesBtn").hidden) $("manageTreesBtn").focus({ preventScroll: true });
}

async function restoreTreeDeletionLock(treeId, token, uid) {
  const treeRef = doc(db, "trees", treeId);
  await runTreeLifecycleTransaction(treeRef, async transaction => {
    const snapshot = await transaction.get(treeRef);
    if (!snapshot.exists()) throw new Error("L'arbre a déjà été supprimé ou n'est plus disponible.");
    const current = snapshot.data();
    if (current.lifecycleState !== TREE_LIFECYCLE_DELETING || current.deletionToken !== token) {
      throw new Error("Le verrou a changé depuis cette tentative. Actualisez le catalogue avant de continuer.");
    }
    transaction.update(treeRef, {
      lifecycleState: TREE_LIFECYCLE_ACTIVE,
      deletionToken: deleteField(),
      deletionStartedAt: deleteField(),
      deletionStartedBy: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: uid
    });
  });
  updateCachedTreeLifecycle(treeId, TREE_LIFECYCLE_ACTIVE);
}

function unrelatedTreeMembershipAnomalies(treeId) {
  const knownIds = new Set(treeMetadata.map(item => item.id));
  return people.filter(item => {
    if (item.treeId === treeId) return false;
    const membership = getPersonTreeMembership(item);
    return membership.type === "unavailable"
      || (membership.type === "assigned" && membership.treeId !== MAIN_TREE_ID && !knownIds.has(membership.treeId));
  }).length;
}

async function deleteManagedTree(treeId) {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (treeCatalogState !== "ready") return toast("Le catalogue des arbres est indisponible", "error");
  if (!treeId || treeId === MAIN_TREE_ID) return toast("L’arbre familial principal ne peut pas être supprimé.", "error");
  const tree = treeMetadata.find(item => item.id === treeId);
  if (!tree) return toast("Cet arbre n’est plus disponible. Actualisez le catalogue.", "error");
  if (getTreeLifecycleState(tree) === TREE_LIFECYCLE_DELETING) return toast("Une suppression est déjà interrompue ou en cours. Utilisez « Débloquer l’arbre » après vérification.", "error");
  if (getTreeLifecycleState(tree) !== TREE_LIFECYCLE_ACTIVE) return toast("L’état de cet arbre est invalide. Aucune suppression n’a été lancée.", "error");
  if (!confirm(`Supprimer définitivement l’arbre « ${tree.name} » ? Cette action est irréversible.`)) return false;
  if (treeDeletionInProgress.has(treeId) || treeRecoveryInProgress.has(treeId)) return toast("Une opération sur cet arbre est déjà en cours.", "info");

  const uid = auth.currentUser?.uid || "";
  if (!uid) return toast("Votre session a expiré ; reconnectez-vous avant la suppression.", "error");
  let token;
  try { token = newTreeDeletionToken(); }
  catch (error) { return toast(error.message, "error"); }
  const treeRef = doc(db, "trees", treeId);
  treeDeletionInProgress.add(treeId);
  updateTreeActionButtons();
  let lockCreated = false;
  let finalDeleteStarted = false;
  try {
    await runTreeLifecycleTransaction(treeRef, async transaction => {
      const snapshot = await transaction.get(treeRef);
      if (!snapshot.exists()) throw new Error("Cet arbre n’existe plus.");
      if (treeId === MAIN_TREE_ID) throw new Error("L’arbre familial principal ne peut pas être supprimé.");
      const current = snapshot.data();
      if (current.lifecycleState === TREE_LIFECYCLE_DELETING) throw new Error("Un autre administrateur a déjà verrouillé cet arbre.");
      if (getTreeLifecycleState(current) !== TREE_LIFECYCLE_ACTIVE) throw new Error("L’état de cet arbre est invalide.");
      transaction.update(treeRef, {
        lifecycleState: TREE_LIFECYCLE_DELETING,
        deletionToken: token,
        deletionStartedAt: serverTimestamp(),
        deletionStartedBy: uid,
        updatedAt: serverTimestamp(),
        updatedBy: uid
      });
    });
    lockCreated = true;
    updateCachedTreeLifecycle(treeId, TREE_LIFECYCLE_DELETING, token);

    // Lecture serveur complète du résultat de la requête, jamais le cache local.
    const memberSnapshot = await readTreeDeletionMembers(treeId);
    if (memberSnapshot.metadata.fromCache) throw new Error("La vérification des personnes n’a pas confirmé une lecture serveur complète.");
    if (!memberSnapshot.empty) {
      const memberReport = getTreeDeletionMemberReport(memberSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })), treeId);
      await restoreTreeDeletionLock(treeId, token, uid);
      const invalidCount = memberReport.invalidMembershipIds.length;
      const anomalyText = invalidCount ? ` ${invalidCount} fiche${invalidCount > 1 ? "s" : ""} avec une appartenance incohérente référence${invalidCount > 1 ? "nt" : ""} aussi cet arbre.` : "";
      toast(`Cet arbre contient encore des personnes, y compris éventuellement des fiches masquées. Retirez-les ou transférez-les avant de le supprimer.${anomalyText}`, "error");
      return false;
    }

    finalDeleteStarted = true;
    await runTreeLifecycleTransaction(treeRef, async transaction => {
      const snapshot = await transaction.get(treeRef);
      if (!snapshot.exists()) throw new Error("L’arbre a déjà été supprimé.");
      const current = snapshot.data();
      if (current.lifecycleState !== TREE_LIFECYCLE_DELETING || current.deletionToken !== token) {
        throw new Error("Le jeton de suppression a changé. L’arbre n’a pas été supprimé par cette tentative.");
      }
      transaction.delete(treeRef);
    });
    refreshAfterTreeRemoval(treeId);
    const unrelated = unrelatedTreeMembershipAnomalies(treeId);
    toast(`L’arbre « ${tree.name} » a été supprimé.${unrelated ? ` ${unrelated} autre${unrelated > 1 ? "s" : ""} fiche${unrelated > 1 ? "s" : ""} présente${unrelated > 1 ? "nt" : ""} une appartenance indéterminée sans référence explicite à cet arbre.` : ""}`);
    return true;
  } catch (error) {
    console.error("Suppression d’arbre impossible", error);
    let serverSnapshot = null;
    try { serverSnapshot = await readTreeLifecycleDocument(treeRef); } catch { /* état réseau indéterminé : ne jamais annoncer le succès */ }
    if (finalDeleteStarted && serverSnapshot && !serverSnapshot.exists()) {
      refreshAfterTreeRemoval(treeId);
      toast(`L’arbre « ${tree.name} » a été supprimé et l’absence du document a été confirmée par Firestore.`);
      return true;
    }
    if (!lockCreated && serverSnapshot?.exists()) {
      const serverTree = serverSnapshot.data();
      lockCreated = serverTree.lifecycleState === TREE_LIFECYCLE_DELETING && serverTree.deletionToken === token;
    }
    if (lockCreated) {
      toast(`Suppression non confirmée. L’arbre est conservé${error.message ? ` : ${error.message}` : "."} Si son état reste « suppression en cours », un administrateur peut utiliser « Débloquer l’arbre ».`, "error");
    } else {
      const text = `${error.code || ""} ${error.message || ""}`;
      const message = /permission-denied|insufficient permissions/i.test(text)
        ? "Suppression refusée par les règles Firestore. Vérifiez votre rôle et l’état de l’arbre."
        : /unavailable|network|offline|failed to fetch|deadline-exceeded/i.test(text)
          ? "Connexion impossible ; l’arbre n’a pas été supprimé. Vérifiez son état avant de réessayer."
          : error.message || "Suppression impossible ; aucune donnée généalogique n’a été supprimée.";
      toast(message, "error");
    }
    return false;
  } finally {
    treeDeletionInProgress.delete(treeId);
    updateTreeActionButtons();
    restoreTreeManagementFocusIfNeeded();
  }
}

async function recoverManagedTree(treeId) {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (!treeId || treeId === MAIN_TREE_ID) return toast("L’arbre familial principal ne peut pas être récupéré.", "error");
  if (treeDeletionInProgress.has(treeId) || treeRecoveryInProgress.has(treeId)) return toast("Une opération sur cet arbre est déjà en cours.", "info");
  const treeRef = doc(db, "trees", treeId);
  let snapshot;
  try { snapshot = await readTreeLifecycleDocument(treeRef); }
  catch (error) {
    console.error("Lecture serveur du verrou impossible", error);
    return toast("Impossible de vérifier le verrou auprès de Firestore. Aucune récupération n’a été effectuée.", "error");
  }
  if (!snapshot.exists()) return toast("Cet arbre n’existe plus. Actualisez le catalogue.", "error");
  const current = snapshot.data();
  if (current.lifecycleState !== TREE_LIFECYCLE_DELETING || typeof current.deletionToken !== "string") {
    return toast("L’état de l’arbre a changé. Actualisez le catalogue avant de continuer.", "error");
  }
  const token = current.deletionToken;
  const treeName = current.name || "Arbre secondaire";
  if (!confirm(`L’arbre « ${treeName} » est verrouillé pour suppression. Le réactiver invalidera le jeton actuel et arrêtera cette tentative. Si une autre session la traite encore, elle ne pourra plus supprimer l’arbre. Continuer ?`)) return false;
  const uid = auth.currentUser?.uid || "";
  if (!uid) return toast("Votre session a expiré ; reconnectez-vous avant la récupération.", "error");
  treeRecoveryInProgress.add(treeId);
  updateTreeActionButtons();
  try {
    await runTreeLifecycleTransaction(treeRef, async transaction => {
      const liveSnapshot = await transaction.get(treeRef);
      if (!liveSnapshot.exists()) throw new Error("L’arbre n’existe plus.");
      const live = liveSnapshot.data();
      if (live.lifecycleState !== TREE_LIFECYCLE_DELETING || live.deletionToken !== token) {
        throw new Error("Le verrou a changé depuis la confirmation. Actualisez le catalogue et recommencez.");
      }
      transaction.update(treeRef, {
        lifecycleState: TREE_LIFECYCLE_ACTIVE,
        deletionToken: deleteField(),
        deletionStartedAt: deleteField(),
        deletionStartedBy: deleteField(),
        updatedAt: serverTimestamp(),
        updatedBy: uid
      });
    });
    updateCachedTreeLifecycle(treeId, TREE_LIFECYCLE_ACTIVE);
    toast(`L’arbre « ${treeName} » a été réactivé. L’ancienne tentative ne peut plus le supprimer.`);
    return true;
  } catch (error) {
    console.error("Récupération de l’arbre impossible", error);
    toast(error.message || "Récupération impossible ; actualisez le catalogue.", "error");
    return false;
  } finally {
    treeRecoveryInProgress.delete(treeId);
    updateTreeActionButtons();
    restoreTreeManagementFocusIfNeeded();
  }
}

function openTreeManagementAction(action) {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (treeCatalogState !== "ready") return toast("Le catalogue des arbres est indisponible", "error");
  setTreeManagementMenu(false);
  if (action === "create") return openTreeDialog("create");
  if (action === "rename") {
    if (activeTreeId === MAIN_TREE_ID) return toast("L’arbre familial principal ne peut pas être renommé", "error");
    return openTreeDialog("rename", activeTreeId);
  }
  if (action === "delete") return deleteManagedTree(activeTreeId);
  if (action === "recover") return recoverManagedTree(activeTreeId);
}

$("manageTreesBtn").addEventListener("click", event => {
  event.stopPropagation();
  setTreeManagementMenu($("treeManagementPopover").hidden);
});
$("manageTreesBtn").addEventListener("keydown", event => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  setTreeManagementMenu(true);
  if (event.key === "ArrowUp") {
    const items = [...$("treeManagementPopover").querySelectorAll("button:not([hidden]):not([disabled])")];
    items.at(-1)?.focus({ preventScroll: true });
  }
});
$("treeManagementPopover").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button && !button.disabled) setTreeManagementMenu(false);
});
$("treeManagementPopover").addEventListener("keydown", event => {
  const items = [...$("treeManagementPopover").querySelectorAll("button:not([hidden]):not([disabled])")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    setTreeManagementMenu(false, true);
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
    event.preventDefault();
    if (event.key === "Home") items[0].focus({ preventScroll: true });
    else if (event.key === "End") items.at(-1).focus({ preventScroll: true });
    else items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus({ preventScroll: true });
  }
});
document.addEventListener("click", event => {
  if ($("treeManagementPopover").hidden || event.target.closest("#treeManagement")) return;
  setTreeManagementMenu(false);
});
$("manageTreeCreateBtn").addEventListener("click", () => openTreeManagementAction("create"));
$("manageTreeRenameBtn").addEventListener("click", () => openTreeManagementAction("rename"));
$("manageTreeDeleteBtn").addEventListener("click", () => openTreeManagementAction("delete"));
$("manageTreeRecoverBtn").addEventListener("click", () => openTreeManagementAction("recover"));

$("treeForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  const submitButton = event.submitter;
  const id = $("treeId").value;
  if (id === MAIN_TREE_ID) return toast("L’arbre familial principal ne peut pas être renommé", "error");
  const name = $("treeName").value.trim();
  const description = $("treeDescription").value.trim();
  if (!name) return toast("Le nom est obligatoire", "error");
  if (name.length > 80) return toast("Le nom ne peut pas dépasser 80 caractères", "error");
  if (description.length > 200) return toast("La description ne peut pas dépasser 200 caractères", "error");
  if (isDuplicateTreeName(name, id || null)) return toast("Un arbre portant ce nom existe déjà", "error");
  await withButtonPending(submitButton, () => runSafely(async () => {
    const data = { name, description: description || "", updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.uid || "" };
    if (id) {
      await updateDoc(doc(db, "trees", id), data);
      const cachedTree = treeMetadata.find(item => item.id === id);
      if (cachedTree) Object.assign(cachedTree, { name, description: description || "" });
      updateTreeSelectorOptions();
      toast("Arbre renommé");
    } else {
      const created = await addDoc(refs.trees, { ...data, lifecycleState: TREE_LIFECYCLE_ACTIVE, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });
      const treeId = created.id;
      const cachedTree = treeMetadata.find(item => item.id === treeId);
      if (cachedTree) Object.assign(cachedTree, { name, description: description || "" });
      else treeMetadata.push({ id: treeId, name, description: description || "" });
      treeMetadata.sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
      toast("Arbre créé");
      setActiveTree(treeId);
    }
    close("treeDialog");
  }, "Enregistrement impossible"));
});

function acceptTreeCatalog(snapshot) {
  const records = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  treeMetadata = records.filter(item => item.id !== MAIN_TREE_ID
    && isValidTreeId(item.id)
    && typeof item.name === "string"
    && item.name.trim().length > 0
    && item.name.length <= 80)
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) || a.id.localeCompare(b.id));
  invalidTreeMetadataCount = records.length - treeMetadata.length;
  treeCatalogState = "ready";
  treeCatalogMessage = invalidTreeMetadataCount ? "Certaines métadonnées d’arbres invalides ont été ignorées." : "";
  const activeTreeUnavailable = updateTreeSelectorOptions();
  if (activeId && $("personDialog").open) updatePersonTreeMembershipLabel(person(activeId));
  updateTreeBranchOptions();
  if (loadedPeople && loadedFamilies) {
    if (activeTreeUnavailable) cameraPositioned = true;
    renderTree();
    if (activeTreeUnavailable) camera.fit();
  }
  if (loadedPeople && !$('directoryView').hidden) renderDirectory();
}

function rejectTreeCatalog(error) {
  console.warn("Lecture du catalogue d’arbres impossible; arbre principal conservé.", error);
  treeMetadata = [];
  invalidTreeMetadataCount = 0;
  treeCatalogState = "error";
  treeCatalogMessage = "Les arbres secondaires ne peuvent pas être chargés. L’arbre familial principal reste affiché.";
  const activeTreeUnavailable = updateTreeSelectorOptions();
  updateTreeBranchOptions();
  if (loadedPeople && loadedFamilies) {
    if (activeTreeUnavailable) cameraPositioned = true;
    renderTree();
    if (activeTreeUnavailable) camera.fit();
  }
  if (loadedPeople && !$('directoryView').hidden) renderDirectory();
}

function comparePeopleBySurname(a, b) {
  const surname = (a.lastName || "").localeCompare(b.lastName || "", "fr", { sensitivity: "base" });
  if (surname) return surname;
  const firstName = (a.firstName || "").localeCompare(b.firstName || "", "fr", { sensitivity: "base" });
  if (firstName) return firstName;
  return (a.middleName || "").localeCompare(b.middleName || "", "fr", { sensitivity: "base" });
}

function relationOptionName(item) {
  return [item.lastName?.toLocaleUpperCase("fr-FR"), item.firstName, item.middleName].filter(Boolean).join(" ");
}

function applyManualPositions(layout) {
  automaticPositions = new Map([...layout.positions].map(([id, position]) => [id, { ...position }]));
  for (const [id, offset] of Object.entries(manualOffsets)) {
    const position = layout.positions.get(id);
    if (!position) continue;
    position.x = Math.max(20, position.x + Number(offset.x || 0));
    // L'axe vertical reste calculé par la parenté afin d'aligner les générations.
    position.y = Math.max(20, position.y);
  }
  let maxX = 720, maxY = 460;
  for (const position of layout.positions.values()) {
    maxX = Math.max(maxX, position.x + position.width + layout.geometry.margin);
    maxY = Math.max(maxY, position.y + position.height + layout.geometry.margin);
  }
  layout.bounds = { ...layout.bounds, width: maxX, height: maxY };
  return layout;
}

const camera = createTreeCamera({
  viewport: $("treeViewport"),
  scene: $("treeScene"),
  onChange: state => { $("zoomLevel").textContent = `${Math.round(state.scale * 100)} %`; }
});

const treeViewportQuery = window.matchMedia("(max-width: 760px)");
let treeViewportPortrait = window.matchMedia("(orientation: portrait)").matches;
let treeViewportFitTimer = 0;

const renderer = createTreeRenderer({
  scene: $("treeScene"),
  onPersonClick: id => openPerson(person(id)),
  onEmptyAdd: () => openPerson(),
  shouldSuppressClick: () => camera.shouldSuppressClick(),
  getScale: () => camera.getState().scale,
  onPersonMove: (id, position) => {
    const automatic = automaticPositions.get(id);
    if (!automatic) return;
    manualOffsets[id] = { x: Math.round(position.x - automatic.x), y: 0 };
    saveOffsets();
    renderTree();
  }
});

// Bascule de comparaison OLD/NEW sans interface permanente (console).
if (typeof window !== "undefined") {
  window.familyTreeLayoutEngine = {
    get mode() { return treeLayoutEngine; },
    set(mode) {
      treeLayoutEngine = mode === "legacy" ? "legacy" : "hybrid";
      cameraPositioned = false;
      if (loadedPeople && loadedFamilies) renderTree();
      return treeLayoutEngine;
    }
  };
}

// Sonde à usage exclusif des tests de rendu (Playwright) : permet d'afficher
// une généalogie fictive et d'inspecter l'état réel de la caméra et des
// contrôles sans dépendre des données Firestore de production.
if (typeof window !== "undefined") {
  window.__treeProbe = {
    get state() { return camera.getState(); },
    layout: () => currentLayout,
    viewport: () => {
      const viewport = $("treeViewport");
      return { width: viewport.clientWidth, height: viewport.clientHeight, rect: viewport.getBoundingClientRect().toJSON() };
    },
    render(peopleData, familiesData) {
      people = peopleData;
      families = familiesData || [];
      loadedPeople = loadedFamilies = true;
      cameraPositioned = false;
      renderTree();
      return { state: camera.getState(), layout: currentLayout };
    },
    controls: () => {
      const selectors = ["#fitTreeBtn", "#treeMoreBtn", "#treeMenu", "#centerTreeBtn", "#autoLayoutBtn", "#menuFitBtn", "#zoomInBtn", "#zoomOutBtn", "#zoomLevel", ".zoom-control", ".view-control", ".tree-controls"];
      const out = {};
      selectors.forEach(sel => {
        const element = document.querySelector(sel);
        if (!element) { out[sel] = null; return; }
        const rect = element.getBoundingClientRect();
        out[sel] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      });
      return out;
    }
  };
}

function currentTreeScope() {
  const activeTreePeople = getTreePeople(people, activeTreeId);
  // Les personnes masquées de la scène restent membres de leur arbre : garder
  // leurs foyers ici préserve le filtrage historique que le layout sanitise ensuite.
  const basePeople = activeTreePeople.filter(item => item.inTree !== false);
  const baseFamilies = getTreeFamilies(families, activeTreePeople);
  if (branchView && basePeople.some(item => item.id === branchView.personId)) {
    try {
      return computeBranchView({ people: basePeople, families: baseFamilies, rootId: branchView.personId, ancestorDepth: branchView.ancestorDepth });
    } catch (error) {
      console.error(error);
      branchView = null;
    }
  } else if (branchView) {
    branchView = null;
  }
  if (lineageSurname) {
    const lineageScope = computeLineageScope({ people: basePeople, families: baseFamilies, surname: lineageSurname });
    if (lineageScope) return lineageScope;
  }
  return { people: basePeople, families: baseFamilies, hiddenAncestorCounts: new Map(), rootId: null };
}

/**
 * Contexte de hiérarchie transmis au renderer sans modifier le modèle ni le
 * moteur de layout : 'focus' pour le point focal choisi dans « Voir sa
 * branche » (la personne cliquée, jamais appelée « Souche »).
 */
function treeContextMarkers(scope) {
  const markers = new Map();
  if (scope.rootId && !scope.lineage) markers.set(scope.rootId, "focus");
  return markers;
}

function branchDepthLabel(depth) {
  if (depth === ALL_ANCESTORS || depth === Infinity) return "Toute l’ascendance";
  const value = Number(depth) || DEFAULT_ANCESTOR_DEPTH;
  return `${value} génération${value > 1 ? "s" : ""} d’ancêtres`;
}

function updateBranchBanner(scope = currentTreeScope()) {
  const banner = $("branchBanner");
  if (!banner) return;
  const active = !!(branchView && person(branchView.personId));
  banner.hidden = !active;
  document.querySelectorAll("[data-branch-depth]").forEach(button => {
    const value = button.dataset.branchDepth === "all" ? ALL_ANCESTORS : Number(button.dataset.branchDepth);
    const isActive = active && (branchView.ancestorDepth === value || (value === ALL_ANCESTORS && branchView.ancestorDepth === Infinity));
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll("#treeScene .branch-frontier").forEach(node => node.remove());
  if (!active) return;
  const item = person(branchView.personId);
  $("branchBannerName").textContent = item ? [item.firstName, item.lastName].filter(Boolean).join(" ") : "";
  $("branchBannerDepth").textContent = branchDepthLabel(branchView.ancestorDepth);
  const counts = scope.hiddenAncestorCounts || new Map();
  if (!counts.size) return;
  document.querySelectorAll("#treeScene [data-person-id]").forEach(card => {
    const count = counts.get(card.dataset.personId);
    if (!count) return;
    const badge = document.createElement("span");
    badge.className = "branch-frontier";
    badge.textContent = `↑ ${count} ancêtre${count > 1 ? "s" : ""}`;
    badge.title = `${count} ancêtre${count > 1 ? "s" : ""} supplémentaire${count > 1 ? "s" : ""}`;
    card.appendChild(badge);
  });
}

function computeTreeLayout(scope) {
  if (treeLayoutEngine === "legacy") return calculateTreeLayout(scope.people, scope.families);
  try {
    const layout = calculateHybridTreeLayout(scope.people, scope.families);
    const report = validateHybridLayout(layout, { peopleCount: scope.people.length });
    if (report.valid) return layout;
    console.warn("Layout hybride invalide, repli sur l'ancien moteur.", report);
  } catch (error) {
    console.error("Échec du layout hybride, repli sur l'ancien moteur.", error);
  }
  return calculateTreeLayout(scope.people, scope.families);
}

function clampTreeScale(value) {
  return Math.max(TREE_SCALE_MIN, Math.min(TREE_SCALE_MAX, value));
}

// Cadrage initial lisible : on affiche l'arbre entier seulement s'il tient à
// une échelle de lecture confortable ; sinon on se place sur la zone haute
// (premières générations) à un zoom où les cartes restent réellement lisibles.
const TREE_SCALE_MIN = 0.25, TREE_SCALE_MAX = 2, TREE_VIEW_PADDING = 64;
const TREE_CARD_WIDTH = 282, TREE_CARD_READABLE_WIDTH = 150;

function mergeTreeRects(base, rect) {
  if (!base) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const left = Math.min(base.x, rect.x);
  const top = Math.min(base.y, rect.y);
  const right = Math.max(base.x + base.width, rect.x + rect.width);
  const bottom = Math.max(base.y + base.height, rect.y + rect.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function frameInitialTreeView() {
  const bounds = currentLayout.bounds;
  const viewport = $("treeViewport");
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !viewportWidth || !viewportHeight) {
    camera.fit();
    return;
  }
  const fitScale = clampTreeScale(Math.min(
    (viewportWidth - TREE_VIEW_PADDING * 2) / bounds.width,
    (viewportHeight - TREE_VIEW_PADDING * 2) / bounds.height
  ));
  const readableScale = clampTreeScale(TREE_CARD_READABLE_WIDTH / TREE_CARD_WIDTH);
  const targetScale = Math.max(fitScale, readableScale);
  if (targetScale <= fitScale * 1.01) {
    camera.fit();
    return;
  }
  const bandBottom = bounds.y + Math.min(bounds.height * 0.5, viewportHeight / targetScale);
  let focusRect = null;
  for (const position of currentLayout.positions.values()) {
    if (position.y < bandBottom) focusRect = mergeTreeRects(focusRect, position);
  }
  camera.fit();
  camera.zoomBy(targetScale / fitScale);
  camera.focus(focusRect || { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.min(bounds.height, viewportHeight / targetScale) });
}

function renderTree() {
  if (!loadedPeople || !loadedFamilies) return;
  updateTreeSelectorOptions();
  updateTreeBranchOptions();
  const scope = currentTreeScope();
  currentScope = scope;
  const emptyMessage = $("treeEmptyMessage");
  if (emptyMessage) {
    const isEmptySecondary = scope.people.length === 0 && activeTreeId !== MAIN_TREE_ID;
    emptyMessage.hidden = !isEmptySecondary;
  }
  currentLayout = applyManualPositions(computeTreeLayout(scope));
  renderer.render(scope.people, currentLayout, treeContextMarkers(scope));
  renderer.setActive(activeId);
  camera.setBounds(currentLayout.bounds);
  if (!cameraPositioned) {
    frameInitialTreeView();
    cameraPositioned = true;
  }
  if (focusAfterRender && currentLayout.positions.has(focusAfterRender)) {
    camera.focus(currentLayout.positions.get(focusAfterRender));
    focusAfterRender = null;
  }
  applySearch(false);
  updateBranchBanner(scope);
}

// Sur mobile, un vrai changement d'orientation recadre l'arbre. Un simple
// redimensionnement (barre d'adresse, clavier virtuel) ou un resize desktop
// ne déclenche aucun fit.
function scheduleTreeViewportFit() {
  clearTimeout(treeViewportFitTimer);
  treeViewportFitTimer = setTimeout(() => {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    if (portrait === treeViewportPortrait) return;
    treeViewportPortrait = portrait;
    if (treeViewportQuery.matches && !$("appMain").hidden) camera.fit();
  }, 180);
}

window.addEventListener("orientationchange", scheduleTreeViewportFit);
window.addEventListener("resize", scheduleTreeViewportFit, { passive: true });

// Export PNG de l'arbre entier cadré, fidèle à la vue courante (positions et
// couleurs réutilisées) ; les photos externes sont pré-chargées en CORS pour
// ne pas souiller le canvas et retombent sur les initiales en cas d'échec.
async function exportTreeImage(format = "png") {
  const buttons = [$("menuExportTreeBtn")].filter(Boolean);
  const setBusy = pending => buttons.forEach(button => { button.disabled = pending; button.setAttribute("aria-busy", String(pending)); });
  if (!treePeople().length || !currentLayout) {
    toast("Aucun arbre à exporter", "error");
    return;
  }
  setBusy(true);
  let svgUrl;
  let canvas;
  try {
    const scope = currentTreeScope();
    const markers = treeContextMarkers(scope);
    const layout = currentLayout;
    const photoUrls = new Map();
    // SVG conserve davantage de détails photo ; aucun bitmap ne peut zoomer à l’infini.
    const PHOTO_EXPORT_MAX_EDGE = format === "svg" ? 512 : 128;
    // Chargement séquentiel pour ne pas décoder toutes les photos simultanément.
    for (const person of scope.people) {
      const url = person.photoUrl;
      if (!url) continue;
      await new Promise(resolve => {
        const image = new Image();
        const timer = setTimeout(() => { image.onload = image.onerror = null; image.src = ""; resolve(); }, 10000);
        const finish = () => { clearTimeout(timer); resolve(); };
        if (!/^data:/i.test(url)) image.crossOrigin = "anonymous";
        image.onload = () => {
          let photoCanvas;
          try {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            if (!width || !height) return finish();
            const crop = Math.min(width, height);
            photoCanvas = document.createElement("canvas");
            photoCanvas.width = photoCanvas.height = Math.min(crop, PHOTO_EXPORT_MAX_EDGE);
            const context = photoCanvas.getContext("2d");
            if (!context) return finish();
            context.drawImage(image, (width-crop)/2, (height-crop)/2, crop, crop, 0, 0, photoCanvas.width, photoCanvas.height);
            photoUrls.set(person.id, photoCanvas.toDataURL("image/png"));
          } catch (error) {
            console.warn("Photo ignorée dans l’export de l’arbre :", error);
          } finally {
            if (photoCanvas) photoCanvas.width = photoCanvas.height = 1;
          }
          finish();
        };
        image.onerror = finish;
        image.src = url;
      });
    }
    const cards = await captureTreeExportCards($("treeScene"), layout, photoUrls);
    const svgText = treeExportSvg({ people: scope.people, layout, markers, photoUrls, cards });
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    let file = svgBlob;
    if (format !== "svg") {
      svgUrl = URL.createObjectURL(svgBlob);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Export de l’image impossible"));
        image.src = svgUrl;
      });
      const raster = treeExportRasterDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
      canvas = document.createElement("canvas");
      canvas.width = raster.width;
      canvas.height = raster.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas d’export indisponible");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      file = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!file) throw new Error("Export de l’image impossible");
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = `arbre-familial-${new Date().toISOString().slice(0, 10)}.${format === "svg" ? "svg" : "png"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast(`Image de l’arbre exportée · ${formatBytes(file.size)}`);
  } catch (error) {
    console.error(error);
    toast(error.message || "Export de l’image impossible", "error");
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl);
    if (canvas) canvas.width = canvas.height = 1;
    setBusy(false);
  }
}

function activateBranchView(personId) {
  const item = person(personId);
  if (!item) return;
  const depth = branchView && branchView.ancestorDepth ? branchView.ancestorDepth : DEFAULT_ANCESTOR_DEPTH;
  lineageSurname = "";
  if ($("treeBranchFilter")) $("treeBranchFilter").value = "";
  branchView = { personId, ancestorDepth: depth };
  if ($("personDialog").open) close("personDialog");
  setView("tree");
  focusAfterRender = personId;
  renderTree();
}

function exitBranchView() {
  if (!branchView) return;
  branchView = null;
  renderTree();
  camera.fit();
  toast("Arbre complet restauré");
}

function syncState() {
  if (loadedPeople && loadedFamilies && loadedDocuments && loadedTasks && loadedProcedures) {
    $("syncDot").classList.add("ok");
    $("syncText").textContent = "Synchronisé";
    $("syncText").closest(".status")?.setAttribute("data-state", "saved");
  }
  if (loadedPeople && loadedFamilies) {
    setLoadingSurface("treeViewport", false);
    renderTree();
  }
}

function setLoadingSurface(id, loading) {
  const element = $(id);
  if (!element) return;
  element.classList.toggle("loading-surface", loading);
  element.setAttribute("aria-busy", String(loading));
}

function updateReadyViews() {
  if (loadedPeople && loadedDocuments) {
    setLoadingSurface("directoryList", false);
    setLoadingSurface("documentsList", false);
    updateDirectoryBranches();
    renderDirectory();
    renderDocuments();
  }
  if (loadedPeople && loadedTasks) {
    setLoadingSurface("tasksList", false);
    renderTasks();
  }
  if (loadedProcedures) {
    setLoadingSurface("proceduresList", false);
    renderProcedures();
  }
  if (genealogyLoaded) renderGenealogyWorkspace();
}

function applySearch(focus = true) {
  const query = searchable($("search").value);
  const scopePeople = currentScope?.people || treePeople();
  const matches = query ? scopePeople.filter(item => searchable(`${item.firstName} ${item.middleName || ""} ${item.lastName} ${item.marriedName || ""} ${item.place || ""} ${item.branch || ""} ${genealogyDateSearchText(item.birthDateInfo, item.birthDate)} ${genealogyDateSearchText(item.deathDateInfo, item.deathDate)}`).includes(query)) : [];
  renderer.setHighlights(matches.map(item => item.id));
  if (focus && matches[0] && currentLayout?.positions.has(matches[0].id)) camera.focus(currentLayout.positions.get(matches[0].id));
}

function personDocThumbSource(item) {
  if (item.chunkCount) return "";
  const source = item.fileUrl || item.externalUrl || (typeof item.fileData === "string" && item.fileData.startsWith("data:image/") ? item.fileData : "");
  if (!source) return "";
  const mime = String(item.mimeType || "").startsWith("image/");
  return mime || /^data:image\//.test(source) ? source : "";
}

function personDocCard(item) {
  const label = documentDisplayLabel(item);
  const thumb = personDocThumbSource(item);
  const type = item.type || item.fileName || "Document";
  const date = item.date ? new Date(item.date + "T12:00:00").toLocaleDateString("fr-FR") : "";
  const preview = thumb
    ? `<img class="person-doc-thumb-img" src="${esc(thumb)}" alt="" loading="lazy">`
    : `<span class="person-doc-tile" aria-hidden="true">${icon("document", "ui-icon-lg")}</span>`;
  return `<article class="person-doc-card" tabindex="0" aria-label="Consulter ${esc(label)}" data-view-document="${item.id}"><div class="person-doc-thumb">${preview}</div><div class="person-doc-meta"><strong class="person-doc-title">${esc(label)}</strong><span class="person-doc-subrow"><span class="person-doc-type">${esc(type)}</span>${date ? `<time class="person-doc-date">${esc(date)}</time>` : ""}<button class="btn small person-doc-edit" type="button" data-edit-person-document="${item.id}">${icon("edit")}<span class="sr-only">Modifier</span></button></span></div></article>`;
}

function renderPersonDocuments(personId) {
  const linked = documents.filter(item => (item.personIds || []).includes(personId));
  $("personDocumentsList").innerHTML = linked.length
    ? `<div class="person-doc-gallery">${linked.map(personDocCard).join("")}</div>`
    : emptyState({ iconName: "document", title: "Aucun document associé", description: "Les documents ajoutés pour cette personne apparaîtront ici." });
  const linkedProofs = genealogyRecords.genealogyProofs.filter(item => (genealogyRecordData(item).personIds || []).includes(personId));
  const linkedConclusions = genealogyRecords.factConclusions.filter(conclusion => linkedProofs.some(proof => genealogyRecordData(proof).factId === genealogyRecordData(conclusion).factId));
  const evidence = [
    ...linkedProofs.map(item => ({ kind: "proof", record: item, data: genealogyRecordData(item) })),
    ...linkedConclusions.map(item => ({ kind: "conclusion", record: item, data: genealogyRecordData(item) }))
  ];
  $("personGenealogyEvidenceList").innerHTML = evidence.length
    ? evidence.map(item => `<article class="person-doc-card"><div class="person-doc-meta"><strong class="person-doc-title">${esc(item.data.factType || item.data.factId || item.kind)}</strong><span class="person-doc-subrow">${esc(genealogyKindLabels[item.kind])} · ${esc(item.data.technicalStatus || item.data.status || "à examiner")}</span><button class="btn small" type="button" data-open-genealogy="${esc(item.kind)}" data-genealogy-id="${esc(item.record.id)}">Consulter</button></div></article>`).join("")
    : emptyState({ iconName: "document", title: "Aucune preuve associée", description: "Les preuves concernant cette personne apparaîtront ici après leur enregistrement." });
}

function setPersonSection(section = "identity", focusTab = false) {
  const normalized = ["identity", "relations", "documents"].includes(section) ? section : "identity";
  activePersonSection = normalized;
  document.querySelectorAll("[data-person-section]").forEach(button => {
    const active = button.dataset.personSection === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focusTab) button.focus();
  });
  document.querySelectorAll("[data-person-panel]").forEach(panel => {
    panel.hidden = panel.dataset.personPanel !== normalized;
  });
  const hasPerson = !!$("personId").value;
  $("personRelationsUnavailable").hidden = hasPerson;
  $("personRelationsContent").hidden = !hasPerson;
  $("personDocumentsUnavailable").hidden = hasPerson;
  $("personDocumentsSection").hidden = !hasPerson;
  if (hasPerson && normalized === "identity") renderLifeTimeline();
  if (hasPerson && normalized === "relations") renderRelations();
  if (hasPerson && normalized === "documents") renderPersonDocuments($("personId").value);
}

/* Icônes du parcours de vie : une seule famille graphique (sprite existant),
   mêmes épaisseur/couleurs que le Design System, décoratives (aria-hidden).
   naissance → sparkles · union → heart · séparation/divorce → unlink
   · décès → cross · autre → calendar (repère neutre). */
function timelineTypeIcon(event) {
  if (event.type === "birth") return "sparkles";
  if (event.type === "death") return "cross";
  if (event.type === "union") {
    const text = `${event.title} ${event.detail}`.toLowerCase();
    if (text.includes("séparation") || text.includes("divorce")) return "unlink";
    return "heart";
  }
  return "calendar";
}

function timelineItemHtml(event) {
  const date = event.date !== "—" ? `<span class="timeline-date">${esc(event.date)}</span>` : "";
  const detail = event.detail ? `<span class="timeline-detail">${esc(event.detail)}</span>` : "";
  const iconMarkup = `<svg class="ui-icon timeline-icon" aria-hidden="true"><use href="#icon-${timelineTypeIcon(event)}"></use></svg>`;
  return `<li class="timeline-jalon ${event.type}"><span class="timeline-dot" aria-hidden="true"></span><div class="timeline-content"><span class="timeline-line">${iconMarkup}<strong class="timeline-title">${esc(event.title)}</strong>${date}</span>${detail}</div></li>`;
}

function renderLifeTimeline() {
  const container = $("personLifeTimeline");
  if (!container) return;
  const item = activeId ? person(activeId) : null;
  const events = item ? lifeTimelineEvents(item, { people, families }) : [];
  container.hidden = !events.length;
  container.innerHTML = events.length
    ? `<h3 class="timeline-heading"><svg class="ui-icon timeline-icon" aria-hidden="true"><use href="#icon-history"></use></svg>Parcours de vie</h3><ol class="life-timeline-list">${events.map(timelineItemHtml).join("")}</ol>`
    : "";
}

function updateMarriedNameVisibility() {
  // Le champ historique reste nommé `marriedName` pour préserver les données,
  // mais son usage est désormais neutre et accessible à toutes les personnes.
  $("marriedNameField").hidden = false;
}

function updatePersonPhotoPreview() {
  const value = $("photoUrl").value;
  const current = person($("personId").value);
  $("personPhotoPreview").innerHTML = value
    ? `<img src="${esc(value)}" alt="">`
    : esc(personInitials({ firstName: $("firstName").value || current?.firstName, lastName: $("lastName").value || current?.lastName }));
  $("removePersonPhotoBtn").hidden = !value;
}

function capturePersonDraft() {
  return {
    fields: Object.fromEntries(personFields.map(key => [key, $(key).value])),
    locations: { place: locationControls.place?.snapshot(), deathPlace: locationControls.deathPlace?.snapshot() },
    birth: captureGenealogyDateDraft("birth"),
    death: captureGenealogyDateDraft("death")
  };
}

function restorePersonDraft(draft) {
  if (!draft) return;
  for (const key of personFields) {
    if (Object.prototype.hasOwnProperty.call(draft.fields || draft, key)) $(key).value = (draft.fields || draft)[key];
  }
  setLocationField("place", draft.locations?.place?.text ?? $("place").value, draft.locations?.place?.placeInfo);
  setLocationField("deathPlace", draft.locations?.deathPlace?.text ?? $("deathPlace").value, draft.locations?.deathPlace?.placeInfo);
  restoreGenealogyDateDraft("birth", draft.birth);
  restoreGenealogyDateDraft("death", draft.death);
  updateMarriedNameVisibility();
  updatePersonPhotoPreview();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Lecture de la photo impossible"));
    reader.readAsDataURL(blob);
  });
}

async function loadPhotoSource(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Format d’image non pris en charge"));
    image.src = url;
  });
  return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

async function compressPersonPhoto(file) {
  if (!file?.type.startsWith("image/")) throw new Error("Choisissez un fichier image");
  const source = await loadPhotoSource(file);
  const crop = Math.min(source.width, source.height);
  const sourceX = (source.width - crop) / 2;
  const sourceY = (source.height - crop) / 2;
  const attempts = [
    [192, .84], [160, .82], [128, .80], [112, .78], [96, .76],
    [80, .72], [64, .68], [64, .52], [64, .38], [64, .26]
  ];
  let smallest = null;
  try {
    for (const [size, quality] of attempts) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#f7f3ea";
      context.fillRect(0, 0, size, size);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source.image, sourceX, sourceY, crop, crop, 0, 0, size, size);
      for (const mimeType of ["image/webp", "image/jpeg"]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
        if (!blob) continue;
        const dataUrl = await blobToDataUrl(blob);
        const encodedBytes = new Blob([dataUrl]).size;
        if (!smallest || encodedBytes < smallest.encodedBytes) smallest = { dataUrl, encodedBytes };
        if (encodedBytes <= MAX_PERSON_PHOTO_BYTES) return { dataUrl, encodedBytes };
      }
    }
  } finally {
    source.close();
  }
  if (smallest?.encodedBytes <= MAX_PERSON_PHOTO_BYTES) return smallest;
  throw new Error("La photo ne peut pas être réduite sous 5 Ko. Essayez une image plus simple.");
}

function canChangePersonTree(item) {
  if (!item || !isAdminUser() || treeCatalogState !== "ready") return false;
  const membership = getPersonTreeMembership(item);
  return membership.type === "unassigned"
    || (membership.type === "assigned" && (membership.treeId === MAIN_TREE_ID || treeMetadata.some(tree => tree.id === membership.treeId)));
}

function updatePersonTreeMembershipLabel(item) {
  const label = $("personTreeMembershipLabel");
  const value = $("personTreeMembershipName");
  if (!item) {
    label.hidden = true;
    value.textContent = "";
    return;
  }
  const membership = getPersonTreeMembership(item);
  value.textContent = membership.type === "unassigned"
    ? "Aucun arbre"
    : membership.type === "unavailable"
      ? "Arbre indisponible"
      : membership.treeId === MAIN_TREE_ID
        ? "Arbre principal"
        : treeMetadata.find(tree => tree.id === membership.treeId)?.name || "Arbre indisponible";
  label.hidden = false;
}

function updatePersonMenuActions(item) {
  const membership = item ? getPersonTreeMembership(item) : null;
  const isAssigned = membership?.type === "assigned";
  const isUnassigned = membership?.type === "unassigned";
  const adminActionsAvailable = !!item && isAdminUser() && treeCatalogState === "ready";
  $("personMenuBtn").hidden = !item;
  $("printPersonBtn").hidden = !item;
  $("viewBranchBtn").hidden = !item || !isAssigned;
  $("changePersonTreeBtn").hidden = !adminActionsAvailable || (!isAssigned && !isUnassigned);
  $("changePersonTreeLabel").textContent = isUnassigned ? "Affecter à un arbre" : "Changer d’arbre";
  $("removePersonFromTreeBtn").hidden = !adminActionsAvailable || !isAssigned;
  $("deleteBtn").hidden = !item;
  updatePersonTreeMembershipLabel(item);
}

function openPerson(item = null, source = "tree") {
  personDialogSource = source;
  if (item) {
    pendingPersonCreateId = "";
  } else {
    personCreationTreeId = source === "tree" ? activeTreeId : MAIN_TREE_ID;
    pendingPersonCreateId = doc(refs.people).id;
  }
  activeId = item?.id || null;
  renderer.setActive(activeId);
  setPersonMenu(false);
  updatePersonMenuActions(item);
  const titleName = item ? [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ") : "";
  $("dialogTitle").textContent = item ? (titleName || "Modifier la personne") : "Nouvelle personne";
  const modMeta = item ? personModMetaParts(item) : null;
  $("personDialogMeta").innerHTML = modMeta
    ? `<span class="meta-long">${esc(modMeta.long)}</span><span class="meta-short">${esc(modMeta.short)}</span>`
    : "Les champs marqués d’un astérisque sont obligatoires.";
  $("savePersonBtn").textContent = item ? "Enregistrer" : "Continuer";
  $("restoreTreeBtn").hidden = !item || item.inTree !== false || source !== "directory"
    || getPersonTreeMembership(item).type !== "assigned";
  $("personId").value = item?.id || "";
  const isCreating = !item;
  $("personTreeAssignment").hidden = !isCreating || source !== "tree";
  $("personTreeSelectWrap").hidden = !isCreating || source !== "directory";
  if (isCreating && source === "tree") {
    const activeTree = personCreationTreeId === MAIN_TREE_ID ? null : treeMetadata.find(tree => tree.id === personCreationTreeId);
    $("personTreeAssignmentName").textContent = personCreationTreeId === MAIN_TREE_ID
      ? "Arbre familial"
      : activeTree?.name || "Arbre indisponible";
  }
  if (isCreating && source === "directory") {
    updatePersonTreeOptions();
    $("personTreeSelect").value = MAIN_TREE_ID;
  }
  for (const key of personFields) $(key).value = item?.[key] || "";
  setLocationField("place", item?.place || "", item?.birthPlaceInfo);
  setLocationField("deathPlace", item?.deathPlace || "", item?.deathPlaceInfo);
  setGenealogyDateForm("birth", item?.birthDateInfo, item?.birthDate);
  setGenealogyDateForm("death", item?.deathDateInfo, item?.deathDate);
  $("personPhotoFile").value = "";
  $("personPhotoStatus").textContent = "";
  updatePersonPhotoPreview();
  updateMarriedNameVisibility();
  if (item) renderPersonDocuments(item.id);
  $("relationBuilder").hidden = true;
  $("toggleRelationBuilderBtn").setAttribute("aria-expanded", "false");
  setRelationBuilderKind("parent");
  setPersonSection("identity");
  $("personDialog").showModal();
  setTimeout(() => $("firstName").focus(), 30);
}

function close(id) {
  const dialog = $(id);
  if (dialog.open) dialog.close();
  if (id === "documentViewerDialog" && activeViewerUrl) {
    URL.revokeObjectURL(activeViewerUrl);
    activeViewerUrl = "";
    $("viewerFrame").removeAttribute("src");
    $("viewerImage").removeAttribute("src");
  }
  if (id === "personDialog") {
    activeId = null;
    renderer.setActive(null);
  }
}

function availableOptions(exclude = []) {
  const excluded = new Set(exclude);
  return '<option value="">Sélectionner…</option>' + people
    .filter(item => !excluded.has(item.id))
    .sort(comparePeopleBySurname)
    .map(item => `<option value="${item.id}">${esc(relationOptionName(item))}</option>`).join("");
}

async function ensurePeopleInTree(ids = []) {
  const hiddenIds = [...new Set(ids)].filter(id => person(id)?.inTree === false);
  if (!hiddenIds.length) return;
  const batch = writeBatch(db);
  hiddenIds.forEach(id => batch.update(doc(db, "people", id), { inTree: true, updatedAt: serverTimestamp() }));
  await batch.commit();
}

function openRelations() {
  const item = person(activeId);
  if (!item) return;
  setPersonSection("relations", true);
}

function relationAvatarMarkup(item) {
  return item?.photoUrl ? `<img src="${esc(item.photoUrl)}" alt="">` : esc(personInitials(item));
}

function relationRole(item, kind) {
  if (kind === "parent") return item?.gender === "F" ? "Mère" : item?.gender === "M" ? "Père" : "Parent";
  if (kind === "child") return item?.gender === "F" ? "Fille" : item?.gender === "M" ? "Fils" : "Enfant";
  return "Partenaire";
}

function relationMetadata(parts = []) {
  const values = parts.filter(value => value && value !== "—" && value !== "Non précisé" && value !== "Non précisée");
  return values.length ? `<p class="relation-person-meta">${values.map(value => esc(value)).join(" <span aria-hidden=\"true\">·</span> ")}</p>` : "";
}

function relationActions({ familyId, personId = "", removeType = "", detailsLabel = "Détails du lien", removeLabel = "Dissocier", accessibleName = "cette relation" }) {
  const remove = removeType
    ? `<button class="relation-menu-action danger" type="button" data-remove-${removeType}="${familyId}" data-person="${personId}">${icon("unlink")}<span>${esc(removeLabel)}</span></button>`
    : "";
  return `<details class="relation-actions-menu"><summary aria-label="Actions pour ${esc(accessibleName)}" title="Actions">⋯</summary><div class="relation-actions-popover"><button class="relation-menu-action" type="button" data-edit-family="${familyId}">${icon("edit")}<span>${esc(detailsLabel)}</span></button>${remove}</div></details>`;
}

function relationPersonRow({ relative, family, kind, meta = [], removeType = "", removePersonId = "", detailsLabel = "Détails du lien", removeLabel = "Dissocier" }) {
  if (!relative) return "";
  return `<article class="relation-person-row"><span class="relation-person-avatar">${relationAvatarMarkup(relative)}</span><div class="relation-person-copy"><strong>${esc(relationOptionName(relative))}</strong>${relationMetadata([relationRole(relative, kind), ...meta])}</div>${relationActions({ familyId: family.id, personId: removePersonId, removeType, detailsLabel, removeLabel, accessibleName: relationOptionName(relative) })}</article>`;
}

function relationGroup(title, entries, emptyLabel, footer = "") {
  return `<section class="relation-group"><header class="relation-group-head"><h4>${esc(title)}</h4><span>${entries.length}</span></header><div class="relation-group-list">${entries.length ? entries.join("") : `<p class="relation-group-empty">${esc(emptyLabel)}</p>`}</div>${footer}</section>`;
}

function setRelationBuilderKind(kind = "parent") {
  const normalized = ["parent", "partner", "child"].includes(kind) ? kind : "parent";
  document.querySelectorAll("[data-relation-kind]").forEach(button => {
    const active = button.dataset.relationKind === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-relation-add-panel]").forEach(panel => {
    panel.hidden = panel.dataset.relationAddPanel !== normalized;
  });
}

function setRelationBuilderOpen(open, kind = "parent") {
  $("relationBuilder").hidden = !open;
  $("toggleRelationBuilderBtn").setAttribute("aria-expanded", String(open));
  if (open) {
    setRelationBuilderKind(kind);
    setTimeout(() => document.querySelector(`[data-relation-add-panel="${kind}"] select`)?.focus(), 30);
  } else {
    $("toggleRelationBuilderBtn").focus();
  }
}

function renderRelations() {
  const item = person(activeId);
  if (!item) return;
  const parentFamilies = families.filter(family => (family.childIds || []).includes(item.id));
  const ownFamilies = families.filter(family => (family.partnerIds || []).includes(item.id));
  const parentEntries = parentFamilies.flatMap(family => (family.partnerIds || []).map(parentId => {
    const relative = person(parentId);
    const filiationType = parentChildLinkType(family, parentId, item.id);
    const filiation = filiationType === "unknown" ? "" : `Filiation ${FILIATION_TYPE_LABELS[filiationType].toLocaleLowerCase("fr-FR")}`;
    return { relative, family, html: relationPersonRow({ relative, family, kind: "parent", meta: [filiation], detailsLabel: "Détails de la famille" }) };
  })).filter(entry => entry.relative).sort((a, b) => comparePeopleBySurname(a.relative, b.relative));
  const partnerEntries = ownFamilies.flatMap(family => (family.partnerIds || []).filter(id => id !== item.id).map(partnerId => {
    const relative = person(partnerId);
    const relationType = normalizeRelationType(family.relationType);
    const endType = normalizeEndType(family.endType);
    const unionDate = formatGenealogyDate(family.unionDateInfo, family.marriageDate || family.unionDate);
    const endDate = formatGenealogyDate(family.endDateInfo, family.separationDate || family.divorceDate);
    const childCount = (family.childIds || []).length;
    const meta = [
      relationType === "unknown" ? "" : RELATION_TYPE_LABELS[relationType],
      unionDate === "—" ? "" : unionDate,
      ["none", "unknown"].includes(endType) ? "" : `${END_TYPE_LABELS[endType]}${endDate === "—" ? "" : ` · ${endDate}`}`,
      childCount ? `${childCount} enfant${childCount > 1 ? "s" : ""}` : ""
    ];
    return { relative, family, html: relationPersonRow({ relative, family, kind: "partner", meta, removeType: "partner", removePersonId: partnerId, detailsLabel: "Détails de l’union", removeLabel: "Dissocier le partenaire" }) };
  })).filter(entry => entry.relative).sort((a, b) => comparePeopleBySurname(a.relative, b.relative));
  const childEntries = ownFamilies.flatMap(family => (family.childIds || []).map(childId => {
    const relative = person(childId);
    const filiationType = parentChildLinkType(family, item.id, childId);
    const filiation = filiationType === "unknown" ? "" : `Filiation ${FILIATION_TYPE_LABELS[filiationType].toLocaleLowerCase("fr-FR")}`;
    const otherParents = (family.partnerIds || []).filter(id => id !== item.id).map(nameOf);
    return { relative, family, html: relationPersonRow({ relative, family, kind: "child", meta: [filiation, otherParents.length ? `Avec ${otherParents.join(" et ")}` : ""], removeType: "child", removePersonId: childId, detailsLabel: "Détails du lien", removeLabel: "Dissocier l’enfant" }) };
  })).filter(entry => entry.relative).sort((a, b) => comparePeopleBySurname(a.relative, b.relative));

  const parentCount = parentEntries.length;
  const partnerCount = partnerEntries.length;
  const childCount = childEntries.length;
  const total = parentCount + partnerCount + childCount;
  $("relationsSummary").textContent = total
    ? `${parentCount} parent${parentCount > 1 ? "s" : ""} · ${partnerCount} partenaire${partnerCount > 1 ? "s" : ""} · ${childCount} enfant${childCount > 1 ? "s" : ""}`
    : "Aucun lien familial";

  if (!total) {
    $("relationsList").innerHTML = emptyState({ iconName: "link", title: "Aucun lien familial", description: "Ajoutez un parent, un partenaire ou un enfant pour commencer à relier cette personne à l’arbre." });
  } else {
    const parentFooter = parentFamilies.length
      ? `<div class="relation-group-footer">${parentFamilies.map(family => `<button class="btn tertiary danger" type="button" data-remove-child="${family.id}" data-person="${item.id}">${icon("unlink")}<span>Dissocier de ce groupe de parents</span></button>`).join("")}</div>`
      : "";
    $("relationsList").innerHTML = [
      relationGroup("Parents", parentEntries.map(entry => entry.html), "Aucun parent renseigné", parentFooter),
      relationGroup("Partenaires et unions", partnerEntries.map(entry => entry.html), "Aucun partenaire renseigné"),
      relationGroup("Enfants", childEntries.map(entry => entry.html), "Aucun enfant renseigné")
    ].join("");
  }
  const options = availableOptions([item.id]);
  $("partnerSelect").innerHTML = options;
  $("childSelect").innerHTML = options;
  $("parentSelect").innerHTML = options;
  $("parent2Select").innerHTML = options;
  const hasSingleParentFamily = ownFamilies.some(family => (family.partnerIds || []).length === 1);
  $("childFamilySelect").innerHTML = (hasSingleParentFamily ? "" : '<option value="new">Cette personne uniquement</option>') + ownFamilies.map(family => {
    const others = (family.partnerIds || []).filter(id => id !== item.id);
    return `<option value="${family.id}">${others.length ? `Avec ${esc(others.map(nameOf).join(" et "))}` : "Cette personne uniquement"}</option>`;
  }).join("");
  renderLifeTimeline();
}

async function addPartner() {
  const other = $("partnerSelect").value;
  if (!other) return toast("Choisissez une personne", "error");
  if (ancestorsOf(activeId).has(other) || ancestorsOf(other).has(activeId)) return toast("Un lien de couple ne peut pas relier un parent à son descendant", "error");
  if (families.some(family => {
    const ids = new Set(family.partnerIds || []);
    return ids.has(activeId) && ids.has(other);
  })) return toast("Cette union existe déjà", "info");
  await ensurePeopleInTree([activeId, other]);
  const single = families.find(family => (family.partnerIds || []).length === 1 && (family.partnerIds || []).includes(activeId));
  if (single) {
    const nextFamily = { ...single, partnerIds: [activeId, other] };
    await updateDoc(doc(db, "families", single.id), { partnerIds: nextFamily.partnerIds, parentChildLinks: normalizedParentChildLinks(nextFamily), updatedAt: serverTimestamp() });
  } else await addDoc(refs.families, { partnerIds: [activeId, other], childIds: [], relationType: "unknown", unionDateInfo: { type: "unknown" }, unionPlace: "", endType: "none", endDateInfo: { type: "unknown" }, endPlace: "", parentChildLinks: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  setRelationBuilderOpen(false);
  toast("Partenaire ajouté");
}

async function addChild() {
  const child = $("childSelect").value;
  if (!child) return toast("Choisissez un enfant", "error");
  const familyId = $("childFamilySelect").value;
  const family = familyId === "new" ? null : families.find(item => item.id === familyId);
  if (familyId !== "new" && !family) return toast("Ce foyer est introuvable", "error");
  try {
    const types = Object.fromEntries((family?.partnerIds || [activeId]).map(parentId => [parentId, $("childFiliationType").value]));
    await linkChildToParents(child, family?.partnerIds || [activeId], family?.id || "", types);
    setRelationBuilderOpen(false);
    toast("Enfant rattaché");
  } catch (error) { toast(error.message || "Lien impossible", "error"); }
}

async function addParent() {
  const firstParentId = $("parentSelect").value;
  const secondParentId = $("parent2Select").value;
  if (!firstParentId) return toast("Choisissez au moins un parent", "error");
  if (firstParentId === secondParentId) return toast("Choisissez deux personnes différentes", "error");
  try {
    const parentIds = [firstParentId, secondParentId].filter(Boolean);
    const linkTypes = { [firstParentId]: $("parentFiliationType").value };
    if (secondParentId) linkTypes[secondParentId] = $("parent2FiliationType").value;
    await linkChildToParents(activeId, parentIds, "", linkTypes);
    setRelationBuilderOpen(false);
    toast(parentIds.length > 1 ? "Parents rattachés" : "Parent rattaché");
  } catch (error) { toast(error.message || "Lien impossible", "error"); }
}

async function removeRelation(familyId, personId, type) {
  const family = families.find(item => item.id === familyId);
  if (!family) return;
  const removesCurrentFromParentGroup = type !== "partner" && personId === activeId && (family.partnerIds || []).length > 1;
  const consequence = type === "partner"
    ? "Dissocier ce partenaire ? Les fiches des deux personnes resteront dans l’annuaire."
    : removesCurrentFromParentGroup
      ? "Dissocier cette personne de ce groupe de parents ? Ses liens avec les deux parents seront retirés, mais toutes les fiches resteront dans l’annuaire."
      : "Dissocier ce lien parent-enfant ? Les fiches des personnes resteront dans l’annuaire.";
  if (!confirm(consequence)) return;
  const field = type === "partner" ? "partnerIds" : "childIds";
  const next = (family[field] || []).filter(id => id !== personId);
  if (field === "partnerIds" && !next.length) await deleteDoc(doc(db, "families", familyId));
  else {
    const nextFamily = { ...family, [field]: next };
    await updateDoc(doc(db, "families", familyId), { [field]: next, parentChildLinks: normalizedParentChildLinks(nextFamily), updatedAt: serverTimestamp() });
  }
  toast("Lien familial dissocié");
}

function ancestorsOf(personId, seen = new Set()) {
  if (seen.has(personId)) return seen;
  for (const family of families.filter(item => (item.childIds || []).includes(personId))) {
    for (const parentId of family.partnerIds || []) {
      if (!seen.has(parentId)) {
        seen.add(parentId);
        ancestorsOf(parentId, seen);
      }
    }
  }
  return seen;
}

function sameIds(left = [], right = []) {
  const a = [...new Set(left)].sort(), b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

async function linkChildToParents(childId, requestedParentIds, preferredFamilyId = "", linkTypes = {}) {
  const parentIds = [...new Set(requestedParentIds.filter(Boolean))];
  if (!childId || !parentIds.length) throw new Error("Choisissez l’enfant et au moins un parent");
  if (parentIds.length > 2) throw new Error("Un foyer ne peut pas contenir plus de deux parents");
  if (parentIds.includes(childId)) throw new Error("Une personne ne peut pas être son propre parent");
  if (parentIds.some(parentId => ancestorsOf(parentId).has(childId))) throw new Error("Ce lien créerait une boucle dans l’arbre");

  const childFamilies = families.filter(item => (item.childIds || []).includes(childId));
  if (childFamilies.length > 1) throw new Error("Cette personne est déjà rattachée à plusieurs foyers. Corrigez d’abord ses liens existants.");
  let family = preferredFamilyId ? families.find(item => item.id === preferredFamilyId) : childFamilies[0];
  if (family && childFamilies.length && childFamilies[0].id !== family.id) throw new Error("Cet enfant est déjà rattaché à un autre foyer");
  if (!family) family = families.find(item => sameIds(item.partnerIds || [], parentIds));

  const mergedParents = [...new Set([...(family?.partnerIds || []), ...parentIds])];
  if (mergedParents.length > 2) throw new Error("Cet enfant possède déjà deux parents dans son foyer");
  if (mergedParents.includes(childId)) throw new Error("Une personne ne peut pas être partenaire et enfant dans le même foyer");
  if (family && (family.childIds || []).includes(childId) && sameIds(family.partnerIds || [], mergedParents)) throw new Error("Ce lien existe déjà");

  await ensurePeopleInTree([childId, ...mergedParents]);
  const nextFamily = { ...(family || {}), partnerIds: mergedParents, childIds: [...new Set([...(family?.childIds || []), childId])] };
  const parentChildLinks = normalizedParentChildLinks(nextFamily).map(link => link.childId === childId && Object.prototype.hasOwnProperty.call(linkTypes, link.parentId) ? { ...link, type: normalizeFiliationType(linkTypes[link.parentId]) } : link);
  if (family) {
    await updateDoc(doc(db, "families", family.id), {
      partnerIds: mergedParents,
      childIds: nextFamily.childIds,
      parentChildLinks,
      updatedAt: serverTimestamp()
    });
  } else {
    await addDoc(refs.families, { partnerIds: mergedParents, childIds: [childId], relationType: "unknown", unionDateInfo: { type: "unknown" }, unionPlace: "", endType: "none", endDateInfo: { type: "unknown" }, endPlace: "", parentChildLinks, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
}

function updateEndDetailsVisibility() {
  $("endDetailsFields").hidden = !["separation", "divorce", "other"].includes($("familyEndType").value);
}

function openFamilyDetails(familyId) {
  const family = families.find(item => item.id === familyId);
  if (!family) return toast("Cette relation est introuvable", "error");
  const current = person(activeId);
  const currentIsPartner = (family.partnerIds || []).includes(activeId);
  const currentIsChild = (family.childIds || []).includes(activeId);
  const otherPartners = (family.partnerIds || []).filter(id => id !== activeId).map(nameOf);
  $("familyDetailsTitle").textContent = currentIsPartner && otherPartners.length
    ? `Union avec ${otherPartners.join(" et ")}`
    : currentIsChild && current
      ? `Parents de ${nameOf(current.id)}`
      : "Détails de la relation";
  familyDetailsReturnContext = { personId: activeId, source: personDialogSource, draft: capturePersonDraft() };
  $("familyDetailsId").value = family.id;
  $("familyRelationType").value = normalizeRelationType(family.relationType);
  setLocationField("unionPlace", family.unionPlace || family.marriagePlace || "", family.unionPlaceInfo);
  setGenealogyDateForm("union", family.unionDateInfo, family.marriageDate || family.unionDate);
  $("familyEndType").value = normalizeEndType(family.endType);
  setLocationField("endPlace", family.endPlace || "", family.endPlaceInfo);
  setGenealogyDateForm("end", family.endDateInfo, family.separationDate || family.divorceDate);
  updateEndDetailsVisibility();
  const relevantLinks = normalizedParentChildLinks(family).filter(link => currentIsPartner ? link.parentId === activeId : currentIsChild ? link.childId === activeId : true);
  $("filiationDetailsTitle").textContent = currentIsChild ? "Liens avec les parents" : "Liens avec les enfants";
  $("filiationEditors").innerHTML = relevantLinks.map((link, index) => `<div class="filiation-editor"><span><strong>${esc(nameOf(link.parentId))}</strong> → ${esc(nameOf(link.childId))}</span><label>Type de filiation<select class="field" data-filiation-index="${index}" data-parent-id="${link.parentId}" data-child-id="${link.childId}"><option value="unknown" ${link.type === "unknown" ? "selected" : ""}>Non précisée</option><option value="biological" ${link.type === "biological" ? "selected" : ""}>Biologique</option><option value="adoptive" ${link.type === "adoptive" ? "selected" : ""}>Adoptive</option><option value="uncertain" ${link.type === "uncertain" ? "selected" : ""}>Incertaine</option></select></label></div>`).join("") || '<p class="hint">Aucun lien parent-enfant à modifier pour cette personne.</p>';
  $("personDialog").close();
  $("familyDetailsDialog").showModal();
}

function returnFromFamilyDetails() {
  const context = familyDetailsReturnContext;
  familyDetailsReturnContext = null;
  if (!context) return;
  const item = person(context.personId);
  if (!item) return;
  openPerson(item, context.source);
  restorePersonDraft(context.draft);
  setPersonSection("relations");
}

async function saveFamilyDetails(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  const familyId = $("familyDetailsId").value;
  const family = families.find(item => item.id === familyId);
  if (!family) return toast("Cette relation est introuvable", "error");
  try {
    const unionDateInfo = readGenealogyDateForm("union");
    const endDateInfo = readGenealogyDateForm("end");
    const editedLinks = new Map([...document.querySelectorAll("[data-filiation-index]")].map(select => [`${select.dataset.parentId}:${select.dataset.childId}`, normalizeFiliationType(select.value)]));
    const parentChildLinks = normalizedParentChildLinks(family).map(link => ({ ...link, type: editedLinks.get(`${link.parentId}:${link.childId}`) || link.type }));
    const data = {
      relationType: normalizeRelationType($("familyRelationType").value), unionDateInfo,
      endType: normalizeEndType($("familyEndType").value), endDateInfo, parentChildLinks,
      updatedAt: serverTimestamp()
    };
    applyLocationField(data, "unionPlace", family, true);
    applyLocationField(data, "endPlace", family, true);
    await withButtonPending(submitButton, () => updateDoc(doc(db, "families", familyId), data));
    $("familyDetailsDialog").close();
    toast("Détails de la relation enregistrés");
    returnFromFamilyDetails();
  } catch (error) { toast(error.message || "Enregistrement impossible", "error"); }
}

function personInitials(item) {
  return `${item?.firstName?.[0] || ""}${item?.lastName?.[0] || ""}`.toUpperCase() || "?";
}

function directoryDisplayName(item) {
  return directoryPersonName(item);
}

function surnameLetter(item) {
  const first = (item.lastName || "#").normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

function updateDirectoryBranches() {
  const current = $("directoryBranchFilter").value;
  const branches = [...new Set(people.map(item => item.branch?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  $("directoryBranchFilter").innerHTML = '<option value="">Toutes les branches</option>' + branches.map(branch => `<option value="${esc(branch)}">${esc(branch)}</option>`).join("");
  if (branches.includes(current)) $("directoryBranchFilter").value = current;
}

function renderDirectoryAlphabet(items) {
  const available = new Set(items.map(surnameLetter));
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
  $("directoryAlphabet").innerHTML = letters.map(letter => `<button type="button" data-letter="${letter}" ${available.has(letter) ? "" : "disabled"}>${letter}</button>`).join("");
}

function renderDirectory() {
  $("directorySort").value = readDirectorySort();
  const filters = {
    query: $("directorySearch").value,
    firstName: $("directoryFirstNameFilter").value,
    marriedName: $("directoryMarriedNameFilter").value,
    gender: $("directoryGenderFilter").value,
    birthPlace: $("directoryBirthPlaceFilter").value,
    birthYearFrom: $("directoryBirthYearFromFilter").value,
    birthYearTo: $("directoryBirthYearToFilter").value,
    deathPlace: $("directoryDeathPlaceFilter").value,
    deathYearFrom: $("directoryDeathYearFromFilter").value,
    deathYearTo: $("directoryDeathYearToFilter").value,
    deathInfo: $("directoryDeathInfoFilter").value,
    branch: $("directoryBranchFilter").value,
    treeId: $("directoryTreeFilter").value || "all",
    sort: $("directorySort").value
  };
  const filtered = filterAndSortDirectory(people, filters);
  const activeFilterCount = countActiveDirectoryFilters(filters);
  $("directoryFilterCount").textContent = activeFilterCount;
  $("directoryFilterCount").hidden = !activeFilterCount;
  $("directoryResultCount").textContent = `${filtered.length} personne${filtered.length > 1 ? "s" : ""}`;
  renderDirectoryAlphabet(filtered);
  renderDirectoryChips(filters);
  $("directoryList").innerHTML = filtered.length ? filtered.map(item => {
    const avatar = item.photoUrl ? `<img src="${esc(item.photoUrl)}" alt="">` : personInitials(item);
    const membership = getPersonTreeMembership(item);
    const presence = membership.type === "assigned" && item.inTree === false
      ? '<span class="badge muted directory-presence">Masquée de l’arbre</span>'
      : "";
    const documentCount = documents.filter(documentItem => (documentItem.personIds || []).includes(item.id)).length;
    const documentAction = documentCount
      ? `<button class="directory-action directory-doc-action" type="button" data-directory-documents="${item.id}" aria-label="Afficher ${documentCount} document${documentCount > 1 ? "s" : ""} associé${documentCount > 1 ? "s" : ""} à ${esc(directoryDisplayName(item))}">${icon("document")}<span class="directory-doc-count-value">${documentCount}</span><span class="directory-doc-count-label"> document${documentCount > 1 ? "s" : ""}</span></button>`
      : `<span class="directory-action directory-doc-action" aria-label="Aucun document associé">${icon("document")}<span class="directory-doc-count-value">0</span><span class="directory-doc-count-label"> document</span></span>`;
    const middleName = item.middleName ? `<span class="person-middle-name">${esc(item.middleName)}</span>` : "";
    const treeLabel = directoryTreeLabel(item, treeMetadata);
    const menu = tileContextMenuMarkup("directory", item.id, directoryDisplayName(item), [{ key: "delete", label: "Supprimer", icon: "trash", danger: true }]);
    return `<article class="directory-entry" data-letter="${surnameLetter(item)}" data-directory-person="${item.id}" data-primary-tile tabindex="0" role="group" aria-label="Ouvrir la fiche de ${esc(directoryDisplayName(item))}" aria-keyshortcuts="Enter Space"><span class="directory-avatar">${avatar}</span><div class="directory-main"><h3><span class="directory-surname">${esc(item.lastName || "—")}</span> <span class="directory-first-name">${esc(item.firstName || "")}</span>${middleName}</h3><p class="directory-life"><span class="directory-birth-date"><span class="directory-life-symbol" aria-hidden="true">✦</span> ${esc(formatDirectoryDate(item.birthDateInfo, item.birthDate))}</span><span class="directory-life-divider" aria-hidden="true">—</span><span class="directory-death-date"><span class="directory-life-symbol" aria-hidden="true">†</span> ${esc(formatDirectoryDate(item.deathDateInfo, item.deathDate))}</span></p><span class="directory-tree-label">${esc(treeLabel)}</span>${presence}</div><div class="directory-entry-actions"><div class="directory-entry-documents">${documentAction}</div><div class="directory-entry-menu">${menu}</div></div></article>`;
  }).join("") : (people.length
    ? emptyState({ iconName: "people", title: "Aucune personne trouvée", description: "Modifiez la recherche ou retirez un filtre pour afficher d’autres résultats." })
    : emptyState({ iconName: "people", title: "Votre annuaire est vide", description: "Ajoutez une première personne pour commencer votre histoire familiale.", action: `<button class="btn primary" type="button" data-empty-add-person>${icon("plus")}<span>Ajouter une personne</span></button>` }));
  applyDirectoryViewPreference();
  updateTreeQualityButton();
  const multiTransferButton = $("multiTreeTransferOpenBtn");
  if (multiTransferButton) multiTransferButton.hidden = !isAdminUser() || treeCatalogState !== "ready" || !loadedPeople || !loadedFamilies;
}

const directoryChipLabels = {
  firstName: "Nom / prénom",
  marriedName: "Nom d'usage",
  gender: "Sexe",
  birthPlace: "Naissance",
  birthYearFrom: "Naissance",
  deathPlace: "Décès",
  deathYearFrom: "Décès",
  deathInfo: "Décès",
  branch: "Branche"
};
const directoryGenderLabels = { F: "Femme", M: "Homme" };
const directoryDeathInfoLabels = { yes: "Renseignée", no: "Non renseignée" };

function renderDirectoryChips(filters) {
  const chips = [];
  const pushChip = (key, label, value, clear) => {
    if (!value) return;
    chips.push({ key, label, value, clear });
  };
  pushChip("firstName", "Nom / prénom", filters.firstName.trim(), () => { $("directoryFirstNameFilter").value = ""; renderDirectory(); });
  pushChip("marriedName", "Nom d'usage", filters.marriedName.trim(), () => { $("directoryMarriedNameFilter").value = ""; renderDirectory(); });
  pushChip("gender", "Sexe", directoryGenderLabels[filters.gender] || "", () => { $("directoryGenderFilter").value = ""; renderDirectory(); });
  pushChip("branch", "Branche", filters.branch, () => { $("directoryBranchFilter").value = ""; renderDirectory(); });
  pushChip("birthPlace", "Naissance", filters.birthPlace.trim(), () => { $("directoryBirthPlaceFilter").value = ""; renderDirectory(); });
  if (filters.birthYearFrom || filters.birthYearTo) {
    const period = [filters.birthYearFrom, "–", filters.birthYearTo].filter(Boolean).join(" ");
    chips.push({ key: "birthYear", label: "Naissance", value: period, clear: () => { $("directoryBirthYearFromFilter").value = ""; $("directoryBirthYearToFilter").value = ""; renderDirectory(); } });
  }
  pushChip("deathPlace", "Décès", filters.deathPlace.trim(), () => { $("directoryDeathPlaceFilter").value = ""; renderDirectory(); });
  if (filters.deathYearFrom || filters.deathYearTo) {
    const period = [filters.deathYearFrom, "–", filters.deathYearTo].filter(Boolean).join(" ");
    chips.push({ key: "deathYear", label: "Décès", value: period, clear: () => { $("directoryDeathYearFromFilter").value = ""; $("directoryDeathYearToFilter").value = ""; renderDirectory(); } });
  }
  pushChip("deathInfo", "Décès", directoryDeathInfoLabels[filters.deathInfo] || "", () => { $("directoryDeathInfoFilter").value = ""; renderDirectory(); });
  if (filters.treeId && filters.treeId !== "all") {
    const label = filters.treeId === DIRECTORY_UNASSIGNED_TREE_FILTER
      ? "Sans arbre"
      : filters.treeId === MAIN_TREE_ID
        ? "Arbre familial"
        : treeMetadata.find(tree => tree.id === filters.treeId)?.name || "Arbre indisponible";
    chips.push({ key: "treeId", label: "Arbre", value: label, clear: () => { $("directoryTreeFilter").value = "all"; renderDirectory(); } });
  }
  const container = $("directoryFilterChips");
  if (!container) return;
  if (!chips.length) {
    container.innerHTML = "";
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = chips.map(chip =>
    `<button type="button" class="directory-filter-chip" data-filter-chip="${chip.key}" aria-label="Retirer le filtre ${esc(chip.label)}"><span class="chip-label">${esc(chip.label)} : ${esc(chip.value)}</span><span class="chip-remove" aria-hidden="true">×</span></button>`
  ).join("");
  container.querySelectorAll("[data-filter-chip]").forEach(button => {
    const chip = chips.find(item => item.key === button.dataset.filterChip);
    if (chip) button.addEventListener("click", chip.clear);
  });
}

const treeQualityCategoryLabels = Object.freeze({
  missing: "Informations à compléter",
  chronology: "Chronologie à vérifier",
  duplicates: "Doublons potentiels",
  relations: "Relations à vérifier"
});

function treeQualityPersonLabel(personId) {
  const item = person(personId);
  return item ? directoryDisplayName(item) : "Personne introuvable";
}

function updateTreeQualityButton(result = analyzeTreeQuality({ people, families })) {
  const button = $("treeQualityBtn");
  if (!button) return result;
  const missingCount = aggregateMissing(result.diagnostics.filter(item => item.category === "missing")).length;
  const total = missingCount + result.diagnostics.filter(item => item.category !== "missing").length;
  button.textContent = total ? `Contrôle de l’arbre · ${total}` : "Contrôle de l’arbre";
  button.setAttribute("aria-label", total ? `Contrôle de l’arbre : ${total} éléments à vérifier` : "Contrôle de l’arbre");
  return result;
}

const MISSING_FIELD_ORDER = Object.freeze(["firstName", "lastName", "birthDate", "birthPlace", "deathDate", "deathPlace"]);

const MISSING_FIELD_LABELS = Object.freeze({
  firstName: "Prénom",
  lastName: "Nom de naissance",
  birthDate: "Date de naissance",
  birthPlace: "Lieu de naissance",
  deathDate: "Date de décès",
  deathPlace: "Lieu de décès"
});

function aggregateMissing(diagnostics) {
  const byPerson = new Map();
  for (const item of diagnostics) {
    const personId = (item.peopleIds || [])[0];
    if (!personId || !item.field) continue;
    const key = `${personId}:${item.familyId || ""}`;
    if (!byPerson.has(key)) byPerson.set(key, { personId, familyId: item.familyId || "", fields: new Set() });
    byPerson.get(key).fields.add(item.field);
  }
  return [...byPerson.values()].map(entry => ({
    category: "missing",
    message: `Non renseigné : ${[...entry.fields].sort((a, b) => MISSING_FIELD_ORDER.indexOf(a) - MISSING_FIELD_ORDER.indexOf(b)).map(field => MISSING_FIELD_LABELS[field] || field).join(" · ")}`,
    peopleIds: [entry.personId],
    ...(entry.familyId ? { familyId: entry.familyId } : {})
  }));
}

function renderTreeQuality() {
  const result = updateTreeQualityButton();
  const missing = aggregateMissing(result.diagnostics.filter(item => item.category === "missing"));
  const aggregated = [
    ...missing,
    ...result.diagnostics.filter(item => item.category !== "missing")
  ];
  const counts = { missing: missing.length };
  for (const category of Object.keys(treeQualityCategoryLabels)) {
    if (category === "missing") continue;
    counts[category] = aggregated.filter(item => item.category === category).length;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  $("treeQualitySummary").textContent = total ? `${total} élément${total > 1 ? "s" : ""} à vérifier` : "Aucun élément à vérifier";
  const categories = Object.entries(treeQualityCategoryLabels).map(([category, label]) => {
    const items = aggregated.filter(item => item.category === category);
    const rows = items.map(item => {
      const peopleIds = item.peopleIds || [];
      const names = peopleIds.map(treeQualityPersonLabel);
      const actions = peopleIds.map((id, index) => `<button class="btn small tertiary" type="button" data-quality-person="${esc(id)}">${peopleIds.length > 1 ? `Voir ${index === 0 ? "la première" : "la seconde"}` : "Voir la fiche"}</button>`).join("");
      return `<article class="tree-quality-item"><div><strong>${esc(names.join(" · "))}</strong><p>${esc(item.message)}</p></div><div class="tree-quality-item-actions">${actions}</div></article>`;
    }).join("");
    if (items.length) {
      return `<details class="tree-quality-category"><summary><span class="tree-quality-category-title">${label}</span><span class="tree-quality-category-count">${items.length}</span></summary><div class="tree-quality-scroll"><div class="tree-quality-category-content">${rows}</div><div class="tree-quality-scroll-indicator" aria-hidden="true"><span></span></div></div></details>`;
    }
    return `<div class="tree-quality-category is-empty"><div class="tree-quality-category-summary"><span class="tree-quality-category-title">${label}</span><span class="tree-quality-category-count">0</span></div></div>`;
  }).join("");
  $("treeQualityContent").innerHTML = categories || emptyState({ iconName: "check", title: "Aucun élément à vérifier", description: "Les données disponibles ne remontent pas de diagnostic pour le moment." });
  initTreeQualityScroll();
}

function initTreeQualityScroll() {
  document.querySelectorAll(".tree-quality-scroll").forEach(wrapper => {
    const content = wrapper.querySelector(".tree-quality-category-content");
    const indicator = wrapper.querySelector(".tree-quality-scroll-indicator");
    const thumb = indicator?.querySelector("span");
    if (!content || !indicator || !thumb) return;
    const update = () => {
      const { scrollHeight, clientHeight, scrollTop } = content;
      const scrollable = scrollHeight > clientHeight + 1;
      wrapper.classList.toggle("is-scrollable", scrollable);
      if (!scrollable) return;
      const ratio = clientHeight / scrollHeight;
      const maxOffset = clientHeight - clientHeight * ratio;
      const offset = scrollTop / (scrollHeight - clientHeight) * maxOffset;
      thumb.style.setProperty("--thumb-height", `${Math.round(ratio * 100)}%`);
      thumb.style.setProperty("--thumb-offset", `${Math.round(offset)}px`);
    };
    update();
    content.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  });
}

function openDirectoryDocuments(personId) {
  const item = person(personId);
  if (!item) return;
  const linked = documents.filter(documentItem => (documentItem.personIds || []).includes(personId));
  $("directoryDocumentsTitle").textContent = "Documents associés";
  $("directoryDocumentsSubtitle").textContent = directoryDisplayName(item);
  $("directoryDocumentsList").innerHTML = linked.length
    ? linked.map(documentItem => `<div class="directory-document-item"><div><strong>${esc(documentDisplayLabel(documentItem))}</strong><small>${esc(documentItem.type || documentItem.fileName || "Document")}</small></div><button class="btn small primary" type="button" data-view-directory-document="${documentItem.id}">${icon("eye")}<span>Consulter</span></button></div>`).join("")
    : emptyState({ iconName: "document", title: "Aucun document associé", description: "Cette personne ne possède pas encore de document consultable." });
  $("directoryDocumentsDialog").showModal();
}

/* ---------- Fiche individuelle imprimable / PDF ----------
   Lecture seule : assemblage à la volée depuis people/families/documents,
   réutilise les lecteurs et formateurs existants (aucune transformation de
   données, aucune écriture Firestore, aucun enrichissement legacy). */
let personPrintScopeOverride = null;
/* Lieux compact pour la fiche imprimée : réutilise la fonction commune
   (Orino, IT → « Orino (ITA) ») ; texte legacy repris tel quel, jamais enrichi. */
function printPlaceDetail(text, placeInfo = null) {
  return esc(formatCompactPlace(text, placeInfo));
}

/* Filiation : la biologie / non précisée ne s'imprime pas ; seules les
   indications discrètes « Adoptive » / « Incertaine » sont conservées. */
function printFiliationLabel(filiationType) {
  if (!["adoptive", "uncertain"].includes(filiationType)) return "";
  return FILIATION_TYPE_LABELS[filiationType];
}

function printLifeEvent(symbol, title, dateInfo, legacyDate, placeText, placeInfo) {
  const date = formatGenealogyDate(dateInfo, legacyDate);
  const place = printPlaceDetail(placeText, placeInfo);
  return `<div class="print-event"><span class="print-symbol" aria-hidden="true">${esc(symbol)}</span><div><strong>${esc(title)}</strong><span class="print-date">${esc(date)}</span>${place ? `<span class="print-place">${place}</span>` : ""}</div></div>`;
}

function printLifePeriod(item = {}) {
  const birth = formatGenealogyDate(item.birthDateInfo, item.birthDate);
  const death = formatGenealogyDate(item.deathDateInfo, item.deathDate);
  return `<span class="print-symbol" aria-hidden="true">✦</span> ${esc(birth)} <span class="print-divider" aria-hidden="true">·</span> <span class="print-symbol" aria-hidden="true">†</span> ${esc(death)}`;
}

/* Date de dernière modification : uniquement la donnée réellement enregistrée
   (champ `updatedAt` Firestore). Aucun fallback sur la date actuelle. */
function printModificationDate(item = {}) {
  const stamp = item.updatedAt;
  if (!stamp) return "";
  let date = null;
  if (typeof stamp === "object" && Number.isFinite(Number(stamp.seconds))) {
    date = new Date(Number(stamp.seconds) * 1000);
  } else if (typeof stamp === "string") {
    const parsed = new Date(stamp);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  return "Dernière modification : " + new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/* Année seule pour période de vie synthétique ; entre deux années → borne.
   Formats inconnus → « — » (aucune date complète fabriquée). */
function printYear(info, legacy = "", position = "first") {
  const years = genealogyDateYears(normalizeGenealogyDate(info, legacy));
  if (!years.length) return "—";
  return String(position === "last" ? Math.max(...years) : Math.min(...years));
}

function printLifeSpan(item = {}) {
  const birth = printYear(item.birthDateInfo, item.birthDate, "first");
  const death = printYear(item.deathDateInfo, item.deathDate, "last");
  if (birth === "—" && death === "—") return "";
  return `${esc(birth)} <span class="print-divider" aria-hidden="true">—</span> ${esc(death)}`;
}

/* Nom d'affichage généalogique pour l'impression : prénom + second prénom
   (typographie secondaire) + nom de naissance, jamais « Nom Prénom ». */
function printFullName(item = {}) {
  const middle = item.middleName ? ` <span class="print-middle-name">${esc(item.middleName)}</span>` : "";
  return `${esc(item.firstName || "—")}${middle} ${esc(item.lastName || "")}`.replace(/\s+$/, "");
}

function buildPersonPrintSheet(item, scope = null) {
  const sourcePeople = scope?.people || people;
  const sourceFamilies = scope?.families || families;
  const personOf = id => sourcePeople.find(candidate => candidate.id === id) || null;
  const parentFamilies = sourceFamilies.filter(family => (family.childIds || []).includes(item.id));
  const ownFamilies = sourceFamilies.filter(family => (family.partnerIds || []).includes(item.id));

  const eventHasData = (dateInfo, legacyDate, placeText, placeInfo) =>
    formatGenealogyDate(dateInfo, legacyDate) !== "—" || !!printPlaceDetail(placeText, placeInfo);
  const birthKnown = eventHasData(item.birthDateInfo, item.birthDate, item.place, item.birthPlaceInfo);
  const deathKnown = eventHasData(item.deathDateInfo, item.deathDate, item.deathPlace, item.deathPlaceInfo);

  const photo = item.photoUrl
    ? `<span class="print-avatar"><img src="${esc(item.photoUrl)}" alt=""></span>`
    : `<span class="print-avatar" aria-hidden="true">${esc(personInitials(item))}</span>`;
  const usage = item.marriedName ? `<p class="print-usage">Nom d’usage : ${esc(item.marriedName)}</p>` : "";

  const birthEvent = printLifeEvent("✦", "Naissance", item.birthDateInfo, item.birthDate, item.place, item.birthPlaceInfo);
  const deathEvent = printLifeEvent("†", "Décès", item.deathDateInfo, item.deathDate, item.deathPlace, item.deathPlaceInfo);

  const parentRows = parentFamilies.flatMap(family => (family.partnerIds || []).map(parentId => {
    const parent = personOf(parentId);
    if (!parent) return "";
    const filiationType = parentChildLinkType(family, parentId, item.id);
    const filiation = printFiliationLabel(filiationType);
    return `<div class="print-parent"><span class="print-role">${esc(relationRole(parent, "parent"))}</span><span class="print-parent-name">${printFullName(parent)}</span><span class="print-meta">${printLifePeriod(parent)}</span>${filiation ? `<span class="print-meta print-filiation">${esc(filiation)}</span>` : ""}</div>`;
  }));

  /* Unions : uniquement lorsqu'un véritable partenaire différent de la
     personne courante est résolu, aligné sur renderRelations() (aucun faux
     bloc pour une family mono-parentale/technique/orpheline) ; les enfants
     de ces dernières restent affichés dans une section neutre « Enfants ». */
  const unionBlocks = [];
  const extraChildRows = [];
  const printedChildIds = new Set();
  ownFamilies.forEach(family => {
    const partner = personOf((family.partnerIds || []).find(id => id !== item.id) || "");
    const relationType = normalizeRelationType(family.relationType);
    const endType = normalizeEndType(family.endType);
    const unionDate = formatGenealogyDate(family.unionDateInfo, family.marriageDate || family.unionDate);
    const unionPlace = printPlaceDetail(family.unionPlace, family.unionPlaceInfo);
    const endLabel = ["none", "unknown"].includes(endType) ? "" : END_TYPE_LABELS[endType];
    const endDate = formatGenealogyDate(family.endDateInfo, family.separationDate || family.divorceDate);
    const endPlace = printPlaceDetail(family.endPlace, family.endPlaceInfo);
    const childRows = (family.childIds || []).map(childId => {
      const child = personOf(childId);
      if (!child || printedChildIds.has(child.id)) return "";
      printedChildIds.add(child.id);
      const filiationType = parentChildLinkType(family, item.id, childId);
      const filiation = printFiliationLabel(filiationType);
      const filiationMarkup = filiation ? `<span class="print-meta print-filiation">${esc(filiation)}</span>` : "";
      return `<li><span class="print-child-marker" aria-hidden="true">—</span><span class="print-child-body"><strong>${printFullName(child)}</strong><span class="print-meta">${printLifePeriod(child)}</span>${filiationMarkup}</span></li>`;
    }).filter(Boolean);
    if (!partner) {
      extraChildRows.push(...childRows);
      return;
    }
    unionBlocks.push(`<article class="print-union">
<div class="print-union-head"><strong>${esc(directoryPersonName(partner))}</strong>${relationType === "unknown" ? "" : `<span class="print-union-type">${esc(RELATION_TYPE_LABELS[relationType])}</span>`}</div>
${unionDate === "—" && !unionPlace ? "" : `<p class="print-union-meta">${unionDate === "—" ? "—" : esc(unionDate)}${unionPlace ? ` · ${unionPlace}` : ""}</p>`}
${!endLabel ? "" : `<p class="print-union-meta">${esc(endLabel)}${endDate === "—" ? "" : ` · ${esc(endDate)}`}${endPlace ? ` · ${endPlace}` : ""}</p>`}
${childRows.length ? `<p class="print-union-subtitle">Enfants issus de cette union · ${childRows.length}</p><ul class="print-children">${childRows.join("")}</ul>` : ""}
</article>`);
  });

  const sections = [];
  sections.push(`<header class="print-head"><span class="print-brand">La Nostra Storia</span><span class="print-kicker">Fiche individuelle</span></header>`);
  const lifeSpan = printLifeSpan(item);
  sections.push(`<section class="print-sec print-identity">${photo}<div><h2 class="print-name">${printFullName(item)}</h2>${usage}${lifeSpan ? `<p class="print-life">${lifeSpan}</p>` : ""}</div></section>`);
  if (birthKnown || deathKnown) {
    sections.push(`<section class="print-sec"><h3 class="print-sec-title">Naissance et décès</h3><div class="print-events">${birthEvent}${deathEvent}</div></section>`);
  }
  if (parentRows.filter(Boolean).length) sections.push(`<section class="print-sec"><h3 class="print-sec-title">Parents</h3><div class="print-parents">${parentRows.join("")}</div></section>`);
  if (unionBlocks.length) sections.push(`<section class="print-sec print-unions"><h3 class="print-sec-title">Unions et descendance</h3>${unionBlocks.join("")}</section>`);
  if (extraChildRows.length) sections.push(`<section class="print-sec"><h3 class="print-sec-title">Enfants</h3><ul class="print-children">${extraChildRows.join("")}</ul></section>`);
  if (item.notes?.trim()) sections.push(`<section class="print-sec"><h3 class="print-sec-title">Informations complémentaires</h3><p class="print-notes">${esc(item.notes)}</p></section>`);
  const footer = printModificationDate(item);
  if (footer) sections.push(`<footer class="print-foot">${esc(footer)}</footer>`);
  return `<article class="print-sheet">${sections.join("")}</article>`;
}

function openPersonPrint(scope = personPrintScopeOverride) {
  const effectiveScope = scope || null;
  const item = (effectiveScope?.people || []).find(candidate => candidate.id === activeId) || person(activeId);
  if (!item) {
    toast("Ouvrez d’abord la fiche d’une personne pour imprimer.", "error");
    return;
  }
  try {
    $("personPrintSheet").innerHTML = buildPersonPrintSheet(item, effectiveScope);
  } catch (error) {
    console.error(error);
    toast("La fiche n’a pas pu être préparée pour l’impression.", "error");
    return;
  }
  $("personPrintDialog").showModal();
}

if (typeof window !== "undefined") {
  window.__personPrint = {
    build: buildPersonPrintSheet,
    placeDetail: printPlaceDetail,
    /* Sonde de test à la convention __treeProbe : applique uniquement le vrai
       chemin utilisateur (openPerson puis clic réel du bouton) ; scope
       applicatif jamais fourni en production => zéro impact. */
    openForTest: (item, scope = null) => {
      if (scope?.seedAppPeopleForTest && Array.isArray(scope.people)) people = scope.people;
      if (scope?.seedAppTreesForTest && Array.isArray(scope.trees)) treeMetadata = scope.trees;
      activeId = item?.id || null;
      personPrintScopeOverride = scope;
      openPerson(item, "tree");
      return item;
    },
    clearTestScope: () => { personPrintScopeOverride = null; activeId = null; }
  };
}

/* Menu contextuel « ⋯ » de la fiche Personne : réutilise les actions existantes
   (Voir sa branche / Imprimer / PDF / Retirer de l’arbre), se ferme après
   sélection, avec Échap ou un clic en dehors, et reste dans le viewport. */
function setPersonMenu(open) {
  const menu = $("personMenu");
  if (!menu) return;
  menu.hidden = !open;
  $("personMenuBtn").setAttribute("aria-expanded", String(open));
  if (open) {
    const viewportWidth = document.documentElement.clientWidth;
    menu.style.maxWidth = `${Math.max(9, Math.min(15, viewportWidth / 16))}rem`;
    menu.querySelector("button:not([hidden])")?.focus({ preventScroll: true });
  }
}

$("personMenuBtn").addEventListener("click", event => {
  event.stopPropagation();
  setPersonMenu($("personMenu").hidden);
});
$("personMenu").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  setPersonMenu(false);
  if (button.id === "changePersonTreeBtn") openPersonTreeTransfer($("personId").value);
  if (button.id === "removePersonFromTreeBtn") runSafely(() => removePersonFromTree($("personId").value), "Retrait de l’arbre impossible");
});
$("personMenu").addEventListener("keydown", event => {
  const items = [...$("personMenu").querySelectorAll("button:not([hidden])")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    setPersonMenu(false);
    $("personMenuBtn").focus();
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (!items.length) return;
    if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items[items.length - 1]?.focus();
    else if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
    else items[(index - 1 + items.length) % items.length]?.focus();
  }
});
document.addEventListener("click", event => {
  if ($("personMenu").hidden) return;
  if (event.target.closest("#personMenu") || event.target.closest("#personMenuBtn")) return;
  setPersonMenu(false);
});
$("personDialog").addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if ($("personMenu").hidden) return;
  event.preventDefault();
  event.stopPropagation();
  setPersonMenu(false);
  $("personMenuBtn").focus();
});

function transferTreeName(treeId) {
  if (treeId == null) return "Aucun arbre";
  if (treeId === MAIN_TREE_ID) return "Arbre familial";
  return treeMetadata.find(tree => tree.id === treeId)?.name || "Arbre indisponible";
}

function transferFamilyTreeNames(treeIds = []) {
  return treeIds.map(transferTreeName).join(" et ");
}

function renderPersonTreeTransferPreview(plan) {
  const summary = plan.summary;
  const summaryText = summary.affectedFamilyCount
    ? `${summary.affectedFamilyCount} foyer${summary.affectedFamilyCount > 1 ? "s" : ""} concerné${summary.affectedFamilyCount > 1 ? "s" : ""} : ${summary.remainsVisibleCount} resteront visibles, ${summary.becomesHiddenCount} ne seront plus dessinés et ${summary.becomesVisibleCount} deviendront visibles.`
    : "Aucun foyer ne référence cette personne.";
  const rows = plan.affectedFamilies.map(family => {
    const names = family.members.map(member => member.name).join(" · ") || "Foyer sans personnes résolues";
    const before = family.beforeVisibleTreeIds.length ? transferFamilyTreeNames(family.beforeVisibleTreeIds) : "aucun arbre";
    const after = family.afterVisibleTreeIds.length ? transferFamilyTreeNames(family.afterVisibleTreeIds) : "aucun arbre";
    const missing = family.unresolvedPersonIds.length
      ? ` · ${family.unresolvedPersonIds.length} référence${family.unresolvedPersonIds.length > 1 ? "s" : ""} introuvable${family.unresolvedPersonIds.length > 1 ? "s" : ""}`
      : "";
    const invalid = family.invalidMembershipIds.length
      ? ` · ${family.invalidMembershipIds.length} appartenance${family.invalidMembershipIds.length > 1 ? "s" : ""} invalide${family.invalidMembershipIds.length > 1 ? "s" : ""}`
      : "";
    return `<li><strong>${esc(names)}</strong><span>Avant : ${esc(before)} · Après : ${esc(after)}${esc(missing + invalid)}</span></li>`;
  }).join("");
  const hiddenNote = plan.sourceMembershipType === "unassigned" || plan.personInTree
    ? ""
    : "Cette fiche est actuellement masquée de l'arbre (inTree désactivé) ; le transfert ne la rendra pas visible.";
  const unresolvedNote = summary.unresolvedReferenceCount || summary.invalidMembershipCount
    ? `<p>Des références ou appartenances sont incohérentes. Elles seront conservées telles quelles et rendent l'aperçu incomplet.</p>`
    : "";
  const unassignedNote = summary.unassignedRelatedCount
    ? "Des personnes liées sont sans arbre. Les relations restent enregistrées et ne seront dessinées qu'après affectation des personnes requises au même arbre."
    : "";
  $("personTreeTransferPreview").innerHTML = `<h4>Conséquences sur les relations</h4><p>${esc(summaryText)}</p><p>Les liens familiaux ne sont pas supprimés. Aucun lien graphique inter-arbres n'est créé; un foyer réparti entre plusieurs arbres ne sera plus dessiné comme un ensemble complet.</p>${hiddenNote ? `<p>${esc(hiddenNote)}</p>` : ""}${unassignedNote ? `<p>${esc(unassignedNote)}</p>` : ""}${unresolvedNote}${rows ? `<ul class="person-tree-transfer-list">${rows}</ul>` : ""}`;
}

function showPersonTreeTransferError(message) {
  const error = $("personTreeTransferError");
  error.textContent = message;
  error.hidden = !message;
}

function previewPersonTreeTransfer() {
  const state = personTreeTransferState;
  const destination = $("personTreeTransferDestination").value;
  const confirmButton = $("confirmPersonTreeTransferBtn");
  state.plan = null;
  confirmButton.disabled = true;
  showPersonTreeTransferError("");
  if (!destination) {
    $("personTreeTransferPreview").innerHTML = "<p>Choisissez un arbre de destination pour afficher les conséquences sur les foyers.</p>";
    return;
  }
  try {
    const plan = prepareIndividualTreeTransferPlan({ personId: state.personId, people, families, trees: treeMetadata, destinationTreeId: destination });
    state.plan = plan;
    renderPersonTreeTransferPreview(plan);
    confirmButton.disabled = false;
  } catch (error) {
    $("personTreeTransferPreview").innerHTML = `<p>${esc(error.message || "Impossible de préparer l'aperçu du transfert.")}</p>`;
  }
}

function openPersonTreeTransfer(personId) {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (treeCatalogState !== "ready") return toast("Le catalogue des arbres est indisponible", "error");
  const item = person(personId);
  const sourceMembership = item ? getPersonTreeMembership(item) : null;
  if (!item || sourceMembership?.type === "unavailable") return toast("L'appartenance actuelle de cette personne est indisponible", "error");
  if (!canChangePersonTree(item)) return toast("Accès réservé aux administrateurs", "error");
  const sourceTreeId = sourceMembership.type === "assigned" ? sourceMembership.treeId : null;
  const isAssignment = sourceMembership.type === "unassigned";
  personTreeTransferState = { personId, sourceTreeId, sourceMembershipType: sourceMembership.type, plan: null };
  $("personTreeTransferTitle").textContent = isAssignment ? "Affecter à un arbre" : "Changer d'arbre";
  $("personTreeTransferPerson").textContent = [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ") || "Personne sans nom";
  $("personTreeTransferSource").textContent = transferTreeName(sourceTreeId);
  $("personTreeTransferDestinationVerb").textContent = isAssignment ? "Affecter à" : "Déplacer vers";
  $("personTreeTransferDestination").setAttribute("aria-label", isAssignment ? "Affecter à un arbre" : "Déplacer vers");
  const destinations = [
    ...(sourceTreeId === MAIN_TREE_ID ? [] : [{ id: MAIN_TREE_ID, name: "Arbre familial" }]),
    ...treeMetadata.filter(tree => tree.id !== sourceTreeId && getTreeLifecycleState(tree) === TREE_LIFECYCLE_ACTIVE).map(tree => ({ id: tree.id, name: tree.name }))
  ];
  $("personTreeTransferDestination").innerHTML = '<option value="">Sélectionner un arbre…</option>'
    + destinations.map(tree => `<option value="${esc(tree.id)}">${esc(tree.name)}</option>`).join("");
  $("personTreeTransferDestination").value = "";
  $("personTreeTransferDestination").disabled = !destinations.length;
  $("confirmPersonTreeTransferBtn").disabled = true;
  $("personTreeTransferPreview").innerHTML = destinations.length
    ? "<p>Choisissez un arbre de destination pour afficher les conséquences sur les foyers.</p>"
    : "<p>Aucun autre arbre n'est disponible comme destination.</p>";
  $("confirmPersonTreeTransferBtn").textContent = isAssignment ? "Confirmer l’affectation" : "Confirmer le déplacement";
  $("personTreeTransferNote").textContent = isAssignment
    ? "Cette personne sera affectée et affichée dans l'arbre choisi. Ses proches ne seront pas déplacés; les liens familiaux et documents resteront enregistrés."
    : item.inTree === false
      ? "Seule l'appartenance de cette personne changera. Ses proches et toutes ses données seront conservés. Cette fiche est masquée de l'arbre; le transfert ne la rendra pas visible."
      : "Seule l'appartenance de cette personne changera. Ses proches ne seront pas déplacés; tous les liens familiaux et documents resteront enregistrés.";
  showPersonTreeTransferError("");
  $("personTreeTransferDialog").showModal();
  setTimeout(() => $("personTreeTransferDestination").focus(), 30);
}

async function readFreshPersonTreeTransferData(personId) {
  const familyQueries = await Promise.all([
    getDocs(query(refs.families, where("partnerIds", "array-contains", personId))),
    getDocs(query(refs.families, where("childIds", "array-contains", personId)))
  ]);
  const familySnapshots = new Map();
  for (const snapshot of familyQueries) for (const item of snapshot.docs) familySnapshots.set(item.id, item);

  // Keep support for legacy/odd family references in link arrays that are not
  // indexed by partnerIds/childIds, while refreshing every cached affected doc.
  for (const cached of families.filter(family => familyPersonIds(family).includes(personId) && typeof family.id === "string")) {
    if (familySnapshots.has(cached.id)) continue;
    const snapshot = await getDoc(doc(db, "families", cached.id));
    if (snapshot.exists()) familySnapshots.set(snapshot.id, snapshot);
  }
  const freshFamilies = [...familySnapshots.values()].map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
  const personIds = new Set([personId, ...freshFamilies.flatMap(familyPersonIds)]);
  const freshSnapshots = await Promise.all([...personIds].map(id => getDoc(doc(db, "people", id))));
  const freshById = new Map();
  for (const snapshot of freshSnapshots) if (snapshot.exists()) freshById.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
  return { people: [...freshById.values()], families: freshFamilies };
}

/* Instrumentation de diagnostic du transfert (Lot 4C).
   Désactivée par défaut. Activable uniquement sur Recette via :
   sessionStorage.setItem("transferDiagnostic", "1") puis recharger la page.
   Désactivation : sessionStorage.removeItem("transferDiagnostic") puis recharger.
   Les rapports sont locaux (console + window.__transferDiagnostics) ; aucune
   écriture Firestore ni envoi réseau. */
const transferDiagnosticsEnabled = resolveTransferDiagnosticEnabled({
  environment: firebaseEnvironment.environment,
  storage: typeof window !== "undefined" ? window.sessionStorage : null
});
const transferDiagnosticReports = [];
if (transferDiagnosticsEnabled && typeof window !== "undefined") {
  window.__transferDiagnostics = transferDiagnosticReports;
  console.info("[Transfert] Diagnostic activé. Rapports : window.__transferDiagnostics");
}
function recordTransferDiagnostic(report) {
  if (!transferDiagnosticsEnabled) return;
  transferDiagnosticReports.push(report);
  console.warn("[Transfert] Diagnostic", report);
}

async function confirmPersonTreeTransfer() {
  if (personTreeTransferSaving) return;
  if (!isAdminUser()) return showPersonTreeTransferError("Seuls les administrateurs peuvent changer l'arbre d'une personne.");
  const state = personTreeTransferState;
  const expectedPlan = state?.plan;
  if (!expectedPlan) return showPersonTreeTransferError("Choisissez une destination et vérifiez l'aperçu avant de confirmer.");
  personTreeTransferSaving = true;
  const button = $("confirmPersonTreeTransferBtn");
  setButtonPending(button, true, "Vérification…");
  $("personTreeTransferDestination").disabled = true;
  $("personTreeTransferDialog").querySelectorAll('[data-close="personTreeTransferDialog"]').forEach(closeButton => { closeButton.disabled = true; });
  showPersonTreeTransferError("");
  let transferDiagnosticRecorded = false;
  try {
    if (treeCatalogState !== "ready" || !treeMetadata.some(tree => tree.id === expectedPlan.destinationTreeId) && expectedPlan.destinationTreeId !== MAIN_TREE_ID) {
      throw new Error("Le catalogue ou l'arbre de destination n'est plus disponible. Fermez l'aperçu et réessayez.");
    }
    const fresh = await readFreshPersonTreeTransferData(state.personId);
    const refreshedPlan = prepareIndividualTreeTransferPlan({
      personId: state.personId, people: fresh.people, families: fresh.families,
      trees: treeMetadata, destinationTreeId: expectedPlan.destinationTreeId
    });
    if (refreshedPlan.fingerprint !== expectedPlan.fingerprint) {
      recordTransferDiagnostic(buildTransferDiagnosticReport({
        stage: TRANSFER_DIAGNOSTIC_STAGES.PREVIEW_VS_FRESH, expectedPlan, actualPlan: refreshedPlan
      }));
      state.plan = refreshedPlan;
      renderPersonTreeTransferPreview(refreshedPlan);
      showPersonTreeTransferError("Les relations ou l'appartenance ont changé depuis l'aperçu. Vérifiez le nouvel aperçu puis confirmez à nouveau.");
      return;
    }

    const personRef = doc(db, "people", state.personId);
    const familyRefs = expectedPlan.affectedFamilies.map(family => family.familyId);
    if (familyRefs.some(id => typeof id !== "string" || !id)) throw new Error("Un foyer concerné n'a pas d'identifiant valide; transfert annulé.");
    const familyMemberIds = [...new Set(expectedPlan.affectedFamilies.flatMap(family => family.memberIds).filter(id => id !== state.personId))];
    await runTransaction(db, async transaction => {
      const personSnapshot = await transaction.get(personRef);
      if (!personSnapshot.exists()) throw new Error("La fiche a été supprimée ou n'est plus accessible.");
      const livePerson = { id: personSnapshot.id, ...personSnapshot.data() };
      const liveMembership = getPersonTreeMembership(livePerson);
      if (liveMembership.type !== expectedPlan.sourceMembershipType
        || (liveMembership.type === "assigned" && liveMembership.treeId !== expectedPlan.sourceTreeId)) {
        const error = new Error("L'appartenance de cette personne a changé depuis l'aperçu. Fermez-le et recommencez.");
        error.code = "tree-transfer-stale";
        throw error;
      }
      const sourceTreeSnapshot = expectedPlan.sourceMembershipType !== "assigned" || expectedPlan.sourceTreeId === MAIN_TREE_ID
        ? null
        : await transaction.get(doc(db, "trees", expectedPlan.sourceTreeId));
      const destinationTreeSnapshot = expectedPlan.destinationTreeId === MAIN_TREE_ID
        ? null
        : await transaction.get(doc(db, "trees", expectedPlan.destinationTreeId));
      const familySnapshots = await Promise.all(familyRefs.map(id => transaction.get(doc(db, "families", id))));
      const memberSnapshots = await Promise.all(familyMemberIds.map(id => transaction.get(doc(db, "people", id))));
      if (sourceTreeSnapshot && !sourceTreeSnapshot.exists()) throw new Error("L'arbre source n'est plus disponible; transfert annulé.");
      if (destinationTreeSnapshot && !destinationTreeSnapshot.exists()) throw new Error("L'arbre de destination n'existe plus; transfert annulé.");
      if (destinationTreeSnapshot && getTreeLifecycleState(destinationTreeSnapshot.data()) !== TREE_LIFECYCLE_ACTIVE) {
        throw new Error("L’arbre de destination est en cours de suppression. Aucune personne n’a été transférée.");
      }
      if (sourceTreeSnapshot && sourceTreeSnapshot.data().name !== expectedPlan.sourceTreeName) {
        const error = new Error("Le nom de l'arbre source a changé depuis l'aperçu. Fermez-le et recommencez.");
        error.code = "tree-transfer-stale";
        throw error;
      }
      if (destinationTreeSnapshot && destinationTreeSnapshot.data().name !== expectedPlan.destinationTreeName) {
        const error = new Error("Le nom de l'arbre de destination a changé depuis l'aperçu. Fermez-le et recommencez.");
        error.code = "tree-transfer-stale";
        throw error;
      }

      const txFamilies = familySnapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
      const txPeopleById = new Map([[livePerson.id, livePerson]]);
      for (const snapshot of memberSnapshots) if (snapshot.exists()) txPeopleById.set(snapshot.id, { id: snapshot.id, ...snapshot.data() });
      const txPlan = prepareIndividualTreeTransferPlan({
        personId: state.personId, people: [...txPeopleById.values()], families: txFamilies,
        trees: treeMetadata, destinationTreeId: expectedPlan.destinationTreeId
      });
      if (txPlan.fingerprint !== expectedPlan.fingerprint) {
        recordTransferDiagnostic(buildTransferDiagnosticReport({
          stage: TRANSFER_DIAGNOSTIC_STAGES.FRESH_VS_TRANSACTION, expectedPlan, actualPlan: txPlan
        }));
        transferDiagnosticRecorded = true;
        const error = new Error("Les relations ou l'appartenance ont changé pendant la confirmation. Fermez l'aperçu et recommencez.");
        error.code = "tree-transfer-stale";
        throw error;
      }

      const changes = { treeId: expectedPlan.destinationTreeId };
      if (expectedPlan.sourceMembershipType === "unassigned") {
        changes.treeAssignmentState = deleteField();
        changes.inTree = true;
      }
      const uid = auth.currentUser?.uid || "";
      if (!uid) throw new Error("Votre session a expiré; reconnectez-vous avant le transfert.");
      // La règle validUpdatedBy exige que cet auteur corresponde à l'utilisateur
      // courant lorsqu'un ancien updatedBy est présent. Ne toucher updatedAt
      // que si les règles ne l'exigent pas (elles ne l'exigent pas).
      if (Object.prototype.hasOwnProperty.call(livePerson, "updatedBy") && livePerson.updatedBy !== uid) {
        changes.updatedBy = uid;
        changes.updatedByName = currentUserProfile?.displayName || "";
      }
      transaction.update(personRef, changes);
    });

    close("personTreeTransferDialog");
    personTreeTransferState = null;
    close("personDialog");
    toast(expectedPlan.sourceMembershipType === "unassigned"
      ? `${expectedPlan.personName} a été affecté à ${expectedPlan.destinationTreeName}.`
      : `${expectedPlan.personName} a été déplacé vers ${expectedPlan.destinationTreeName}.`);
  } catch (error) {
    console.error("Transfert individuel impossible", error);
    if (!transferDiagnosticRecorded) {
      recordTransferDiagnostic(buildTransferDiagnosticReport({ stage: TRANSFER_DIAGNOSTIC_STAGES.ERROR, expectedPlan, error }));
    }
    if (error.code === "tree-transfer-stale" && personTreeTransferState) personTreeTransferState.plan = null;
    const text = `${error.code || ""} ${error.message || ""}`;
    const message = /permission-denied|insufficient permissions/i.test(text)
      ? "Transfert refusé par les règles Firestore. Vérifiez votre rôle et l'arbre de destination."
      : /unavailable|network|offline|failed to fetch|deadline-exceeded/i.test(text)
        ? "Connexion impossible; le transfert n'a pas été confirmé. Réessayez après vérification."
        : error.message || "Le transfert n'a pas pu être effectué.";
    showPersonTreeTransferError(message);
  } finally {
    personTreeTransferSaving = false;
    setButtonPending(button, false);
    button.disabled = !personTreeTransferState?.plan;
    $("personTreeTransferDestination").disabled = !personTreeTransferState
      || $("personTreeTransferDestination").options.length <= 1;
    $("personTreeTransferDialog").querySelectorAll('[data-close="personTreeTransferDialog"]').forEach(closeButton => { closeButton.disabled = false; });
  }
}

$("personTreeTransferDestination").addEventListener("change", previewPersonTreeTransfer);
$("confirmPersonTreeTransferBtn").addEventListener("click", confirmPersonTreeTransfer);
$("personTreeTransferDialog").addEventListener("cancel", event => {
  if (personTreeTransferSaving) event.preventDefault();
});
$("personTreeTransferDialog").addEventListener("close", () => {
  personTreeTransferState = null;
  personTreeTransferSaving = false;
  if ($("personDialog").open && !$("personMenuBtn").hidden) $("personMenuBtn").focus({ preventScroll: true });
});

async function readFreshMultipleTreeTransferData(personIds, destinationTreeId) {
  /* Découverte via requêtes avant la transaction : le SDK Web ne peut pas
     verrouiller une nouvelle famille créée après ces requêtes. Chaque foyer
     alors découvert, ainsi que ses membres, est relu et vérifié en transaction. */
  const familyQueries = await Promise.all(personIds.flatMap(personId => [
    getDocs(query(refs.families, where("partnerIds", "array-contains", personId))),
    getDocs(query(refs.families, where("childIds", "array-contains", personId)))
  ]));
  const familySnapshots = new Map();
  for (const snapshot of familyQueries) for (const item of snapshot.docs) familySnapshots.set(item.id, item);

  const selected = new Set(personIds);
  const cachedFamilies = families.filter(family => familyPersonIds(family).some(id => selected.has(id))
    && typeof family.id === "string" && !familySnapshots.has(family.id));
  const sourceMembership = getPersonTreeMembership(person(personIds[0]));
  const sourceTreeId = sourceMembership.type === "assigned" ? sourceMembership.treeId : null;
  const treesToRead = new Set([sourceTreeId, destinationTreeId].filter(id => id && id !== MAIN_TREE_ID));
  const candidateFamilies = [
    ...[...familySnapshots.values()].map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
    ...cachedFamilies
  ];
  const candidatePersonIds = new Set([...personIds, ...candidateFamilies.flatMap(familyPersonIds)]);
  const candidateFamilyIds = new Set(candidateFamilies.map(family => family.id));
  if (candidatePersonIds.size + candidateFamilyIds.size + treesToRead.size > MAX_MULTI_TREE_TRANSFER_READS) {
    throw new Error(`Les relations concernent trop de documents pour une transaction sûre (limite ${MAX_MULTI_TREE_TRANSFER_READS}). Réduisez la sélection.`);
  }
  const cachedSnapshots = await Promise.all(cachedFamilies.map(family => getDoc(doc(db, "families", family.id))));
  for (const snapshot of cachedSnapshots) if (snapshot.exists()) familySnapshots.set(snapshot.id, snapshot);

  const freshFamilies = [...familySnapshots.values()].map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
  const allPersonIds = new Set([...personIds, ...freshFamilies.flatMap(familyPersonIds)]);
  if (allPersonIds.size + freshFamilies.length + treesToRead.size > MAX_MULTI_TREE_TRANSFER_READS) {
    throw new Error(`Les relations concernent trop de documents pour une transaction sûre (limite ${MAX_MULTI_TREE_TRANSFER_READS}). Réduisez la sélection.`);
  }
  const personSnapshots = await Promise.all([...allPersonIds].map(id => getDoc(doc(db, "people", id))));
  const freshPeople = personSnapshots.filter(snapshot => snapshot.exists())
    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
  return { people: freshPeople, families: freshFamilies };
}

const multipleTreeTransferPicker = createPersonMultiSelect({
  kind: "tree-transfer",
  root: $("multiTreeTransferPickerRoot"),
  input: $("multiTreeTransferSearch"),
  chips: $("multiTreeTransferChips"),
  results: $("multiTreeTransferResults"),
  dialog: $("multiTreeTransferDialog"),
  minQueryLength: DOSSIER_MIN_QUERY_LENGTH,
  findMatches: (queryText, selectedIds) => {
    const text = searchable(queryText);
    if (text.length < DOSSIER_MIN_QUERY_LENGTH || selectedIds.size >= MAX_MULTI_TREE_TRANSFER_PEOPLE) return [];
    const firstSelected = selectedIds.values().next().value;
    const selectedSource = firstSelected ? getPersonTreeMembership(person(firstSelected)) : null;
    return people.filter(item => getPersonTreeMembership(item).type === "assigned"
      && canChangePersonTree(item)
      && (!selectedSource || (selectedSource.type === "assigned" && getPersonTreeMembership(item).treeId === selectedSource.treeId))
      && !selectedIds.has(item.id)
      && searchable(`${item.firstName || ""} ${item.middleName || ""} ${item.lastName || ""} ${item.marriedName || ""}`).includes(text))
      .sort(comparePeopleBySurname)
      .slice(0, PERSON_PICKER_MAX_RESULTS);
  },
  suggestionFor: item => ({
    label: directoryDisplayName(item),
    context: `${directoryTreeLabel(item, treeMetadata)}${item.inTree === false ? " · Masquée de l’arbre" : ""}`
  }),
  nameFor: id => {
    const item = person(id);
    return item ? directoryDisplayName(item) : "Personne introuvable";
  },
  escapeHtml: esc,
  onChange: updateMultipleTreeTransferSelection
});

function updateMultipleTreeTransferDestination(sourceTreeId, preserveDestination = true) {
  const select = $("multiTreeTransferDestination");
  const previous = preserveDestination ? select.value : "";
  const destinations = [
    ...(sourceTreeId !== MAIN_TREE_ID ? [{ id: MAIN_TREE_ID, name: "Arbre familial" }] : []),
    ...treeMetadata.filter(tree => tree.id !== sourceTreeId && getTreeLifecycleState(tree) === TREE_LIFECYCLE_ACTIVE).map(tree => ({ id: tree.id, name: tree.name }))
  ];
  select.innerHTML = '<option value="">Choisir une destination…</option>'
    + destinations.map(tree => `<option value="${esc(tree.id)}">${esc(tree.name)}</option>`).join("");
  select.disabled = !sourceTreeId || !destinations.length || multipleTreeTransferSaving;
  if (destinations.some(tree => tree.id === previous)) select.value = previous;
}

function showMultipleTreeTransferError(message) {
  const error = $("multiTreeTransferError");
  error.textContent = message;
  error.hidden = !message;
}

function renderMultipleTreeTransferPreview(plan) {
  const selectedRows = plan.selectedPeople.map(item => {
    const hidden = !item.inTree ? " · Masquée de l’arbre (restera masquée)" : "";
    return `<li><strong>${esc(item.name)}</strong><span>${esc(transferTreeName(item.treeId))}${esc(hidden)}</span></li>`;
  }).join("");
  const familyRows = plan.affectedFamilies.map(family => {
    const selectedNames = family.members.filter(member => member.selected).map(member => member.name);
    const remainingNames = family.members.filter(member => !member.selected).map(member => member.name);
    const category = family.internalToSelection
      ? "Relation entre personnes transférées"
      : "Relation avec une personne non transférée";
    const outsideTrees = family.otherTreeMemberIds.map(id => family.members.find(member => member.id === id)?.name).filter(Boolean);
    const before = family.beforeVisibleTreeIds.length ? transferFamilyTreeNames(family.beforeVisibleTreeIds) : "aucun arbre";
    const after = family.afterVisibleTreeIds.length ? transferFamilyTreeNames(family.afterVisibleTreeIds) : "aucun arbre";
    const missing = family.members.filter(member => !member.exists).length;
    const details = [
      `Transférées : ${selectedNames.join(" · ") || "—"}`,
      `Restent dans leur arbre : ${remainingNames.join(" · ") || "aucune"}`,
      `Visibilité du foyer : ${before} → ${after}`,
      outsideTrees.length ? `Liens déjà situés dans d’autres arbres : ${outsideTrees.join(" · ")}` : "",
      family.unassignedMemberIds.length ? `Sans arbre : ${family.unassignedMemberIds.map(id => family.members.find(member => member.id === id)?.name).filter(Boolean).join(" · ")}` : "",
      family.invalidMembershipIds.length ? `${family.invalidMembershipIds.length} appartenance${family.invalidMembershipIds.length > 1 ? "s" : ""} indisponible${family.invalidMembershipIds.length > 1 ? "s" : ""}` : "",
      missing ? `${missing} référence${missing > 1 ? "s" : ""} de personne introuvable${missing > 1 ? "s" : ""} (conservée${missing > 1 ? "s" : ""})` : ""
    ].filter(Boolean);
    return `<li><strong>${esc(category)}</strong><span>${details.map(esc).join(" · ")}</span></li>`;
  }).join("");
  const warnings = [];
  if (plan.summary.hiddenSelectionCount) warnings.push(`${plan.summary.hiddenSelectionCount} fiche${plan.summary.hiddenSelectionCount > 1 ? "s" : ""} masquée${plan.summary.hiddenSelectionCount > 1 ? "s" : ""} restera${plan.summary.hiddenSelectionCount > 1 ? "ont" : "a"} masquée${plan.summary.hiddenSelectionCount > 1 ? "s" : ""}.`);
  if (plan.summary.boundaryFamilyCount) warnings.push("Les liens avec les personnes non transférées resteront enregistrés ; leur affichage dépendra des règles actuelles de visibilité par arbre.");
  if (plan.summary.otherTreeLinkCount) warnings.push("Certains foyers concernés comportent déjà des liens avec d’autres arbres ; aucune relation ne sera supprimée.");
  if (plan.summary.unassignedRelatedCount) warnings.push("Les personnes sans arbre liées aux foyers sélectionnés ne seront ni déplacées ni affectées automatiquement.");
  const warningHtml = warnings.length ? `<div class="multi-tree-transfer-warning">${warnings.map(text => `<p>${esc(text)}</p>`).join("")}</div>` : "";
  $("multiTreeTransferPreview").innerHTML = `<h4>Aperçu du transfert</h4><p><strong>${plan.summary.selectedCount} personne${plan.summary.selectedCount > 1 ? "s" : ""}</strong> : ${esc(plan.sourceTreeName)} → ${esc(plan.destinationTreeName)}.</p><p>${plan.summary.affectedFamilyCount} foyer${plan.summary.affectedFamilyCount > 1 ? "s" : ""} concerné${plan.summary.affectedFamilyCount > 1 ? "s" : ""} · ${plan.summary.internalFamilyCount} relation${plan.summary.internalFamilyCount > 1 ? "s" : ""} interne${plan.summary.internalFamilyCount > 1 ? "s" : ""} · ${plan.summary.boundaryFamilyCount} foyer${plan.summary.boundaryFamilyCount > 1 ? "s" : ""} avec des personnes non transférées.</p><h4>Personnes sélectionnées</h4><ul class="person-tree-transfer-list">${selectedRows}</ul>${familyRows ? `<h4>Relations concernées</h4><ul class="person-tree-transfer-list">${familyRows}</ul>` : "<p>Aucun foyer ne référence ces personnes.</p>"}${warningHtml}`;
}

function previewMultipleTreeTransfer() {
  const state = multipleTreeTransferState;
  const destination = $("multiTreeTransferDestination").value;
  const confirm = $("confirmMultiTreeTransferBtn");
  state.plan = null;
  confirm.disabled = true;
  showMultipleTreeTransferError("");
  if (!state.personIds.length) {
    $("multiTreeTransferPreview").innerHTML = "<p>Sélectionnez les personnes, puis choisissez la destination pour voir les relations concernées.</p>";
    return;
  }
  if (!destination) {
    $("multiTreeTransferPreview").innerHTML = "<p>Choisissez l’arbre de destination pour afficher l’aperçu détaillé.</p>";
    return;
  }
  try {
    state.plan = prepareMultipleTreeTransferPlan({
      personIds: state.personIds, people, families, trees: treeMetadata, destinationTreeId: destination
    });
    renderMultipleTreeTransferPreview(state.plan);
    confirm.disabled = false;
  } catch (error) {
    $("multiTreeTransferPreview").innerHTML = `<p>${esc(error.message || "Impossible de préparer l’aperçu.")}</p>`;
  }
}

function updateMultipleTreeTransferSelection() {
  const state = multipleTreeTransferState;
  if (!state) return;
  const ids = multipleTreeTransferPicker.getSelected();
  const previousSource = state.sourceTreeId;
  state.personIds = ids;
  state.sourceTreeId = ids.length ? getPersonTreeMembership(person(ids[0])).treeId : null;
  $("multiTreeTransferSelectionCount").textContent = `${ids.length} personne${ids.length > 1 ? "s" : ""} sélectionnée${ids.length > 1 ? "s" : ""} sur ${MAX_MULTI_TREE_TRANSFER_PEOPLE} maximum`;
  $("clearMultiTreeTransferSelectionBtn").disabled = !ids.length || multipleTreeTransferSaving;
  $("multiTreeTransferSource").textContent = state.sourceTreeId ? transferTreeName(state.sourceTreeId) : "Sélectionnez des personnes";
  const note = $("multiTreeTransferSelectionNote");
  note.textContent = ids.length >= MAX_MULTI_TREE_TRANSFER_PEOPLE
    ? `Limite de ${MAX_MULTI_TREE_TRANSFER_PEOPLE} personnes atteinte. Les personnes doivent appartenir au même arbre source.`
    : `Sélectionnez jusqu’à ${MAX_MULTI_TREE_TRANSFER_PEOPLE} personnes du même arbre source. Les fiches masquées restent masquées après le transfert.`;
  if (previousSource !== state.sourceTreeId) updateMultipleTreeTransferDestination(state.sourceTreeId, false);
  else updateMultipleTreeTransferDestination(state.sourceTreeId, true);
  previewMultipleTreeTransfer();
}

function openMultipleTreeTransfer() {
  if (!isAdminUser()) return toast("Accès réservé aux administrateurs", "error");
  if (treeCatalogState !== "ready") return toast("Le catalogue des arbres est indisponible", "error");
  if (!loadedPeople || !loadedFamilies) return toast("Les personnes et foyers ne sont pas encore chargés", "error");
  multipleTreeTransferSaving = false;
  multipleTreeTransferState = { personIds: [], sourceTreeId: null, plan: null };
  multipleTreeTransferPicker.setSelected([]);
  updateMultipleTreeTransferDestination(null, false);
  updateMultipleTreeTransferSelection();
  $("multiTreeTransferDialog").showModal();
  setTimeout(() => $("multiTreeTransferSearch").focus(), 30);
}

async function confirmMultipleTreeTransfer() {
  if (multipleTreeTransferSaving) return;
  if (!isAdminUser()) return showMultipleTreeTransferError("Seuls les administrateurs peuvent transférer des personnes.");
  const state = multipleTreeTransferState;
  const expectedPlan = state?.plan;
  if (!expectedPlan) return showMultipleTreeTransferError("Sélectionnez les personnes, choisissez la destination et vérifiez l’aperçu avant de confirmer.");
  multipleTreeTransferSaving = true;
  const button = $("confirmMultiTreeTransferBtn");
  setButtonPending(button, true, "Vérification…");
  $("multiTreeTransferDestination").disabled = true;
  $("multiTreeTransferSearch").disabled = true;
  $("clearMultiTreeTransferSelectionBtn").disabled = true;
  $("multiTreeTransferPickerRoot").querySelectorAll("button").forEach(item => { item.disabled = true; });
  $("multiTreeTransferDialog").querySelectorAll('[data-close="multiTreeTransferDialog"]').forEach(item => { item.disabled = true; });
  showMultipleTreeTransferError("");
  try {
    if (!isAdminUser()) throw new Error("Votre rôle ne permet plus ce transfert.");
    if (treeCatalogState !== "ready"
      || (expectedPlan.sourceTreeId !== MAIN_TREE_ID && !treeMetadata.some(tree => tree.id === expectedPlan.sourceTreeId))
      || (expectedPlan.destinationTreeId !== MAIN_TREE_ID && !treeMetadata.some(tree => tree.id === expectedPlan.destinationTreeId))) {
      throw new Error("L’arbre source ou la destination n’est plus disponible. Fermez le dialogue et recommencez.");
    }
    if (expectedPlan.personIds.length > MAX_MULTI_TREE_TRANSFER_PEOPLE
      || expectedPlan.readDocumentCount > MAX_MULTI_TREE_TRANSFER_READS) {
      throw new Error("Cette sélection dépasse la limite de sécurité d’une transaction unique. Réduisez-la.");
    }

    const fresh = await readFreshMultipleTreeTransferData(expectedPlan.personIds, expectedPlan.destinationTreeId);
    const refreshedPlan = prepareMultipleTreeTransferPlan({
      personIds: expectedPlan.personIds, people: fresh.people, families: fresh.families,
      trees: treeMetadata, destinationTreeId: expectedPlan.destinationTreeId
    });
    if (refreshedPlan.fingerprint !== expectedPlan.fingerprint) {
      state.plan = refreshedPlan;
      state.sourceTreeId = refreshedPlan.sourceTreeId;
      renderMultipleTreeTransferPreview(refreshedPlan);
      showMultipleTreeTransferError("Les personnes ou relations ont changé depuis l’aperçu. Vérifiez le nouvel aperçu puis confirmez à nouveau.");
      return;
    }

    const selectedIds = expectedPlan.personIds;
    const personDocumentIds = [...new Set([...selectedIds, ...expectedPlan.affectedFamilies.flatMap(family => family.memberIds)])];
    const familyDocumentIds = expectedPlan.affectedFamilies.map(family => family.familyId);
    const sourceTreeRef = expectedPlan.sourceTreeId === MAIN_TREE_ID ? null : doc(db, "trees", expectedPlan.sourceTreeId);
    const destinationTreeRef = expectedPlan.destinationTreeId === MAIN_TREE_ID ? null : doc(db, "trees", expectedPlan.destinationTreeId);

    await runTransaction(db, async transaction => {
      const personSnapshots = await Promise.all(personDocumentIds.map(id => transaction.get(doc(db, "people", id))));
      const familySnapshots = await Promise.all(familyDocumentIds.map(id => transaction.get(doc(db, "families", id))));
      const sourceTreeSnapshot = sourceTreeRef ? await transaction.get(sourceTreeRef) : null;
      const destinationTreeSnapshot = destinationTreeRef ? await transaction.get(destinationTreeRef) : null;

      const peopleById = new Map(personSnapshots.filter(snapshot => snapshot.exists())
        .map(snapshot => [snapshot.id, { id: snapshot.id, ...snapshot.data() }]));
      for (const id of selectedIds) if (!peopleById.has(id)) throw new Error("Une personne sélectionnée a été supprimée ou n’est plus accessible.");
      const txFamilies = familySnapshots.filter(snapshot => snapshot.exists())
        .map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));

      if (sourceTreeSnapshot && !sourceTreeSnapshot.exists()) throw new Error("L’arbre source n’existe plus.");
      if (destinationTreeSnapshot && !destinationTreeSnapshot.exists()) throw new Error("L’arbre de destination n’existe plus.");
      if (destinationTreeSnapshot && getTreeLifecycleState(destinationTreeSnapshot.data()) !== TREE_LIFECYCLE_ACTIVE) {
        throw new Error("L’arbre de destination est en cours de suppression. Aucune personne n’a été transférée.");
      }
      if (sourceTreeSnapshot && sourceTreeSnapshot.data().name !== expectedPlan.sourceTreeName) throw new Error("Le nom de l’arbre source a changé depuis l’aperçu. Recommencez.");
      if (destinationTreeSnapshot && destinationTreeSnapshot.data().name !== expectedPlan.destinationTreeName) throw new Error("Le nom de l’arbre de destination a changé depuis l’aperçu. Recommencez.");
      if (selectedIds.some(id => {
        const membership = getPersonTreeMembership(peopleById.get(id));
        return membership.type !== "assigned" || membership.treeId !== expectedPlan.sourceTreeId;
      })) {
        throw new Error("L’appartenance d’une personne sélectionnée a changé depuis l’aperçu. Fermez le dialogue et recommencez.");
      }

      const txPlan = prepareMultipleTreeTransferPlan({
        personIds: selectedIds, people: [...peopleById.values()], families: txFamilies,
        trees: treeMetadata, destinationTreeId: expectedPlan.destinationTreeId
      });
      if (txPlan.readDocumentCount > MAX_MULTI_TREE_TRANSFER_READS) {
        throw new Error("Les relations ont dépassé la limite de lecture sûre pendant la transaction. Aucune personne n’a été transférée.");
      }
      if (txPlan.fingerprint !== expectedPlan.fingerprint) {
        const error = new Error("Les personnes, appartenances ou relations ont changé pendant la confirmation. Fermez et recommencez.");
        error.code = "multi-tree-transfer-stale";
        throw error;
      }

      const uid = auth.currentUser?.uid || "";
      if (!uid) throw new Error("Votre session a expiré; reconnectez-vous avant le transfert.");
      // Toutes les lectures et validations précèdent les écritures. Firestore
      // valide l'ensemble des treeId dans une transaction indivisible ; aucune
      // famille, relation ou autre personne n'est écrite.
      for (const id of selectedIds) {
        const livePerson = peopleById.get(id);
        const changes = { treeId: expectedPlan.destinationTreeId };
        if (Object.prototype.hasOwnProperty.call(livePerson, "updatedBy") && livePerson.updatedBy !== uid) {
          changes.updatedBy = uid;
          changes.updatedByName = currentUserProfile?.displayName || "";
        }
        transaction.update(doc(db, "people", id), changes);
      }
    });

    close("multiTreeTransferDialog");
    multipleTreeTransferState = null;
    toast(`${expectedPlan.personIds.length} personnes transférées vers ${expectedPlan.destinationTreeName}.`);
  } catch (error) {
    console.error("Transfert multiple impossible", error);
    if (error.code === "multi-tree-transfer-stale" && multipleTreeTransferState) multipleTreeTransferState.plan = null;
    const text = `${error.code || ""} ${error.message || ""}`;
    const message = /permission-denied|insufficient permissions/i.test(text)
      ? "Transfert refusé par les règles Firestore. Vérifiez votre rôle et l’arbre de destination."
      : /unavailable|network|offline|failed to fetch|deadline-exceeded/i.test(text)
        ? "Connexion impossible; aucune personne n’a été transférée. Réessayez après vérification."
        : error.message || "Le transfert multiple n’a pas pu être effectué.";
    showMultipleTreeTransferError(message);
  } finally {
    multipleTreeTransferSaving = false;
    setButtonPending(button, false);
    button.disabled = !multipleTreeTransferState?.plan;
    $("multiTreeTransferSearch").disabled = false;
    $("multiTreeTransferPickerRoot").querySelectorAll("button").forEach(item => { item.disabled = false; });
    $("multiTreeTransferDestination").disabled = !multipleTreeTransferState?.sourceTreeId
      || $("multiTreeTransferDestination").options.length <= 1;
    $("clearMultiTreeTransferSelectionBtn").disabled = !multipleTreeTransferState?.personIds.length;
    $("multiTreeTransferDialog").querySelectorAll('[data-close="multiTreeTransferDialog"]').forEach(item => { item.disabled = false; });
  }
}

$("multiTreeTransferOpenBtn").addEventListener("click", openMultipleTreeTransfer);
$("multiTreeTransferDestination").addEventListener("change", previewMultipleTreeTransfer);
$("confirmMultiTreeTransferBtn").addEventListener("click", confirmMultipleTreeTransfer);
$("clearMultiTreeTransferSelectionBtn").addEventListener("click", () => {
  multipleTreeTransferPicker.setSelected([]);
  updateMultipleTreeTransferSelection();
});
$("multiTreeTransferDialog").addEventListener("cancel", event => {
  if (multipleTreeTransferSaving) event.preventDefault();
});
$("multiTreeTransferDialog").addEventListener("close", () => {
  multipleTreeTransferState = null;
  multipleTreeTransferSaving = false;
  multipleTreeTransferPicker.setSelected([]);
});

function bindModalActionMenu(dialogId, buttonId, menuId) {
  const dialog = $(dialogId);
  const button = $(buttonId);
  const menu = $(menuId);
  const items = () => [...menu.querySelectorAll('[role="menuitem"]:not([hidden])')];
  const setOpen = (open, restoreFocus = false) => {
    const visibleItems = items();
    const nextOpen = Boolean(open && !button.hidden && visibleItems.length);
    menu.hidden = !nextOpen;
    button.setAttribute("aria-expanded", String(nextOpen));
    if (nextOpen) visibleItems[0]?.focus({ preventScroll: true });
    else if (restoreFocus && !button.hidden) button.focus();
  };

  button.addEventListener("click", event => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });
  button.addEventListener("keydown", event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const visibleItems = items();
    if (!visibleItems.length || button.hidden) return;
    setOpen(true);
    if (event.key === "ArrowUp") visibleItems[visibleItems.length - 1]?.focus({ preventScroll: true });
  });
  menu.addEventListener("click", event => {
    if (event.target.closest('[role="menuitem"]')) setOpen(false);
  });
  menu.addEventListener("keydown", event => {
    const visibleItems = items();
    const index = visibleItems.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!visibleItems.length) return;
      if (event.key === "Home") visibleItems[0].focus();
      else if (event.key === "End") visibleItems[visibleItems.length - 1].focus();
      else if (event.key === "ArrowDown") visibleItems[(index + 1) % visibleItems.length].focus();
      else visibleItems[(index - 1 + visibleItems.length) % visibleItems.length].focus();
    }
  });
  document.addEventListener("click", event => {
    if (menu.hidden || menu.contains(event.target) || button.contains(event.target)) return;
    setOpen(false);
  });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape" || menu.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false, true);
  });
  dialog.addEventListener("close", () => setOpen(false));

  return { close: () => setOpen(false) };
}

const taskActionMenu = bindModalActionMenu("taskDialog", "taskMenuBtn", "taskActionMenu");
const documentActionMenu = bindModalActionMenu("documentDialog", "documentMenuBtn", "documentActionMenu");
const procedureActionMenu = bindModalActionMenu("procedureActionDialog", "procedureActionMenuBtn", "procedureActionMenu");

$("printPersonBtn").onclick = () => openPersonPrint();
$("personPrintGoBtn").onclick = () => {
  const sheet = $("personPrintSheet");
  if (!sheet || !sheet.innerHTML) {
    toast("Ouvrez d’abord l’aperçu de la fiche avant d’imprimer.", "error");
    return;
  }
  /* iOS Safari : window.print() n'est pas bloquant et rend la page de façon
     asynchrone. L'état d'impression et le portail ne doivent donc jamais être
     nettoyés immédiatement — uniquement après « afterprint », avec un
     fallback temporisé si l'événement n'existe pas sur le navigateur. */
  let restored = false;
  let fallbackTimer = 0;
  const restorePrintingState = () => {
    if (restored) return;
    restored = true;
    window.removeEventListener("afterprint", restorePrintingState);
    window.clearTimeout(fallbackTimer);
    document.body.classList.remove("is-printing-person");
    const portal = $("printPortal");
    if (portal) portal.innerHTML = "";
  };
  try {
    $("printPortal").innerHTML = sheet.innerHTML;
    document.body.classList.add("is-printing-person");
    window.addEventListener("afterprint", restorePrintingState);
    /* Attendre deux cycles de rendu : les styles @media print doivent être
       appliqués dans une frame effective avant l'appel natif (iOS). */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        window.print();
        /* Fallback prudent : sans afterprint après 60 s, restaurer l'interface
           sans risquer la production du PDF sur iOS. */
        fallbackTimer = window.setTimeout(() => restorePrintingState(), 60000);
      } catch (printError) {
        console.error(printError);
        toast("L’impression n’a pas pu démarrer dans ce navigateur.", "error");
      }
    }));
  } catch (error) {
    console.error(error);
    restorePrintingState();
    toast("L’impression n’a pas pu démarrer dans ce navigateur.", "error");
  }
};

const DOCUMENT_FILE_METADATA_FIELDS = ["fileName", "fileSize", "storedSize", "mimeType", "compressed", "storageMode", "chunkVersion", "chunkCount", "fileData", "fileUrl", "storagePath"];

function hasStoredDocumentFile(item) {
  return !!(item && DOCUMENT_FILE_METADATA_FIELDS.some(field => item[field] !== undefined && item[field] !== null && item[field] !== ""));
}

function canSafelyRemoveStoredDocumentFile(item) {
  if (!hasStoredDocumentFile(item) || item.storagePath) return false;
  const referencesChunks = item.storageMode === "firestore-chunks" || !!item.chunkVersion || item.chunkCount !== undefined;
  return !referencesChunks || (!!item.chunkVersion && Number.isInteger(item.chunkCount) && item.chunkCount >= 0);
}

function renderDocumentFileState(item = documents.find(documentItem => documentItem.id === $("documentId").value)) {
  const hasCurrentFile = hasStoredDocumentFile(item);
  const selectedFile = $("documentFile").files?.[0] || null;
  const markedForRemoval = hasCurrentFile && documentFileMarkedForRemoval && !selectedFile;
  $("documentCurrentFileArea").hidden = !hasCurrentFile;
  $("currentDocumentFile").textContent = hasCurrentFile
    ? `${item.fileName || "Fichier associé"}${item.storedSize ? ` · ${formatBytes(item.storedSize)} stockés${item.compressed ? " après optimisation" : ""}` : ""}`
    : "";
  $("removeCurrentDocumentFileBtn").hidden = !hasCurrentFile || !canSafelyRemoveStoredDocumentFile(item) || documentFileMarkedForRemoval || !!selectedFile;
  $("restoreCurrentDocumentFileBtn").hidden = !markedForRemoval;
  $("documentFileRemovalNote").hidden = !markedForRemoval;
  $("documentSelectedFileArea").hidden = !selectedFile;
  $("documentSelectedFileText").textContent = selectedFile
    ? `Fichier sélectionné : ${selectedFile.name}${hasCurrentFile ? " · remplacera le fichier actuel à l’enregistrement" : " · prêt à être enregistré"}.`
    : "";
  $("documentFileRemovalUnavailable").hidden = !hasCurrentFile || canSafelyRemoveStoredDocumentFile(item);
}

function openDocument(item = null, preselectedPersonId = "", returnContext = null) {
  documentReturnContext = returnContext;
  documentActionMenu.close();
  $("documentForm").reset();
  documentFileMarkedForRemoval = false;
  $("documentId").value = item?.id || "";
  $("documentDialogTitle").textContent = item ? "Modifier le document" : "Ajouter un document";
  $("documentTitle").value = item?.title || "";
  $("documentType").value = item?.type || "";
  $("documentDate").value = item?.date || "";
  setLocationField("documentPlace", item?.place || "", item?.placeInfo);
  $("documentUrl").value = item?.externalUrl || "";
  $("documentNotes").value = item?.notes || "";
  documentPeoplePicker.setSelected(item?.personIds || (preselectedPersonId ? [preselectedPersonId] : []));
  renderDocumentFileState(item);
  $("documentProgress").textContent = "";
  $("documentMenuBtn").hidden = !item;
  $("deleteDocumentBtn").hidden = !item;
  $("documentDialog").showModal();
}

function renderDocuments() {
  const query = searchable($("documentSearch").value);
  const type = $("documentTypeFilter").value;
  const filtered = documents.filter(item => (!type || item.type === type) && (!query || searchable(`${documentDisplayLabel(item)} ${item.fileName || ""} ${item.type || ""} ${item.place || ""} ${item.notes || ""} ${(item.personIds || []).map(nameOf).join(" ")}`).includes(query)));
  $("documentsList").innerHTML = filtered.length ? filtered.map(item => {
    const compactPlace = formatCompactPlace(item.place, item.placeInfo);
    const label = documentDisplayLabel(item);
    const renditionStatus = item.compressed || item.mimeType === "image/webp"
      ? "Image historique optimisée (WebP) · pas un original"
      : item.chunkCount || item.fileData ? "Fichier historique · original non vérifié" : "Référence externe";
    const canOpen = !!(item.chunkCount || item.fileData || item.fileUrl || item.externalUrl);
    const tileSemantics = canOpen ? `data-primary-tile data-document-openable="true" tabindex="0" role="group" aria-label="Consulter ${esc(label)}" aria-keyshortcuts="Enter Space"` : `data-document-openable="false"`;
    const menu = tileContextMenuMarkup("document", item.id, label, [
      { key: "edit", label: "Modifier", icon: "edit" },
      { key: "delete", label: "Supprimer", icon: "trash", danger: true }
    ]);
    return `<article class="content-card document-card" data-document-card="${item.id}" ${tileSemantics}><div><span class="badge">${esc(item.type || "Document")}</span><h3>${esc(label)}</h3></div><p class="card-meta">${item.date ? esc(new Date(item.date + "T12:00:00").toLocaleDateString("fr-FR")) : "Date non renseignée"}${compactPlace ? ` · ${esc(compactPlace)}` : ""}</p><div class="document-card-details"><p class="document-card-people">${(item.personIds || []).length ? `Associé à : ${esc(item.personIds.map(nameOf).join(", "))}` : "Aucune personne associée"}</p>${item.notes ? `<p class="card-description">${esc(item.notes)}</p>` : ""}${item.storedSize ? `<p class="list-optional">${esc(renditionStatus)} · ${formatBytes(item.storedSize)}</p>` : `<p class="list-optional">${esc(renditionStatus)}</p>`}</div><div class="card-actions">${menu}</div></article>`;
  }).join("") : (documents.length
    ? emptyState({ iconName: "document", title: "Aucun document trouvé", description: "Modifiez la recherche ou le type de document sélectionné." })
    : emptyState({ iconName: "document", title: "Aucun document", description: "Centralisez ici les actes, photos et autres archives familiales.", action: `<button class="btn primary" type="button" data-empty-add-document>${icon("plus")}<span>Ajouter un document</span></button>` }));
  setContentMode("documents", viewModes.documents || "cards", false);
  if (activeId && $("personDialog").open) renderPersonDocuments(activeId);
}

function genealogyRecordData(record) {
  return record?.data && typeof record.data === "object" ? record.data : record || {};
}

function genealogyWorkspaceItems() {
  const sources = [
    ...genealogyRecords.sourceDocuments.map(record => ({ kind: "source", record, data: genealogyRecordData(record), official: true })),
    ...documents.filter(record => !genealogyRecords.sourceDocuments.some(source => source.id === record.id))
      .map(record => ({ kind: "legacy-source", record, data: record, official: false }))
  ];
  const transcriptions = genealogyRecords.transcriptionHeads.map(record => ({ kind: "transcription", record, data: genealogyRecordData(record), official: true }));
  const proofs = genealogyRecords.genealogyProofs.map(record => ({ kind: "proof", record, data: genealogyRecordData(record), official: true }));
  const conclusions = genealogyRecords.factConclusions.map(record => ({ kind: "conclusion", record, data: genealogyRecordData(record), official: true }));
  const proposals = genealogyRecords.genealogyProposals.map(record => ({ kind: "proposal", record, data: record, official: false }));
  const events = genealogyRecords.genealogyEvents.map(record => ({ kind: "event", record, data: record, official: false }));
  const notifications = genealogyRecords.genealogyNotifications.map(record => ({ kind: "notification", record, data: record, official: false }));
  return [...sources, ...transcriptions, ...proofs, ...conclusions, ...proposals, ...events, ...notifications];
}

const genealogyKindLabels = {
  source: "Source officielle", "legacy-source": "Document historique", transcription: "Transcription",
  proof: "Preuve", conclusion: "Conclusion", proposal: "Proposition", event: "Historique", notification: "Notification"
};

function renderGenealogyWorkspace() {
  const panel = $("genealogyResults");
  if (!panel) return;
  const queryText = searchable($("genealogySearch")?.value || "");
  const kind = $("genealogyKindFilter")?.value || "all";
  const items = genealogyWorkspaceItems().filter(item => {
    if (kind !== "all" && !((kind === "sources" && ["source", "legacy-source"].includes(item.kind))
      || (kind === "transcriptions" && item.kind === "transcription")
      || (kind === "proofs" && item.kind === "proof")
      || (kind === "conclusions" && item.kind === "conclusion")
      || (kind === "proposals" && item.kind === "proposal")
      || (kind === "history" && item.kind === "event")
      || (kind === "notifications" && item.kind === "notification"))) return false;
    if (!queryText) return true;
    const recordText = JSON.stringify([item.kind, item.record, item.data, item.record.authorUid ? nameOf(item.record.authorUid) : ""]);
    return searchable(recordText).includes(queryText);
  });
  const unread = genealogyRecords.genealogyNotifications.filter(item => item.read !== true).length;
  const loadedStatus = `${items.length} élément${items.length === 1 ? "" : "s"} affiché${items.length === 1 ? "" : "s"}${unread ? ` · ${unread} notification${unread === 1 ? "" : "s"} non lue${unread === 1 ? "" : "s"}` : ""}`;
  const unavailableStatus = genealogyCollectionErrors.size ? ` · Données indisponibles : ${[...genealogyCollectionErrors].join(", ")}` : "";
  $("genealogyStatus").textContent = genealogyLoaded ? `${loadedStatus}${unavailableStatus}` : genealogyCollectionErrors.size ? `Chargement incomplet${unavailableStatus}` : "Chargement des archives…";
  panel.innerHTML = items.length ? items.map(item => {
    const record = item.record;
    const data = item.data;
    const title = data.title || data.factType || data.eventType || data.type || record.id;
    const status = record.status || data.technicalStatus || data.status || (item.kind === "notification" ? record.read ? "Lue" : "Non lue" : "");
    const updatedLabel = record.updatedAt?.toDate ? record.updatedAt.toDate().toLocaleString("fr-FR") : "";
    const subtitle = [record.id, data.documentId, data.pageId, data.factId, updatedLabel, record.updatedByName].filter(Boolean).join(" · ");
    const controls = [];
    controls.push(`<button class="btn small" type="button" data-genealogy-open="${esc(item.kind)}" data-genealogy-id="${esc(record.id)}">Consulter</button>`);
    if (item.kind === "proposal" && record.status === "draft" && record.authorUid === auth.currentUser?.uid) {
      controls.push(`<button class="btn small" type="button" data-genealogy-proposal-action="submit" data-genealogy-id="${esc(record.id)}">Soumettre</button>`);
      controls.push(`<button class="btn small" type="button" data-genealogy-proposal-action="cancel" data-genealogy-id="${esc(record.id)}">Annuler le brouillon</button>`);
    }
    if (item.kind === "proposal" && record.status === "pending" && isAdminUser()) {
      controls.push(`<button class="btn small primary" type="button" data-genealogy-proposal-action="accept" data-genealogy-id="${esc(record.id)}">Accepter</button>`);
      controls.push(`<button class="btn small" type="button" data-genealogy-proposal-action="reject" data-genealogy-id="${esc(record.id)}">Refuser</button>`);
    }
    if (item.official && isAdminUser()) controls.push(`<button class="btn small" type="button" data-genealogy-revise="${esc(item.kind)}" data-genealogy-id="${esc(record.id)}">Réviser</button>`);
    if (item.kind === "notification" && record.read !== true) controls.push(`<button class="btn small" type="button" data-genealogy-notification-read="${esc(record.id)}">Marquer comme lue</button>`);
    if (isAdminUser() && item.kind === "proof" && data.technicalStatus !== "suspended") controls.push(`<button class="btn small" type="button" data-genealogy-review="proof" data-genealogy-id="${esc(record.id)}">Demander réexamen</button>`);
    if (isAdminUser() && item.kind === "conclusion") controls.push(`<button class="btn small" type="button" data-genealogy-review="conclusion" data-genealogy-id="${esc(record.id)}">Demander réexamen</button>`);
    const review = data.technicalStatus === "suspended" || data.status === "reexamination_required" ? `<span class="genealogy-status-badge">À vérifier</span>` : "";
    const contradiction = item.kind === "proof" && data.factId && genealogyRecords.genealogyProofs.some(other => {
      const otherData = genealogyRecordData(other);
      return other.id !== record.id && otherData.factId === data.factId && new Set([data.relation, otherData.relation]).has("supports") && new Set([data.relation, otherData.relation]).has("contradicts");
    }) ? `<span class="genealogy-status-badge">Contradiction à examiner</span>` : "";
    return `<article class="content-card genealogy-entry"><div class="genealogy-entry-heading"><div><span class="genealogy-entry-kind">${esc(genealogyKindLabels[item.kind] || item.kind)}</span><h3>${esc(title)}</h3></div>${status ? `<span class="genealogy-status-badge">${esc(status)}</span>` : ""}</div><p class="card-meta">${esc(subtitle)}</p>${review}${contradiction}<p class="genealogy-entry-content">${esc(JSON.stringify(data, null, 2).slice(0, 850))}</p><div class="genealogy-inline-actions">${controls.join("")}</div></article>`;
  }).join("") : emptyState({ iconName: "document", title: "Aucun élément trouvé", description: "Modifiez la recherche ou le filtre sélectionné." });
  $("genealogyOfficialBtn").hidden = !isAdminUser();
}

function openGenealogyItem(kind, id, pageOverride = null, photoOverride = null) {
  const item = genealogyWorkspaceItems().find(value => value.kind === kind && value.record.id === id);
  if (!item) return toast("Cet élément n’est plus disponible.", "error");
  if (kind === "legacy-source" && (item.record.chunkVersion || item.record.fileData?.startsWith("data:") || item.record.fileUrl || item.record.externalUrl)) return openStoredDocument(item.record);
  activeGenealogyItem = item;
  genealogyZoom = 1;
  const { record, data } = item;
  $("genealogyItemTitle").textContent = data.title || data.factType || data.eventType || data.type || genealogyKindLabels[kind];
  $("genealogyItemSubtitle").textContent = [genealogyKindLabels[kind], record.id, record.authorUid ? `Auteur historique : ${record.authorUid}` : ""].filter(Boolean).join(" · ");
  const transcriptionRevision = kind === "transcription"
    ? genealogyRecords.transcriptionRevisions.find(revision => revision.id === data.revisionId || revision.id === data.currentRevisionId)
    : null;
  const transcriptionData = transcriptionRevision ? genealogyRecordData(transcriptionRevision).data || genealogyRecordData(transcriptionRevision) : data.revision || data;
  const relatedDocumentId = data.documentId || transcriptionData.documentId || id;
  const documentRecord = documents.find(documentRecord => documentRecord.id === relatedDocumentId);
  const source = data.pages ? data : genealogyRecords.sourceDocuments.map(genealogyRecordData).find(value => value.id === relatedDocumentId);
  const pages = source?.pages || documentRecord?.pages || [];
  const requestedPageId = pageOverride || data.pageId || transcriptionData.pageId || pages[0]?.id;
  const page = pages.find(value => value.id === requestedPageId) || pages[0] || null;
  activeGenealogyPageId = page?.id || "";
  const transcriptRecord = kind === "transcription" ? transcriptionData : null;
  const passages = transcriptRecord?.passages || data.passages || data.revision?.passages || [];
  const pageNavigation = pages.length > 1 ? `<nav class="genealogy-inline-actions" aria-label="Pages du document">${pages.map((value, index) => `<button class="btn small${value.id === page?.id ? " primary" : ""}" type="button" data-genealogy-page="${esc(value.id)}">Page ${index + 1}${value.label ? ` · ${esc(value.label)}` : ""}</button>`).join("")}</nav>` : "";
  const photoRecords = page?.photographs || [];
  const selectedPhoto = photoRecords.find(photoItem => photoItem.id === (photoOverride || activeGenealogyPhotoId)) || photoRecords[0] || null;
  activeGenealogyPhotoId = selectedPhoto?.id || "";
  const imageCandidate = selectedPhoto?.preview?.dataUrl || selectedPhoto?.preview?.localUrl || selectedPhoto?.original?.dataUrl || "";
  const imageAvailable = imageCandidate.startsWith("data:image/") || imageCandidate.startsWith("blob:");
  const photoSelectors = photoRecords.length > 1 ? `<div class="genealogy-inline-actions" aria-label="Photographies de la page">${photoRecords.map((photoItem, index) => `<button class="btn small${photoItem.id === selectedPhoto?.id ? " primary" : ""}" type="button" data-genealogy-photo="${esc(photoItem.id)}">Photo ${index + 1}${photoItem.preview ? " · aperçu" : photoItem.original ? " · original référencé" : ""}</button>`).join("")}</div>` : "";
  const zoomTools = imageAvailable ? `<div class="genealogy-inline-actions"><button class="btn small" type="button" data-genealogy-zoom="out">Zoom −</button><button class="btn small" type="button" data-genealogy-zoom="reset">Réinitialiser</button><button class="btn small" type="button" data-genealogy-zoom="in">Zoom +</button></div>` : "";
  const photo = `<section>${pageNavigation}<div class="genealogy-photo-panel">${imageAvailable
    ? `<img id="genealogyPageImage" style="transform:scale(${genealogyZoom})" src="${esc(imageCandidate)}" alt="${selectedPhoto?.preview?.dataUrl ? "Aperçu" : "Image locale"} — ${esc(page?.label || "page")}">`
    : `<p>${photoRecords.length ? "Les photos sont référencées, mais leur stockage durable n’est pas disponible dans cette application." : "Aucune photographie n’est associée à cette page."}</p>`}</div>${photoSelectors}${zoomTools}</section>`;
  const passageNavigation = passages.length > 1 ? `<nav class="genealogy-inline-actions" aria-label="Navigation entre les passages">${passages.map((passage, index) => `<button class="btn small" type="button" data-genealogy-passage="passage-${index}">Passage ${index + 1}</button>`).join("")}</nav>` : "";
  const transcript = passages.length ? `<section class="genealogy-transcript-panel"><h4>Transcription italienne et traduction française</h4>${passageNavigation}${passages.map((passage, index) => `<article id="passage-${index}" class="genealogy-passage" data-review="${passage.unreadable || (passage.hypotheses || []).length ? "true" : "false"}"><strong>Passage ${index + 1}${passage.lineLabel ? ` · ${esc(passage.lineLabel)}` : ""}</strong><p>${esc(passage.textIt || "Lecture indéchiffrable")}</p>${passage.translationFr ? `<p>${esc(passage.translationFr)}</p>` : `<p class="card-meta">Traduction non disponible</p>`}${(passage.hypotheses || []).map(hypothesis => `<p class="card-meta">Hypothèse (${esc(hypothesis.confidence || "unknown")}): ${esc(hypothesis.text || "")}${hypothesis.note ? ` · ${esc(hypothesis.note)}` : ""}</p>`).join("")}<button class="btn small" type="button" data-genealogy-passage-propose="${index}">Proposer une preuve sur ce passage</button></article>`).join("")}</section>` : `<section class="genealogy-transcript-panel"><p>Pas de transcription disponible pour cette version.</p>${JSON.stringify(data) !== "{}" ? `<pre>${esc(JSON.stringify(data, null, 2))}</pre>` : ""}</section>`;
  const linkedProofs = genealogyRecords.genealogyProofs.filter(proof => {
    const proofData = genealogyRecordData(proof);
    return proofData.documentId === id || proofData.documentId === source?.id || proofData.documentId === relatedDocumentId || proofData.transcriptionRevisionId === record.id || proofData.transcriptionRevisionId === transcriptionRevision?.id;
  });
  const historyCollection = ({ source: "sourceRevisions", transcription: "transcriptionRevisions", proof: "genealogyProofRevisions", conclusion: "conclusionRevisions" })[kind];
  const history = historyCollection ? genealogyRecords[historyCollection].filter(revision => revision.objectId === id).map(revision => `<li>${esc(revision.id)} · ${esc(revision.createdAt || "date non renseignée")} · auteur ${esc(revision.authorUid || "inconnu")}</li>`).join("") : "";
  const historyBlock = history ? `<details><summary>Révisions historiques</summary><ol>${history}</ol></details>` : "";
  const proofKinds = new Set(linkedProofs.map(proof => genealogyRecordData(proof).relation));
  const contradictionNotice = proofKinds.has("supports") && proofKinds.has("contradicts") ? `<p class="genealogy-status-badge">Des affirmations contradictoires sont associées à cet élément.</p>` : "";
  const proofList = linkedProofs.length ? `<section><h4>Preuves liées (${linkedProofs.length})</h4>${contradictionNotice}${linkedProofs.map(proof => `<button class="btn small" type="button" data-open-genealogy="proof" data-genealogy-id="${esc(proof.id)}">${esc(genealogyRecordData(proof).factType || genealogyRecordData(proof).factId || proof.id)} · ${esc(genealogyRecordData(proof).relation || "mention")} · ${esc(genealogyRecordData(proof).technicalStatus || "active")}</button>`).join(" ")}</section>` : "";
  $("genealogyItemContent").innerHTML = `<div class="genealogy-detail-grid">${photo}${transcript}</div><p class="card-meta">État technique : ${esc(data.technicalStatus || data.status || "non précisé")} · Les conclusions n'altèrent pas les faits de l'arbre.</p>${historyBlock}${proofList}`;
  $("genealogyItemDialog").showModal();
}

function openGenealogyPage(pageId) {
  if (!activeGenealogyItem) return;
  const { kind, record } = activeGenealogyItem;
  openGenealogyItem(kind, record.id, pageId, null);
}

function createGenealogyId(collectionRef) {
  return doc(collectionRef).id;
}

function openGenealogyContribution({ official = false, reviseItem = null } = {}) {
  if (official && !isAdminUser()) return toast("La création des données officielles est réservée aux administrateurs.", "error");
  $("genealogyContributionForm").reset();
  $("genealogyContributionNotice").textContent = official
    ? "Donnée officielle : la création ou la nouvelle révision et son événement d'historique seront enregistrés ensemble."
    : "Le brouillon ne modifie pas les données officielles. L’envoi exigera une validation administrative.";
  $("genealogyContributionTitle").textContent = reviseItem ? "Réviser la donnée officielle" : official ? "Créer une donnée officielle" : "Proposer une contribution";
  const correctionOption = [...$("genealogyContributionType").options].find(option => option.value === "correction");
  const conclusionOption = [...$("genealogyContributionType").options].find(option => option.value === "conclusion");
  if (correctionOption) correctionOption.hidden = official;
  if (conclusionOption) conclusionOption.hidden = !official;
  const kindMap = { source: "source", transcription: "transcription", proof: "proof", conclusion: "conclusion" };
  $("genealogyContributionType").value = reviseItem ? (kindMap[reviseItem.kind] || "source") : "source";
  $("genealogyContributionTarget").value = reviseItem?.record.id || "";
  if (reviseItem) {
    const current = reviseItem.data.revision || reviseItem.data;
    $("genealogyContributionTitleField").value = current.title || current.factType || reviseItem.record.id;
    $("genealogyContributionPayload").value = JSON.stringify(current, null, 2);
  }
  $("genealogyContributionDialog").dataset.official = String(official);
  $("genealogyContributionDialog").dataset.revision = String(!!reviseItem);
  $("genealogyContributionDialog").showModal();
}

function parseGenealogyPayload(text, title, type) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("La racine JSON doit être un objet.");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError && ["source", "correction"].includes(type)) return { title, notes: text };
    throw new Error(`Les données structurées doivent être un JSON valide. ${error.message}`);
  }
}

async function saveGenealogyContribution(event) {
  event.preventDefault();
  const official = $("genealogyContributionDialog").dataset.official === "true";
  const revise = $("genealogyContributionDialog").dataset.revision === "true";
  const type = $("genealogyContributionType").value;
  const title = $("genealogyContributionTitleField").value.trim();
  const text = $("genealogyContributionPayload").value.trim();
  const targetId = $("genealogyContributionTarget").value.trim() || createGenealogyId(refs.documents);
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) return toast("Votre session a expiré.", "error");
  try {
    const payload = parseGenealogyPayload(text, title, type);
    const eventId = createGenealogyId(refs.genealogyEvents);
    if (official) {
      const revisionCollection = ({ source: "sourceRevisions", transcription: "transcriptionRevisions", proof: "genealogyProofRevisions", conclusion: "conclusionRevisions" })[type];
      if (!revisionCollection) throw new Error("Type de donnée officielle non pris en charge.");
      const officialId = targetId;
      const revisionId = createGenealogyId(collection(db, revisionCollection));
      const currentHead = revise ? genealogyRecords[({ source: "sourceDocuments", transcription: "transcriptionHeads", proof: "genealogyProofs", conclusion: "factConclusions" })[type]].find(item => item.id === officialId) : null;
      if (revise && !currentHead) throw new Error("La donnée officielle à réviser n'est plus disponible.");
      let officialData;
      if (type === "source") {
        officialData = createSourceDocument({ ...payload, id: officialId, title: payload.title || title });
      } else if (type === "transcription") {
        officialData = createPageTextRevision({ ...payload, id: revisionId, previousRevisionId: revise ? currentHead.revisionId : null, authorUid: actorUid, changedAt: new Date().toISOString(), justification: payload.justification || title });
      } else if (type === "proof") {
        const proofInput = { ...(payload.data || payload) };
        if (proofInput.citation) {
          proofInput.citationIt ??= proofInput.citation.textIt ?? null;
          proofInput.citationFr ??= proofInput.citation.translationFr ?? null;
        }
        const proof = { ...createGenealogyProof({ ...proofInput, id: officialId, authorUid: actorUid, createdAt: new Date().toISOString() }), ...proofInput, id: officialId, authorUid: actorUid, createdAt: new Date().toISOString() };
        const validation = validateGenealogyProof(proof);
        if (!validation.valid) throw new Error(`Preuve invalide : ${validation.errors.join(" ; ")}`);
        officialData = proof;
      } else {
        const previousRevisionId = revise ? currentHead.revisionId : null;
        const conclusionInput = { ...payload };
        conclusionInput.subjectKind ??= conclusionInput.subject?.kind;
        conclusionInput.subjectId ??= conclusionInput.subject?.id;
        const revision = createConclusionRevision({
          ...conclusionInput, id: revisionId, conclusionId: officialId, previousRevisionId, authorUid: actorUid,
          createdAt: new Date().toISOString(), reason: conclusionInput.reason || title, justification: conclusionInput.justification || text,
          actorRole: "admin"
        });
        const existingHeads = genealogyRecords.factConclusions.filter(item => item.id !== officialId).map(item => genealogyRecordData(item));
        const head = revise
          ? { ...genealogyRecordData(currentHead), currentRevisionId: revisionId }
          : createConclusionHead({ id: officialId, factId: revision.factId, factType: revision.factType, firstRevision: revision }, { actorRole: "admin", existingHeads });
        officialData = { ...head, revision };
      }
      if (revise) {
        const eventType = type === "proof" && officialData.technicalStatus === "suspended" ? "proof.suspended"
          : type === "proof" && currentHead.data?.technicalStatus === "suspended" ? "proof.reassessed" : undefined;
        await genealogyStore.reviseOfficial({ type, id: officialId, revisionId, eventId, data: officialData, eventType, reason: title, actorUid });
      } else {
        await genealogyStore.createOfficial({ type, id: officialId, revisionId, eventId, data: officialData, reason: `Création officielle : ${title}`, actorUid });
      }
      toast(revise ? "Nouvelle révision officielle enregistrée." : "Donnée officielle créée avec son historique.");
    } else {
      const proposalId = createGenealogyId(refs.genealogyProposals);
      await genealogyStore.createProposal({
        proposal: { id: proposalId, type, targetType: type, targetId, payload: { title, data: payload } }, eventId, actorUid
      });
      toast("Brouillon de proposition enregistré.");
    }
    $("genealogyContributionDialog").close();
  } catch (error) {
    toast(error.message || "Enregistrement impossible.", "error");
  }
}

async function handleGenealogyWorkspaceClick(event) {
  const openButton = event.target.closest("[data-genealogy-open]");
  if (openButton) return openGenealogyItem(openButton.dataset.genealogyOpen, openButton.dataset.genealogyId);
  const reviseButton = event.target.closest("[data-genealogy-revise]");
  if (reviseButton) {
    const item = genealogyWorkspaceItems().find(value => value.kind === reviseButton.dataset.genealogyRevise && value.record.id === reviseButton.dataset.genealogyId);
    if (item) openGenealogyContribution({ official: true, reviseItem: item });
    return;
  }
  const proposalAction = event.target.closest("[data-genealogy-proposal-action]");
  if (proposalAction) {
    const proposalId = proposalAction.dataset.genealogyId;
    const action = proposalAction.dataset.genealogyProposalAction;
    const eventId = createGenealogyId(refs.genealogyEvents);
    try {
      if (action === "submit") await genealogyStore.submitProposal({ proposalId, eventId, actorUid: auth.currentUser.uid });
      else if (action === "cancel") await genealogyStore.cancelDraft({ proposalId, eventId, actorUid: auth.currentUser.uid });
      else await genealogyStore.decideProposal({
        proposalId, decision: action === "accept" ? "accepted" : "rejected",
        reason: action === "accept" ? "Validée par un administrateur" : "Refusée après examen", eventId,
        notificationId: createGenealogyId(refs.genealogyNotifications), actorUid: auth.currentUser.uid
      });
      toast(action === "submit" ? "Proposition soumise." : action === "cancel" ? "Brouillon annulé." : "Décision enregistrée avec notification.");
    } catch (error) { toast(error.message || "Action impossible.", "error"); }
    return;
  }
  const readButton = event.target.closest("[data-genealogy-notification-read]");
  if (readButton) {
    try { await genealogyStore.markNotificationRead({ notificationId: readButton.dataset.genealogyNotificationRead, actorUid: auth.currentUser.uid }); }
    catch (error) { toast(error.message || "Notification inchangée.", "error"); }
    return;
  }
  const reviewButton = event.target.closest("[data-genealogy-review]");
  if (reviewButton) {
    if (!isAdminUser()) return toast("Le réexamen est réservé aux administrateurs.", "error");
    try {
      const adminSnapshot = await getDocs(query(refs.users, where("role", "==", "admin"), where("status", "==", "approved")));
      const admins = [...new Set([primaryAdminUid, ...adminSnapshot.docs.map(snapshot => snapshot.id)].filter(Boolean))];
      await genealogyStore.createReexaminationEvent({
        type: reviewButton.dataset.genealogyReview, objectId: reviewButton.dataset.genealogyId,
        eventId: createGenealogyId(refs.genealogyEvents), reason: "Réexamen demandé depuis le dossier Sources & preuves",
        administratorUids: admins, notificationIds: admins.map(() => createGenealogyId(refs.genealogyNotifications)), actorUid: auth.currentUser.uid
      });
      toast("Demande de réexamen et notifications enregistrées.");
    } catch (error) { toast(error.message || "Demande de réexamen impossible.", "error"); }
  }
}

async function optimizeFile(file) {
  const unchanged = { blob: file, mimeType: file.type || "application/octet-stream", originalSize: file.size, storedSize: file.size, compressed: false };
  if (!file.type.startsWith("image/") || /image\/(gif|svg\+xml)/.test(file.type)) return unchanged;
  try {
    $("documentProgress").textContent = "Optimisation de l’image en haute qualité…";
    const bitmap = await createImageBitmap(file);
    const maxDimension = 2800;
    let scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) {
      bitmap.close?.();
      return unchanged;
    }
    let best = null;
    const qualities = [.92, .88, .84, .80];
    for (let attempt = 0; attempt < qualities.length; attempt++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      const candidate = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", qualities[attempt]));
      if (candidate && (!best || candidate.size < best.size)) best = candidate;
      if (candidate && candidate.size <= Math.min(file.size * .72, 2.5 * 1024 * 1024)) break;
      if (Math.max(width, height) > 2100) scale *= .88;
    }
    bitmap.close?.();
    if (!best || best.size >= file.size * .92) return unchanged;
    return { blob: best, mimeType: "image/webp", originalSize: file.size, storedSize: best.size, compressed: true };
  } catch (error) {
    console.warn("Optimisation d’image ignorée", error);
    return unchanged;
  }
}

function chunkReference(documentId, version, index) {
  return doc(db, "documentChunks", documentChunkId(documentId, version, index));
}

async function writeFileChunks(documentId, version, fileBlob) {
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const parts = splitBytesIntoChunks(bytes, FILE_CHUNK_BYTES);
  const count = parts.length;
  let written = 0;
  try {
    for (let index = 0; index < count; index++) {
      const part = parts[index];
      await setDoc(chunkReference(documentId, version, index), {
        documentId,
        version,
        index,
        data: Bytes.fromUint8Array(part),
        encoding: "bytes"
      });
      written++;
      $("documentProgress").textContent = `Envoi du fichier… ${Math.round(written / count * 100)} %`;
    }
    return count;
  } catch (error) {
    await deleteFileChunks({ id: documentId, chunkVersion: version, chunkCount: written });
    throw error;
  }
}

async function deleteFileChunks(item) {
  if (!item?.id || !item?.chunkVersion || !item?.chunkCount) return;
  for (let index = 0; index < item.chunkCount; index++) {
    await deleteDoc(chunkReference(item.id, item.chunkVersion, index)).catch(console.warn);
  }
}

async function readChunkedFile(item) {
  const reads = [];
  for (let index = 0; index < item.chunkCount; index++) reads.push(getDoc(chunkReference(item.id, item.chunkVersion, index)));
  const snapshots = await Promise.all(reads);
  const parts = collectChunkParts(index => {
    const snapshot = snapshots[index];
    if (!snapshot.exists()) return null;
    const data = snapshot.data().data;
    return typeof data === "string" ? base64ToBytes(data) : data.toUint8Array();
  }, item.chunkCount);
  return new Blob([concatByteArrays(parts)], { type: item.mimeType || "application/octet-stream" });
}

async function zipLibrary() {
  const module = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  return module.default || module;
}

function backupMarkerValue(value) {
  if (value && typeof value.toMillis === "function") return { timestampMillis: value.toMillis() };
  if (Array.isArray(value)) return value.map(backupMarkerValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, backupMarkerValue(value[key])]));
  return value;
}

function backupRecordMarker(record) {
  return JSON.stringify(backupMarkerValue(record));
}

async function readBackupCollectionsFromServer() {
  const names = ["people", "families", "trees", "documents", "tasks", "sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"];
  const result = {};
  for (const name of names) {
    let target = refs[name];
    if (name === "genealogyProposals" && !isAdminUser()) target = query(target, where("authorUid", "==", auth.currentUser?.uid || ""));
    if (name === "genealogyNotifications") target = query(target, where("recipientUid", "==", auth.currentUser?.uid || ""));
    const snapshot = await getDocsFromServer(target);
    if (snapshot.metadata.fromCache) throw new Error(`La collection ${name} n’a pas pu être vérifiée auprès du serveur.`);
    result[name] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  }
  return result;
}

async function readLocallyAvailableDocumentBlob(item) {
  if (item.chunkVersion && item.chunkCount) return readChunkedFile(item);
  if (typeof item.fileData === "string" && item.fileData.startsWith("data:")) {
    const comma = item.fileData.indexOf(",");
    if (comma < 0) throw new Error(`Données intégrées mal formées pour ${item.id}`);
    const metadata = item.fileData.slice(0, comma);
    const content = item.fileData.slice(comma + 1);
    const bytes = /;base64/i.test(metadata)
      ? base64ToBytes(content)
      : new TextEncoder().encode(decodeURIComponent(content));
    return new Blob([bytes], { type: item.mimeType || metadata.match(/^data:([^;]+)/)?.[1] || "application/octet-stream" });
  }
  return null;
}

async function collectArchiveAssets(collections) {
  const assets = [];
  const assetBytes = new Map();
  for (const collectionName of ["documents", "sourceDocuments"]) {
    for (const record of collections[collectionName] || []) {
      for (const page of record.pages || []) for (const photograph of page.photographs || []) {
        for (const rendition of ["original", "preview"]) {
          const metadata = photograph[rendition];
          if (!metadata?.resourceRef) continue;
          assets.push({
            documentId: record.id, pageId: page.id, photographId: photograph.id,
            rendition, assetId: rendition === "preview" ? (metadata.id || metadata.resourceRef.split("/").at(-1)) : undefined,
            resourceRef: metadata.resourceRef, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256,
            fileName: metadata.originalFileName, mimeType: metadata.mimeType,
            provenance: metadata.provenance || "declared-photograph-resource"
          });
        }
      }
    }
  }
  for (const record of collections.documents || []) {
    const fileRef = record.chunkVersion ? `firestore-chunks:${record.id}:${record.chunkVersion}` : record.fileUrl || record.storagePath || record.externalUrl || (record.fileData ? `embedded:${record.id}` : "");
    if (!fileRef && !record.fileName) continue;
    let blob = null;
    try { blob = await readLocallyAvailableDocumentBlob(record); }
    catch (error) { console.warn(`Lecture du fichier de document impossible (${record.id})`, error); }
    const legacyOptimized = record.compressed === true || record.mimeType === "image/webp";
    const asset = {
      documentId: record.id, pageId: "legacy-page-unassigned", photographId: record.id,
      rendition: legacyOptimized ? "legacy-optimized" : "legacy-file",
      assetId: record.id, resourceRef: fileRef || `missing-file:${record.id}`,
      sizeBytes: blob?.size ?? record.storedSize ?? null, sha256: null,
      fileName: record.fileName || null, mimeType: blob?.type || record.mimeType || "application/octet-stream",
      provenance: blob ? "legacy-document-chunks-or-embedded-data" : "historical-file-reference-only"
    };
    assets.push(asset);
    if (blob) assetBytes.set(asset.resourceRef, new Uint8Array(await blob.arrayBuffer()));
  }
  return { assets, assetBytes };
}

function importedData(item) {
  return { ...importedDataFields(item), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}

async function exportCompleteBackup() {
  const button = $("exportBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = '… <span class="label">Préparation</span>';
  try {
    const JSZip = await zipLibrary();
    button.innerHTML = '… <span class="label">Lecture des collections</span>';
    const collections = await readBackupCollectionsFromServer();
    const before = Object.fromEntries(Object.entries(collections).map(([name, records]) => [name, records.map(backupRecordMarker).sort().join("\n")]));
    const assets = await collectArchiveAssets(collections);
    button.innerHTML = '… <span class="label">Vérification de cohérence</span>';
    const afterCollections = await readBackupCollectionsFromServer();
    const after = Object.fromEntries(Object.entries(afterCollections).map(([name, records]) => [name, records.map(backupRecordMarker).sort().join("\n")]));
    const markerCheck = compareBackupCaptureMarkers(before, after);
    const archive = await createBackupArchiveManifest({
      collections, assets: assets.assets, assetBytes: assets.assetBytes,
      collectionScopes: {
        genealogyProposals: isAdminUser() ? "all" : `authorUid=${auth.currentUser?.uid || ""}`,
        genealogyNotifications: `recipientUid=${auth.currentUser?.uid || ""}`
      },
      capture: {
        consistent: false,
        changeDetected: markerCheck.changeDetected,
        strategy: "double-read-client-no-global-firestore-transaction",
        before, after
      }
    });
    const integrity = await readBackupZip({
      file(path, value) {
        if (value !== undefined) return this;
        if (path === "family-tree.json") return { async: async () => JSON.stringify(archive.manifest) };
        const bytes = archive.entries.get(path);
        return bytes ? { async: async () => bytes } : null;
      }
    });
    if (!integrity.integrity.valid) console.warn("L’intégrité de l’archive préparée a relevé des éléments absents", integrity.integrity.errors);
    const zip = await generateBackupZip(archive, JSZip, { type: "blob" });
    button.innerHTML = '… <span class="label">Compression</span>';
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zip);
    link.download = `la-nostra-storia-archive-v${BACKUP_ARCHIVE_VERSION}-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast(`Archive v${BACKUP_ARCHIVE_VERSION} créée · ${formatBytes(zip.size)} · ${archive.manifest.completeness.status === "complete" ? "complète" : "partielle, avertissements inclus"}`);
  } catch (error) {
    console.error(error);
    toast(error.message || "Création de la sauvegarde impossible", "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = `${icon("download")}<span class="label">Sauvegarder</span>`;
  }
}

async function writeImportedRecords(collectionName, records = []) {
  for (const batchRecords of sliceIntoBatches(records, 400)) {
    const batch = writeBatch(db);
    for (const item of batchRecords) {
      if (!item?.id || item.id.includes("/")) throw new Error(`Identifiant invalide dans ${collectionName}`);
      batch.set(doc(db, collectionName, item.id), importedData(item));
    }
    await batch.commit();
  }
}

async function writeImportedTreeRecords(records = [], existingIdsAtPreflight = new Set()) {
  const uid = auth.currentUser?.uid || "";
  if (!uid) throw new Error("Votre session a expiré ; reconnectez-vous avant la restauration.");
  let completed = 0;
  try {
    for (const item of records) {
      if (!item?.id || item.id.includes("/")) throw new Error("Identifiant d’arbre invalide dans la sauvegarde");
      const treeRef = doc(db, "trees", item.id);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(treeRef);
        const expectedToExist = existingIdsAtPreflight.has(item.id);
        if (snapshot.exists() !== expectedToExist) {
          throw new Error(`L’arbre « ${item.name} » a changé depuis la vérification. Actualisez puis recommencez la restauration.`);
        }
        let lifecycleState = TREE_LIFECYCLE_ACTIVE;
        if (snapshot.exists()) {
          const current = snapshot.data();
          lifecycleState = getTreeLifecycleState(current);
          if (lifecycleState !== TREE_LIFECYCLE_ACTIVE) {
            throw new Error(`L’arbre « ${item.name} » est verrouillé ou son état est invalide. Il n’a pas été restauré.`);
          }
          // Merge ne peut ni effacer un état historique absent, ni réécrire un
          // état transient fourni par une archive antérieure.
          const restored = importedTreeData(item, { lifecycleState });
          if (!Object.prototype.hasOwnProperty.call(current, "lifecycleState")) delete restored.lifecycleState;
          transaction.set(treeRef, {
            ...restored,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: uid
          }, { merge: true });
        } else {
          transaction.set(treeRef, {
            ...importedTreeData(item, { lifecycleState: TREE_LIFECYCLE_ACTIVE }),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: uid
          });
        }
      });
      completed++;
    }
  } catch (error) {
    if (completed) {
      throw new Error(`Restauration des arbres interrompue après ${completed}/${records.length} métadonnée(s) traitée(s). Les arbres déjà écrits sont conservés ; les personnes n’ont pas encore été restaurées. ${error.message || ""}`);
    }
    throw error;
  }
}

function showV5RestorePreview(archive) {
  const current = {
    people: people.map(item => item.id), families: families.map(item => item.id), trees: treeMetadata.map(item => item.id),
    documents: documents.map(item => item.id), tasks: tasks.map(item => item.id)
  };
  for (const [collectionName, records] of Object.entries(genealogyRecords)) current[collectionName] = records.map(item => item.id);
  const renderPlan = policy => {
    const plan = prepareBackupRestorePlan(archive.manifest, {
      existing: current, conflictPolicy: policy, activeUserIds: [auth.currentUser?.uid].filter(Boolean), allowIncomplete: true, preflight: true
    });
    const integrity = archive.integrity;
    const statusLabel = archive.manifest.completeness.status === "complete" && integrity.valid ? "Complète selon son manifeste" : "Partielle / à examiner";
    const errors = integrity.errors.map(item => `<li><strong>${esc(item.code)}</strong> · ${esc(item.message)}</li>`).join("");
    const warnings = [...integrity.warnings, ...plan.warnings].map(item => `<li><strong>${esc(item.code)}</strong> · ${esc(item.message)}</li>`).join("");
    const conflicts = plan.conflicts.map(item => `<li>${esc(item.collection)} / ${esc(item.id)} — ${esc(item.policy)}</li>`).join("");
    const operations = plan.operations.filter(item => item.action !== "skip").slice(0, 80).map(item => `<li>${esc(item.action)} · ${esc(item.collection)} / ${esc(item.id)}</li>`).join("");
    $("restorePreviewContent").innerHTML = `<p><strong>Archive v${esc(archive.manifest.version)} — ${esc(statusLabel)}</strong></p><p>${Object.entries(archive.manifest.inventory || {}).map(([name, inventory]) => `${esc(name)} : ${Number(inventory.recordCount) || 0}`).join(" · ")}</p><label>Politique de conflit<select class="field" id="restorePreviewPolicy"><option value="abort">Bloquer en cas de conflit</option><option value="keep-existing">Conserver les éléments présents</option><option value="replace-existing">Prévoir le remplacement par identifiant</option></select></label><p><strong>Prévisualisation uniquement :</strong> aucune écriture ne sera exécutée depuis cette interface. L’intégration serveur requise pour les données officielles n’est pas disponible.</p>${plan.historicalAuthorUids.length ? `<p>UID d’auteurs historiques conservés sans compte ni rôle : ${plan.historicalAuthorUids.map(esc).join(", ")}</p>` : ""}${errors ? `<h4>Erreurs d’intégrité</h4><ul>${errors}</ul>` : ""}${warnings ? `<h4>Avertissements</h4><ul>${warnings}</ul>` : ""}${conflicts ? `<h4>Conflits détectés</h4><ul>${conflicts}</ul>` : ""}${operations ? `<h4>Opérations envisagées (${plan.operations.length})</h4><ul>${operations}${plan.operations.length > 80 ? "<li>…</li>" : ""}</ul>` : ""}<p role="status">Plan ${plan.blocked ? "bloqué par des conflits" : "préparé"} · écritures réalisées : non.</p>`;
    const select = $("restorePreviewPolicy");
    select.value = policy;
    select.onchange = () => renderPlan(select.value);
  };
  renderPlan("abort");
  $("restorePreviewDialog").showModal();
}

async function restoreCompleteBackup(file) {
  const button = $("importBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = '… <span class="label">Lecture</span>';
  try {
    const JSZip = await zipLibrary();
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file("family-tree.json");
    if (!manifestEntry) throw new Error("Cette archive ne contient pas de sauvegarde Family Tree");
    const manifestText = await manifestEntry.async("string");
    const archiveVersion = JSON.parse(manifestText).version;
    if (archiveVersion === BACKUP_ARCHIVE_VERSION) {
      const archive = await readBackupZip(zip);
      showV5RestorePreview(archive);
      if (!archive.integrity.valid) toast("Archive v5 ouverte avec des erreurs ou ressources manquantes ; consultez la prévisualisation.", "error");
      else toast("Prévisualisation de restauration v5 prête ; aucune donnée n’a été modifiée.", "info");
      return;
    }
    const manifest = parseBackupManifestText(manifestText);
    validateFamilyDataset(manifest.people, manifest.families);
    validateTreeDataset(manifest.people, manifest.trees || []);
    const liveTreesSnapshot = await getDocsFromServer(refs.trees);
    if (liveTreesSnapshot.metadata.fromCache) throw new Error("Impossible de vérifier les arbres auprès du serveur. La restauration n’a pas commencé.");
    const liveTreesById = new Map(liveTreesSnapshot.docs.map(snapshot => [snapshot.id, snapshot.data()]));
    const lockedBackupTrees = (manifest.trees || []).filter(item => liveTreesById.get(item.id)?.lifecycleState === TREE_LIFECYCLE_DELETING);
    if (lockedBackupTrees.length) throw new Error(`Restauration suspendue : ${lockedBackupTrees.map(tree => tree.name).join(", ")} est en cours de suppression. Récupérez cet arbre avant de restaurer.`);
    const invalidLifecycleTrees = (manifest.trees || []).filter(item => {
      const current = liveTreesById.get(item.id);
      return current && getTreeLifecycleState(current) !== TREE_LIFECYCLE_ACTIVE;
    });
    if (invalidLifecycleTrees.length) throw new Error(`Restauration suspendue : état de cycle de vie invalide pour ${invalidLifecycleTrees.map(tree => tree.name).join(", ")}. Aucun arbre n’a été modifié.`);
    const existingTreeIdsAtPreflight = new Set(liveTreesById.keys());
    const treesToRecreate = (manifest.trees || []).filter(item => !existingTreeIdsAtPreflight.has(item.id));
    const recreateWarning = treesToRecreate.length
      ? `\n\nArbres absents qui seront recréés :\n${treesToRecreate.map(tree => `• ${tree.name}`).join("\n")}`
      : "";
    if (!confirm(`Fusionner cette sauvegarde avec les données actuelles ?\n\n${manifest.people.length} personnes · ${manifest.documents?.length || 0} documents · ${manifest.tasks?.length || 0} tâches${recreateWarning}\n\nLes éléments de même identifiant seront mis à jour. Les autres données actuelles seront conservées.`)) return;

    await writeImportedTreeRecords(manifest.trees || [], existingTreeIdsAtPreflight);
    button.innerHTML = '… <span class="label">Personnes</span>';
    await writeImportedRecords("people", manifest.people);
    await writeImportedRecords("families", manifest.families);
    await writeImportedRecords("tasks", manifest.tasks || []);

    for (let index = 0; index < (manifest.documents || []).length; index++) {
      const item = manifest.documents[index];
      if (!item?.id || item.id.includes("/")) throw new Error("Identifiant de document invalide");
      button.innerHTML = `… <span class="label">Document ${index + 1}/${manifest.documents.length}</span>`;
      const data = importedData(item);
      const backupEntry = item.backupFile ? zip.file(item.backupFile) : null;
      const existing = documents.find(value => value.id === item.id);
      if (backupEntry) {
        const blob = await backupEntry.async("blob");
        const version = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const count = await writeFileChunks(item.id, version, blob);
        Object.assign(data, { storageMode: "firestore-chunks", chunkVersion: version, chunkCount: count, storedSize: blob.size });
      }
      await setDoc(doc(db, "documents", item.id), data);
      if (backupEntry && existing?.chunkVersion) await deleteFileChunks(existing);
    }
    toast("Sauvegarde restaurée avec succès");
  } catch (error) {
    console.error(error);
    toast(error.message || "Restauration impossible", "error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = `${icon("upload")}<span class="label">Restaurer</span>`;
    $("importFile").value = "";
  }
}

async function openStoredDocument(item) {
  if (!item) return;
  $("viewerTitle").textContent = documentDisplayLabel(item);
  $("viewerSubtitle").textContent = item.fileName || "Aperçu dans Family Tree";
  $("viewerImage").hidden = true;
  $("viewerFrame").hidden = true;
  $("viewerMessage").hidden = false;
  $("viewerMessage").textContent = "Chargement du document…";
  $("viewerExternalBtn").hidden = true;
  $("viewerExternalBtn").removeAttribute("href");
  $("documentViewerDialog").showModal();
  try {
    let source = item.fileUrl || item.externalUrl || "";
    let mimeType = item.mimeType || "";
    if (item.chunkCount && item.chunkVersion) {
      const blob = await readChunkedFile(item);
      activeViewerUrl = URL.createObjectURL(blob);
      source = activeViewerUrl;
      mimeType = blob.type;
    } else if (item.fileData) {
      const blob = await (await fetch(item.fileData)).blob();
      activeViewerUrl = URL.createObjectURL(blob);
      source = activeViewerUrl;
      mimeType = blob.type;
    }
    if (!source) throw new Error("Aucun fichier n’est associé");
    $("viewerExternalBtn").href = source;
    $("viewerExternalBtn").hidden = false;
    $("viewerMessage").hidden = true;
    if (mimeType.startsWith("image/")) {
      $("viewerImage").src = source;
      $("viewerImage").hidden = false;
    } else {
      $("viewerFrame").src = source;
      $("viewerFrame").hidden = false;
    }
  } catch (error) {
    console.error(error);
    $("viewerMessage").textContent = error.message || "Impossible d’ouvrir ce fichier";
    toast("Impossible d’ouvrir ce fichier", "error");
  }
}

async function saveDocument(event) {
  event.preventDefault();
  const id = $("documentId").value;
  const existing = documents.find(item => item.id === id);
  const file = $("documentFile").files[0];
  const externalUrl = $("documentUrl").value.trim();
  const removeExistingFile = !!(existing && documentFileMarkedForRemoval && !file && canSafelyRemoveStoredDocumentFile(existing));
  if (!existing && !file && !externalUrl) return toast("Choisissez un fichier ou indiquez un lien", "error");
  if (file?.size > MAX_FILE_BYTES) return toast("Le fichier dépasse 20 Mo", "error");
  if (file && file.type !== "application/pdf" && !file.type.startsWith("image/")) return toast("Choisissez un PDF ou une image", "error");
  setButtonPending($("saveDocumentBtn"), true);
  let newChunkVersion = "";
  let newChunkCount = 0;
  let optimizationSummary = "";
  const target = id ? doc(db, "documents", id) : doc(refs.documents);
  try {
    const data = {
      title: $("documentTitle").value.trim(),
      type: $("documentType").value,
      date: $("documentDate").value,
      notes: $("documentNotes").value.trim(),
      externalUrl,
      personIds: documentPeoplePicker.getSelected(),
      updatedAt: serverTimestamp()
    };
    applyLocationField(data, "documentPlace", existing, !!id);
    if (file) {
      const optimized = await optimizeFile(file);
      optimizationSummary = optimized.compressed ? `${formatBytes(optimized.originalSize)} → ${formatBytes(optimized.storedSize)}` : "qualité originale conservée";
      newChunkVersion = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      $("documentProgress").textContent = optimized.compressed ? `Image optimisée : ${optimizationSummary}` : "Préparation du fichier…";
      newChunkCount = await writeFileChunks(target.id, newChunkVersion, optimized.blob);
      data.fileName = file.name;
      data.fileSize = optimized.originalSize;
      data.storedSize = optimized.storedSize;
      data.mimeType = optimized.mimeType;
      data.compressed = optimized.compressed;
      data.storageMode = "firestore-chunks";
      data.chunkVersion = newChunkVersion;
      data.chunkCount = newChunkCount;
      if (id) {
        data.fileData = deleteField();
        data.fileUrl = deleteField();
        data.storagePath = deleteField();
      }
    } else if (removeExistingFile) {
      for (const field of DOCUMENT_FILE_METADATA_FIELDS) data[field] = deleteField();
    }
    if (id) await updateDoc(target, data);
    else await setDoc(target, { ...data, createdAt: serverTimestamp() });
    if ((file || removeExistingFile) && existing?.chunkVersion) await deleteFileChunks(existing);
    close("documentDialog");
    toast(`${id ? "Document mis à jour" : "Document ajouté"}${optimizationSummary ? ` · ${optimizationSummary}` : ""}`);
  } catch (error) {
    console.error(error);
    if (newChunkVersion) await deleteFileChunks({ id: target.id, chunkVersion: newChunkVersion, chunkCount: newChunkCount });
    const message = error?.code === "permission-denied"
      ? "Envoi refusé : publiez le nouveau fichier firestore.rules dans Firebase."
      : error?.message || "Enregistrement du document impossible";
    $("documentProgress").textContent = message;
    toast(message, "error");
  } finally {
    setButtonPending($("saveDocumentBtn"), false);
  }
}

async function removeDocument(id = $("documentId").value) {
  const item = documents.find(documentItem => documentItem.id === id);
  if (!item || !confirm("Supprimer définitivement ce document ? Le fichier et ses associations aux personnes seront supprimés.")) return false;
  await deleteFileChunks(item);
  await deleteDoc(doc(db, "documents", id));
  if ($("documentDialog").open && $("documentId").value === id) close("documentDialog");
  toast("Document supprimé");
  return true;
}

const statusLabels = { todo: "À faire", progress: "En cours", done: "Terminée" };
const priorityLabels = { high: "Haute", medium: "Moyenne", low: "Basse" };

let taskUsersCache = null;

async function refreshTaskUsersCache() {
  const users = await loadTaskUsers();
  taskUsersCache = users;
  populateTaskAssigneeFilter();
  if ($("tasksView") && !$("tasksView").hidden) renderTasks();
}

function populateTaskAssigneeFilter() {
  const select = $("taskAssigneeFilter");
  if (!select || select.options.length > 1) return;
  select.innerHTML = ['<option value="">Tous les responsables</option>'].concat((taskUsersCache || []).map(u => '<option value="' + esc((u.email || "").toLowerCase()) + '">' + esc(u.displayName || u.email || "Sans nom") + '</option>')).join("");
  select.disabled = !(taskUsersCache || []).length;
}

function taskUsersByIdOrEmail() { return taskUsersCache || []; }

function taskDisplayNameOf(assignee) {
  const value = String(assignee || "").toLowerCase();
  if (!value) return "Non attribuée";
  const user = taskUsersByIdOrEmail().find(u => (u.email || "").toLowerCase() === value);
  return user?.displayName || user?.email || assignee;
}

function taskAvatarOf(assignee) {
  const value = String(assignee || "").toLowerCase();
  const user = taskUsersByIdOrEmail().find(u => (u.email || "").toLowerCase() === value);
  return safeProfilePhoto(user?.photo) ? user.photo : "";
}

function todayLabel() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function taskIsLate(item) {
  return !!(item.dueDate && item.dueDate < todayLabel() && item.status !== "done");
}

function taskDueMatches(item, filter) {
  const due = item.dueDate || "";
  const today = todayLabel();
  const done = item.status === "done";
  return filter === "late" ? (due && due < today && !done)
    : filter === "today" ? (due === today && !done)
    : filter === "upcoming" ? (due > today && !done)
    : filter === "none" ? !due
    : true;
}

function syncTaskRowKeyboardAccess() {
  document.querySelectorAll("#tasksList .task-row[data-task-row]").forEach(row => {
    const title = row.querySelector(".task-main h3")?.textContent || "cette action";
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `Ouvrir l’action ${title}. Appuyez sur Entrée ou Espace.`);
    row.setAttribute("aria-keyshortcuts", "Enter Space");
  });
}

function renderTasks() {
  const query = searchable($("taskSearch").value);
  const status = $("taskStatusFilter").value;
  const assigneeFilter = $("taskAssigneeFilter").value;
  const dueFilter = $("taskDueFilter").value;
  const mine = $("myTasksFilter").getAttribute("aria-pressed") === "true";
  const email = auth.currentUser?.email?.toLowerCase() || "";
  const filtered = tasks.filter(item =>
    (!status || item.status === status) &&
    (!assigneeFilter || (item.assignee || "").toLowerCase() === assigneeFilter.toLowerCase()) &&
    (!mine || (item.assignee || "").toLowerCase() === email) &&
    taskDueMatches(item, dueFilter) &&
    (!query || searchable(`${item.title} ${item.description || ""} ${item.comments || ""} ${item.assignee || ""}`).includes(query))
  ).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  $("tasksList").innerHTML = filtered.length ? filtered.map(item => {
    const late = taskIsLate(item);
    const done = item.status === "done";
    const statusClass = ["todo", "progress", "done"].includes(item.status) ? item.status : "todo";
    const avatar = taskAvatarOf(item.assignee);
    const initials = esc((taskDisplayNameOf(item.assignee) || "?").split(/[\s@.]+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?");
    const menu = tileContextMenuMarkup("task", item.id, item.title || "cette action", [{ key: "delete", label: "Supprimer", icon: "trash", danger: true }]);
    return `<article class="task-row${late ? " is-late" : ""}${done ? " is-done" : ""}" data-task-row="${item.id}" data-primary-tile><div class="task-main"><h3>${esc(item.title)}</h3>${(item.description || item.comments) ? `<span class="task-note">${esc(item.description || item.comments)}</span>` : ""}</div><div class="task-assignee">${avatar ? `<img class="task-avatar" src="${avatar}" alt="" loading="lazy">` : `<span class="task-avatar" aria-hidden="true">${initials}</span>`}<span class="task-assignee-name">${esc(taskDisplayNameOf(item.assignee))}</span></div><div class="task-due">${item.dueDate ? esc(new Date(item.dueDate + "T12:00:00").toLocaleDateString("fr-FR")) : "Sans date"}${late ? '<span class="task-late-flag">En retard</span>' : ""}</div><span class="task-priority badge priority-${item.priority || "medium"}">${priorityLabels[item.priority] || "Moyenne"}</span><span class="task-status task-status-${statusClass}">${statusLabels[item.status] || "À faire"}</span><div class="task-actions">${menu}</div></article>`;
  }).join("") : (tasks.length
    ? emptyState({ iconName: "tasks", title: "Aucune action trouvée", description: "Modifiez la recherche ou les filtres pour afficher d’autres actions." })
    : emptyState({ iconName: "tasks", title: "Aucune action", description: "Ajoutez une action lorsque vous avez une recherche ou une démarche à suivre.", action: `<button class="btn primary" type="button" data-empty-add-task>${icon("plus")}<span>Ajouter une action</span></button>` }));
  syncTaskRowKeyboardAccess();
  setContentMode("tasks", "list", false);
}

function openTaskById(id) {
  const item = tasks.find(value => value.id === id);
  if (item) openTask(item);
}

async function loadTaskUsers() {
  try {
    const snapshot = await getDocs(query(refs.users, where("status", "==", "approved")));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status === "approved");
  } catch (error) {
    console.warn("Chargement des utilisateurs impossible (règles Firestore) :", error);
    return [];
  }
}

async function openTask(item = null) {
  taskActionMenu.close();
  $("taskMenuBtn").hidden = !item;
  $("taskForm").reset();
  $("taskId").value = item?.id || "";
  $("taskDialogTitle").textContent = item ? "Modifier l’action" : "Ajouter une tâche";
  $("taskTitle").value = item?.title || "";
  $("taskStatus").value = item?.status || "todo";
  $("taskPriority").value = item?.priority || "medium";
  $("taskDueDate").value = item?.dueDate || "";
  const users = await loadTaskUsers();
  const select = $("taskAssignee");
  if (users.length) {
    select.innerHTML = users.map(u => '<option value="' + esc(u.email || "") + '">' + esc(u.displayName || u.email || "Sans nom") + '</option>').join("");
    select.disabled = false;
  } else {
    const email = auth.currentUser?.email || "";
    select.innerHTML = '<option value="' + esc(email) + '">' + esc(email) + '</option>';
    select.disabled = true;
  }
  const currentEmail = auth.currentUser?.email || "";
  const storedAssignee = item?.assignee || currentEmail;
  if ([...select.options].some(opt => opt.value === storedAssignee)) {
    select.value = storedAssignee;
  } else {
    select.innerHTML = '<option value="' + esc(storedAssignee) + '">' + esc(storedAssignee) + '</option>';
    select.value = storedAssignee;
  }
  $("taskDescription").value = item?.description || "";
  $("taskComments").value = item?.comments || "";
  $("deleteTaskBtn").hidden = !item;
  $("taskDialog").showModal();
}

async function saveTask(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  const id = $("taskId").value;
  const data = Object.fromEntries(taskFields.map(key => [key, $("task" + key[0].toUpperCase() + key.slice(1)).value.trim()]));
  data.updatedAt = serverTimestamp();
  await withButtonPending(submitButton, () => runSafely(async () => {
    if (id) await updateDoc(doc(db, "tasks", id), data);
    else await addDoc(refs.tasks, { ...data, createdAt: serverTimestamp() });
    close("taskDialog");
    toast(id ? "Action mise à jour" : "Action ajoutée");
  }, "Enregistrement de l’action impossible"));
}

async function removeTaskById(id, closeDialog = false) {
  if (!id || !confirm("Supprimer définitivement cette action ? Cette action ne peut pas être annulée.")) return false;
  await deleteDoc(doc(db, "tasks", id));
  if (closeDialog && $("taskDialog").open && $("taskId").value === id) close("taskDialog");
  toast("Action supprimée");
  return true;
}

async function removeTask() { return removeTaskById($("taskId").value, true); }
async function removeTaskFromList(id) { return removeTaskById(id, false); }

/* ============================================================
   Démarches : dossiers de suivi + chronologie des actions.
   Collection Firestore : procedures ; actions dans la
   sous-collection procedures/{dossierId}/actions.
   ============================================================ */

const dossierFields = ["title", "type", "status", "objective", "organization", "service", "contactName", "email", "phone", "place", "nextAction", "nextActionDate", "notes", "result"];

function dossierEditDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function shortUpdatedAt(item) {
  if (!item?.updatedAt?.toDate) return "Mise à jour : —";
  return "Mise à jour : " + item.updatedAt.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/* Sélecteur partagé Documents/Démarches : recherche uniquement en mémoire,
   insensible aux accents, avec 8 suggestions au maximum. */
const PERSON_PICKER_MAX_RESULTS = 8;

function peopleSortedList() {
  return [...treePeople()].sort(comparePeopleBySurname);
}

function personYears(item) {
  const birth = genealogyDateYears(item.birthDateInfo, item.birthDate);
  const death = genealogyDateYears(item.deathDateInfo, item.deathDate);
  return [birth[0], death[0]].filter(part => part || part === 0);
}

function personSuggestionLabel(item) {
  const name = nameOf(item.id);
  const years = personYears(item);
  const dates = years.length ? years.join(" — ") : null;
  return [`${name}${dates ? ` · ${dates}` : ""}`, item.branch ? `Branche ${item.branch}` : ""].filter(Boolean);
}

function personPickerMatches(query = "", selectedIds, source) {
  const text = searchable(query);
  if (text.length < DOSSIER_MIN_QUERY_LENGTH) return [];
  return source()
    .filter(item => !selectedIds.has(item.id))
    .filter(item => searchable(`${item.firstName} ${item.middleName || ""} ${item.lastName} ${item.marriedName || ""} ${item.branch || ""}`).includes(text))
    .slice(0, PERSON_PICKER_MAX_RESULTS);
}

function createAppPersonPicker(kind) {
  const prefix = kind === "document" ? "document" : "dossier";
  const source = kind === "document"
    ? () => people.slice().sort(comparePeopleBySurname)
    : peopleSortedList;
  return createPersonMultiSelect({
    kind,
    root: $(`${prefix}PeopleList`),
    input: $(`${prefix}PeopleInput`),
    chips: $(`${prefix}PeopleChips`),
    results: $(`${prefix}PeopleResults`),
    dialog: $(`${prefix}Dialog`),
    minQueryLength: DOSSIER_MIN_QUERY_LENGTH,
    findMatches: (query, selectedIds) => personPickerMatches(query, selectedIds, source),
    suggestionFor: item => {
      const [label, context] = personSuggestionLabel(item);
      return { label, context };
    },
    nameFor: nameOf,
    escapeHtml: esc
  });
}

const documentPeoplePicker = createAppPersonPicker("document");
const dossierPeoplePicker = createAppPersonPicker("dossier");

function procedureCard(item) {
  const closed = isProcedureClosed(item.status);
  const persons = (item.personIds || []).map(id => nameOf(id)).filter(name => name !== "Personne supprimée");
  const contextParts = [];
  if (persons.length) contextParts.push(`Personnes : ${persons.join(", ")}`);
  if (item.nextAction) contextParts.push(`Prochaine action : ${item.nextAction}${item.nextActionDate ? ` (${formatShortDate(item.nextActionDate)})` : ""}`);
  const menu = tileContextMenuMarkup("procedure", item.id, item.title, [{ key: "edit", label: "Modifier", icon: "edit" }]);
  return `<article class="procedure-item" tabindex="0" role="group" data-primary-tile data-procedure-card="${item.id}" aria-label="Consulter la démarche ${esc(item.title)}" aria-keyshortcuts="Enter Space"><span class="procedure-updated">${shortUpdatedAt(item)}</span><div><h3 class="procedure-title">${esc(item.title)}</h3><span class="procedure-tags"><span class="procedure-tag">${esc(procedureTypeLabel(item.type))}</span></span></div><span class="procedure-organization">${esc([item.organization, item.service || "", item.contactName || ""].filter(Boolean).join(" · "))}</span><span class="procedure-context">${esc(contextParts.join(" — "))}</span><div class="procedure-tags procedure-item-status"><span class="procedure-tag procedure-status${closed ? " is-closed" : ""}">${esc(procedureStatusLabel(item.status))}</span>${menu}</div></article>`;
}

// Date AAAA-MM-JJ affichée en format français court.
function formatShortDate(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString("fr-FR") : "";
}

function renderProcedures() {
  const query = searchable($("dossierSearch").value);
  const filtered = filterAndSortProcedures(procedures, {
    type: $("dossierTypeFilter").value,
    status: $("dossierStatusFilter").value
  }, query, nameOf);
  $("proceduresList").innerHTML = filtered.length
    ? `<div class="procedure-head-row" aria-hidden="true"><span>Mise à jour</span><span>Dossier</span><span>Organisme</span><span>Contexte ou liens</span><span>Statut</span></div>${filtered.map(procedureCard).join("")}`
    : (procedures.length
      ? emptyState({ iconName: "procedures", title: "Aucune démarche trouvée", description: "Modifiez la recherche ou les filtres pour afficher d’autres dossiers." })
      : emptyState({ iconName: "procedures", title: "Aucune démarche", description: "Créez un dossier pour suivre une recherche, une correspondance ou un rendez-vous.", action: `<button class="btn primary" type="button" data-empty-add-dossier>${icon("plus")}<span>Nouvelle démarche</span></button>` }));
}

function openDossierForm(item = null) {
  $("dossierForm").reset();
  $("dossierId").value = item?.id || "";
  $("dossierDialogTitle").textContent = item ? "Modifier la démarche" : "Nouvelle démarche";
  $("dossierTitle").value = item?.title || "";
  $("dossierType").value = item?.type || "research";
  $("dossierStatus").value = item?.status || "prepare";
  $("dossierObjective").value = item?.objective || "";
  $("dossierOrganization").value = item?.organization || "";
  $("dossierService").value = item?.service || "";
  $("dossierContactName").value = item?.contactName || "";
  $("dossierEmail").value = item?.email || "";
  $("dossierPhone").value = item?.phone || "";
  $("dossierPlace").value = item?.place || "";
  dossierPeoplePicker.setSelected(item?.personIds || []);
  $("dossierNextAction").value = item?.nextAction || "";
  $("dossierNextActionDate").value = dossierEditDate(item?.nextActionDate);
  $("dossierNotes").value = item?.notes || "";
  $("dossierResult").value = item?.result || "";
  // Le point d’accès destructif reste masqué en attendant une suppression sûre
  // de la sous-collection d’actions des démarches.
  $("deleteDossierBtn").hidden = true;
  $("dossierDialog").showModal();
}

async function saveDossier(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  const id = $("dossierId").value;
  const data = Object.fromEntries(dossierFields.map(key => [key, $("dossier" + key[0].toUpperCase() + key.slice(1)).value.trim()]));
  data.personIds = dossierPeoplePicker.getSelected();
  data.updatedAt = serverTimestamp();
  data.updatedBy = auth.currentUser?.uid || "";
  data.updatedByName = currentUserProfile?.displayName || "";
  await withButtonPending(submitButton, () => runSafely(async () => {
    if (id) await updateDoc(doc(db, "procedures", id), data);
    else await addDoc(refs.procedures, { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "", createdByName: currentUserProfile?.displayName || "" });
    close("dossierDialog");
    toast(id ? "Démarche mise à jour" : "Démarche ajoutée");
  }, id ? "Mise à jour de la démarche impossible" : "Création de la démarche impossible"));
}

async function removeDossier() {
  const id = $("dossierId").value;
  if (!id || !confirm("Supprimer définitivement cette démarche ? Sa chronologie d’actions sera également supprimée. Cette action ne peut pas être annulée.")) return;
  await runSafely(async () => {
    await deleteDoc(doc(db, "procedures", id));
    close("dossierDialog");
    toast("Démarche supprimée");
  }, "Suppression de la démarche impossible");
}

function openUnknownDossier(id) {
  toast("Démarche introuvable", "error");
}

function openProcedureDetail(id) {
  const item = procedures.find(value => value.id === id);
  if (!item) return openUnknownDossier(id);
  activeDossierId = id;
  renderProcedureDetail(item);
  procedureActionUnsub?.();
  procedureActionUnsub = onSnapshot(collection(db, "procedures", id, "actions"), snapshot => {
    procedureActionsCache = sortProcedureActions(snapshot.docs.map(docItem => {
      const data = docItem.data();
      return { id: docItem.id, ...data, createdAtSort: data.createdAt?.toMillis?.() || 0, updatedAtSort: data.updatedAt?.toMillis?.() || 0 };
    }));
    renderProcedureTimeline();
  }, dataError);
  $("procedureDetailDialog").showModal();
}

const EMAIL_ACTION_TYPES = new Set(["email-sent", "email-received"]);

function isEmailAction(type = "") {
  return EMAIL_ACTION_TYPES.has(type);
}

/* Texte sûr pour le contenu d'un email : esc() + white-space: pre-line
   conservent les retours à la ligne sans jamais injecter de HTML brut. */
function safeMultiline(value = "") {
  return esc(value);
}

function toggleEmailFullBlock(id) {
  const block = document.querySelector(`[data-email-full-block="${id}"]`);
  if (!block) return;
  block.hidden = !block.hidden;
  const toggle = document.querySelector(`[data-toggle-email-action="${id}"]`);
  toggle.querySelector("span").textContent = block.hidden ? "Afficher le message complet" : "Masquer le message";
  toggle.setAttribute("aria-expanded", String(!block.hidden));
}

/* Carte d'événement de la chronologie. Hiérarchie :
   date·heure (métadonnée) → type → objet (email) ou titre → correspondant
   (À pour un email envoyé, De pour un email reçu) → notes/résumé → auteur
   (discret) → contenu complet dépliable → Modifier/Supprimer en bas.
   La direction n'est PAS affichée (redondant avec le type) mais reste
   stockée ; aucune ligne vide n'est générée pour un champ absent. */
function actionStamp(date, time) {
  const dateLabel = date ? formatShortDate(date) : "Sans date";
  return time ? `${dateLabel} · ${esc(time)}` : dateLabel;
}

function actionCorrespondent(action) {
  const address = action.type === "email-sent"
    ? (action.emailTo ? `À : ${action.emailTo}` : "")
    : (action.type === "email-received" ? (action.emailFrom ? `De : ${action.emailFrom}` : "") : "");
  return address ? `<span class="procedure-action-correspondent">${esc(address)}</span>` : "";
}

function procedureActionItem(action) {
  const outils = `<div class="procedure-action-tools"><button class="btn small" type="button" data-edit-procedure-action="${action.id}" aria-label="Modifier l’action"><svg class="ui-icon" aria-hidden="true"><use href="#icon-edit"></use></svg><span>Modifier</span></button><button class="btn small danger" type="button" data-remove-procedure-action="${action.id}" aria-label="Supprimer l’action"><svg class="ui-icon" aria-hidden="true"><use href="#icon-trash"></use></svg><span>Supprimer</span></button></div>`;
  const principal = isEmailAction(action.type) && action.emailSubject
    ? `<h5 class="procedure-action-title">${esc(action.emailSubject)}</h5>`
    : (action.title ? `<h5 class="procedure-action-title">${esc(action.title)}</h5>` : "");
  const emailToggle = isEmailAction(action.type) && action.emailFull
    ? `<button class="btn small procedure-action-email-toggle" type="button" data-toggle-email-action="${action.id}" aria-expanded="false"><svg class="ui-icon" aria-hidden="true"><use href="#icon-reorder"></use></svg><span>Afficher le message complet</span></button><div class="procedure-action-email-full-block" data-email-full-block="${action.id}" hidden><p class="procedure-action-email-full">${safeMultiline(action.emailFull)}</p></div>`
    : "";
  return `<article class="procedure-action-item${isEmailAction(action.type) ? " is-email" : ""}"><span class="procedure-action-stamp">${actionStamp(action.date, isEmailAction(action.type) ? action.time : "")}</span><span class="procedure-action-type">${esc(procedureActionTypeLabel(action.type))}</span>${principal}${actionCorrespondent(action)}${action.text ? `<p class="procedure-action-text">${safeMultiline(action.text)}</p>` : ""}${action.author ? `<span class="procedure-action-author">Ajouté par ${esc(action.author)}</span>` : ""}${emailToggle}${outils}</article>`;
}

function renderProcedureTimeline() {
  $("procedureTimeline").innerHTML = procedureActionsCache.length
    ? procedureActionsCache.map(procedureActionItem).join("")
    : emptyState({ iconName: "procedures", title: "Aucune action enregistrée", description: "Les emails, appels, rendez-vous et notes de ce dossier apparaîtront ici." });
}

function procedureDetailBlock(title, content, { grid = false } = {}) {
  if (!content) return "";
  return `<section class="procedure-detail-block${grid ? " procedure-detail-grid" : ""}"><h4>${esc(title)}</h4>${content}</section>`;
}

function renderProcedureDetail(item) {
  $("procedureDetailTitle").textContent = item.title || "Démarche";
  // Premier niveau du header : type + statut en badges ; deuxième niveau
  // strictement secondaire : date de dernière modification (et auteur).
  $("procedureDetailBadges").innerHTML = `<span class="procedure-tag">${esc(procedureTypeLabel(item.type))}</span><span class="procedure-tag procedure-status${isProcedureClosed(item.status) ? " is-closed" : ""}">${esc(procedureStatusLabel(item.status))}</span>`;
  $("procedureDetailMeta").innerHTML = formatPersonModInfo(item) ? `Dernière modification : ${formatPersonModInfo(item)}` : "";
  const contactGrid = Object.entries({
    Organisme: item.organization,
    Service: item["service"],
    Contact: item.contactName,
    "E-mail": item.email,
    Téléphone: item.phone,
    "Adresse ou lieu": item.place
  }).filter(([, value]) => value).map(([label, value]) => `<div><strong>${esc(label)}</strong><p>${esc(value)}</p></div>`).join("");
  const persons = (item.personIds || []).map(id => nameOf(id)).filter(name => name !== "Personne supprimée");
  const nextAction = item.nextAction ? `${item.nextAction}${item.nextActionDate ? ` — ${formatShortDate(item.nextActionDate)}` : ""}` : "";
  $("procedureDetailContent").innerHTML = [
    nextAction ? procedureDetailBlock("Prochaine action", `<p class="procedure-next">${esc(nextAction)}</p>`) : "",
    item.objective ? procedureDetailBlock("Objectif", `<p>${esc(item.objective)}</p>`) : "",
    contactGrid ? procedureDetailBlock("Informations du dossier", `<div class="procedure-detail-grid">${contactGrid}</div>`) : "",
    persons.length ? procedureDetailBlock("Personnes éventuellement liées", `<div class="procedure-detail-persons">${persons.map(name => `<span class="procedure-tag">${esc(name)}</span>`).join("")}</div>`) : "",
    item.notes ? procedureDetailBlock("Notes", `<p>${esc(item.notes)}</p>`) : "",
    item.result ? procedureDetailBlock("Résultat ou conclusion", `<p>${esc(item.result)}</p>`) : ""
  ].join("");
}

function syncProcedureActionEmailFields() {
  const type = $("procedureActionType").value;
  const emailMode = isEmailAction(type);
  $("procedureActionEmailGroup").hidden = !emailMode;
  $("procedureActionTimeGroup").hidden = !emailMode;
  // Emails : le sens est implicite (envoyé/reçu) et le titre générique
  // doublonne avec l'objet — les champs sont masqués, pas supprimés.
  $("procedureActionDirection").closest("label")?.toggleAttribute("hidden", emailMode);
  $("procedureActionTitleField").closest("label")?.toggleAttribute("hidden", emailMode);
  const textLabel = $("procedureActionText")?.closest("label");
  if (textLabel && textLabel.firstChild?.nodeType === Node.TEXT_NODE) {
    textLabel.firstChild.nodeValue = emailMode ? "Notes / résumé" : "Résumé ou texte";
  }
  if (emailMode) {
    $("procedureActionDirection").value = type === "email-sent" ? "sent" : "received";
  }
}

/* Préremplissage email : simple aide, jamais prioritaire sur une valeur
   déjà saisie (on ne remplit que si le champ est vide).
   Email envoyé : destinataire propose l'organisme/contact du dossier.
   Email reçu : expéditeur propose l'organisme/contact du dossier. */
function dossierEmailDefaults(direction) {
  const item = procedures.find(value => value.id === activeDossierId) || {};
  const ownAddress = [currentUserProfile?.displayName, auth.currentUser?.email].filter(Boolean).join(" · ");
  if (direction === "received") {
    return {
      from: [item.organization, item.contactName].filter(Boolean).join(" · "),
      to: ownAddress
    };
  }
  return {
    from: ownAddress,
    to: [item.contactName, item.email].filter(Boolean).join(" · ")
  };
}

function openProcedureAction(action = null) {
  if (!activeDossierId) return;
  procedureActionMenu.close();
  $("procedureActionMenuBtn").hidden = !action;
  $("procedureActionForm").reset();
  $("procedureActionId").value = action?.id || "";
  $("procedureActionTitle").textContent = action ? "Modifier l’action" : "Ajouter une action";
  $("procedureActionType").value = action?.type || "email-sent";
  $("procedureActionDate").value = dossierEditDate(action?.date);
  $("procedureActionTime").value = action?.time || "";
  $("procedureActionDirection").value = action?.direction || "none";
  $("procedureActionTitleField").value = action?.title || "";
  $("procedureActionEmailFrom").value = action?.emailFrom || "";
  $("procedureActionEmailTo").value = action?.emailTo || "";
  $("procedureActionEmailSubject").value = action?.emailSubject || "";
  $("procedureActionEmailFull").value = action?.emailFull || "";
  $("procedureActionText").value = action?.text || "";
  $("procedureActionAuthor").value = action?.author || currentUserProfile?.displayName || "";
  syncProcedureActionEmailFields();
  if (!action && isEmailAction($("procedureActionType").value)) {
    const defaults = dossierEmailDefaults($("procedureActionType").value);
    if (!$("procedureActionEmailFrom").value.trim()) $("procedureActionEmailFrom").value = defaults.from || "";
    if (!$("procedureActionEmailTo").value.trim()) $("procedureActionEmailTo").value = defaults.to || "";
  }
  $("deleteProcedureActionBtn").hidden = !action;
  $("procedureActionDialog").showModal();
}

function closeProcedureActionUnsub() {
  procedureActionUnsub?.();
  procedureActionUnsub = null;
  activeDossierId = "";
}

async function saveProcedureAction(event) {
  event.preventDefault();
  if (!activeDossierId) return;
  const submitButton = event.submitter;
  const id = $("procedureActionId").value;
  const data = {
    type: $("procedureActionType").value,
    date: $("procedureActionDate").value,
    direction: $("procedureActionDirection").value,
    title: $("procedureActionTitleField").value.trim(),
    text: $("procedureActionText").value.trim(),
    author: $("procedureActionAuthor").value.trim(),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || "",
    updatedByName: currentUserProfile?.displayName || ""
  };
  if (isEmailAction(data.type)) {
    // direction implicite : « sent »/« received » — jamais laissé « none » pour un email
    data.direction = data.type === "email-sent" ? "sent" : "received";
    data.time = $("procedureActionTime").value.trim();
    data.emailFrom = $("procedureActionEmailFrom").value.trim();
    data.emailTo = $("procedureActionEmailTo").value.trim();
    data.emailSubject = $("procedureActionEmailSubject").value.trim();
    data.emailFull = $("procedureActionEmailFull").value.trim();
  }
  await withButtonPending(submitButton, () => runSafely(async () => {
    if (id) await updateDoc(doc(db, "procedures", activeDossierId, "actions", id), data);
    else await addDoc(collection(db, "procedures", activeDossierId, "actions"), { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "", createdByName: currentUserProfile?.displayName || "" });
    close("procedureActionDialog");
    toast(id ? "Action mise à jour" : "Action ajoutée");
  }, id ? "Mise à jour de l’action impossible" : "Création de l’action impossible"));
}

async function removeProcedureAction(id) {
  if (!activeDossierId || !id) return;
  if (!confirm("Supprimer définitivement cette action ? Cette action ne peut pas être annulée.")) return;
  await runSafely(async () => {
    await deleteDoc(doc(db, "procedures", activeDossierId, "actions", id));
    toast("Action supprimée");
  }, "Suppression de l’action impossible");
}


const accessRef = doc(db, "settings", "access");
const publicAuthRef = doc(db, "publicConfig", "auth");
const accessLabels = { pending: "Demande en attente", suspended: "Compte suspendu", rejected: "Demande refusée" };

function defaultDisplayName(user) {
  return (user?.email || "Compte").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function profileInitials(name, email = "") {
  const value = (name || email.split("@")[0] || "Compte").trim();
  return value.split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?";
}

function safeProfilePhoto(value = "") {
  return typeof value === "string" && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
}

function profileAvatarMarkup(profile = {}, user = auth.currentUser) {
  const photo = safeProfilePhoto(profile.photo);
  return photo ? `<img src="${photo}" alt="">` : esc(profileInitials(profile.displayName, user?.email));
}

function updateAccountUI(profile = {}, user = auth.currentUser) {
  const displayName = profile.displayName || defaultDisplayName(user);
  $("accountAvatar").innerHTML = profileAvatarMarkup(profile, user);
  $("accountLabel").textContent = displayName;
  $("accountSummaryName").textContent = displayName;
  $("accountSummaryEmail").textContent = user?.email || "";
  $("adminBtn").hidden = !(user?.uid === primaryAdminUid || profile.role === "admin");
}

function showAuthPanel(panel) {
  $("authScreen").hidden = panel === "app";
  $("loginForm").hidden = panel !== "login";
  $("signupForm").hidden = panel !== "signup";
  $("accessStatus").hidden = panel !== "status";
}

async function refreshSignupAvailability() {
  try {
    const snapshot = await getDoc(publicAuthRef);
    $("signupSwitch").hidden = !snapshot.exists() || snapshot.data().registrationOpen !== true;
  } catch (error) {
    console.warn("Vérification des inscriptions impossible", error);
    $("signupSwitch").hidden = true;
  }
}

function stopPrivateData() {
  unsubs.forEach(unsub => unsub());
  unsubs = [];
  adminUsersUnsub?.();
  adminUsersUnsub = null;
  activeDataUid = "";
  people = []; families = []; documents = []; tasks = [];
  genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
  genealogyLoaded = false;
  genealogyCollectionErrors = new Set();
  treeMetadata = [];
  activeTreeId = MAIN_TREE_ID;
  treeCatalogState = "idle";
  treeCatalogMessage = "";
  invalidTreeMetadataCount = 0;
  clearTreeScopedFilters();
  updateTreeSelectorOptions();
  updateTreeBranchOptions();
  updateTreeActionButtons();
  $("topbar").hidden = true;
  $("appMain").hidden = $("directoryView").hidden = $("documentsView").hidden = $("genealogyView").hidden = $("tasksView").hidden = true;
  if ($("adminDialog").open) $("adminDialog").close();
  if ($("profileDialog").open) $("profileDialog").close();
  if ($("dataDialog").open) $("dataDialog").close();
  if ($("genealogyContributionDialog").open) $("genealogyContributionDialog").close();
  if ($("genealogyItemDialog").open) $("genealogyItemDialog").close();
  if ($("restorePreviewDialog").open) $("restorePreviewDialog").close();
}

function applyAccessProfile(profile, user) {
  currentUserProfile = profile;
  updateAccountUI(profile, user);
  if (!(user.uid === primaryAdminUid || profile.role === "admin") && $("adminDialog").open) $("adminDialog").close();
  const approved = user.uid === primaryAdminUid || profile.status === "approved";
  if (!approved) {
    stopPrivateData();
    $("accessStatusTitle").textContent = accessLabels[profile.status] || "Accès indisponible";
    $("accessStatusMessage").textContent = profile.status === "suspended"
      ? "Votre accès a été temporairement suspendu par un administrateur."
      : profile.status === "rejected"
        ? "Votre demande d’accès a été refusée. Contactez un administrateur si nécessaire."
        : "Un administrateur doit valider votre compte avant que vous puissiez consulter l’arbre.";
    showAuthPanel("status");
    return;
  }
  showAuthPanel("app");
  $("topbar").hidden = false;
  $("appMain").hidden = false;
  updateTreeActionButtons();
  if (activeDataUid !== user.uid) {
    activeDataUid = user.uid;
    startData();
    setView("tree");
  }
}

async function initializeUserAccess(user) {
  const userRef = doc(db, "users", user.uid);
  await runTransaction(db, async transaction => {
    const accessSnapshot = await transaction.get(accessRef);
    const userSnapshot = await transaction.get(userRef);
    if (!accessSnapshot.exists()) {
      const profile = { email: user.email || "", displayName: defaultDisplayName(user), photo: "", role: "admin", status: "approved", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      transaction.set(accessRef, { primaryAdminUid: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      transaction.set(userRef, profile, { merge: true });
      transaction.set(publicAuthRef, { registrationOpen: true, updatedAt: serverTimestamp() });
      return;
    }
    if (!userSnapshot.exists()) {
      const isPrimary = accessSnapshot.data()?.primaryAdminUid === user.uid;
      transaction.set(userRef, { email: user.email || "", displayName: defaultDisplayName(user), photo: "", role: isPrimary ? "admin" : "member", status: isPrimary ? "approved" : "pending", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  });
  const accessSnapshot = await getDoc(accessRef);
  primaryAdminUid = accessSnapshot.data()?.primaryAdminUid || "";
  profileUnsub?.();
  profileUnsub = onSnapshot(userRef, snapshot => {
    if (!snapshot.exists()) return;
    applyAccessProfile({ id: snapshot.id, ...snapshot.data() }, user);
  }, error => {
    console.error(error);
    stopPrivateData();
    showAuthPanel("status");
    $("accessStatusTitle").textContent = "Accès impossible";
    $("accessStatusMessage").textContent = "Publiez les nouvelles règles Firestore, puis actualisez la page.";
  });
}

function selectSettingsTab(tab) {
  document.querySelectorAll("[data-settings-tab]").forEach(button => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("profileSettingsPanel").hidden = tab !== "profile";
  $("securitySettingsPanel").hidden = tab !== "security";
}

function openProfileSettings() {
  const user = auth.currentUser;
  if (!user || !currentUserProfile) return;
  currentProfilePhoto = currentUserProfile.photo || "";
  $("profileDisplayName").value = currentUserProfile.displayName || defaultDisplayName(user);
  $("profileEmail").value = user.email || "";
  $("profilePreview").innerHTML = profileAvatarMarkup(currentUserProfile, user);
  $("removeProfilePhotoBtn").hidden = !currentProfilePhoto;
  $("profileMessage").textContent = $("passwordMessage").textContent = "";
  $("currentPassword").value = $("newPassword").value = $("newPasswordConfirm").value = "";
  selectSettingsTab("profile");
  $("accountDropdown").hidden = true;
  $("accountMenuBtn").setAttribute("aria-expanded", "false");
  $("profileDialog").showModal();
}

function openDataManagement() {
  $("dataPeopleCount").textContent = people.length;
  $("dataDocumentCount").textContent = documents.length;
  $("dataTaskCount").textContent = tasks.length;
  $("accountDropdown").hidden = true;
  $("accountMenuBtn").setAttribute("aria-expanded", "false");
  $("dataDialog").showModal();
}

async function saveProfileSettings() {
  const user = auth.currentUser;
  const displayName = $("profileDisplayName").value.trim();
  if (!user || !displayName) {
    $("profileMessage").textContent = "Le nom affiché est obligatoire.";
    return;
  }
  setButtonPending($("saveProfileBtn"), true);
  $("profileMessage").textContent = "Enregistrement…";
  try {
    await updateDoc(doc(db, "users", user.uid), { displayName, photo: currentProfilePhoto, updatedAt: serverTimestamp() });
    $("profileMessage").textContent = "Profil enregistré.";
    $("profileMessage").classList.add("success");
    setTimeout(() => close("profileDialog"), 450);
  } catch (error) {
    console.error(error);
    $("profileMessage").textContent = "Enregistrement impossible.";
    $("profileMessage").classList.remove("success");
  } finally { setButtonPending($("saveProfileBtn"), false); }
}

async function changeAccountPassword() {
  const user = auth.currentUser;
  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmation = $("newPasswordConfirm").value;
  $("passwordMessage").classList.remove("success");
  if (!user?.email || !currentPassword || newPassword.length < 6) return $("passwordMessage").textContent = "Complétez les champs ; le nouveau mot de passe doit contenir au moins 6 caractères.";
  if (newPassword !== confirmation) return $("passwordMessage").textContent = "Les deux nouveaux mots de passe ne correspondent pas.";
  setButtonPending($("changePasswordBtn"), true, "Modification…");
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
    await updatePassword(user, newPassword);
    $("currentPassword").value = $("newPassword").value = $("newPasswordConfirm").value = "";
    $("passwordMessage").textContent = "Mot de passe modifié.";
    $("passwordMessage").classList.add("success");
  } catch (error) {
    console.error(error);
    $("passwordMessage").textContent = error.code === "auth/invalid-credential" ? "Le mot de passe actuel est incorrect." : "Modification impossible. Réessayez.";
  } finally { setButtonPending($("changePasswordBtn"), false); }
}

const userStatusLabels = { pending: "En attente", approved: "Actif", suspended: "Suspendu", rejected: "Refusé" };

function renderAdminUsers() {
  const query = searchable($("adminSearch").value);
  const rows = adminUsersCache.filter(item => !query || searchable(`${item.displayName || ""} ${item.email || ""}`).includes(query)).sort((a, b) => (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "", "fr", { sensitivity: "base" }));
  $("adminTotalCount").textContent = `${adminUsersCache.length} utilisateur${adminUsersCache.length > 1 ? "s" : ""}`;
  const pending = adminUsersCache.filter(item => item.status === "pending").length;
  const active = adminUsersCache.filter(item => item.status === "approved").length;
  $("adminPendingCount").textContent = `${pending} en attente`;
  $("adminActiveCount").textContent = `${active} actif${active > 1 ? "s" : ""}`;
  $("adminUsers").innerHTML = rows.length ? rows.map(item => {
    const primary = item.id === primaryAdminUid;
    let actions = "";
    if (!primary) {
      if (item.status === "pending") actions += `<button class="btn small primary" type="button" data-user-status="approved" data-user-id="${item.id}">Accepter</button><button class="btn small danger" type="button" data-user-status="rejected" data-user-id="${item.id}">Refuser</button>`;
      if (item.status === "approved") actions += `<button class="btn small danger" type="button" data-user-status="suspended" data-user-id="${item.id}">Suspendre</button>`;
      if (["suspended", "rejected"].includes(item.status)) actions += `<button class="btn small primary" type="button" data-user-status="approved" data-user-id="${item.id}">Réactiver</button>`;
      actions += `<select class="field" data-user-role="${item.id}" aria-label="Rôle de ${esc(item.displayName || item.email)}"><option value="member"${item.role !== "admin" ? " selected" : ""}>Membre</option><option value="admin"${item.role === "admin" ? " selected" : ""}>Administrateur</option></select>`;
    }
    return `<article class="admin-user"><div><h4>${esc(item.displayName || "Sans nom")}</h4><p>${esc(item.email || "Sans e-mail")}</p><p><span class="status-pill status-${item.status || "pending"}">${userStatusLabels[item.status] || item.status}</span> · ${item.role === "admin" ? "Administrateur" : "Membre"}</p>${primary ? '<p class="primary-note">Administrateur principal — accès protégé</p>' : ""}</div><div class="admin-user-actions">${actions}</div></article>`;
  }).join("") : emptyState({ iconName: "people", title: "Aucun utilisateur trouvé", description: "Modifiez la recherche pour afficher d’autres comptes." });
}

function openAdministration() {
  if (!(auth.currentUser?.uid === primaryAdminUid || currentUserProfile?.role === "admin")) return toast("Accès réservé aux administrateurs", "error");
  $("accountDropdown").hidden = true;
  $("accountMenuBtn").setAttribute("aria-expanded", "false");
  $("adminSearch").value = "";
  adminUsersUnsub?.();
  adminUsersUnsub = onSnapshot(refs.users, snapshot => {
    adminUsersCache = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderAdminUsers();
  }, error => {
    console.error(error);
    $("adminUsers").innerHTML = emptyState({ iconName: "error", title: "Chargement impossible", description: "Vérifiez les règles Firestore puis réessayez." });
  });
  $("adminDialog").showModal();
}

async function updateManagedUser(userId, changes) {
  if (!userId || userId === primaryAdminUid) return toast("Le compte administrateur principal est protégé", "info");
  await updateDoc(doc(db, "users", userId), { ...changes, updatedAt: serverTimestamp() });
  toast("Accès utilisateur mis à jour");
}

function setView(view) {
  if (view === "dossiers" && !featureFlags.showProcedures) view = "tree";
  $("appMain").hidden = view !== "tree";
  $("directoryView").hidden = view !== "directory";
  $("documentsView").hidden = view !== "documents";
  $("genealogyView").hidden = view !== "genealogy";
  $("tasksView").hidden = view !== "tasks";
  $("dossiersView").hidden = view !== "dossiers";
  $("addBtn").hidden = view !== "tree";
  $("headerTreeActions").hidden = view !== "tree";
  document.querySelectorAll("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "directory") renderDirectory();
  if (view === "documents") renderDocuments();
  if (view === "genealogy") renderGenealogyWorkspace();
  if (view === "tasks") renderTasks();
  if (view === "dossiers") renderProcedures();
  if (view === "tree" && !branchView) setTimeout(() => camera.recenter(), 0);
}

function dataError(error) {
  console.error(error);
  ["treeViewport", "directoryList", "documentsList", "tasksList", "proceduresList"].forEach(id => setLoadingSurface(id, false));
  $("syncDot").classList.remove("ok");
  $("syncText").textContent = "Accès refusé — publiez les nouvelles règles Firebase";
  $("syncText").closest(".status")?.setAttribute("data-state", "error");
}

function startData() {
  refreshTaskUsersCache();

  unsubs.forEach(unsub => unsub());
  unsubs = [];
  treeMetadata = [];
  activeTreeId = MAIN_TREE_ID;
  treeCatalogState = "loading";
  treeCatalogMessage = "";
  invalidTreeMetadataCount = 0;
  clearTreeScopedFilters();
  updateTreeSelectorOptions();
  updateTreeBranchOptions();
  loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = false;
  loadedProcedures = false;
  genealogyLoaded = false;
  genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
  genealogyCollectionErrors = new Set();
  ["treeViewport", "directoryList", "documentsList", "tasksList", "proceduresList"].forEach(id => setLoadingSurface(id, true));
  $("directoryResultCount").textContent = "Chargement de l’annuaire…";
  $("syncText").textContent = "Synchronisation en cours…";
  $("syncText").closest(".status")?.setAttribute("data-state", "loading");
  unsubs.push(onSnapshot(refs.people, snapshot => {
    people = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedPeople = true;
    syncState();
    updateReadyViews();
  }, dataError));
  unsubs.push(onSnapshot(refs.families, snapshot => {
    families = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedFamilies = true;
    syncState();
    if ($("personDialog").open && activePersonSection === "relations" && activeId) renderRelations();
  }, dataError));
  unsubs.push(onSnapshot(refs.documents, snapshot => {
    documents = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedDocuments = true;
    syncState();
    updateReadyViews();
  }, dataError));
  unsubs.push(onSnapshot(refs.tasks, snapshot => {
    tasks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedTasks = true;
    syncState();
    updateReadyViews();
  }, dataError));
  unsubs.push(onSnapshot(refs.procedures, snapshot => {
    procedures = snapshot.docs.map(item => ({ id: item.id, ...item.data(), updatedAtSort: item.data().updatedAt?.toMillis?.() || 0 }));
    loadedProcedures = true;
    syncState();
    updateReadyViews();
  }, dataError));
  unsubs.push(onSnapshot(refs.trees, acceptTreeCatalog, rejectTreeCatalog));
  const genealogyCollections = ["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents"];
  let genealogyCollectionLoadCount = 0;
  for (const collectionName of genealogyCollections) {
    unsubs.push(onSnapshot(refs[collectionName], snapshot => {
      genealogyRecords[collectionName] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      genealogyCollectionLoadCount++;
      if (genealogyCollectionLoadCount >= genealogyCollections.length) genealogyLoaded = true;
      renderGenealogyWorkspace();
    }, error => {
      console.error(`Chargement de ${collectionName} impossible`, error);
      genealogyCollectionErrors.add(collectionName);
      renderGenealogyWorkspace();
    }));
  }
  const proposalQuery = isAdminUser()
    ? refs.genealogyProposals
    : query(refs.genealogyProposals, where("authorUid", "==", auth.currentUser?.uid || ""));
  unsubs.push(onSnapshot(proposalQuery, snapshot => {
    genealogyRecords.genealogyProposals = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderGenealogyWorkspace();
  }, error => { console.error("Chargement des propositions impossible", error); genealogyCollectionErrors.add("genealogyProposals"); renderGenealogyWorkspace(); }));
  unsubs.push(onSnapshot(query(refs.genealogyNotifications, where("recipientUid", "==", auth.currentUser?.uid || "")), snapshot => {
    genealogyRecords.genealogyNotifications = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    renderGenealogyWorkspace();
  }, error => { console.error("Chargement des notifications impossible", error); genealogyCollectionErrors.add("genealogyNotifications"); renderGenealogyWorkspace(); }));
}

onAuthStateChanged(auth, async user => {
  profileUnsub?.();
  profileUnsub = null;
  adminUsersUnsub?.();
  adminUsersUnsub = null;
  if (user) {
    showAuthPanel("status");
    $("accessStatusTitle").textContent = "Vérification de l’accès…";
    $("accessStatusMessage").textContent = "Votre profil est en cours de chargement.";
    try { await initializeUserAccess(user); }
    catch (error) {
      console.error(error);
      stopPrivateData();
      showAuthPanel("status");
      $("accessStatusTitle").textContent = "Initialisation impossible";
      $("accessStatusMessage").textContent = "Publiez le nouveau fichier firestore.rules, puis actualisez la page.";
    }
  } else {
    currentUserProfile = null;
    primaryAdminUid = "";
    adminUsersCache = [];
    stopPrivateData();
    showAuthPanel("login");
    refreshSignupAvailability();
  }
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("authError").textContent = "";
  setButtonPending($("loginBtn"), true, "Connexion…");
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (error) {
    console.error(error);
    $("authError").textContent = error.code === "auth/invalid-credential" ? "E-mail ou mot de passe incorrect." : "Connexion impossible. Vérifiez Firebase Authentication.";
  } finally {
    setButtonPending($("loginBtn"), false);
  }
});

$("showSignupBtn").onclick = () => {
  $("signupForm").reset();
  $("signupError").textContent = "";
  showAuthPanel("signup");
};
$("backToLoginBtn").onclick = () => showAuthPanel("login");
$("signupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;
  const confirmation = $("signupPasswordConfirm").value;
  $("signupError").textContent = "";
  if (password !== confirmation) return $("signupError").textContent = "Les deux mots de passe ne correspondent pas.";
  setButtonPending($("signupSubmitBtn"), true, "Envoi…");
  try { await createUserWithEmailAndPassword(auth, email, password); }
  catch (error) {
    console.error(error);
    $("signupError").textContent = error.code === "auth/email-already-in-use" ? "Un compte utilise déjà cette adresse e-mail." : error.code === "auth/weak-password" ? "Le mot de passe doit contenir au moins 6 caractères." : "Création du compte impossible.";
  } finally { setButtonPending($("signupSubmitBtn"), false); }
});

$("personForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (personFormSaving) return;
  personFormSaving = true;
  const saveButton = $("savePersonBtn");
  setButtonPending(saveButton, true);
  const data = Object.fromEntries(personFields.map(key => [key, $(key).value.trim()]));
  data.updatedAt = serverTimestamp();
  data.updatedBy = auth.currentUser?.uid || "";
  data.updatedByName = currentUserProfile?.displayName || "";
  try {
    const birthDateInfo = readGenealogyDateForm("birth");
    const deathDateInfo = readGenealogyDateForm("death");
    data.birthDateInfo = birthDateInfo;
    data.deathDateInfo = deathDateInfo;
    data.birthDate = birthDateInfo.type === "exact" ? birthDateInfo.value : deleteField();
    data.deathDate = deathDateInfo.type === "exact" ? deathDateInfo.value : deleteField();
    const id = $("personId").value;
    const existing = people.find(item => item.id === id);
    applyLocationField(data, "place", existing, !!id);
    applyLocationField(data, "deathPlace", existing, !!id);
    const birthLabel = formatGenealogyDate(birthDateInfo);
    const duplicate = people.find(item => item.id !== id && searchable(item.firstName) === searchable(data.firstName) && searchable(item.lastName) === searchable(data.lastName) && (birthLabel === "—" || formatGenealogyDate(item.birthDateInfo, item.birthDate) === birthLabel));
    if (duplicate && !confirm(`Une fiche proche existe déjà : ${nameOf(duplicate.id)}${birthLabel !== "—" ? ` (${birthLabel})` : ""}.\n\nEnregistrer quand même cette personne ?`)) return;
    if (id) {
      await updateDoc(doc(db, "people", id), data);
      focusAfterRender = id;
      close("personDialog");
      toast("Personne mise à jour");
    } else {
      const createData = { ...data };
      const destinationTreeId = personDialogSource === "directory" ? $("personTreeSelect").value : personCreationTreeId;
      const createUnassigned = personDialogSource === "directory" && destinationTreeId === UNASSIGNED_TREE_CHOICE;
      if (!destinationTreeId || (!createUnassigned && destinationTreeId !== MAIN_TREE_ID && !isValidTreeId(destinationTreeId))) {
        throw new Error("L’arbre de destination est invalide. Aucune fiche n’a été créée.");
      }
      if (createUnassigned) {
        createData.treeId = "";
        createData.treeAssignmentState = UNASSIGNED_TREE_STATE;
      } else if (destinationTreeId !== MAIN_TREE_ID) {
        if (treeCatalogState !== "ready" || !treeMetadata.some(tree => tree.id === destinationTreeId)) {
          throw new Error("L’arbre choisi n’est plus disponible. Aucune fiche n’a été créée.");
        }
        let destinationSnapshot;
        try {
          destinationSnapshot = await getDocFromServer(doc(db, "trees", destinationTreeId));
        } catch (error) {
          console.error("Vérification de l’arbre de destination impossible", error);
          throw new Error("Impossible de vérifier l’arbre choisi. Vérifiez votre connexion puis réessayez.");
        }
        if (!destinationSnapshot.exists()) throw new Error("L’arbre choisi n’existe plus. Aucune fiche n’a été créée.");
        if (getTreeLifecycleState(destinationSnapshot.data()) !== TREE_LIFECYCLE_ACTIVE) {
          throw new Error("L’arbre choisi est en cours de suppression ou son état est invalide. Aucune fiche n’a été créée.");
        }
        createData.treeId = destinationTreeId;
      }
      if (birthDateInfo.type !== "exact") delete createData.birthDate;
      if (deathDateInfo.type !== "exact") delete createData.deathDate;
      if (!pendingPersonCreateId) pendingPersonCreateId = doc(refs.people).id;
      const createdId = pendingPersonCreateId;
      await setDoc(doc(db, "people", createdId), { ...createData, inTree: true, createdAt: serverTimestamp() });
      const createdPerson = { id: createdId, ...createData, inTree: true };
      people.push(createdPerson);
      pendingPersonCreateId = "";
      activeId = createdId;
      focusAfterRender = createdId;
      $("personId").value = createdId;
      updatePersonMenuActions(createdPerson);
      $("dialogTitle").textContent = "Modifier la personne";
      $("savePersonBtn").textContent = "Enregistrer";
      $("savePersonBtn").dataset.idleLabel = "Enregistrer";
      $("savePersonBtn").dataset.idleContent = "Enregistrer";
      $("personTreeAssignment").hidden = true;
      $("personTreeSelectWrap").hidden = true;
      setPersonSection("relations", true);
      toast("Personne ajoutée — indiquez maintenant ses liens familiaux");
    }
  } catch (error) {
    console.error(error);
    const errorText = `${error.code || ""} ${error.message || ""}`;
    const message = /permission-denied|insufficient permissions/i.test(errorText)
      ? "Création refusée par les règles Firestore. L’arbre choisi est peut-être en cours de suppression ou votre accès est insuffisant. Aucune fiche n’a été créée."
      : /unavailable|network|offline|failed to fetch|deadline-exceeded/i.test(errorText)
        ? "Connexion impossible : la fiche n’a pas pu être enregistrée. Réessayez sans fermer ce formulaire."
        : error.message || "Enregistrement impossible";
    toast(message, "error");
  } finally {
    personFormSaving = false;
    setButtonPending(saveButton, false);
  }
});
$("personForm").addEventListener("invalid", () => setPersonSection("identity"), true);

async function removeDirectoryPersonPermanently(id) {
  if (!id || !confirm("Supprimer définitivement cette personne ? Elle sera aussi retirée de l’arbre et de tous ses liens familiaux.")) return false;
  const batch = writeBatch(db);
  batch.delete(doc(db, "people", id));
  for (const family of families) {
    if (!(family.partnerIds || []).includes(id) && !(family.childIds || []).includes(id)) continue;
    const partnerIds = (family.partnerIds || []).filter(value => value !== id);
    const childIds = (family.childIds || []).filter(value => value !== id);
    if (!partnerIds.length) batch.delete(doc(db, "families", family.id));
    else batch.update(doc(db, "families", family.id), { partnerIds, childIds, parentChildLinks: normalizedParentChildLinks({ ...family, partnerIds, childIds }), updatedAt: serverTimestamp() });
  }
  for (const item of documents.filter(value => (value.personIds || []).includes(id))) {
    batch.update(doc(db, "documents", item.id), { personIds: item.personIds.filter(value => value !== id), updatedAt: serverTimestamp() });
  }
  for (const task of tasks.filter(value => value.personId === id)) {
    batch.update(doc(db, "tasks", task.id), { personId: "", updatedAt: serverTimestamp() });
  }
  await batch.commit();
  delete manualOffsets[id];
  saveOffsets();
  if ($("personDialog").open && $("personId").value === id) close("personDialog");
  else if (activeId === id) { activeId = null; renderer.setActive(null); }
  toast("Personne supprimée");
  return true;
}

async function removePersonFromTree(id) {
  if (!isAdminUser()) return toast("Seuls les administrateurs peuvent retirer une personne de son arbre", "error");
  const item = person(id);
  if (!item) return toast("Cette personne est introuvable", "error");
  const expectedMembership = getPersonTreeMembership(item);
  if (expectedMembership.type === "unassigned") return toast("Cette personne n’appartient déjà à aucun arbre", "info");
  if (expectedMembership.type !== "assigned") return toast("L’appartenance de cette personne est indisponible", "error");
  if (!confirm("Retirer cette personne de son arbre ? Elle restera dans l’Annuaire avec ses informations, ses relations et ses documents.")) return false;
  const uid = auth.currentUser?.uid || "";
  if (!uid) throw new Error("Votre session a expiré; reconnectez-vous avant le retrait.");
  await runTransaction(db, async transaction => {
    const ref = doc(db, "people", id);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error("Cette personne n’existe plus ou n’est plus accessible.");
    const livePerson = { id: snapshot.id, ...snapshot.data() };
    const liveMembership = getPersonTreeMembership(livePerson);
    if (liveMembership.type !== "assigned" || liveMembership.treeId !== expectedMembership.treeId) {
      throw new Error("L’appartenance a changé depuis l’ouverture de la fiche. Fermez-la et recommencez.");
    }
    transaction.update(ref, {
      treeId: "",
      treeAssignmentState: UNASSIGNED_TREE_STATE,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
      updatedByName: currentUserProfile?.displayName || ""
    });
  });
  delete manualOffsets[id];
  saveOffsets();
  people = people.map(value => value.id === id
    ? { ...value, treeId: "", treeAssignmentState: UNASSIGNED_TREE_STATE }
    : value);
  if ($("personDialog").open && $("personId").value === id) close("personDialog");
  else if (activeId === id) { activeId = null; renderer.setActive(null); }
  if (!$(("directoryView")).hidden) renderDirectory();
  else if (!$(("appMain")).hidden) { updateTreeBranchOptions(); renderTree(); }
  toast("Personne retirée de son arbre, fiche conservée dans l’Annuaire sans arbre");
  return true;
}

$("deleteBtn").onclick = async () => {
  const id = $("personId").value;
  if (!id) return;
  await runSafely(() => removeDirectoryPersonPermanently(id), "Suppression de la personne impossible");
};
$("restoreTreeBtn").onclick = async () => {
  const id = $("personId").value;
  if (!id) return;
  await updateDoc(doc(db, "people", id), { inTree: true, updatedAt: serverTimestamp() });
  focusAfterRender = id;
  close("personDialog");
  toast("Personne ajoutée à l’arbre");
};

document.querySelectorAll("[data-person-section]").forEach(button => {
  button.onclick = () => setPersonSection(button.dataset.personSection, true);
  button.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll("[data-person-section]")];
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const index = (tabs.indexOf(button) + direction + tabs.length) % tabs.length;
    setPersonSection(tabs[index].dataset.personSection, true);
  };
});
$("toggleRelationBuilderBtn").onclick = () => setRelationBuilderOpen($("relationBuilder").hidden, "parent");
$("closeRelationBuilderBtn").onclick = () => setRelationBuilderOpen(false);
document.querySelectorAll("[data-relation-kind]").forEach(button => {
  button.onclick = () => setRelationBuilderKind(button.dataset.relationKind);
});
$("addPartnerBtn").onclick = event => withButtonPending(event.currentTarget, () => runSafely(addPartner, "Ajout du partenaire impossible"), "Ajout…");
$("addChildBtn").onclick = event => withButtonPending(event.currentTarget, () => runSafely(addChild, "Ajout de l’enfant impossible"), "Ajout…");
$("addParentBtn").onclick = event => withButtonPending(event.currentTarget, () => runSafely(addParent, "Ajout du parent impossible"), "Ajout…");
$("relationsList").onclick = event => {
  const detailsButton = event.target.closest("[data-edit-family]");
  if (detailsButton) return openFamilyDetails(detailsButton.dataset.editFamily);
  const button = event.target.closest("[data-remove-partner],[data-remove-child]");
  if (!button) return;
  withButtonPending(button, () => runSafely(() => removeRelation(button.dataset.removePartner || button.dataset.removeChild, button.dataset.person, button.dataset.removePartner ? "partner" : "child"), "Dissociation du lien impossible"), "Dissociation…");
};
document.querySelectorAll("[data-date-prefix]").forEach(button => button.onclick = () => setGenealogyDateType(button.dataset.datePrefix, button.dataset.dateType));
$("familyEndType").onchange = updateEndDetailsVisibility;
$("familyDetailsForm").addEventListener("submit", saveFamilyDetails);
$("familyDetailsDialog").addEventListener("close", () => { if (familyDetailsReturnContext) returnFromFamilyDetails(); });

document.addEventListener("click", event => {
  const closeButton = event.target.closest("[data-close]");
  if (closeButton) close(closeButton.dataset.close);
  if (event.target.closest("[data-empty-add-person]")) openPerson(null, "directory");
  if (event.target.closest("[data-empty-add-document]")) openDocument();
  if (event.target.closest("[data-empty-add-task]")) openTask();
  const miniDocument = event.target.closest("[data-view-document]");
  const editPersonDocument = event.target.closest("[data-edit-person-document]");
  if (editPersonDocument) {
    const item = documents.find(value => value.id === editPersonDocument.dataset.editPersonDocument);
    const context = activeId ? { personId: activeId, source: personDialogSource, draft: capturePersonDraft() } : null;
    if ($("personDialog").open) $("personDialog").close();
    openDocument(item, "", context);
    return;
  }
  if (miniDocument) {
    const item = documents.find(value => value.id === miniDocument.dataset.viewDocument);
    openStoredDocument(item);
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!$("accountDropdown").hidden) {
    $("accountDropdown").hidden = true;
    $("accountMenuBtn").setAttribute("aria-expanded", "false");
    $("accountMenuBtn").focus();
  }
  if (!$("treeMenu").hidden) {
    setTreeMenu(false);
    $("treeMoreBtn").focus();
  }
});

$("documentsList").onclick = event => {
  const tile = event.target.closest(".document-card[data-document-card][data-document-openable='true']");
  if (!tile || event.target.closest("button, a, input, select, textarea, summary, .tile-context-actions")) return;
  const item = documents.find(value => value.id === tile.dataset.documentCard);
  if (!item) return;
  preparePrimaryTileActivation(event, tile, $("documentViewerDialog"));
  openStoredDocument(item);
};
$("documentsList").addEventListener("keydown", event => {
  const tile = event.target.closest(".document-card[data-document-card][data-document-openable='true']");
  if (!tile || event.target !== tile || !["Enter", " "].includes(event.key)) return;
  pendingPrimaryTilePointer = null;
  primaryTileFocusReturn.delete($("documentViewerDialog"));
  event.preventDefault();
  openStoredDocument(documents.find(value => value.id === tile.dataset.documentCard));
});

$("directoryList").addEventListener("click", event => {
  if (event.target.closest(".tile-context-actions")) return;
  const documentsButton = event.target.closest("[data-directory-documents]");
  if (documentsButton) return openDirectoryDocuments(documentsButton.dataset.directoryDocuments);
  const entry = event.target.closest("[data-directory-person]");
  if (entry && !event.target.closest("button, a, input, select, textarea, summary, .tile-context-actions")) {
    preparePrimaryTileActivation(event, entry, $("personDialog"));
    openPerson(person(entry.dataset.directoryPerson), "directory");
  }
});
$("directoryList").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const entry = event.target.closest("[data-directory-person]");
  if (!entry || event.target !== entry) return;
  pendingPrimaryTilePointer = null;
  primaryTileFocusReturn.delete($("personDialog"));
  event.preventDefault();
  openPerson(person(entry.dataset.directoryPerson), "directory");
});

$("personDocumentsList").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const card = event.target.closest("[data-view-document]");
  if (!card) return;
  event.preventDefault();
  const item = documents.find(value => value.id === card.dataset.viewDocument);
  openStoredDocument(item);
});

$("directoryDocumentsList").addEventListener("click", event => {
  const button = event.target.closest("[data-view-directory-document]");
  if (!button) return;
  openStoredDocument(documents.find(item => item.id === button.dataset.viewDirectoryDocument));
});

$("directoryAlphabet").addEventListener("click", event => {
  const button = event.target.closest("[data-letter]");
  if (!button || button.disabled) return;
  const target = $("directoryList").querySelector(`[data-letter="${button.dataset.letter}"]`);
  if (!target) return;
  document.querySelectorAll("#directoryAlphabet button").forEach(item => item.classList.toggle("active", item === button));
  document.querySelectorAll("#directoryList .letter-target").forEach(item => item.classList.remove("letter-target"));
  target.classList.add("letter-target");
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => target.classList.remove("letter-target"), 1800);
});

$("tasksList").onclick = async event => {
  const row = event.target.closest(".task-row[data-task-row]");
  if (row && !event.target.closest("button, a, input, select, textarea, summary, [contenteditable='true'], .tile-context-actions")) {
    preparePrimaryTileActivation(event, row, $("taskDialog"));
    openTaskById(row.dataset.taskRow);
  }
};

$("tasksList").onkeydown = event => {
  const row = event.target.closest(".task-row[data-task-row][tabindex='0']");
  if (!row || event.target !== row || !["Enter", " "].includes(event.key)) return;
  pendingPrimaryTilePointer = null;
  primaryTileFocusReturn.delete($("taskDialog"));
  event.preventDefault();
  openTaskById(row.dataset.taskRow);
};

$("logoutBtn").onclick = () => signOut(auth);
$("statusLogoutBtn").onclick = () => signOut(auth);
$("accountMenuBtn").onclick = event => {
  event.stopPropagation();
  const open = $("accountDropdown").hidden;
  $("accountDropdown").hidden = !open;
  $("accountMenuBtn").setAttribute("aria-expanded", String(open));
};
$("accountMenuBtn").addEventListener("keydown", event => {
  if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
  if ((event.key === 'Enter' || event.key === ' ') && !$("accountDropdown").hidden) return;
  event.preventDefault();
  $("accountDropdown").hidden = false;
  $("accountMenuBtn").setAttribute("aria-expanded", "true");
  $("accountDropdown").querySelector("button:not([hidden]):not([disabled])")?.focus();
});
$("accountDropdown").addEventListener("keydown", event => {
  const items = [...$("accountDropdown").querySelectorAll("button:not([hidden]):not([disabled])")];
  const current = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    $("accountDropdown").hidden = true;
    $("accountMenuBtn").setAttribute("aria-expanded", "false");
    $("accountMenuBtn").focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length : (current - 1 + items.length) % items.length;
  items[index].focus();
});
document.addEventListener("click", event => {
  if (!$("accountMenu").contains(event.target)) {
    $("accountDropdown").hidden = true;
    $("accountMenuBtn").setAttribute("aria-expanded", "false");
  }
});
$("profileBtn").onclick = openProfileSettings;
$("dataBtn").onclick = openDataManagement;
$("adminBtn").onclick = openAdministration;
document.querySelectorAll("[data-settings-tab]").forEach(button => {
  button.onclick = () => selectSettingsTab(button.dataset.settingsTab);
  button.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...document.querySelectorAll("[data-settings-tab]")];
    const current = tabs.indexOf(button);
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (current + 1) % tabs.length : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    selectSettingsTab(tabs[index].dataset.settingsTab);
    tabs[index].focus();
  };
});
$("profilePhotoFile").onchange = async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("profileMessage").classList.remove("success");
  $("profileMessage").textContent = "Compression de la photo…";
  try {
    const compressed = await compressPersonPhoto(file);
    currentProfilePhoto = compressed.dataUrl;
    $("profilePreview").innerHTML = `<img src="${currentProfilePhoto}" alt="">`;
    $("removeProfilePhotoBtn").hidden = false;
    $("profileMessage").textContent = `Photo prête · ${formatBytes(compressed.encodedBytes)}`;
  } catch (error) {
    console.error(error);
    $("profileMessage").textContent = error.message || "Compression impossible.";
  } finally { event.target.value = ""; }
};
$("removeProfilePhotoBtn").onclick = () => {
  currentProfilePhoto = "";
  $("profilePreview").textContent = profileInitials($("profileDisplayName").value, auth.currentUser?.email);
  $("removeProfilePhotoBtn").hidden = true;
  $("profileMessage").textContent = "La photo sera retirée après enregistrement.";
};
$("profileDisplayName").oninput = () => {
  if (!currentProfilePhoto) $("profilePreview").textContent = profileInitials($("profileDisplayName").value, auth.currentUser?.email);
};
$("saveProfileBtn").onclick = saveProfileSettings;
$("changePasswordBtn").onclick = changeAccountPassword;
$("adminSearch").oninput = renderAdminUsers;
$("adminUsers").onclick = event => {
  const button = event.target.closest("[data-user-status]");
  if (button) withButtonPending(button, () => runSafely(() => updateManagedUser(button.dataset.userId, { status: button.dataset.userStatus }), "Mise à jour de l’accès impossible"), "Mise à jour…");
};
$("adminUsers").onchange = event => {
  const select = event.target.closest("[data-user-role]");
  if (select) runSafely(() => updateManagedUser(select.dataset.userRole, { role: select.value }), "Mise à jour du rôle impossible");
};
$("adminDialog").addEventListener("close", () => {
  adminUsersUnsub?.();
  adminUsersUnsub = null;
});
$("addBtn").onclick = () => openPerson();
// La caméra capture le pointeur sur le viewport dès le pointerdown, ce qui
// redirige le click du bouton central vers le viewport. On détecte le clic
// sur le viewport en vérifiant les coordonnées du bouton.
$("treeViewport").addEventListener("click", event => {
  // Les clics clavier/souris non capturés remontent aussi à la scène, dont
  // le renderer appelle déjà onEmptyAdd. Seul le clic retargeté au viewport
  // par pointer capture doit être reconstitué par ses coordonnées.
  if (event.target.closest("[data-empty-add]")) return;
  const btn = $("treeScene").querySelector("[data-empty-add]");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) openPerson();
});
$("viewBranchBtn").onclick = () => {
  const id = $("personId").value;
  if (id) activateBranchView(id);
};
$("branchExitBtn").onclick = exitBranchView;
document.querySelectorAll("[data-branch-depth]").forEach(button => {
  button.onclick = () => {
    if (!branchView) return;
    const value = button.dataset.branchDepth === "all" ? ALL_ANCESTORS : Number(button.dataset.branchDepth);
    branchView = { ...branchView, ancestorDepth: value };
    focusAfterRender = branchView.personId;
    renderTree();
  };
});
$("addDirectoryPersonBtn").onclick = () => openPerson(null, "directory");
$("treeQualityBtn").onclick = () => {
  renderTreeQuality();
  $("treeQualityDialog").showModal();
};
$("treeQualityContent").onclick = event => {
  const button = event.target.closest("[data-quality-person]");
  if (!button) return;
  const item = person(button.dataset.qualityPerson);
  if (!item) return;
  close("treeQualityDialog");
  openPerson(item, "directory");
};
$("gender").onchange = updateMarriedNameVisibility;
$("firstName").addEventListener("input", updatePersonPhotoPreview);
$("lastName").addEventListener("input", updatePersonPhotoPreview);
$("personPhotoFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const picker = document.querySelector('label[for="personPhotoFile"]');
  picker.setAttribute("aria-disabled", "true");
  $("personPhotoFile").disabled = true;
  $("personPhotoStatus").textContent = "Compression de la photo…";
  try {
    const compressed = await compressPersonPhoto(file);
    $("photoUrl").value = compressed.dataUrl;
    $("personPhotoStatus").textContent = `Photo prête · ${formatBytes(compressed.encodedBytes)} stockés`;
    updatePersonPhotoPreview();
  } catch (error) {
    console.error(error);
    $("personPhotoStatus").textContent = error.message || "Compression impossible";
    toast("Impossible de préparer cette photo", "error");
  } finally {
    $("personPhotoFile").disabled = false;
    picker.removeAttribute("aria-disabled");
    event.target.value = "";
  }
});
$("removePersonPhotoBtn").onclick = () => {
  $("photoUrl").value = "";
  $("personPhotoStatus").textContent = "La photo sera retirée après enregistrement.";
  updatePersonPhotoPreview();
};
const syncSearchClearBtn = (inputId, btnId) => {
  const input = $(inputId);
  const btn = $(btnId);
  if (!input || !btn) return;
  const update = () => btn.classList.toggle("is-visible", input.value.length > 0);
  input.addEventListener("input", update);
  update();
};
$("search").oninput = () => applySearch(true);
syncSearchClearBtn("search", "clearTreeSearchBtn");
$("clearTreeSearchBtn").onclick = () => {
  $("search").value = "";
  $("search").dispatchEvent(new Event("input"));
  $("search").focus();
};
$("treeSelect").onchange = () => setActiveTree($("treeSelect").value);
$("treeBranchFilter").onchange = () => {
  lineageSurname = $("treeBranchFilter").value;
  branchView = null;
  focusAfterRender = null;
  renderTree();
  camera.fit();
};
let zoomBadgeTimer = 0;
function showZoomBadge() {
  $("zoomLevel").classList.add("show");
  clearTimeout(zoomBadgeTimer);
  zoomBadgeTimer = setTimeout(() => $("zoomLevel").classList.remove("show"), 1500);
}
$("zoomOutBtn").onclick = () => { camera.zoomBy(1 / 1.2); showZoomBadge(); };
$("zoomInBtn").onclick = () => { camera.zoomBy(1.2); showZoomBadge(); };
$("fitTreeBtn").onclick = () => camera.fit();
function setTreeMenu(open) {
  const menu = $("treeMenu");
  menu.hidden = !open;
  $("treeMoreBtn").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const canvas = $("treeViewport");
  const host = $("treeMoreBtn").closest(".view-control");
  const headroom = host.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 6;
  menu.style.maxHeight = `${Math.max(0, Math.floor(headroom))}px`;
  const firstVisible = $("menuFitBtn").offsetParent !== null ? $("menuFitBtn") : $("centerTreeBtn");
  firstVisible.focus();
}
$("treeMoreBtn").onclick = () => {
  setTreeMenu($("treeMenu").hidden);
};
$("menuFitBtn").onclick = () => {
  setTreeMenu(false);
  camera.fit();
  $("treeMoreBtn").focus();
};
$("centerTreeBtn").onclick = () => {
  setTreeMenu(false);
  camera.recenter();
  $("treeMoreBtn").focus();
};
$("autoLayoutBtn").onclick = () => {
  setTreeMenu(false);
  if (Object.keys(manualOffsets).length && !confirm("Réinitialiser toutes les positions manuelles ?")) return;
  manualOffsets = {};
  saveOffsets();
  renderTree();
  camera.fit();
  toast("Disposition automatique restaurée");
};
$("menuExportTreeBtn").onclick = () => {
  setTreeMenu(false);
  $("treeExportDialog").showModal();
  $("treeExportDialog").querySelector("[data-export-format]")?.focus();
};
document.querySelectorAll("[data-export-format]").forEach(button => {
  button.onclick = () => {
    const format = button.dataset.exportFormat;
    close("treeExportDialog");
    exportTreeImage(format);
  };
});
$("treeExportDialog").addEventListener("close", () => { if (!$("appMain").hidden) $("treeMoreBtn").focus(); });
document.addEventListener("click", event => {
  const menu = $("treeMenu");
  if (menu.hidden) return;
  if (!event.target.closest(".view-control")) setTreeMenu(false);
});
$("linkDocumentBtn").onclick = () => {
  const personId = activeId;
  if (!personId) return;
  const context = { personId, source: personDialogSource, draft: capturePersonDraft() };
  $("personDialog").close();
  openDocument(null, personId, context);
};
$("addDocumentBtn").onclick = () => openDocument();
$("documentForm").addEventListener("submit", saveDocument);
$("documentFile").addEventListener("change", () => renderDocumentFileState());
$("removeCurrentDocumentFileBtn").onclick = () => {
  const item = documents.find(documentItem => documentItem.id === $("documentId").value);
  if (!canSafelyRemoveStoredDocumentFile(item)) return;
  documentFileMarkedForRemoval = true;
  renderDocumentFileState(item);
};
$("restoreCurrentDocumentFileBtn").onclick = () => {
  documentFileMarkedForRemoval = false;
  renderDocumentFileState();
};
$("deleteDocumentBtn").onclick = () => runSafely(removeDocument, "Suppression du document impossible");
$("documentDialog").addEventListener("close", () => {
  const context = documentReturnContext;
  documentReturnContext = null;
  if (!context) return;
  setTimeout(() => {
    const item = person(context.personId);
    if (!item || $("personDialog").open) return;
    openPerson(item, context.source);
    restorePersonDraft(context.draft);
    setPersonSection("documents");
  }, 0);
});

$("documentSearch").oninput = renderDocuments;
$("documentTypeFilter").onchange = renderDocuments;
$("genealogySearch").oninput = renderGenealogyWorkspace;
$("genealogyKindFilter").onchange = renderGenealogyWorkspace;
$("genealogyResults").addEventListener("click", event => runSafely(() => handleGenealogyWorkspaceClick(event), "Action d’archive impossible"));
document.addEventListener("click", event => {
  const button = event.target.closest("[data-open-genealogy]");
  if (button) openGenealogyItem(button.dataset.openGenealogy, button.dataset.genealogyId);
});
$("genealogyItemContent").addEventListener("click", event => {
  const pageButton = event.target.closest("[data-genealogy-page]");
  if (pageButton) return openGenealogyPage(pageButton.dataset.genealogyPage);
  const zoomButton = event.target.closest("[data-genealogy-zoom]");
  const photoButton = event.target.closest("[data-genealogy-photo]");
  if (photoButton && activeGenealogyItem) return openGenealogyItem(activeGenealogyItem.kind, activeGenealogyItem.record.id, activeGenealogyPageId, photoButton.dataset.genealogyPhoto);
  const passageProofButton = event.target.closest("[data-genealogy-passage-propose]");
  if (passageProofButton && activeGenealogyItem) {
    const sourceData = activeGenealogyItem.data;
    const revision = genealogyRecords.transcriptionRevisions.find(item => item.id === sourceData.revisionId || item.id === sourceData.currentRevisionId);
    const transcriptionData = revision ? genealogyRecordData(revision).data || genealogyRecordData(revision) : sourceData.revision || sourceData;
    const passage = transcriptionData.passages?.[Number(passageProofButton.dataset.genealogyPassage)];
    if (!passage) return toast("Ce passage n’est plus disponible.", "error");
    openGenealogyContribution();
    $("genealogyContributionType").value = "proof";
    $("genealogyContributionTitleField").value = `Preuve — ${passage.lineLabel || `passage ${Number(passageProofButton.dataset.genealogyPassage) + 1}`}`;
    $("genealogyContributionTarget").value = "";
    $("genealogyContributionPayload").value = JSON.stringify({
      factId: "", factType: "", personIds: [], documentId: transcriptionData.documentId || sourceData.documentId || "",
      pageId: transcriptionData.pageId || activeGenealogyPageId || "", passageId: passage.id,
      transcriptionRevisionId: revision?.id || sourceData.revisionId || "",
      sourceValue: null, relation: "supports", citationIt: passage.textIt || "", citationFr: passage.translationFr || null
    }, null, 2);
    return;
  }
  if (!zoomButton) return;
  genealogyZoom = zoomButton.dataset.genealogyZoom === "reset" ? 1
    : Math.min(3, Math.max(1, genealogyZoom + (zoomButton.dataset.genealogyZoom === "in" ? .25 : -.25)));
  const image = $("genealogyPageImage");
  if (image) image.style.transform = `scale(${genealogyZoom})`;
});
$("genealogyContributionForm").addEventListener("submit", event => runSafely(() => saveGenealogyContribution(event), "Enregistrement de proposition impossible"));
$("genealogyProposeBtn").onclick = () => openGenealogyContribution();
$("genealogyOfficialBtn").onclick = () => openGenealogyContribution({ official: true });
$("genealogyProposeProofForPersonBtn").onclick = () => {
  const personId = $("personId").value;
  if (!personId) return;
  openGenealogyContribution();
  $("genealogyContributionType").value = "proof";
  $("genealogyContributionTitleField").value = `Preuve — ${nameOf(personId)}`;
  $("genealogyContributionPayload").value = JSON.stringify({
    factId: "", factType: "", personIds: [personId], documentId: "", pageId: null, passageId: null,
    transcriptionRevisionId: null, sourceValue: null, relation: "supports", citationIt: null, citationFr: null
  }, null, 2);
};
syncSearchClearBtn("genealogySearch", "clearGenealogySearchBtn");
$("clearGenealogySearchBtn").onclick = () => {
  $("genealogySearch").value = "";
  $("genealogySearch").dispatchEvent(new Event("input"));
  $("genealogySearch").focus();
};
syncSearchClearBtn("documentSearch", "clearDocumentSearchBtn");
$("clearDocumentSearchBtn").onclick = () => {
  $("documentSearch").value = "";
  $("documentSearch").dispatchEvent(new Event("input"));
  $("documentSearch").focus();
};
$("clearDirectorySearchBtn").onclick = () => {
  $("directorySearch").value = "";
  $("directorySearch").dispatchEvent(new Event("input"));
  $("directorySearch").focus();
};
$("clearTaskSearchBtn").onclick = () => {
  $("taskSearch").value = "";
  $("taskSearch").dispatchEvent(new Event("input"));
  $("taskSearch").focus();
};
syncSearchClearBtn("directorySearch", "clearDirectorySearchBtn");
syncSearchClearBtn("taskSearch", "clearTaskSearchBtn");
$("documentViewerDialog").addEventListener("close", () => {
  if (!activeViewerUrl) return;
  URL.revokeObjectURL(activeViewerUrl);
  activeViewerUrl = "";
  $("viewerFrame").removeAttribute("src");
  $("viewerImage").removeAttribute("src");
  $("viewerExternalBtn").removeAttribute("href");
  $("viewerExternalBtn").hidden = true;
});
$("addTaskBtn").onclick = () => openTask();
$("taskForm").addEventListener("submit", saveTask);
$("deleteTaskBtn").onclick = () => runSafely(removeTask, "Suppression de l’action impossible");
["taskSearch", "taskStatusFilter", "taskAssigneeFilter", "taskDueFilter"].forEach(id => {
  $(id).addEventListener(id === "taskSearch" ? "input" : "change", () => {
    renderTasks();
  });
});
$("myTasksFilter").addEventListener("click", () => {
  const active = $("myTasksFilter").getAttribute("aria-pressed") === "true";
  $("myTasksFilter").setAttribute("aria-pressed", String(!active));
  $("myTasksFilter").classList.toggle("is-active", !active);
  renderTasks();
});
$("addDossierBtn").onclick = () => openDossierForm();
$("dossierForm").addEventListener("submit", saveDossier);
$("deleteDossierBtn").onclick = () => runSafely(removeDossier, "Suppression de la démarche impossible");
$("editDossierBtn").onclick = () => {
  const item = procedures.find(value => value.id === activeDossierId);
  if (item) openDossierForm(item);
};
$("procedureDetailDialog").addEventListener("close", closeProcedureActionUnsub);
$("proceduresList").addEventListener("click", event => {
  const emptyAdd = event.target.closest("[data-empty-add-dossier]");
  if (emptyAdd) return openDossierForm();
  const tile = event.target.closest(".procedure-item[data-procedure-card]");
  if (!tile || event.target.closest("button, a, input, select, textarea, summary, .tile-context-actions")) return;
  preparePrimaryTileActivation(event, tile, $("procedureDetailDialog"));
  openProcedureDetail(tile.dataset.procedureCard);
});
$("proceduresList").addEventListener("keydown", event => {
  const tile = event.target.closest(".procedure-item[data-procedure-card][tabindex='0']");
  if (!tile || event.target !== tile || !["Enter", " "].includes(event.key)) return;
  pendingPrimaryTilePointer = null;
  primaryTileFocusReturn.delete($("procedureDetailDialog"));
  event.preventDefault();
  openProcedureDetail(tile.dataset.procedureCard);
});
$("addActionBtn").onclick = () => openProcedureAction();
$("procedureActionForm").addEventListener("submit", saveProcedureAction);
$("deleteProcedureActionBtn").onclick = () => runSafely(() => removeProcedureAction($("procedureActionId").value), "Suppression de l’action impossible");
$("procedureActionType").addEventListener("change", syncProcedureActionEmailFields);
$("procedureTimeline").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit-procedure-action]");
  if (edit) return openProcedureAction(procedureActionsCache.find(action => action.id === edit.dataset.editProcedureAction));
  const del = event.target.closest("[data-remove-procedure-action]");
  if (del) return removeProcedureAction(del.dataset.removeProcedureAction);
  const toggle = event.target.closest("[data-toggle-email-action]");
  if (toggle) return toggleEmailFullBlock(toggle.dataset.toggleEmailAction);
});
$("clearDossierSearchBtn").onclick = () => {
  $("dossierSearch").value = "";
  $("dossierSearch").dispatchEvent(new Event("input"));
  $("dossierSearch").focus();
};
syncSearchClearBtn("dossierSearch", "clearDossierSearchBtn");
["dossierSearch", "dossierTypeFilter", "dossierStatusFilter"].forEach(id => {
  $(id).addEventListener(id === "dossierSearch" ? "input" : "change", renderProcedures);
});
const directoryFilterFields = [
  "directorySearch", "directoryFirstNameFilter", "directoryMarriedNameFilter",
  "directoryGenderFilter", "directoryBirthPlaceFilter", "directoryBirthYearFromFilter",
  "directoryBirthYearToFilter", "directoryDeathPlaceFilter", "directoryDeathYearFromFilter",
  "directoryDeathYearToFilter", "directoryDeathInfoFilter"
];
const directoryYearFields = ["directoryBirthYearFromFilter", "directoryBirthYearToFilter", "directoryDeathYearFromFilter", "directoryDeathYearToFilter"];
directoryFilterFields.forEach(id => {
  const field = $(id);
  if (!field) return;
  field.addEventListener("input", () => {
    if (directoryYearFields.includes(id)) field.value = field.value.replace(/\D/g, "").slice(0, 4);
    renderDirectory();
  });
});
function closeDirectoryFilterDialog() {
  const dialog = $("directoryFilterDialog");
  if (dialog.open) dialog.close();
}
$("directoryFiltersBtn").onclick = () => {
  const dialog = $("directoryFilterDialog");
  if (dialog.open) {
    closeDirectoryFilterDialog();
    return;
  }
  $("directoryFiltersBtn").focus({ preventScroll: true });
  dialog.showModal();
  $("directoryFiltersBtn").setAttribute("aria-expanded", "true");
};
$("closeDirectoryFiltersBtn").onclick = closeDirectoryFilterDialog;
$("directoryFilterDialog").addEventListener("close", () => {
  $("directoryFiltersBtn").setAttribute("aria-expanded", "false");
  $("directoryFiltersBtn").focus({ preventScroll: true });
});
$("directoryGenderFilter").addEventListener("change", renderDirectory);
$("directoryDeathInfoFilter").addEventListener("change", renderDirectory);
$("directoryBranchFilter").addEventListener("change", renderDirectory);
$("directoryTreeFilter").addEventListener("change", renderDirectory);
$("directorySort").addEventListener("change", () => {
  saveDirectorySort($("directorySort").value);
  renderDirectory();
});
$("clearDirectoryFiltersBtn").onclick = () => {
  ["directoryFirstNameFilter", "directoryMarriedNameFilter", "directoryBirthPlaceFilter",
   "directoryBirthYearFromFilter", "directoryBirthYearToFilter", "directoryDeathPlaceFilter",
   "directoryDeathYearFromFilter", "directoryDeathYearToFilter"].forEach(id => $(id).value = "");
  $("directoryGenderFilter").value = "";
  $("directoryDeathInfoFilter").value = "";
  $("directoryBranchFilter").value = "";
  $("directoryTreeFilter").value = "all";
  renderDirectory();
};
$("applyDirectoryFiltersBtn").onclick = () => {
  closeDirectoryFilterDialog();
};
document.querySelector(".brand")?.addEventListener("click", event => {
  event.preventDefault();
  setView("tree");
});
document.querySelectorAll("[data-switch] [data-mode]").forEach(button => {
  button.onclick = () => setContentMode(button.closest("[data-switch]").dataset.switch, button.dataset.mode);
});
applyDirectoryViewPreference();
if (typeof directoryViewViewport.addEventListener === "function") {
  directoryViewViewport.addEventListener("change", applyDirectoryViewPreference);
} else {
  directoryViewViewport.addListener(applyDirectoryViewPreference);
}
for (const section of ["documents", "tasks"]) setContentMode(section, viewModes[section] || "cards", false);
document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => setView(button.dataset.view));

$("exportBtn").onclick = exportCompleteBackup;
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = event => {
  const file = event.target.files?.[0];
  if (file) restoreCompleteBackup(file);
};
