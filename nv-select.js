// ============ nv-select ============
// Enhances every native <select> on the page with a custom-styled dropdown
// while keeping the native <select> as the source of truth (form submissions,
// `change` event consumers, and screen-reader announcements all work as-is).
//
// Opt out per-element with `data-nv-no-enhance` on the <select>.
//
// Keyboard: Tab focuses the trigger. Enter / Space / Down opens the menu.
// Up/Down moves focus within the menu, Enter or Space selects, Esc closes.

(function () {
  'use strict';

  let openInstance = null;

  function clamp(i, lo, hi) { return Math.max(lo, Math.min(hi, i)); }

  function enhance(select) {
    if (select.dataset.nvEnhanced === '1') return;
    if (select.hasAttribute('data-nv-no-enhance')) return;
    select.dataset.nvEnhanced = '1';

    // Build the custom wrapper.
    const wrap = document.createElement('div');
    wrap.className = 'nv-select';
    if (select.disabled) wrap.classList.add('is-disabled');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nv-select-trigger';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    if (select.id) {
      // Mirror id semantics so <label for=""> still hits the trigger via labelledby.
      const label = document.querySelector('label[for="' + CSS.escape(select.id) + '"]');
      if (label) button.setAttribute('aria-labelledby', label.id || (label.id = 'nv-lbl-' + select.id));
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'nv-select-value';

    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'nv-select-chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2');
    chevron.setAttribute('aria-hidden', 'true');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    chevronPath.setAttribute('points', '6 9 12 15 18 9');
    chevron.appendChild(chevronPath);

    button.appendChild(valueEl);
    button.appendChild(chevron);

    const menu = document.createElement('ul');
    menu.className = 'nv-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    if (select.id) menu.setAttribute('aria-labelledby', button.getAttribute('aria-labelledby') || '');

    // Insert the wrap into the DOM next to the native select, then move
    // the native select inside it so labels-for and form ownership both
    // continue to work.
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(button);
    wrap.appendChild(menu);
    wrap.appendChild(select);

    function rebuildMenu() {
      menu.innerHTML = '';
      const options = Array.from(select.options);
      options.forEach((opt, idx) => {
        const li = document.createElement('li');
        li.className = 'nv-select-option';
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.dataset.index = String(idx);
        li.textContent = opt.textContent;
        if (opt.disabled) {
          li.setAttribute('aria-disabled', 'true');
          li.classList.add('is-disabled');
        }
        if (opt.selected) {
          li.classList.add('is-selected');
          li.setAttribute('aria-selected', 'true');
        }
        menu.appendChild(li);
      });
      updateTriggerLabel();
    }

    function updateTriggerLabel() {
      const sel = select.options[select.selectedIndex];
      const txt = sel ? sel.textContent : '';
      valueEl.textContent = txt;
      valueEl.classList.toggle('nv-select-value-empty', !sel || !sel.value);
    }

    function open() {
      if (openInstance && openInstance !== wrap) {
        const prev = openInstance.querySelector('.nv-select-menu');
        if (prev) prev.hidden = true;
        openInstance.querySelector('.nv-select-trigger').setAttribute('aria-expanded', 'false');
      }
      menu.hidden = false;
      wrap.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      openInstance = wrap;
      // Focus the currently selected option, or first.
      const items = Array.from(menu.children);
      const sel = items.find((li) => li.classList.contains('is-selected')) || items[0];
      if (sel) {
        sel.classList.add('is-focused');
        sel.scrollIntoView({ block: 'nearest' });
      }
    }

    function close() {
      menu.hidden = true;
      wrap.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      Array.from(menu.children).forEach((li) => li.classList.remove('is-focused'));
      if (openInstance === wrap) openInstance = null;
    }

    function pick(index) {
      const opt = select.options[index];
      if (!opt || opt.disabled) return;
      select.selectedIndex = index;
      // Update the marker classes.
      Array.from(menu.children).forEach((li, i) => {
        li.classList.toggle('is-selected', i === index);
        if (i === index) li.setAttribute('aria-selected', 'true');
        else li.removeAttribute('aria-selected');
      });
      updateTriggerLabel();
      // Fire native change so existing listeners still work.
      select.dispatchEvent(new Event('change', { bubbles: true }));
      close();
      button.focus();
    }

    function focusedIndex() {
      const items = Array.from(menu.children);
      const i = items.findIndex((li) => li.classList.contains('is-focused'));
      return i;
    }
    function setFocused(index) {
      const items = Array.from(menu.children);
      const target = clamp(index, 0, items.length - 1);
      items.forEach((li, i) => li.classList.toggle('is-focused', i === target));
      const t = items[target];
      if (t) t.scrollIntoView({ block: 'nearest' });
    }

    // --- Event wiring ---
    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (select.disabled) return;
      if (menu.hidden) open(); else close();
    });

    button.addEventListener('keydown', (e) => {
      if (select.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (menu.hidden) open();
      } else if (e.key === 'Escape' && !menu.hidden) {
        e.preventDefault();
        close();
      }
    });

    menu.addEventListener('mousedown', (e) => {
      // mousedown so we react before blur
      const li = e.target.closest('.nv-select-option');
      if (!li || li.classList.contains('is-disabled')) return;
      e.preventDefault();
      pick(parseInt(li.dataset.index, 10));
    });

    menu.addEventListener('mousemove', (e) => {
      const li = e.target.closest('.nv-select-option');
      if (!li) return;
      const idx = parseInt(li.dataset.index, 10);
      setFocused(idx);
    });

    // Keyboard nav while menu is open — listen on the trigger so focus
    // stays there and we don't need to manage focus inside the menu.
    button.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const i = focusedIndex();
        setFocused(i + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const i = focusedIndex();
        setFocused(i - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setFocused(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        setFocused(select.options.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const i = focusedIndex();
        if (i >= 0) pick(i);
      } else if (e.key === 'Escape' || e.key === 'Tab') {
        // Tab closes too so focus moves to next field cleanly.
        if (e.key === 'Escape') e.preventDefault();
        close();
      }
    });

    // Click-outside closes.
    document.addEventListener('mousedown', (e) => {
      if (menu.hidden) return;
      if (wrap.contains(e.target)) return;
      close();
    });

    // External code may set .value or change options later. Re-sync.
    select.addEventListener('change', () => {
      // Native change (could be triggered by external code). Update display.
      updateTriggerLabel();
      Array.from(menu.children).forEach((li, i) => {
        const isSel = i === select.selectedIndex;
        li.classList.toggle('is-selected', isSel);
        if (isSel) li.setAttribute('aria-selected', 'true');
        else li.removeAttribute('aria-selected');
      });
    });

    rebuildMenu();
  }

  function enhanceAll(root) {
    const r = root || document;
    const selects = r.querySelectorAll('select:not([data-nv-enhanced="1"])');
    selects.forEach(enhance);
  }

  // Expose for code that creates selects dynamically.
  window.NVSelect = { enhance, enhanceAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAll());
  } else {
    enhanceAll();
  }
})();
