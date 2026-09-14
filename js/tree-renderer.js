function escapeHtml(value = '') {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

function initials(person) {
  return `${person.firstName?.[0] || ''}${person.lastName?.[0] || ''}`.toUpperCase() || '?';
}

function year(value) {
  return value ? new Date(`${value}T12:00:00`).getFullYear() : '?';
}

function dates(person) {
  const birth = year(person.birthDate), death = person.deathDate ? year(person.deathDate) : '';
  return death ? `${birth} – ${death}` : birth !== '?' ? `Né(e) en ${birth}` : 'Dates à compléter';
}

function connectionPaths(layout) {
  const { positions, families, geometry } = layout;
  const paths = [];
  for (const family of families) {
    const partners = (family.partnerIds || []).map(id => positions.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
    const children = (family.childIds || []).map(id => positions.get(id)).filter(Boolean);
    if (!partners.length) continue;
    let origin;
    if (partners.length > 1) {
      const left = partners[0], right = partners[partners.length - 1];
      const y = (left.y + right.y) / 2 + left.height / 2;
      const x1 = left.x + left.width, x2 = right.x;
      paths.push(`M ${x1} ${y} H ${x2}`);
      origin = { x: (x1 + x2) / 2, y };
    } else {
      origin = { x: partners[0].x + partners[0].width / 2, y: partners[0].y + partners[0].height };
    }
    if (!children.length) continue;
    const childPoints = children.map(child => ({ x: child.x + child.width / 2, y: child.y }));
    const busY = Math.min(...childPoints.map(point => point.y)) - geometry.levelGap / 2;
    paths.push(`M ${origin.x} ${origin.y} V ${busY}`);
    const allX = [origin.x, ...childPoints.map(point => point.x)];
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    if (maxX - minX > 0.5) paths.push(`M ${minX} ${busY} H ${maxX}`);
    childPoints.forEach(point => paths.push(`M ${point.x} ${busY} V ${point.y}`));
  }
  return paths;
}

export function createTreeRenderer({ scene, onPersonClick, onPersonMove, onEmptyAdd, getScale = () => 1, shouldSuppressClick = () => false }) {
  let activeId = null;
  let highlighted = new Set();
  let currentLayout = null;
  let drag = null;
  let draggedUntil = 0;

  function drawConnections() {
    if (!currentLayout) return;
    const svg = scene.querySelector('.tree-svg');
    if (svg) svg.innerHTML = connectionPaths(currentLayout).map(path => `<path d="${path}"/>`).join('');
  }

  scene.addEventListener('click', event => {
    if (shouldSuppressClick() || performance.now() < draggedUntil) return;
    const card = event.target.closest('[data-person-id]');
    if (card) onPersonClick?.(card.dataset.personId);
    if (event.target.closest('[data-empty-add]')) onEmptyAdd?.();
  });

  scene.addEventListener('pointerdown', event => {
    const card = event.target.closest('[data-person-id]');
    if (!card || event.button > 0) return;
    const position = currentLayout?.positions.get(card.dataset.personId);
    if (!position) return;
    event.stopPropagation();
    card.setPointerCapture?.(event.pointerId);
    drag = { pointerId: event.pointerId, id: card.dataset.personId, card, startX: event.clientX, startY: event.clientY, baseX: position.x, baseY: position.y, moved: false };
    card.classList.add('is-dragging');
  });

  scene.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = Math.max(.01, getScale());
    const dx = (event.clientX - drag.startX) / scale;
    const dy = (event.clientY - drag.startY) / scale;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const position = currentLayout.positions.get(drag.id);
    position.x = Math.max(20, drag.baseX + dx);
    position.y = Math.max(20, drag.baseY + dy);
    drag.card.style.left = `${position.x}px`;
    drag.card.style.top = `${position.y}px`;
    drawConnections();
  });

  function endDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    finished.card.classList.remove('is-dragging');
    if (finished.moved) {
      draggedUntil = performance.now() + 350;
      const position = currentLayout.positions.get(finished.id);
      onPersonMove?.(finished.id, { x: position.x, y: position.y });
    }
  }
  scene.addEventListener('pointerup', endDrag);
  scene.addEventListener('pointercancel', endDrag);

  function applyState() {
    scene.querySelectorAll('[data-person-id]').forEach(card => {
      card.classList.toggle('active', card.dataset.personId === activeId);
      card.classList.toggle('search-match', highlighted.has(card.dataset.personId));
    });
  }

  return {
    render(people, layout) {
      currentLayout = layout;
      scene.style.width = `${layout.bounds.width}px`;
      scene.style.height = `${layout.bounds.height}px`;
      if (!people.length) {
        scene.innerHTML = '<div class="empty"><div class="empty-icon">♧</div><h3>Votre arbre commence ici</h3><p>Ajoutez une première personne, puis créez ses liens familiaux.</p><button class="btn primary" data-empty-add>Ajouter une personne</button></div>';
        return;
      }
      const paths = connectionPaths(layout).map(path => `<path d="${path}"/>`).join('');
      const cards = people.map(person => {
        const position = layout.positions.get(person.id);
        if (!position) return '';
        const avatar = person.photoUrl ? `<img src="${escapeHtml(person.photoUrl)}" alt="">` : initials(person);
        return `<button class="person" data-person-id="${person.id}" style="left:${position.x}px;top:${position.y}px" aria-label="Ouvrir et modifier ${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}"><span class="drag-hint" aria-hidden="true">⋮⋮</span><span class="avatar">${avatar}</span><strong>${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}</strong><span>${dates(person)}</span><span class="place">${escapeHtml(person.place || person.branch || 'Lieu à compléter')}</span></button>`;
      }).join('');
      scene.innerHTML = `<svg class="tree-svg" viewBox="0 0 ${layout.bounds.width} ${layout.bounds.height}" aria-hidden="true">${paths}</svg>${cards}`;
      applyState();
    },
    setActive(personId) { activeId = personId; applyState(); },
    setHighlights(ids = []) { highlighted = new Set(ids); applyState(); },
    redrawConnections: drawConnections
  };
}
