import { unionConnection, unionDateLabel, familyColorIndex } from "./tree-renderer.js";
import { childLineType, normalizeEndType } from "./family-relations.js";
import { formatGenealogyDate } from "./genealogy-date.js";
import { formatCompactPlace } from "./place-format.js";
import { TREE_GEOMETRY } from "./tree-layout.js";

/* Couleurs de la couche présentation reportées en littéral pour que le SVG restitue l'arbre tel qu'affiché (aucune dépendance au DOM/CSS à l'import). */
const COLORS = {
  family: ["#46796b", "#b26842", "#52749a", "#9a7741", "#8a626f", "#66824d"],
  card: "#fffdf8",
  cardBorder: "#ded4c3",
  canvas: "#fbf8f1",
  ink: "#26332e",
  muted: "#68746f",
  soft: "#e8efe9",
  brand: "#284b3f",
  borderSubtle: "#e8dfd0",
  junctionHalo: "#fffdf8",
  middleName: "#7b6655"
};

const CARD_WIDTH = TREE_GEOMETRY.cardWidth;
const CARD_HEIGHT = TREE_GEOMETRY.cardHeight;
export const TREE_EXPORT_RASTER_SCALE = 3;
export const TREE_EXPORT_MAX_EDGE = 8192;
// Limite le bitmap RGBA à environ 128 Mo, même pour un arbre très étendu.
export const TREE_EXPORT_MAX_PIXELS = 32_000_000;

export function treeExportRasterDimensions(width, height) {
  const sourceWidth = Math.ceil(Number(width));
  const sourceHeight = Math.ceil(Number(height));
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 1 || sourceHeight < 1) {
    return { width: 1, height: 1, scale: 1 };
  }

  const scale = Math.min(
    TREE_EXPORT_RASTER_SCALE,
    TREE_EXPORT_MAX_EDGE / sourceWidth,
    TREE_EXPORT_MAX_EDGE / sourceHeight,
    Math.sqrt(TREE_EXPORT_MAX_PIXELS / (sourceWidth * sourceHeight))
  );
  const rasterWidth = Math.max(1, Math.min(TREE_EXPORT_MAX_EDGE, Math.floor(sourceWidth * scale)));
  const rasterHeight = Math.max(1, Math.min(TREE_EXPORT_MAX_EDGE, Math.floor(sourceHeight * scale)));
  return { width: rasterWidth, height: rasterHeight, scale: Math.min(rasterWidth / sourceWidth, rasterHeight / sourceHeight) };
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initials(person) {
  return `${person.firstName?.[0] || ""}${person.lastName?.[0] || ""}`.toUpperCase() || "?";
}

function lifeEventText(icon, dateInfo, legacyDate, place, placeInfo) {
  const dateText = formatGenealogyDate(dateInfo, legacyDate);
  const placeText = formatCompactPlace(place, placeInfo) || "—";
  return { icon, text: `${dateText} · ${placeText}` };
}

function personCardSvg(person, position, photoUrl, marker) {
  const { x, y } = position;
  const parts = [];
  parts.push(`<g>`);
  parts.push(`<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="16" fill="${COLORS.card}" stroke="${COLORS.cardBorder}"/>`);
  const cx = x + 14 + 21;
  const cy = y + 15 + 21;
  parts.push(`<circle cx="${cx}" cy="${cy}" r="21" fill="${COLORS.soft}"/>`);
  if (photoUrl) {
    const cross = /^data:/i.test(photoUrl) ? '' : ' crossorigin="anonymous"';
    parts.push(`<clipPath id="clip-avatar-${person.id}"><circle cx="${cx}" cy="${cy}" r="21"/></clipPath>`);
    parts.push(`<image href="${escapeXml(photoUrl)}" x="${x + 14}" y="${y + 15}" width="42" height="42" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-avatar-${person.id})"${cross}/>`);
  } else {
    parts.push(`<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Georgia, serif" font-size="16" font-weight="700" fill="${COLORS.brand}">${escapeXml(initials(person))}</text>`);
  }
  const nameX = x + 68;
  const firstY = y + 28;
  const firstName = person.firstName || "";
  const middleName = person.middleName || "";
  const surname = person.lastName || "";
  if (firstName) parts.push(`<text x="${nameX}" y="${firstY}" font-family="Georgia, serif" font-size="17" font-weight="700" fill="${COLORS.ink}">${escapeXml(firstName)}</text>`);
  if (middleName) {
    const offset = firstName ? firstName.length * 9.5 + 5 : 0;
    parts.push(`<text x="${nameX + offset}" y="${firstY}" font-family="'Segoe UI', sans-serif" font-size="13" font-style="italic" fill="${COLORS.middleName}">${escapeXml(middleName)}</text>`);
  }
  if (surname) parts.push(`<text x="${nameX}" y="${firstY + 21}" font-family="Georgia, serif" font-size="17" font-weight="700" fill="${COLORS.ink}">${escapeXml(surname)}</text>`);
  const events = [
    lifeEventText("✦", person.birthDateInfo, person.birthDate, person.place, person.birthPlaceInfo),
    lifeEventText("†", person.deathDateInfo, person.deathDate, person.deathPlace, person.deathPlaceInfo)
  ];
  events.forEach((event, eventIndex) => {
    const rowY = firstY + 21 + 4 + eventIndex * 21 + 14;
    parts.push(`<text x="${nameX}" y="${rowY}" font-family="'Segoe UI', sans-serif" font-size="12" fill="${COLORS.muted}">${event.icon === "✦" ? "✦ " : "† "}${escapeXml(event.text)}</text>`);
  });
  if (marker === "focus") {
    const label = "Personne centrale";
    const pillWidth = 100;
    const pillHeight = 18;
    const pillX = x + CARD_WIDTH - 6 - pillWidth;
    const pillY = y + 6;
    parts.push(`<rect x="${pillX}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="9" fill="${COLORS.soft}" stroke="${COLORS.borderSubtle}"/>`);
    parts.push(`<text x="${pillX + pillWidth / 2}" y="${pillY + 12.5}" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="10" font-weight="700" fill="${COLORS.brand}">${escapeXml(label)}</text>`);
  }
  parts.push(`</g>`);
  return parts.join("");
}

function connectionsSvg(layout) {
  const { positions, families, geometry } = layout;
  const parts = [];
  families.forEach((family, familyIndex) => {
    const connection = unionConnection(family, positions, geometry);
    if (!connection) return;
    const color = COLORS.family[familyColorIndex(family, familyIndex)];
    const ended = ["separation", "divorce", "other"].includes(normalizeEndType(family.endType));
    const endedAttrs = ended ? ' stroke-dasharray="15 7" opacity=".78"' : "";
    const strokeLineCap = ' stroke-linecap="round"';
    for (const segment of connection.segments) {
      parts.push(`<line x1="${segment.x1}" y1="${segment.y}" x2="${segment.x2}" y2="${segment.y}" stroke="${color}" stroke-width="4"${strokeLineCap}${endedAttrs}/>`);
    }
    const label = unionDateLabel(family);
    if (label) {
      parts.push(`<text x="${connection.origin.x}" y="${connection.origin.y + 16}" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="12" font-weight="600" fill="${COLORS.muted}" stroke="${COLORS.canvas}" stroke-width="6" paint-order="stroke">${escapeXml(label)}</text>`);
    }
    if (!connection.children.length) return;
    const { origin, busY, bar, children } = connection;
    parts.push(`<path d="M ${origin.x} ${origin.y} V ${busY}" stroke="${color}" stroke-width="2.5"${strokeLineCap}/>`);
    if (bar.maxX - bar.minX > 0.5) parts.push(`<path d="M ${bar.minX} ${busY} H ${bar.maxX}" stroke="${color}" stroke-width="2.5"${strokeLineCap}/>`);
    for (const child of children) {
      const lineType = childLineType(family, child.id);
      const dash = lineType === "adoptive" ? ' stroke-dasharray="10 7"' : lineType === "uncertain" ? ' stroke-dasharray="2 7"' : "";
      parts.push(`<path d="M ${child.x} ${busY} V ${child.y}" stroke="${color}" stroke-width="2.5"${strokeLineCap}${dash}/>`);
    }
    parts.push(`<circle cx="${origin.x}" cy="${origin.y}" r="5" fill="${color}" stroke="${COLORS.junctionHalo}" stroke-width="2"/>`);
    parts.push(`<circle cx="${origin.x}" cy="${busY}" r="4" fill="${color}" stroke="${COLORS.junctionHalo}" stroke-width="2"/>`);
  });
  return parts.join("");
}

/**
 * Vecteur SVG autonome de l'arbre cadré entier, fidèle à la vue courante
 * (positions manuelles incluses, même couleur de famille, mêmes étiquettes).
 * Pure : aucune lecture DOM/Firestore, réutilisable par les tests.
 */
export function treeExportSvg({ people = [], layout = null, markers = new Map(), photoUrls = new Map(), cards = null } = {}) {
  if (!layout) return "";
  const width = Math.ceil(layout.bounds.width);
  const height = Math.ceil(layout.bounds.height);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Segoe UI', ui-sans-serif, system-ui, sans-serif">`);
  parts.push(`<rect width="${width}" height="${height}" fill="${COLORS.canvas}"/>`);
  parts.push(connectionsSvg(layout));
  for (const person of people) {
    const position = layout.positions.get(person.id);
    if (!position) continue;
    if (cards && !cards.has(person.id)) throw new Error("Carte absente du rendu à exporter : actualisez la vue de l’arbre.");
    parts.push(cards ? cards.get(person.id) : personCardSvg(person, position, photoUrls.get(person.id) || "", markers.get(person.id)));
  }
  parts.push(`</svg>`);
  return parts.join("");
}
