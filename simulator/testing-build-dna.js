/* Testing Bitstream Under Test + Build DNA graph. GET-only, standalone. */
(function (root) {
  'use strict';
  var API = '/api/testing/build-dna';
  var STORE = 'tbd_selected_bitstream';
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ---------- pure helpers (Node-testable) ----------
  function hex32(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }
  function buildUrl(kind, id) {
    if (!kind) return API;
    return API + '?' + kind + '=' + encodeURIComponent(id);
  }
  function layoutGraph(nodes, cols, mode) {
    var list = (nodes || []).slice().sort(function (a, b) {
      var sa = a.slot == null ? 1e9 : a.slot, sb = b.slot == null ? 1e9 : b.slot;
      return sa - sb || String(a.id).localeCompare(String(b.id));
    });
    var n = list.length;
    cols = cols || Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    var W = 190, H = 64, GX = 70, GY = 70, pos = {};
    if (mode === 'organized') {
      var groups = [[], [], []], row = 0;
      list.forEach(function (nd) {
        var kind = String(nd.kind || '').toLowerCase();
        var group = kind === 'namespace' || kind === 'thread' ? 0 :
          kind === 'hardware' || kind === 'mmio' || nd.availability === 'hardware-address' ? 2 : 1;
        groups[group].push(nd);
      });
      groups.forEach(function (group) {
        group.forEach(function (nd, i) {
          pos[nd.id] = { x: (i % cols) * (W + GX), y: (row + Math.floor(i / cols)) * (H + GY), w: W, h: H };
        });
        row += Math.ceil(group.length / cols);
      });
      return { pos: pos, order: [].concat.apply([], groups), width: Math.max(W, cols * (W + GX) - GX), height: Math.max(H, row * (H + GY) - GY) };
    }
    list.forEach(function (nd, i) {
      var c = i % cols, r = Math.floor(i / cols);
      pos[nd.id] = { x: c * (W + GX), y: r * (H + GY), w: W, h: H };
    });
    var rows = Math.ceil(n / cols);
    return { pos: pos, order: list, width: Math.max(W, cols * (W + GX) - GX), height: Math.max(H, rows * (H + GY) - GY) };
  }
  function edgeText(e) {
    return [e.id, e.source, e.target == null ? 'unresolved' : e.target, hex32(e.raw), e.register, e.kind,
      e.permissions, e.status, e.targetSlot].join(' ').toLowerCase();
  }
  function filterDetail(node, edges, q) {
    q = (q || '').trim().toLowerCase();
    var out = (edges || []).filter(function (e) { return e.source === node.id; });
    var inc = (edges || []).filter(function (e) { return e.target === node.id && e.source !== node.id; });
    if (q) {
      out = out.filter(function (e) { return edgeText(e).indexOf(q) >= 0; });
      inc = inc.filter(function (e) { return edgeText(e).indexOf(q) >= 0; });
    }
    return { outgoing: out, incoming: inc };
  }
  function clampZoom(z) { return Math.min(4, Math.max(0.15, z)); }
  function makeRequestGate() {
    var seq = 0;
    return { next: function () { return ++seq; }, isCurrent: function (t) { return t === seq; } };
  }
  var pure = { hex32: hex32, buildUrl: buildUrl, layoutGraph: layoutGraph, filterDetail: filterDetail, clampZoom: clampZoom, makeRequestGate: makeRequestGate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  // ---------- DOM ----------
  var doc = root.document;
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function svg(tag, attrs) {
    var e = doc.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function kv(parent, k, v, mono) {
    var r = el('div', 'tbd-kv');
    r.appendChild(el('span', 'tbd-k', k));
    r.appendChild(el('span', 'tbd-v' + (mono ? ' tbd-hash' : ''), v == null || v === '' ? '—' : v));
    parent.appendChild(r);
  }

  var gate = makeRequestGate();
  var state = { catalog: null, mode: null, graph: null, selectedNode: null, layoutMode: 'default' };
  var ui = {};

  function getJSON(url) {
    var headers = { Accept: 'application/json' };
    try {
      var token = sessionStorage.getItem('ba_build_token');
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (_) {}
    return fetch(url, { method: 'GET', credentials: 'include', headers: headers })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; })
          .then(function (j) {
            if (!r.ok && j && j.ok !== false) j.ok = false;
            if (r.status === 401 || r.status === 403) j.error = 'Build evidence authorization required. Authorize in Builder → Build Approval in this tab, then Retry here.';
            else if (!r.ok && !j.error) j.error = 'HTTP ' + r.status;
            return j;
          });
      });
  }

  function build(mount) {
    var panel = el('section', 'tbd-panel');
    panel.setAttribute('aria-labelledby', 'tbdTitle');
    var head = el('div', 'tbd-head');
    var h = el('h2', null, 'Testing — Bitstream Under Test'); h.id = 'tbdTitle';
    head.appendChild(h);
    ui.headState = el('span', 'tbd-pill tbd-pill-dim', 'No bitstream selected');
    head.appendChild(ui.headState);
    panel.appendChild(head);

    var controls = el('div', 'tbd-controls');
    var l1 = el('label', 'tbd-field');
    l1.appendChild(el('span', 'tbd-lbl', 'Bitstream'));
    ui.bsSel = el('select'); ui.bsSel.id = 'tbdBitstream';
    l1.appendChild(ui.bsSel);
    controls.appendChild(l1);
    ui.viewBtn = el('button', 'tbd-btn', 'View Build DNA');
    ui.viewBtn.type = 'button'; ui.viewBtn.disabled = true;
    controls.appendChild(ui.viewBtn);
    ui.clearBtn = el('button', 'tbd-btn tbd-btn-quiet', 'Clear selection');
    ui.clearBtn.type = 'button';
    controls.appendChild(ui.clearBtn);
    controls.appendChild(el('span', 'tbd-sep'));
    var l2 = el('label', 'tbd-field');
    l2.appendChild(el('span', 'tbd-lbl', 'Inspect frozen Namespace (unassociated)'));
    ui.nsSel = el('select'); ui.nsSel.id = 'tbdNamespace';
    l2.appendChild(ui.nsSel);
    controls.appendChild(l2);
    ui.nsBtn = el('button', 'tbd-btn tbd-btn-warn', 'Inspect Namespace');
    ui.nsBtn.type = 'button'; ui.nsBtn.disabled = true;
    controls.appendChild(ui.nsBtn);
    panel.appendChild(controls);

    ui.status = el('div', 'tbd-status'); ui.status.setAttribute('role', 'status'); ui.status.setAttribute('aria-live', 'polite');
    panel.appendChild(ui.status);
    ui.body = el('div', 'tbd-body');
    panel.appendChild(ui.body);
    mount.appendChild(panel);

    ui.bsSel.addEventListener('change', function () {
      var id = ui.bsSel.value;
      try { id ? localStorage.setItem(STORE, id) : localStorage.removeItem(STORE); } catch (_) {}
      renderSelected();
    });
    ui.clearBtn.addEventListener('click', function () { ui.bsSel.value = ''; ui.bsSel.dispatchEvent(new Event('change')); });
    ui.nsSel.addEventListener('change', function () { ui.nsBtn.disabled = !ui.nsSel.value; });
    ui.viewBtn.addEventListener('click', function () { if (ui.bsSel.value) loadGraph('bitstream', ui.bsSel.value); });
    ui.nsBtn.addEventListener('click', function () { if (ui.nsSel.value) loadGraph('namespace', ui.nsSel.value); });
    buildDialog();
    loadCatalog();
  }

  function setStatus(text, kind) { ui.status.textContent = text || ''; ui.status.className = 'tbd-status' + (kind ? ' tbd-status-' + kind : ''); }

  function skeleton(target) {
    target.textContent = '';
    var s = el('div', 'tbd-skel'); s.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 4; i++) s.appendChild(el('div', 'tbd-skel-line'));
    target.appendChild(s);
  }

  function loadCatalog() {
    var t = gate.next();
    setStatus('Loading bitstream catalog…');
    skeleton(ui.body);
    getJSON(API).then(function (j) {
      if (!gate.isCurrent(t)) return;
      if (!j || !j.ok) throw new Error((j && (j.error || j.reason)) || 'Catalog unavailable');
      state.catalog = j;
      fillSelects();
      setStatus('');
      renderSelected();
    }).catch(function (err) {
      if (!gate.isCurrent(t)) return;
      ui.body.textContent = '';
      var box = el('div', 'tbd-empty tbd-error');
      box.appendChild(el('div', null, 'Could not load the build catalog: ' + (err && err.message || err)));
      var retry = el('button', 'tbd-btn', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', loadCatalog);
      box.appendChild(retry);
      ui.body.appendChild(box);
      setStatus('Catalog request failed.', 'bad');
    });
  }

  function fillSelects() {
    var c = state.catalog;
    ui.bsSel.textContent = '';
    var none = el('option', null, '— none selected —'); none.value = '';
    ui.bsSel.appendChild(none);
    (c.bitstreams || []).forEach(function (b) {
      var o = el('option', null, (b.label || b.id) + ' · ' + String(b.sha256 || '').slice(0, 12));
      o.value = b.id; ui.bsSel.appendChild(o);
    });
    var saved = null;
    try { saved = localStorage.getItem(STORE); } catch (_) {}
    var valid = saved && (c.bitstreams || []).some(function (b) { return b.id === saved; });
    if (saved && !valid) { try { localStorage.removeItem(STORE); } catch (_) {} setStatus('Previously selected bitstream no longer in catalog; selection cleared.', 'warn'); }
    ui.bsSel.value = valid ? saved : '';
    ui.nsSel.textContent = '';
    var n0 = el('option', null, '— choose Namespace —'); n0.value = '';
    ui.nsSel.appendChild(n0);
    (c.namespaces || []).forEach(function (n) {
      var o = el('option', null, (n.label || n.id) + (n.imageAvailable ? '' : ' (image unavailable)'));
      o.value = n.id; o.disabled = !n.imageAvailable; ui.nsSel.appendChild(o);
    });
    ui.nsBtn.disabled = true;
  }

  function findBs(id) { return ((state.catalog && state.catalog.bitstreams) || []).filter(function (b) { return b.id === id; })[0]; }

  function renderInstalled(parent, inst) {
    var box = el('div', 'tbd-installed');
    box.appendChild(el('div', 'tbd-sub', 'Installed on board'));
    kv(box, 'Status', (inst && inst.status ? String(inst.status).toUpperCase() : 'UNVERIFIED'));
    kv(box, 'Reason', inst && inst.reason);
    box.appendChild(el('p', 'tbd-note', 'Selecting a bitstream here does not assert it is installed. The newest build is never assumed to be on the board.'));
    parent.appendChild(box);
  }

  function renderIssues(parent, issues) {
    if (!issues || !issues.length) return;
    var ul = el('ul', 'tbd-issues');
    issues.forEach(function (i) { ul.appendChild(el('li', null, typeof i === 'string' ? i : (i.message || JSON.stringify(i)))); });
    parent.appendChild(ul);
  }

  function renderSelected() {
    var c = state.catalog; if (!c) return;
    ui.body.textContent = '';
    var id = ui.bsSel.value;
    var b = id && findBs(id);
    ui.viewBtn.disabled = !b;
    var grid = el('div', 'tbd-grid');
    var card = el('div', 'tbd-card');
    if (!b) {
      ui.headState.textContent = 'No bitstream selected'; ui.headState.className = 'tbd-pill tbd-pill-dim';
      card.appendChild(el('div', 'tbd-sub', 'Selected for testing'));
      card.appendChild(el('p', 'tbd-note', 'No bitstream selected. Choose one to see its exact hashes and the linked Namespace evidence, or inspect a frozen Namespace independently.'));
    } else {
      ui.headState.textContent = 'Selected · installed unverified'; ui.headState.className = 'tbd-pill tbd-pill-sel';
      card.appendChild(el('div', 'tbd-sub', 'Selected for testing'));
      kv(card, 'Label', b.label); kv(card, 'Bitstream id', b.id, true);
      kv(card, 'SHA-256', b.sha256, true);
      kv(card, 'Hardware version', b.hardwareVersion);
      kv(card, 'Source commit', b.sourceCommit, true);
      var nsRow = el('div', 'tbd-kv');
      nsRow.appendChild(el('span', 'tbd-k', 'Namespace Under Test'));
      var nsv = el('span', 'tbd-v');
      if (b.namespaceRevisionId) {
        nsv.appendChild(el('span', 'tbd-hash', b.namespaceRevisionId + ' '));
        var a = el('button', 'tbd-link', 'View Build DNA'); a.type = 'button';
        a.addEventListener('click', function () { loadGraph('bitstream', b.id); });
        nsv.appendChild(a);
      } else {
        nsv.appendChild(el('span', 'tbd-dim', 'no linked Namespace evidence — use frozen Namespace inspection'));
      }
      nsRow.appendChild(nsv); card.appendChild(nsRow);
    }
    grid.appendChild(card);
    renderInstalled(grid, c.installed);
    ui.body.appendChild(grid);
    renderIssues(ui.body, c.issues);
  }

  // ---------- graph dialog ----------
  var view = { z: 1, x: 0, y: 0 };
  // Render in the outermost same-origin app document, not the Testing iframe.
  // The Replit preview shell is cross-origin and remains outside our control.
  function dialogHost() {
    var host = root;
    while (host.parent !== host) {
      try {
        if (host.parent.location.origin !== root.location.origin) break;
        void host.parent.document.body;
        host = host.parent;
      } catch (_) { break; }
    }
    return host.document;
  }
  function buildDialog() {
    var d = el('dialog', 'tbd-dialog'); d.setAttribute('aria-labelledby', 'tbdDlgTitle');
    var top = el('div', 'tbd-dlg-head');
    var t = el('h2', null, 'Build DNA'); t.id = 'tbdDlgTitle';
    var heading = el('div', 'tbd-dlg-heading');
    heading.appendChild(t);
    ui.layoutSel = el('select', 'tbd-layout'); ui.layoutSel.id = 'tbdLayout';
    ui.layoutSel.setAttribute('aria-label', 'Build DNA layout');
    [['default', 'Default'], ['organized', 'Organized']].forEach(function (option) {
      var opt = el('option', null, option[1]); opt.value = option[0]; ui.layoutSel.appendChild(opt);
    });
    ui.layoutSel.addEventListener('change', function () {
      state.layoutMode = ui.layoutSel.value;
      if (state.graph) renderGraph(state.mode, state.graphId);
    });
    heading.appendChild(ui.layoutSel); top.appendChild(heading);
    ui.dlgBanner = el('div', 'tbd-banner');
    top.appendChild(ui.dlgBanner);
    var tools = el('div', 'tbd-tools');
    [['−', 'Zoom out', function () { zoomAt(1 / 1.25); }], ['+', 'Zoom in', function () { zoomAt(1.25); }], ['Fit', 'Fit graph to view', fit]].forEach(function (s) {
      var bt = el('button', 'tbd-btn', s[0]); bt.type = 'button'; bt.setAttribute('aria-label', s[1]); bt.title = s[1];
      bt.addEventListener('click', s[2]); tools.appendChild(bt);
    });
    var close = el('button', 'tbd-btn', 'Close'); close.type = 'button';
    close.addEventListener('click', function () { d.close(); });
    tools.appendChild(close);
    top.appendChild(tools);
    d.appendChild(top);
    ui.dlgMeta = el('div', 'tbd-meta'); d.appendChild(ui.dlgMeta);
    var main = el('div', 'tbd-dlg-main');
    ui.stage = el('div', 'tbd-stage'); ui.stage.tabIndex = 0;
    ui.stage.setAttribute('aria-label', 'GT object graph. Drag to pan, wheel to zoom.');
    main.appendChild(ui.stage);
    var side = el('aside', 'tbd-detail');
    ui.search = el('input'); ui.search.type = 'search'; ui.search.placeholder = 'Search GTs (raw, register, target, status)…';
    ui.search.setAttribute('aria-label', 'Search object GTs');
    ui.search.addEventListener('input', renderDetail);
    side.appendChild(ui.search);
    ui.detail = el('div', 'tbd-detail-body'); side.appendChild(ui.detail);
    main.appendChild(side);
    d.appendChild(main);
    var hostDoc = dialogHost();
    if (hostDoc !== doc && !hostDoc.querySelector('link[data-build-dna-style]')) {
      var style = hostDoc.createElement('link');
      style.rel = 'stylesheet';
      style.href = new URL('/simulator/testing-build-dna.css', root.location.href).href;
      style.setAttribute('data-build-dna-style', '');
      style.addEventListener('load', fit);
      hostDoc.head.appendChild(style);
    }
    hostDoc.body.appendChild(d);
    ui.dlg = d;
    d.addEventListener('keydown', function (event) { event.stopPropagation(); });
    d.addEventListener('close', function () {
      if (ui.returnFocus && ui.returnFocus.isConnected) ui.returnFocus.focus();
    });
    // Remove the promoted dialog if its owning Testing page is unloaded.
    root.addEventListener('pagehide', function () { d.remove(); });
    if (root.ResizeObserver) new root.ResizeObserver(function () {
      if (d.open) fit();
    }).observe(ui.stage);

    var drag = null;
    ui.stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.tbd-node')) return;
      drag = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
      ui.stage.setPointerCapture(e.pointerId); ui.stage.classList.add('is-panning');
    });
    ui.stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      view.x = drag.ox + e.clientX - drag.x; view.y = drag.oy + e.clientY - drag.y; applyView();
    });
    function end() { drag = null; ui.stage.classList.remove('is-panning'); }
    ui.stage.addEventListener('pointerup', end); ui.stage.addEventListener('pointercancel', end);
    ui.stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = ui.stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    ui.stage.addEventListener('keydown', function (e) {
      var s = 40;
      if (e.key === '+' || e.key === '=') zoomAt(1.2); else if (e.key === '-') zoomAt(1 / 1.2);
      else if (e.key === 'ArrowLeft') { view.x += s; applyView(); } else if (e.key === 'ArrowRight') { view.x -= s; applyView(); }
      else if (e.key === 'ArrowUp') { view.y += s; applyView(); } else if (e.key === 'ArrowDown') { view.y -= s; applyView(); }
      else if (e.key === '0') fit(); else return;
      e.preventDefault();
    });
  }
  function applyView() { if (ui.gRoot) ui.gRoot.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.z + ')'); }
  function zoomAt(f, cx, cy) {
    var r = ui.stage.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    var nz = clampZoom(view.z * f), k = nz / view.z;
    view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.z = nz; applyView();
  }
  function fit() {
    if (!state.layout) return;
    var r = ui.stage.getBoundingClientRect(), L = state.layout, pad = 60;
    var w = L.width + pad * 2 + 120, hgt = L.height + pad * 2 + 60;
    view.z = clampZoom(Math.min(r.width / w, r.height / hgt));
    view.x = (r.width - L.width * view.z) / 2; view.y = (r.height - L.height * view.z) / 2; applyView();
  }

  function openDialog() {
    if (!ui.dlg.open) {
      ui.returnFocus = doc.activeElement;
      if (ui.dlg.showModal) ui.dlg.showModal(); else ui.dlg.setAttribute('open', '');
    }
  }

  function loadGraph(kind, id) {
    var t = gate.next();
    state.mode = kind; state.graphId = id; state.graph = null; state.selectedNode = null; state.layout = null;
    openDialog();
    ui.dlgBanner.textContent = ''; ui.dlgMeta.textContent = ''; ui.detail.textContent = '';
    ui.dlg.classList.toggle('tbd-unassoc', kind === 'namespace');
    if (kind === 'namespace') ui.dlgBanner.appendChild(el('strong', null, 'UNASSOCIATED NAMESPACE INSPECTION — not bitstream evidence'));
    skeleton(ui.stage);
    getJSON(buildUrl(kind, id)).then(function (j) {
      if (!gate.isCurrent(t)) return;
      if (!j || !j.ok) throw new Error((j && (j.error || j.reason)) || 'Request failed');
      state.graph = j; renderGraph(kind, id);
    }).catch(function (err) {
      if (!gate.isCurrent(t)) return;
      ui.stage.textContent = '';
      var box = el('div', 'tbd-empty tbd-error');
      box.appendChild(el('div', null, 'Could not load graph: ' + (err && err.message || err)));
      var rb = el('button', 'tbd-btn', 'Retry'); rb.type = 'button';
      rb.addEventListener('click', function () { loadGraph(kind, id); });
      box.appendChild(rb); ui.stage.appendChild(box);
    });
  }

  function renderGraph(kind, id) {
    var g = state.graph;
    var meta = ui.dlgMeta;
    meta.textContent = '';
    if (kind === 'bitstream') {
      var b = findBs(id) || {};
      kv(meta, 'Bitstream', (g.bitstream && g.bitstream.label) || id, true);
      kv(meta, 'SHA-256', b.sha256, true);
      kv(meta, 'Namespace revision', g.namespaceRevisionId, true);
      kv(meta, 'Evidence status', String(g.status || '').toUpperCase());
    } else {
      kv(meta, 'Namespace revision', g.namespaceRevisionId || id, true);
    }
    kv(meta, 'Image hash', g.imageHash, true);
    kv(meta, 'Image format', [g.imageKind, g.imageLayout].filter(Boolean).join(' · '));
    kv(meta, 'Installed', ((g.installed && g.installed.status) || 'unverified').toUpperCase() + (g.installed && g.installed.reason ? ' — ' + g.installed.reason : ''));
    renderIssues(meta, g.issues);
    ui.stage.textContent = '';
    if (kind === 'bitstream' && g.status !== 'available') {
      var u = el('div', 'tbd-empty');
      u.appendChild(el('strong', null, 'Build DNA unavailable for this bitstream.'));
      u.appendChild(el('div', null, g.reason || 'No reason given.'));
      u.appendChild(el('div', 'tbd-dim', 'No graph is shown without linked evidence. You may inspect a frozen Namespace separately (unassociated).'));
      ui.stage.appendChild(u); return;
    }
    var nodes = g.nodes || [], edges = g.edges || [];
    if (!nodes.length) { ui.stage.appendChild(el('div', 'tbd-empty', 'No objects in this image.')); return; }
    var L = state.layout = layoutGraph(nodes, null, state.layoutMode);
    var s = svg('svg', { class: 'tbd-svg', role: 'img', 'aria-label': nodes.length + ' objects, ' + edges.length + ' GT links' });
    var defs = svg('defs', {});
    [['tbdArrow', 'tbd-arrow'], ['tbdArrowBad', 'tbd-arrow-bad']].forEach(function (m) {
      var mk = svg('marker', { id: m[0], viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: m[1] })); defs.appendChild(mk);
    });
    s.appendChild(defs);
    var root = ui.gRoot = svg('g', {});
    var eg = svg('g', { class: 'tbd-edges' }), ng = svg('g', { class: 'tbd-nodes' });
    var unresolvedCount = {};
    edges.forEach(function (e) {
      if (e.kind === 'NULL') return;
      var a = L.pos[e.source]; if (!a) return;
      var b = e.target != null ? L.pos[e.target] : null;
      var x1 = a.x + a.w / 2, y1 = a.y + a.h, d, cls = 'tbd-edge';
      if (!b) {
        var k = unresolvedCount[e.source] = (unresolvedCount[e.source] || 0) + 1;
        var tx = a.x + a.w + 14 + k * 10, ty = a.y + a.h + 26 + k * 6;
        d = 'M' + (a.x + a.w) + ' ' + (a.y + a.h / 2) + ' Q' + (tx) + ' ' + (a.y + a.h / 2) + ' ' + tx + ' ' + ty;
        cls += ' tbd-edge-bad';
      } else if (b === a) {
        d = 'M' + (a.x + a.w - 30) + ' ' + a.y + ' C' + (a.x + a.w - 10) + ' ' + (a.y - 40) + ' ' + (a.x + a.w + 30) + ' ' + (a.y - 10) + ' ' + (a.x + a.w) + ' ' + (a.y + 14);
      } else {
        var x2 = b.x + b.w / 2, y2 = b.y; if (b.y + b.h < a.y) { y1 = a.y; y2 = b.y + b.h; }
        else if (Math.abs(b.y - a.y) < 1) { y1 = a.y + a.h / 2; y2 = b.y + b.h / 2; x1 = b.x > a.x ? a.x + a.w : a.x; x2 = b.x > a.x ? b.x : b.x + b.w; }
        var my = (y1 + y2) / 2, bend = Math.abs(b.y - a.y) < 1 ? -50 : 0;
        d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (my + bend) + ' ' + x2 + ' ' + (my + bend) + ' ' + x2 + ' ' + y2;
      }
      if (e.status && e.status !== 'resolved' && b) cls += ' tbd-edge-warn';
      var p = svg('path', { d: d, class: cls, 'marker-end': b ? 'url(#tbdArrow)' : 'url(#tbdArrowBad)' });
      p.dataset.src = e.source; p.dataset.tgt = e.target == null ? '' : e.target;
      var tt = svg('title', {}); tt.textContent = (e.register || '') + ' ' + hex32(e.raw) + ' → ' + (e.target == null ? 'UNRESOLVED' : e.target);
      p.appendChild(tt); eg.appendChild(p);
    });
    L.order.forEach(function (n) {
      var p = L.pos[n.id];
      var grp = svg('g', { class: 'tbd-node tbd-av-' + String(n.availability || 'unknown').replace(/[^a-z0-9-]/gi, ''), transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: '0', role: 'button' });
      grp.setAttribute('aria-label', 'Object ' + (n.name || n.id) + ' slot ' + n.slot);
      grp.appendChild(svg('rect', { width: p.w, height: p.h, rx: 6 }));
      var t1 = svg('text', { x: 10, y: 22, class: 'tbd-n-name' }); t1.textContent = String(n.name || n.id).slice(0, 22); grp.appendChild(t1);
      var t2 = svg('text', { x: 10, y: 40, class: 'tbd-n-sub' }); t2.textContent = 'slot ' + n.slot + ' · ' + (n.kind || '?'); grp.appendChild(t2);
      var t3 = svg('text', { x: 10, y: 55, class: 'tbd-n-sub' }); t3.textContent = (n.sizeWords != null ? n.sizeWords + 'w · ' : '') + String(n.binaryHash || '').slice(0, 12); grp.appendChild(t3);
      var tt = svg('title', {}); tt.textContent = n.id; grp.appendChild(tt);
      function pick() { selectNode(n.id); }
      grp.addEventListener('click', pick);
      grp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      ng.appendChild(grp);
    });
    root.appendChild(eg); root.appendChild(ng); s.appendChild(root);
    ui.stage.appendChild(s);
    ui.detail.textContent = '';
    ui.detail.appendChild(el('p', 'tbd-dim', 'Select an object to see its descriptor and every GT, including unresolved ones.'));
    if (state.selectedNode) selectNode(state.selectedNode);
    requestAnimationFrame(fit);
  }

  function selectNode(id) {
    state.selectedNode = id;
    Array.prototype.forEach.call(ui.stage.querySelectorAll('.tbd-node'), function (g) {
      g.classList.toggle('is-sel', g.querySelector('title').textContent === id);
    });
    Array.prototype.forEach.call(ui.stage.querySelectorAll('.tbd-edge'), function (p) {
      p.classList.toggle('is-hot', p.dataset.src === id || p.dataset.tgt === id);
    });
    renderDetail();
  }

  function gtTable(title, list) {
    var wrap = el('div', 'tbd-gts');
    wrap.appendChild(el('div', 'tbd-sub', title + ' (' + list.length + ')'));
    if (!list.length) { wrap.appendChild(el('div', 'tbd-dim', 'none')); return wrap; }
    var tbl = el('table', 'tbd-table');
    var hr = el('tr');
    ['#', 'Reg', 'Raw', 'Kind', 'Perms', 'Source', 'Target', 'Status'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    var th = el('thead'); th.appendChild(hr); tbl.appendChild(th);
    var tb = el('tbody');
    list.forEach(function (e) {
      var tr = el('tr', e.kind !== 'NULL' && e.target == null ? 'is-bad' : '');
      var target = e.kind === 'NULL' ? 'No capability' : e.target == null ? 'UNRESOLVED' + (e.targetSlot != null ? ' (slot ' + e.targetSlot + ')' : '') : e.target;
      [e.sequence, e.register, hex32(e.raw), e.kind, e.permissions, e.source, target, e.status].forEach(function (v) {
        tr.appendChild(el('td', null, v == null ? '—' : v));
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  function renderDetail() {
    var g = state.graph; if (!g || !state.selectedNode) return;
    var n = (g.nodes || []).filter(function (x) { return x.id === state.selectedNode; })[0]; if (!n) return;
    var d = ui.detail; d.textContent = '';
    d.appendChild(el('h3', null, n.name || n.id));
    kv(d, 'Id', n.id, true); kv(d, 'Slot', n.slot); kv(d, 'Kind', n.kind); kv(d, 'Location', n.location);
    kv(d, 'Size (words)', n.sizeWords); kv(d, 'Inspected binary hash', n.binaryHash, true);
    kv(d, 'Selected artifact hash', n.artifactHash, true); kv(d, 'Availability', n.availability);
    kv(d, 'Raw descriptor', Array.isArray(n.rawDescriptor) ? n.rawDescriptor.map(hex32).join(' ') : (n.rawDescriptor == null ? null : hex32(n.rawDescriptor)), true);
    var regs = n.initialDataRegisters || [];
    kv(d, 'Initial data registers', regs.length ? regs.map(function (r) { return typeof r === 'number' ? hex32(r) : JSON.stringify(r); }).join(' ') : 'none', true);
    var f = filterDetail(n, g.edges, ui.search.value);
    d.appendChild(gtTable('Outgoing GTs', f.outgoing));
    d.appendChild(gtTable('Incoming GTs', f.incoming));
  }

  function init() {
    var mount = doc.getElementById('testingBuildDna');
    if (!mount) { mount = el('div'); mount.id = 'testingBuildDna'; var bar = doc.querySelector('.ctlbar'); bar ? bar.parentNode.insertBefore(mount, bar) : doc.body.prepend(mount); }
    build(mount);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
