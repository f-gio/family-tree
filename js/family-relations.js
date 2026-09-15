export const RELATION_TYPES = Object.freeze(["marriage", "civil", "partner", "other", "unknown"]);
export const RELATION_TYPE_LABELS = Object.freeze({ marriage: "Mariage", civil: "PACS / union civile", partner: "Union libre / partenaire", other: "Autre", unknown: "Non précisé" });
export const END_TYPES = Object.freeze(["none", "separation", "divorce", "other", "unknown"]);
export const END_TYPE_LABELS = Object.freeze({ none: "Toujours en cours / sans fin connue", separation: "Séparation", divorce: "Divorce", other: "Autre", unknown: "Information inconnue" });
export const FILIATION_TYPES = Object.freeze(["biological", "adoptive", "uncertain", "unknown"]);
export const FILIATION_TYPE_LABELS = Object.freeze({ biological: "Biologique", adoptive: "Adoptive", uncertain: "Incertaine", unknown: "Non précisée" });

export function normalizeRelationType(value) { return RELATION_TYPES.includes(value) ? value : "unknown"; }
export function normalizeEndType(value) { return END_TYPES.includes(value) ? value : "none"; }
export function normalizeFiliationType(value) { return FILIATION_TYPES.includes(value) ? value : "unknown"; }

export function normalizedParentChildLinks(family = {}) {
  const partners = [...new Set(Array.isArray(family.partnerIds) ? family.partnerIds : [])];
  const children = [...new Set(Array.isArray(family.childIds) ? family.childIds : [])];
  const stored = Array.isArray(family.parentChildLinks) ? family.parentChildLinks : [];
  return partners.flatMap(parentId => children.map(childId => {
    const match = stored.find(link => link?.parentId === parentId && link?.childId === childId);
    return { parentId, childId, type: normalizeFiliationType(match?.type) };
  }));
}

export function parentChildLinkType(family, parentId, childId) {
  return normalizedParentChildLinks(family).find(link => link.parentId === parentId && link.childId === childId)?.type || "unknown";
}

export function childLineType(family, childId) {
  const types = normalizedParentChildLinks(family).filter(link => link.childId === childId).map(link => link.type);
  if (types.includes("uncertain")) return "uncertain";
  const known = types.filter(type => type !== "unknown");
  return known.length && known.every(type => type === "adoptive") ? "adoptive" : "standard";
}
