/* Test Playwright ciblé : modale Démarches structurée (header/footer fixes,
   seul .modal-scroll défile, plein écran mobile) aux viewports
   320 / 390 / 430 / 760 / 1024.
   La modale est ouverte via showModal() (contenu statique du formulaire) ;
   les aspects fonctionnels Firestore ne sont pas exécutés ici. */
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

const VIEWPORTS = [
  ["mobile-320", { width: 320, height: 568 }, true],
  ["mobile-390", { width: 390, height: 844 }, true],
  ["mobile-430", { width: 430, height: 932 }, true],
  ["tablet-760", { width: 760, height: 900 }, true],
  ["desktop-1024", { width: 1024, height: 768 }, false]
];

let failures = 0;
async function open(baseURL, viewportSize, engine = "chromium") {
  const browser = await (engine === "webkit" ? webkit : chromium).launch();
  const page = await browser.newPage({ viewport: viewportSize, reducedMotion: "reduce" });
  await page.goto(baseURL, { waitUntil: "load" });
  await page.evaluate(() => document.getElementById("dossierDialog").showModal());
  await page.waitForTimeout(250);
  return { browser, page };
}

async function checkViewport(label, viewportSize, touch) {
  const { server, baseURL } = await startStaticServer(ROOT);
  try {
    const engine = touch ? "webkit" : "chromium"; // moteur iOS-like pour les viewports mobiles
    const { browser, page } = await open(baseURL, viewportSize, engine);
    const metrics = await page.evaluate(() => {
      const dialog = document.getElementById("dossierDialog");
      const head = dialog.querySelector(".modal-head");
      const scroll = dialog.querySelector(".modal-scroll");
      const actions = dialog.querySelector(".modal-actions");
      const rect = dialog.getBoundingClientRect();
      return {
        rect,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        docScrollWidth: document.documentElement.scrollWidth,
        dialogScrollWidth: dialog.scrollWidth,
        headTop: head.getBoundingClientRect().top,
        actions: actions.getBoundingClientRect(),
        scrollClient: scroll.clientHeight,
        textareas: ["dossierNotes", "dossierResult"].map(id => getComputedStyle(document.getElementById(id)).minHeight),
        buttonTop: [...actions.querySelectorAll(".right > .btn:not([hidden])")].map(button => button.getBoundingClientRect().top)
      };
    });
    const overflow = await page.evaluate(async () => {
      const dialog = document.getElementById("dossierDialog");
      const scroll = dialog.querySelector(".modal-scroll");
      scroll.scrollTop = scroll.scrollHeight;
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        scrollable: scroll.scrollHeight > scroll.clientHeight,
        footerBottom: dialog.querySelector(".modal-actions").getBoundingClientRect().bottom,
        viewportH: window.innerHeight,
        actionsTop: dialog.querySelector(".modal-actions").getBoundingClientRect().top
      };
    });
    const pass = message => console.log(`  [PASS] ${label} · ${message}`);
    const fail = (message, detail) => { failures += 1; console.log(`  [ÉCHEC] ${label} · ${message} — ${detail}`); };

    // 1. La modale est plafonnée au viewport réel (dvh) : hauteur ≤ viewport.
    metrics.rect.height <= metrics.viewport.h + 1 ? pass("hauteur modale ≤ viewport") : fail("hauteur modale ≤ viewport", `${metrics.rect.height} ≤ ${metrics.viewport.h}`);
    // 1b. Mobile plein écran : largeur = 100vw, aucune marge gauche/droite.
    if (viewportSize.width <= 760) {
      Math.abs(metrics.rect.width - metrics.viewport.w) <= 1 ? pass(`largeur plein écran = viewport (${Math.round(metrics.rect.width)})`) : fail("largeur plein écran = viewport", `${metrics.rect.width} ≠ ${metrics.viewport.w}`);
      Math.abs(metrics.rect.left) <= 1 && Math.abs(metrics.rect.right - metrics.viewport.w) <= 1 ? pass("aucune marge gauche/droite") : fail("aucune marge gauche/droite", `left ${metrics.rect.left} / right ${metrics.rect.right}`);
    } else {
      Math.round(metrics.rect.width) === Math.min(1040, metrics.viewport.w - 48) ? pass("largeur desktop inchangée (min(1040px, 100vw−48px))") : fail("largeur desktop inchangée", `${metrics.rect.width} ≠ ${Math.min(1040, metrics.viewport.w - 48)}`);
    }
    // 2. Le footer reste dans le viewport bas après scroll du formulaire.
    overflow.footerBottom <= metrics.viewport.h + 1 && overflow.actionsTop < overflow.viewportH ? pass("footer visible après scroll complet") : fail("footer visible après scroll complet", `bottom ${overflow.footerBottom} / vh ${overflow.viewportH}`);
    // 3. Seul le corps central défile.
    overflow.scrollable ? pass("zone centrale scrollable") : fail("zone centrale scrollable", `scrollHeight > clientHeight : ${overflow.scrollable}`);
    // 4. Aucun scroll horizontal — modal-scroll (égalité stricte demandée),
    //    document, ET chaque descendant visible du dialog.
    //    (les .sr-only, clippés à 1 px par convention, sont exclus).
    const internalOverflow = await page.evaluate(() => {
      const dialog = document.getElementById("dossierDialog");
      const vw = window.innerWidth;
      const scroll = dialog.querySelector(".modal-scroll");
      const scrollEquality = scroll.scrollWidth - scroll.clientWidth;
      const offenders = [];
      for (const el of dialog.querySelectorAll("*")) {
        if (el.classList.contains("sr-only")) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        const overRight = rect.right - vw;
        const overLeft = -rect.left;
        const overClient = el.scrollWidth - el.clientWidth - 1;
        if (overRight > 0.5 || overLeft > 0.5 || overClient > 0.5) {
          offenders.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).split(" ")[0]} overR=${Math.round(overRight * 10) / 10} overL=${Math.round(overLeft * 10) / 10} overClient=${Math.round(overClient * 10) / 10}`);
        }
      }
      return { scrollEquality, offenders };
    });
    const overflowOk = metrics.dialogScrollWidth <= Math.ceil(metrics.viewport.w) && metrics.docScrollWidth <= Math.ceil(metrics.viewport.w) + 1 && internalOverflow.offenders.length === 0 && internalOverflow.scrollEquality <= 0.5;
    overflowOk ? pass(`aucun défilement horizontal (.modal-scroll Δ ${internalOverflow.scrollEquality} px, dialog + descendants nickel)`) : fail("aucun défilement horizontal (.modal-scroll + dialog + descendants)", `dialog ${metrics.dialogScrollWidth} / doc ${metrics.docScrollWidth} / Δscroll ${internalOverflow.scrollEquality} / ${internalOverflow.offenders.join(" ; ") || "aucun"}`);
    // 5. Le header est en haut et visible sans défilement.
    metrics.headTop >= 0 && metrics.headTop < 40 ? pass("header fixe en haut") : fail("header fixe en haut", `top ${metrics.headTop}`);
    // 6. Boutons Annuler/Enregistrer sur une ligne.
    const tops = metrics.buttonTop;
    tops.length === 2 && Math.abs(tops[0] - tops[1]) < 2 ? pass("Annuler | Enregistrer sur une seule ligne") : fail("Annuler | Enregistrer sur une seule ligne", `tops ${tops.join(",")}`);
    // 6b. Disposition en colonnes : MOBILE = 1 colonne (chaque paire empilée
    //     verticalement + titres de section pleine ligne), DESKTOP = 2
    //     colonnes pour les paires prévues.
    const layout = await page.evaluate(() => {
      const box = document.getElementById("dossierDialog");
      const grid = box.querySelector(".grid");
      const pairs = [
        ["dossierType", "dossierStatus"],
        ["dossierOrganization", "dossierService"],
        ["dossierContactName", "dossierEmail"],
        ["dossierPhone", "dossierPlace"],
        ["dossierNextAction", "dossierNextActionDate"]
      ];
      const outcomes = pairs.map(([firstId, secondId]) => {
        const first = document.getElementById(firstId).getBoundingClientRect();
        const second = document.getElementById(secondId).getBoundingClientRect();
        return { firstId, secondId, below: second.top >= first.bottom - 1, side: Math.abs(second.top - first.top) < 2, gap: Math.round(second.left - first.right) };
      });
      const headings = ["Objet de la démarche", "Organisme et contact", "Personnes éventuellement liées", "Suivi"].map(title => {
        const heading = [...box.querySelectorAll(".form-section-heading h4")].find(node => node.textContent === title);
        const rect = heading?.parentElement.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        return { title, fullLine: !!rect && Math.abs(rect.left - gridRect.left) < 1 && Math.abs(rect.width - gridRect.width) < 1 };
      });
      const gridWidth = grid.getBoundingClientRect().width;
      return { outcomes, headings, gridWidth, scrollContent: box.querySelector(".modal-scroll").clientWidth - 2 * getComputedStyle(box.querySelector(".modal-scroll")).paddingLeft.replace("px", "") * 1 };
    });
    if (viewportSize.width <= 760) {
      layout.outcomes.every(pair => pair.below && !pair.side) ? pass("mobile : paires Type|Statut, Organisme|Service, Contact|E-mail, Téléphone|Lieu, Action|Échéance empilées (1 colonne)") : fail("mobile : 1 colonne", JSON.stringify(layout.outcomes));
    } else {
      layout.outcomes.every(pair => pair.side) ? pass("desktop : les 5 paires prévues restent côte à côte") : fail("desktop : paires côte à côte", JSON.stringify(layout.outcomes));
    }
    layout.headings.every(heading => heading.fullLine) ? pass("titres de section sur lignes complètes") : fail("titres de section pleine ligne", JSON.stringify(layout.headings));
    // 7. Textareas réduits au démarrage sur mobile uniquement.
    if (touch) {
      metrics.textareas.every(height => parseFloat(height) < 64) ? pass("height initiale textareas réduite mobile") : fail("height initiale textareas réduite mobile", metrics.textareas.join(" / "));
    } else pass("textareas : hauteur desktop inchangée (non applicable)");
    // 8. La zone centrale de scroll est distincte du footer.
    metrics.scrollClient < metrics.rect.height - 8 ? pass("zone de défilement distincte du footer") : fail("zone de défilement distincte du footer", `client ${metrics.scrollClient} / modal ${Math.round(metrics.rect.height)}`);
    await browser.close();
  } finally {
    server.close();
  }
}

for (const [label, viewportSize, touch] of VIEWPORTS) {
  console.log(`\nViewport ${label} ${viewportSize.width}×${viewportSize.height}${touch ? " · moteur WebKit (iOS-like)" : " · moteur Chromium"}`);
  try {
    await checkViewport(label, viewportSize, touch);
  } catch (error) {
    failures += 1;
    console.log(`  [ÉCHEC] ${label} · erreur(playwright) — ${error.message}`);
  }
}

/* ─── Modale « action » : état email vs générique, séquence de changements
   de type dans une même ouverture, et accessibilité du champ Auteur. ─── */
console.log("\nModale action : cycles de type + scroll");
try {
  const { server, baseURL } = await startStaticServer(ROOT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  await page.goto(baseURL, { waitUntil: "load" });
  await page.evaluate(() => {
    document.getElementById("dossierDialog").showModal();
    document.getElementById("procedureActionDialog").showModal();
  });
  await page.waitForTimeout(200);
  const action = await page.evaluate(async () => {
    const typeSelect = document.getElementById("procedureActionType");
    const state = async type => {
      typeSelect.value = type;
      typeSelect.dispatchEvent(new Event("change"));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const labelOf = id => document.getElementById(id).closest("label");
      return {
        type,
        sensHidden: labelOf("procedureActionDirection").hidden,
        titreHidden: labelOf("procedureActionTitleField").hidden,
        emailVisible: !document.getElementById("procedureActionEmailGroup").hidden,
        timeVisible: !document.getElementById("procedureActionTimeGroup").hidden,
        directionValue: document.getElementById("procedureActionDirection").value,
        fieldLabelText: labelOf("procedureActionText").firstChild.nodeValue
      };
    };
    // Séquence demandée : email-sent → email-received → note → email-sent.
    const sent = await state("email-sent");
    const received = await state("email-received");
    const note = await state("note");
    const sentAgain = await state("email-sent");
    // Scroll : le champ Auteur doit être ENTIEREMENT visible après scroll bas.
    const scroll = document.querySelector("#procedureActionDialog .modal-scroll");
    scroll.scrollTop = scroll.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const author = document.getElementById("procedureActionAuthor").closest("label").getBoundingClientRect();
    const footer = document.querySelector("#procedureActionDialog .modal-actions").getBoundingClientRect();
    return { sent, received, note, sentAgain, authorBottom: author.bottom, footerTop: footer.top, authorFullyVisible: author.bottom <= footer.top + 1 && author.height > 0 };
  });
  const ok = name => console.log(`  [PASS] ${name}`);
  const ko = (name, detail) => { failures += 1; console.log(`  [ÉCHEC] ${name} — ${detail}`); };
  for (const entry of [action.sent, action.sentAgain]) {
    entry.type === "email-sent" && !entry.sensHidden === false && entry.titreHidden && entry.emailVisible && entry.timeVisible && entry.directionValue === "sent" && entry.fieldLabelText === "Notes / résumé" ? ok(`email-sent : sens/title masqués, ${entry.directionValue = "sent"}, Notes / résumé`) : ko("email-sent état", JSON.stringify(entry));
  }
  action.received.type === "email-received" && action.received.directionValue === "received" && action.received.titreHidden && action.received.emailVisible ? ok("email-received : direction received, champs email visibles") : ko("email-received état", JSON.stringify(action.received));
  // Note : retour au comportement générique — Sens et Titre redeviennent
  // visibles, aucun champ email/heure parasite, libellé d'origine restauré.
  const genericRestored = !action.note.sensHidden && !action.note.titreHidden && !action.note.emailVisible && !action.note.timeVisible && action.note.fieldLabelText === "Résumé ou texte";
  genericRestored ? ok("note : générique conservé (Sens + Titre visibles, aucun champ email, libellé d’origine)") : ko("note état", JSON.stringify(action.note));
  action.authorFullyVisible ? ok("Auteur entièrement visible au-dessus du footer après scroll") : ko("scroll Auteur / footer", `authorBottom ${action.authorBottom} vs footerTop ${action.footerTop}`);
  await browser.close();
  server.close();
} catch (error) {
  failures += 1;
  console.log(`  [ÉCHEC] modale action · erreur(playwright) — ${error.message}`);
}

/* ─── Message complet déplié : scroll unique de la modale. Injection
     d'une carte email dépliée (longue) dans la vraie modale — CSS et
     structure réels, seules les données sont simulées. ─── */
const EMAIL_LONG = "Ligne du message original\n".repeat(220) + "fin du message";
console.log("\nMessage complet déplié : scroll molette/touch");
try {
  const { server, baseURL } = await startStaticServer(ROOT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
  await page.goto(baseURL, { waitUntil: "load" });
  const injected = await page.evaluate(content => {
    const dialog = document.getElementById("procedureDetailDialog");
    const timeline = document.getElementById("procedureTimeline");
    timeline.innerHTML = `<article class="procedure-action-item is-email" id="testEmailCard">
<span class="procedure-action-stamp">30 sept. 2026 · 14:30</span>
<span class="procedure-action-type">Email envoyé</span>
<h5 class="procedure-action-title">Demande de consultation des registres</h5>
<span class="procedure-action-correspondent">À : test@gmail.com</span>
<p class="procedure-action-text">Demande envoyée concernant les registres militaires</p>
<button class="btn small procedure-action-email-toggle" type="button" data-toggle-email-action="t1" aria-expanded="true"><svg class="ui-icon" aria-hidden="true"><use href="#icon-reorder"></use></svg><span>Masquer le message</span></button>
<div class="procedure-action-email-full-block" id="testEmailMsg"><p class="procedure-action-email-full">${content}</p></div>
<div class="procedure-action-tools"><button class="btn small" type="button">Modifier</button><button class="btn small danger" type="button">Supprimer</button></div>
</article>`;
    dialog.showModal();
  }, EMAIL_LONG);
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => {
    const dialog = document.getElementById("procedureDetailDialog");
    const body = dialog.querySelector(".modal-body");
    const wrapper = dialog.querySelector(".modal-scroll");
    const msg = document.getElementById("testEmailMsg");
    msg.scrollLeft = 0;
    msg.scrollTop = 40;
    const msgScrolled = msg.scrollTop !== 0; // devient un scroll container si > 0
    msg.scrollTop = 0;
    body.scrollTop = msg.getBoundingClientRect().top + body.scrollTop - 240;
    return {
      msgIsScrollContainer: msgScrolled,
      msgOverflowY: getComputedStyle(msg).overflowY,
      wrapperOverflowY: getComputedStyle(wrapper).overflowY,
      bodyOverflowY: getComputedStyle(body).overflowY,
      mockPoint: (() => {
        const rect = msg.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 100) };
      })(),
      horizontal: { docW: document.documentElement.scrollWidth, vw: window.innerWidth, msgOverflowX: msg.scrollWidth - msg.clientWidth }
    };
  });
  await page.mouse.move(state.mockPoint.x, state.mockPoint.y);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(140);
  const scrolled = await page.evaluate(() => document.querySelector("#procedureDetailDialog .modal-body").scrollTop);
  state.msgIsScrollContainer === false && state.msgOverflowY === "visible" ? console.log("  [PASS] le message n'est pas un scroll container") : console.log(`  [ÉCHEC] message scroll container — overflowY ${state.msgOverflowY}`);
  state.wrapperOverflowY === "visible" ? console.log("  [PASS] wrapper .modal-scroll du détail = zone non-scrollable (zone unique)") : console.log(`  [ÉCHEC] wrapper intercepte le scroll — overflowY ${state.wrapperOverflowY}`);
  state.bodyOverflowY === "auto" ? console.log("  [PASS] .modal-body = unique zone de scroll") : console.log(`  [ÉCHEC] .modal-body n'est pas le conteneur de scroll — ${state.bodyOverflowY}`);
  scrolled > 0 ? console.log(`  [PASS] molette au-dessus du message → scrollTop modale augmente (${scrolled} px)`) : console.log(`  [ÉCHEC] wheel bloqué sur le message (scrollTop reste ${scrolled})`);
  state.horizontal.docW <= state.horizontal.vw + 1 && state.horizontal.msgOverflowX === 0 ? console.log("  [PASS] aucun overflow horizontal (doc + message)") : console.log(`  [ÉCHEC] overflow horizontal — doc ${state.horizontal.docW} vs vw ${state.horizontal.vw}, message ${state.horizontal.msgOverflowX} px`);
  for (const width of [320, 390, 430]) {
    const frame = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce", hasTouch: true });
    await frame.goto(baseURL, { waitUntil: "load" });
    await frame.evaluate(content => {
      const dialog = document.getElementById("procedureDetailDialog");
      document.getElementById("procedureTimeline").innerHTML = `<article class="procedure-action-item is-email"><div class="procedure-action-email-full-block" id="testEmailMsg" style="display:block"><p class="procedure-action-email-full">${content}</p></div></article>`;
      dialog.showModal();
    }, EMAIL_LONG);
    await frame.waitForTimeout(150);
    const overflow = await frame.evaluate(() => {
      const msg = document.getElementById("testEmailMsg");
      return {
        docW: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        msgOv: msg.scrollWidth - msg.clientWidth
      };
    });
    overflow.docW <= overflow.vw + 1 && overflow.msgOv === 0 ? console.log(`  [PASS] ${width} px : aucun pan horizontal`) : console.log(`  [ÉCHEC] ${width} px : doc ${overflow.docW} / vw ${overflow.vw} / msg ${overflow.msgOv}`);
    await frame.close();
  }
  await browser.close();
  server.close();
} catch (error) {
  failures += 1;
  console.log(`  [ÉCHEC] message déplié · erreur(playwright) — ${error.message}`);
}

/* ─── Modale « action » : garde-fou anti-overflow horizontal par viewport.
     Trois états : générique, email envoyé complet, email reçu complet. ─── */
const ACTION_STATES = [
  ["générique", "", ""],
  ["email-sent", "email-sent", "Très long contenu de message original\n".repeat(120)],
  ["email-received", "email-received", "Très long contenu de message original\n".repeat(120)]
];
console.log("\nModale action : overflow horizontal par viewport/état");
try {
  const actionSetup = await startStaticServer(ROOT);
  const actionBrowser = await chromium.launch();
  for (const width of [320, 390, 430, 760, 1024]) {
    const page = await actionBrowser.newPage({ viewport: { width: width, height: 844 }, reducedMotion: "reduce" });
    await page.goto(actionSetup.baseURL, { waitUntil: "load" });
    for (const [état, typeValue, longText] of ACTION_STATES) {
    await page.evaluate(({ typeValue, longText }) => {
      document.getElementById("procedureActionDialog").showModal();
      if (typeValue) {
        const select = document.getElementById("procedureActionType");
        select.value = typeValue;
        select.dispatchEvent(new Event("change"));
        document.getElementById("procedureActionDate").value = "2026-10-02";
        document.getElementById("procedureActionTime").value = "14:30";
        document.getElementById("procedureActionEmailFrom").value = "François";
        document.getElementById("procedureActionEmailTo").value = "test@gmail.com";
        document.getElementById("procedureActionEmailSubject").value = "Demande de consultation des registres";
        document.getElementById("procedureActionEmailFull").value = longText;
        document.getElementById("procedureActionText").value = "Résumé assez long pour éprouver la largeur ".repeat(12);
        document.getElementById("procedureActionAuthor").value = "François";
      } else {
        document.getElementById("procedureActionForm").reset();
      }
    }, { typeValue, longText });
    await page.waitForTimeout(120);
    const mesures = await page.evaluate(() => {
      const dialog = document.getElementById("procedureActionDialog");
      const scroll = dialog.querySelector(".modal-scroll");
      const form = dialog.querySelector(".modal-form");
      const grid = dialog.querySelector(".grid");
      return {
        vw: window.innerWidth,
        dialog: dialog.scrollWidth - dialog.clientWidth,
        scroll: scroll.scrollWidth - scroll.clientWidth,
        form: form.scrollWidth - form.clientWidth,
        grid: grid.scrollWidth - grid.clientWidth,
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    const ok = [mesures.dialog, mesures.scroll, mesures.form, mesures.grid, mesures.doc].every(value => value <= 1);
    ok ? console.log(`  [PASS] ${width}px · ${état} : Δ dialog/scroll/form/grid/doc = ${mesures.dialog}/${mesures.scroll}/${mesures.form}/${mesures.grid}/${mesures.doc}`) : console.log(`  [ÉCHEC] ${width}px · ${état} : ${JSON.stringify(mesures)}`);
    failures += ok ? 0 : 1;
  }
  await page.close();
  }
  await actionBrowser.close();
  actionSetup.server.close();
} catch (error) {
  failures += 1;
  console.log(`  [ÉCHEC] garde-fou action · erreur(playwright) — ${error.message}`);
}

console.log(`\nRésultat : ${failures === 0 ? "SUCCÈS" : `${failures} ÉCHEC(S)`}`);
assert.equal(failures, 0);
