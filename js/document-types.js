/* Types de document : source unique des catégories, des valeurs et du balisage
   des sélecteurs natifs (formulaire de fiche et filtre de la liste). La
   catégorie sert uniquement au regroupement visuel : la valeur sélectionnée est
   le type réel du document, seule celle enregistrée et affichée dans les
   pastilles. Aucune migration n'est déduite de cette liste — les valeurs
   historiques restent lisibles, sélectionnables et filtrables. */

export const DOCUMENT_TYPE_GROUPS = Object.freeze([
  { label: "État civil", values: Object.freeze(["Acte de naissance", "Acte de mariage", "Acte de décès"]) },
  { label: "Registre paroissial", values: Object.freeze(["Baptême", "Mariage religieux", "Sépulture"]) },
  { label: "Document militaire", values: Object.freeze(["Registre matricule", "Livret militaire", "Mobilisation"]) },
  { label: "Recensement", values: Object.freeze(["Registre de population", "État des familles"]) },
  { label: "Document notarial", values: Object.freeze(["Testament", "Succession", "Contrat", "Procuration"]) },
  { label: "Document immobilier", values: Object.freeze(["Transaction immobilière", "Acte de propriété"]) },
  { label: "Document cadastral", values: Object.freeze(["Plan cadastral", "Registre foncier"]) },
  { label: "Document administratif", values: Object.freeze(["Certificat de résidence", "Carte d’identité"]) },
  { label: "Immigration et émigration", values: Object.freeze(["Liste de passagers", "Passeport", "Dossier de naturalisation"]) },
  { label: "Document judiciaire", values: Object.freeze(["Jugement", "Dossier de tribunal"]) },
  { label: "Document professionnel", values: Object.freeze(["Contrat de travail", "Registre professionnel"]) },
  { label: "Document scolaire", values: Object.freeze(["Diplôme", "Registre scolaire"]) },
  { label: "Photographie", values: Object.freeze(["Portrait", "Photographie familiale"]) },
  { label: "Correspondance", values: Object.freeze(["Lettre", "Carte postale"]) },
  { label: "Presse", values: Object.freeze(["Article de journal", "Avis de décès"]) },
  { label: "Carte et plan", values: Object.freeze(["Carte géographique", "Plan historique"]) },
  { label: "Autre", values: Object.freeze(["Autre"]) }
].map(group => Object.freeze(group)));

export const DOCUMENT_TYPE_VALUES = Object.freeze(DOCUMENT_TYPE_GROUPS.flatMap(group => group.values));

export const DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL = "Types historiques";

const DOCUMENT_TYPE_VALUE_SET = new Set(DOCUMENT_TYPE_VALUES);

export function isDocumentTypeValue(value) {
  return DOCUMENT_TYPE_VALUE_SET.has(String(value ?? ""));
}

/** Libellé affiché pour une valeur de type : la valeur elle-même (aucun
    libellé de catégorie ne remplace jamais la valeur sélectionnée). */
export function documentTypeLabel(value) {
  return String(value ?? "");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function groupMarkup(group, selected) {
  const options = group.values
    .map(value => `<option value="${escapeAttribute(value)}"${value === selected ? " selected" : ""}>${escapeAttribute(value)}</option>`)
    .join("");
  return `<optgroup label="${escapeAttribute(group.label)}">${options}</optgroup>`;
}

/**
 * Sélecteur natif du formulaire Document : un menu, des catégories en gras non
 * sélectionnables et leurs valeurs en retrait, plus un repli « Type
 * historique » lorsque la valeur enregistrée n'appartient à aucune catégorie.
 */
export function documentTypeOptionsMarkup(selected = "") {
  const value = String(selected ?? "").trim();
  /* Placeholder natif : visible comme libellé fermé tant que le champ est vide,
     jamais proposé dans la liste déroulante (désactivé et masqué), jamais
     enregistrable (value vide + required sur le select). */
  const placeholder = `<option value="" disabled hidden>Sélectionner…</option>`;
  const groups = DOCUMENT_TYPE_GROUPS.map(group => groupMarkup(group, value)).join("");
  if (!value || isDocumentTypeValue(value)) return `${placeholder}${groups}`;
  return `${placeholder}${groups}<optgroup label="${escapeAttribute(DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL)}"><option value="${escapeAttribute(value)}" selected>${escapeAttribute(value)}</option></optgroup>`;
}

/**
 * Sélecteur natif du filtre de la liste : mêmes catégories et valeurs, plus
 * les valeurs historiques réellement enregistrées mais absentes de la liste
 * (regroupées avant « Autre », qui reste toujours en dernière position).
 */
export function documentTypeFilterOptionsMarkup(historicalValues = []) {
  const placeholder = `<option value="">Tous les types</option>`;
  const historical = [...new Set(historicalValues.map(value => String(value ?? "").trim()).filter(Boolean))]
    .filter(value => !isDocumentTypeValue(value))
    .sort((a, b) => a.localeCompare(b, "fr"));
  const historicalMarkup = historical.length
    ? `<optgroup label="${escapeAttribute(DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL)}">${historical.map(value => `<option value="${escapeAttribute(value)}">${escapeAttribute(value)}</option>`).join("")}</optgroup>`
    : "";
  const groups = DOCUMENT_TYPE_GROUPS.map(group => groupMarkup(group, "")).join("");
  return `${placeholder}${historicalMarkup}${groups}`;
}

/** Types distincts réellement présents dans les documents et absents de la
    liste canonique — conservés pour que le filtre reste opérationnel. */
export function documentTypeHistoricalValues(items = []) {
  return [...new Set(items
    .map(item => String(item?.type ?? "").trim())
    .filter(value => value && !isDocumentTypeValue(value)))];
}
