// Fuzzy site-wide search for the top nav. Builds an in-memory index from
// course_config.json (section list) + generated/sections/*.json (per-section
// content), then runs Fuse.js over it with title/body weighting. Results
// render as a dropdown with chapter eyebrow, title, and a highlighted body
// snippet — keyboard-navigable (↑/↓/Enter/Esc) and click-outside-to-close.
(function () {
  'use strict';

  var input     = document.getElementById('nav-search');
  var resultsEl = document.getElementById('nav-search-results');
  if (!input || !resultsEl) return;

  var FUSE_SRC = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';
  var SECTIONS_DIR = '../generated/sections/';
  var CONFIG_URL   = '../course_config.json';

  var fuse = null;
  var items = [];          // currently-shown result anchors
  var active = -1;
  var debounceTimer;

  // ──────────────────────────────────────────────────────────────────
  // Index build
  // ──────────────────────────────────────────────────────────────────

  // Flatten any JSON value into a single searchable string. Keeps prose
  // intact; for arrays of {concept, explanation} or similar, joins all
  // string leaves with " · " so word boundaries survive.
  function flatten(val, out) {
    if (val == null) return;
    if (typeof val === 'string') { out.push(val); return; }
    if (typeof val === 'number' || typeof val === 'boolean') {
      out.push(String(val)); return;
    }
    if (Array.isArray(val)) {
      val.forEach(function (v) { flatten(v, out); });
      return;
    }
    if (typeof val === 'object') {
      Object.keys(val).forEach(function (k) { flatten(val[k], out); });
    }
  }

  function buildIndex() {
    return fetch(CONFIG_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        var sections = (cfg && cfg.sections) || [];
        return Promise.all(sections.map(function (s, i) {
          var num = (String(s.id || '').match(/(\d+)$/) || [, String(i + 1).padStart(2, '0')])[1];
          return fetch(SECTIONS_DIR + encodeURIComponent(s.id) + '.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
              var parts = [];
              if (data) flatten(data, parts);
              // Strip markdown noise so snippets read as prose.
              var body = parts.join(' ')
                .replace(/\$\$[\s\S]*?\$\$/g, ' ')   // drop display math
                .replace(/\$[^$\n]+\$/g, ' ')        // drop inline math
                .replace(/[#*_`>|\\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              return {
                id:       s.id,
                num:      num,
                title:    (data && data.title) || s.title || s.id,
                summary:  (data && data.summary) || s.description || '',
                body:     body,
                url:      'section.html?id=' + encodeURIComponent(s.id),
              };
            })
            .catch(function () {
              return {
                id: s.id,
                num: num,
                title: s.title || s.id,
                summary: s.description || '',
                body: (s.title || '') + ' ' + (s.description || ''),
                url: 'section.html?id=' + encodeURIComponent(s.id),
              };
            });
        }));
      });
  }

  function ensureFuse() {
    return new Promise(function (resolve, reject) {
      if (window.Fuse) { resolve(); return; }
      var s = document.createElement('script');
      s.src = FUSE_SRC;
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  input.disabled = true;
  Promise.all([ensureFuse(), buildIndex()])
    .then(function (vals) {
      var idx = vals[1];
      fuse = new Fuse(idx, {
        keys: [
          { name: 'title',   weight: 0.45 },
          { name: 'summary', weight: 0.25 },
          { name: 'body',    weight: 0.30 },
        ],
        threshold: 0.32,
        ignoreLocation: true,
        minMatchCharLength: 2,
      });
      input.disabled = false;
      input.placeholder = 'Search sections…';
    })
    .catch(function (e) {
      console.warn('nav-search: index build failed', e);
      input.placeholder = 'Search unavailable';
    });

  // ──────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function wordsOf(q) {
    return q.trim().split(/\s+/).filter(function (w) { return w.length > 1; });
  }

  function highlight(text, query) {
    var ws = wordsOf(query);
    if (!ws.length) return escapeHtml(text);
    var re = new RegExp('(' + ws.map(escapeRe).join('|') + ')', 'gi');
    // escape first, then run highlight regex on the escaped string.
    return escapeHtml(text).replace(re, '<mark>$1</mark>');
  }

  function snippet(body, query, len) {
    var ws = wordsOf(query);
    if (!ws.length) return body.length > len ? body.slice(0, len) + '…' : body;
    var re = new RegExp(ws.map(escapeRe).join('|'), 'i');
    var m = re.exec(body);
    if (!m) return body.length > len ? body.slice(0, len) + '…' : body;
    var start = Math.max(0, m.index - 60);
    var end   = Math.min(body.length, m.index + m[0].length + (len - 60));
    var s = body.slice(start, end);
    if (start > 0) s = '…' + s;
    if (end < body.length) s = s + '…';
    return s;
  }

  function render(hits, query) {
    active = -1;
    if (!hits.length) {
      resultsEl.innerHTML =
        '<div class="nav-sr-empty">No results for “' + escapeHtml(query) + '”</div>';
      resultsEl.classList.add('active');
      items = [];
      return;
    }
    var html = '';
    var max = Math.min(hits.length, 8);
    for (var i = 0; i < max; i++) {
      var it = hits[i].item;
      var snip = snippet(it.body || it.summary || '', query, 140);
      html +=
        '<a class="nav-sr-item" href="' + it.url + '">' +
          '<div class="nav-sr-chapter">Section ' + escapeHtml(it.num) + '</div>' +
          '<div class="nav-sr-title">' + highlight(it.title, query) + '</div>' +
          '<div class="nav-sr-body">' + highlight(snip, query) + '</div>' +
        '</a>';
    }
    resultsEl.innerHTML = html;
    resultsEl.classList.add('active');
    items = resultsEl.querySelectorAll('.nav-sr-item');
  }

  function close() {
    resultsEl.classList.remove('active');
    resultsEl.innerHTML = '';
    active = -1;
    items = [];
  }

  function setActive(idx) {
    for (var i = 0; i < items.length; i++) items[i].classList.remove('nav-sr-active');
    if (idx >= 0 && idx < items.length) {
      items[idx].classList.add('nav-sr-active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
    active = idx;
  }

  // ──────────────────────────────────────────────────────────────────
  // Wiring
  // ──────────────────────────────────────────────────────────────────

  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    if (!fuse || q.length < 2) { close(); return; }
    debounceTimer = setTimeout(function () { render(fuse.search(q), q); }, 120);
  });

  input.addEventListener('keydown', function (e) {
    if (!resultsEl.classList.contains('active') || !items.length) {
      if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active < items.length - 1 ? active + 1 : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active > 0 ? active - 1 : items.length - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      items[active].click();
    } else if (e.key === 'Escape') {
      close(); input.blur();
    }
  });

  document.addEventListener('click', function (e) {
    if (!resultsEl.contains(e.target) && e.target !== input) close();
  });

  // Global "/" hotkey — focuses the search unless the user is already
  // typing into another field.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });
})();
