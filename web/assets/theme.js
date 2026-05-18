// Theme handling: applies the stored choice as early as possible to
// avoid a flash of the wrong palette, then wires the toolbar toggle.
// Two-state flip: one click always switches to the opposite of the
// currently effective theme and writes that as the explicit choice.
(function () {
  'use strict';

  var KEY = 'theme';
  var root = document.documentElement;

  function apply(theme) {
    if (theme === 'dark' || theme === 'light') {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
  }

  // Run immediately so the dataset is set before the first paint.
  try {
    apply(localStorage.getItem(KEY));
  } catch (e) { /* localStorage unavailable */ }

  function effectiveTheme() {
    if (root.dataset.theme === 'dark' || root.dataset.theme === 'light') {
      return root.dataset.theme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateButton(btn) {
    var t = effectiveTheme();
    btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    btn.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function wire() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    updateButton(btn);

    // Single flip: whatever is currently effective, switch to the other.
    // Always writes an explicit choice so the next click is predictable.
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
      updateButton(btn);
    });

    // Keep the icon state honest if the OS preference changes while the
    // page is open and the user hasn't picked an explicit mode.
    try {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', function () {
          if (!root.dataset.theme) updateButton(btn);
        });
    } catch (e) { /* older Safari */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else { wire(); }
})();
