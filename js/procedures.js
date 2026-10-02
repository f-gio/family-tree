/* Définitions centralisées de la section Démarches : types de démarche,
   statuts de dossier, types d'action de la chronologie, sens envoyé/reçu
   et seuil minimal de la recherche de personnes du multiselect.
   Ces listes sont la source unique partagée par les formulaires, filtres
   et affichages — elles ne doivent jamais être dupliquées.
   Module pur : ne doit pas toucher à document/window à l'import. */

export const PROCEDURE_TYPES = {
  research: "Recherche généalogique",
  correspondence: "Correspondance",
  appointment: "Rendez-vous",
  administrative: "Démarche administrative",
  archive: "Consultation d’archives",
  call: "Appel",
  online: "Recherche en ligne",
  other: "Autre"
};

export const PROCEDURE_STATUSES = {
  prepare: "À préparer",
  progress: "En cours",
  waiting: "En attente",
  reply: "Réponse reçue",
  appointment: "Rendez-vous prévu",
  done: "Terminé",
  abandoned: "Abandonné"
};

export const PROCEDURE_ACTION_TYPES = {
  "email-sent": "Email envoyé",
  "email-received": "Email reçu",
  "appointment-requested": "Rendez-vous demandé",
  "appointment-confirmed": "Rendez-vous confirmé",
  call: "Appel",
  "archive-visit": "Visite d’archives",
  "registry-consult": "Consultation de registre",
  "online-search": "Recherche en ligne",
  note: "Note",
  "document-sent": "Document envoyé",
  "document-received": "Document reçu",
  other: "Autre"
};

export const ACTION_DIRECTIONS = {
  none: "Non pertinent",
  sent: "Envoyé",
  received: "Reçu"
};

const CLOSED_STATUSES = new Set(["done", "abandoned"]);

function labelOf(definitions, value) {
  return Object.prototype.hasOwnProperty.call(definitions, value) ? value : "";
}

export function procedureTypeLabel(value) {
  return PROCEDURE_TYPES[labelOf(PROCEDURE_TYPES, value)] || PROCEDURE_TYPES.other;
}

export function procedureStatusLabel(value) {
  return PROCEDURE_STATUSES[labelOf(PROCEDURE_STATUSES, value)] || PROCEDURE_STATUSES.prepare;
}

export function procedureActionTypeLabel(value) {
  return PROCEDURE_ACTION_TYPES[labelOf(PROCEDURE_ACTION_TYPES, value)] || PROCEDURE_ACTION_TYPES.other;
}

export function actionDirectionLabel(value) {
  return ACTION_DIRECTIONS[labelOf(ACTION_DIRECTIONS, value)] || ACTION_DIRECTIONS.none;
}

export const DOSSIER_MIN_QUERY_LENGTH = 2;

export function isProcedureClosed(status = "") {
  return CLOSED_STATUSES.has(status);
}

/* Regroupe les valeurs texte utilisées pour la recherche insensible aux
   accents : titre, organisme, contact et noms des personnes liées.
   La chaîne est minimisée et désaccentée (même logique que `searchable`
   côté app) pour que toute requête utilisateur la retrouve. */
export function procedureSearchText(item, nameOf = value => value) {
  return [
    item.title,
    item.objective,
    item.organization,
    item.service,
    item.contactName,
    item.email,
    item.place,
    item.nextAction,
    item.result,
    (item.personIds || []).map(nameOf)
  ].filter(Boolean).join(" ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/* Filtrage + tri déterministe des dossiers :
   1. dossiers ouverts avant ceux terminés ou abandonnés ;
   2. dans chaque groupe, du plus récent au plus ancien selon updatedAtSort
      (millisecondes fournies par l'app, 0 en l'absence de date) ;
   3. titre en ordre alphabétique français pour départager les ex æquo. */
export function filterAndSortProcedures(items = [], filters = {}, queryText = "", nameOf = value => value) {
  const { type = "", status = "" } = filters;
  return items
    .filter(item => (!type || item.type === type) && (!status || item.status === status))
    .filter(item => !queryText || procedureSearchText(item, nameOf).includes(queryText))
    .sort((a, b) =>
      (isProcedureClosed(a.status) - isProcedureClosed(b.status))
      || (b.updatedAtSort || 0) - (a.updatedAtSort || 0)
      || String(a.title || "").localeCompare(String(b.title || ""), "fr", { sensitivity: "base" }));
}

/* Ordre chronologique déterministe d'une chronologie :
   1. date de l'action (chaîne AAAA-MM-JJ, les sans-date en derniers) ;
   2. millisecondes de création fournies par l'app (createdAtSort, 0 défaut) ;
   3. titre pour départager deux créations équivalentes. */
export function sortProcedureActions(actions = []) {
  return [...actions].sort((a, b) => {
    const dateA = a.date || "9999-99-99";
    const dateB = b.date || "9999-99-99";
    const byDate = dateA.localeCompare(dateB);
    if (byDate !== 0) return byDate;
    const byCreation = (a.createdAtSort || 0) - (b.createdAtSort || 0);
    if (byCreation !== 0) return byCreation;
    return String(a.title || "").localeCompare(String(b.title || ""), "fr", { sensitivity: "base" });
  });
}
