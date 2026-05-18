// Shared helpers for the static study site. Loads marked + DOMPurify lazily
// from jsDelivr for markdown rendering and exposes a window.StudySite namespace
// used by index/section/flashcards/exam pages.
(function () {
  'use strict';

  var MARKED_SRC          = 'https://cdn.jsdelivr.net/npm/marked@15.0.7/lib/marked.umd.min.js';
  var MARKED_INTEGRITY    = 'sha384-EjL6IeH3KCXB9dkBQaYqnb/m6V3TOBP++kooL0bl43Vt6eCFJ2Pxck/B/dU4PB8d';
  var DOMPURIFY_SRC       = 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js';
  var DOMPURIFY_INTEGRITY = 'sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu';
  var KATEX_CSS           = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
  var KATEX_JS            = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
  var KATEX_AUTORENDER    = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      if ([].some.call(document.scripts, function (s) { return s.src === src; })) {
        resolve(); return;
      }
      var s = document.createElement('script');
      s.src = src;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
      }
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  var mdReady = null;
  function ensureMarkdown() {
    if (mdReady) return mdReady;
    mdReady = loadScript(MARKED_SRC, MARKED_INTEGRITY)
      .then(function () { return loadScript(DOMPURIFY_SRC, DOMPURIFY_INTEGRITY); })
      .catch(function (e) { console.warn('markdown libs failed to load', e); });
    return mdReady;
  }

  function loadStylesheet(href) {
    if ([].some.call(document.styleSheets, function (s) { return s.href === href; })) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  var katexReady = null;
  function ensureKatex() {
    if (katexReady) return katexReady;
    loadStylesheet(KATEX_CSS);
    katexReady = loadScript(KATEX_JS)
      .then(function () { return loadScript(KATEX_AUTORENDER); })
      .catch(function (e) { console.warn('KaTeX failed to load', e); });
    return katexReady;
  }

  // Walk an element tree and render any $...$ / $$...$$ / \(..\) / \[..\] math.
  // Safe to call multiple times — KaTeX skips already-rendered nodes.
  function renderMath(root) {
    if (!root || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '\\[', right: '\\]', display: true  },
          { left: '\\(', right: '\\)', display: false },
          { left: '$',  right: '$',  display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {
      console.warn('KaTeX render failed', e);
    }
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Pull $$…$$ and $…$ math out of the source BEFORE markdown parsing so
  // marked doesn't mangle LaTeX (e.g. stripping backslashes from \%, \_),
  // then restore the math blocks before sanitisation. KaTeX auto-render
  // picks them up on the live DOM.
  //
  // Subtlety: the LLM writes \$ for currency BOTH inside and outside math:
  //   outside math:  "price = \$36.00"  → display as literal $
  //   inside math:   "$P_0 = ... = \$43.73$"  → KaTeX renders \$ as literal $
  // So inside math we preserve \$; outside math we wrap the $ in a <span>
  // so KaTeX auto-render (which works on text nodes) can't see it as a
  // delimiter and accidentally bridge two unrelated $…$ blocks.
  function protectMath(src) {
    var math = [];
    var s = String(src);

    // 1. $$…$$ display math first.
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (whole) {
      math.push(whole);
      return '@@MATH' + (math.length - 1) + '@@';
    });

    // 2. $…$ inline math. The opening $ must NOT be preceded by '\' (that's
    //    a literal currency $). The content may contain '\$' (literal $
    //    inside a formula) — the regex permits any \X escape or non-$ char.
    s = s.replace(
      /(^|[^\\])\$((?:\\.|[^$\n])+?)\$/g,
      function (_w, pre, content) {
        math.push('$' + content + '$');
        return pre + '@@MATH' + (math.length - 1) + '@@';
      }
    );

    // 3. Whatever \$ remains is outside any math block — currency in prose.
    //    Stash under a placeholder so we can wrap it in a <span> at restore
    //    time, isolating it from KaTeX's delimiter scanner.
    s = s.replace(/\\\$/g, '@@LITDOLLAR@@');

    return { text: s, math: math };
  }
  function restoreMath(html, math) {
    return html
      .replace(/@@MATH(\d+)@@/g, function (_, i) { return math[+i]; })
      .replace(/@@LITDOLLAR@@/g, '<span class="lit-dollar">$</span>');
  }

  // Textbook-style callouts. The LLM opens a "callout" paragraph with
  // **Label:** (bold + colon) — we promote that paragraph AND any
  // subsequent block content (lists, display math, follow-on prose)
  // into a single <aside class="callout callout-{kind}"> so CSS can
  // box them like a textbook would.
  //
  // Four semantic lanes (consolidated from a longer list of labels):
  //   primary   — examples, rules, formal results (theorem/proof/etc.)
  //   success   — definitions
  //   highlight — intuition / key takeaways / notes
  //   warning   — caveats / limitations / mistakes
  var CALLOUT_KINDS = {
    // primary: examples and formal results
    'worked example':  'primary',
    'example':         'primary',
    'rule':            'primary',
    'theorem':         'primary',
    'proposition':     'primary',
    'lemma':           'primary',
    'corollary':       'primary',
    'proof':           'primary',
    // success: defined concept
    'definition':      'success',
    // highlight: intuition and takeaways
    'key insight':     'highlight',
    'insight':         'highlight',
    'intuition':       'highlight',
    'key idea':        'highlight',
    'key lesson':      'highlight',
    'key fact':        'highlight',
    'note':            'highlight',
    'recall':          'highlight',
    'remark':          'highlight',
    // warning: caveats and limitations
    'caveat':          'warning',
    'caveats':         'warning',
    'real-world caveats': 'warning',
    'limitations':     'warning',
    'limitation':      'warning',
    'warning':         'warning',
    'caution':         'warning'
  };

  // Try to read "Label:" / "Label (suffix):" from a <p>'s first <strong>.
  // Returns { kind, fullLabel, inlineBody } or null if not a callout opener.
  function detectCalloutOpener(p) {
    if (!p || p.tagName !== 'P') return null;
    var first = p.firstElementChild;
    if (!first || first.tagName !== 'STRONG') return null;
    // The <strong> can be only ONE preceding child — if there's something
    // before it (a text node), this isn't a callout opener.
    var fc = p.firstChild;
    if (fc !== first && !(fc.nodeType === 3 && !fc.textContent.trim())) return null;

    var strongText = (first.textContent || '').trim();
    // Match "Label:" or "Label (suffix):"
    var m = strongText.match(/^([^:(]+?)(\s*\([^)]*\))?:$/);
    if (!m) return null;
    var label = m[1].trim();
    var suffix = m[2] || '';
    var kind = CALLOUT_KINDS[label.toLowerCase()];
    if (!kind) return null;

    // Inline body is whatever non-strong content sits in the <p> after
    // the <strong>. Collect those child nodes.
    var inlineBody = document.createDocumentFragment();
    var sib = first.nextSibling;
    // Trim a leading whitespace text node if present.
    if (sib && sib.nodeType === 3 && /^\s+/.test(sib.textContent)) {
      sib.textContent = sib.textContent.replace(/^\s+/, '');
      if (!sib.textContent) {
        var dead = sib;
        sib = sib.nextSibling;
        dead.parentNode.removeChild(dead);
      }
    }
    while (sib) {
      var next = sib.nextSibling;
      inlineBody.appendChild(sib);  // moves out of <p>
      sib = next;
    }
    return { kind: kind, fullLabel: label + suffix, inlineBody: inlineBody };
  }

  // True if an element is a hard stop for collecting callout body content:
  // a heading, an hr, another callout opener, or an existing callout aside.
  function isCalloutBoundary(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4'
        || tag === 'H5' || tag === 'H6' || tag === 'HR') return true;
    if (tag === 'ASIDE' && el.classList && el.classList.contains('callout')) return true;
    // Another callout opener — peek into its first <strong>.
    if (tag === 'P' && el.firstElementChild
        && el.firstElementChild.tagName === 'STRONG') {
      var st = (el.firstElementChild.textContent || '').trim();
      var mm = st.match(/^([^:(]+?)(\s*\([^)]*\))?:$/);
      if (mm && CALLOUT_KINDS[mm[1].trim().toLowerCase()]) return true;
    }
    return false;
  }

  // Walk the post-marked HTML and promote each `**Label:**` paragraph
  // (plus everything that visually belongs to it) into an <aside>.
  function styleCallouts(html) {
    if (!window.DOMParser) return html;
    var doc = new DOMParser().parseFromString(
      '<!doctype html><html><body><div id="__root">' + html + '</div></body></html>',
      'text/html'
    );
    var root = doc.getElementById('__root');
    if (!root) return html;

    // Walk children in source order; build a new fragment with callouts wrapped.
    var children = Array.prototype.slice.call(root.children);
    var i = 0;
    while (i < children.length) {
      var el = children[i];
      var opener = detectCalloutOpener(el);
      if (!opener) { i++; continue; }

      // Build <aside> in the SAME document so we can move nodes into it.
      var aside = doc.createElement('aside');
      aside.className = 'callout callout-' + opener.kind;
      var labelEl = doc.createElement('div');
      labelEl.className = 'callout-label';
      labelEl.textContent = opener.fullLabel;
      var bodyEl = doc.createElement('div');
      bodyEl.className = 'callout-body';
      if (opener.inlineBody && opener.inlineBody.childNodes.length) {
        // Wrap inline body in a <p> so it gets paragraph margins.
        var inlinePara = doc.createElement('p');
        inlinePara.appendChild(opener.inlineBody);
        // Skip empty paragraphs (e.g. label was on its own line).
        if (inlinePara.textContent.trim() || inlinePara.children.length) {
          bodyEl.appendChild(inlinePara);
        }
      }
      aside.appendChild(labelEl);
      aside.appendChild(bodyEl);

      // Replace the opener paragraph with the aside, then absorb following
      // siblings until we hit a boundary.
      el.parentNode.replaceChild(aside, el);

      // Walk forward in the live tree (children[] is stale after replace).
      var sib = aside.nextElementSibling;
      while (sib && !isCalloutBoundary(sib)) {
        var nextSib = sib.nextElementSibling;
        bodyEl.appendChild(sib);   // moves sib into the aside body
        sib = nextSib;
      }

      // Rebuild children array from the live tree and advance past the aside.
      children = Array.prototype.slice.call(root.children);
      i = Array.prototype.indexOf.call(children, aside) + 1;
    }

    return root.innerHTML;
  }

  function renderMarkdown(md) {
    if (!md) return '';
    if (!(window.marked && window.marked.parse)) {
      return '<pre>' + escapeHtml(md) + '</pre>';
    }
    var p = protectMath(md);
    var html = window.marked.parse(p.text);
    html = restoreMath(html, p.math);
    html = styleCallouts(html);
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  }

  // Inline variant: parse short snippets (e.g. a concept name, a list item)
  // without wrapping them in a <p>. Falls back to escapeHtml if marked isn't
  // ready yet.
  function renderInline(md) {
    if (md == null) return '';
    if (!(window.marked && window.marked.parseInline)) {
      return escapeHtml(md);
    }
    var p = protectMath(md);
    var html = window.marked.parseInline(p.text);
    html = restoreMath(html, p.math);
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html);
    return html;
  }

  function getParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function applyCourseChrome(cfg) {
    document.querySelectorAll('[data-course-name]').forEach(function (el) {
      el.textContent = cfg.course_name || '';
    });
    document.querySelectorAll('[data-course-code]').forEach(function (el) {
      el.textContent = cfg.course_code || '';
    });
    document.querySelectorAll('[data-university]').forEach(function (el) {
      el.textContent = cfg.university || '';
    });
    if (cfg.course_name) document.title = (document.title || '') + ' — ' + cfg.course_name;
  }

  function maybeLoadChat(cfg) {
    var chat = cfg.features && cfg.features.chat;
    if (!chat || !chat.enabled) return;
    var meta = document.createElement('meta');
    meta.name = 'course-name';
    meta.content = cfg.course_name || '';
    document.head.appendChild(meta);
    var meta2 = document.createElement('meta');
    meta2.name = 'course-code';
    meta2.content = cfg.course_code || '';
    document.head.appendChild(meta2);
    var script = document.createElement('script');
    script.src = 'assets/chat-widget.js';
    script.defer = true;
    document.body.appendChild(script);
  }

  window.StudySite = {
    loadConfig:     function () { return fetchJson('../course_config.json'); },
    loadSection:    function (id) { return fetchJson('../generated/sections/' + id + '.json'); },
    loadFlashcards: function (id) { return fetchJson('../generated/flashcards/' + id + '_flashcards.json'); },
    loadExam:       function () { return fetchJson('../generated/exam/exam_prep.json'); },
    ensureMarkdown: ensureMarkdown,
    ensureKatex:    ensureKatex,
    renderMarkdown: renderMarkdown,
    renderInline:   renderInline,
    renderMath:     renderMath,
    escapeHtml:     escapeHtml,
    getParam:       getParam,
    applyCourseChrome: applyCourseChrome,
    maybeLoadChat:  maybeLoadChat,
  };

  // Kick off markdown + KaTeX loading early so pages don't have to wait.
  ensureMarkdown();
  ensureKatex();
})();
