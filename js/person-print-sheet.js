/* Fiche individuelle imprimable / PDF — assemblage en lecture seule.
   Extrait de app.js en lot 7 : aucune dépendance à l'état global (les
   jeux de données people/families sont passés en paramètre), aucune
   écriture Firestore, aucun enrichissement legacy. */

import { esc, personInitials, relationRole } from "./ui-components.js";
import { formatGenealogyDate, genealogyDateYears, normalizeGenealogyDate } from "./genealogy-date.js";
import { directoryPersonName } from "./directory-utils.js";
import { RELATION_TYPE_LABELS, END_TYPE_LABELS, FILIATION_TYPE_LABELS, normalizeRelationType, normalizeEndType, parentChildLinkType } from "./family-relations.js";
import { formatCompactPlace } from "./place-format.js";

/* Lieux compact pour la fiche imprimée : réutilise la fonction commune
   (Orino, IT → « Orino (ITA) ») ; texte legacy repris tel quel, jamais enrichi. */
export function printPlaceDetail(text, placeInfo = null) {
  return esc(formatCompactPlace(text, placeInfo));
}

/* Filiation : la biologie / non précisée ne s'imprime pas ; seules les
   indications discrètes « Adoptive » / « Incertaine » sont conservées. */
export function printFiliationLabel(filiationType) {
  if (!["adoptive", "uncertain"].includes(filiationType)) return "";
  return FILIATION_TYPE_LABELS[filiationType];
}

export function printLifeEvent(symbol, title, dateInfo, legacyDate, placeText, placeInfo) {
  const date = formatGenealogyDate(dateInfo, legacyDate);
  const place = printPlaceDetail(placeText, placeInfo);
  return `<div class="print-event"><span class="print-symbol" aria-hidden="true">${esc(symbol)}</span><div><strong>${esc(title)}</strong><span class="print-date">${esc(date)}</span>${place ? `<span class="print-place">${place}</span>` : ""}</div></div>`;
}

export function printLifePeriod(item = {}) {
  const birth = formatGenealogyDate(item.birthDateInfo, item.birthDate);
  const death = formatGenealogyDate(item.deathDateInfo, item.deathDate);
  return `<span class="print-symbol" aria-hidden="true">✦</span> ${esc(birth)} <span class="print-divider" aria-hidden="true">·</span> <span class="print-symbol" aria-hidden="true">†</span> ${esc(death)}`;
}

/* Date de dernière modification : uniquement la donnée réellement enregistrée
   (champ `updatedAt` Firestore). Aucun fallback sur la date actuelle. */
export function printModificationDate(item = {}) {
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
export function printYear(info, legacy = "", position = "first") {
  const years = genealogyDateYears(normalizeGenealogyDate(info, legacy));
  if (!years.length) return "—";
  return String(position === "last" ? Math.max(...years) : Math.min(...years));
}

export function printLifeSpan(item = {}) {
  const birth = printYear(item.birthDateInfo, item.birthDate, "first");
  const death = printYear(item.deathDateInfo, item.deathDate, "last");
  if (birth === "—" && death === "—") return "";
  return `${esc(birth)} <span class="print-divider" aria-hidden="true">—</span> ${esc(death)}`;
}

/* Nom d'affichage généalogique pour l'impression : prénom + second prénom
   (typographie secondaire) + nom de naissance, jamais « Nom Prénom ». */
export function printFullName(item = {}) {
  const middle = item.middleName ? ` <span class="print-middle-name">${esc(item.middleName)}</span>` : "";
  return `${esc(item.firstName || "—")}${middle} ${esc(item.lastName || "")}`.replace(/\s+$/, "");
}

export function buildPersonPrintSheet(item, scope = null, datasets = null) {
  const sourcePeople = scope?.people || datasets?.people || [];
  const sourceFamilies = scope?.families || datasets?.families || [];
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
