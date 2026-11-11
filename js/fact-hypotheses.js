/* Logique métier pure des hypothèses concurrentes de naissance et de décès
   (lot 2C.5-A). Module sans dépendance Firestore ni DOM : testable sous Node.
   Une seule hypothèse retenue par personne et par information ; l'ancre
   d'unicité est portée par people.retainedHypothesis (voir le store). */

import { normalizeGenealogyDate, formatGenealogyDate, genealogyDateYears } from "./genealogy-date.js";
import { formatCompactPlace } from "./place-format.js";

export const FACT_HYPOTHESIS_FIELDS = Object.freeze([
  { key: "birth.date", kind: "date", label: "Date de naissance", shortLabel: "Date" },
  { key: "birth.place", kind: "place", label: "Lieu de naissance", shortLabel: "Lieu" },
  { key: "death.date", kind: "date", label: "Date de décès", shortLabel: "Date" },
  { key: "death.place", kind: "place", label: "Lieu de décès", shortLabel: "Lieu" }
]);
export const FACT_HYPOTHESIS_STATUS = Object.freeze(["retained", "alternative", "rejected", "deleted"]);
export const FACT_HYPOTHESIS_STATUS_LABELS = Object.freeze({
  retained: "Retenue", alternative: "Alternative", rejected: "Écartée", deleted: "Supprimée"
});
export const FACT_HYPOTHESIS_ROLE = Object.freeze(["supports", "contradicts", "context"]);
export const FACT_HYPOTHESIS_ROLE_LABELS = Object.freeze({
  supports: "Appuie", contradicts: "Contredit", context: "Contexte"
});
export const FACT_HYPOTHESIS_OPERATION = Object.freeze([
  "created", "retained", "value-corrected", "rejected", "deleted", "restored", "reexamined", "attestation-updated"
]);
export const FACT_HYPOTHESIS_ANCHOR_KEY = "retainedHypothesis";

export function factHypothesisField(key) {
  return FACT_HYPOTHESIS_FIELDS.find(field => field.key === key) || null;
}

export function factHypothesisFieldsForEvent(eventType) {
  if (eventType === "birth") return ["birth.date", "birth.place"];
  if (eventType === "death") return ["death.date", "death.place"];
  return [];
}

/* ---------- valeurs normalisées (conservation de la précision) ---------- */

export function normalizeFactHypothesisValue(fieldKey, raw) {
  const field = factHypothesisField(fieldKey);
  if (!field) return { ok: false, error: "Champ d’hypothèse inconnu." };
  if (field.kind === "date") {
    /* La précision est conservée telle quelle : exact, year, about, between ;
       unknown reste accepté pour refléter fidèlement une fiche vide. */
    return { ok: true, value: normalizeGenealogyDate(raw ?? {}) };
  }
  const place = String(raw?.place ?? (typeof raw === "string" ? raw : "")).trim();
  const placeInfo = raw?.placeInfo && typeof raw.placeInfo === "object" ? raw.placeInfo : null;
  return { ok: true, value: { place, placeInfo } };
}

export function formatFactHypothesisValue(fieldKey, value) {
  const field = factHypothesisField(fieldKey);
  if (!field) return "—";
  if (field.kind === "date") return formatGenealogyDate(value);
  const place = formatCompactPlace(value?.place || "", value?.placeInfo || null);
  return place && place !== "—" ? place : (value?.place ? String(value.place) : "—");
}

function dateYears(value) {
  const years = genealogyDateYears(value);
  if (!years.length) return null;
  return years.length === 1 ? [years[0], years[0]] : [years[0], years[1]];
}

function normalizedPlaceText(value) {
  return String(value?.place || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

export function factHypothesisValueEqual(fieldKey, left, right) {
  const field = factHypothesisField(fieldKey);
  if (!field || !left || !right) return false;
  if (field.kind === "date") {
    const a = normalizeGenealogyDate(left), b = normalizeGenealogyDate(right);
    if (a.type !== b.type) return false;
    if (a.type === "exact") return a.value === b.value;
    if (a.type === "year" || a.type === "about") return a.year === b.year;
    if (a.type === "between") return a.from === b.from && a.to === b.to;
    return true; /* unknown === unknown */
  }
  const aText = normalizedPlaceText(left), bText = normalizedPlaceText(right);
  if (aText !== bText) return false;
  const aName = left?.placeInfo?.name ?? null, bName = right?.placeInfo?.name ?? null;
  return aName === bName;
}

/* Comparaison sans assimiler une précision à une contradiction :
  1869, 09/1869 et 13/09/1869 partagent la même année → "precision". */
export function compareFactHypothesisValues(fieldKey, left, right) {
  const field = factHypothesisField(fieldKey);
  if (!field || !left || !right) return "conflict";
  if (factHypothesisValueEqual(fieldKey, left, right)) return "identical";
  if (field.kind === "date") {
    const a = dateYears(left), b = dateYears(right);
    if (!a || !b) return "conflict";
    const overlap = Math.max(a[0], b[0]) <= Math.min(a[1], b[1]);
    return overlap ? "precision" : "conflict";
  }
  const aText = normalizedPlaceText(left), bText = normalizedPlaceText(right);
  if (aText && bText && (aText.startsWith(bText) || bText.startsWith(aText))) return "precision";
  return "conflict";
}

export function detectSimilarFactHypotheses(fieldKey, candidate, existing = []) {
  const result = { identical: [], precisions: [], conflicts: [] };
  for (const hypothesis of existing) {
    if (hypothesis.status === "deleted" || hypothesis.fieldKey !== fieldKey) continue;
    const comparison = compareFactHypothesisValues(fieldKey, candidate, hypothesis.value);
    if (comparison === "identical") result.identical.push(hypothesis);
    else if (comparison === "precision") result.precisions.push(hypothesis);
    else result.conflicts.push(hypothesis);
  }
  return result;
}

/* ---------- fiche Personne : lecture et écriture des champs ---------- */

export function personFactValue(fieldKey, record) {
  const field = factHypothesisField(fieldKey);
  if (!field || !record) return null;
  if (field.key === "birth.date") return normalizeGenealogyDate(record.birthDateInfo, record.birthDate);
  if (field.key === "death.date") return normalizeGenealogyDate(record.deathDateInfo, record.deathDate);
  const textKey = field.key === "birth.place" ? "place" : "deathPlace";
  const infoKey = field.key === "birth.place" ? "birthPlaceInfo" : "deathPlaceInfo";
  const place = String(record[textKey] || "").trim();
  const placeInfo = record[infoKey] || null;
  if (!place && !placeInfo) return null;
  return { place, placeInfo };
}

export function personFactValueIsEmpty(fieldKey, record) {
  const value = personFactValue(fieldKey, record);
  if (!value) return true;
  const field = factHypothesisField(fieldKey);
  if (field.kind === "date") return value.type === "unknown";
  return !String(value.place || "").trim() && !value.placeInfo;
}

/* Patch d'écriture du champ côté people : `set` à écrire tel quel,
   `remove` à traduire en deleteField() côté Firestore (miroir legacy). */
export function personFactValuePatch(fieldKey, value) {
  const field = factHypothesisField(fieldKey);
  if (!field) return { set: {}, remove: [] };
  if (field.kind === "date") {
    const date = normalizeGenealogyDate(value ?? {});
    const structuredKey = field.key === "birth.date" ? "birthDateInfo" : "deathDateInfo";
    const legacyKey = field.key === "birth.date" ? "birthDate" : "deathDate";
    return {
      set: { [structuredKey]: date },
      remove: date.type === "exact" ? [] : [legacyKey]
    };
  }
  const textKey = field.key === "birth.place" ? "place" : "deathPlace";
  const infoKey = field.key === "birth.place" ? "birthPlaceInfo" : "deathPlaceInfo";
  const place = String(value?.place || "").trim();
  const patch = { set: { [textKey]: place } };
  if (value?.placeInfo) patch.set[infoKey] = value.placeInfo;
  else patch.remove = [infoKey];
  return patch;
}

/* ---------- ancre d'unicité ---------- */

export function retainedHypothesisAnchor(anchor, fieldKey, hypothesisId) {
  const next = { ...(anchor || {}) };
  if (hypothesisId) next[fieldKey] = hypothesisId;
  else delete next[fieldKey];
  return next;
}

export function replacementJustificationRequired(previousRetainedId, nextHypothesisId) {
  return Boolean(previousRetainedId && previousRetainedId !== nextHypothesisId);
}

/* ---------- transitions de statut ---------- */

const ALLOWED_TRANSITIONS = Object.freeze({
  alternative: ["retained", "rejected", "deleted"],
  rejected: ["retained", "alternative", "deleted"],
  deleted: ["alternative"],
  retained: ["alternative"]
});

export function canTransitionHypothesis(fromStatus, toStatus) {
  if (fromStatus === toStatus && fromStatus !== "deleted") return true; /* mise à jour sur place (valeur, attestations) */
  if (!FACT_HYPOTHESIS_STATUS.includes(fromStatus) || !FACT_HYPOTHESIS_STATUS.includes(toStatus)) return false;
  if (fromStatus === "deleted") return toStatus === "alternative"; /* restauration jamais vers retenue */
  return (ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

/* Validation d'une opération métier avant transaction. */
export function validateHypothesisOperation({
  operation, fromStatus = null, toStatus = null, justification = "",
  previousRetainedId = null, nextHypothesisId = null, fieldKey = ""
}) {
  if (!factHypothesisField(fieldKey)) return { valid: false, error: "Champ d’hypothèse inconnu." };
  if (!FACT_HYPOTHESIS_OPERATION.includes(operation)) return { valid: false, error: "Opération d’hypothèse inconnue." };
  const hasJustification = typeof justification === "string" && justification.trim().length > 0;
  if (operation === "created") {
    if (!FACT_HYPOTHESIS_STATUS.includes(toStatus)) return { valid: false, error: "Statut initial invalide." };
    if (toStatus === "deleted") return { valid: false, error: "Une hypothèse ne peut pas être créée supprimée." };
    if (toStatus === "retained" && previousRetainedId && previousRetainedId !== nextHypothesisId) {
      return { valid: false, error: "Une hypothèse est déjà retenue pour cette information." };
    }
    return { valid: true };
  }
  if (operation === "value-corrected" || operation === "attestation-updated") {
    if (!fromStatus) return { valid: false, error: "Hypothèse introuvable." };
    if (fromStatus === "deleted") return { valid: false, error: "Une hypothèse supprimée ne peut pas être modifiée." };
    if (!canTransitionHypothesis(fromStatus, toStatus || fromStatus)) return { valid: false, error: "Transition de statut interdite." };
    return { valid: true };
  }
  if (!fromStatus) return { valid: false, error: "Hypothèse introuvable." };
  const target = toStatus || fromStatus;
  if (!canTransitionHypothesis(fromStatus, target)) {
    if (fromStatus === "retained" && target === "deleted") {
      return { valid: false, error: "Une hypothèse retenue ne peut pas être supprimée : remplacez-la d’abord." };
    }
    if (fromStatus === "deleted" && target === "retained") {
      return { valid: false, error: "Une hypothèse supprimée se restaure en alternative, jamais directement retenue." };
    }
    return { valid: false, error: "Transition de statut interdite." };
  }
  if (target === "retained" && replacementJustificationRequired(previousRetainedId, nextHypothesisId) && !hasJustification) {
    return { valid: false, error: "La justification est obligatoire lors du remplacement d’une hypothèse retenue." };
  }
  if (operation === "restored" && fromStatus !== "deleted") {
    return { valid: false, error: "Seule une hypothèse supprimée peut être restaurée." };
  }
  if (operation === "reexamined") {
    if (fromStatus !== "rejected" || target !== "alternative") {
      return { valid: false, error: "Seule une hypothèse écartée peut être réexaminée." };
    }
    if (!hasJustification) return { valid: false, error: "La justification est obligatoire pour réexaminer une hypothèse écartée." };
  }
  return { valid: true };
}

/* ---------- compteurs (les supprimées ne gonflent pas) ---------- */

export function countFactHypotheses(hypotheses = [], fieldKeys = null) {
  return hypotheses.filter(hypothesis => {
    if (hypothesis.status === "deleted") return false;
    if (fieldKeys && !fieldKeys.includes(hypothesis.fieldKey)) return false;
    return true;
  }).length;
}

export function countFactHypothesesForEvent(hypotheses = [], eventType) {
  return countFactHypotheses(hypotheses, factHypothesisFieldsForEvent(eventType));
}

export function activeFactHypotheses(hypotheses = [], fieldKeys = null) {
  return hypotheses.filter(hypothesis => {
    if (hypothesis.status === "deleted") return false;
    if (fieldKeys && !fieldKeys.includes(hypothesis.fieldKey)) return false;
    return true;
  });
}

/* ---------- détection d'incohérences fiche ↔ ancre ↔ hypothèses ----------
   Utilisée par l'interface et par la prévisualisation de restauration. */
export function detectFactHypothesisConflicts({ peopleRecords = [], hypotheses = [] } = {}) {
  const issues = [];
  const peopleById = new Map(peopleRecords.map(record => [record.id, record]));
  const hypothesisById = new Map(hypotheses.map(hypothesis => [hypothesis.id, hypothesis]));
  for (const record of peopleRecords) {
    const anchor = record[FACT_HYPOTHESIS_ANCHOR_KEY];
    if (!anchor || typeof anchor !== "object") continue;
    for (const [fieldKey, hypothesisId] of Object.entries(anchor)) {
      const hypothesis = hypothesisById.get(hypothesisId);
      if (!hypothesis) {
        issues.push({
          code: "FACT_HYPOTHESIS_ANCHOR_DANGLING",
          message: `Ancre orpheline pour ${record.id} (${fieldKey}) : l’hypothèse ${hypothesisId} est introuvable.`
        });
        continue;
      }
      if (hypothesis.status !== "retained") {
        issues.push({
          code: "FACT_HYPOTHESIS_ANCHOR_STATUS",
          message: `L’ancre de ${record.id} (${fieldKey}) pointe une hypothèse au statut « ${FACT_HYPOTHESIS_STATUS_LABELS[hypothesis.status] || hypothesis.status} » et non « Retenue ».` });
        continue;
      }
      const ficheValue = personFactValue(fieldKey, record);
      if (!personFactValueIsEmpty(fieldKey, record) && ficheValue && !factHypothesisValueEqual(fieldKey, ficheValue, hypothesis.value)) {
        issues.push({
          code: "FACT_HYPOTHESIS_VALUE_DIVERGENCE",
          message: `La fiche de ${record.id} (${fieldKey}) affiche « ${formatFactHypothesisValue(fieldKey, ficheValue)} » alors que l’hypothèse retenue indique « ${formatFactHypothesisValue(fieldKey, hypothesis.value)} ».`
        });
      }
    }
  }
  for (const hypothesis of hypotheses) {
    if (hypothesis.status === "retained" && !peopleById.has(hypothesis.personId)) {
      issues.push({
        code: "FACT_HYPOTHESIS_PERSON_MISSING",
        message: `Hypothèse retenue orpheline : la personne ${hypothesis.personId} est introuvable.`
      });
    }
  }
  return issues;
}
