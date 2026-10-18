// Notebook entry editors shared by the review library and the replay page: the note (200 chars)
// and coach-suggested tags.

import { el } from './dom.js';
import { ADAPTERS } from './learn-registry.js';
import { clampNote } from './notebook.js';
import { CAPS } from './srs.js';

// Note editor with a live character count; saves on change.
export function noteEditor(it, store) {
  const id = `note-${it.id}`;
  const count = el('span', { class: 'muted small', 'aria-live': 'polite' });
  const status = el('span', { class: 'muted small', role: 'status' });
  const area = el('textarea', {
    id, rows: '2', maxlength: String(CAPS.note), placeholder: 'What will you check next time? (20+ characters counts toward Notebook)',
    oninput: () => (count.textContent = `${area.value.length} / ${CAPS.note}`),
    onchange: () => {
      store.setNote(it.id, clampNote(area.value));
      status.textContent = 'Saved.';
    },
  });
  area.value = it.note ?? '';
  count.textContent = `${area.value.length} / ${CAPS.note}`;
  return el('div', { class: 'note-editor' }, el('label', { for: id }, 'Your note'), area, el('div', {}, count, ' ', status));
}

// Tag chips: the item's tags plus coach suggestions, toggled with buttons.
export function tagEditor(it, store, onChange = () => {}) {
  const ad = ADAPTERS[it.game];
  const suggestions = [...new Set([...it.tags, ...(ad?.TAG_IDS ?? [])])].slice(0, 14);
  const wrap = el('div', { class: 'tag-editor', role: 'group', 'aria-label': 'Tags' });
  const draw = () => {
    const cur = store.item(it.id)?.tags ?? it.tags;
    wrap.replaceChildren(el('span', { class: 'muted small', text: 'Tags: ' }), ...suggestions.map((t) => el('button', {
      type: 'button',
      class: `chip tag-chip${cur.includes(t) ? ' is-on' : ''}`,
      'aria-pressed': cur.includes(t) ? 'true' : 'false',
      onclick: () => {
        const item = store.item(it.id);
        if (!item) return;
        item.tags = item.tags.includes(t) ? item.tags.filter((x) => x !== t) : [...item.tags, t];
        store.upsertItem(item);
        draw();
        onChange();
      },
    }, ad?.tagLabel(t) ?? t)));
  };
  draw();
  return wrap;
}
