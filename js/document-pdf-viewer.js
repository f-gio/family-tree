const PDFJS_MODULE_URL = new URL("../vendor/pdfjs/build/pdf.mjs", import.meta.url);
const PDFJS_WORKER_URL = new URL("../vendor/pdfjs/build/pdf.worker.mjs", import.meta.url);
const PDFJS_CMAPS_URL = new URL("../vendor/pdfjs/cmaps/", import.meta.url).href;
const PDFJS_FONTS_URL = new URL("../vendor/pdfjs/standard_fonts/", import.meta.url).href;
const PDFJS_WASM_URL = new URL("../vendor/pdfjs/wasm/", import.meta.url).href;
const PDFJS_ICC_URL = new URL("../vendor/pdfjs/iccs/", import.meta.url).href;
const MAX_CANVAS_PIXELS = 20_000_000;
const MAX_THUMBNAILS_RENDERING = 1;

export async function createDocumentPdfViewer({
  source,
  viewer,
  loadingMessage,
  thumbnailRail,
  thumbnailList,
  pageViewport,
  pageCanvas,
  pageStatus,
  previousButton,
  nextButton,
  zoomOutButton,
  zoomInButton,
  fitModeButton,
  thumbnailsButton,
  fullscreenButton,
  fullscreenHost,
  fullscreenRoot,
  zoomIndicator,
  nativeFallbackMessage,
  maxZoom = 6
} = {}) {
  if (!source || !viewer || !pageViewport || !pageCanvas) throw new TypeError("Les éléments du lecteur PDF sont requis");

  const doc = viewer.ownerDocument;
  const win = doc.defaultView || globalThis;
  const toolbar = previousButton?.closest("#viewerPdfControls");
  const fullscreenElement = fullscreenRoot || fullscreenHost || viewer;
  const fullscreenDocument = fullscreenHost?.ownerDocument || doc;
  let pdfDocument = null;
  let loadingTask = null;
  let activeRenderTask = null;
  let renderGeneration = 0;
  let resizeObserver = null;
  let thumbnailObserver = null;
  let thumbnailTimer = null;
  let zoomIndicatorTimer = null;
  let thumbnailQueue = [];
  let thumbnailTasks = new Map();
  let activeThumbnailRenders = 0;
  let fullscreenStyleSnapshots = null;
  let destroyed = false;
  let currentPage = 1;
  let zoom = 1;
  let fitMode = "page";
  let pdfScale = 1;
  let mainPageProxy = null;
  let pinch = null;
  let fallbackReason = "";

  function displayZoom() {
    if (!zoomIndicator) return;
    if (zoomIndicatorTimer !== null) win.clearTimeout(zoomIndicatorTimer);
    zoomIndicator.textContent = `${Math.round(zoom * 100)} %`;
    zoomIndicator.classList.add("is-visible");
    zoomIndicatorTimer = win.setTimeout(() => {
      zoomIndicator.classList.remove("is-visible");
      zoomIndicatorTimer = null;
    }, 1500);
  }

  function nativeFullscreenActive() {
    return !!fullscreenHost && (fullscreenDocument.fullscreenElement === fullscreenHost || fullscreenDocument.webkitFullscreenElement === fullscreenHost);
  }

  function updateFullscreenButton(active) {
    if (!fullscreenButton) return;
    const label = active ? "Quitter le plein écran" : "Afficher en plein écran";
    fullscreenButton.setAttribute("aria-label", label);
    fullscreenButton.title = label;
    fullscreenButton.querySelector("use")?.setAttribute("href", active ? "#icon-minimize" : "#icon-maximize");
  }

  function setFullscreen(active, fallback = false) {
    fullscreenElement.classList.toggle("is-viewer-fullscreen", active);
    fullscreenElement.classList.toggle("is-viewer-fullscreen-fallback", active && fallback);
    doc.documentElement.classList.toggle("viewer-fullscreen-active", active && fallback);
    updateFullscreenButton(active);
  }

  async function exitFullscreen() {
    if (nativeFullscreenActive()) {
      const exit = fullscreenDocument.exitFullscreen || fullscreenDocument.webkitExitFullscreen;
      if (typeof exit === "function") {
        try { await exit.call(fullscreenDocument); }
        catch { return false; }
      }
    }
    setFullscreen(false);
    return true;
  }

  async function toggleFullscreen() {
    if (fullscreenElement.classList.contains("is-viewer-fullscreen")) return exitFullscreen();
    const request = fullscreenHost?.requestFullscreen || fullscreenHost?.webkitRequestFullscreen;
    if (typeof request === "function") {
      try {
        if (request === fullscreenHost.webkitRequestFullscreen) await request.call(fullscreenHost);
        else await request.call(fullscreenHost, { navigationUI: "hide" });
        setFullscreen(true);
        return true;
      } catch { /* Le lecteur utilise le repli plein viewport si l’API native échoue. */ }
    }
    setFullscreen(true, true);
    return true;
  }

  function onFullscreenButtonClick() { void toggleFullscreen(); }
  function onFullscreenChange() {
    if (nativeFullscreenActive()) setFullscreen(true);
    else if (fullscreenElement.classList.contains("is-viewer-fullscreen") && !fullscreenElement.classList.contains("is-viewer-fullscreen-fallback")) setFullscreen(false);
  }
  function onKeydown(event) {
    if (event.key !== "Escape" || !fullscreenElement.classList.contains("is-viewer-fullscreen")) return;
    event.preventDefault();
    event.stopPropagation();
    void exitFullscreen();
  }

  function cleanupFullscreen() {
    if (nativeFullscreenActive()) {
      const exit = fullscreenDocument.exitFullscreen || fullscreenDocument.webkitExitFullscreen;
      if (typeof exit === "function") Promise.resolve(exit.call(fullscreenDocument)).catch(() => {});
    }
    setFullscreen(false);
  }

  function setFitModeButton() {
    if (!fitModeButton) return;
    const actionLabel = fitMode === "page" ? "Ajuster à la largeur" : "Ajuster à la page";
    fitModeButton.setAttribute("aria-label", actionLabel);
    fitModeButton.title = actionLabel;
    fitModeButton.querySelector("use")?.setAttribute("href", fitMode === "page" ? "#icon-fit-width" : "#icon-fit");
    fitModeButton.setAttribute("aria-pressed", String(fitMode === "width"));
  }

  function updatePageControls() {
    if (!pdfDocument) return;
    pageStatus.value = `Page ${currentPage} / ${pdfDocument.numPages}`;
    pageStatus.textContent = pageStatus.value;
    previousButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= pdfDocument.numPages;
    for (const button of thumbnailList.querySelectorAll("[data-pdf-page]")) {
      const selected = Number(button.dataset.pdfPage) === currentPage;
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    setFitModeButton();
  }

  async function renderPage({ preservePoint = null } = {}) {
    if (!pdfDocument || destroyed) return;
    const generation = ++renderGeneration;
    activeRenderTask?.cancel();
    activeRenderTask = null;
    const previousRect = pageCanvas.getBoundingClientRect();
    const viewportRect = pageViewport.getBoundingClientRect();
    const point = preservePoint || { x: pageViewport.clientWidth / 2, y: pageViewport.clientHeight / 2 };
    const ratioX = preservePoint?.ratioX ?? (previousRect.width ? (point.x + viewportRect.left - previousRect.left) / previousRect.width : 0.5);
    const ratioY = preservePoint?.ratioY ?? (previousRect.height ? (point.y + viewportRect.top - previousRect.top) / previousRect.height : 0.5);
    const page = await pdfDocument.getPage(currentPage);
    if (destroyed || generation !== renderGeneration) return;
    mainPageProxy = page;
    const containerWidth = Math.max(1, pageViewport.clientWidth - 32);
    const containerHeight = Math.max(1, pageViewport.clientHeight - 32);
    const baseViewport = page.getViewport({ scale: 1 });
    pdfScale = fitMode === "width"
      ? containerWidth / baseViewport.width
      : Math.min(containerWidth / baseViewport.width, containerHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: pdfScale * zoom });
    const outputScale = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)));
    pageCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    pageCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    pageCanvas.style.width = `${viewport.width}px`;
    pageCanvas.style.height = `${viewport.height}px`;
    const context = pageCanvas.getContext("2d", { alpha: false });
    context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
    const renderTask = page.render({ canvas: pageCanvas, canvasContext: context, viewport, background: "#fff" });
    activeRenderTask = renderTask;
    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") throw error;
      return;
    } finally {
      if (activeRenderTask === renderTask) activeRenderTask = null;
    }
    if (destroyed || generation !== renderGeneration) return;
    const nextRect = pageCanvas.getBoundingClientRect();
    pageViewport.scrollLeft = Math.max(0, pageViewport.scrollLeft + ratioX * nextRect.width - (point.x + viewportRect.left - nextRect.left));
    pageViewport.scrollTop = Math.max(0, pageViewport.scrollTop + ratioY * nextRect.height - (point.y + viewportRect.top - nextRect.top));
    updatePageControls();
    enqueueThumbnail(currentPage);
  }

  function reportRenderError(error) {
    if (destroyed || error?.name === "RenderingCancelledException") return;
    loadingMessage.textContent = "Impossible de rendre cette page PDF.";
    loadingMessage.hidden = false;
    console.error("Rendu PDF impossible", error);
  }

  function startRender(options) {
    void renderPage(options).catch(reportRenderError);
  }

  function enqueueThumbnail(pageNumber) {
    const button = thumbnailList.querySelector(`[data-pdf-page="${pageNumber}"]`);
    if (!button || button.dataset.rendered === "true" || button.dataset.queued === "true") return;
    if (button.dataset.visible !== "true" && pageNumber !== currentPage) return;
    button.dataset.queued = "true";
    thumbnailQueue.push(pageNumber);
    void pumpThumbnailQueue();
  }

  async function renderThumbnail(pageNumber) {
    const button = thumbnailList.querySelector(`[data-pdf-page="${pageNumber}"]`);
    const canvas = button?.querySelector("canvas");
    if (!button || !canvas || !pdfDocument || destroyed) return;
    const page = await pdfDocument.getPage(pageNumber);
    if (destroyed || (button.dataset.visible !== "true" && pageNumber !== currentPage)) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(92 / baseViewport.width, 126 / baseViewport.height);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d", { alpha: false });
    const task = page.render({ canvas, canvasContext: context, viewport, background: "#fff" });
    thumbnailTasks.set(pageNumber, task);
    try {
      await task.promise;
      if (!destroyed && (button.dataset.visible === "true" || pageNumber === currentPage)) button.dataset.rendered = "true";
      else {
        canvas.width = 0;
        canvas.height = 0;
      }
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") throw error;
    } finally {
      if (thumbnailTasks.get(pageNumber) === task) thumbnailTasks.delete(pageNumber);
      page.cleanup();
    }
  }

  async function pumpThumbnailQueue() {
    if (activeThumbnailRenders >= MAX_THUMBNAILS_RENDERING || destroyed) return;
    const pageNumber = thumbnailQueue.shift();
    if (!pageNumber) return;
    activeThumbnailRenders++;
    const button = thumbnailList.querySelector(`[data-pdf-page="${pageNumber}"]`);
    if (button) delete button.dataset.queued;
    try { await renderThumbnail(pageNumber); }
    catch { /* Une miniature en échec ne bloque pas le reste de la file. */ }
    finally {
      activeThumbnailRenders--;
      void pumpThumbnailQueue();
    }
  }

  function updateThumbnailVisibility(button, visible) {
    const pageNumber = Number(button.dataset.pdfPage);
    button.dataset.visible = String(visible);
    if (visible || pageNumber === currentPage) enqueueThumbnail(pageNumber);
    else if (pageNumber !== currentPage) {
      thumbnailTasks.get(pageNumber)?.cancel();
      const canvas = button.querySelector("canvas");
      if (canvas && button.dataset.rendered === "true") {
        canvas.width = 0;
        canvas.height = 0;
        delete button.dataset.rendered;
      }
      thumbnailQueue = thumbnailQueue.filter(queuedPage => queuedPage !== pageNumber);
      delete button.dataset.queued;
    }
  }

  function buildThumbnails() {
    const fragment = doc.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pdf-thumbnail";
      button.dataset.pdfPage = String(pageNumber);
      button.setAttribute("aria-label", `Afficher la page ${pageNumber}`);
      button.setAttribute("aria-pressed", "false");
      const canvas = doc.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      const caption = doc.createElement("span");
      caption.textContent = String(pageNumber);
      button.append(canvas, caption);
      button.addEventListener("click", () => { void selectPage(pageNumber); });
      fragment.append(button);
    }
    thumbnailList.replaceChildren(fragment);
    if (typeof win.IntersectionObserver === "function") {
      thumbnailObserver = new win.IntersectionObserver(entries => {
        for (const entry of entries) updateThumbnailVisibility(entry.target, entry.isIntersecting);
      }, { root: thumbnailRail, rootMargin: "120px" });
      for (const button of thumbnailList.querySelectorAll("[data-pdf-page]")) thumbnailObserver.observe(button);
    } else {
      for (const button of [...thumbnailList.querySelectorAll("[data-pdf-page]")].slice(0, 4)) updateThumbnailVisibility(button, true);
    }
  }

  function updateThumbnailToggle() {
    const expanded = !thumbnailRail.hidden;
    if (!thumbnailsButton) return;
    thumbnailsButton.setAttribute("aria-expanded", String(expanded));
    thumbnailsButton.setAttribute("aria-label", expanded ? "Masquer les miniatures" : "Afficher les miniatures");
    thumbnailsButton.title = expanded ? "Masquer les miniatures" : "Afficher les miniatures";
    thumbnailsButton.querySelector("use")?.setAttribute("href", expanded ? "#icon-panel-collapse" : "#icon-panel-expand");
  }

  async function selectPage(pageNumber) {
    if (!pdfDocument || destroyed || pageNumber < 1 || pageNumber > pdfDocument.numPages) return;
    currentPage = pageNumber;
    updatePageControls();
    thumbnailList.querySelector(`[data-pdf-page="${pageNumber}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    startRender();
  }

  async function updateZoom(nextZoom, focalPoint = null) {
    const next = Math.max(1, Math.min(maxZoom, nextZoom));
    if (next === zoom && zoomIndicator) {
      displayZoom();
      return;
    }
    zoom = next;
    displayZoom();
    await renderPage({ preservePoint: focalPoint });
  }

  function onToolbarClick(event) {
    if (event.target.closest("#pdfPreviousPageBtn")) void selectPage(currentPage - 1);
    else if (event.target.closest("#pdfNextPageBtn")) void selectPage(currentPage + 1);
    else if (event.target.closest("#pdfZoomInBtn")) void updateZoom(zoom * 1.25);
    else if (event.target.closest("#pdfZoomOutBtn")) void updateZoom(zoom / 1.25);
    else if (event.target.closest("#pdfFitModeBtn")) {
      fitMode = fitMode === "page" ? "width" : "page";
      zoom = 1;
      displayZoom();
      setFitModeButton();
      startRender();
    } else if (event.target.closest("#pdfThumbnailsBtn")) {
      thumbnailRail.hidden = !thumbnailRail.hidden;
      updateThumbnailToggle();
      if (!thumbnailRail.hidden) {
        for (const button of thumbnailList.querySelectorAll("[data-pdf-page]")) {
          const rect = button.getBoundingClientRect();
          const railRect = thumbnailRail.getBoundingClientRect();
          if (rect.bottom >= railRect.top && rect.top <= railRect.bottom && rect.right >= railRect.left && rect.left <= railRect.right) updateThumbnailVisibility(button, true);
        }
      }
      requestAnimationFrame(() => startRender());
    } else if (event.target.closest("#pdfFullscreenBtn")) void toggleFullscreen();
  }

  function onToolbarKeydown(event) {
    if (event.key === "ArrowLeft") void selectPage(currentPage - 1);
    else if (event.key === "ArrowRight") void selectPage(currentPage + 1);
    else if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "0") { zoom = 1; displayZoom(); startRender(); }
      else void updateZoom(zoom * (event.key === "-" ? 1 / 1.25 : 1.25));
    }
  }

  function distance(touches) {
    return Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  }

  function onTouchStart(event) {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    const midpoint = { x: (event.touches[0].clientX + event.touches[1].clientX) / 2, y: (event.touches[0].clientY + event.touches[1].clientY) / 2 };
    const canvasRect = pageCanvas.getBoundingClientRect();
    pinch = { distance: distance(event.touches), zoom, ratioX: canvasRect.width ? (midpoint.x - canvasRect.left) / canvasRect.width : 0.5, ratioY: canvasRect.height ? (midpoint.y - canvasRect.top) / canvasRect.height : 0.5, point: { x: midpoint.x - pageViewport.getBoundingClientRect().left, y: midpoint.y - pageViewport.getBoundingClientRect().top } };
  }

  function onTouchMove(event) {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const midpoint = { x: (event.touches[0].clientX + event.touches[1].clientX) / 2, y: (event.touches[0].clientY + event.touches[1].clientY) / 2 };
    const canvasRect = pageCanvas.getBoundingClientRect();
    pinch.ratioX = canvasRect.width ? (midpoint.x - canvasRect.left) / canvasRect.width : 0.5;
    pinch.ratioY = canvasRect.height ? (midpoint.y - canvasRect.top) / canvasRect.height : 0.5;
    pinch.point = { x: midpoint.x - pageViewport.getBoundingClientRect().left, y: midpoint.y - pageViewport.getBoundingClientRect().top };
    zoom = Math.max(1, Math.min(maxZoom, pinch.zoom * distance(event.touches) / pinch.distance));
    displayZoom();
    if (thumbnailTimer !== null) win.cancelAnimationFrame(thumbnailTimer);
    thumbnailTimer = win.requestAnimationFrame(() => {
      thumbnailTimer = null;
      startRender({ preservePoint: { x: pinch.point.x, y: pinch.point.y, ratioX: pinch.ratioX, ratioY: pinch.ratioY } });
    });
  }

  function onTouchEnd(event) {
    if (event.touches.length < 2) pinch = null;
  }

  function onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const rect = pageViewport.getBoundingClientRect();
    void updateZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function onResize() { startRender(); }

  function bindEvents() {
    toolbar?.addEventListener("click", onToolbarClick);
    toolbar?.addEventListener("keydown", onToolbarKeydown);
    fullscreenElement?.addEventListener("keydown", onKeydown);
    fullscreenDocument.addEventListener("fullscreenchange", onFullscreenChange);
    fullscreenDocument.addEventListener("webkitfullscreenchange", onFullscreenChange);
    pageViewport.addEventListener("touchstart", onTouchStart, { passive: false });
    pageViewport.addEventListener("touchmove", onTouchMove, { passive: false });
    pageViewport.addEventListener("touchend", onTouchEnd);
    pageViewport.addEventListener("touchcancel", onTouchEnd);
    pageViewport.addEventListener("wheel", onWheel, { passive: false });
    if (typeof win.ResizeObserver === "function") {
      resizeObserver = new win.ResizeObserver(onResize);
      resizeObserver.observe(pageViewport);
    } else win.addEventListener("resize", onResize);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    renderGeneration++;
    activeRenderTask?.cancel();
    activeRenderTask = null;
    for (const task of thumbnailTasks.values()) task.cancel();
    thumbnailTasks.clear();
    thumbnailQueue = [];
    thumbnailObserver?.disconnect();
    resizeObserver?.disconnect();
    if (thumbnailTimer !== null) win.cancelAnimationFrame(thumbnailTimer);
    if (zoomIndicatorTimer !== null) win.clearTimeout(zoomIndicatorTimer);
    zoomIndicator?.classList.remove("is-visible");
    toolbar?.removeEventListener("click", onToolbarClick);
    toolbar?.removeEventListener("keydown", onToolbarKeydown);
    fullscreenElement?.removeEventListener("keydown", onKeydown);
    fullscreenDocument.removeEventListener("fullscreenchange", onFullscreenChange);
    fullscreenDocument.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    pageViewport.removeEventListener("touchstart", onTouchStart);
    pageViewport.removeEventListener("touchmove", onTouchMove);
    pageViewport.removeEventListener("touchend", onTouchEnd);
    pageViewport.removeEventListener("touchcancel", onTouchEnd);
    pageViewport.removeEventListener("wheel", onWheel);
    win.removeEventListener("resize", onResize);
    cleanupFullscreen();
    pageCanvas.width = 0;
    pageCanvas.height = 0;
    thumbnailList.replaceChildren();
    if (loadingTask) void loadingTask.destroy().catch(() => {});
    else if (pdfDocument) void pdfDocument.destroy().catch(() => {});
    pdfDocument = null;
  }

  bindEvents();
  updateThumbnailToggle();
  updateFullscreenButton(false);
  try {
    const pdfjs = await import(PDFJS_MODULE_URL.href);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL.href;
    loadingTask = pdfjs.getDocument({
      url: source,
      cMapUrl: PDFJS_CMAPS_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_FONTS_URL,
      wasmUrl: PDFJS_WASM_URL,
      iccUrl: PDFJS_ICC_URL,
      isEvalSupported: false,
      useSystemFonts: true,
      canvasMaxAreaInBytes: MAX_CANVAS_PIXELS
    });
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    if (destroyed) throw error;
    fallbackReason = error?.message || "Lecture PDF.js indisponible";
    destroyPdfReaderState();
    return Object.freeze({ fallback: true, error: fallbackReason, destroy });
  }
  if (destroyed) return Object.freeze({ fallback: false, destroy });

  viewer.hidden = false;
  loadingMessage.hidden = true;
  pageStatus.value = `Page ${currentPage} / ${pdfDocument.numPages}`;
  pageStatus.textContent = pageStatus.value;
  buildThumbnails();
  updatePageControls();
  if (typeof win.ResizeObserver === "function") {
    resizeObserver?.observe(pageViewport);
  }
  try { await renderPage(); }
  catch (error) {
    fallbackReason = error?.message || "Rendu PDF impossible";
    destroyPdfReaderState();
    return Object.freeze({ fallback: true, error: fallbackReason, destroy });
  }

  function destroyPdfReaderState() {
    destroy();
    viewer.hidden = true;
    if (loadingMessage) {
      loadingMessage.hidden = false;
      loadingMessage.textContent = "Le lecteur PDF interactif n’est pas disponible pour cette ressource.";
    }
  }

  return Object.freeze({
    fallback: false,
    getState: () => ({ currentPage, numPages: pdfDocument?.numPages || 0, zoom, fitMode, fallbackReason }),
    selectPage,
    zoomIn: () => updateZoom(zoom * 1.25),
    zoomOut: () => updateZoom(zoom / 1.25),
    reset: () => updateZoom(1),
    destroy
  });
}
