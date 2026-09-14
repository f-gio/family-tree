import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, deleteField, doc, getDoc, setDoc, onSnapshot, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { calculateTreeLayout } from "./tree-layout.js";
import { createTreeRenderer } from "./tree-renderer.js";
import { createTreeCamera } from "./tree-camera.js";

const firebaseConfig = {
  apiKey: "AIzaSyCJEcONT97K3y0MqsiPORRjWfNj8XZGfM8",
  authDomain: "family-tree-c2fe2.firebaseapp.com",
  projectId: "family-tree-c2fe2",
  storageBucket: "family-tree-c2fe2.firebasestorage.app",
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
  tasks: collection(db, "tasks")
};

let people = [], families = [], documents = [], tasks = [];
let activeId = null, currentLayout = null, automaticPositions = new Map();
let cameraPositioned = false, focusAfterRender = null;
let loadedPeople = false, loadedFamilies = false, loadedDocuments = false, loadedTasks = false;
let unsubs = [];
let manualOffsets = readOffsets();
let activeViewerUrl = "";
const FILE_CHUNK_BYTES = 450 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const personFields = ["firstName", "lastName", "gender", "branch", "birthDate", "deathDate", "place", "photoUrl", "notes"];
const taskFields = ["title", "status", "priority", "assignee", "dueDate", "personId", "description", "comments"];

function readOffsets() {
  try { return JSON.parse(localStorage.getItem("familyTreeManualOffsets") || "{}"); }
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

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function person(id) { return people.find(item => item.id === id); }
function nameOf(id) {
  const item = person(id);
  return item ? `${item.firstName} ${item.lastName}` : "Personne supprimée";
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

function renderTree() {
  if (!loadedPeople || !loadedFamilies) return;
  currentLayout = applyManualPositions(calculateTreeLayout(people, families));
  renderer.render(people, currentLayout);
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
}

function syncState() {
  if (loadedPeople && loadedFamilies && loadedDocuments && loadedTasks) {
    $("syncDot").classList.add("ok");
    $("syncText").textContent = "Synchronisé avec Firebase";
  }
  $("peopleCount").textContent = `${people.length} personne${people.length > 1 ? "s" : ""}`;
  $("familyCount").textContent = `${families.length} union${families.length > 1 ? "s" : ""}`;
  renderTree();
}

function applySearch(focus = true) {
  const query = $("search").value.trim().toLowerCase();
  const matches = query ? people.filter(item => `${item.firstName} ${item.lastName} ${item.place || ""} ${item.branch || ""}`.toLowerCase().includes(query)) : [];
  renderer.setHighlights(matches.map(item => item.id));
  if (focus && matches[0] && currentLayout?.positions.has(matches[0].id)) camera.focus(currentLayout.positions.get(matches[0].id));
}

function renderPersonDocuments(personId) {
  const linked = documents.filter(item => (item.personIds || []).includes(personId));
  $("personDocumentsList").innerHTML = linked.length
    ? linked.map(item => `<div class="mini-doc"><span><strong>${esc(item.type)}</strong> · ${esc(item.title)}</span><button class="btn small" type="button" data-view-document="${item.id}">Consulter</button></div>`).join("")
    : '<div class="hint">Aucun document associé.</div>';
}

function openPerson(item = null) {
  activeId = item?.id || null;
  renderer.setActive(activeId);
  $("dialogTitle").textContent = item ? "Modifier la personne" : "Ajouter une personne";
  $("savePersonBtn").textContent = item ? "Enregistrer" : "Enregistrer et ajouter ses liens";
  $("deleteBtn").hidden = !item;
  $("relationsBtn").hidden = !item;
  $("personDocumentsSection").hidden = !item;
  $("personId").value = item?.id || "";
  for (const key of personFields) $(key).value = item?.[key] || "";
  if (item) renderPersonDocuments(item.id);
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
  if ((id === "personDialog" && !$("relationsDialog").open) || id === "relationsDialog") {
    activeId = null;
    renderer.setActive(null);
  }
}

function availableOptions(exclude = []) {
  const excluded = new Set(exclude);
  return '<option value="">Sélectionner…</option>' + people
    .filter(item => !excluded.has(item.id))
    .sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id)))
    .map(item => `<option value="${item.id}">${esc(nameOf(item.id))}</option>`).join("");
}

function openRelations() {
  const item = person(activeId);
  if (!item) return;
  if ($("personDialog").open) $("personDialog").close();
  $("relationsPersonName").textContent = nameOf(item.id);
  renderRelations();
  $("relationsDialog").showModal();
}

function renderRelations() {
  const item = person(activeId);
  if (!item) return;
  const related = families.filter(family => (family.partnerIds || []).includes(item.id) || (family.childIds || []).includes(item.id));
  $("relationsList").innerHTML = related.length ? related.map(family => {
    const isPartner = (family.partnerIds || []).includes(item.id);
    const others = (family.partnerIds || []).filter(id => id !== item.id);
    const children = family.childIds || [];
    if (isPartner) return `<div class="relation-card"><strong>${others.length ? `Union avec ${esc(others.map(nameOf).join(" et "))}` : "Foyer monoparental"}</strong>${others.map(id => `<div class="relation-line"><span>Partenaire : ${esc(nameOf(id))}</span><button class="btn small danger" data-remove-partner="${family.id}" data-person="${id}">Retirer</button></div>`).join("")}${children.map(id => `<div class="relation-line"><span>Enfant : ${esc(nameOf(id))}</span><button class="btn small danger" data-remove-child="${family.id}" data-person="${id}">Retirer</button></div>`).join("") || '<div class="relation-line"><span>Aucun enfant rattaché</span></div>'}</div>`;
    return `<div class="relation-card"><strong>Parents</strong><div class="relation-line"><span>${esc((family.partnerIds || []).map(nameOf).join(" et ") || "Non renseigné")}</span><button class="btn small danger" data-remove-child="${family.id}" data-person="${item.id}">Détacher</button></div></div>`;
  }).join("") : '<div class="empty-relations">Aucun lien familial pour cette personne.</div>';
  const options = availableOptions([item.id]);
  $("partnerSelect").innerHTML = options;
  $("childSelect").innerHTML = options;
  $("parentSelect").innerHTML = options;
  const ownFamilies = families.filter(family => (family.partnerIds || []).includes(item.id));
  $("childFamilySelect").innerHTML = '<option value="new">Nouveau foyer monoparental</option>' + ownFamilies.map(family => {
    const others = (family.partnerIds || []).filter(id => id !== item.id);
    return `<option value="${family.id}">${others.length ? `Union avec ${esc(others.map(nameOf).join(" et "))}` : "Foyer monoparental"}</option>`;
  }).join("");
}

async function addPartner() {
  const other = $("partnerSelect").value;
  if (!other) return toast("Choisissez une personne");
  if (families.some(family => {
    const ids = new Set(family.partnerIds || []);
    return ids.has(activeId) && ids.has(other);
  })) return toast("Cette union existe déjà");
  const single = families.find(family => (family.partnerIds || []).length === 1 && (family.partnerIds || []).includes(activeId));
  if (single) await updateDoc(doc(db, "families", single.id), { partnerIds: [activeId, other], updatedAt: serverTimestamp() });
  else await addDoc(refs.families, { partnerIds: [activeId, other], childIds: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  toast("Partenaire ajouté");
}

async function addChild() {
  const child = $("childSelect").value;
  if (!child) return toast("Choisissez un enfant");
  const familyId = $("childFamilySelect").value;
  if (familyId === "new") await addDoc(refs.families, { partnerIds: [activeId], childIds: [child], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  else {
    const family = families.find(item => item.id === familyId);
    if (!family) return;
    if ((family.partnerIds || []).includes(child)) return toast("Une personne ne peut pas être partenaire et enfant dans le même foyer");
    await updateDoc(doc(db, "families", familyId), { childIds: [...new Set([...(family.childIds || []), child])], updatedAt: serverTimestamp() });
  }
  toast("Enfant rattaché");
}

async function addParent() {
  const parentId = $("parentSelect").value;
  if (!parentId) return toast("Choisissez un parent");
  const family = families.find(item => (item.childIds || []).includes(activeId) && (item.partnerIds || []).length < 2);
  if (family) {
    if ((family.partnerIds || []).includes(parentId)) return toast("Ce parent est déjà rattaché");
    await updateDoc(doc(db, "families", family.id), { partnerIds: [...(family.partnerIds || []), parentId], updatedAt: serverTimestamp() });
  } else {
    await addDoc(refs.families, { partnerIds: [parentId], childIds: [activeId], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  toast("Parent rattaché");
}

async function removeRelation(familyId, personId, type) {
  const family = families.find(item => item.id === familyId);
  if (!family) return;
  const field = type === "partner" ? "partnerIds" : "childIds";
  const next = (family[field] || []).filter(id => id !== personId);
  if (field === "partnerIds" && !next.length) await deleteDoc(doc(db, "families", familyId));
  else await updateDoc(doc(db, "families", familyId), { [field]: next, updatedAt: serverTimestamp() });
  toast("Lien retiré");
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

function openManualLink() {
  if (people.length < 2) return toast("Ajoutez au moins deux personnes");
  const options = availableOptions();
  $("manualChild").innerHTML = options;
  $("manualParent1").innerHTML = options;
  $("manualParent2").innerHTML = options;
  $("manualLinkForm").reset();
  $("manualLinkDialog").showModal();
}

async function saveManualLink(event) {
  event.preventDefault();
  const childId = $("manualChild").value;
  const parentIds = [...new Set([$("manualParent1").value, $("manualParent2").value].filter(Boolean))];
  if (!childId || !parentIds.length) return toast("Choisissez l’enfant et au moins un parent");
  if (parentIds.includes(childId)) return toast("Une personne ne peut pas être son propre parent");
  if (parentIds.some(parentId => ancestorsOf(parentId).has(childId))) return toast("Ce lien créerait une boucle dans l’arbre");

  let family = families.find(item => {
    const current = new Set(item.partnerIds || []);
    return current.size === parentIds.length && parentIds.every(id => current.has(id));
  });
  if (!family && parentIds.length === 1) {
    family = families.find(item => (item.childIds || []).includes(childId) && (item.partnerIds || []).length < 2);
  }
  if (family) {
    const partnerIds = [...new Set([...(family.partnerIds || []), ...parentIds])];
    if (partnerIds.length > 2) return toast("Cet enfant possède déjà deux parents dans ce foyer");
    if ((family.childIds || []).includes(childId) && parentIds.every(id => (family.partnerIds || []).includes(id))) return toast("Ce lien existe déjà");
    await updateDoc(doc(db, "families", family.id), {
      partnerIds,
      childIds: [...new Set([...(family.childIds || []), childId])],
      updatedAt: serverTimestamp()
    });
  } else {
    await addDoc(refs.families, { partnerIds, childIds: [childId], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  focusAfterRender = childId;
  close("manualLinkDialog");
  toast("Lien parent-enfant créé");
}

function documentPeopleMarkup(selectedIds = []) {
  const selected = new Set(selectedIds);
  return people.slice().sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id))).map(item =>
    `<label><input type="checkbox" value="${item.id}" ${selected.has(item.id) ? "checked" : ""}> ${esc(nameOf(item.id))}</label>`
  ).join("") || '<span class="hint">Ajoutez d’abord une personne.</span>';
}

function openDocument(item = null, preselectedPersonId = "") {
  $("documentForm").reset();
  $("documentId").value = item?.id || "";
  $("documentDialogTitle").textContent = item ? "Modifier le document" : "Ajouter un document";
  $("documentTitle").value = item?.title || "";
  $("documentType").value = item?.type || "";
  $("documentDate").value = item?.date || "";
  $("documentPlace").value = item?.place || "";
  $("documentUrl").value = item?.externalUrl || "";
  $("documentNotes").value = item?.notes || "";
  $("documentPeople").innerHTML = documentPeopleMarkup(item?.personIds || (preselectedPersonId ? [preselectedPersonId] : []));
  $("currentDocumentFile").textContent = item?.fileName ? `Fichier actuel : ${item.fileName}` : "PDF et images jusqu’à 20 Mo, enregistrés dans Firestore sans abonnement payant.";
  $("documentProgress").textContent = "";
  $("deleteDocumentBtn").hidden = !item;
  $("documentDialog").showModal();
}

function renderDocuments() {
  const query = $("documentSearch").value.trim().toLowerCase();
  const type = $("documentTypeFilter").value;
  const filtered = documents.filter(item => (!type || item.type === type) && (!query || `${item.title} ${item.type} ${item.place || ""} ${(item.personIds || []).map(nameOf).join(" ")}`.toLowerCase().includes(query)));
  $("documentsList").innerHTML = filtered.length ? filtered.map(item => `<article class="content-card"><span class="badge">${esc(item.type || "Document")}</span><h3>${esc(item.title)}</h3><p>${item.date ? esc(new Date(item.date + "T12:00:00").toLocaleDateString("fr-FR")) : "Date non renseignée"}${item.place ? ` · ${esc(item.place)}` : ""}</p><p>${(item.personIds || []).length ? `Associé à : ${esc(item.personIds.map(nameOf).join(", "))}` : "Aucune personne associée"}</p>${item.notes ? `<p>${esc(item.notes)}</p>` : ""}<div class="card-actions">${item.chunkCount || item.fileData || item.fileUrl || item.externalUrl ? `<button class="btn small primary" data-open-document="${item.id}">Consulter</button>` : ""}<button class="btn small" data-edit-document="${item.id}">Modifier</button></div></article>`).join("") : '<div class="empty-list">Aucun document ne correspond à ces critères.</div>';
  if (activeId && $("personDialog").open) renderPersonDocuments(activeId);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function chunkReference(documentId, version, index) {
  return doc(db, "documentChunks", `${documentId}_${version}_${String(index).padStart(4, "0")}`);
}

async function writeFileChunks(documentId, version, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const count = Math.ceil(bytes.length / FILE_CHUNK_BYTES);
  let written = 0;
  try {
    for (let index = 0; index < count; index++) {
      const part = bytes.subarray(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES);
      await setDoc(chunkReference(documentId, version, index), {
        documentId,
        version,
        index,
        data: bytesToBase64(part)
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
  return new Blob(snapshots.map(snapshot => base64ToBytes(snapshot.data().data)), { type: item.mimeType || "application/octet-stream" });
}

async function openStoredDocument(item) {
  if (!item) return;
  $("viewerTitle").textContent = item.title || item.fileName || "Consulter le document";
  $("viewerSubtitle").textContent = item.fileName || "Aperçu dans Family Tree";
  $("viewerImage").hidden = true;
  $("viewerFrame").hidden = true;
  $("viewerMessage").hidden = false;
  $("viewerMessage").textContent = "Chargement du document…";
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
    toast("Impossible d’ouvrir ce fichier");
  }
}

async function saveDocument(event) {
  event.preventDefault();
  const id = $("documentId").value;
  const existing = documents.find(item => item.id === id);
  const file = $("documentFile").files[0];
  const externalUrl = $("documentUrl").value.trim();
  if (!existing && !file && !externalUrl) return toast("Choisissez un fichier ou indiquez un lien");
  if (file?.size > MAX_FILE_BYTES) return toast("Le fichier dépasse 20 Mo");
  if (file && file.type !== "application/pdf" && !file.type.startsWith("image/")) return toast("Choisissez un PDF ou une image");
  $("saveDocumentBtn").disabled = true;
  let newChunkVersion = "";
  let newChunkCount = 0;
  const target = id ? doc(db, "documents", id) : doc(refs.documents);
  try {
    const data = {
      title: $("documentTitle").value.trim(),
      type: $("documentType").value,
      date: $("documentDate").value,
      place: $("documentPlace").value.trim(),
      notes: $("documentNotes").value.trim(),
      externalUrl,
      personIds: [...$("documentPeople").querySelectorAll("input:checked")].map(input => input.value),
      updatedAt: serverTimestamp()
    };
    if (file) {
      newChunkVersion = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      $("documentProgress").textContent = "Préparation du fichier…";
      newChunkCount = await writeFileChunks(target.id, newChunkVersion, file);
      data.fileName = file.name;
      data.fileSize = file.size;
      data.mimeType = file.type || "application/octet-stream";
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
    toast(id ? "Document mis à jour" : "Document ajouté");
  } catch (error) {
    console.error(error);
    if (newChunkVersion) await deleteFileChunks({ id: target.id, chunkVersion: newChunkVersion, chunkCount: newChunkCount });
    const message = error?.code === "permission-denied"
      ? "Envoi refusé : publiez le nouveau fichier firestore.rules dans Firebase."
      : error?.message || "Enregistrement du document impossible";
    $("documentProgress").textContent = message;
    toast(message);
  } finally {
    $("saveDocumentBtn").disabled = false;
  }
}

async function removeDocument() {
  const id = $("documentId").value;
  const item = documents.find(documentItem => documentItem.id === id);
  if (!item || !confirm("Supprimer ce document ?")) return;
  await deleteFileChunks(item);
  await deleteDoc(doc(db, "documents", id));
  close("documentDialog");
  toast("Document supprimé");
}

const statusLabels = { todo: "À faire", progress: "En cours", done: "Terminée" };
const priorityLabels = { high: "Haute", medium: "Moyenne", low: "Basse" };

function renderTasks() {
  const query = $("taskSearch").value.trim().toLowerCase();
  const status = $("taskStatusFilter").value;
  const priority = $("taskPriorityFilter").value;
  const mine = $("myTasksFilter").checked;
  const email = auth.currentUser?.email?.toLowerCase() || "";
  const filtered = tasks.filter(item =>
    (!status || item.status === status) &&
    (!priority || item.priority === priority) &&
    (!mine || (item.assignee || "").toLowerCase() === email) &&
    (!query || `${item.title} ${item.description || ""} ${item.comments || ""} ${item.assignee || ""}`.toLowerCase().includes(query))
  ).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  $("tasksList").innerHTML = filtered.length ? filtered.map(item => `<article class="content-card status-${item.status || "todo"}"><span class="badge priority-${item.priority || "medium"}">Priorité ${priorityLabels[item.priority] || "Moyenne"}</span><h3>${esc(item.title)}</h3><p><strong>${statusLabels[item.status] || "À faire"}</strong>${item.dueDate ? ` · Échéance ${esc(new Date(item.dueDate + "T12:00:00").toLocaleDateString("fr-FR"))}` : ""}</p><p>Responsable : ${esc(item.assignee || "Non attribuée")}</p>${item.personId ? `<p>Personne : ${esc(nameOf(item.personId))}</p>` : ""}${item.description ? `<p>${esc(item.description)}</p>` : ""}${item.comments ? `<p><strong>Commentaires :</strong> ${esc(item.comments)}</p>` : ""}<div class="card-actions"><button class="btn small" data-edit-task="${item.id}">Modifier</button>${item.status !== "done" ? `<button class="btn small primary" data-complete-task="${item.id}">Terminer</button>` : ""}</div></article>`).join("") : '<div class="empty-list">Aucune tâche ne correspond à ces critères.</div>';
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
  const id = $("taskId").value;
  const data = Object.fromEntries(taskFields.map(key => [key, $("task" + key[0].toUpperCase() + key.slice(1)).value.trim()]));
  data.updatedAt = serverTimestamp();
  if (id) await updateDoc(doc(db, "tasks", id), data);
  else await addDoc(refs.tasks, { ...data, createdAt: serverTimestamp() });
  close("taskDialog");
  toast(id ? "Tâche mise à jour" : "Tâche ajoutée");
}

async function removeTask() {
  const id = $("taskId").value;
  if (!id || !confirm("Supprimer cette tâche ?")) return;
  await deleteDoc(doc(db, "tasks", id));
  close("taskDialog");
  toast("Tâche supprimée");
}

function setView(view) {
  $("appMain").hidden = view !== "tree";
  $("documentsView").hidden = view !== "documents";
  $("tasksView").hidden = view !== "tasks";
  $("addBtn").hidden = view !== "tree";
  $("addLinkBtn").hidden = view !== "tree";
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  if (view === "documents") renderDocuments();
  if (view === "tasks") renderTasks();
  if (view === "tree") setTimeout(() => camera.recenter(), 0);
}

function dataError(error) {
  console.error(error);
  $("syncDot").classList.remove("ok");
  $("syncText").textContent = "Accès refusé — publiez les nouvelles règles Firebase";
}

function startData() {
  unsubs.forEach(unsub => unsub());
  unsubs = [];
  loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = false;
  unsubs.push(onSnapshot(refs.people, snapshot => {
    people = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedPeople = true;
    syncState();
    renderDocuments();
    renderTasks();
  }, dataError));
  unsubs.push(onSnapshot(refs.families, snapshot => {
    families = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedFamilies = true;
    syncState();
    if ($("relationsDialog").open) renderRelations();
  }, dataError));
  unsubs.push(onSnapshot(refs.documents, snapshot => {
    documents = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedDocuments = true;
    syncState();
    renderDocuments();
  }, dataError));
  unsubs.push(onSnapshot(refs.tasks, snapshot => {
    tasks = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    loadedTasks = true;
    syncState();
    renderTasks();
  }, dataError));
}

onAuthStateChanged(auth, user => {
  $("authScreen").hidden = !!user;
  $("topbar").hidden = !user;
  if (user) {
    $("appMain").hidden = false;
    startData();
    setView("tree");
  } else {
    $("appMain").hidden = $("documentsView").hidden = $("tasksView").hidden = true;
    unsubs.forEach(unsub => unsub());
    unsubs = [];
    people = []; families = []; documents = []; tasks = [];
  }
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("authError").textContent = "";
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (error) {
    console.error(error);
    $("authError").textContent = error.code === "auth/invalid-credential" ? "E-mail ou mot de passe incorrect." : "Connexion impossible. Vérifiez Firebase Authentication.";
  } finally {
    $("loginBtn").disabled = false;
  }
});

$("personForm").addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(personFields.map(key => [key, $(key).value.trim()]));
  data.updatedAt = serverTimestamp();
  try {
    const id = $("personId").value;
    if (id) {
      await updateDoc(doc(db, "people", id), data);
      focusAfterRender = id;
      close("personDialog");
      toast("Personne mise à jour");
    } else {
      const created = await addDoc(refs.people, { ...data, createdAt: serverTimestamp() });
      people.push({ id: created.id, ...data });
      activeId = created.id;
      focusAfterRender = created.id;
      $("personDialog").close();
      setTimeout(openRelations, 150);
      toast("Personne ajoutée — indiquez maintenant ses liens familiaux");
    }
  } catch (error) {
    console.error(error);
    toast("Enregistrement impossible");
  }
});

$("deleteBtn").onclick = async () => {
  const id = $("personId").value;
  if (!id || !confirm("Supprimer cette personne et tous ses liens familiaux ?")) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, "people", id));
  for (const family of families) {
    if (!(family.partnerIds || []).includes(id) && !(family.childIds || []).includes(id)) continue;
    const partnerIds = (family.partnerIds || []).filter(value => value !== id);
    const childIds = (family.childIds || []).filter(value => value !== id);
    if (!partnerIds.length) batch.delete(doc(db, "families", family.id));
    else batch.update(doc(db, "families", family.id), { partnerIds, childIds, updatedAt: serverTimestamp() });
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

$("relationsBtn").onclick = openRelations;
$("addLinkBtn").onclick = openManualLink;
$("manualLinkForm").addEventListener("submit", saveManualLink);
$("addPartnerBtn").onclick = addPartner;
$("addChildBtn").onclick = addChild;
$("addParentBtn").onclick = addParent;
$("relationsList").onclick = event => {
  const button = event.target.closest("[data-remove-partner],[data-remove-child]");
  if (!button) return;
  removeRelation(button.dataset.removePartner || button.dataset.removeChild, button.dataset.person, button.dataset.removePartner ? "partner" : "child");
};

document.addEventListener("click", event => {
  const closeButton = event.target.closest("[data-close]");
  if (closeButton) close(closeButton.dataset.close);
  const miniDocument = event.target.closest("[data-view-document]");
  if (miniDocument) {
    const item = documents.find(value => value.id === miniDocument.dataset.viewDocument);
    openStoredDocument(item);
  }
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

$("tasksList").onclick = async event => {
  const editButton = event.target.closest("[data-edit-task]");
  const completeButton = event.target.closest("[data-complete-task]");
  if (editButton) openTask(tasks.find(value => value.id === editButton.dataset.editTask));
  if (completeButton) await updateDoc(doc(db, "tasks", completeButton.dataset.completeTask), { status: "done", updatedAt: serverTimestamp() });
};

$("logoutBtn").onclick = () => signOut(auth);
$("addBtn").onclick = () => openPerson();
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
  $("personDialog").close();
  openDocument(null, personId);
};
$("addDocumentBtn").onclick = () => openDocument();
$("documentForm").addEventListener("submit", saveDocument);
$("deleteDocumentBtn").onclick = removeDocument;
$("documentSearch").oninput = renderDocuments;
$("documentTypeFilter").onchange = renderDocuments;
$("documentViewerDialog").addEventListener("close", () => {
  if (!activeViewerUrl) return;
  URL.revokeObjectURL(activeViewerUrl);
  activeViewerUrl = "";
  $("viewerFrame").removeAttribute("src");
  $("viewerImage").removeAttribute("src");
});
$("addTaskBtn").onclick = () => openTask();
$("taskForm").addEventListener("submit", saveTask);
$("deleteTaskBtn").onclick = removeTask;
["taskSearch", "taskStatusFilter", "taskPriorityFilter", "myTasksFilter"].forEach(id => {
  $(id).addEventListener(id === "taskSearch" ? "input" : "change", renderTasks);
});
document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => setView(button.dataset.view));

$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), people, families, documents, tasks }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `family-tree-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Sauvegarde téléchargée");
};
