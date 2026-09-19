import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium } from "playwright";

import {
  ROOT,
  SHOT_DIR,
  startStaticServer,
  VIEWPORTS,
  blockedServiceFor,
  isAllowedRequest,
  BOOT_WARNING,
  LOGIN_BLOCKED_MESSAGE
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const playwrightVersion = require("playwright/package.json").version;

/* Catégories de viewports (EXÉCUTION 5B) :
   - tactile : mobile/tactile + paysage mobile/tactile → cibles tactiles ~44×44
     pour les contrôles essentiels (objectif réel, non abaissé pour un PASS).
   - desktop : mesures de densité rapportées en informatif (visible, cliquable,
     non chevauchant), aucun FAIL lié à la seule dimension. */
const VIEW_CLASS = Object.freeze({
  "mobile-320": "tactile",
  "mobile-390": "tactile",
  "phablet-560": "tactile",
  "tablet-760": "tactile",
  "landscape-844": "tactile",
  "desktop-1024": "desktop",
  "desktop-1440": "desktop"
});

const TOUCH_MIN = 43.9; // ≈44 px, tolérance d'arrondi subpixel 0.1 px

let failCount = 0;
let checkCount = 0;
const issues = [];
const observations = [];
const perViewport = [];
const blockedServices = new Map();
const unexpectedConsoles = [];
const pageErrors = [];

function check(message, cond, detail = "") {
  checkCount += 1;
  const mark = cond ? "PASS" : "ÉCHEC";
  if (!cond) failCount += 1;
  console.log(`  [${mark}] ${message}${detail ? ` — ${detail}` : ""}`);
  return cond;
}

function reportIssue(viewport, severity, section, detail) {
  issues.push({ viewport, severity, section, detail });
  console.log(`  ⚠ constat [${viewport}] ${severity} — ${section} : ${detail}`);
}

function noteObservation(viewport, section, detail) {
  observations.push(`${viewport} — ${section} : ${detail}`);
  console.log(`  ℹ observation ${viewport} — ${section} : ${detail}`);
}

/* Mesure d'un contrôle tactile : FAIL fonctionnel sur viewport tactile (essentiel),
   écart mineur documenté sur contrôle secondaire tactile, mesure informative desktop. */
function assessTouch({ viewport, label, box, cls, essential = true }) {
  const text = box ? `${Math.round(box.width * 10) / 10}×${Math.round(box.height * 10) / 10}` : "introuvable";
  if (!box) {
    check(`${viewport} · ${label} (élément mesurable)`, false, "introuvable");
    reportIssue(viewport, "bloquant", label, "élément absent du DOM rendu");
    return;
  }
  if (cls === "desktop") {
    check(`${viewport} · ${label} présent et mesurable (densité desktop informatif : ${text} px)`, true);
    noteObservation(viewport, label, `${text} px — densité desktop (souris), rapportée sans FAIL`);
    return;
  }
  /* viewport tactile */
  if (box.width >= TOUCH_MIN && box.height >= TOUCH_MIN) {
    check(`${viewport} · ${label} ≥ ≈44×44 (mesuré ${text} px)`, true);
    return;
  }
  if (essential) {
    check(`${viewport} · ${label} ≥ ≈44×44 (mesuré ${text} px)`, false);
    reportIssue(viewport, "important", label, `mesuré ${text} px — écart à la cible 44 px sur viewport tactile`);
  } else {
    check(`${viewport} · ${label} somme visé ≈44×44 — écart mineur documenté (${text} px)`, true);
    noteObservation(viewport, label, `${text} px — contrôle secondaire tactile : écart à la cible 44 px, documenté, non bloquant`);
  }
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const docW = root.clientWidth;
    const pageScrollW = root.scrollWidth;
    const offenders = [];
    if (pageScrollW > docW + 1) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right <= docW + 1 && r.left >= -1) continue;
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX === "hidden" || cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "clip") {
            clipped = true;
            break;
          }
        }
        if (clipped) continue;
        offenders.push({
          tag: el.tagName,
          id: el.id || "",
          cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50)
        });
      }
      offenders.sort((a, b) => b.right - a.right);
    }
    return { docW, pageScrollW, offenders: offenders.slice(0, 8) };
  });
}

async function boundingBox(page, selector) {
  const locator = page.locator(selector).first();
  if (!(await locator.count())) return null;
  return locator.boundingBox();
}

function boxesOverlap(a, b) {
  if (!a || !b) return false;
  const eps = 0.5;
  return !(a.right <= b.x + eps || b.right <= a.x + eps || a.bottom <= b.y + eps || b.bottom <= a.y + eps);
}

async function resetState(page, baseURL) {
  await page.evaluate(baseURL => {
    const set = (id, hidden) => {
      const el = document.getElementById(id);
      if (el) el.hidden = hidden;
    };
    set("authScreen", false);
    set("loginForm", false);
    set("signupForm", true);
    set("accessStatus", true);
    set("topbar", true);
    set("appMain", true);
    set("directoryView", true);
    set("documentsView", true);
    set("tasksView", true);
    const menu = document.getElementById("directoryFilterMenu");
    if (menu) menu.open = false;
    const list = document.getElementById("directoryList");
    if (list) {
      list.className = "content-grid directory-grid";
      list.innerHTML = "";
    }
    const form = document.getElementById("loginForm");
    if (form) form.reset();
    const error = document.getElementById("authError");
    if (error) error.textContent = "";
    const dialog = document.getElementById("personDialog");
    if (dialog && dialog.open) dialog.close();
    const suggestions = document.getElementById("place-suggestions");
    if (suggestions) {
      suggestions.hidden = true;
      suggestions.textContent = "";
    }
    const status = document.querySelector(".location-autocomplete-status");
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    const search = document.getElementById("directorySearch");
    if (search) search.value = "";
    if (location.href !== baseURL) location.replace(baseURL);
  }, baseURL);
}

async function runViewport(view, page, baseURL) {
  const cls = VIEW_CLASS[view.name] || "tactile";
  const before = { checks: checkCount, failures: failCount };
  const line = `${view.name} (${view.width}×${view.height})`;
  console.log(`\n=== Viewport ${line} — catégorie « ${cls} » ===`);

  await page.setViewportSize({ width: view.width, height: view.height });
  await page.waitForTimeout(120);
  await resetState(page, baseURL);

  /* ---------- Phase A : écran de connexion réel (toute l'app sans auth) ---------- */
  console.log(`  -- A · Écran de connexion (comportement réel) --`);
  const authVisible = await page.locator("#authScreen").isVisible().catch(() => false);
  check(`${line} · écran d'authentification visible`, authVisible);

  const loginVisible = await page.locator("#loginForm").isVisible().catch(() => false);
  check(`${line} · formulaire de connexion visible`, loginVisible);

  const ovAuth = await measureOverflow(page);
  check(`${line} · pas de débordement horizontal de la page à la connexion (doc ${ovAuth.docW}px, scroll ${ovAuth.pageScrollW}px)`, ovAuth.pageScrollW <= ovAuth.docW + 1);
  if (ovAuth.pageScrollW > ovAuth.docW + 1) {
    reportIssue(line, "bloquant", "Écran de connexion", JSON.stringify(ovAuth.offenders.slice(0, 3)));
  }

  const loginBtn = await boundingBox(page, "#loginBtn");
  assessTouch({ viewport: line, label: "bouton « Se connecter »", box: loginBtn, cls, essential: true });

  /* ---------- Phase A′ : paysage 844×390 — test fonctionnel de l'accès au bouton ---------- */
  if (view.name === "landscape-844") {
    console.log(`  -- A′ · Paysage : analyse fonctionnelle de la page de connexion --`);
    const geo = await page.evaluate(() => {
      window.scrollTo(0, 9999);
      document.documentElement.scrollTop = 9999;
      const btn = document.getElementById("loginBtn");
      const authScreen = document.getElementById("authScreen");
      const shellClientH = authScreen.clientHeight;
      const shellScrollH = authScreen.scrollHeight;
      const overflowY = getComputedStyle(authScreen).overflowY;
      const scrollTopAvant = authScreen.scrollTop;
      btn.scrollIntoView({ block: "center" });
      const b = btn.getBoundingClientRect();
      const doc = document.documentElement;
      const vh = window.innerHeight;
      return {
        shellClientH,
        shellScrollH,
        overflowY,
        scrollTopAvant,
        scrollTopApres: authScreen.scrollTop,
        btnTop: Math.round(b.top),
        btnBottom: Math.round(b.bottom),
        btnFullyVisible: b.top >= 0 && b.bottom <= vh && b.left >= 0 && b.right <= window.innerWidth,
        horizontalOk: doc.scrollWidth <= doc.clientWidth + 1
      };
    });
    const authContainerScrollable = geo.shellScrollH > geo.shellClientH + 1 && (geo.overflowY === "auto" || geo.overflowY === "scroll");
    check(`${line} · paysage : l'écran d'authentification contient le débordement et autorise le scroll vertical (rendu : scrollHeight ${geo.shellScrollH}px > clientHeight ${geo.shellClientH}px, overflow-y:${geo.overflowY})`, authContainerScrollable);
    if (!authContainerScrollable) {
      reportIssue(line, "bloquant", "Écran de connexion non défilable (844×390)", `rendu Chromium : scrollHeight ${geo.shellScrollH}px / clientHeight ${geo.shellClientH}px / overflow-y:${geo.overflowY} : le conteneur du formulaire ne permet pas d'atteindre le bas de la carte`);
    }
    check(`${line} · paysage : scrollIntoView fait réellement défiler le conteneur (scrollTop ${geo.scrollTopAvant} → ${geo.scrollTopApres}px)`, geo.scrollTopApres > geo.scrollTopAvant);
    check(`${line} · paysage : bouton « Se connecter » entièrement visible après défilement (top ${geo.btnTop}px, bottom ${geo.btnBottom}px sur 390px de viewport)`, geo.btnFullyVisible);
    if (!geo.btnFullyVisible) {
      reportIssue(line, "bloquant", "Bouton « Se connecter » inaccessible (844×390)", `bottom ${geo.btnBottom}px > viewport 390px ; scrollIntoView sans effet (ancêtre position:fixed non défilable)`);
    }
    check(`${line} · paysage : aucun débordement horizontal`, geo.horizontalOk);
    const clickable = await page.locator("#loginBtn").click({ timeout: 3000, trial: true }).then(() => true, () => false);
    check(`${line} · paysage : clic sur « Se connecter » possible`, clickable);
    if (!clickable) {
      reportIssue(line, "bloquant", "Bouton « Se connecter » insaisissable (844×390)", "essai de clic Playwright impossible (hors viewport, sans défilement possible) — le formulaire n'est pas utilisable intégralement sans clavier");
    }
  }

  /* Interaction réelle simulée hors-ligne : identifiants fictifs, réseau auth bloqué.
     Envoi par touche Entrée dans le champ mot de passe (submit réel du formulaire) :
     déterministe, indépendant de la visibilité du bouton (paysage court). */
  await page.fill("#loginEmail", "sans-acces@example.net");
  await page.fill("#loginPassword", "motdepasse-fictif-123");
  await page.press("#loginPassword", "Enter");
  await page.waitForFunction(() => document.getElementById("authError").textContent.trim().length > 0, null, { timeout: 20000 });
  const errText = await page.textContent("#authError");
  check(
    `${line} · tentative de connexion hors-ligne : message d'erreur déterministe affiché (champs et formulaire accessibles)`,
    errText.includes(LOGIN_BLOCKED_MESSAGE),
    `« ${errText.trim()} »`
  );
  const loginEnabled = await page.isEnabled("#loginBtn");
  check(`${line} · bouton de connexion réactivé après l'échec`, loginEnabled);

  /* ---------- Phase B1 : vue Arbre (coquille réelle) ---------- */
  console.log(`  -- B1 · Vue Arbre (coquille réelle) --`);
  await page.evaluate(() => {
    const set = (id, hidden) => {
      const el = document.getElementById(id);
      if (el) el.hidden = hidden;
    };
    set("authScreen", true);
    set("topbar", false);
    set("appMain", false);
    set("directoryView", true);
  });
  await page.waitForTimeout(60);

  const ovTree = await measureOverflow(page);
  check(`${line} · pas de débordement horizontal de page en vue Arbre (${ovTree.pageScrollW}/${ovTree.docW}px)`, ovTree.pageScrollW <= ovTree.docW + 1);
  if (ovTree.pageScrollW > ovTree.docW + 1) {
    reportIssue(line, "bloquant", "Vue Arbre (débordement page)", JSON.stringify(ovTree.offenders.slice(0, 3)));
  }

  const treeCanvas = await page.evaluate(() => {
    const box = document.getElementById("treeViewport");
    if (!box) return null;
    return { clientW: box.clientWidth, scrollW: box.scrollWidth, cssOverflowX: getComputedStyle(box).overflowX };
  });
  if (treeCanvas && treeCanvas.scrollW > treeCanvas.clientW + 1) {
    noteObservation(line, "Arbre : débordement interne du conteneur", `scrollW ${treeCanvas.scrollW}px > clientW ${treeCanvas.clientW}px (overflow-x: ${treeCanvas.cssOverflowX}, pan/zoom du canvas attendu)`);
  }

  const treeControls = await page.evaluate(() => {
    const selectors = ["#addBtn", "#resetBtn", "#search", "#treeBranchFilter", "#zoomOutBtn", "#zoomInBtn", "#fitTreeBtn", "#centerTreeBtn", "#autoLayoutBtn", "#topbar .nav-btn", "#accountMenuBtn"];
    const out = {};
    for (const sel of selectors) {
      out[sel] = [...document.querySelectorAll(sel)].map(el => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      });
    }
    return out;
  });

  const navBoxes = treeControls["#topbar .nav-btn"];
  const navSample = navBoxes.map(b => `${b.w}×${b.h}`).join(", ") || "aucune";
  if (cls === "desktop") {
    check(`${line} · boutons de navigation présents (${navSample} px, densité desktop informatif)`, navBoxes.length > 0);
    noteObservation(line, "Cibles tactiles de navigation", `${navSample} px — densité desktop, rapportée sans FAIL`);
  } else {
    const navOk = navBoxes.length > 0 && navBoxes.every(b => b.w >= TOUCH_MIN && b.h >= TOUCH_MIN);
    check(`${line} · cibles tactiles de navigation ≥ ≈44×44 (${navSample})`, navOk);
    if (!navOk) reportIssue(line, "important", "Cibles tactiles navigation", JSON.stringify(navBoxes));
  }

  const accountBoxes = treeControls["#accountMenuBtn"];
  const accountSample = accountBoxes.map(b => `${b.w}×${b.h}`).join(", ") || "aucun";
  if (cls === "desktop") {
    check(`${line} · menu compte présent (${accountSample} px, densité desktop informatif)`, accountBoxes.length > 0);
    noteObservation(line, "Cible tactile du menu compte", `${accountSample} px — densité desktop, rapportée sans FAIL`);
  } else {
    const accountOk = accountBoxes.length > 0 && accountBoxes.every(b => b.w >= TOUCH_MIN && b.h >= TOUCH_MIN);
    check(`${line} · menu compte ≥ ≈44×44 (${accountSample})`, accountOk);
    if (!accountOk) reportIssue(line, "important", "Cible tactile du menu compte", JSON.stringify(accountBoxes));
  }

  const branchBoxes = treeControls["#treeBranchFilter"];
  check(`${line} · filtre de branche de l'arbre présent et utilisable (${branchBoxes.map(b => `${b.w}×${b.h}`).join(", ") || "absent"})`, branchBoxes.length > 0 && branchBoxes.every(b => b.h >= 36 && b.w >= 100));

  /* ---------- Phase B1′ : arbre avec généalogie fictive — cadrage initial réel
     et géométrie des contrôles flottants (aucune donnée réelle, aucune écriture) ---------- */
  console.log(`  -- B1′ · Cadrage initial + géométrie des contrôles (données fictives) --`);
  const fictive = await page.evaluate(() => {
    const people = [];
    const families = [];
    const add = id => people.push({ id, firstName: "Personne", lastName: `Fictive ${id}`, birthDateInfo: { type: "year", year: 1805 + people.length * 11 } });
    const unit = (id, partnerIds, childIds) => families.push({ id, partnerIds, childIds, relationType: "marriage" });
    add("p0"); add("p1"); unit("f1", ["p0", "p1"], ["p2", "p3", "p4"]);
    add("p2"); add("p3"); add("p4"); add("p5"); add("p6"); add("p7");
    unit("f2", ["p2", "p5"], ["p8", "p9"]); unit("f3", ["p3", "p6"], ["p10", "p11"]); unit("f4", ["p4", "p7"], ["p12"]);
    add("p8"); add("p9"); add("p10"); add("p11"); add("p12"); add("p13"); add("p14"); add("p15");
    unit("f5", ["p8", "p13"], ["p16", "p17"]); unit("f6", ["p10", "p14"], ["p18", "p19"]); unit("f7", ["p12", "p15"], ["p20"]);
    add("p16"); add("p17"); add("p18"); add("p19"); add("p20"); add("p21"); add("p22"); add("p23");
    unit("f8", ["p16", "p21"], ["p24", "p25"]); unit("f9", ["p18", "p22"], ["p26"]);
    add("p24"); add("p25"); add("p26");
    const result = window.__treeProbe.render(people, families);
    return { state: result.state, bounds: result.layout.bounds, positionCount: result.layout.positions.size };
  });
  check(`${line} · rendu de la généalogie fictive : 27 cartes positionnées`, fictive.positionCount === 27, `${fictive.positionCount} cartes`);

  const frame = await page.evaluate(() => {
    const probe = window.__treeProbe;
    const state = probe.state;
    const layout = probe.layout();
    const vp = probe.viewport();
    const cards = [];
    let minTop = Infinity;
    for (const [id, pos] of layout.positions) {
      minTop = Math.min(minTop, pos.y);
      cards.push({ id, left: vp.rect.x + pos.x * state.scale + state.x, top: vp.rect.y + pos.y * state.scale + state.y, width: pos.width * state.scale, height: pos.height * state.scale });
    }
    return { state, vp, bounds: layout.bounds, cards, minTop };
  });
  const stateFinite = ["scale", "x", "y"].every(key => Number.isFinite(frame.state[key]));
  check(`${line} · cadrage initial : états de caméra finis`, stateFinite, JSON.stringify(frame.state));
  const scaleInLimits = frame.state.scale >= 0.25 - 1e-9 && frame.state.scale <= 2 + 1e-9;
  check(`${line} · cadrage initial : échelle bornée entre 25 % et 200 %`, scaleInLimits, `${Math.round(frame.state.scale * 100)} %`);
  const vpRect = frame.vp.rect;
  const inside = card => card.left < vpRect.x + vpRect.width && card.left + card.width > vpRect.x && card.top < vpRect.y + vpRect.height && card.top + card.height > vpRect.y;
  const readableCard = frame.cards.find(card => inside(card) && card.width >= 120);
  check(`${line} · cadrage initial : au moins une carte lisible dans le viewport (largeur rendue ≥ 120 px)`, Boolean(readableCard), readableCard ? `${readableCard.width.toFixed(0)} px (« ${readableCard.id} »)` : "aucune");
  const expectedRowTop = vpRect.y + frame.minTop * frame.state.scale + frame.state.y;
  const topRowCard = frame.cards.find(card => Math.abs(card.top - expectedRowTop) <= 2 && inside(card));
  check(`${line} · cadrage initial : la première génération (rangée haute) est visible`, Boolean(topRowCard), frame.minTop > 1e9 ? "layout vide" : `rangée à y=${frame.minTop.toFixed(0)} px`);
  const readableFloor = 150 / 282;
  check(`${line} · cadrage initial : échelle au moins aussi lisible que le plancher ≈ 53 % (${Math.round(frame.state.scale * 100)} %)`, frame.state.scale >= readableFloor - 0.05);

  const interaction = await page.evaluate(async () => {
    const probe = window.__treeProbe;
    const click = (id) => document.getElementById(id).click();
    const steps = { s0: probe.state.scale };
    click("zoomInBtn");
    await new Promise(resolve => setTimeout(resolve, 40));
    steps.sIn = probe.state.scale;
    click("zoomOutBtn");
    await new Promise(resolve => setTimeout(resolve, 40));
    steps.sOut = probe.state.scale;
    click("fitTreeBtn");
    await new Promise(resolve => setTimeout(resolve, 40));
    steps.fit = probe.state;
    steps.fitLabel = document.getElementById("zoomLevel").textContent;
    click("centerTreeBtn");
    await new Promise(resolve => setTimeout(resolve, 40));
    steps.center = probe.state;
    return steps;
  });
  check(`${line} · bouton « + » : le zoom augmente (${Math.round(interaction.sIn * 100)} % > ${Math.round(interaction.s0 * 100)} %)`, interaction.sIn > interaction.s0 + 0.001);
  check(`${line} · bouton « − » : retour proche du niveau initial (${Math.round(interaction.sOut * 100)} % ≈ ${Math.round(interaction.s0 * 100)} %)`, Math.abs(interaction.sOut - interaction.s0) < 0.02);
  const fitExpected = Math.min(2, Math.max(0.25, Math.min((frame.vp.width - 128) / frame.bounds.width, (frame.vp.height - 128) / frame.bounds.height)));
  check(`${line} · bouton « Ajuster » : échelle = arbre complet calculé (${Math.round(fitExpected * 100)} %)`, Math.abs(interaction.fit.scale - fitExpected) < 0.02, `${Math.round(interaction.fit.scale * 100)} %`);
  check(`${line} · zoom affiché synchrone (« ${interaction.fitLabel} »)`, interaction.fitLabel === `${Math.round(interaction.fit.scale * 100)} %`);
  const expectCenter = {
    x: (frame.vp.width - frame.bounds.width * interaction.fit.scale) / 2 - frame.bounds.x * interaction.fit.scale,
    y: (frame.vp.height - frame.bounds.height * interaction.fit.scale) / 2 - frame.bounds.y * interaction.fit.scale
  };
  check(`${line} · « Ajuster » centre l'arbre (x ${interaction.fit.x.toFixed(1)}/${expectCenter.x.toFixed(1)}, y ${interaction.fit.y.toFixed(1)}/${expectCenter.y.toFixed(1)})`, Math.abs(interaction.fit.x - expectCenter.x) <= 1.5 && Math.abs(interaction.fit.y - expectCenter.y) <= 1.5);
  check(`${line} · « Recentrer » conserve l'échelle (« Ajuster » puis centrage à zoom inchangé)`, Math.abs(interaction.center.scale - interaction.fit.scale) < 1e-6, `${Math.round(interaction.center.scale * 100)} %`);

  const controls = await page.evaluate(() => window.__treeProbe.controls());
  const moreBtnBox = controls["#treeMoreBtn"];
  const fitBtnBox = controls["#fitTreeBtn"];
  const mobileLayout = Boolean(fitBtnBox) && fitBtnBox.width === 0;
  const zoomBox = controls[".zoom-control"];
  const viewBox = controls[".view-control"];
  const panelBox = controls[".tree-controls"];
  check(`${line} · bouton ⋯ du menu d'actions présent en bas à droite`, Boolean(moreBtnBox) && Boolean(viewBox) && viewBox.x > zoomBox.x, JSON.stringify(controls));
  if (mobileLayout) {
    check(`${line} · mobile (≤760) : Ajuster permanent masqué (⋯ seul en bas à droite)`, Boolean(fitBtnBox) && fitBtnBox.width === 0 && fitBtnBox.height === 0, fitBtnBox ? `fit masqué ${Math.round(fitBtnBox.width)}×${Math.round(fitBtnBox.height)}px` : "Ajuster absent");
    assessTouch({ viewport: line, label: "bouton d'action « ⋯ (menu d'actions) »", box: moreBtnBox, cls, essential: true });
  } else {
    check(`${line} · desktop/paysage : « Ajuster » permanent visible à gauche du bouton ⋯`, Boolean(fitBtnBox) && fitBtnBox.width > 0 && fitBtnBox.x < moreBtnBox.x, fitBtnBox ? `${fitBtnBox.x.toFixed(0)} vs ${moreBtnBox.x.toFixed(0)} px` : "Ajuster absent");
    check(`${line} · desktop/paysage : aucun chevauchement Ajuster ↔ ⋯`, !boxesOverlap(fitBtnBox, moreBtnBox), boxesOverlap(fitBtnBox, moreBtnBox) ? "boîtes intersectées" : `${fitBtnBox.x.toFixed(0)}px..${fitBtnBox.right.toFixed(0)}px / ${moreBtnBox.x.toFixed(0)}px..${moreBtnBox.right.toFixed(0)}px`);
    assessTouch({ viewport: line, label: "bouton d'action « Ajuster »", box: fitBtnBox, cls, essential: true });
    assessTouch({ viewport: line, label: "bouton d'action « ⋯ (menu d'actions) »", box: moreBtnBox, cls, essential: true });
  }
  check(`${line} · zoom compact à gauche, groupe d'actions à droite (coins bas du canvas)`, zoomBox.x < viewBox.x, `${zoomBox.x.toFixed(0)} vs ${viewBox.x.toFixed(0)} px`);
  check(`${line} · le zoom ([+][−]) n'intersecte pas le groupe d'actions (Ajuster/⋯)`, !boxesOverlap(viewBox, zoomBox));
  const panelInViewport = Boolean(panelBox) && panelBox.x >= -1 && panelBox.y >= -1 && panelBox.right <= view.width + 1 && panelBox.bottom <= view.height + 1;
  check(`${line} · panneau de contrôles entièrement dans le viewport (${panelBox ? `${panelBox.x.toFixed(0)},${panelBox.y.toFixed(0)} → ${panelBox.right.toFixed(0)},${panelBox.bottom.toFixed(0)}` : "absent"})`, panelInViewport);
  if (!panelInViewport) reportIssue(line, "bloquant", "Panneau des contrôles arbre hors viewport", JSON.stringify(panelBox));
  const shellRect = frame.vp.rect;
  const panelInCanvas = Boolean(panelBox) && panelBox.x >= shellRect.x - 1 && panelBox.y >= shellRect.y - 1 && panelBox.right <= shellRect.right + 1 && panelBox.bottom <= shellRect.bottom + 1;
  check(`${line} · panneau de contrôles ancré au canvas (dans .tree-shell)`, panelInCanvas);
  const zoomInfo = await page.evaluate(() => {
    const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
    return { in: r("zoomInBtn"), out: r("zoomOutBtn") };
  });
  check(`${line} · zoom vertical compact : « + » au-dessus de « − »`, zoomInfo.in.y < zoomInfo.out.y, `${Math.round(zoomInfo.in.y)} < ${Math.round(zoomInfo.out.y)} px`);
  assessTouch({ viewport: line, label: "bouton « + » du zoom", box: zoomInfo.in, cls, essential: true });
  assessTouch({ viewport: line, label: "bouton « − » du zoom", box: zoomInfo.out, cls, essential: true });

  /* ---------- Phase B1″ : le pourcentage de zoom est un badge temporaire ---------- */
  console.log(`  -- B1″ · Pourcentage : badge temporaire après zoom --`);
  await page.waitForTimeout(1800);
  const badgeAtRest = await page.evaluate(() => {
    const el = document.getElementById("zoomLevel");
    const cs = getComputedStyle(el);
    return { show: el.classList.contains("show"), visibility: cs.visibility, opacity: Number(cs.opacity) };
  });
  check(`${line} · % absent au repos (badge masqué)`, !badgeAtRest.show && badgeAtRest.visibility === "hidden" && badgeAtRest.opacity === 0, JSON.stringify(badgeAtRest));
  const badgeAfterZoom = await page.evaluate(async () => {
    const r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const before = { zoomControl: r(".zoom-control"), zoomIn: r("#zoomInBtn"), zoomOut: r("#zoomOutBtn") };
    document.getElementById("zoomInBtn").click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const el = document.getElementById("zoomLevel");
    const cs = getComputedStyle(el);
    return {
      before,
      after: { zoomControl: r(".zoom-control"), zoomIn: r("#zoomInBtn"), zoomOut: r("#zoomOutBtn"), badge: r(".zoom-level") },
      show: el.classList.contains("show"),
      visibility: cs.visibility,
      text: el.textContent.trim(),
      scaleText: `${Math.round(window.__treeProbe.state.scale * 100)} %`
    };
  });
  check(`${line} · « + » : le % apparaît (badge « ${badgeAfterZoom.text} » synchrone)`, badgeAfterZoom.show && badgeAfterZoom.visibility === "visible" && badgeAfterZoom.text === badgeAfterZoom.scaleText, JSON.stringify({ text: badgeAfterZoom.text, expected: badgeAfterZoom.scaleText }));
  const layoutStable = JSON.stringify(badgeAfterZoom.before) === JSON.stringify({ zoomControl: badgeAfterZoom.after.zoomControl, zoomIn: badgeAfterZoom.after.zoomIn, zoomOut: badgeAfterZoom.after.zoomOut });
  check(`${line} · le badge s'affiche sans déplacer les contrôles de zoom`, layoutStable, JSON.stringify(badgeAfterZoom.after));
  check(`${line} · badge % juste au-dessus du zoom, centré`, badgeAfterZoom.after.badge.bottom <= badgeAfterZoom.after.zoomIn.y + 1 && Math.abs((badgeAfterZoom.after.badge.x + badgeAfterZoom.after.badge.w / 2) - (badgeAfterZoom.after.zoomControl.x + badgeAfterZoom.after.zoomControl.w / 2)) <= 40, JSON.stringify(badgeAfterZoom.after.badge));
  await page.waitForTimeout(1900);
  const badgeGone = await page.evaluate(() => {
    const el = document.getElementById("zoomLevel");
    const cs = getComputedStyle(el);
    return { show: el.classList.contains("show"), visibility: cs.visibility };
  });
  check(`${line} · le % disparaît automatiquement après ~1,5 s`, !badgeGone.show && badgeGone.visibility === "hidden", JSON.stringify(badgeGone));

  /* ---------- Phase B1‴ : menu d'actions de l'arbre (⋯) = Ajuster (mobile) + Recentrer + Réorganiser ---------- */
  console.log(`  -- B1‴ · Menu d'actions de l'arbre (⋯) --`);
  const menuInit = await page.evaluate(() => ({
    hidden: document.getElementById("treeMenu").hidden,
    expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded")
  }));
  check(`${line} · menu d'actions : initialement fermé (aria-expanded="false")`, menuInit.hidden && menuInit.expanded === "false");
  await page.click("#treeMoreBtn");
  await page.waitForTimeout(60);
  const menuOpened = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('#treeMenu [role="menuitem"]')]
      .filter(el => getComputedStyle(el).display !== "none")
      .map(el => (el.querySelector("span")?.textContent || el.getAttribute("aria-label")).trim());
    return {
      hidden: document.getElementById("treeMenu").hidden,
      expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
      items: visible,
      count: visible.length
    };
  });
  const expectedItems = mobileLayout ? ["Ajuster", "Recentrer", "Réorganiser", "Exporter"] : ["Recentrer", "Réorganiser", "Exporter"];
  check(`${line} · clic sur ⋯ : menu ouvert (aria-expanded="true")`, !menuOpened.hidden && menuOpened.expanded === "true", JSON.stringify(menuOpened));
  check(`${line} · menu ${mobileLayout ? "mobile (≤760)" : "desktop/paysage"} : items « ${expectedItems.join(" / ")} » (${menuOpened.count})`, JSON.stringify(menuOpened.items) === JSON.stringify(expectedItems), JSON.stringify(menuOpened.items));
  const menuBoxes = await page.evaluate(() => {
    const out = {};
    for (const id of ["treeMenu", "centerTreeBtn", "autoLayoutBtn", "menuFitBtn"]) {
      const r = document.getElementById(id).getBoundingClientRect();
      out[id] = { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    }
    return out;
  });
  const menuBox = menuBoxes["treeMenu"];
  check(`${line} · menu ouvert au-dessus du bouton ⋯`, Boolean(menuBox && moreBtnBox) && menuBox.bottom <= moreBtnBox.y + 1, menuBox && moreBtnBox ? `bas du menu ${menuBox.bottom.toFixed(0)}px / haut de ⋯ ${moreBtnBox.y.toFixed(0)}px` : "boîtes indisponibles");
  check(`${line} · menu entièrement dans le canvas`, Boolean(menuBox) && menuBox.x >= shellRect.x - 1 && menuBox.y >= shellRect.y - 1 && menuBox.right <= shellRect.right + 1 && menuBox.bottom <= shellRect.bottom + 1, menuBox ? `${menuBox.x.toFixed(0)},${menuBox.y.toFixed(0)} → ${menuBox.right.toFixed(0)},${menuBox.bottom.toFixed(0)}` : "menu absent");
  check(`${line} · menu entièrement dans le viewport`, Boolean(menuBox) && menuBox.x >= -1 && menuBox.y >= -1 && menuBox.right <= view.width + 1 && menuBox.bottom <= view.height + 1, menuBox ? `${menuBox.x.toFixed(0)},${menuBox.y.toFixed(0)} → ${menuBox.right.toFixed(0)},${menuBox.bottom.toFixed(0)}` : "menu absent");
  check(`${line} · menu ouvert n'intersecte pas le zoom`, !boxesOverlap(menuBox, (await page.evaluate(() => window.__treeProbe.controls()))[".zoom-control"]));
  if (mobileLayout) {
    assessTouch({ viewport: line, label: "« Ajuster » (menu mobile)", box: menuBoxes["menuFitBtn"], cls, essential: true });
  }
  assessTouch({ viewport: line, label: "« Recentrer » (menu)", box: menuBoxes["centerTreeBtn"], cls, essential: true });
  assessTouch({ viewport: line, label: "« Réorganiser » (menu)", box: menuBoxes["autoLayoutBtn"], cls, essential: true });
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(60);
  const menuOutside = await page.evaluate(() => ({
    hidden: document.getElementById("treeMenu").hidden,
    expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded")
  }));
  check(`${line} · clic hors du menu : fermeture`, menuOutside.hidden && menuOutside.expanded === "false");
  await page.click("#treeMoreBtn");
  await page.waitForTimeout(40);
  const recenterFromMenu = await page.evaluate(async () => {
    const probe = window.__treeProbe;
    const before = { ...probe.state };
    document.getElementById("centerTreeBtn").click();
    await new Promise(resolve => setTimeout(resolve, 40));
    return { before, after: probe.state, menuHidden: document.getElementById("treeMenu").hidden, expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded") };
  });
  check(`${line} · « Recentrer » depuis le menu : échelle inchangée`, Math.abs(recenterFromMenu.after.scale - recenterFromMenu.before.scale) < 1e-6, `${Math.round(recenterFromMenu.after.scale * 100)} %`);
  check(`${line} · « Recentrer » depuis le menu : menu refermé`, recenterFromMenu.menuHidden && recenterFromMenu.expanded === "false");
  await page.click("#treeMoreBtn");
  await page.waitForTimeout(40);
  const reorgFromMenu = await page.evaluate(async () => {
    const probe = window.__treeProbe;
    document.getElementById("autoLayoutBtn").click();
    await new Promise(resolve => setTimeout(resolve, 40));
    return { menuHidden: document.getElementById("treeMenu").hidden, expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"), positionCount: probe.layout().positions.size, scale: probe.state.scale };
  });
  check(`${line} · « Réorganiser » depuis le menu : menu refermé`, reorgFromMenu.menuHidden && reorgFromMenu.expanded === "false");
  check(`${line} · « Réorganiser » : aucune perte de données (27 cartes toujours présentes)`, reorgFromMenu.positionCount === 27, `${reorgFromMenu.positionCount} cartes`);
  check(`${line} · « Réorganiser » : échelle ajustée à l'arbre complet (${Math.round(reorgFromMenu.scale * 100)} %)`, Math.abs(reorgFromMenu.scale - fitExpected) < 0.02);
  await page.click("#treeMoreBtn");
  await page.waitForTimeout(40);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(40);
  const menuEscape = await page.evaluate(() => ({
    hidden: document.getElementById("treeMenu").hidden,
    expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"),
    focusedId: document.activeElement ? document.activeElement.id : ""
  }));
  check(`${line} · Échap referme le menu d'actions (desktop)`, menuEscape.hidden && menuEscape.expanded === "false");
  check(`${line} · focus restitué au bouton ⋯ après Échap`, menuEscape.focusedId === "treeMoreBtn", menuEscape.focusedId || "aucun");
  if (mobileLayout) {
    await page.click("#treeMoreBtn");
    await page.waitForTimeout(40);
    const fitFromMenu = await page.evaluate(async () => {
      const probe = window.__treeProbe;
      document.getElementById("menuFitBtn").click();
      await new Promise(resolve => setTimeout(resolve, 60));
      return { scale: probe.state.scale, menuHidden: document.getElementById("treeMenu").hidden, expanded: document.getElementById("treeMoreBtn").getAttribute("aria-expanded"), focusedId: document.activeElement ? document.activeElement.id : "" };
    });
    check(`${line} · mobile : « Ajuster » depuis le menu → échelle = arbre complet (${Math.round(fitFromMenu.scale * 100)} %)`, Math.abs(fitFromMenu.scale - fitExpected) < 0.02);
    check(`${line} · mobile : « Ajuster » depuis le menu → menu refermé, focus sur ⋯`, fitFromMenu.menuHidden && fitFromMenu.expanded === "false" && fitFromMenu.focusedId === "treeMoreBtn");
  }

  /* ---------- Phase B2 : vue Annuaire (coquille réelle + fiches fictives) ---------- */
  console.log(`  -- B2 · Vue Annuaire (coquille réelle + fiches fictives) --`);
  await page.evaluate(() => {
    const set = (id, hidden) => {
      const el = document.getElementById(id);
      if (el) el.hidden = hidden;
    };
    set("topbar", false);
    set("appMain", true);
    set("directoryView", false);
  });
  await page.evaluate(() => {
    const names = ["Personne A", "Personne B", "Personne C", "Personne D"];
    const cards = names.map(name => `
<article class="directory-entry" tabindex="0">
<span class="directory-avatar">PA</span>
<div class="directory-main"><h3>${name}</h3><p class="directory-life">—</p></div>
<div class="directory-entry-actions"><button class="directory-action" type="button">Documents · 0</button><button class="directory-action directory-open-action" type="button" aria-label="Ouvrir la fiche">→</button></div>
</article>`).join("");
    const list = document.getElementById("directoryList");
    list.innerHTML = cards;
  });
  await page.waitForTimeout(60);

  const ovDir = await measureOverflow(page);
  check(`${line} · pas de débordement horizontal de page avec fiches annuaire (${ovDir.pageScrollW}/${ovDir.docW}px)`, ovDir.pageScrollW <= ovDir.docW + 1);
  if (ovDir.pageScrollW > ovDir.docW + 1) {
    reportIssue(line, "bloquant", "Vue Annuaire (débordement page)", JSON.stringify(ovDir.offenders.slice(0, 3)));
  }

  const dirSwitches = await page.evaluate(() => {
    return [...document.querySelectorAll('[data-switch="directory"] [data-mode]')].map(b => {
      const r = b.getBoundingClientRect();
      return { mode: b.dataset.mode, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
  });
  const switchSample = dirSwitches.map(b => `${b.mode}=${b.w}×${b.h}`).join(", ") || "absent";
  if (cls === "desktop") {
    check(`${line} · sélecteur liste/cartes présent (${switchSample} px, densité desktop informatif)`, dirSwitches.length > 0);
    noteObservation(line, "Cibles tactiles du sélecteur annuaire", `${switchSample} px — densité desktop, rapportée sans FAIL`);
  } else {
    const switchOk = dirSwitches.length > 0 && dirSwitches.every(b => b.w >= TOUCH_MIN && b.h >= TOUCH_MIN);
    check(`${line} · sélecteur liste/cartes ≥ ≈44×44 (${switchSample})`, switchOk);
    if (!switchOk) reportIssue(line, "important", "Cibles tactiles sélecteur annuaire", JSON.stringify(dirSwitches));
  }

  const cardsBtn = page.locator('[data-switch="directory"] [data-mode="cards"]').first();
  if (await cardsBtn.count()) {
    await cardsBtn.click();
    const inCards = await page.evaluate(() => document.getElementById("directoryList").classList.contains("cards-mode"));
    check(`${line} · passage en mode cartes par clic réel`, inCards);
    const listBtn = page.locator('[data-switch="directory"] [data-mode="list"]').first();
    await listBtn.click();
    const inList = await page.evaluate(() => !document.getElementById("directoryList").classList.contains("cards-mode"));
    check(`${line} · retour en mode liste par clic réel`, inList);
  } else {
    check(`${line} · passage en mode cartes par clic réel`, false, "sélecteur absent");
    reportIssue(line, "important", "Sélecteur annuaire", "aucun bouton [data-switch=directory] trouvé");
  }

  const filterSummary = await boundingBox(page, "#directoryFilterMenu summary");
  assessTouch({ viewport: line, label: "résumé du menu « Filtres »", box: filterSummary, cls, essential: false });
  await page.click("#directoryFilterMenu summary");
  const filterOpen = await page.evaluate(() => document.getElementById("directoryFilterMenu").open);
  check(`${line} · menu « Filtres » ouvert`, filterOpen);
  await page.click("#directoryFilterMenu summary");
  const filterClosed = await page.evaluate(() => !document.getElementById("directoryFilterMenu").open);
  check(`${line} · menu « Filtres » refermé`, filterClosed);

  await page.fill("#directorySearch", "Personne");
  await page.waitForTimeout(250);
  const searchValue = await page.inputValue("#directorySearch");
  check(`${line} · saisie de recherche annuaire acceptée`, searchValue === "Personne", `valeur « ${searchValue} »`);

  /* ---------- Phase B3 : modale personne (données fictives, non destructive) ---------- */
  console.log(`  -- B3 · Modale personne (markup réel, aucune sauvegarde) --`);
  await page.evaluate(() => document.getElementById("personDialog").showModal());
  await page.waitForTimeout(80);
  const dlg = await page.evaluate(() => {
    const d = document.getElementById("personDialog");
    const r = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    return {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      innerScrollH: d.scrollHeight,
      cssOverflowY: cs.overflowY,
      cssMaxH: cs.maxHeight
    };
  });
  const modalFits = dlg.h <= view.height + 1 && dlg.y >= -1 && dlg.x >= -1 && dlg.x + dlg.w <= view.width + 1;
  check(`${line} · modale personne contenue dans le viewport (${dlg.w}×${dlg.h} @${dlg.x},${dlg.y})`, modalFits);
  if (!modalFits) reportIssue(line, "bloquant", "Modale personne débordante", JSON.stringify(dlg));

  const modalCloseBtn = await boundingBox(page, '[data-close="personDialog"]');
  assessTouch({ viewport: line, label: "bouton de fermeture de la modale", box: modalCloseBtn, cls, essential: false });

  await page.click("#personRelationsTab");
  await page.waitForTimeout(60);
  const tabState = await page.evaluate(() => ({
    relationsVisible: !document.getElementById("personRelationsPanel").hidden,
    identityHidden: document.getElementById("personIdentityPanel").hidden
  }));
  check(`${line} · onglet « Liens familiaux » actif par clic réel`, tabState.relationsVisible && tabState.identityHidden, JSON.stringify(tabState));
  await page.click("#personIdentityTab");
  await page.waitForTimeout(60);
  const tabBack = await page.evaluate(() => ({
    identityVisible: !document.getElementById("personIdentityPanel").hidden,
    relationsHidden: document.getElementById("personRelationsPanel").hidden
  }));
  check(`${line} · retour à l'onglet « Identité » par clic réel`, tabBack.identityVisible && tabBack.relationsHidden, JSON.stringify(tabBack));

  await page.fill("#place", "Turin,");
  await page.waitForTimeout(1100);
  const acState = await page.evaluate(() => {
    const input = document.getElementById("place");
    const status = input.closest(".location-autocomplete")?.querySelector(".location-autocomplete-status");
    return {
      value: input.value,
      status: status ? status.textContent.trim() : "",
      suggestionsList: document.getElementById("place-suggestions") ? !document.getElementById("place-suggestions").hidden : "absente"
    };
  });
  check(`${line} · saisie libre du lieu conservée (GeoNames bloqué) : « ${acState.value} »`, acState.value === "Turin,");
  check(
    `${line} · message dégradé autocomplétion affiché`,
    acState.status.includes("saisie libre reste disponible"),
    acState.status || "vide"
  );
  check(`${line} · liste de suggestions vide (aucune donnée réelle)`, acState.suggestionsList === false || acState.suggestionsList === "absente");

  await page.click('[data-close="personDialog"]');
  await page.waitForTimeout(80);
  const modalClosed = await page.evaluate(() => !document.getElementById("personDialog").open);
  check(`${line} · modale fermée par le bouton réel`, modalClosed);

  const counts = { checked: checkCount - before.checks, failed: failCount - before.failures };
  if (counts.failed > 0) {
    await mkdir(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(SHOT_DIR, `echec-${view.name}.png`), fullPage: false });
    console.log(`  ↳ capture de diagnostic : ${join(SHOT_DIR, `echec-${view.name}.png`)}`);
  }
  return counts;
}

async function main() {
  console.log("Suite responsive — tests navigateur réels (Playwright), calibration EXÉCUTION 5B.");
  console.log(`  Playwright : v${playwrightVersion} · Chromium Playwright : ${chromium.executablePath()}`);
  console.log("  Catégories de viewports :");
  console.log("    MOBILE / TACTILE : mobile-320, mobile-390, phablet-560, tablet-760 (cibles ~44×44 stricts)");
  console.log("    PAYSAGE MOBILE / TACTILE : landscape-844 (cibles ~44×44 stricts + test fonctionnel d'accès)");
  console.log("    DESKTOP : desktop-1024, desktop-1440 (mesures de densité rapportées en informatif)");
  console.log("  Règles réseau : seuls l'origine locale et gstatic.com (SDK Firebase) sont autorisés ;");
  console.log("  firestore.googleapis.com, Firebase Authentication, securetoken, GeoNames/relais, jsDelivr sont BLOQUÉS (jamais de contact avec la base réelle).");
  console.log("  Identifiants utilisés : fictifs (sans-acces@example.net) ; aucune donnée réelle affichée ; fiches fictives « Personne A..D ».");

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Navigateur Chromium indisponible : ${error.message}\nInstallez-le avec « npx playwright install chromium », ou corrigez PLAYWRIGHT_BROWSERS_PATH. Le responsive n'a PAS été évalué.`);
  }

  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR" });

  const consoles = [];
  await context.route("**/*", route => {
    const url = route.request().url();
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    const svc = blockedServiceFor(url);
    if (svc) blockedServices.set(svc, (blockedServices.get(svc) || 0) + 1);
    return route.abort("blockedbyclient").catch(() => {});
  });
  const page = await context.newPage();

  page.on("console", message => {
    if (message.type() === "error" || message.type() === "warning") {
      consoles.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", error => {
    pageErrors.push(String(error));
  });
  page.on("requestfailed", request => {
    const url = request.url();
    if (isAllowedRequest(url, server.baseURL)) {
      pageErrors.push(`Requête locale/galerie refusée : ${url} (${request.failure()?.errorText || "?"})`);
    }
  });

  const bootReady = page.waitForEvent("console", {
    predicate: message => message.type() === "warning" && message.text().includes(BOOT_WARNING),
    timeout: 90000
  });
  const gotoError = await page.goto(server.baseURL, { waitUntil: "load" }).then(() => null, error => String(error));
  if (gotoError) {
    throw new Error(`Impossible de charger ${server.baseURL} : ${gotoError}`);
  }
  try {
    await bootReady;
  } catch (error) {
    throw new Error(`L'application ne s'est pas amorcée (warning « ${BOOT_WARNING} » jamais reçu). SDK Firebase injoignable ou code modifié ? Détail : ${error.message}`);
  }
  await page.waitForTimeout(400);

  for (const view of VIEWPORTS) {
    const counts = await runViewport(view, page, server.baseURL);
    perViewport.push({ viewport: view.name, viewed: `${view.width}×${view.height}`, class: VIEW_CLASS[view.name] || "tactile", checked: counts.checked, failed: counts.failed });
  }

  const tolerated = [
    { type: "warning", rx: /Vérification des inscriptions impossible/ },
    { type: "error", rx: /auth\// },
    { type: "warning", rx: /@firebase\/firestore/ },
    { type: "error", rx: /@firebase\/firestore/ },
    { type: "error", rx: /ERR_BLOCKED_BY_CLIENT/ }
  ];
  const unexpected = consoles.filter(message => !tolerated.some(t => t.type === message.type && t.rx.test(message.text)));
  for (const message of unexpected) {
    unexpectedConsoles.push(`${message.type.toUpperCase()} : ${message.text}`);
  }

  await context.close();
  await browser.close();
  await server.close();

  console.log("\n===== BILAN (EXÉCUTION 5B) =====");
  console.log(`Assertions vérifiées dans le navigateur : ${checkCount}`);
  console.log(`Échecs d'assertion (FAIL réels) : ${failCount}`);
  console.log(`Exceptions de page inattendues : ${pageErrors.length}`);
  for (const pe of pageErrors) console.log(`  pageerror/requête refusée : ${pe}`);
  console.log(`Messages console non attendus : ${unexpectedConsoles.length}`);
  for (const message of unexpectedConsoles) console.log(`  console : ${message}`);
  console.log("Services externes bloqués (jamais contactés) :");
  for (const [svc, count] of blockedServices) console.log(`  - ${svc} : ${count} requête(s) avortée(s)`);

  const realFails = issues.filter(i => i.severity === "bloquant");
  if (realFails.length) {
    console.log(`\nFAIL réels (non corrigés — à traiter en exécution dédiée, le site n'est pas modifié) : ${realFails.length}`);
    for (const issue of realFails) {
      console.log(`  [${issue.viewport}] ${issue.severity} — ${issue.section} : ${issue.detail}`);
    }
  }
  const otherIssues = issues.filter(i => i.severity !== "bloquant");
  if (otherIssues.length) {
    console.log(`\nConstatations importantes/mineures (documentées, non bloquantes) : ${otherIssues.length}`);
    for (const issue of otherIssues) {
      console.log(`  [${issue.viewport}] ${issue.severity} — ${issue.section} : ${issue.detail}`);
    }
  }
  if (observations.length) {
    console.log(`\nMesures informatives (densité desktop / écarts secondaires, non FAIL) : ${observations.length}`);
    for (const obs of observations) console.log(`  ℹ ${obs}`);
  }

  console.log("\nTests navigateur réels par viewport (assertions / FAIL) :");
  for (const p of perViewport) console.log(`  - ${p.viewport} ${p.viewed} [${p.class}] : ${p.checked} assertions / ${p.failed} FAIL`);

  const failed = failCount > 0 || pageErrors.length > 0 || unexpectedConsoles.length > 0;
  console.log(`\nRésultat : ${failed ? "ÉCHEC (FAIL réels documentés, aucun correctif applicatif appliqué)" : "SUCCÈS"}`);
  process.exitCode = failed ? 1 : 0;
}

try {
  await main();
} catch (error) {
  console.error(`\nSuite responsive interrompue : ${error.stack || error}`);
  process.exitCode = 1;
}
