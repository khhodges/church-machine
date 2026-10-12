/* namespace-designs-ui.js — multi-Namespace LUMP design collection (drafts only).
 * Talks only to GET/PUT /api/namespace-designs. Never writes sim, bootConfig,
 * ns-state or artifacts. Saved entries are design specifications, NOT compiled,
 * approved or installed LUMPs. Server is authoritative for validation and CAS. */
(function (root) {
    'use strict';

    var MIN_SIZE = 8192, MAX_SIZE = 131072, MIN_SLOTS = 3, MAX_SLOTS = 8191;
    var BOOT_NAME = 'Boot.Namespace';
    var SIZES = [8192, 16384, 32768, 65536, 131072];

    function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
    function log2(n) { var k = 0; while (n > 1) { n = n / 2; k++; } return k; }
    function maxSlotsFor(size) { return Math.min(MAX_SLOTS, Math.floor((size - 16) / 4)); }

    /* Client-side preview validation. Server remains the authority. */
    function validateDesigns(designs) {
        var errs = [], seen = {};
        if (!Array.isArray(designs)) return ['designs must be a list'];
        designs.forEach(function (d, i) {
            var tag = 'Design ' + (i + 1) + (d && d.name ? ' (' + d.name + ')' : '');
            var name = d && typeof d.name === 'string' ? d.name.trim() : '';
            if (!name) errs.push(tag + ': name is required');
            else if (seen[name]) errs.push(tag + ': duplicate design name');
            seen[name] = true;
            if (i === 0 && name !== BOOT_NAME) errs.push('The first design must be named ' + BOOT_NAME);
            if (i > 0 && name === BOOT_NAME) errs.push(tag + ': only the first design may be ' + BOOT_NAME);
            var s = d.sizeWords, c = d.slotCount;
            if (!Number.isInteger(s) || !isPow2(s) || s < MIN_SIZE || s > MAX_SIZE)
                errs.push(tag + ': sizeWords must be a power of two from 8192 to 131072');
            if (!Number.isInteger(c) || c < MIN_SLOTS || c > MAX_SLOTS)
                errs.push(tag + ': slotCount must be an integer 3..8191');
            else if (Number.isInteger(s) && 16 + 4 * c > s)
                errs.push(tag + ': 16 + 4 x slotCount must not exceed sizeWords');
            var m = Array.isArray(d.members) ? d.members : null;
            if (!m) errs.push(tag + ': members must be a list');
            else {
                var ms = {};
                m.forEach(function (x, j) {
                    if (typeof x !== 'string' || !x.trim()) errs.push(tag + ': member ' + (j + 1) + ' is empty');
                    else if (ms[x]) errs.push(tag + ': duplicate member "' + x + '"');
                    ms[x] = true;
                });
                if (Number.isInteger(c) && m.length > c - 2)
                    errs.push(tag + ': at most slotCount - 2 (' + Math.max(0, c - 2) + ') members');
            }
        });
        return errs;
    }

    /* Sequential layout preview in words, base 0 for Boot.Namespace. */
    function deriveGeometry(designs) {
        var base = 0;
        return designs.map(function (d) {
            var size = d.sizeWords, slots = d.slotCount;
            var g = {
                name: d.name, baseWord: base, sizeWords: size, limit: size - 1,
                endWord: base + size - 1,
                metadataWord: base + size - 4,
                tableStartWord: base + size - 4 * slots,
                slotCount: slots,
                nField: log2(size) - 13, typ: 1, cc: 0, cw: slots
            };
            base += size;
            return g;
        });
    }

    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { validateDesigns: validateDesigns, deriveGeometry: deriveGeometry,
            maxSlotsFor: maxSlotsFor, BOOT_NAME: BOOT_NAME, SIZES: SIZES };
    }
    if (typeof document === 'undefined') return;

    // ── Browser UI ───────────────────────────────────────────────────────────
    var st = {
        loaded: false, loading: false, saving: false,
        revision: null, saved: [], serverGeom: [], draft: [],
        selected: 0, error: '', status: '', newName: ''
    };
    var host = null;

    function dirty() { return JSON.stringify(st.draft) !== JSON.stringify(st.saved); }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
    }
    function btn(label, cls, fn, disabled) {
        var b = el('button', cls || 'le-next-btn', label);
        b.type = 'button'; b.onclick = fn; if (disabled) b.disabled = true;
        return b;
    }
    function row(label, valueNode) {
        var r = el('div', 'le-field-row');
        r.appendChild(el('label', 'le-label', label));
        var g = el('div', 'le-input-group le-input-group-wide');
        g.appendChild(valueNode); r.appendChild(g);
        return r;
    }
    function fmt(n) { return Number(n).toLocaleString(); }
    function hexW(n) { return '0x' + (n >>> 0).toString(16).toUpperCase(); }

    function load(force) {
        if (st.loading) return;
        if (!force && st.loaded) return;
        st.loading = true; st.error = ''; paint();
        fetch('/api/namespace-designs', { credentials: 'include' })
            .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
            .then(function (x) {
                if (!x.r.ok || !x.j || x.j.ok !== true) throw new Error((x.j && (x.j.error || x.j.message)) || ('HTTP ' + x.r.status));
                st.revision = x.j.revision;
                st.saved = (x.j.designs || []).map(function (d) {
                    return { name: d.name, sizeWords: d.sizeWords, slotCount: d.slotCount, members: (d.members || []).slice() };
                });
                st.serverGeom = x.j.geometries || [];
                st.draft = clone(st.saved);
                st.selected = Math.min(st.selected, Math.max(0, st.draft.length - 1));
                st.status = 'Loaded revision ' + st.revision;
            })
            .catch(function (e) { st.error = 'Load failed: ' + e.message; })
            .then(function () { st.loading = false; st.loaded = true; paint(); });
    }

    function save() {
        var errs = validateDesigns(st.draft);
        if (errs.length) { st.error = errs.join('\n'); paint(); return; }
        st.saving = true; st.error = ''; paint();
        fetch('/api/namespace-designs', {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ revision: st.revision, designs: st.draft })
        })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
            .then(function (x) {
                if (!x.r.ok || x.j.ok !== true) {
                    var msg = x.j.error || x.j.message || ('HTTP ' + x.r.status);
                    if (x.r.status === 409) msg += ' (revision conflict: another save happened; reload to see it — your edits stay until you reload)';
                    if (Array.isArray(x.j.errors)) msg += '\n' + x.j.errors.map(function (e) { return typeof e === 'string' ? e : JSON.stringify(e); }).join('\n');
                    throw new Error(msg);
                }
                if (x.j.revision) st.revision = x.j.revision;
                if (Array.isArray(x.j.designs)) st.draft = x.j.designs.map(function (d) {
                    return { name: d.name, sizeWords: d.sizeWords, slotCount: d.slotCount, members: (d.members || []).slice() };
                });
                st.saved = clone(st.draft);
                st.serverGeom = x.j.geometries || [];
                st.status = 'Design specifications saved (revision ' + st.revision + '). Nothing was compiled, approved or installed.';
            })
            .catch(function (e) { st.error = 'Save failed: ' + e.message; })
            .then(function () { st.saving = false; paint(); });
    }

    function guard(msg) { return !dirty() || window.confirm(msg || 'Discard unsaved Namespace design edits?'); }

    function addDesign() {
        var name = st.draft.length === 0 ? BOOT_NAME : st.newName.trim();
        if (!name) { st.error = 'Enter a name for the new design (e.g. System.Namespace).'; paint(); return; }
        if (st.draft.some(function (d) { return d.name === name; })) { st.error = 'A design named "' + name + '" already exists.'; paint(); return; }
        st.draft.push({ name: name, sizeWords: 16384, slotCount: 64, members: [] });
        st.selected = st.draft.length - 1; st.newName = ''; st.error = '';
        paint();
    }

    function removeDesign(i) {
        var d = st.draft[i];
        if (i === 0 && st.draft.length > 1) { st.error = BOOT_NAME + ' cannot be removed while other designs remain.'; paint(); return; }
        if (!window.confirm('Remove draft design "' + d.name + '"? This takes effect only when you Save.')) return;
        st.draft.splice(i, 1);
        st.selected = Math.max(0, Math.min(st.selected, st.draft.length - 1));
        paint();
    }

    function activeCR15() {
        var s = (typeof sim !== 'undefined' && sim) ? sim : root.sim; // eslint-disable-line no-undef
        try {
            if (s && s.cr && s.cr[15]) return { base: s.cr[15].word1 >>> 0, word0: s.cr[15].word0 >>> 0 };
        } catch (e) { /* read-only peek */ }
        return null;
    }

    function paint() {
        if (!host || !host.isConnected) return;
        // Preserve focus on member textarea / name input across repaint
        var focusId = document.activeElement && document.activeElement.id;
        host.textContent = '';
        var p = el('div', 'le-panel nsd-panel');

        p.appendChild(el('div', 'le-design-editor-caption', 'Namespace design collection (drafts)'));
        var b = el('p', 'le-panel-desc',
            'Named Namespace LUMP design specifications. Saving stores specifications only: these drafts are not compiled, ' +
            'approved, admitted or installed, are not executable, and do not change the boot configuration above. ' +
            'All addresses below are in words.');
        p.appendChild(b);

        var cr = activeCR15();
        p.appendChild(row('Active execution CR15 (simulator, read-only)',
            el('span', 'le-hex', cr ? ('base word ' + hexW(cr.base) + ' (' + fmt(cr.base) + ')  word0 ' + hexW(cr.word0)) : 'simulator not available')));

        var bar = el('div', 'le-save-row');
        bar.appendChild(btn(st.saving ? 'Saving...' : 'Save design specifications', 'le-save-btn', save, st.saving || st.loading || !dirty()));
        bar.appendChild(btn('Reload', 'le-next-btn', function () { if (guard('Reload and discard unsaved design edits?')) load(true); }, st.loading || st.saving));
        bar.appendChild(el('span', 'le-rl-status', st.loading ? 'Loading...' : (dirty() ? 'Unsaved edits' : (st.revision ? 'Revision ' + st.revision : ''))));
        p.appendChild(bar);

        if (st.error) { var er = el('div', 'le-warn-banner', st.error); er.style.whiteSpace = 'pre-wrap'; p.appendChild(er); }
        else if (st.status) p.appendChild(el('div', 'le-rl-status', st.status));

        // Design list
        var geom = deriveGeometry(st.draft);
        var list = el('div', 'nsd-list');
        if (!st.draft.length && st.loaded) list.appendChild(el('p', 'le-panel-desc', 'No Namespace designs yet. The first design is always ' + BOOT_NAME + ' at base word 0.'));
        st.draft.forEach(function (d, i) {
            var item = btn(d.name + '  -  ' + fmt(d.sizeWords) + ' w @ base ' + fmt(geom[i].baseWord),
                i === st.selected ? 'le-save-btn' : 'le-next-btn',
                function () { st.selected = i; st.error = ''; paint(); });
            item.style.margin = '0 0.4rem 0.4rem 0';
            list.appendChild(item);
        });
        p.appendChild(list);

        // Create
        var nameIn = el('input', 'le-select'); nameIn.id = 'nsd-new-name';
        if (st.draft.length === 0) { nameIn.value = BOOT_NAME; nameIn.disabled = true; }
        else { nameIn.value = st.newName; nameIn.placeholder = 'e.g. System.Namespace'; }
        nameIn.oninput = function () { st.newName = nameIn.value; };
        var cg = el('span'); cg.appendChild(nameIn);
        cg.appendChild(btn('Add design', 'le-next-btn', addDesign, !st.loaded || st.loading));
        p.appendChild(row('New design name', cg));

        var d = st.draft[st.selected];
        if (d) {
            var g = geom[st.selected];
            p.appendChild(el('div', 'le-divider'));
            p.appendChild(el('div', 'le-design-editor-caption', 'Selected design: ' + d.name));

            var sz = el('select', 'le-select'); sz.id = 'nsd-size';
            SIZES.forEach(function (s) { var o = el('option', null, fmt(s) + ' words (2^' + log2(s) + ')'); o.value = s; if (s === d.sizeWords) o.selected = true; sz.appendChild(o); });
            sz.onchange = function () { d.sizeWords = Number(sz.value); paint(); };
            p.appendChild(row('Size (words)', sz));

            var sl = el('input', 'le-select'); sl.id = 'nsd-slots'; sl.type = 'number';
            sl.min = MIN_SLOTS; sl.max = maxSlotsFor(d.sizeWords); sl.step = 1; sl.value = d.slotCount;
            sl.onchange = function () { d.slotCount = Number(sl.value); paint(); };
            p.appendChild(row('Slot count (3..' + maxSlotsFor(d.sizeWords) + ')', sl));

            var mem = el('textarea', 'le-select'); mem.id = 'nsd-members'; mem.rows = 6;
            mem.value = d.members.join('\n');
            mem.placeholder = 'One pet name per line, in slot order';
            mem.oninput = function () { d.members = mem.value.split('\n').map(function (x) { return x.trim(); }).filter(function (x) { return x; }); };
            mem.onblur = function () { paint(); };
            p.appendChild(row('Members (' + d.members.length + ' / max ' + Math.max(0, d.slotCount - 2) + ')', mem));

            var srv = st.serverGeom.filter(function (x) { return x.name === d.name; })[0];
            var sv = st.saved[st.selected];
            var srvMatch = srv && sv && sv.name === d.name && sv.sizeWords === d.sizeWords && sv.slotCount === d.slotCount;
            var rows = [
                ['Base word (derived, read-only)', fmt(g.baseWord) + '  (' + hexW(g.baseWord) + ')'],
                ['End word', fmt(g.endWord) + '  (' + hexW(g.endWord) + ')'],
                ['Limit', fmt(g.limit) + ' words'],
                ['Metadata slot (top, 4 words) start word', fmt(g.metadataWord) + '  (' + hexW(g.metadataWord) + ')'],
                ['Slot table start word (slots descend)', fmt(g.tableStartWord) + '  (' + hexW(g.tableStartWord) + ')'],
                ['Header fields', 'n-13 = ' + g.nField + ', typ = 01, cc = 0, cw = ' + g.cw],
                ['Header word (server)', srvMatch && srv.headerWord != null ? hexW(srv.headerWord) : 'shown after save'],
                ['Status', 'Draft specification - not executable, not admitted']
            ];
            var grid = el('div', 'le-grid');
            rows.forEach(function (r) {
                var rr = el('div', 'le-field-row le-field-readonly');
                rr.appendChild(el('span', 'le-label', r[0]));
                rr.appendChild(el('span', 'le-val-mono', r[1]));
                grid.appendChild(rr);
            });
            p.appendChild(grid);

            var problems = validateDesigns(st.draft);
            if (problems.length) { var pv = el('div', 'le-rl-status', 'Preview checks: ' + problems.join('; ')); pv.style.color = '#f77'; p.appendChild(pv); }

            var del = btn('Delete design', 'le-next-btn', function () { removeDesign(st.selected); },
                st.selected === 0 && st.draft.length > 1);
            if (st.selected === 0 && st.draft.length > 1) del.title = BOOT_NAME + ' cannot be removed while other designs remain';
            var dr = el('div', 'le-save-row'); dr.appendChild(del); p.appendChild(dr);
        }

        host.appendChild(p);
        if (focusId) { var f = document.getElementById(focusId); if (f) f.focus(); }
    }

    root.NamespaceDesignsUI = {
        /* Called on each parent render: re-attaches persistent state; fetches once. */
        mount: function (container) {
            if (!container) return;
            host = container;
            if (!st.loaded) load(false); else paint();
        },
        render: paint,
        reload: function () { if (guard()) load(true); },
        isDirty: dirty
    };
    root.addEventListener && root.addEventListener('beforeunload', function (e) {
        if (dirty()) { e.preventDefault(); e.returnValue = ''; }
    });
})(typeof window !== 'undefined' ? window : globalThis);
