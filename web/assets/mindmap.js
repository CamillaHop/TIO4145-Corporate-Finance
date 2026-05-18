// Course-wide concept mindmap. Lazily loads Cytoscape + fcose + d3-hierarchy
// from jsDelivr, builds a graph from the existing generated/ JSONs
// (no API spend), and wires the interactions described in the plan:
//
//   • Two layouts (radial tree / force-directed graph) with a toolbar
//     toggle. Cross-section bridges show in force mode only.
//   • Fuzzy search bar that pulses the matching node and dims the rest.
//   • Priority-topics toggle (read from exam_prep.json).
//   • Per-concept "hard flashcards" badge.
//   • Click a concept → opens its section page.
//   • Deep-link query params: ?focus=section_NN, ?q=phrase, ?layout=force|tree.
//
// All node and edge colours are read from the site's CSS custom
// properties at boot, so dark mode "just works".
(function () {
  'use strict';

  // ── CDN assets ─────────────────────────────────────────────────────────
  // SRI hashes intentionally omitted for now — easy to add later by
  // copy-pasting the published hashes from jsdelivr.
  var CYTO_SRC  = 'https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js';
  var FCOSE_SRC = 'https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.min.js';
  var D3_SRC    = 'https://cdn.jsdelivr.net/npm/d3-hierarchy@3.1.2/dist/d3-hierarchy.min.js';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if ([].some.call(document.scripts, function (s) { return s.src === src; })) {
        resolve(); return;
      }
      var el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }

  // ── String helpers ─────────────────────────────────────────────────────

  // Same shape as nav-search.js's stripMd — strip markdown / LaTeX noise
  // so labels and matching work on clean text.
  function stripMd(s) {
    return String(s == null ? '' : s)
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/\$[^$\n]+\$/g, ' ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|[^\w])[_*]([^_*\n]+?)[_*](?!\w)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([\\_*`$])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slug(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Truncate long concept labels so the graph stays scannable. Full
  // text is still in the data and shown in the side panel on click.
  function shortLabel(s, max) {
    max = max || 32;
    s = stripMd(s);
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + '…';
  }

  // ── Data loading ───────────────────────────────────────────────────────

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  function loadAll() {
    return StudySite.loadConfig().then(function (cfg) {
      var sections = cfg.sections || [];
      var sectionPromises = sections.map(function (s) {
        return fetchJson('../generated/sections/' + encodeURIComponent(s.id) + '.json')
          .catch(function () { return null; });
      });
      var examPromise = fetchJson('../generated/exam/exam_prep.json')
        .catch(function () { return null; });
      var fcPromises = sections.map(function (s) {
        return fetchJson('../generated/flashcards/' + encodeURIComponent(s.id) + '_flashcards.json')
          .catch(function () { return []; });
      });
      return Promise.all([
        Promise.resolve(cfg),
        Promise.all(sectionPromises),
        examPromise,
        Promise.all(fcPromises),
      ]);
    });
  }

  // ── Graph build ────────────────────────────────────────────────────────

  function buildGraph(cfg, sectionsData, exam, flashcardsData) {
    var sections   = cfg.sections || [];
    var nodes      = [];
    var edges      = [];
    var conceptIdx = []; // [{ phrase, lower, sectionId, conceptId, label }]

    // 1. Course root
    nodes.push({
      data: {
        id:    'course',
        label: cfg.course_name || 'Course',
        type:  'course',
      },
    });

    // 2. Sections + 3. Concepts
    sections.forEach(function (s, i) {
      var data = sectionsData[i];
      if (!data) return;
      var secId = s.id;
      var numMatch = /(\d+)$/.exec(secId) || [];
      var num = numMatch[1] || (i + 1);
      // Prefer the short course_config title — the LLM-generated title
      // is often a 60+ char marketing sentence and overflows the node.
      var secLabel  = stripMd(s.title  || data.title || secId);
      var secLong   = stripMd(data.title || s.title  || secId);

      nodes.push({
        data: {
          id:        secId,
          label:     secLabel,
          longLabel: secLong,
          short:     'Section ' + num,
          type:      'section',
          num:       num,
          url:       'section.html?id=' + encodeURIComponent(secId),
          weight:    0,
          size:      46,
        },
      });
      edges.push({
        data: {
          id:    'h:course-' + secId,
          source:'course',
          target:secId,
          kind:  'hierarchy',
        },
      });

      var kcs = data.key_concepts || [];
      kcs.forEach(function (kc) {
        if (!kc || typeof kc !== 'object') return;
        var name = stripMd(kc.concept);
        if (!name) return;
        var cId = 'c:' + secId + ':' + slug(name);
        nodes.push({
          data: {
            id:           cId,
            label:        shortLabel(name, 28),
            full:         name,
            type:         'concept',
            sectionId:    secId,
            sectionLabel: secLabel,
            explanation:  stripMd(kc.explanation || ''),
            url:          'section.html?id=' + encodeURIComponent(secId),
            isPriority:   'false',  // string for Cytoscape selector matching
            hardCount:    0,
            mentions:     0,        // bridges into this concept; filled below
            size:         16,
          },
        });
        edges.push({
          data: {
            id:     'h:' + secId + '-' + cId,
            source: secId,
            target: cId,
            kind:   'hierarchy',
          },
        });
        conceptIdx.push({
          phrase:    name,
          lower:     name.toLowerCase(),
          sectionId: secId,
          conceptId: cId,
        });
      });
    });

    // Longest phrases first so "Capital Asset Pricing Model" wins over "Capital"
    conceptIdx.sort(function (a, b) { return b.phrase.length - a.phrase.length; });

    // 4. Cross-section bridges via substring match.
    // The matcher needs to reject noise — short generic words like
    // "Risk" or "Return" appear in nearly every explanation and would
    // turn the graph into a hairball. We require either a multi-word
    // phrase, an all-caps abbreviation (CAPM/WACC/NPV), or a long
    // single word (≥10 chars). A stop-list filters the worst offenders.
    var STOPWORDS = new Set([
      'risk', 'return', 'cost', 'value', 'market', 'price', 'asset',
      'debt', 'equity', 'firm', 'stock', 'bond', 'rate', 'cash', 'flow',
      'investment', 'finance', 'capital', 'income', 'tax', 'taxes',
      'time', 'period', 'year', 'expected', 'present', 'future',
      'corporate', 'corporation', 'shareholder', 'investor', 'manager',
      'option', 'profit', 'loss', 'project', 'decision',
    ]);

    function isMeaningful(phrase, lower) {
      // Multi-word phrases pass the bar straight away (high specificity).
      if (/\s/.test(phrase)) return true;
      // ALLCAPS abbreviations of 3–6 chars: CAPM, WACC, NPV, IRR, MM, etc.
      if (/^[A-Z]{2,6}$/.test(phrase)) return true;
      // Long single words (Modigliani, Diversification, …).
      if (phrase.length >= 10 && !STOPWORDS.has(lower)) return true;
      return false;
    }

    var nodeById = {};
    nodes.forEach(function (n) { nodeById[n.data.id] = n; });
    var seenEdges = {};
    // Track candidate bridges per node so we can cap them later.
    var byNode = {};

    conceptIdx.forEach(function (target) {
      var ownerSec = target.sectionId;
      var explanation = (nodeById[target.conceptId].data.explanation || '').toLowerCase();
      if (explanation.length < 6) return;
      conceptIdx.forEach(function (src) {
        if (src.sectionId === ownerSec) return;
        if (!isMeaningful(src.phrase, src.lower)) return;
        var re = new RegExp('\\b' + escapeRe(src.lower) + '\\b');
        if (!re.test(explanation)) return;
        var pair = [src.conceptId, target.conceptId].sort();
        var key = pair[0] + '|' + pair[1];
        if (seenEdges[key]) return;
        seenEdges[key] = true;
        // Weight = phrase length (longer = more specific match).
        var weight = src.phrase.length;
        var cand = {
          id: 'b:' + key, source: pair[0], target: pair[1],
          kind: 'bridge', weight: weight,
        };
        (byNode[pair[0]] = byNode[pair[0]] || []).push(cand);
        (byNode[pair[1]] = byNode[pair[1]] || []).push(cand);
      });
    });

    // Cap to the top-N bridges per node (by phrase length / specificity),
    // then emit each unique edge once.
    var PER_NODE_CAP = 4;
    var keep = {};
    Object.keys(byNode).forEach(function (nid) {
      byNode[nid].sort(function (a, b) { return b.weight - a.weight; });
      byNode[nid].slice(0, PER_NODE_CAP).forEach(function (c) {
        keep[c.id] = c;
      });
    });
    Object.values(keep).forEach(function (c) {
      edges.push({ data: { id: c.id, source: c.source, target: c.target, kind: 'bridge' } });
      nodeById[c.source].data.mentions++;
      nodeById[c.target].data.mentions++;
    });

    // 5. Priority flagging from exam_prep.json
    if (exam) {
      var priorityPhrases = [];
      (exam.topic_weights || []).forEach(function (t) {
        if (t && t.topic) priorityPhrases.push(stripMd(t.topic).toLowerCase());
      });
      (exam.recurring_patterns || []).forEach(function (p) {
        if (p && p.pattern) priorityPhrases.push(stripMd(p.pattern).toLowerCase());
      });
      nodes.forEach(function (n) {
        if (n.data.type !== 'concept') return;
        var label = (n.data.full || n.data.label || '').toLowerCase();
        if (label.length < 4) return;
        for (var i = 0; i < priorityPhrases.length; i++) {
          var p = priorityPhrases[i];
          if (!p || p.length < 4) continue;
          if (p.indexOf(label) !== -1 || label.indexOf(p) !== -1) {
            n.data.isPriority = 'true';
            break;
          }
        }
      });

      // Section weight = sum of topic_weights whose rationale mentions
      // the section number or one of its key concepts.
      (exam.topic_weights || []).forEach(function (t) {
        if (!t) return;
        var w = Number(t.weight_pct) || 0;
        var rationale = stripMd(t.rationale || '').toLowerCase();
        sections.forEach(function (s, i) {
          var n = nodeById[s.id];
          if (!n) return;
          var numMatch = /(\d+)$/.exec(s.id);
          var num = numMatch ? numMatch[1] : '';
          if (num && rationale.indexOf('section ' + num) !== -1) {
            n.data.weight += w * 0.5;  // half-credit for an explicit "Section N" mention
          }
          var title = (s.title || '').toLowerCase();
          var topic = stripMd(t.topic || '').toLowerCase();
          if (title && topic && title.indexOf(topic) !== -1) {
            n.data.weight += w;
          }
        });
      });
    }

    // 6. Hard-card counts per concept (badge fodder)
    flashcardsData.forEach(function (cards, i) {
      var secId = sections[i] && sections[i].id;
      if (!secId) return;
      var arr = Array.isArray(cards) ? cards : (cards && cards.flashcards) || [];
      arr.forEach(function (card) {
        if (!card || (card.difficulty || '').toLowerCase() !== 'hard') return;
        var blob = stripMd((card.front || '') + ' ' + (card.back || '')).toLowerCase();
        nodes.forEach(function (n) {
          if (n.data.type !== 'concept' || n.data.sectionId !== secId) return;
          var name = (n.data.full || '').toLowerCase();
          if (name.length < 4) return;
          if (blob.indexOf(name) !== -1) {
            n.data.hardCount++;
          }
        });
      });
    });

    // 7. Size scaling: bigger = more prominent
    var maxWeight = 0;
    nodes.forEach(function (n) {
      if (n.data.type === 'section' && n.data.weight > maxWeight) maxWeight = n.data.weight;
    });
    if (maxWeight === 0) maxWeight = 1;
    nodes.forEach(function (n) {
      if (n.data.type === 'section') {
        n.data.size = 46 + (n.data.weight / maxWeight) * 22;   // 46..68
      } else if (n.data.type === 'concept') {
        n.data.size = 14 + Math.min(n.data.mentions, 8) * 1.5; // 14..26
      }
    });

    return {
      elements: { nodes: nodes, edges: edges },
      conceptIdx: conceptIdx,
    };
  }

  // ── Style derived from CSS variables ───────────────────────────────────

  function readVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }

  function buildStyle() {
    var pri        = readVar('--primary');
    var priDeep    = readVar('--primary-deep');
    var priMid     = readVar('--primary-mid');
    var priLight   = readVar('--primary-light');
    var priMist    = readVar('--primary-mist');
    var bg         = readVar('--bg');
    var surface    = readVar('--surface');
    var border     = readVar('--border');
    var ink        = readVar('--ink');
    var inkSoft    = readVar('--ink-soft');
    var inkFaded   = readVar('--ink-faded');
    var highlight  = readVar('--highlight');
    var warm       = readVar('--warm');
    var ok         = readVar('--ok');

    return [
      // Course root
      {
        selector: 'node[type="course"]',
        style: {
          'background-color': ink,
          'border-width': 0,
          'shape': 'round-rectangle',
          'width': 110,
          'height': 60,
          'label': 'data(label)',
          'color': bg,
          'font-size': 13,
          'font-weight': 700,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 100,
        },
      },
      // Sections — pills with thicker primary border. Width / height
      // auto-fit the label so the short course_config title always
      // sits inside the chip, regardless of its length.
      {
        selector: 'node[type="section"]',
        style: {
          'background-color': surface,
          'border-color': pri,
          'border-width': 2,
          'shape': 'round-rectangle',
          'width': 'label',
          'height': 'label',
          'padding-left':   14,
          'padding-right':  14,
          'padding-top':    10,
          'padding-bottom': 10,
          'label': 'data(label)',
          'color': ink,
          'font-size': 11,
          'font-weight': 600,
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': 160,
        },
      },
      // Concepts
      {
        selector: 'node[type="concept"]',
        style: {
          'background-color': bg,
          'border-color': priMid,
          'border-width': 1.2,
          'shape': 'ellipse',
          'width': 'data(size)',
          'height': 'data(size)',
          'label': 'data(label)',
          'color': inkSoft,
          'font-size': 8.5,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 4,
          'text-wrap': 'wrap',
          'text-max-width': 100,
          'min-zoomed-font-size': 8,
        },
      },
      {
        selector: 'node[type="concept"][isPriority="true"]',
        style: {
          'border-color': highlight,
          'border-width': 2.4,
          'background-color': priMist,
        },
      },
      // Hierarchy edges
      {
        selector: 'edge[kind="hierarchy"]',
        style: {
          'curve-style': 'straight',
          'line-color': border,
          'width': 1,
          'target-arrow-shape': 'none',
          'opacity': 0.8,
        },
      },
      // Cross-section bridges
      {
        selector: 'edge[kind="bridge"]',
        style: {
          'curve-style': 'bezier',
          'line-color': priLight,
          'line-style': 'dashed',
          'width': 1,
          'opacity': 0.55,
        },
      },
      // Hidden bridge state (used in tree layout)
      {
        selector: '.bridge-hidden',
        style: { 'display': 'none' },
      },
      // Hover / highlight states
      {
        selector: '.dim',
        style: { 'opacity': 0.18 },
      },
      {
        selector: '.faded-edge',
        style: { 'opacity': 0.10 },
      },
      {
        selector: '.pulse',
        style: {
          'border-color': warm,
          'border-width': 4,
          'overlay-color': warm,
          'overlay-opacity': 0.18,
          'overlay-padding': 10,
        },
      },
      {
        selector: '.hot-bridge',
        style: {
          'line-color': pri,
          'width': 2,
          'opacity': 1,
        },
      },
      {
        selector: 'node.hot',
        style: {
          'border-color': pri,
          'border-width': 2.4,
        },
      },
      // Hard-card badge: rendered as a pseudo-element via overlay label
      // when hardCount > 0. We use the `pie` background trick: a small
      // teal circle in the corner is hard to do natively, so we paint
      // it into the node's overlay layer.
      {
        selector: 'node[type="concept"][hardCount > 0]',
        style: {
          'background-image': 'radial-gradient(circle at 90% 10%, '
            + warm + ' 0%, ' + warm + ' 35%, transparent 36%)',
          'background-fit': 'cover',
        },
      },
    ];
  }

  // ── Layouts ────────────────────────────────────────────────────────────

  // Radial tree using d3-hierarchy: course at centre, sections on inner
  // ring, concepts on outer ring. We compute positions once and feed
  // them to Cytoscape's `preset` layout.
  function radialPositions(cy) {
    var children = {};
    cy.edges('[kind="hierarchy"]').forEach(function (e) {
      var src = e.source().id();
      var tgt = e.target().id();
      if (!children[src]) children[src] = [];
      children[src].push(tgt);
    });

    function toTree(id) {
      var kids = (children[id] || []).map(toTree);
      return { name: id, children: kids.length ? kids : undefined };
    }
    var root = window.d3.hierarchy(toTree('course'));
    var width  = Math.max(800, cy.width());
    var height = Math.max(600, cy.height());
    var radius = Math.min(width, height) / 2 - 30;

    window.d3.tree()
      .size([2 * Math.PI, radius])
      .separation(function (a, b) {
        return (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth);
      })(root);

    var positions = {};
    root.descendants().forEach(function (n) {
      var angle = n.x - Math.PI / 2;
      positions[n.data.name] = { x: n.y * Math.cos(angle), y: n.y * Math.sin(angle) };
    });
    return positions;
  }

  // After any layout, stretch node positions on the x axis so the
  // roughly-circular force / radial layout fills the wide canvas
  // instead of leaving big horizontal gutters. The factor is the
  // canvas aspect ratio, clamped so the graph never gets weirdly
  // squashed on near-square viewports.
  function stretchToCanvas(cy) {
    var w = cy.width(), h = cy.height();
    if (!w || !h) return;
    var factor = Math.max(1.15, Math.min(2.0, (w / h) * 0.95));
    var bb = cy.elements().boundingBox();
    var cx = (bb.x1 + bb.x2) / 2;
    cy.batch(function () {
      cy.nodes().forEach(function (n) {
        var p = n.position();
        n.position({ x: cx + (p.x - cx) * factor, y: p.y });
      });
    });
    cy.animate({ fit: { padding: 36 }, duration: 220 });
  }

  function applyLayout(cy, mode) {
    if (mode === 'tree') {
      // Hide bridges; they create radial chaos.
      cy.edges('[kind="bridge"]').addClass('bridge-hidden');
      var pos = radialPositions(cy);
      var lay = cy.layout({
        name: 'preset',
        positions: function (n) { return pos[n.id()] || { x: 0, y: 0 }; },
        animate: true,
        animationDuration: 500,
        fit: false,
        padding: 36,
      });
      lay.one('layoutstop', function () { stretchToCanvas(cy); });
      lay.run();
    } else {
      cy.edges('[kind="bridge"]').removeClass('bridge-hidden');
      var hasFcose = !!(window.cytoscape && window.cytoscape('layout', 'fcose'));
      var lay;
      if (hasFcose) {
        lay = cy.layout({
          name: 'fcose',
          animate: 'end',
          animationDuration: 600,
          fit: false,
          padding: 36,
          randomize: false,
          // Heavier repulsion + much longer ideal edges → clusters
          // separate clearly instead of collapsing into one ball.
          nodeRepulsion: 14000,
          idealEdgeLength: function (edge) {
            return edge.data('kind') === 'bridge' ? 220 : 110;
          },
          edgeElasticity: function (edge) {
            return edge.data('kind') === 'bridge' ? 0.04 : 0.55;
          },
          gravity: 0.25,
          gravityRangeCompound: 1.5,
          nestingFactor: 0.3,
          numIter: 3000,
        });
      } else {
        lay = cy.layout({
          name: 'cose',
          animate: 'end',
          animationDuration: 600,
          fit: false,
          padding: 36,
          randomize: false,
          nodeRepulsion: function () { return 350000; },
          idealEdgeLength: function () { return 110; },
          edgeElasticity: function () { return 80; },
          gravity: 35,
          numIter: 1500,
        });
      }
      lay.one('layoutstop', function () { stretchToCanvas(cy); });
      lay.run();
    }
  }

  // ── Interactions ───────────────────────────────────────────────────────

  function setupInteractions(cy, ctx) {
    // Hover: highlight neighbours, dim the rest.
    cy.on('mouseover', 'node[type="concept"], node[type="section"]', function (evt) {
      var n = evt.target;
      cy.elements().removeClass('hot hot-bridge');
      n.addClass('hot');
      var neighbours = n.openNeighborhood();
      cy.elements().not(n).not(neighbours).addClass('faded-edge');
      n.connectedEdges('[kind="bridge"]').addClass('hot-bridge');
    });
    cy.on('mouseout', 'node', function () {
      cy.elements().removeClass('hot hot-bridge faded-edge');
    });

    // Click a concept → its section page.
    cy.on('tap', 'node[type="concept"]', function (evt) {
      var url = evt.target.data('url');
      if (url) window.location.href = url;
    });
    // Click a section → the section page.
    cy.on('tap', 'node[type="section"]', function (evt) {
      var url = evt.target.data('url');
      if (url) window.location.href = url;
    });

    // Side-panel preview on long-press / right-click (also tap on concept node).
    cy.on('cxttap', 'node[type="concept"]', function (evt) {
      showPanel(evt.target, ctx);
    });
  }

  function showPanel(node, ctx) {
    var panel = ctx.panel;
    if (!panel) return;
    var d = node.data();
    panel.innerHTML =
      '<div class="mm-panel-head">' +
        '<span class="mm-panel-eyebrow">' + escapeHtml(d.sectionLabel || '') + '</span>' +
        '<button class="mm-panel-close" type="button" aria-label="Close">×</button>' +
      '</div>' +
      '<h3>' + escapeHtml(d.full || d.label) + '</h3>' +
      (d.explanation
        ? '<p class="mm-panel-body">' + escapeHtml(d.explanation.slice(0, 320)) +
          (d.explanation.length > 320 ? '…' : '') + '</p>'
        : '') +
      (d.hardCount > 0
        ? '<p class="mm-panel-meta">' +
          '<span class="mm-meta-chip mm-meta-warm">' + d.hardCount + ' hard flashcard' +
          (d.hardCount === 1 ? '' : 's') + '</span></p>'
        : '') +
      '<a class="mm-panel-cta" href="' + d.url + '">Open section →</a>';
    panel.classList.add('is-open');
    panel.querySelector('.mm-panel-close').addEventListener('click', function () {
      panel.classList.remove('is-open');
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Search ─────────────────────────────────────────────────────────────

  function setupSearch(cy, ctx) {
    var input = ctx.searchEl;
    if (!input) return;
    var clearTimer = null;

    function pulse(node) {
      cy.elements().removeClass('pulse dim');
      cy.elements('node[type="concept"], node[type="section"]')
        .not(node).addClass('dim');
      cy.edges().addClass('dim');
      node.addClass('pulse');
      cy.animate({
        center: { eles: node },
        zoom: Math.min(1.6, Math.max(0.9, cy.zoom())),
        duration: 450,
      });
      clearTimeout(clearTimer);
      clearTimer = setTimeout(function () {
        cy.elements().removeClass('pulse dim');
      }, 4000);
    }

    function searchFor(q) {
      if (!q || q.length < 2) {
        cy.elements().removeClass('pulse dim');
        return;
      }
      var qLower = q.toLowerCase();
      // First exact-ish match against concept names, then section names.
      var match = cy.nodes('[type="concept"]').filter(function (n) {
        return (n.data('full') || '').toLowerCase().indexOf(qLower) !== -1;
      })[0];
      if (!match) {
        match = cy.nodes('[type="section"]').filter(function (n) {
          return (n.data('label') || '').toLowerCase().indexOf(qLower) !== -1;
        })[0];
      }
      if (match) pulse(match);
    }

    input.addEventListener('input', function () { searchFor(input.value.trim()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        input.value = '';
        cy.elements().removeClass('pulse dim');
        input.blur();
      }
    });
    return searchFor;
  }

  // ── Priority toggle ────────────────────────────────────────────────────

  function setupPriorityToggle(cy, ctx) {
    var btn = ctx.priorityBtn;
    if (!btn) return;
    btn.addEventListener('click', function () {
      var on = !btn.classList.contains('is-on');
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) {
        cy.nodes('[type="concept"][isPriority!="true"]').addClass('dim');
        cy.nodes('[type="concept"][isPriority!="true"]').connectedEdges().addClass('dim');
      } else {
        cy.elements().removeClass('dim');
      }
    });
  }

  // ── Layout switch ──────────────────────────────────────────────────────

  function setupLayoutSwitch(cy, ctx) {
    var btns = ctx.toolbar.querySelectorAll('[data-layout]');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        applyLayout(cy, b.dataset.layout);
      });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────

  function getParams() {
    var p = new URLSearchParams(window.location.search);
    return {
      focus:  p.get('focus'),
      q:      p.get('q'),
      layout: p.get('layout'),  // 'force' | 'tree'
    };
  }

  function boot() {
    var canvas       = document.getElementById('mindmap-canvas');
    var toolbar      = document.getElementById('mm-toolbar');
    var searchEl     = document.getElementById('mm-search');
    var priorityBtn  = document.getElementById('mm-priority');
    var resetBtn     = document.getElementById('mm-reset');
    var panel        = document.getElementById('mm-panel');
    var loadingEl    = document.getElementById('mm-loading');
    var errorEl      = document.getElementById('mm-error');
    if (!canvas) return;

    var params = getParams();

    // Load cytoscape + d3-hierarchy first, then fcose. fcose's UMD
    // expects cytoscape on the page already.
    var fcoseReady = false;
    Promise.all([
      loadScript(CYTO_SRC),
      loadScript(D3_SRC),
    ]).then(function () {
      return loadScript(FCOSE_SRC).catch(function () { return null; });
    }).then(function () {
      // Try every UMD global the extension might expose, then explicitly
      // register it. If anything goes wrong, fall back to the built-in
      // 'cose' layout (which ships with Cytoscape core) so the page
      // still renders.
      var fcose = window.cytoscapeFcose
                || window['cytoscape-fcose']
                || window.fcose;
      if (window.cytoscape && fcose) {
        try {
          window.cytoscape.use(fcose);
          fcoseReady = true;
        } catch (e) {
          console.warn('mindmap: cytoscape.use(fcose) failed:', e.message);
        }
      } else {
        console.warn('mindmap: fcose extension missing — falling back to cose');
      }
      return loadAll();
    }).then(function (vals) {
      var cfg = vals[0], sectionsData = vals[1], exam = vals[2], fc = vals[3];
      // Fill the nav brand chip + the title + the chat-widget meta tags.
      // All other pages call this; without it the `<a class="brand"
      // data-course-code>—</a>` stays as a literal em-dash.
      try { StudySite.applyCourseChrome(cfg); } catch (e) {}
      try { StudySite.maybeLoadChat(cfg); }     catch (e) {}
      var graph = buildGraph(cfg, sectionsData, exam, fc);

      if (loadingEl) loadingEl.style.display = 'none';

      var cy = window.cytoscape({
        container: canvas,
        elements:  graph.elements,
        style:     buildStyle(),
        wheelSensitivity: 0.25,
        minZoom: 0.25,
        maxZoom: 2.5,
        boxSelectionEnabled: false,
      });

      var initialLayout = params.layout === 'tree' ? 'tree' : 'force';
      var ctx = {
        panel: panel,
        searchEl: searchEl,
        priorityBtn: priorityBtn,
        toolbar: toolbar,
      };

      // Sync the toolbar switch with the initial layout.
      toolbar.querySelectorAll('[data-layout]').forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.layout === initialLayout);
      });

      applyLayout(cy, initialLayout);
      setupInteractions(cy, ctx);
      setupLayoutSwitch(cy, ctx);
      var searchFor = setupSearch(cy, ctx);
      setupPriorityToggle(cy, ctx);

      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          cy.elements().removeClass('pulse dim hot hot-bridge faded-edge');
          cy.animate({ fit: { padding: 40 }, duration: 400 });
        });
      }

      // Deep-link: focus a section
      if (params.focus) {
        var n = cy.getElementById(params.focus);
        if (n && n.length) {
          setTimeout(function () {
            cy.animate({
              center: { eles: n },
              zoom:   1.3,
              duration: 600,
            });
          }, 700);
        }
      }
      // Deep-link: pre-fill search
      if (params.q && searchEl) {
        searchEl.value = params.q;
        setTimeout(function () { searchFor && searchFor(params.q); }, 800);
      }

      // Re-fit on window resize so the graph keeps its landscape
       // proportions when the canvas itself reflows.
      var resizeTimer = null;
      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          cy.animate({ fit: { padding: 36 }, duration: 200 });
        }, 180);
      });

      // Re-style on theme change so node colours stay coherent.
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener && mq.addEventListener('change', function () {
        cy.style().fromJson(buildStyle()).update();
      });
      // The toolbar theme-toggle button also flips data-theme — listen
      // for that via a MutationObserver on the html element.
      new MutationObserver(function () {
        cy.style().fromJson(buildStyle()).update();
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      // Expose for debugging.
      window.__mindmapCy = cy;
    }).catch(function (err) {
      console.error('mindmap boot failed', err);
      if (loadingEl) loadingEl.style.display = 'none';
      if (errorEl) {
        errorEl.style.display = 'block';
        errorEl.textContent = 'Could not load the mindmap: ' + (err.message || err);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
