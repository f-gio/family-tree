function escapeHtml(value = '') {
  const node = document.createElement('div');
  node.textContent = value;
  return node.innerHTML;
}

function initials(person) {
  return `${person.firstName?.[0] || ''}${person.lastName?.[0] || ''}`.toUpperCase() || '?';
}

function fullDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('fr-FR').format(date);
}

function lifeEvent(label, icon, date, place) {
  const dateText = date ? fullDate(date) : '—';
  const placeText = place?.trim() || '—';
  return `<div class="life-event" aria-label="${label}" title="${label}"><span class="life-icon" aria-hidden="true">${icon}</span><span class="life-value">${escapeHtml(dateText)} · ${escapeHtml(placeText)}</span></div>`;
}

function familyColorIndex(family, index) {
  return index % 6;
}

function connectionElements(layout) {
  const { positions, families, geometry } = layout;
  const elements = [];
  families.forEach((family, familyIndex) => {
    const colorClass = `family-${familyColorIndex(family, familyIndex)}`;
    const partners = (family.partnerIds || []).map(id => positions.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
    const children = (family.childIds || []).map(id => positions.get(id)).filter(Boolean);
    if (!partners.length) return;
    let origin;
    if (partners.length > 1) {
      const left = partners[0], right = partners[partners.length - 1];
      const y = (left.y + right.y) / 2 + left.height / 2;
      const x1 = left.x + left.width, x2 = right.x;
      elements.push(`<path class="union-line ${colorClass}" d="M ${x1} ${y} H ${x2}"/>`);
      origin = { x: (x1 + x2) / 2, y };
    } else {
      origin = { x: partners[0].x + partners[0].width / 2, y: partners[0].y + partners[0].height };
    }
    if (!children.length) return;
    const childPoints = children.map(child => ({ x: child.x + child.width / 2, y: child.y }));
    const busY = Math.min(...childPoints.map(point => point.y)) - geometry.levelGap / 2;
    elements.push(`<path class="descent-line ${colorClass}" d="M ${origin.x} ${origin.y} V ${busY}"/>`);
    const allX = [origin.x, ...childPoints.map(point => point.x)];
    const minX = Math.min(...allX), maxX = Math.max(...allX);
    if (maxX - minX > 0.5) elements.push(`<path class="descent-line ${colorClass}" d="M ${minX} ${busY} H ${maxX}"/>`);
    childPoints.forEach(point => elements.push(`<path class="descent-line ${colorClass}" d="M ${point.x} ${busY} V ${point.y}"/>`));
    elements.push(`<circle class="junction ${colorClass}" cx="${origin.x}" cy="${origin.y}" r="5"/>`);
    elements.push(`<circle class="junction ${colorClass}" cx="${origin.x}" cy="${busY}" r="4"/>`);
  });
  return elements;
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
    if (svg) svg.innerHTML = connectionElements(currentLayout).join('');
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
    // Le déplacement vertical est volontairement bloqué : les cartes d'une
    // même génération restent sur la même rangée.
    position.y = drag.baseY;
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
      const paths = connectionElements(layout).join('');
      const cards = people.map(person => {
        const position = layout.positions.get(person.id);
        if (!position) return '';
        const avatar = person.photoUrl ? `<img src="${escapeHtml(person.photoUrl)}" alt="">` : initials(person);
        const birthName = [person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ');
        const middleName = person.middleName ? `<span class="person-middle-name">${escapeHtml(person.middleName)}</span>` : '';
        return `<button class="person" data-person-id="${person.id}" style="left:${position.x}px;top:${position.y}px" aria-label="Ouvrir et modifier ${escapeHtml(birthName)}"><span class="drag-hint" aria-hidden="true">⋮⋮</span><span class="avatar">${avatar}</span><div class="person-name"><span class="person-first-name">${escapeHtml(person.firstName || '')}</span>${middleName}<span class="person-surname">${escapeHtml(person.lastName || '')}</span></div>${lifeEvent('Naissance', '✦', person.birthDate, person.place)}${lifeEvent('Décès', '†', person.deathDate, person.deathPlace)}</button>`;
      }).join('');
      scene.innerHTML = `<svg class="tree-svg" viewBox="0 0 ${layout.bounds.width} ${layout.bounds.height}" aria-hidden="true">${paths}</svg>${cards}`;
      applyState();
    },
    setActive(personId) { activeId = personId; applyState(); },
    setHighlights(ids = []) { highlighted = new Set(ids); applyState(); },
    redrawConnections: drawConnections
  };
}
