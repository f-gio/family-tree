/* Modèle d'URL de navigation (SPA sans routeur) :
   - vues principales  : ?view=tree|directory|documents|genealogy|tasks|dossiers
   - fiches de détail   : ?view=personDetail|documentDetail|sourceDetail|proofDetail&id=<id stable>
   - fiche Démarche    : ?view=dossiers&id=<id de la démarche> (modale sur la liste)
   Module pur : aucune dépendance DOM, aucune écriture d'historique. */

export const MAIN_VIEWS = Object.freeze(["tree", "directory", "documents", "genealogy", "tasks", "dossiers"]);
export const DETAIL_VIEWS = Object.freeze(["personDetail", "documentDetail", "sourceDetail", "proofDetail"]);
export const RESTORABLE_VIEWS = Object.freeze([...MAIN_VIEWS, ...DETAIL_VIEWS]);

/* Vue d'origine affichée quand la fiche demandée est absente ou inaccessible. */
export const DETAIL_BASE_VIEWS = Object.freeze({
  personDetail: "directory",
  documentDetail: "documents",
  sourceDetail: "genealogy",
  proofDetail: "genealogy"
});

/* Identifiant lisible dans l'URL : ni vide, ni trop long, ni caractère de
   contrôle. URLSearchParams encode/decode l'identifiant, jamais concaténé brut. */
function isValidId(value) {
  if (typeof value !== "string" || !value || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

export function detailBaseView(view) {
  return DETAIL_BASE_VIEWS[view] || view;
}

export function isDetailTarget(target = {}) {
  return DETAIL_VIEWS.includes(target.view) || (target.view === "dossiers" && Boolean(target.id));
}

/** Cible complète lue dans l'URL : une fiche sans identifiant valide dégénère
    vers sa vue d'origine (pas de fiche fantôme à réouvrir). */
export function readNavigationTarget(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const view = params.get("view");
  const rawId = params.get("id");
  const id = isValidId(rawId) ? rawId : "";
  if (DETAIL_VIEWS.includes(view)) return id ? { view, id } : { view: detailBaseView(view), id: "" };
  if (view === "dossiers") return { view, id };
  if (MAIN_VIEWS.includes(view)) return { view, id: "" };
  return { view: "tree", id: "" };
}

export function readRestorableView(search = "") {
  return readNavigationTarget(search).view;
}

/** URL relative canonique pour une vue (et son identifiant de fiche éventuel). */
export function navigationUrl(locationLike, view, id = "") {
  const url = new URL(locationLike.href);
  if (RESTORABLE_VIEWS.includes(view) && view !== "tree") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  const carriesId = view === "dossiers" || DETAIL_VIEWS.includes(view);
  if (carriesId && isValidId(id)) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Décision d'historique, commune à toutes les navigations :
    - URL déjà correcte (retour système, restauration) : rien, jamais d'entrée ;
    - retour/avant du navigateur (locked) : rien, pas d'empilement ;
    - nouvelle vue : entrée Retour/Avancer ;
    - nouvelle fiche sur la même vue : remplacement de l'entrée courante. */
export function historyAction({ currentUrl, nextUrl, mode = "push", viewChanged = true, locked = false } = {}) {
  if (locked || mode === "none") return "none";
  if (!nextUrl || nextUrl === currentUrl) return "none";
  if (mode === "replace" || !viewChanged) return "replace";
  return "push";
}
