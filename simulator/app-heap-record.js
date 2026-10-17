/* Thread heap call-record demonstration dialog. Plain DOM. */
window.getThreadHeapRecordContext = function () {
    if (!window.TargetState) throw new Error('Simulator target controls are unavailable.');
    const target = window.TargetState.authorize('simulator');
    if (!target.ok) throw new Error(target.error);
    if (typeof sim === 'undefined') throw new Error('Simulator is unavailable.');
    if (sim.running || sim.walkActive ||
            (typeof _simRunActive !== 'undefined' && _simRunActive) ||
            (typeof walkRunning !== 'undefined' && walkRunning) ||
            (typeof bootAnimating !== 'undefined' && bootAnimating))
        throw new Error('Pause Run, Walk, and Boot before accessing the heap record.');
    return sim;
};
(function () {
    'use strict';
    var MAX_FILE = 16384;
    var dlg = null, lastFocus = null, lastFocusId = null, bound = null, pending = null;

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') n.textContent = attrs[k];
            else if (k === 'cls') n.className = attrs[k];
            else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return n;
    }
    function api() {
        if (!window.ThreadHeapRecord) throw new Error('ThreadHeapRecord API is not loaded.');
        return window.ThreadHeapRecord;
    }
    function ctx() {
        if (typeof window.getThreadHeapRecordContext !== 'function') throw new Error('No Thread heap context provider is available.');
        return window.getThreadHeapRecordContext();
    }
    function words(cr) {
        if (!cr) return [null, null];
        if (Array.isArray(cr)) return [cr[0], cr[1]];
        return [cr.word0 !== undefined ? cr.word0 : cr.w0, cr.word1 !== undefined ? cr.word1 : cr.w1];
    }
    function crOf(sim, i) {
        var set = sim.cr;
        if (!set) throw new Error('Cannot read capability registers to identify the active Thread.');
        return set[i];
    }
    function identity(sim, offset) {
        return {
            cr12: words(crOf(sim, 12)).map(String).join(':'),
            cr5: words(crOf(sim, 5)).map(String).join(':'),
            mem: sim.memory,
            allocation: api().validateTarget(sim, offset).allocationId,
            pool: JSON.stringify(api().allocations(sim)),
            content: Array.from(sim.memory.slice(sim.cr[5].word1 + offset,
                sim.cr[5].word1 + offset + api().schema.words)).join(','),
            sim: sim, offset: offset
        };
    }
    function sameTarget(a, b) {
        return a && b && a.sim === b.sim && a.mem === b.mem && a.cr12 === b.cr12 && a.cr5 === b.cr5 && a.offset === b.offset && a.content === b.content && a.allocation === b.allocation && a.pool === b.pool;
    }
    function hex(s) { return s; }

    function q(sel) { return dlg.querySelector(sel); }
    function getOffset() {
        var v = q('#thrOffset').value.trim();
        if (!/^\d+$/.test(v)) throw new Error('Offset must be a non-negative integer word offset.');
        return Number(v);
    }
    function status(msg, kind) {
        var s = q('#thrStatus');
        s.textContent = msg;
        s.className = 'thr-status' + (kind ? ' ' + kind : '');
    }
    function fail(e) { status('Error: ' + (e && e.message ? e.message : String(e)), 'error'); }
    function parseBox() {
        try { return JSON.parse(q('#thrJson').value); }
        catch (e) { throw new Error('JSON textbox is not valid JSON: ' + e.message); }
    }
    function showBinding() {
        var b = q('#thrBound');
        b.textContent = bound
            ? 'Bound target: offset ' + bound.offset + ', CR12 ' + hex(bound.cr12) + ', CR5 ' + hex(bound.cr5) + '. Writes are rejected if the active Thread changes.'
            : 'No target bound. Read current or import first; partial updates require a bound target.';
        q('#thrApply').disabled = !bound;
    }
    function unbind() { bound = null; showBinding(); }
    function download(name, text, type) {
        var url = URL.createObjectURL(new Blob([text], { type: type }));
        var a = el('a', { href: url, download: name });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    function clearConfirm() { pending = null; q('#thrConfirm').hidden = true; }
    function showAllocations() {
        var box = q('#thrAllocations');
        box.textContent = '';
        try {
            var state = api().allocations(ctx());
            box.appendChild(el('div', {text: state.pool
                ? 'Reserved pool: ' + state.pool.offset + '..' + (state.pool.offset + state.pool.words - 1) + '. Allocated: ' + state.records.length
                : 'No pool reserved. Declare an exclusive region before allocating.'}));
            state.records.forEach(function (r) {
                box.appendChild(el('button', {type: 'button', cls: 'thr-btn',
                    text: 'Record #' + r.id + ': ' + r.offset + '..' + (r.offset + r.words - 1),
                    onclick: function () { clearConfirm(); unbind(); q('#thrOffset').value = r.offset; onRead(); }}));
            });
        } catch (e) { box.textContent = e.message; }
    }
    function onReserve() {
        clearConfirm();
        try {
            var off = getOffset(), size = Number(q('#thrPoolWords').value), sim = ctx();
            var snap = identity(sim, off);
            askConfirm('Reserve heap words ' + off + '..' + (off + size - 1) +
                ' exclusively for this demo. Confirm that no other software owns or uses this range, even if it is zero. Reservation changes no memory.', false, function () {
                var current = ctx();
                if (!sameTarget(snap, identity(current, off))) throw new Error('Thread or allocations changed. Review again; nothing changed.');
                api().reservePool(current, off, size);
                showAllocations(); status('Pool reserved. Allocate a record next.', 'ok');
            });
            q('#thrConfirmGo').textContent = 'Confirm exclusive reservation';
        } catch (e) { fail(e); }
    }
    function onAllocate(automatic) {
        clearConfirm();
        try {
            var r = api().allocate(ctx(), automatic ? undefined : getOffset());
            q('#thrOffset').value = r.offset;
            unbind(); showAllocations();
            status('Allocated record #' + r.id + ' at offset ' + r.offset + '. Import JSON or run Initialize before reading.', 'ok');
        } catch (e) { fail(e); }
    }
    function onRelease() {
        clearConfirm();
        try {
            var off = getOffset(), snap = identity(ctx(), off);
            if (!snap.allocation) throw new Error('No allocation at this offset. Nothing changed.');
            askConfirm('Release record at offset ' + off + '? This erases its 58 words. Stop using any compiled methods for this offset before release; they cannot detect reuse.', true, function () {
                var current = ctx();
                if (!sameTarget(snap, identity(current, off))) throw new Error('Thread, allocation, or contents changed. Review again; nothing changed.');
                api().release(current, off);
                unbind(); showAllocations(); status('Record erased and released. Its range can be allocated again.', 'ok');
            });
            q('#thrConfirmGo').textContent = 'Confirm erase and release';
        } catch (e) { fail(e); }
    }

    function askConfirm(text, danger, run) {
        pending = run;
        var box = q('#thrConfirm');
        q('#thrConfirmText').textContent = text;
        var go = q('#thrConfirmGo');
        go.className = 'thr-btn ' + (danger ? 'danger' : 'primary');
        go.textContent = danger ? 'Confirm replace' : 'Confirm import';
        box.hidden = false;
        go.focus();
    }

    function onRead() {
        clearConfirm();
        try {
            var off = getOffset(), sim = ctx();
            var rec = api().read(sim, off);
            q('#thrJson').value = JSON.stringify(rec, null, 2);
            bound = identity(sim, off); showBinding();
            status('Read record at heap offset ' + off + '. Target bound.', 'ok');
        } catch (e) { fail(e); }
    }
    function onImport() {
        clearConfirm();
        try {
            var off = getOffset(), obj = parseBox(), A = api(), sim = ctx();
            var v = A.validateTarget(sim, off) || {};
            if (!v.allocationId) throw new Error('Allocate a record at this offset before importing.');
            var snap = identity(sim, off);
            var n = A.schema.words;
            var recognized = !!(v.recognized || v.existing || v.state === 'recognized');
            var text = recognized
                ? 'A recognized ' + A.schema.name + ' record already exists at words ' + off + '..' + (off + n - 1) + ' (CR12 ' + snap.cr12 + '). Replacing it overwrites all ' + n + ' words in this Thread heap. This is a separate, explicit replacement.'
                : 'Initialize the allocated ' + n + ' words at heap offset ' + off + '..' + (off + n - 1) + ' of the active Thread (CR12 ' + snap.cr12 + ', CR5 ' + snap.cr5 + '). Unknown nonzero words will block the import.';
            askConfirm(text, recognized, function () {
                var sim2 = ctx();
                if (!sameTarget(snap, identity(sim2, off))) throw new Error('Active Thread or memory changed since review. Nothing written; review again.');
                api().importRecord(sim2, off, obj, { replace: recognized });
                bound = identity(sim2, off); showBinding();
                status((recognized ? 'Replaced' : 'Imported') + ' record at offset ' + off + ' (' + n + ' words). Target bound.', 'ok');
            });
            status('Review the confirmation below. Nothing has been written yet.');
        } catch (e) { fail(e); }
    }
    function onApply() {
        clearConfirm();
        try {
            if (!bound) throw new Error('No bound target. Read current or import first.');
            var off = getOffset(), patch = parseBox();
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Partial update must be a JSON object.');
            if (off !== bound.offset) throw new Error('Offset changed since the target was bound. Read current again.');
            var snap = bound;
            askConfirm('Apply partial update to offset ' + off + ' (CR12 ' + snap.cr12 + '). Fields: ' + (Object.keys(patch).join(', ') || '(none)') + '. Omitted fields stay unchanged.', false, function () {
                var sim = ctx();
                if (!sameTarget(snap, identity(sim, off))) { unbind(); throw new Error('Active Thread or memory changed since read/import. Update rejected; target unbound.'); }
                var res = api().updateRecord(sim, off, patch);
                bound = identity(sim, off); showBinding();
                status('Partial update applied at offset ' + off + '.' + (res ? '\n' + JSON.stringify(res) : ''), 'ok');
            });
            q('#thrConfirmGo').textContent = 'Confirm update';
        } catch (e) { fail(e); }
    }
    function onExport() {
        try { var off = getOffset(); download('thread-heap-record-' + off + '.json', api().exportJson(ctx(), off), 'application/json'); status('JSON downloaded.', 'ok'); }
        catch (e) { fail(e); }
    }
    function onSource(save) {
        try {
            var off = getOffset(), src = api().source(off);
            q('#thrSource').textContent = src;
            if (save) download('thread-heap-record-' + off + '.cloomc', src, 'text/plain');
            status(save ? 'Source downloaded (not saved to any LUMP).' : 'Source preview updated.', 'ok');
        } catch (e) { fail(e); }
    }
    function onFile(ev) {
        var f = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!f) return;
        if (f.size > MAX_FILE) return fail(new Error('File exceeds 16 KB limit (' + f.size + ' bytes).'));
        var owner = dlg, originalText = q('#thrJson').value;
        var r = new FileReader();
        r.onload = function () {
            if (dlg !== owner) return;
            if (q('#thrJson').value !== originalText) {
                fail(new Error('JSON text changed while the file was loading. Your edits were kept.'));
                return;
            }
            clearConfirm();
            q('#thrJson').value = String(r.result);
            status('Loaded ' + f.name + ' into textbox. Nothing written.');
        };
        r.onerror = function () { if (dlg === owner) fail(new Error('Could not read file.')); };
        r.readAsText(f);
    }

    function fieldTable(schema) {
        var t = el('table', { cls: 'thr-fields' }, [el('tr', {}, [el('th', { text: 'Field' }), el('th', { text: 'Description' })])]);
        var fs = schema.fields || [];
        (Array.isArray(fs) ? fs : Object.keys(fs).map(function (k) { return Object.assign({ name: k }, typeof fs[k] === 'object' ? fs[k] : { description: fs[k] }); }))
            .forEach(function (f) {
                t.appendChild(el('tr', {}, [el('td', {}, [el('code', { text: f.name || '' })]),
                    el('td', { text: (f.description || f.desc || '') + (f.words ? ' (' + f.words + ' words)' : '') })]));
            });
        return t;
    }

    function build() {
        var A = api(), S = A.schema, sample = '';
        try { sample = JSON.stringify(A.sample(), null, 2); } catch (e) { sample = '{}'; }
        var firstField = (Array.isArray(S.fields) ? (S.fields[0] || {}).name : Object.keys(S.fields || {})[0]) || 'field';
        var states = Array.isArray(S.states) ? S.states.join(', ') : Object.keys(S.states || {}).join(', ');
        var back = el('div', { cls: 'thr-backdrop', onmousedown: function (e) {
            if (e.target === back) {
                // Do not let the default mousedown focus move undo restoration.
                e.preventDefault();
                close();
            }
        } });
        var d = el('div', { cls: 'thr-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'thrTitle' }, [
            el('div', { cls: 'thr-head' }, [
                el('h2', { id: 'thrTitle', text: 'Thread heap call record' }),
                el('button', { cls: 'thr-btn', type: 'button', 'aria-label': 'Close dialog', text: 'Close', onclick: close })
            ]),
            el('div', { cls: 'thr-body' }, [
                el('div', { cls: 'thr-col' }, [
                    el('div', { cls: 'thr-row' }, [
                        el('label', { for: 'thrOffset', text: 'Heap word offset' }),
                        el('input', { id: 'thrOffset', type: 'number', min: '0', step: '1', value: '0', oninput: function () { clearConfirm(); if (bound) unbind(); } }),
                        el('span', { id: 'thrSpan', text: 'Occupies ' + S.words + ' words' })
                    ]),
                    el('div', { cls: 'thr-row' }, [
                        el('label', {for: 'thrPoolWords', text: 'Pool words'}),
                        el('input', {id: 'thrPoolWords', type: 'number', min: '58', step: '1', value: '116', oninput: clearConfirm}),
                        el('button', {cls: 'thr-btn', type: 'button', text: 'Reserve pool at offset…', onclick: onReserve}),
                        el('button', {cls: 'thr-btn', type: 'button', text: 'Allocate next', onclick: function () { onAllocate(true); }}),
                        el('button', {cls: 'thr-btn', type: 'button', text: 'Allocate at offset', onclick: function () { onAllocate(false); }}),
                        el('button', {cls: 'thr-btn danger', type: 'button', text: 'Release…', onclick: onRelease}),
                        el('button', {cls: 'thr-btn', type: 'button', text: 'Refresh allocations', onclick: showAllocations})
                    ]),
                    el('div', {id: 'thrAllocations', cls: 'thr-note', 'aria-live': 'polite'}),
                    el('label', { for: 'thrJson', text: 'Record JSON' }),
                    el('textarea', { id: 'thrJson', spellcheck: 'false' }),
                    el('div', { cls: 'thr-row' }, [
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Load file into textbox', onclick: function () { q('#thrFile').click(); } }),
                        el('input', { id: 'thrFile', type: 'file', accept: '.json,application/json', hidden: '', onchange: onFile }),
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Reset to sample', onclick: function () { q('#thrJson').value = sample; } })
                    ]),
                    el('div', { cls: 'thr-row' }, [
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Read current', onclick: onRead }),
                        el('button', { cls: 'thr-btn primary', type: 'button', text: 'Import / replace...', onclick: onImport }),
                        el('button', { id: 'thrApply', cls: 'thr-btn', type: 'button', text: 'Apply partial update...', onclick: onApply }),
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Download JSON', onclick: onExport })
                    ]),
                    el('div', { id: 'thrConfirm', cls: 'thr-confirm', hidden: '' }, [
                        el('p', { id: 'thrConfirmText', style: 'margin:0 0 .5rem' }),
                        el('div', { cls: 'thr-row' }, [
                            el('button', { id: 'thrConfirmGo', cls: 'thr-btn primary', type: 'button', text: 'Confirm', onclick: function () {
                                var run = pending; clearConfirm();
                                if (run) { try { run(); } catch (e) { fail(e); } }
                            } }),
                            el('button', { cls: 'thr-btn', type: 'button', text: 'Cancel', onclick: function () { clearConfirm(); status('Cancelled. Nothing written.'); } })
                        ])
                    ]),
                    el('div', { id: 'thrStatus', cls: 'thr-status', role: 'status', 'aria-live': 'polite', text: 'Opening this dialog writes nothing.' }),
                    el('div', { id: 'thrBound', cls: 'thr-note' })
                ]),
                el('div', { cls: 'thr-col' }, [
                    el('div', { cls: 'thr-note' }, ['Schema ', el('b', { text: S.name + ' v' + S.version }), ' - ' + S.words + ' words. States: ' + (states || 'n/a') + '.']),
                    el('div', { cls: 'thr-note warn', text: 'Uses the active, paused software simulator Thread’s canonical CR5 heap, not the saved/build Thread design. Opening does not prepare a Thread or change targets. The record has thread-local lifetime, is not Alice-private, imports no GTs and makes no hardware writes. Initial import cannot overwrite unknown nonzero words; replacing a recognized record needs its own confirmation.' }),
                    el('div', { cls: 'thr-note' }, ['Partial update example (omitted fields unchanged):', el('pre', { cls: 'thr-pre', text: '{ "' + firstField + '": ... }' })]),
                    fieldTable(S),
                    el('div', { cls: 'thr-row' }, [
                        el('label', { text: 'CLOOMC source (read-only)' }),
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Preview', onclick: function () { onSource(false); } }),
                        el('button', { cls: 'thr-btn', type: 'button', text: 'Download .cloomc', onclick: function () { onSource(true); } })
                    ]),
                    el('pre', { id: 'thrSource', cls: 'thr-pre', tabindex: '0', 'aria-label': 'Read-only CLOOMC source', text: 'Press Preview. Source is never placed in the editor or saved to a LUMP.' })
                ])
            ])
        ]);
        back.appendChild(d);
        back.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'Tab') {
                var f = Array.prototype.filter.call(d.querySelectorAll('button,input,textarea,[tabindex]'), function (n) { return !n.disabled && n.offsetParent !== null; });
                if (!f.length) return;
                if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
            }
        });
        dlg = back;
        q('#thrJson').value = sample;
        showBinding();
        showAllocations();
    }

    function close() {
        if (!dlg) return;
        dlg.remove(); dlg = null; pending = null; bound = null;
        // The design page can replace its trigger during an async/settings
        // render. Resolve that current element instead of focusing a stale node.
        var focus = (lastFocusId && document.getElementById(lastFocusId)) || lastFocus;
        lastFocus = null; lastFocusId = null;
        if (focus && focus.isConnected && focus.focus) focus.focus();
    }

    window.openThreadHeapRecord = function (trigger) {
        if (dlg) { q('#thrOffset').focus(); return; }
        lastFocus = trigger || document.activeElement;
        lastFocusId = lastFocus && lastFocus.id;
        try { build(); } catch (e) { alert('Cannot open Thread heap record: ' + e.message); return; }
        document.body.appendChild(dlg);
        q('#thrOffset').focus();
    };
})();
