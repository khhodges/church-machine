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
  function viewportLayout(nodes, mode, width, height) {
    var best, score = -1;
    for (var cols = 1; cols <= Math.max(1, nodes.length); cols++) {
      var candidate = layoutGraph(nodes, cols, mode);
      // Use occupied bounds, not empty columns in partially filled tiers.
      candidate.width = Math.max(190, ...Object.values(candidate.pos).map(function (p) { return p.x + p.w; }));
      var fitScale = Math.min(Math.max(1, width - 48) / (candidate.width + 60),
        Math.max(1, height - 48) / (candidate.height + 70));
      if (fitScale > score) { score = fitScale; best = candidate; }
    }
    return best;
  }
  // NS[1] is the enclosing Namespace: Slot[0] and Slot[1] become header lines,
  // all other slots are laid out inside. Absent slots are reported, never invented.
  var HDR_PAD = 24, HDR_LINE = 20, HDR_TOP = 30;
  function containerLayout(nodes, mode, width, height) {
    nodes = nodes || [];
    var encl = nodes.filter(function (n) { return n.slot === 1; })[0];
    if (!encl) return null;
    var headerSlots = [0, 1].map(function (slot) {
      return { slot: slot, node: nodes.filter(function (n) { return n.slot === slot; })[0] || null };
    });
    var inner = nodes.filter(function (n) { return n.slot !== 0 && n.slot !== 1; });
    var hh = HDR_TOP + 3 * HDR_LINE + 36;
    var aw = Math.max(1, (width || 800) - 48), ah = Math.max(1, (height || 600) - 48);
    var L = inner.length ? viewportLayout(inner, mode, aw, Math.max(1, ah - hh)) : { pos: {}, order: [], width: 0, height: 0 };
    var cw = Math.max(380, L.width + 2 * HDR_PAD), ch = hh + L.height + 2 * HDR_PAD;
    var aspect = aw / ah;
    if (cw / ch < aspect) cw = ch * aspect; else ch = cw / aspect;
    var ox = (cw - L.width) / 2, oy = hh + (ch - hh - L.height) / 2;
    var pos = {};
    Object.keys(L.pos).forEach(function (id) {
      var p = L.pos[id]; pos[id] = { x: p.x + ox, y: p.y + oy, w: p.w, h: p.h };
    });
    headerSlots.forEach(function (h, i) {
      h.box = { x: HDR_PAD, y: HDR_TOP + (i + 1) * HDR_LINE, w: cw - 2 * HDR_PAD, h: HDR_LINE - 2 };
      if (h.node) pos[h.node.id] = h.box;
    });
    return { pos: pos, order: L.order, header: headerSlots, enclosing: encl,
      meta: { x: HDR_PAD, y: HDR_TOP, w: cw - 2 * HDR_PAD, h: HDR_LINE - 2 },
      container: { x: 0, y: 0, w: cw, h: ch, headerHeight: hh }, width: cw, height: ch };
  }
  // One Unresolve box per unique retained dot.name; unnamed non-NULL refs share
  // one explicit "name unavailable" box. Names are never derived from slots.
  function unresolvedGroups(edges) {
    var map = {}, list = [];
    (edges || []).forEach(function (e) {
      if (e.kind === 'NULL' || e.target != null) return;
      var name = typeof e.unresolvedName === 'string' && e.unresolvedName ? e.unresolvedName : null;
      var id = name ? 'unresolve:' + name : 'unresolve:(unnamed)';
      if (!map[id]) { map[id] = { id: id, name: name, edges: [], reason: name ? null : (e.unresolvedNameReason || 'No dot.name available in frozen evidence.') }; list.push(map[id]); }
      map[id].edges.push(e);
    });
    list.sort(function (a, b) { return a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name); });
    return list;
  }
  function placeUnresolved(L, groups) {
    if (!L || !L.container || !groups.length) return L;
    var W = 190, H = 64, G = 24, C = L.container;
    var cols = Math.max(1, Math.floor((C.w - 2 * HDR_PAD + G) / (W + G)));
    var top = C.h - HDR_PAD + 28;
    L.unresolved = groups.map(function (g, i) {
      return { group: g, box: { x: HDR_PAD + (i % cols) * (W + G), y: top + Math.floor(i / cols) * (H + G), w: W, h: H } };
    });
    L.unresolvedTop = top - 16;
    C.h = top + Math.ceil(groups.length / cols) * (H + G) - G + HDR_PAD;
    L.height = C.h;
    return L;
  }
  // Name shown only if backend proved it (dotName / non-slot-derived name).
  function nodeLabel(n) {
    var ns = 'NS[' + (n && n.slot != null ? n.slot : '?') + ']';
    var name = n && typeof n.dotName === 'string' && n.dotName ? n.dotName :
      (n && typeof n.name === 'string' && n.name && !/^NS\[\d+\]$/.test(n.name) ? n.name : null);
    if (!name && n && n.slot === 1 && n.kind === 'Namespace') {
      return {ns: ns, name: 'Namespace.Boot', source: 'User-specified display label; not a retained image identity', reason: null};
    }
    return { ns: ns, name: name, source: n && n.nameSource || null,
      reason: (n && n.nameUnavailableReason) || 'No dot.name provable from frozen evidence.' };
  }
  function wrapName(name, width, max) {
    var parts = String(name).split(/(?<=\.)/), lines = [''];
    parts.forEach(function (p) {
      while (p.length) {
        var cur = lines[lines.length - 1];
        if (cur && cur.length + p.length > width) { lines.push(''); continue; }
        var take = p.slice(0, width - cur.length); lines[lines.length - 1] = cur + take; p = p.slice(take.length);
        if (p.length) lines.push('');
      }
    });
    if (lines.length > max) { lines = lines.slice(0, max); lines[max - 1] = lines[max - 1].slice(0, width - 1) + '…'; }
    return lines;
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
  // Identity metadata shown once, compactly inside NS[1]; full values in detail panel.
  function objectWordTotal(nodes) {
    var seen = new Set(), result = {total: 0, ram: 0, mmio: 0, missing: 0};
    (nodes || []).forEach(function (n) {
      if (!Number.isInteger(n.slot) || n.availability === 'not-in-image' || seen.has(n.slot)) return;
      seen.add(n.slot);
      if (!Number.isInteger(n.sizeWords) || n.sizeWords < 0) { result.missing++; return; }
      result.total += n.sizeWords;
      result[n.kind === 'Hardware' || n.availability === 'hardware-address' ? 'mmio' : 'ram'] += n.sizeWords;
    });
    return result;
  }
  function metaItems(kind, id, g, b) {
    g = g || {}; b = b || {};
    var items = [];
    if (kind === 'bitstream') {
      items.push({ k: 'Bitstream', v: (g.bitstream && g.bitstream.label) || id, mono: true });
      items.push({ k: 'SHA-256', v: b.sha256, mono: true, hash: true });
      items.push({ k: 'Namespace revision', v: g.namespaceRevisionId, mono: true, hash: true });
      items.push({ k: 'Evidence status', v: String(g.status || '').toUpperCase() });
    } else items.push({ k: 'Namespace revision', v: g.namespaceRevisionId || id, mono: true, hash: true });
    items.push({ k: 'Image hash', v: g.imageHash, mono: true, hash: true });
    items.push({ k: 'Image format', v: [g.imageKind, g.imageLayout].filter(Boolean).join(' · ') });
    items.push({ k: 'Installed', v: ((g.installed && g.installed.status) || 'unverified').toUpperCase() + (g.installed && g.installed.reason ? ' — ' + g.installed.reason : '') });
    return items;
  }
  function metaSummary(items, issues) {
    var abbr = { 'SHA-256': 'sha', 'Namespace revision': 'rev', 'Image hash': 'img', 'Evidence status': '', 'Image format': '', 'Installed': 'installed', 'Bitstream': '' };
    var parts = items.filter(function (i) { return i.v != null && i.v !== ''; }).map(function (i) {
      var v = String(i.v); if (i.hash && v.length > 12) v = v.slice(0, 12) + '…';
      if (i.k === 'Installed') v = v.split(' — ')[0];
      var a = abbr[i.k]; return a ? a + ' ' + v : v;
    });
    var n = (issues || []).length;
    return { text: parts.join(' · '), warnings: n ? n + ' warning' + (n > 1 ? 's' : '') : '' };
  }
  function clampZoom(z) { return Math.min(4, Math.max(0.15, z)); }
  function makeRequestGate() {
    var seq = 0;
    return { next: function () { return ++seq; }, isCurrent: function (t) { return t === seq; } };
  }
  var pure = { nodeLabel: nodeLabel, wrapName: wrapName, hex32: hex32, buildUrl: buildUrl, layoutGraph: layoutGraph, viewportLayout: viewportLayout, containerLayout: containerLayout, metaItems: metaItems, metaSummary: metaSummary, unresolvedGroups: unresolvedGroups, placeUnresolved: placeUnresolved, filterDetail: filterDetail, clampZoom: clampZoom, makeRequestGate: makeRequestGate };
  pure.objectWordTotal = objectWordTotal;
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
    return fetch(url, { method: 'GET', credentials: 'include', headers: headers })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; })
          .then(function (j) {
            if (!r.ok && j && j.ok !== false) j.ok = false;
            if (r.status === 401 || r.status === 403) j.error = j.error || 'Open build inspection from this IDE, then Retry.';
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

    var controls = ui.controls = el('div', 'tbd-controls');
    var l1 = el('label', 'tbd-field');
    l1.appendChild(el('span', 'tbd-lbl', 'Bitstream'));
    ui.bsSel = el('select'); ui.bsSel.id = 'tbdBitstream';
    l1.appendChild(ui.bsSel);
    controls.appendChild(l1);
    ui.viewBtn = el('button', 'tbd-btn', 'DNA');
    ui.viewBtn.setAttribute('aria-label', 'Open Bitstream DNA');
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
    ui.nsBtn = el('button', 'tbd-btn tbd-btn-warn', 'DNA');
    ui.nsBtn.setAttribute('aria-label', 'Open Namespace DNA');
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
      if (state.catalog) renderSelected(); else showRememberedSelection();
    });
    ui.clearBtn.addEventListener('click', function () { ui.bsSel.value = ''; ui.bsSel.dispatchEvent(new Event('change')); });
    ui.nsSel.addEventListener('change', function () { ui.nsBtn.disabled = !ui.nsSel.value; });
    ui.viewBtn.addEventListener('click', function () { if (ui.bsSel.value) loadGraph('bitstream', ui.bsSel.value); });
    ui.nsBtn.addEventListener('click', function () { if (ui.nsSel.value) loadGraph('namespace', ui.nsSel.value); });
    loadCatalog();
  }

  function setStatus(text, kind) { ui.status.textContent = text || ''; ui.status.className = 'tbd-status' + (kind ? ' tbd-status-' + kind : ''); }

  // A remembered choice is not authenticated catalog or installed-board evidence.
  function showRememberedSelection() {
    var saved = '';
    try { saved = localStorage.getItem(STORE) || ''; } catch (_) {}
    ui.bsSel.textContent = '';
    var option = el('option', null, saved ? saved + ' — remembered, unverified' : '— none selected —');
    option.value = saved;
    ui.bsSel.appendChild(option);
    ui.bsSel.value = saved;
    ui.bsSel.disabled = true;
    ui.viewBtn.disabled = true;
    ui.nsSel.disabled = true;
    ui.nsBtn.disabled = true;
    ui.headState.textContent = saved ? 'Remembered · installed unverified' : 'No bitstream selected';
    ui.headState.className = 'tbd-pill tbd-pill-dim';
  }

  function skeleton(target) {
    target.textContent = '';
    var s = el('div', 'tbd-skel'); s.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 4; i++) s.appendChild(el('div', 'tbd-skel-line'));
    target.appendChild(s);
  }

  function loadCatalog() {
    var t = gate.next();
    state.catalog = null;
    showRememberedSelection();
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
      box.appendChild(el('p', 'tbd-note', 'Any remembered selection has not been erased. The catalog must load to verify it; this is not evidence of the bitstream installed on the FPGA.'));
      var retry = el('button', 'tbd-btn', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', loadCatalog);
      box.appendChild(retry);
      ui.body.appendChild(box);
      setStatus('Catalog request failed.', 'bad');
    });
  }

  function fillSelects() {
    var c = state.catalog;
    ui.bsSel.disabled = false;
    ui.nsSel.disabled = false;
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
  var viewers = {}, workspace, panes, controlsHome;
  function openWorkspace() {
    if (!workspace) {
      var hostDoc = dialogHost();
      if (hostDoc !== doc && !hostDoc.querySelector('link[data-build-dna-style]')) {
        var style = hostDoc.createElement('link');
        style.rel = 'stylesheet';
        style.href = new URL('/simulator/testing-build-dna.css', root.location.href).href;
        style.setAttribute('data-build-dna-style', '');
        hostDoc.head.appendChild(style);
      }
      workspace = el('dialog', 'tbd-workspace');
      workspace.setAttribute('aria-label', 'Build DNA comparison');
      var closeAll = el('button', 'tbd-btn tbd-close-all', 'Close all DNA');
      closeAll.type = 'button'; closeAll.addEventListener('click', function () { workspace.close(); });
      workspace.appendChild(closeAll);
      panes = el('div', 'tbd-panes'); workspace.appendChild(panes);
      hostDoc.body.appendChild(workspace);
      workspace.addEventListener('keydown', function (event) { event.stopPropagation(); });
      workspace.addEventListener('close', function () {
        Object.keys(viewers).forEach(function (key) { viewers[key].close(); });
        if (controlsHome) controlsHome.replaceWith(ui.controls);
        if (ui.workspaceFocus && ui.workspaceFocus.isConnected) ui.workspaceFocus.focus();
      });
      root.addEventListener('pagehide', function () { workspace.remove(); });
    }
    if (!workspace.open) {
      ui.workspaceFocus = doc.activeElement;
      controlsHome = doc.createComment('DNA selection controls');
      ui.controls.replaceWith(controlsHome);
      workspace.insertBefore(ui.controls, panes);
      workspace.showModal();
    }
  }
  function loadGraph(kind, id) {
    openWorkspace();
    if (!viewers[kind]) viewers[kind] = createViewer(kind);
    viewers[kind].load(kind, id);
  }
  function createViewer(viewerKind) {
  var ui = {}, state = { graph: null, selectedNode: null, layoutMode: 'default' };
  var gate = makeRequestGate(), view = { z: 1, x: 0, y: 0 }, resizeObserver;
  function closeViewer() {
    gate.next();
    ui.dlg.open = false; ui.dlg.remove();
    if (resizeObserver) resizeObserver.disconnect();
    delete viewers[viewerKind];
    panes.classList.toggle('tbd-pair', panes.children.length === 2);
    if (!panes.children.length && workspace.open) workspace.close();
  }
  function buildDialog() {
    var d = el('section', 'tbd-dialog'); d.setAttribute('aria-labelledby', 'tbdDlgTitle-' + viewerKind);
    d.dataset.viewer = viewerKind;
    var top = el('div', 'tbd-dlg-head');
    var t = el('h2', null, viewerKind === 'bitstream' ? 'Bitstream — Build DNA' : 'Namespace — Build DNA');
    t.id = 'tbdDlgTitle-' + viewerKind;
    var heading = el('div', 'tbd-dlg-heading');
    heading.appendChild(t);
    ui.layoutSel = el('select', 'tbd-layout'); ui.layoutSel.id = 'tbdLayout-' + viewerKind;
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
    close.addEventListener('click', closeViewer);
    tools.appendChild(close);
    top.appendChild(tools);
    d.appendChild(top);
    ui.dlgMeta = el('div', 'tbd-meta'); d.appendChild(ui.dlgMeta);
    var main = ui.main = el('div', 'tbd-dlg-main');
    ui.stage = el('div', 'tbd-stage'); ui.stage.tabIndex = 0;
    ui.stage.setAttribute('aria-label', 'GT object graph. Drag to pan, wheel to zoom.');
    main.appendChild(ui.stage);
    var side = ui.side = el('aside', 'tbd-detail');
    side.hidden = true;
    var hideDetail = el('button', 'tbd-btn', 'Close details'); hideDetail.type = 'button';
    hideDetail.addEventListener('click', function () {
      state.selectedNode = null;
      side.hidden = true; main.classList.remove('has-selection');
      renderGraph(state.mode, state.graphId);
    });
    side.appendChild(hideDetail);
    ui.search = el('input'); ui.search.type = 'search'; ui.search.placeholder = 'Search GTs (raw, register, target, status)…';
    ui.search.setAttribute('aria-label', 'Search object GTs');
    ui.search.addEventListener('input', renderDetail);
    side.appendChild(ui.search);
    ui.detail = el('div', 'tbd-detail-body'); side.appendChild(ui.detail);
    main.appendChild(side);
    d.appendChild(main);
    panes.appendChild(d);
    panes.classList.toggle('tbd-pair', panes.children.length === 2);
    ui.dlg = d;
    d.addEventListener('keydown', function (event) { event.stopPropagation(); });
    if (root.ResizeObserver) {
      resizeObserver = new root.ResizeObserver(function () {
      if (d.open && state.graph) renderGraph(state.mode, state.graphId);
      });
      resizeObserver.observe(ui.stage);
    }

    var drag = null;
    ui.stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest && e.target.closest('.tbd-node, .tbd-word-total')) return;
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
    if (!state.layout || !ui.gRoot || !ui.gRoot.isConnected) return;
    var r = ui.stage.getBoundingClientRect(), bounds = ui.gRoot.getBBox(), pad = 24;
    if (!bounds.width || !bounds.height || !r.width || !r.height) return;
    // Include actual curved links and unresolved stubs, with a small screen-space margin.
    view.z = Math.min(Math.max(1, r.width - pad * 2) / bounds.width,
      Math.max(1, r.height - pad * 2) / bounds.height);
    view.x = (r.width - bounds.width * view.z) / 2 - bounds.x * view.z;
    view.y = (r.height - bounds.height * view.z) / 2 - bounds.y * view.z;
    applyView();
  }

  function openDialog() {
    ui.dlg.open = true;
    ui.dlg.setAttribute('open', '');
  }

  function loadGraph(kind, id) {
    var t = gate.next();
    state.mode = kind; state.graphId = id; state.graph = null; state.selectedNode = null; state.layout = null;
    ui.side.hidden = true; ui.main.classList.remove('has-selection');
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
    var mItems = state.metaItems = metaItems(kind, id, g, kind === 'bitstream' ? findBs(id) : null);
    mItems.forEach(function (i) { kv(meta, i.k, i.v, i.mono); });
    renderIssues(meta, g.issues);
    meta.hidden = false;
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
    meta.hidden = nodes.some(function (n) { return n.slot === 1; });
    var viewport = ui.stage.getBoundingClientRect();
    var L = state.layout = containerLayout(nodes, state.layoutMode, viewport.width, viewport.height) ||
      viewportLayout(nodes, state.layoutMode, viewport.width, viewport.height);
    placeUnresolved(L, unresolvedGroups(edges));
    var uPos = {};
    (L.unresolved || []).forEach(function (u) { u.group.edges.forEach(function (e) { uPos[e.id] = u.box; }); });
    var s = svg('svg', { class: 'tbd-svg', role: 'img', 'aria-label': nodes.length + ' objects, ' + edges.length + ' GT links' });
    var defs = svg('defs', {});
    [['tbdArrow', 'tbd-arrow'], ['tbdArrowBad', 'tbd-arrow-bad']].forEach(function (m) {
      var mk = svg('marker', { id: m[0] + '-' + viewerKind, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      mk.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: m[1] })); defs.appendChild(mk);
    });
    s.appendChild(defs);
    var root = ui.gRoot = svg('g', {});
    var eg = svg('g', { class: 'tbd-edges' }), ng = svg('g', { class: 'tbd-nodes' });
    var unresolvedCount = {};
    if (L.container) {
      var C = L.container, cg = svg('g', { class: 'tbd-encl' });
      cg.appendChild(svg('rect', { x: C.x, y: C.y, width: C.w, height: C.h, rx: 10, class: 'tbd-encl-box' }));
      cg.appendChild(svg('line', { x1: C.x, x2: C.x + C.w, y1: C.headerHeight, y2: C.headerHeight, class: 'tbd-encl-rule' }));
      var et = svg('text', { x: HDR_PAD, y: 20, class: 'tbd-encl-title' });
      et.textContent = 'Enclosing Namespace NS[1] · ' + (nodeLabel(L.enclosing).name || 'dot.name unavailable');
      cg.appendChild(et);
      var total = objectWordTotal(nodes);
      var revision = g.namespaceRevisionId || (kind === 'namespace' ? id : null);
      if (revision) {
        var link = svg('a', {href: '/simulator/#development-image?namespace=' + encodeURIComponent(revision),
          target: '_top', class: 'tbd-word-total', 'aria-label': 'Open Memory Glass: ' + total.total + ' object words'});
        var label = total.total.toLocaleString() + ' words' + (total.missing ? ' (partial)' : '') + ' · Memory Glass';
        var width = 240;
        link.appendChild(svg('rect', {x: HDR_PAD, y: C.headerHeight-28, width: width, height: 22, rx: 4, fill: '#1b3444', stroke: '#66c8bf'}));
        var text = svg('text', {x: HDR_PAD+8, y: C.headerHeight-13, fill: '#b6f2e9', 'font-size': 12});
        text.textContent = label;
        link.appendChild(text);
        var tip = svg('title', {});
        tip.textContent = total.ram + ' RAM words + ' + total.mmio + ' MMIO words; ' + total.missing + ' unknown sizes. Each occupied slot counted once.';
        link.appendChild(tip);
        cg.appendChild(link);
      }
      root.appendChild(cg);
      meta.hidden = true;
      var ms = metaSummary(mItems, g.issues), M = L.meta;
      var mg = svg('g', { class: 'tbd-node tbd-hdr tbd-hdr-meta', transform: 'translate(' + M.x + ' ' + M.y + ')', tabindex: '0', role: 'button' });
      mg.setAttribute('aria-label', 'Image identity: ' + mItems.map(function (i) { return i.k + ' ' + (i.v || '—'); }).join('; ') + (ms.warnings ? '; ' + ms.warnings : '') + '. Activate for full values.');
      mg.appendChild(svg('rect', { width: M.w, height: M.h, rx: 3 }));
      var mt = svg('text', { x: 6, y: 13, class: 'tbd-hdr-text tbd-hdr-id' });
      var mt1 = svg('tspan', {}); mt1.textContent = ms.text; mt.appendChild(mt1);
      if (ms.warnings) { var mw = svg('tspan', { class: 'tbd-hdr-warn' }); mw.textContent = ' · ' + ms.warnings; mt.appendChild(mw); }
      var md = svg('tspan', { class: 'tbd-hdr-more' }); md.textContent = '  details ›'; mt.appendChild(md);
      mt.setAttribute('textLength', M.w - 12);
      mt.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      mg.appendChild(mt);
      var mtt = svg('title', {}); mtt.textContent = '__meta'; mg.appendChild(mtt);
      mg.addEventListener('click', function () { selectNode('__meta'); });
      mg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode('__meta'); } });
      ng.appendChild(mg);
      L.header.forEach(function (h) {
        var b = h.box, n = h.node;
        var hg = svg('g', { class: n ? 'tbd-node tbd-hdr' : 'tbd-hdr tbd-hdr-missing', transform: 'translate(' + b.x + ' ' + b.y + ')' });
        hg.dataset.slot = h.slot;
        hg.appendChild(svg('rect', { width: b.w, height: b.h, rx: 3 }));
        var tx = svg('text', { x: 6, y: 13, class: 'tbd-hdr-text' });
        tx.textContent = (h.slot === 0 ? 'Slot[0] raw metadata · ' : 'Slot[1] info · ') + (n ? (h.slot === 0 ? (nodeLabel(n).name ? nodeLabel(n).name + ' · ' : '') : '') + (n.kind || '?') +
          (n.sizeWords != null ? ' · ' + n.sizeWords + 'w' : '') + (n.binaryHash ? ' · ' + String(n.binaryHash).slice(0, 12) : '')
          : h.slot === 0 && Array.isArray(g.metadataWords)
            ? g.metadataWords.map(hex32).join(' · ')
            : '— no slot evidence in this image');
        hg.appendChild(tx);
        if (n) {
          hg.setAttribute('tabindex', '0'); hg.setAttribute('role', 'button');
          hg.setAttribute('aria-label', 'Header Metadata Slot ' + h.slot + ' object ' + (n.name || n.id));
          var ht = svg('title', {}); ht.textContent = n.id; hg.appendChild(ht);
          hg.addEventListener('click', function () { selectNode(n.id); });
          hg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(n.id); } });
        }
        ng.appendChild(hg);
      });
    }
    edges.forEach(function (e) {
      if (e.kind === 'NULL') return;
      var a = L.pos[e.source]; if (!a) return;
      var b = e.target != null ? L.pos[e.target] : null;
      var x1 = a.x + a.w / 2, y1 = a.y + a.h, d, cls = 'tbd-edge';
      var ub = !b && uPos[e.id];
      if (ub) {
        var ux = ub.x + ub.w / 2, uy = ub.y, umy = (y1 + uy) / 2;
        d = 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + umy + ' ' + ux + ' ' + umy + ' ' + ux + ' ' + uy;
        cls += ' tbd-edge-bad';
      } else if (!b) {
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
      var p = svg('path', { d: d, class: cls, 'marker-end': 'url(#' + (b ? 'tbdArrow' : 'tbdArrowBad') + '-' + viewerKind + ')' });
      p.dataset.src = e.source; p.dataset.tgt = e.target == null ? (ub ? 'unresolve-box' : '') : e.target;
      var tt = svg('title', {}); tt.textContent = (e.register || '') + ' ' + hex32(e.raw) + ' → ' + (e.target == null ? 'UNRESOLVED' : e.target);
      p.appendChild(tt); eg.appendChild(p);
    });
    L.order.forEach(function (n) {
      var p = L.pos[n.id];
      var grp = svg('g', { class: 'tbd-node tbd-av-' + String(n.availability || 'unknown').replace(/[^a-z0-9-]/gi, ''), transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: '0', role: 'button' });
      grp.setAttribute('aria-label', 'Object ' + (n.name || n.id) + ' slot ' + n.slot);
      grp.appendChild(svg('rect', { width: p.w, height: p.h, rx: 6 }));
      var lb = nodeLabel(n), lines = wrapName(lb.name || 'name unavailable', 24, 2);
      var t0 = svg('text', { x: 10, y: 15, class: 'tbd-n-slot' }); t0.textContent = lb.ns + ' · ' + (n.kind || '?'); grp.appendChild(t0);
      lines.forEach(function (ln, li) {
        var t1 = svg('text', { x: 10, y: 30 + li * 13, class: lb.name ? 'tbd-n-name' : 'tbd-n-noname' }); t1.textContent = ln; grp.appendChild(t1);
      });
      var t3 = svg('text', { x: 10, y: 58, class: 'tbd-n-sub' }); t3.textContent = (n.sizeWords != null ? n.sizeWords + 'w · ' : '') + String(n.binaryHash || '').slice(0, 12); grp.appendChild(t3);
      var tt = svg('title', {}); tt.textContent = lb.ns + ' ' + (lb.name || 'dot.name unavailable — ' + lb.reason) + (lb.source ? '\nName evidence: ' + lb.source : ''); grp.appendChild(tt);
      function pick() { selectNode(n.id); }
      grp.addEventListener('click', pick);
      grp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      ng.appendChild(grp);
    });
    if (L.unresolved && L.unresolved.length) {
      var ul = svg('text', { x: HDR_PAD, y: L.unresolvedTop, class: 'tbd-unres-title' });
      ul.textContent = 'Unresolve · not allocated slots';
      ng.appendChild(ul);
      L.unresolved.forEach(function (u) {
        var b = u.box, gp = u.group;
        var ugrp = svg('g', { class: 'tbd-unres', transform: 'translate(' + b.x + ' ' + b.y + ')' });
        ugrp.appendChild(svg('rect', { width: b.w, height: b.h, rx: 6 }));
        var a1 = svg('text', { x: 10, y: 18, class: 'tbd-unres-kicker' }); a1.textContent = 'Unresolve'; ugrp.appendChild(a1);
        var a2 = svg('text', { x: 10, y: 36, class: gp.name ? 'tbd-n-name' : 'tbd-unres-none' });
        a2.textContent = gp.name ? wrapName(gp.name, 26, 1)[0] : 'dot.name unavailable'; ugrp.appendChild(a2);
        var a3 = svg('text', { x: 10, y: 54, class: 'tbd-n-sub' }); a3.textContent = gp.edges.length + ' incoming GT' + (gp.edges.length === 1 ? '' : 's'); ugrp.appendChild(a3);
        var ut = svg('title', {});
        ut.textContent = 'Unresolve: ' + (gp.name || 'dot.name unavailable — ' + gp.reason) + '\n' +
          gp.edges.map(function (e) { return e.source + ' ' + e.register + ' ' + hex32(e.raw) + ' ' + e.status; }).join('\n');
        ugrp.appendChild(ut); ng.appendChild(ugrp);
      });
    }
    root.appendChild(eg); root.appendChild(ng); s.appendChild(root);
    ui.stage.dataset.enclosing = L.container ? L.enclosing.id : '';
    ui.stage.appendChild(s);
    ui.detail.textContent = '';
    ui.detail.appendChild(el('p', 'tbd-dim', 'Select an object to see its descriptor and every GT, including unresolved ones.'));
    if (state.selectedNode) selectNode(state.selectedNode);
    requestAnimationFrame(fit);
  }

  function selectNode(id) {
    state.selectedNode = id;
    ui.side.hidden = false; ui.main.classList.add('has-selection');
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
    if (state.selectedNode === '__meta') {
      ui.detail.textContent = ''; ui.detail.appendChild(el('h3', null, 'Image identity'));
      (state.metaItems || []).forEach(function (i) { kv(ui.detail, i.k, i.v, i.mono); });
      renderIssues(ui.detail, g.issues); return;
    }
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

  buildDialog();
  return { load: loadGraph, close: closeViewer };
  }

  function init() {
    var mount = doc.getElementById('testingBuildDna');
    if (!mount) { mount = el('div'); mount.id = 'testingBuildDna'; var bar = doc.querySelector('.ctlbar'); bar ? bar.parentNode.insertBefore(mount, bar) : doc.body.prepend(mount); }
    build(mount);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
