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
      const y = left.y + left.height / 2;
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

export function createTreeRenderer({ scene, onPersonClick, onEmptyAdd, shouldSuppressClick = () => false }) {
  let activeId = null;
  let highlighted = new Set();

  scene.addEventListener('click', event => {
    if (shouldSuppressClick()) return;
    const card = event.target.closest('[data-person-id]');
    if (card) onPersonClick?.(card.dataset.personId);
    if (event.target.closest('[data-empty-add]')) onEmptyAdd?.();
  });

  function applyState() {
    scene.querySelectorAll('[data-person-id]').forEach(card => {
      card.classList.toggle('active', card.dataset.personId === activeId);
      card.classList.toggle('search-match', highlighted.has(card.dataset.personId));
    });
  }

  return {
    render(people, layout) {
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
        return `<button class="person" data-person-id="${person.id}" style="transform:translate3d(${position.x}px,${position.y}px,0)"><span class="avatar">${avatar}</span><strong>${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}</strong><span>${dates(person)}</span><span class="place">${escapeHtml(person.place || person.branch || 'Lieu à compléter')}</span></button>`;
      }).join('');
      scene.innerHTML = `<svg class="tree-svg" viewBox="0 0 ${layout.bounds.width} ${layout.bounds.height}" aria-hidden="true">${paths}</svg>${cards}`;
      applyState();
    },
    setActive(personId) {
      activeId = personId;
      applyState();
    },
    setHighlights(ids = []) {
      highlighted = new Set(ids);
      applyState();
    }
  };
}
