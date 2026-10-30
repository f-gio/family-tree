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
  let zoomedScrollLayout = false;
  let fitOverflowHidden = false;
  let scrollLayoutFrame = null;
  const viewportScrollStyle = ["display", "height", "min-height", "overflow-x", "overflow-y", "padding-top"]
    .map(property => [property, viewport.style.getPropertyValue(property), viewport.style.getPropertyPriority(property)]);
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

  function restoreViewportScrollStyle() {
    if (!zoomedScrollLayout && !fitOverflowHidden) return;
    for (const [property, value, priority] of viewportScrollStyle) {
      if (fitOverflowHidden && property !== "overflow-x" && property !== "overflow-y" && !zoomedScrollLayout) continue;
      if (value) viewport.style.setProperty(property, value, priority);
      else viewport.style.removeProperty(property);
    }
    zoomedScrollLayout = false;
    fitOverflowHidden = false;
  }

  function syncVerticalOffsetFromScroll() {
    if (zoom <= minZoom || !zoomedScrollLayout) return;
    const maxY = Math.max(0, viewport.scrollHeight - viewport.clientHeight) / 2;
    offsetY = Math.max(-maxY, Math.min(maxY, maxY - viewport.scrollTop));
  }

  function reconcileVerticalScrollbar() {
    if (zoom <= minZoom || !zoomedScrollLayout) return;
    const range = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const maxY = range / 2;
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    const target = Math.max(0, Math.min(range, maxY - offsetY));
    if (Math.abs(viewport.scrollTop - target) > 0.5) viewport.scrollTop = target;
  }

  function scheduleVerticalScrollbarReconciliation() {
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame !== "function") return;
    if (scrollLayoutFrame !== null) globalThis.cancelAnimationFrame?.(scrollLayoutFrame);
    let frames = 0;
    const reconcile = () => {
      scrollLayoutFrame = null;
      reconcileVerticalScrollbar();
      /* WebKit may update the scrollable overflow after its image layout and
         ResizeObserver delivery; reconcile a short bounded number of frames. */
      if (++frames < 5) scrollLayoutFrame = requestFrame(reconcile);
    };
    scrollLayoutFrame = requestFrame(reconcile);
  }

  function render() {
    const nativeWidthScroll = mode === "width" && zoom === minZoom;
    const customZoomLayout = zoom > minZoom;
    if (!customZoomLayout || !zoomedScrollLayout) clampOffsets();
    viewport.dataset.viewerFitMode = mode;
    /* Lot corrections : l'image agrandie reprend la main sur les gestes
       verticaux (sinon touch-action: pan-y laisse le pan au navigateur et la
       séquence tactile personnelle est interrompue). À sa taille, le défilement
       natif reste inchangé. */
    viewport.style.touchAction = zoom > minZoom ? "none" : "";
    if (customZoomLayout) {
      if (fitOverflowHidden) restoreViewportScrollStyle();
      /* En zoom, l'image redevient un contenu vertical défilable. La position
         du scrollbar natif représente ainsi directement la fenêtre visible ;
         offsetY reste la coordonnée de pan canonique pour la molette, le
         pointeur et le tactile. L'axe horizontal reste géré par offsetX. */
      zoomedScrollLayout = true;
      const imageHeight = fitHeight * zoom;
      viewport.style.display = "block";
      viewport.style.overflowX = "hidden";
      viewport.style.overflowY = "auto";
      viewport.style.paddingTop = "0px";
      if (mode === "width" && globalThis.matchMedia?.("(max-width: 760px)").matches) {
        viewport.style.height = "min(68dvh, calc(100dvh - 13rem))";
        viewport.style.minHeight = "12rem";
      }
      image.style.position = "relative";
      image.style.display = "block";
      image.style.width = `${fitWidth * zoom}px`;
      image.style.height = `${imageHeight}px`;
      image.style.left = `${offsetX}px`;
      image.style.top = "0px";
      image.style.margin = "0 auto";
      image.style.transform = "none";
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      const renderedImage = image.getBoundingClientRect();
      const verticalInset = Math.max(0, (viewport.clientHeight - renderedImage.height) / 2);
      viewport.style.paddingTop = `${verticalInset}px`;
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const maxY = maxScroll / 2;
      const maxX = Math.max(0, (renderedImage.width - viewport.clientWidth) / 2);
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
      image.style.left = `${offsetX - maxX}px`;
      const nextScrollTop = Math.max(0, Math.min(maxScroll, maxY - offsetY));
      if (Math.abs(viewport.scrollTop - nextScrollTop) > 0.5) viewport.scrollTop = nextScrollTop;
      scheduleVerticalScrollbarReconciliation();
    } else {
      if (zoomedScrollLayout) viewport.scrollTop = 0;
      restoreViewportScrollStyle();
      if (!nativeWidthScroll) {
        /* En mode Ajuster, l'image entière tient dans le lecteur. Des limites
           d'overflow résiduelles des offsets absolus ne doivent pas laisser
           apparaître une barre de défilement fantôme. */
        viewport.style.overflowX = "hidden";
        viewport.style.overflowY = "hidden";
        fitOverflowHidden = true;
      }
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
    }
    if (zoomLabel) zoomLabel.textContent = zoom <= minZoom ? (mode === "width" ? "Largeur" : "Ajusté") : `${Math.round(zoom * 100)} %`;
  }

  function onViewportScroll() {
    if (zoom <= minZoom || !zoomedScrollLayout) return;
    const previousOffsetY = offsetY;
    syncVerticalOffsetFromScroll();
    if (Math.abs(previousOffsetY - offsetY) > 0.25) render();
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
    const properties = ["position", "inset", "width", "height", "max-width", "max-height", "margin", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "overflow", "display", "flex", "flex-direction", "min-height", "grid-template-columns", "grid-template-rows", "gap"];
    if (active) {
      if (!fullscreenStyleSnapshots) fullscreenStyleSnapshots = nodes.map(node => node ? [node, properties.map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)])] : null);
      const set = (node, values) => {
        if (!node) return;
        for (const [property, value] of Object.entries(values)) node.style.setProperty(property, value, "important");
      };
      const safeAreaPadding = readFullscreenSafeAreaPadding();
      set(nodes[0], { position: "fixed", inset: "0", width: "100vw", height: "100dvh", "max-width": "none", "max-height": "none", margin: "0", padding: "0", ...safeAreaPadding, overflow: "hidden" });
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

  function readFullscreenSafeAreaPadding() {
    const documentElement = fullscreenDocument?.documentElement;
    if (!documentElement) return { padding: "12px" };
    const probe = fullscreenDocument.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:var(--space-3)";
    documentElement.append(probe);
    const base = Number.parseFloat(getComputedStyle(probe).paddingTop) || 12;
    const padding = { padding: `${base}px` };
    for (const side of ["top", "right", "bottom", "left"]) {
      probe.style.padding = "0px";
      probe.style.setProperty(`padding-${side}`, `env(safe-area-inset-${side}, 0px)`);
      const inset = Number.parseFloat(getComputedStyle(probe).getPropertyValue(`padding-${side}`)) || 0;
      padding[`padding-${side}`] = `${Math.max(base, inset)}px`;
      probe.style.removeProperty(`padding-${side}`);
    }
    probe.remove();
    return padding;
  }

  function setFullscreenState(active, fallback = false) {
    setFullscreenLayout(active);
    fullscreenElement?.classList.toggle("is-viewer-fullscreen", active);
    fullscreenElement?.classList.toggle("is-viewer-fullscreen-fallback", active && fallback);
    fullscreenElement?.ownerDocument?.documentElement.classList.toggle("viewer-fullscreen-active", active && fallback);
    /* Safari iOS : le topbar du site porte un backdrop-filter qui crée sa propre
       couche composite, peinte au-dessus d'un position:fixed. On le masque
       pendant le repli (et uniquement en repli) puis on restaure sa visibilité. */
    const topbar = fullscreenDocument?.getElementById?.("topbar");
    if (topbar) {
      if (active && fallback) {
        if (topbar.dataset.viewerFullscreenPrevVisibility === undefined) {
          topbar.dataset.viewerFullscreenPrevVisibility = topbar.style.visibility || "";
        }
        topbar.style.visibility = "hidden";
      } else if (!active || !fallback) {
        if (topbar.dataset.viewerFullscreenPrevVisibility !== undefined) {
          topbar.style.visibility = topbar.dataset.viewerFullscreenPrevVisibility;
          delete topbar.dataset.viewerFullscreenPrevVisibility;
        }
      }
    }
    if (fullscreenButton) {
      fullscreenButton.setAttribute("aria-label", active ? "Quitter le plein écran" : "Afficher en plein écran");
      fullscreenButton.title = active ? "Quitter le plein écran" : "Afficher en plein écran";
      fullscreenButton.querySelector("use")?.setAttribute("href", active ? "#icon-minimize" : "#icon-maximize");
    }
    /* La surface change de dimensions à l'entrée/sortie du repli. Recalcule
       l'ajustement avant de resynchroniser le scrollbar et conserve le pan
       dans les nouvelles limites du viewport. */
    if (image.complete && image.naturalWidth) fit();
    /* En sortie de repli, la page mobile reprend sa hauteur d'origine. Le
       recalcul réapplique le viewport zoomé borné sans réinitialiser le pan. */
    if (!active && zoom > minZoom) render();
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
      viewport.scrollTop = 0;
    }
    zoom = next;
    render();
    showZoomIndicator();
  }

  const distance = touches => Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  const center = touches => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });

  function onTouchStart(event) {
    if (event.touches.length === 1) syncVerticalOffsetFromScroll();
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
    if (event.ctrlKey) {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      setZoom(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      return;
    }
    /* Lot corrections : quand l'image est agrandie, la molette/trackpad doit
       déplacer l'image (les quatre bords restent atteignables) ; à sa taille,
       le défilement natif du conteneur reste inchangé. */
    if (!canCustomPan()) return;
    syncVerticalOffsetFromScroll();
    event.preventDefault();
    offsetX -= event.deltaX;
    offsetY -= event.deltaY;
    render();
  }

  function onPointerDown(event) {
    if (event.pointerType !== "mouse" || !canCustomPan()) return;
    syncVerticalOffsetFromScroll();
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
    const actionLabel = mode === "fit" ? "Ajuster à la largeur" : "Ajuster à la page";
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
  viewport.addEventListener("scroll", onViewportScroll, { passive: true });
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
    observer.observe(image);
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
      if (scrollLayoutFrame !== null) globalThis.cancelAnimationFrame?.(scrollLayoutFrame);
      scrollLayoutFrame = null;
      zoomIndicator?.classList.remove("is-visible");
      viewport.style.touchAction = "";
      if (nativeFullscreenActive()) {
        const exit = fullscreenDocument.exitFullscreen || fullscreenDocument.webkitExitFullscreen;
        if (typeof exit === "function") Promise.resolve(exit.call(fullscreenDocument)).catch(() => {});
      }
      setFullscreenState(false);
      restoreViewportScrollStyle();
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
      viewport.removeEventListener("scroll", onViewportScroll);
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
