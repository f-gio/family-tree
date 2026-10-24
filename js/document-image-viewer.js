export function selectInitialDocumentImageMode({ naturalWidth, naturalHeight } = {}) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return "fit";
  return naturalHeight / naturalWidth >= 1.5 ? "width" : "fit";
}

export function createDocumentImageViewer({ viewport, image, controls, zoomLabel, modeButton, initialMode = "fit", minZoom = 1, maxZoom = 6 } = {}) {
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
  let mode = initialMode === "width" ? "width" : "fit";

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
    image.style.left = nativeWidthScroll ? "auto" : `calc(50% + ${offsetX}px)`;
    image.style.top = nativeWidthScroll ? "auto" : `calc(50% + ${offsetY}px)`;
    image.style.margin = nativeWidthScroll ? "0 auto" : "0";
    image.style.transform = nativeWidthScroll ? "none" : `translate(-50%, -50%) scale(${zoom})`;
    if (zoomLabel) zoomLabel.textContent = zoom <= minZoom ? (mode === "width" ? "Largeur" : "Ajusté") : `${Math.round(zoom * 100)} %`;
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
    modeButton.textContent = mode === "fit" ? "Ajuster à la largeur" : "Ajuster à la fenêtre";
    modeButton.setAttribute("aria-pressed", String(mode === "width"));
    modeButton.setAttribute("aria-label", mode === "fit" ? "Afficher l’image à la largeur du lecteur" : "Afficher l’image entière dans la fenêtre");
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
    toggleFitMode() {
      mode = mode === "fit" ? "width" : "fit";
      zoom = minZoom;
      offsetX = 0;
      offsetY = 0;
      fit();
      updateModeButton();
    },
    getState: () => ({ zoom, offsetX, offsetY, fitWidth, fitHeight, mode }),
    destroy() {
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
      image.removeEventListener("load", fit);
      image.removeAttribute("style");
    }
  });
}
