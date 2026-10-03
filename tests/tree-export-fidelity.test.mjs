// Exports réels, données fictives uniquement, services externes bloqués.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import { ROOT, SHOT_DIR, startStaticServer, isAllowedRequest, BOOT_WARNING } from "./helpers.mjs";

const server = await startStaticServer(ROOT);
await mkdir(SHOT_DIR, { recursive: true });
const fixture = [
  { id:"court", firstName:"Jean", lastName:"Martin", birthDate:"1900-04-12", deathDate:"1980-09-20", place:"Paris", deathPlace:"Lyon" },
  { id:"long", firstName:"Marie-Anne", middleName:"Élisabeth Louise", lastName:"de La Roche-Saint-André", birthDateInfo:{type:"about",year:1885}, place:"Saint-Martin-de-Belleville, Savoie, France", deathPlace:"Saint-Jean-Pied-de-Port, Pyrénées-Atlantiques" },
  { id:"double", firstName:"Alexandre", lastName:"Dupont de Nemours", birthDate:"1920-01-02", deathDateInfo:{type:"between",from:1990,to:2000}, place:"Aix-en-Provence, France" },
  { id:"sans", firstName:"Zoé", lastName:"Petit", birthDateInfo:{type:"unknown"} }
];
try {
  for (const [engine, engineName] of [[chromium,"Chromium"],[webkit,"WebKit"]]) {
    const browser = await engine.launch({headless:true});
    try {
      let referenceDimensions;
      for (const width of [320,390,1440]) {
        const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<761,deviceScaleFactor:width<761?3:1});
        const page = await context.newPage();
        // Playwright WebKit applique l'interception de route aux sous-ressources blob:
        // Chromium les laisse passer. Les laisser passer dans les deux moteurs est
        // équivalent au navigateur réel (les blob: ne sortent jamais du processus).
        await page.route("**/*", r => {
          const url = r.request().url();
          if (url.startsWith("blob:")) return r.continue();
          return isAllowedRequest(url, server.baseURL) ? r.continue() : r.abort();
        });
        const boot = page.waitForEvent("console", {predicate:m=>m.text().includes(BOOT_WARNING),timeout:60000});
        await page.goto(server.baseURL); await boot;
        await page.evaluate(people => {
          document.getElementById("authScreen").hidden=true;
          document.getElementById("appMain").hidden=false;
          document.getElementById("topbar").hidden=false;
          const c=document.createElement("canvas");c.width=c.height=256;const ctx=c.getContext("2d");
          ctx.fillStyle="#284b3f";ctx.fillRect(0,0,256,256);ctx.fillStyle="#ffffff";ctx.fillRect(64,64,128,128);
          people[0].photoUrl=c.toDataURL();
          window.__treeProbe.render(people,[{id:"f",partnerIds:["court","long"],childIds:["double","sans"],relationType:"marriage"}]);
        },fixture);
        const before = await page.evaluate(()=>({camera:window.__treeProbe.state,positions:[...window.__treeProbe.layout().positions],portal:document.getElementById("printPortal")?.innerHTML}));
        const files = {};
        for (const [format,selector] of [["svg",'[data-export-format="svg"]'],["png",'[data-export-format="png"]']]) {
          await page.locator("#treeMoreBtn").click();
          await page.locator("#menuExportTreeBtn").click();
          await page.locator("#treeExportDialog").waitFor({state:"visible"});
          const pending = page.waitForEvent("download");await page.locator(selector).click();const download=await pending;
          const path=join(SHOT_DIR,`export-${engineName}-${width}.${format}`);await download.saveAs(path);files[format]=await readFile(path);
          await page.waitForFunction(()=>document.getElementById("menuExportTreeBtn").disabled===false);
        }
        const svg=files.svg.toString("utf8");
        assert.ok(!svg.includes("foreignObject"),"Le texte reste SVG natif et vectoriel");
        assert.match(svg, /href="data:image\/png;base64,/);
        assert.doesNotMatch(svg, /href="https?:/);
        assert.match(svg, /de La Roche-Saint-André/); // texte intégral dans le descriptif
        assert.match(svg, /clip-path="url\(#export-card-/);
        const dimensions=[files.png.readUInt32BE(16),files.png.readUInt32BE(20)];
        if(referenceDimensions) assert.deepEqual(dimensions,referenceDimensions,"La résolution ne dépend pas du viewport");
        referenceDimensions=dimensions;
        assert.ok(dimensions[0]*dimensions[1]<=32_000_000 && Math.max(...dimensions)<=8192);
        const after=await page.evaluate(()=>({camera:window.__treeProbe.state,positions:[...window.__treeProbe.layout().positions],portal:document.getElementById("printPortal")?.innerHTML}));
        assert.deepEqual(after,before,"Caméra, positions et portail d’impression intacts");
        // Inspection SVG autonome : clips par carte et texte en plusieurs lignes.
        const exportPage=await context.newPage();
        await exportPage.setContent(svg);
        const geometry=await exportPage.evaluate(()=>{
          const root=document.querySelector("svg");
          return {width:root.width.baseVal.value,height:root.height.baseVal.value,
            cards:[...root.querySelectorAll('g[transform]')].map(g=>({clip:g.querySelector('g[clip-path]')?.getAttribute('clip-path'),text:g.querySelectorAll('text').length})),
            fonts:[...root.querySelectorAll("text")].map(t=>t.getAttribute("font-size"))};
        });
        assert.equal(geometry.cards.length,4);
        assert.ok(geometry.cards.every(c=>c.clip&&c.text>0));
        assert.ok(geometry.fonts.includes("11px"),"Les événements reprennent la taille écran");
        // Comparaison visuelle carte HTML / SVG à échelle 1 et zoom vectoriel ×3.
        if(width===390) {
          for(const id of ["court","long","double"]) {
            await page.evaluate(id=>{
              const old=document.getElementById("test-card-preview");old?.remove();
              const copy=document.querySelector(`[data-person-id="${id}"]`).cloneNode(true);
              copy.id="test-card-preview";copy.style.cssText="position:fixed;left:0;top:0;transform:none;z-index:9999;";document.body.append(copy);
            },id);
            await page.locator("#test-card-preview").screenshot({path:join(SHOT_DIR,`carte-ecran-${engineName}-${id}.png`)});
            await page.evaluate(()=>document.getElementById("test-card-preview").remove());
          }
          await exportPage.setViewportSize({width:1440,height:900});
          await exportPage.locator("svg").screenshot({path:join(SHOT_DIR,`arbre-svg-${engineName}.png`)});
          await exportPage.evaluate(()=>{const svg=document.querySelector("svg");const card=svg.querySelector('g[transform]');const b=card.getBBox();const matrix=card.transform.baseVal.consolidate().matrix;svg.setAttribute("viewBox",`${matrix.e+b.x} ${matrix.f+b.y} ${b.width} ${b.height}`);svg.setAttribute("width","846");svg.setAttribute("height","474");});
          await exportPage.locator("svg").screenshot({path:join(SHOT_DIR,`carte-svg-zoom-${engineName}.png`)});
        }
        console.log(`${engineName} ${width}px : SVG autonome, PNG ${dimensions.join("×")}, scope/caméra/printPortal inchangés`);
        await context.close();
      }
    } finally {await browser.close();}
  }
} finally {await server.close();}
