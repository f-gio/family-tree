// Mesure le template du renderer existant, à échelle 1, hors écran.
// Le fichier téléchargé ne contient ni DOM HTML ni foreignObject : seulement du SVG.
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const n = value => Math.round(value * 1000) / 1000;

export async function captureTreeExportCards(scene, layout, photoUrls) {
  const doc = scene.ownerDocument;
  await doc.fonts.ready;
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;";
  doc.body.append(host);
  const result = new Map();
  try {
    for (const original of scene.querySelectorAll(".person[data-person-id]")) {
      const id = original.dataset.personId, position = layout.positions.get(id);
      if (!position) continue;
      const card = original.cloneNode(true);
      card.classList.remove("active", "search-match");
      card.style.cssText = "position:relative;left:0;top:0;transform:none;transition:none;animation:none;";
      card.querySelectorAll(".drag-hint, .branch-frontier").forEach(el => el.remove());
      // Les images ont une géométrie CSS fixe : aucune seconde requête réseau.
      card.querySelectorAll("img").forEach(el => el.removeAttribute("src"));
      host.replaceChildren(card);
      const bounds = card.getBoundingClientRect(), style = getComputedStyle(card);
      const w = bounds.width, h = bounds.height, radius = parseFloat(style.borderTopLeftRadius);
      const prefix = `export-card-${result.size}`;
      const rect = el => {
        const b = el.getBoundingClientRect();
        return { x: b.left - bounds.left, y: b.top - bounds.top, w: b.width, h: b.height };
      };
      const defs = [`<clipPath id="${prefix}"><rect width="${n(w)}" height="${n(h)}" rx="${radius}"/></clipPath>`];
      const parts = [];
      const paintBox = el => {
        const b = rect(el), s = getComputedStyle(el), border = parseFloat(s.borderLeftWidth) || 0;
        const r = Math.min(parseFloat(s.borderTopLeftRadius) || 0, b.w / 2, b.h / 2);
        parts.push(`<rect x="${n(b.x + border / 2)}" y="${n(b.y + border / 2)}" width="${n(b.w - border)}" height="${n(b.h - border)}" rx="${r}" fill="${xml(s.backgroundColor)}" stroke="${xml(s.borderLeftColor)}" stroke-width="${border}"/>`);
      };
      paintBox(card);
      const avatar = card.querySelector(".avatar");
      if (avatar) {
        paintBox(avatar);
        const b = rect(avatar), photo = photoUrls.get(id);
        if (photo) {
          defs.push(`<clipPath id="${prefix}-photo"><ellipse cx="${n(b.x+b.w/2)}" cy="${n(b.y+b.h/2)}" rx="${n(b.w/2)}" ry="${n(b.h/2)}"/></clipPath>`);
          parts.push(`<image href="${xml(photo)}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${prefix}-photo)"/>`);
        } else if (avatar.querySelector("img")) {
          const names = [card.querySelector(".person-first-name"), card.querySelector(".person-surname")];
          avatar.textContent = names.map(el => el?.textContent?.[0] || "").join("").toUpperCase() || "?";
        }
      }
      const walker = doc.createTreeWalker(card, 4); // SHOW_TEXT
      let node, index = 0;
      while ((node = walker.nextNode())) {
        const el = node.parentElement;
        if (!node.textContent.trim() || el.closest(".sr-only") || (photoUrls.has(id) && el.closest(".avatar"))) continue;
        const s = getComputedStyle(el);
        if (s.display === "none") continue;
        // Range fournit les retours à la ligne du moteur HTML, pas une estimation
        // par nombre de caractères. Les fragments conservent leur police et couleur.
        const range = doc.createRange(), lines = [];
        let offset = 0;
        for (const char of node.textContent) {
          range.setStart(node, offset); offset += char.length; range.setEnd(node, offset);
          const b = range.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          const y = b.top - bounds.top, x = b.left - bounds.left;
          let line = lines.at(-1);
          if (!line || Math.abs(line.y-y) > 0.5) { line = { x, y, text: "" }; lines.push(line); }
          line.text += char;
        }
        // Reprend uniquement les clips existants de la carte écran.
        let clip = { x:0, y:0, right:w, bottom:h };
        for (let parent = el; parent && parent !== card; parent = parent.parentElement) {
          const ps = getComputedStyle(parent);
          if (/(hidden|clip)/.test(ps.overflowX + ps.overflowY)) {
            const b = rect(parent);
            clip = { x:Math.max(clip.x,b.x), y:Math.max(clip.y,b.y), right:Math.min(clip.right,b.x+b.w), bottom:Math.min(clip.bottom,b.y+b.h) };
          }
        }
        const clipId = `${prefix}-text-${index++}`;
        defs.push(`<clipPath id="${clipId}"><rect x="${n(clip.x)}" y="${n(clip.y)}" width="${n(Math.max(0,clip.right-clip.x))}" height="${n(Math.max(0,clip.bottom-clip.y))}"/></clipPath>`);
        if (el.closest(".card-marker")) paintBox(el.closest(".card-marker"));
        for (const line of lines) {
          parts.push(`<text x="${n(line.x)}" y="${n(line.y)}" dominant-baseline="text-before-edge" xml:space="preserve" font-family="${xml(s.fontFamily)}" font-size="${s.fontSize}" font-weight="${s.fontWeight}" font-style="${s.fontStyle}" letter-spacing="${s.letterSpacing}" fill="${xml(s.color)}" clip-path="url(#${clipId})">${xml(line.text)}</text>`);
        }
      }
      result.set(id, `<g transform="translate(${position.x} ${position.y})"><title>${xml(original.textContent)}</title><defs>${defs.join("")}</defs><g clip-path="url(#${prefix})">${parts.join("")}</g></g>`);
    }
    return result;
  } finally { host.remove(); }
}
