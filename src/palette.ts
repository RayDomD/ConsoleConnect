// Ctrl+K palette. Mounted on <body>, outside the renderer's root, so live re-renders don't close it.
// Opened from the keyboard, so it appears without animation.

export interface PaletteItem {
  label: string;
  kind: string;
  hint?: string;
  icon?: string; // Trusted markup built by the caller; labels and hints are set as text.
  run: () => void;
}

let current: { overlay: HTMLElement; returnFocus: HTMLElement | null } | null = null;

export const paletteOpen = () => Boolean(current);

export function closePalette(restoreFocus = true) {
  if (!current) return;
  const { overlay, returnFocus } = current;
  current = null;
  overlay.remove();
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
}

export function openPalette(items: PaletteItem[]) {
  if (current) return;
  const overlay = document.createElement('div');
  overlay.className = 'palette-backdrop';
  overlay.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Jump to"><input class="palette-input" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Jump to a task, person, or action…" autocomplete="off" spellcheck="false"><div class="palette-list" id="palette-list" role="listbox" aria-label="Results"></div><div class="palette-keys" aria-hidden="true"><span><kbd>J</kbd> <kbd>K</kbd> tasks</span><span><kbd>1</kbd>–<kbd>4</kbd> tabs</span><span><kbd>N</kbd> new task</span><span><kbd>C</kbd> chat</span></div></div>`;
  const input = overlay.querySelector<HTMLInputElement>('.palette-input')!;
  const list = overlay.querySelector<HTMLElement>('.palette-list')!;
  let shown: PaletteItem[] = [];
  let active = 0;

  const highlight = () => {
    list.querySelectorAll('[role=option]').forEach((row, index) => row.setAttribute('aria-selected', String(index === active)));
    if (shown.length) input.setAttribute('aria-activedescendant', `palette-option-${active}`);
    else input.removeAttribute('aria-activedescendant');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    closePalette(false);
    item.run();
  };
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    shown = items.filter(item => !query || item.label.toLowerCase().includes(query) || item.kind.toLowerCase().includes(query));
    active = 0;
    list.replaceChildren(...shown.map((item, index) => {
      const row = document.createElement('div');
      row.id = `palette-option-${index}`;
      row.className = 'palette-item';
      row.setAttribute('role', 'option');
      row.innerHTML = item.icon ?? '';
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'palette-hint';
      hint.textContent = item.hint ?? item.kind;
      row.append(label, hint);
      row.addEventListener('mousemove', () => { if (active !== index) { active = index; highlight(); } });
      row.addEventListener('mousedown', event => { event.preventDefault(); choose(item); });
      return row;
    }));
    if (!shown.length) list.innerHTML = '<p class="palette-empty">No matches</p>';
    highlight();
  };

  input.addEventListener('input', draw);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (shown.length) active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      highlight();
    } else if (event.key === 'Enter') choose(shown[active]);
    else if (event.key === 'Escape') closePalette();
    else if (event.key !== 'Tab') return;
    // Tab stays in the input: the palette is modal and the list is driven by arrows.
    event.preventDefault();
    event.stopPropagation();
  });
  overlay.addEventListener('mousedown', event => { if (event.target === overlay) closePalette(); });

  current = { overlay, returnFocus: document.activeElement as HTMLElement | null };
  document.body.append(overlay);
  draw();
  input.focus();
}
