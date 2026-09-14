const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createTreeCamera({ viewport, scene, minScale = 0.25, maxScale = 2, onChange }) {
  const state = { x: 0, y: 0, scale: 1 };
  const pointers = new Map();
  let contentBounds = { x: 0, y: 0, width: 720, height: 460 };
  let lastPinch = null, moved = false, suppressUntil = 0;

  function apply() {
    const ratio = window.devicePixelRatio || 1;
    const x = Math.round(state.x * ratio) / ratio;
    const y = Math.round(state.y * ratio) / ratio;
    scene.style.transform = `translate(${x}px,${y}px) scale(${state.scale})`;
    onChange?.({ ...state });
  }

  function viewportPoint(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function zoomAt(nextScale, clientX, clientY) {
    nextScale = clamp(nextScale, minScale, maxScale);
    const point = viewportPoint(clientX, clientY);
    const worldX = (point.x - state.x) / state.scale;
    const worldY = (point.y - state.y) / state.scale;
    state.x = point.x - worldX * nextScale;
    state.y = point.y - worldY * nextScale;
    state.scale = nextScale;
    apply();
  }

  function midpointAndDistance() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('.tree-controls,.person')) return;
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, previousX: event.clientX, previousY: event.clientY, startX: event.clientX, startY: event.clientY });
    moved = false;
    viewport.classList.add('is-panning');
    if (pointers.size === 2) lastPinch = midpointAndDistance();
  });

  viewport.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointers.size === 1) {
      state.x += pointer.x - pointer.previousX;
      state.y += pointer.y - pointer.previousY;
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) moved = true;
      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
      apply();
    } else if (pointers.size >= 2) {
      const current = midpointAndDistance();
      if (lastPinch) {
        state.x += current.x - lastPinch.x;
        state.y += current.y - lastPinch.y;
        zoomAt(state.scale * (current.distance / Math.max(1, lastPinch.distance)), current.x, current.y);
        moved = true;
      }
      lastPinch = current;
    }
  });

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (moved) suppressUntil = performance.now() + 300;
    if (pointers.size < 2) lastPinch = null;
    if (pointers.size === 1) {
      const remaining = [...pointers.values()][0];
      remaining.previousX = remaining.x;
      remaining.previousY = remaining.y;
    }
    if (!pointers.size) viewport.classList.remove('is-panning');
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', event => {
    if (event.target.closest('.tree-controls')) return;
    event.preventDefault();
    zoomAt(state.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });

  function centerForScale(scale) {
    state.x = (viewport.clientWidth - contentBounds.width * scale) / 2 - contentBounds.x * scale;
    state.y = (viewport.clientHeight - contentBounds.height * scale) / 2 - contentBounds.y * scale;
  }

  const resizeObserver = new ResizeObserver(() => onChange?.({ ...state }));
  resizeObserver.observe(viewport);
  apply();

  return {
    setBounds(bounds) { contentBounds = { ...bounds }; },
    zoomBy(factor) {
      const rect = viewport.getBoundingClientRect();
      zoomAt(state.scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    fit(padding = 64) {
      const scale = clamp(Math.min((viewport.clientWidth - padding * 2) / contentBounds.width, (viewport.clientHeight - padding * 2) / contentBounds.height), minScale, maxScale);
      state.scale = scale;
      centerForScale(scale);
      apply();
    },
    recenter() { centerForScale(state.scale); apply(); },
    focus(rect) {
      state.x = viewport.clientWidth / 2 - (rect.x + rect.width / 2) * state.scale;
      state.y = viewport.clientHeight / 2 - (rect.y + rect.height / 2) * state.scale;
      apply();
    },
    shouldSuppressClick() { return performance.now() < suppressUntil; },
    getState() { return { ...state }; },
    destroy() { resizeObserver.disconnect(); }
  };
}
