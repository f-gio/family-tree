export function selectInitialDocumentImageMode({ naturalWidth, naturalHeight } = {}) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return "fit";
  return naturalHeight / naturalWidth >= 1.5 ? "width" : "fit";
}

export function createDocumentImageViewer({ viewport, image, controls, zoomLabel, zoomIndicator, zoomIndicatorDuration = 1500, modeButton, fullscreenButton, fullscreenHost, fullscreenRoot, initialMode = "fit", minZoom = 1, maxZoom = 6 } = {}) {
  if (!viewport || !image || !controls) throw new TypeError("Les éléments du lecteur d’image sont requis");
  let zoom = minZoom;
  let offsetX = 0;
  let offsetY = 0;
  let fitWidth = 0;
  let fitHeight = 0;
  let pinch = null;
  let panTouch = null;
  let mousePan = null;
  let observer = null;
  let fallbackResize = null;
  let zoomIndicatorTimer = null;
  let fullscreenStyleSnapshots = null;
  let mode = initialMode === "width" ? "width" : "fit";

  const fullscreenDocument = fullscreenHost?.ownerDocument || null;
  const fullscreenElement = fullscreenRoot || fullscreenHost;

  function canCustomPan() {
    return zoom > minZoom;
  }

  function clampOffsets() {
    const maxX = Math.max(0, (fitWidth * zoom - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (fitHeight * zoom - viewport.clientHeight) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
  }

  function render() {
    clampOffsets();
    const nativeWidthScroll = mode === "width" && zoom === minZoom;
    viewport.dataset.viewerFitMode = mode;
    image.style.position = nativeWidthScroll ? "relative" : "absolute";
    image.style.width = `${fitWidth}px`;
    image.style.height = `${fitHeight}px`;
    image.style.maxWidth = "none";
    image.style.maxHeight = "none";
    if (!nativeWidthScroll) {
      image.style.width = `${fitWidth * zoom}px`;
      image.style.height = `${fitHeight * zoom}px`;
    }
    image.style.left = nativeWidthScroll ? "auto" : `calc(50% + ${offsetX}px)`;
    image.style.top = nativeWidthScroll ? "auto" : `calc(50% + ${offsetY}px)`;
    image.style.margin = nativeWidthScroll ? "0 auto" : "0";
    image.style.transform = nativeWidthScroll ? "none" : "translate(-50%, -50%)";
    if (zoomLabel) zoomLabel.textContent = zoom <= minZoom ? (mode === "width" ? "Largeur" : "Ajusté") : `${Math.round(zoom * 100)} %`;
  }

  function showZoomIndicator() {
    if (!zoomIndicator) return;
    if (zoomIndicatorTimer !== null) globalThis.clearTimeout(zoomIndicatorTimer);
    zoomIndicator.textContent = `${Math.round(zoom / minZoom * 100)} %`;
    zoomIndicator.classList.add("is-visible");
    zoomIndicatorTimer = globalThis.setTimeout(() => {
      zoomIndicator.classList.remove("is-visible");
      zoomIndicatorTimer = null;
    }, zoomIndicatorDuration);
  }

  function nativeFullscreenActive() {
    return !!fullscreenHost && (fullscreenDocument?.fullscreenElement === fullscreenHost || fullscreenDocument?.webkitFullscreenElement === fullscreenHost);
  }

  function setFullscreenLayout(active) {
    const nodes = [fullscreenElement, fullscreenElement?.querySelector(".modal-body"), fullscreenElement?.querySelector(".document-unified-layout"), fullscreenElement?.querySelector(".document-original-panel"), viewport];
    const properties = ["position", "inset", "width", "height", "max-width", "max-height", "margin", "padding", "overflow", "display", "flex", "flex-direction", "min-height", "grid-template-columns", "grid-template-rows", "gap"];
    if (active) {
      if (!fullscreenStyleSnapshots) fullscreenStyleSnapshots = nodes.map(node => node ? [node, properties.map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)])] : null);
      const set = (node, values) => {
        if (!node) return;
        for (const [property, value] of Object.entries(values)) node.style.setProperty(property, value, "important");
      };
      set(nodes[0], { position: "fixed", inset: "0", width: "100vw", height: "100dvh", "max-width": "none", "max-height": "none", margin: "0", padding: "0", overflow: "hidden" });
      set(nodes[1], { display: "flex", flex: "1 1 auto", "flex-direction": "column", "min-height": "0", padding: "0", overflow: "hidden" });
      set(nodes[2], { display: "grid", "grid-template-columns": "minmax(0, 1fr)", "grid-template-rows": "minmax(0, 1fr)", flex: "1 1 auto", width: "100%", height: "100%", "min-height": "0", gap: "0" });
      set(nodes[3], { display: "flex", flex: "1 1 auto", height: "100%", "min-height": "0" });
      set(nodes[4], { flex: "1 1 auto", height: "auto", "min-height": "0" });
      return;
    }
    if (!fullscreenStyleSnapshots) return;
    for (const snapshot of fullscreenStyleSnapshots) {
      if (!snapshot) continue;
      const [node, entries] = snapshot;
      for (const [property, value, priority] of entries) {
        if (value) node.style.setProperty(property, value, priority);
        else node.style.removeProperty(property);
      }
    }
    fullscreenStyleSnapshots = null;
  }

  function setFullscreenState(active, fallback = false) {
    setFullscreenLayout(active);
    fullscreenElement?.classList.toggle("is-viewer-fullscreen", active);
    fullscreenElement?.classList.toggle("is-viewer-fullscreen-fallback", active && fallback);
    fullscreenElement?.ownerDocument?.documentElement.classList.toggle("viewer-fullscreen-active", active && fallback);
    if (fullscreenButton) {
      fullscreenButton.setAttribute("aria-label", active ? "Quitter le plein écran" : "Afficher en plein écran");
      fullscreenButton.title = active ? "Quitter le plein écran" : "Afficher en plein écran";
      fullscreenButton.querySelector("use")?.setAttribute("href", active ? "#icon-minimize" : "#icon-maximize");
    }
  }

  async function exitFullscreen() {
    if (nativeFullscreenActive()) {
      const exit = fullscreenDocument.exitFullscreen || fullscreenDocument.webkitExitFullscreen;
      if (typeof exit === "function") {
        try { await exit.call(fullscreenDocument); }
        catch { return false; }
      }
    }
    setFullscreenState(false);
    return true;
  }

  async function toggleFullscreen() {
    if (!fullscreenElement) return false;
    if (fullscreenElement.classList.contains("is-viewer-fullscreen")) return exitFullscreen();
    const request = fullscreenHost?.requestFullscreen || fullscreenHost?.webkitRequestFullscreen;
    if (typeof request === "function") {
      try {
        if (request === fullscreenHost.webkitRequestFullscreen) await request.call(fullscreenHost);
        else await request.call(fullscreenHost, { navigationUI: "hide" });
        setFullscreenState(true);
        return true;
      } catch { /* Le lecteur passe en mode plein viewport si le navigateur refuse l’API. */ }
    }
    setFullscreenState(true, true);
    return true;
  }

  function onFullscreenChange() {
    if (nativeFullscreenActive()) setFullscreenState(true);
    else if (fullscreenElement?.classList.contains("is-viewer-fullscreen") && !fullscreenElement.classList.contains("is-viewer-fullscreen-fallback")) setFullscreenState(false);
  }

  function onFullscreenKeydown(event) {
    if (event.key !== "Escape" || !fullscreenElement?.classList.contains("is-viewer-fullscreen")) return;
    event.preventDefault();
    event.stopPropagation();
    void exitFullscreen();
  }

  function fit() {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = mode === "width" ? rect.width / image.naturalWidth : Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    fitWidth = image.naturalWidth * scale;
    fitHeight = image.naturalHeight * scale;
    render();
  }

  function setZoom(nextZoom, focal = null) {
    const next = Math.max(minZoom, Math.min(maxZoom, nextZoom));
    if (mode === "width" && zoom === minZoom && next > minZoom) viewport.scrollTop = 0;
    if (focal && next !== zoom) {
      const viewportRect = viewport.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const imageCenterX = imageRect.left - viewportRect.left + imageRect.width / 2;
      const imageCenterY = imageRect.top - viewportRect.top + imageRect.height / 2;
      const imagePointX = (focal.x - imageCenterX) / zoom;
      const imagePointY = (focal.y - imageCenterY) / zoom;
      offsetX = focal.x - imagePointX * next - viewport.clientWidth / 2;
      offsetY = focal.y - imagePointY * next - viewport.clientHeight / 2;
      if (mode === "width" && zoom === minZoom) viewport.scrollTop = 0;
    } else if (next === minZoom) {
      offsetX = 0;
      offsetY = 0;
    }
    zoom = next;
    render();
    showZoomIndicator();
  }

  const distance = touches => Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  const center = touches => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });

  function onTouchStart(event) {
    if (event.touches.length >= 2) {
      event.preventDefault();
      const midpoint = center(event.touches);
      const rect = viewport.getBoundingClientRect();
      pinch = {
        distance: distance(event.touches),
        zoom,
        imageX: (midpoint.x - rect.left - (image.getBoundingClientRect().left - rect.left + image.getBoundingClientRect().width / 2)) / zoom,
        imageY: (midpoint.y - rect.top - (image.getBoundingClientRect().top - rect.top + image.getBoundingClientRect().height / 2)) / zoom
      };
    } else if (canCustomPan() && event.touches.length === 1) {
      panTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY, offsetX, offsetY };
    }
  }

  function onTouchMove(event) {
    if (event.touches.length >= 2 && pinch) {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const midpoint = center(event.touches);
      const focalX = midpoint.x - rect.left;
      const focalY = midpoint.y - rect.top;
      zoom = Math.max(minZoom, Math.min(maxZoom, pinch.zoom * distance(event.touches) / pinch.distance));
      offsetX = focalX - pinch.imageX * zoom - viewport.clientWidth / 2;
      offsetY = focalY - pinch.imageY * zoom - viewport.clientHeight / 2;
      if (mode === "width" && zoom > minZoom) viewport.scrollTop = 0;
      render();
      showZoomIndicator();
    } else if (event.touches.length === 1 && canCustomPan() && panTouch) {
      event.preventDefault();
      offsetX = panTouch.offsetX + event.touches[0].clientX - panTouch.x;
      offsetY = panTouch.offsetY + event.touches[0].clientY - panTouch.y;
      render();
    }
  }

  function onTouchEnd(event) {
    if (event.touches.length < 2) pinch = null;
    if (event.touches.length === 0) panTouch = null;
    else if (event.touches.length === 1 && canCustomPan()) {
      panTouch = { x: event.touches[0].clientX, y: event.touches[0].clientY, offsetX, offsetY };
    }
  }

  function onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function onPointerDown(event) {
    if (event.pointerType !== "mouse" || !canCustomPan()) return;
    mousePan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX, offsetY };
    viewport.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (!mousePan || mousePan.pointerId !== event.pointerId) return;
    offsetX = mousePan.offsetX + event.clientX - mousePan.x;
    offsetY = mousePan.offsetY + event.clientY - mousePan.y;
    render();
  }

  function onPointerEnd(event) {
    if (mousePan?.pointerId === event.pointerId) mousePan = null;
  }

  function onControlsClick(event) {
    const modeToggle = event.target.closest("[data-viewer-image-mode-toggle]");
    if (modeToggle) {
      mode = mode === "fit" ? "width" : "fit";
      zoom = minZoom;
      offsetX = 0;
      offsetY = 0;
      viewport.scrollTop = 0;
      fit();
      updateModeButton();
      showZoomIndicator();
      return;
    }
    const button = event.target.closest("[data-viewer-image-zoom]");
    if (!button) return;
    if (button.dataset.viewerImageZoom === "reset") setZoom(minZoom);
    else setZoom(zoom * (button.dataset.viewerImageZoom === "in" ? 1.25 : 1 / 1.25));
  }

  function onControlsKeydown(event) {
    if (!["+", "=", "-", "0"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "0") setZoom(minZoom);
    else setZoom(zoom * (event.key === "-" ? 1 / 1.25 : 1.25));
  }

  function updateModeButton() {
    if (!modeButton) return;
    const actionLabel = mode === "fit" ? "Ajuster à la largeur" : "Ajuster à la fenêtre";
    modeButton.setAttribute("aria-label", actionLabel);
    modeButton.title = actionLabel;
    modeButton.querySelector("use")?.setAttribute("href", mode === "fit" ? "#icon-fit-width" : "#icon-fit");
    modeButton.setAttribute("aria-pressed", String(mode === "width"));
  }

  function onFullscreenButtonClick() {
    void toggleFullscreen();
  }

  function onFullscreenRootKeydown(event) {
    onFullscreenKeydown(event);
  }

  viewport.addEventListener("touchstart", onTouchStart, { passive: false });
  viewport.addEventListener("touchmove", onTouchMove, { passive: false });
  viewport.addEventListener("touchend", onTouchEnd);
  viewport.addEventListener("touchcancel", onTouchEnd);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerEnd);
  viewport.addEventListener("pointercancel", onPointerEnd);
  controls.addEventListener("click", onControlsClick);
  controls.addEventListener("keydown", onControlsKeydown);
  fullscreenButton?.addEventListener("click", onFullscreenButtonClick);
  fullscreenElement?.addEventListener("keydown", onFullscreenRootKeydown);
  fullscreenDocument?.addEventListener("fullscreenchange", onFullscreenChange);
  fullscreenDocument?.addEventListener("webkitfullscreenchange", onFullscreenChange);
  image.addEventListener("load", fit);
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(fit);
    observer.observe(viewport);
  } else {
    fallbackResize = fit;
    globalThis.addEventListener?.("resize", fallbackResize);
  }
  updateModeButton();
  if (image.complete) fit();

  return Object.freeze({
    fit,
    zoomIn: () => setZoom(zoom * 1.25),
    zoomOut: () => setZoom(zoom / 1.25),
    reset: () => setZoom(minZoom),
    toggleFullscreen,
    exitFullscreen,
    toggleFitMode() {
      mode = mode === "fit" ? "width" : "fit";
      zoom = minZoom;
      offsetX = 0;
      offsetY = 0;
      fit();
      updateModeButton();
      showZoomIndicator();
    },
    getState: () => ({ zoom, offsetX, offsetY, fitWidth, fitHeight, mode }),
    destroy() {
      if (zoomIndicatorTimer !== null) globalThis.clearTimeout(zoomIndicatorTimer);
      zoomIndicatorTimer = null;
      zoomIndicator?.classList.remove("is-visible");
      if (nativeFullscreenActive()) {
        const exit = fullscreenDocument.exitFullscreen || fullscreenDocument.webkitExitFullscreen;
        if (typeof exit === "function") Promise.resolve(exit.call(fullscreenDocument)).catch(() => {});
      }
      setFullscreenState(false);
      observer?.disconnect();
      if (fallbackResize) globalThis.removeEventListener?.("resize", fallbackResize);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);
      viewport.removeEventListener("touchcancel", onTouchEnd);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      controls.removeEventListener("click", onControlsClick);
      controls.removeEventListener("keydown", onControlsKeydown);
      fullscreenButton?.removeEventListener("click", onFullscreenButtonClick);
      fullscreenElement?.removeEventListener("keydown", onFullscreenRootKeydown);
      fullscreenDocument?.removeEventListener("fullscreenchange", onFullscreenChange);
      fullscreenDocument?.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      image.removeEventListener("load", fit);
      image.removeAttribute("style");
    }
  });
}
