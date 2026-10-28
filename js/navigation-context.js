/* Contexte de navigation commun (lot A — sécurisation de la navigation).
   Magasin léger, par clé, du contexte à restaurer au retour d'une vue :
   filtres, position de défilement, origine d'un élément consulté. Aucune
   dépendance DOM, aucune écriture de modèle de données, aucune URL : la pose
   dans l'historique du navigateur reste gérée par app.js. */

export const GENEALOGY_VIEW_CONTEXT_KEY = "genealogy";

export function createNavigationContextStore() {
  const contexts = new Map();
  return {
    save(key, context = {}) {
      contexts.set(String(key), { ...context });
    },
    load(key) {
      const stored = contexts.get(String(key));
      return stored ? { ...stored } : null;
    },
    has(key) {
      return contexts.has(String(key));
    },
    clear(key) {
      if (key === undefined) contexts.clear();
      else contexts.delete(String(key));
    }
  };
}
