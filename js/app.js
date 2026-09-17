import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, onAuthStateChanged, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, deleteField, doc, getDoc, setDoc, onSnapshot, serverTimestamp, writeBatch, runTransaction, Bytes } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { calculateTreeLayout } from "./tree-layout.js";
import { calculateTreeLayout as calculateHybridTreeLayout, validateLayout as validateHybridLayout } from "./tree-layout-engine.js";
import { createTreeRenderer } from "./tree-renderer.js";
import { createTreeCamera } from "./tree-camera.js";
import { computeBranchView, DEFAULT_ANCESTOR_DEPTH, ALL_ANCESTORS } from "./tree-branch-view.js";
import { documentDisplayLabel } from "./document-utils.js";
import { directoryPersonName, formatDirectoryDate, filterAndSortDirectory } from "./directory-utils.js";
import { normalizeGenealogyDate, formatGenealogyDate, genealogyDateSearchText } from "./genealogy-date.js";
import { RELATION_TYPE_LABELS, END_TYPE_LABELS, FILIATION_TYPE_LABELS, normalizeRelationType, normalizeEndType, normalizeFiliationType, normalizedParentChildLinks, parentChildLinkType } from "./family-relations.js";
import { icon, emptyState, setButtonPending, withButtonPending } from "./ui-components.js";
import { createLocationAutocomplete, geoNamesEndpointFromDocument, geoNamesUsernameFromDocument } from "./location-autocomplete.js";
import { formatCompactPlace } from "./place-format.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJEcONT97K3y0MqsiPORRjWfNj8XZGfM8",
  authDomain: "family-tree-c2fe2.firebaseapp.com",
  projectId: "family-tree-c2fe2",
  messagingSenderId: "1096091899254",
  appId: "1:1096091899254:web:4afff8d04448409d969657"
};

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const refs = {
  people: collection(db, "people"),
  families: collection(db, "families"),
  documents: collection(db, "documents"),
  tasks: collection(db, "tasks"),
  users: collection(db, "users")
};

let people = [], families = [], documents = [], tasks = [];
let activeId = null, currentLayout = null, automaticPositions = new Map();
let personDialogSource = "tree";
let cameraPositioned = false, focusAfterRender = null;
let branchView = null;
let loadedPeople = false, loadedFamilies = false, loadedDocuments = false, loadedTasks = false;
let unsubs = [];
let profileUnsub = null, adminUsersUnsub = null, activeDataUid = "";
let currentUserProfile = null, primaryAdminUid = "", adminUsersCache = [], currentProfilePhoto = "";
let manualOffsets = readOffsets();
let treeLayoutEngine = "hybrid";
let activeViewerUrl = "";
let activePersonSection = "identity";
let documentReturnContext = null;
let familyDetailsReturnContext = null;
const FILE_CHUNK_BYTES = 700 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PERSON_PHOTO_BYTES = 5 * 1024;
const viewModes = readViewModes();
const personFields = ["firstName", "middleName", "lastName", "marriedName", "gender", "branch", "place", "deathPlace", "photoUrl", "notes"];
const taskFields = ["title", "status", "priority", "assignee", "dueDate", "personId", "description", "comments"];
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

function saveOffsets() {
  localStorage.setItem("familyTreeManualOffsets", JSON.stringify(manualOffsets));
}

function esc(value = "") {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

function searchable(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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

function formatBytes(value = 0) {
  if (!value) return "0 Ko";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
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
  if (persist) localStorage.setItem("familyTreeViewModes", JSON.stringify(viewModes));
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

function person(id) { return people.find(item => item.id === id); }
function treePeople() { return people.filter(item => item.inTree !== false); }
function nameOf(id) {
  const item = person(id);
  return item ? [item.firstName, item.middleName, item.lastName].filter(Boolean).join(" ") : "Personne supprimée";
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

function currentTreeScope() {
  const basePeople = treePeople();
  if (branchView && basePeople.some(item => item.id === branchView.personId)) {
    try {
      return computeBranchView({ people: basePeople, families, rootId: branchView.personId, ancestorDepth: branchView.ancestorDepth });
    } catch (error) {
      console.error(error);
      branchView = null;
    }
  } else if (branchView) {
    branchView = null;
  }
  return { people: basePeople, families, hiddenAncestorCounts: new Map(), rootId: null };
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

function renderTree() {
  if (!loadedPeople || !loadedFamilies) return;
  const scope = currentTreeScope();
  currentLayout = applyManualPositions(computeTreeLayout(scope));
  renderer.render(scope.people, currentLayout);
  renderer.setActive(activeId);
  camera.setBounds(currentLayout.bounds);
  if (!cameraPositioned) {
    camera.recenter();
    cameraPositioned = true;
  }
  if (focusAfterRender && currentLayout.positions.has(focusAfterRender)) {
    camera.focus(currentLayout.positions.get(focusAfterRender));
    focusAfterRender = null;
  }
  applySearch(false);
  updateBranchBanner(scope);
}

function activateBranchView(personId) {
  const item = person(personId);
  if (!item) return;
  const depth = branchView && branchView.ancestorDepth ? branchView.ancestorDepth : DEFAULT_ANCESTOR_DEPTH;
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
  if (loadedPeople && loadedFamilies && loadedDocuments && loadedTasks) {
    $("syncDot").classList.add("ok");
    $("syncText").textContent = "Synchronisé avec Firebase";
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
}

function applySearch(focus = true) {
  const query = searchable($("search").value);
  const matches = query ? treePeople().filter(item => searchable(`${item.firstName} ${item.middleName || ""} ${item.lastName} ${item.marriedName || ""} ${item.place || ""} ${item.branch || ""} ${genealogyDateSearchText(item.birthDateInfo, item.birthDate)} ${genealogyDateSearchText(item.deathDateInfo, item.deathDate)}`).includes(query)) : [];
  renderer.setHighlights(matches.map(item => item.id));
  if (focus && matches[0] && currentLayout?.positions.has(matches[0].id)) camera.focus(currentLayout.positions.get(matches[0].id));
}

function renderPersonDocuments(personId) {
  const linked = documents.filter(item => (item.personIds || []).includes(personId));
  $("personDocumentsList").innerHTML = linked.length
    ? linked.map(item => `<div class="mini-doc"><span class="mini-doc-info"><strong>${esc(documentDisplayLabel(item))}</strong><span>${esc(item.type || item.fileName || "Document")}</span></span><span class="mini-doc-actions"><button class="btn small" type="button" data-view-document="${item.id}">${icon("eye")}<span>Consulter</span></button><button class="btn small" type="button" data-edit-person-document="${item.id}">${icon("edit")}<span>Modifier</span></button></span></div>`).join("")
    : emptyState({ iconName: "document", title: "Aucun document associé", description: "Les documents ajoutés pour cette personne apparaîtront ici." });
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
  if (hasPerson && normalized === "relations") renderRelations();
  if (hasPerson && normalized === "documents") renderPersonDocuments($("personId").value);
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

function openPerson(item = null, source = "tree") {
  personDialogSource = source;
  activeId = item?.id || null;
  renderer.setActive(activeId);
  $("dialogTitle").textContent = item ? "Modifier la personne" : "Ajouter une personne";
  $("savePersonBtn").textContent = item ? "Enregistrer" : "Enregistrer et ajouter ses liens";
  $("deleteBtn").hidden = !item;
  $("viewBranchBtn").hidden = !item;
  setActionLabel($("deleteBtn"), source === "directory" ? "Supprimer définitivement" : "Retirer de l’arbre", source === "directory" ? "trash" : "unlink");
  $("restoreTreeBtn").hidden = !item || item.inTree !== false || source !== "directory";
  $("personId").value = item?.id || "";
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

function openManualLink() {
  if (people.length < 2) return toast("Ajoutez au moins deux personnes", "info");
  const options = availableOptions();
  $("manualChild").innerHTML = options;
  $("manualParent1").innerHTML = options;
  $("manualParent2").innerHTML = options;
  $("manualLinkForm").reset();
  $("manualLinkDialog").showModal();
}

async function saveManualLink(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  const childId = $("manualChild").value;
  const parentIds = [...new Set([$("manualParent1").value, $("manualParent2").value].filter(Boolean))];
  try {
    await withButtonPending(submitButton, async () => {
      const linkTypes = { [$("manualParent1").value]: $("manualParent1Type").value };
      if ($("manualParent2").value) linkTypes[$("manualParent2").value] = $("manualParent2Type").value;
      await linkChildToParents(childId, parentIds, "", linkTypes);
    });
    focusAfterRender = childId;
    close("manualLinkDialog");
    toast("Lien parent-enfant créé");
  } catch (error) { toast(error.message || "Lien impossible", "error"); }
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
  const filters = {
    query: $("directorySearch").value,
    name: $("directoryNameFilter").value,
    place: $("directoryPlaceFilter").value,
    birthYear: $("directoryBirthFilter").value,
    deathYear: $("directoryDeathFilter").value,
    branch: $("directoryBranchFilter").value,
    sort: $("directorySort").value
  };
  const filtered = filterAndSortDirectory(people, filters);
  const activeFilterCount = [filters.name, filters.place, filters.birthYear, filters.deathYear, filters.branch].filter(Boolean).length;
  $("directoryFilterCount").textContent = activeFilterCount;
  $("directoryFilterCount").hidden = !activeFilterCount;
  $("directoryResultCount").textContent = `${filtered.length} personne${filtered.length > 1 ? "s" : ""}`;
  renderDirectoryAlphabet(filtered);
  $("directoryList").innerHTML = filtered.length ? filtered.map(item => {
    const avatar = item.photoUrl ? `<img src="${esc(item.photoUrl)}" alt="">` : personInitials(item);
    const presence = item.inTree === false ? '<span class="badge muted directory-presence">Masquée de l’arbre</span>' : "";
    const documentCount = documents.filter(documentItem => (documentItem.personIds || []).includes(item.id)).length;
    const documentAction = documentCount
      ? `<button class="directory-action directory-doc-action" type="button" data-directory-documents="${item.id}" aria-label="Afficher ${documentCount} document${documentCount > 1 ? "s" : ""} associé${documentCount > 1 ? "s" : ""} à ${esc(directoryDisplayName(item))}">${icon("document")}<span>${documentCount} document${documentCount > 1 ? "s" : ""}</span></button>`
      : `<span class="directory-action directory-doc-action" aria-label="Aucun document associé">${icon("document")}<span>0 document</span></span>`;
    const middleName = item.middleName ? `<span class="person-middle-name">${esc(item.middleName)}</span>` : "";
    return `<article class="directory-entry" data-letter="${surnameLetter(item)}" data-directory-person="${item.id}" tabindex="0" aria-label="Ouvrir la fiche de ${esc(directoryDisplayName(item))}"><span class="directory-avatar">${avatar}</span><div class="directory-main"><h3><span class="directory-surname">${esc(item.lastName || "—")}</span> <span class="directory-first-name">${esc(item.firstName || "")}</span>${middleName}</h3><p class="directory-life"><span><span class="directory-life-symbol" aria-hidden="true">✦</span> ${esc(formatDirectoryDate(item.birthDateInfo, item.birthDate))}</span><span class="directory-life-divider" aria-hidden="true">—</span><span><span class="directory-life-symbol" aria-hidden="true">†</span> ${esc(formatDirectoryDate(item.deathDateInfo, item.deathDate))}</span></p>${presence}</div><div class="directory-entry-actions">${documentAction}<button class="directory-action directory-open-action" type="button" data-directory-open-person="${item.id}" aria-label="Voir la fiche de ${esc(directoryDisplayName(item))}" title="Voir la fiche">${icon("arrow-right")}</button></div></article>`;
  }).join("") : (people.length
    ? emptyState({ iconName: "people", title: "Aucune personne trouvée", description: "Modifiez la recherche ou retirez un filtre pour afficher d’autres résultats." })
    : emptyState({ iconName: "people", title: "Votre annuaire est vide", description: "Ajoutez une première personne pour commencer votre histoire familiale.", action: `<button class="btn primary" type="button" data-empty-add-person>${icon("plus")}<span>Ajouter une personne</span></button>` }));
  setContentMode("directory", viewModes.directory || "list", false);
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

function documentPeopleMarkup(selectedIds = []) {
  const selected = new Set(selectedIds);
  return people.slice().sort(comparePeopleBySurname).map(item =>
    `<label><input type="checkbox" value="${item.id}" ${selected.has(item.id) ? "checked" : ""}> ${esc(relationOptionName(item))}</label>`
  ).join("") || emptyState({ iconName: "people", title: "Aucune personne disponible", description: "Ajoutez une personne avant de lui associer ce document." });
}

function openDocument(item = null, preselectedPersonId = "", returnContext = null) {
  documentReturnContext = returnContext;
  $("documentForm").reset();
  $("documentId").value = item?.id || "";
  $("documentDialogTitle").textContent = item ? "Modifier le document" : "Ajouter un document";
  $("documentTitle").value = item?.title || "";
  $("documentType").value = item?.type || "";
  $("documentDate").value = item?.date || "";
  setLocationField("documentPlace", item?.place || "", item?.placeInfo);
  $("documentUrl").value = item?.externalUrl || "";
  $("documentNotes").value = item?.notes || "";
  $("documentPeople").innerHTML = documentPeopleMarkup(item?.personIds || (preselectedPersonId ? [preselectedPersonId] : []));
  $("currentDocumentFile").textContent = item?.fileName
    ? `Fichier actuel : ${item.fileName}${item.storedSize ? ` · ${formatBytes(item.storedSize)} stockés${item.compressed ? " après optimisation" : ""}` : ""}`
    : "Images optimisées automatiquement en haute qualité ; PDF conservés sans perte. Taille maximale : 20 Mo.";
  $("documentProgress").textContent = "";
  $("deleteDocumentBtn").hidden = !item;
  $("documentDialog").showModal();
}

function renderDocuments() {
  const query = searchable($("documentSearch").value);
  const type = $("documentTypeFilter").value;
  const filtered = documents.filter(item => (!type || item.type === type) && (!query || searchable(`${documentDisplayLabel(item)} ${item.fileName || ""} ${item.type || ""} ${item.place || ""} ${(item.personIds || []).map(nameOf).join(" ")}`).includes(query)));
  $("documentsList").innerHTML = filtered.length ? filtered.map(item => {
    const compactPlace = formatCompactPlace(item.place, item.placeInfo);
    return `<article class="content-card"><div><span class="badge">${esc(item.type || "Document")}</span><h3>${esc(documentDisplayLabel(item))}</h3></div><p class="card-meta">${item.date ? esc(new Date(item.date + "T12:00:00").toLocaleDateString("fr-FR")) : "Date non renseignée"}${compactPlace ? ` · ${esc(compactPlace)}` : ""}</p><div><p>${(item.personIds || []).length ? `Associé à : ${esc(item.personIds.map(nameOf).join(", "))}` : "Aucune personne associée"}</p>${item.notes ? `<p class="card-description">${esc(item.notes)}</p>` : ""}${item.storedSize ? `<p class="list-optional">Fichier optimisé : ${formatBytes(item.storedSize)}</p>` : ""}</div><div class="card-actions">${item.chunkCount || item.fileData || item.fileUrl || item.externalUrl ? `<button class="btn small primary" type="button" data-open-document="${item.id}">${icon("eye")}<span>Consulter</span></button>` : ""}<button class="btn small" type="button" data-edit-document="${item.id}">${icon("edit")}<span>Modifier</span></button></div></article>`;
  }).join("") : (documents.length
    ? emptyState({ iconName: "document", title: "Aucun document trouvé", description: "Modifiez la recherche ou le type de document sélectionné." })
    : emptyState({ iconName: "document", title: "Aucun document", description: "Centralisez ici les actes, photos et autres archives familiales.", action: `<button class="btn primary" type="button" data-empty-add-document>${icon("plus")}<span>Ajouter un document</span></button>` }));
  setContentMode("documents", viewModes.documents || "cards", false);
  if (activeId && $("personDialog").open) renderPersonDocuments(activeId);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
  return doc(db, "documentChunks", `${documentId}_${version}_${String(index).padStart(4, "0")}`);
}

async function writeFileChunks(documentId, version, fileBlob) {
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());
  const count = Math.ceil(bytes.length / FILE_CHUNK_BYTES);
  let written = 0;
  try {
    for (let index = 0; index < count; index++) {
      const part = bytes.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
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
  if (snapshots.some(snapshot => !snapshot.exists())) throw new Error("Un bloc du fichier est introuvable");
  const parts = snapshots.map(snapshot => {
    const data = snapshot.data().data;
    return typeof data === "string" ? base64ToBytes(data) : data.toUint8Array();
  });
  return new Blob(parts, { type: item.mimeType || "application/octet-stream" });
}

async function documentBlob(item) {
  if (item.chunkCount && item.chunkVersion) return readChunkedFile(item);
  if (item.fileData) return fetch(item.fileData).then(response => response.blob());
  if (item.fileUrl) return fetch(item.fileUrl).then(response => response.blob());
  return null;
}

async function zipLibrary() {
  const module = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  return module.default || module;
}

function exportableRecord(item) {
  return JSON.parse(JSON.stringify(item));
}

function importedData(item) {
  const { id, createdAt, updatedAt, backupFile, ...data } = item || {};
  return { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}

function safeBackupName(value = "document") {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "document";
}

function isValidStoredDate(value) {
  if (value == null) return true;
  if (!value || typeof value !== "object" || !["exact", "year", "about", "between", "unknown"].includes(value.type)) return false;
  if (value.type === "unknown") return true;
  const normalized = normalizeGenealogyDate(value);
  return normalized.type === value.type;
}

function validateFamilyDataset(personRecords = [], familyRecords = []) {
  const personIds = new Set();
  for (const item of personRecords) {
    if (!item?.id || item.id.includes("/") || personIds.has(item.id)) throw new Error("La sauvegarde contient un identifiant de personne invalide ou dupliqué");
    personIds.add(item.id);
    if (!isValidStoredDate(item.birthDateInfo) || !isValidStoredDate(item.deathDateInfo)) throw new Error(`La fiche ${item.id} contient une date généalogique invalide`);
  }
  const familyIds = new Set();
  const childHomes = new Map();
  const childrenByParent = new Map();
  for (const family of familyRecords) {
    if (!family?.id || family.id.includes("/") || familyIds.has(family.id)) throw new Error("La sauvegarde contient un identifiant de foyer invalide ou dupliqué");
    familyIds.add(family.id);
    const parentIds = Array.isArray(family.partnerIds) ? [...new Set(family.partnerIds)] : [];
    const childIds = Array.isArray(family.childIds) ? [...new Set(family.childIds)] : [];
    if (!parentIds.length || parentIds.length > 2 || parentIds.length !== (family.partnerIds || []).length || childIds.length !== (family.childIds || []).length) throw new Error(`Le foyer ${family.id} contient des liens invalides`);
    if ([...parentIds, ...childIds].some(id => !personIds.has(id))) throw new Error(`Le foyer ${family.id} fait référence à une personne absente`);
    if (parentIds.some(id => childIds.includes(id))) throw new Error(`Le foyer ${family.id} place une personne parmi ses propres parents`);
    if (family.relationType != null && !Object.prototype.hasOwnProperty.call(RELATION_TYPE_LABELS, family.relationType)) throw new Error(`Le foyer ${family.id} contient un type de relation invalide`);
    if (family.endType != null && !Object.prototype.hasOwnProperty.call(END_TYPE_LABELS, family.endType)) throw new Error(`Le foyer ${family.id} contient une fin de relation invalide`);
    if (!isValidStoredDate(family.unionDateInfo) || !isValidStoredDate(family.endDateInfo)) throw new Error(`Le foyer ${family.id} contient une date généalogique invalide`);
    if (family.parentChildLinks != null) {
      if (!Array.isArray(family.parentChildLinks)) throw new Error(`Le foyer ${family.id} contient des filiations invalides`);
      const seenLinks = new Set();
      for (const link of family.parentChildLinks) {
        const key = `${link?.parentId}:${link?.childId}`;
        if (!parentIds.includes(link?.parentId) || !childIds.includes(link?.childId) || !Object.prototype.hasOwnProperty.call(FILIATION_TYPE_LABELS, link?.type) || seenLinks.has(key)) throw new Error(`Le foyer ${family.id} contient une filiation invalide ou dupliquée`);
        seenLinks.add(key);
      }
    }
    for (const childId of childIds) {
      if (childHomes.has(childId) && childHomes.get(childId) !== family.id) throw new Error("Une personne est rattachée comme enfant à plusieurs foyers");
      childHomes.set(childId, family.id);
      for (const parentId of parentIds) {
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(childId);
      }
    }
  }
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error("La sauvegarde contient une boucle dans les liens parent-enfant");
    if (visited.has(id)) return;
    active.add(id);
    for (const childId of childrenByParent.get(id) || []) visit(childId);
    active.delete(id);
    visited.add(id);
  }
  personIds.forEach(visit);
}

async function exportCompleteBackup() {
  const button = $("exportBtn");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = '… <span class="label">Préparation</span>';
  try {
    const JSZip = await zipLibrary();
    const zip = new JSZip();
    const manifest = {
      format: "family-tree-backup",
      version: 3,
      exportedAt: new Date().toISOString(),
      people: people.map(exportableRecord),
      families: families.map(exportableRecord),
      tasks: tasks.map(exportableRecord),
      documents: []
    };
    for (let index = 0; index < documents.length; index++) {
      const item = exportableRecord(documents[index]);
      button.innerHTML = `… <span class="label">Document ${index + 1}/${documents.length}</span>`;
      const blob = await documentBlob(documents[index]);
      if (blob) {
        item.backupFile = `documents/${item.id}/${safeBackupName(item.fileName || `document-${item.id}`)}`;
        zip.file(item.backupFile, blob);
        delete item.fileData;
        delete item.fileUrl;
        delete item.storagePath;
        delete item.chunkVersion;
        delete item.chunkCount;
      }
      manifest.documents.push(item);
    }
    zip.file("family-tree.json", JSON.stringify(manifest, null, 2));
    button.innerHTML = '… <span class="label">Compression</span>';
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `family-tree-complet-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast(`Sauvegarde complète créée · ${formatBytes(blob.size)}`);
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
  for (let start = 0; start < records.length; start += 400) {
    const batch = writeBatch(db);
    for (const item of records.slice(start, start + 400)) {
      if (!item?.id || item.id.includes("/")) throw new Error(`Identifiant invalide dans ${collectionName}`);
      batch.set(doc(db, collectionName, item.id), importedData(item));
    }
    await batch.commit();
  }
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
    const manifest = JSON.parse(await manifestEntry.async("string"));
    if (manifest.format !== "family-tree-backup" || !Array.isArray(manifest.people) || !Array.isArray(manifest.families)) throw new Error("Format de sauvegarde non reconnu");
    validateFamilyDataset(manifest.people, manifest.families);
    if (!confirm(`Fusionner cette sauvegarde avec les données actuelles ?\n\n${manifest.people.length} personnes · ${manifest.documents?.length || 0} documents · ${manifest.tasks?.length || 0} tâches\n\nLes éléments de même identifiant seront mis à jour. Les autres données actuelles seront conservées.`)) return;

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
      personIds: [...$("documentPeople").querySelectorAll("input:checked")].map(input => input.value),
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
    }
    if (id) await updateDoc(target, data);
    else await setDoc(target, { ...data, createdAt: serverTimestamp() });
    if (file && existing?.chunkVersion) await deleteFileChunks(existing);
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

async function removeDocument() {
  const id = $("documentId").value;
  const item = documents.find(documentItem => documentItem.id === id);
  if (!item || !confirm("Supprimer définitivement ce document ? Le fichier et ses associations aux personnes seront supprimés.")) return;
  await deleteFileChunks(item);
  await deleteDoc(doc(db, "documents", id));
  close("documentDialog");
  toast("Document supprimé");
}

const statusLabels = { todo: "À faire", progress: "En cours", done: "Terminée" };
const priorityLabels = { high: "Haute", medium: "Moyenne", low: "Basse" };

function renderTasks() {
  const query = searchable($("taskSearch").value);
  const status = $("taskStatusFilter").value;
  const priority = $("taskPriorityFilter").value;
  const mine = $("myTasksFilter").checked;
  const email = auth.currentUser?.email?.toLowerCase() || "";
  const filtered = tasks.filter(item =>
    (!status || item.status === status) &&
    (!priority || item.priority === priority) &&
    (!mine || (item.assignee || "").toLowerCase() === email) &&
    (!query || searchable(`${item.title} ${item.description || ""} ${item.comments || ""} ${item.assignee || ""}`).includes(query))
  ).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  $("tasksList").innerHTML = filtered.length ? filtered.map(item => `<article class="content-card status-${item.status || "todo"}"><div><span class="badge priority-${item.priority || "medium"}">Priorité ${priorityLabels[item.priority] || "Moyenne"}</span><h3>${esc(item.title)}</h3></div><p class="card-meta"><strong>${statusLabels[item.status] || "À faire"}</strong>${item.dueDate ? ` · ${esc(new Date(item.dueDate + "T12:00:00").toLocaleDateString("fr-FR"))}` : ""}</p><div><p>Responsable : ${esc(item.assignee || "Non attribuée")}</p>${item.personId ? `<p>Personne : ${esc(nameOf(item.personId))}</p>` : ""}${item.description ? `<p class="card-description">${esc(item.description)}</p>` : ""}${item.comments ? `<p class="card-description"><strong>Commentaires :</strong> ${esc(item.comments)}</p>` : ""}</div><div class="card-actions"><button class="btn small" type="button" data-edit-task="${item.id}">${icon("edit")}<span>Modifier</span></button>${item.status !== "done" ? `<button class="btn small primary" type="button" data-complete-task="${item.id}">${icon("check")}<span>Terminer</span></button>` : ""}</div></article>`).join("") : (tasks.length
    ? emptyState({ iconName: "tasks", title: "Aucune tâche trouvée", description: "Modifiez la recherche ou les filtres pour afficher d’autres tâches." })
    : emptyState({ iconName: "tasks", title: "Aucune tâche", description: "Ajoutez une tâche lorsque vous avez une recherche ou une démarche à suivre.", action: `<button class="btn primary" type="button" data-empty-add-task>${icon("plus")}<span>Ajouter une tâche</span></button>` }));
  setContentMode("tasks", viewModes.tasks || "cards", false);
}

function openTask(item = null) {
  $("taskForm").reset();
  $("taskId").value = item?.id || "";
  $("taskDialogTitle").textContent = item ? "Modifier la tâche" : "Ajouter une tâche";
  $("taskTitle").value = item?.title || "";
  $("taskStatus").value = item?.status || "todo";
  $("taskPriority").value = item?.priority || "medium";
  $("taskAssignee").value = item?.assignee || auth.currentUser?.email || "";
  $("taskDueDate").value = item?.dueDate || "";
  $("taskPersonId").innerHTML = availableOptions();
  $("taskPersonId").value = item?.personId || "";
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
    toast(id ? "Tâche mise à jour" : "Tâche ajoutée");
  }, "Enregistrement de la tâche impossible"));
}

async function removeTask() {
  const id = $("taskId").value;
  if (!id || !confirm("Supprimer définitivement cette tâche ? Cette action ne peut pas être annulée.")) return;
  await deleteDoc(doc(db, "tasks", id));
  close("taskDialog");
  toast("Tâche supprimée");
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
  $("topbar").hidden = true;
  $("appMain").hidden = $("directoryView").hidden = $("documentsView").hidden = $("tasksView").hidden = true;
  if ($("adminDialog").open) $("adminDialog").close();
  if ($("profileDialog").open) $("profileDialog").close();
  if ($("dataDialog").open) $("dataDialog").close();
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
  $("appMain").hidden = view !== "tree";
  $("directoryView").hidden = view !== "directory";
  $("documentsView").hidden = view !== "documents";
  $("tasksView").hidden = view !== "tasks";
  $("addBtn").hidden = view !== "tree";
  $("addLinkBtn").hidden = view !== "tree";
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
  if (view === "tasks") renderTasks();
  if (view === "tree" && !branchView) setTimeout(() => camera.recenter(), 0);
}

function dataError(error) {
  console.error(error);
  ["treeViewport", "directoryList", "documentsList", "tasksList"].forEach(id => setLoadingSurface(id, false));
  $("syncDot").classList.remove("ok");
  $("syncText").textContent = "Accès refusé — publiez les nouvelles règles Firebase";
  $("syncText").closest(".status")?.setAttribute("data-state", "error");
}

function startData() {
  unsubs.forEach(unsub => unsub());
  unsubs = [];
  loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = false;
  ["treeViewport", "directoryList", "documentsList", "tasksList"].forEach(id => setLoadingSurface(id, true));
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
  const saveButton = $("savePersonBtn");
  setButtonPending(saveButton, true);
  const data = Object.fromEntries(personFields.map(key => [key, $(key).value.trim()]));
  data.updatedAt = serverTimestamp();
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
      if (birthDateInfo.type !== "exact") delete createData.birthDate;
      if (deathDateInfo.type !== "exact") delete createData.deathDate;
      const created = await addDoc(refs.people, { ...createData, inTree: true, createdAt: serverTimestamp() });
      people.push({ id: created.id, ...createData, inTree: true });
      activeId = created.id;
      focusAfterRender = created.id;
      $("personId").value = created.id;
      $("dialogTitle").textContent = "Modifier la personne";
      $("savePersonBtn").textContent = "Enregistrer";
      $("savePersonBtn").dataset.idleLabel = "Enregistrer";
      $("savePersonBtn").dataset.idleContent = "Enregistrer";
      $("deleteBtn").hidden = false;
      setActionLabel($("deleteBtn"), personDialogSource === "directory" ? "Supprimer définitivement" : "Retirer de l’arbre", personDialogSource === "directory" ? "trash" : "unlink");
      setPersonSection("relations", true);
      toast("Personne ajoutée — indiquez maintenant ses liens familiaux");
    }
  } catch (error) {
    console.error(error);
    toast(error.message || "Enregistrement impossible", "error");
  } finally {
    setButtonPending(saveButton, false);
  }
});
$("personForm").addEventListener("invalid", () => setPersonSection("identity"), true);

$("deleteBtn").onclick = async () => {
  const id = $("personId").value;
  if (!id) return;
  if (personDialogSource === "tree") {
    if (!confirm("Retirer cette personne de l’arbre ? Sa fiche et ses liens resteront disponibles dans l’annuaire.")) return;
    await updateDoc(doc(db, "people", id), { inTree: false, updatedAt: serverTimestamp() });
    delete manualOffsets[id];
    saveOffsets();
    close("personDialog");
    toast("Personne retirée de l’arbre, fiche conservée dans l’annuaire");
    return;
  }
  if (!confirm("Supprimer définitivement cette personne ? Elle sera aussi retirée de l’arbre et de tous ses liens familiaux.")) return;
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
  close("personDialog");
  toast("Personne supprimée");
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
$("addLinkBtn").onclick = openManualLink;
$("manualLinkForm").addEventListener("submit", saveManualLink);
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
  if (miniDocument) {
    const item = documents.find(value => value.id === miniDocument.dataset.viewDocument);
    openStoredDocument(item);
  }
  const editPersonDocument = event.target.closest("[data-edit-person-document]");
  if (editPersonDocument) {
    const item = documents.find(value => value.id === editPersonDocument.dataset.editPersonDocument);
    const context = activeId ? { personId: activeId, source: personDialogSource, draft: capturePersonDraft() } : null;
    if ($("personDialog").open) $("personDialog").close();
    openDocument(item, "", context);
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!$("accountDropdown").hidden) {
    $("accountDropdown").hidden = true;
    $("accountMenuBtn").setAttribute("aria-expanded", "false");
    $("accountMenuBtn").focus();
  }
  if ($("directoryFilterMenu").open) $("directoryFilterMenu").open = false;
});

$("documentsList").onclick = event => {
  const openButton = event.target.closest("[data-open-document]");
  const editButton = event.target.closest("[data-edit-document]");
  if (openButton) {
    const item = documents.find(value => value.id === openButton.dataset.openDocument);
    openStoredDocument(item);
  }
  if (editButton) openDocument(documents.find(value => value.id === editButton.dataset.editDocument));
};

$("directoryList").addEventListener("click", event => {
  const documentsButton = event.target.closest("[data-directory-documents]");
  if (documentsButton) return openDirectoryDocuments(documentsButton.dataset.directoryDocuments);
  const openButton = event.target.closest("[data-directory-open-person]");
  if (openButton) return openPerson(person(openButton.dataset.directoryOpenPerson), "directory");
  const entry = event.target.closest("[data-directory-person]");
  if (entry) openPerson(person(entry.dataset.directoryPerson), "directory");
});
$("directoryList").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (event.target.closest("button")) return;
  const entry = event.target.closest("[data-directory-person]");
  if (!entry) return;
  event.preventDefault();
  openPerson(person(entry.dataset.directoryPerson), "directory");
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
  const editButton = event.target.closest("[data-edit-task]");
  const completeButton = event.target.closest("[data-complete-task]");
  if (editButton) openTask(tasks.find(value => value.id === editButton.dataset.editTask));
  if (completeButton) await withButtonPending(completeButton, () => runSafely(() => updateDoc(doc(db, "tasks", completeButton.dataset.completeTask), { status: "done", updatedAt: serverTimestamp() }), "Mise à jour de la tâche impossible"), "Mise à jour…");
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
$("search").oninput = () => applySearch(true);
$("resetBtn").onclick = () => { $("search").value = ""; applySearch(false); };
$("zoomOutBtn").onclick = () => camera.zoomBy(1 / 1.2);
$("zoomInBtn").onclick = () => camera.zoomBy(1.2);
$("fitTreeBtn").onclick = () => camera.fit();
$("centerTreeBtn").onclick = () => camera.recenter();
$("autoLayoutBtn").onclick = () => {
  if (Object.keys(manualOffsets).length && !confirm("Réinitialiser toutes les positions manuelles ?")) return;
  manualOffsets = {};
  saveOffsets();
  renderTree();
  camera.fit();
  toast("Disposition automatique restaurée");
};
$("linkDocumentBtn").onclick = () => {
  const personId = activeId;
  if (!personId) return;
  const context = { personId, source: personDialogSource, draft: capturePersonDraft() };
  $("personDialog").close();
  openDocument(null, personId, context);
};
$("addDocumentBtn").onclick = () => openDocument();
$("documentForm").addEventListener("submit", saveDocument);
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
$("deleteTaskBtn").onclick = () => runSafely(removeTask, "Suppression de la tâche impossible");
["taskSearch", "taskStatusFilter", "taskPriorityFilter", "myTasksFilter"].forEach(id => {
  $(id).addEventListener(id === "taskSearch" ? "input" : "change", renderTasks);
});
[$("directorySearch"), $("directoryNameFilter"), $("directoryPlaceFilter"), $("directoryBirthFilter"), $("directoryDeathFilter")].forEach(field => {
  field.addEventListener("input", () => {
    if (["directoryBirthFilter", "directoryDeathFilter"].includes(field.id)) field.value = field.value.replace(/\D/g, "").slice(0, 4);
    renderDirectory();
  });
});
[$("directoryBranchFilter"), $("directorySort")].forEach(field => field.addEventListener("change", renderDirectory));
$("clearDirectoryFiltersBtn").onclick = () => {
  ["directoryNameFilter", "directoryPlaceFilter", "directoryBirthFilter", "directoryDeathFilter"].forEach(id => $(id).value = "");
  $("directoryBranchFilter").value = "";
  $("directoryFilterMenu").open = false;
  renderDirectory();
};
document.querySelectorAll("[data-switch] [data-mode]").forEach(button => {
  button.onclick = () => setContentMode(button.closest("[data-switch]").dataset.switch, button.dataset.mode);
});
setContentMode("directory", viewModes.directory || "list", false);
for (const section of ["documents", "tasks"]) setContentMode(section, viewModes[section] || "cards", false);
document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => setView(button.dataset.view));

$("exportBtn").onclick = exportCompleteBackup;
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = event => {
  const file = event.target.files?.[0];
  if (file) restoreCompleteBackup(file);
};
