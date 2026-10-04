import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

test("Actions : tuiles distinctes en mobile et alignement conservé sur desktop", async t => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip("Chromium Playwright indisponible");
    return;
  }

  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR" });
  await context.route("**/*", route => {
    const url = route.request().url();
    return url.startsWith(server.baseURL) || url.includes("gstatic.com")
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForSelector("#tasksList", { state: "attached" });
    await page.evaluate(() => {
      document.getElementById("authScreen").hidden = true;
      document.getElementById("topbar").hidden = false;
      document.getElementById("appMain").hidden = true;
      for (const id of ["directoryView", "documentsView", "tasksView", "dossiersView"]) {
        const view = document.getElementById(id);
        if (view) view.hidden = id !== "tasksView";
      }
      const menu = `<div class="tile-context-actions"><button class="tile-context-toggle" type="button" data-tile-menu-toggle aria-haspopup="menu" aria-expanded="false">…</button></div>`;
      const row = (kind, status, priority) => `<article class="task-row${kind === "late" ? " is-late" : ""}${kind === "done" ? " is-done" : ""}" data-task-row="${kind}"><div class="task-main"><h3>${kind === "late" ? "Action en retard" : kind === "done" ? "Action terminée" : "Action à faire"}</h3></div><div class="task-assignee"><span class="task-avatar">AB</span><span class="task-assignee-name">Responsable familial</span></div><div class="task-due">12/06/2026</div><span class="task-priority badge">${priority}</span><span class="task-status">${status}</span><div class="task-actions">${menu}</div></article>`;
      document.getElementById("tasksList").innerHTML = row("todo", "À faire", "Moyenne") + row("late", "En cours", "Haute") + row("done", "Terminée", "Basse");
    });

    for (const width of [320, 390, 1024]) {
      await t.test(`${width} px : surfaces séparées${width > 760 ? " et colonnes alignées" : ""}`, async () => {
        await page.setViewportSize({ width, height: 800 });
        const result = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("#tasksList .task-row")];
          const boxes = rows.map(row => row.getBoundingClientRect());
          const listBox = document.getElementById("tasksList").getBoundingClientRect();
          const toolbarBox = document.querySelector("#tasksView .list-toolbar").getBoundingClientRect();
          const styles = rows.map(row => getComputedStyle(row));
          const columns = [".task-main", ".task-assignee", ".task-due", ".task-priority", ".task-status", ".task-actions"];
          const aligned = Object.fromEntries(columns.map(selector => [selector, rows.map(row => {
            const box = row.querySelector(selector).getBoundingClientRect();
            return [".task-priority", ".task-status", ".task-due"].includes(selector) ? box.left + box.width / 2 : box.left;
          })]));
          return {
            boxes: boxes.map(box => ({ top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width })),
            listEdges: { left: listBox.left, right: listBox.right },
            toolbarEdges: { left: toolbarBox.left, right: toolbarBox.right },
            gaps: boxes.slice(1).map((box, index) => box.top - boxes[index].bottom),
            borders: styles.map(style => style.borderTopWidth),
            radii: styles.map(style => style.borderTopLeftRadius),
            backgrounds: styles.map(style => style.backgroundColor),
            shadows: styles.map(style => style.boxShadow),
            doneDecoration: getComputedStyle(rows[2].querySelector("h3")).textDecorationLine,
            aligned
          };
        });
        assert.equal(result.boxes.length, 3);
        assert.ok(result.boxes.every(box => box.width > 0 && box.left >= -1 && box.right <= width + 1), "chaque tuile reste dans le viewport");
        assert.ok(Math.abs(result.listEdges.left - result.toolbarEdges.left) < 1, "bord gauche des tuiles aligné avec la barre de recherche");
        assert.ok(Math.abs(result.listEdges.right - result.toolbarEdges.right) < 1, "bord droit des tuiles aligné avec la zone des filtres");
        assert.ok(result.gaps.every(gap => Math.abs(gap - 8) < 1), `espacement vertical de 8 px : ${result.gaps}`);
        assert.ok(result.borders.every(widthValue => widthValue === "1px"), "chaque tuile possède sa bordure subtile");
        assert.ok(result.radii.every(radius => parseFloat(radius) > 0), "chaque tuile possède un radius");
        assert.notEqual(result.backgrounds[1], result.backgrounds[0], "le fond de retard reste limité à sa tuile");
        assert.notEqual(result.backgrounds[2], result.backgrounds[0], "le fond terminé reste limité à sa tuile");
        assert.match(result.shadows[1], /inset/);
        assert.match(result.doneDecoration, /line-through/);
        if (width > 760) {
          for (const [column, positions] of Object.entries(result.aligned)) {
            assert.ok(positions.every(position => Math.abs(position - positions[0]) < 1), `${column} reste alignée entre les actions`);
          }
        }
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await server.close();
  }
});
