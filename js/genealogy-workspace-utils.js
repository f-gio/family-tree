const FIRESTORE_READ_ERROR_TYPES = new Map([
  ["permission-denied", "lecture refusée par les règles Firestore"],
  ["unavailable", "service Firestore indisponible ou erreur réseau"],
  ["deadline-exceeded", "délai réseau dépassé"],
  ["network-request-failed", "connexion réseau indisponible"],
  ["failed-precondition", "requête refusée ou index Firestore requis"],
  ["invalid-argument", "requête Firestore invalide"]
]);

export function describeFirestoreReadError(error) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  const description = FIRESTORE_READ_ERROR_TYPES.get(code) || "erreur Firestore";
  return { code: code || "unknown", description };
}

export function configureGenealogyContributionDialog(elements, { official = false, revise = false, type = "source" } = {}) {
  const revision = Boolean(revise);
  const officialMode = Boolean(official || revision);
  const presentation = revision
    ? {
        title: "Réviser une donnée officielle",
        subtitle: "Cette modification créera une nouvelle révision conservée dans l'historique.",
        actionLabel: "Enregistrer la nouvelle révision",
        targetHelp: "Référence existante de la donnée révisée ; elle ne peut pas être remplacée.",
        targetReadOnly: true
      }
    : officialMode && type === "proof"
      ? {
          title: "Créer une preuve",
          subtitle: "La preuve sera enregistrée officiellement avec son événement d’historique.",
          actionLabel: "Créer la preuve",
          targetHelp: "Un identifiant est généré automatiquement si ce champ reste vide.",
          targetReadOnly: false
        }
    : officialMode
      ? {
          title: "Créer une donnée officielle",
          subtitle: "Cette donnée sera enregistrée officiellement avec son historique.",
          actionLabel: "Créer la donnée officielle",
          targetHelp: "Un identifiant est généré automatiquement si ce champ reste vide.",
          targetReadOnly: false
        }
      : {
          title: "Proposer une contribution",
          subtitle: "Préparez une proposition. Vous pourrez la soumettre ensuite à validation.",
          actionLabel: "Enregistrer le brouillon",
          targetHelp: "Référence cible facultative : indiquez l'identifiant de l'élément concerné si vous le connaissez.",
          targetReadOnly: false
        };
  const payloadHelp = ["source", "correction"].includes(type)
    ? "Texte libre accepté pour les sources et corrections."
    : "Données JSON structurées requises pour les transcriptions, preuves et conclusions.";

  elements.title.textContent = presentation.title;
  elements.subtitle.textContent = presentation.subtitle;
  elements.primaryAction.textContent = presentation.actionLabel;
  elements.target.readOnly = presentation.targetReadOnly;
  elements.targetHelp.textContent = presentation.targetHelp;
  elements.payloadHelp.textContent = payloadHelp;
  return { ...presentation, payloadHelp };
}

export function legacyDocumentCardDetails(item = {}, personNames = []) {
  const title = String(item.title || "").trim() || String(item.type || "").trim() || "Document historique";
  const date = typeof item.date === "string" ? item.date.trim() : "";
  const place = typeof item.place === "string" ? item.place.trim() : "";
  const people = [...new Set(personNames.map(name => String(name || "").trim()).filter(Boolean))];
  const notes = typeof item.notes === "string" ? item.notes.trim() : "";
  const fileName = typeof item.fileName === "string" ? item.fileName.trim() : "";
  const mimeType = typeof item.mimeType === "string" ? item.mimeType.toLowerCase() : "";
  const hasPhotograph = mimeType.startsWith("image/") || /\.(?:jpe?g|png|webp|gif|tiff?)$/i.test(fileName);
  return { title, date, place, people, notes, hasPhotograph };
}
