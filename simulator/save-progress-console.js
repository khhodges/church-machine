// save-progress-console.js — Save LUMP progress console and activity lock.
//
// One owner at a time. The console shows only real stage events (the
// labels below and stage/event/outcome enums forwarded from
// LumpSaveDiagnostics) plus elapsed wall time. It never shows source,
// payloads, tokens, or arbitrary error prose. While a session is pending,
// unrelated pointer/keyboard activity and navigation are blocked; during an
// approval or stale-conflict choice only those active controls are allowed.
(function (root) {
    'use strict';
    const doc = root && root.document;
    const STAGE_LABEL = {
        capture: 'Capture', prepare: 'Prepare', confirm: 'Approval', commit: 'Commit',
        reload: 'Reload', reconcile: 'Reconcile', ns_table: 'Namespace table', transport: 'Transport',
    };
    const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
        'auxclick', 'contextmenu', 'touchstart', 'touchend', 'keydown', 'keypress', 'keyup',
        'submit', 'dragstart', 'drop', 'paste', 'cut'];
    let session = null;
    let seq = 0;
    let panel = null;
    let listenersOn = false;

    function now() { return Date.now(); }
    function el(tag, cls, text) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }
    function ensurePanel() {
        if (!doc || !doc.body || typeof doc.createElement !== 'function') return null;
        if (panel && panel.isConnected !== false) return panel;
        panel = el('section', 'spc-panel');
        panel.id = 'saveProgressConsole';
        panel.setAttribute('role', 'status');
        panel.setAttribute('aria-live', 'polite');
        const head = el('div', 'spc-head');
        panel._title = el('span', 'spc-title', 'Save LUMP');
        panel._state = el('span', 'spc-state', '');
        panel._close = el('button', 'spc-close', 'Close');
        panel._close.type = 'button';
        panel._close.hidden = true;
        panel._close.addEventListener('click', () => hide());
        head.appendChild(panel._title); head.appendChild(panel._state); head.appendChild(panel._close);
        panel._wait = el('div', 'spc-wait', '');
        panel._log = el('ol', 'spc-log');
        panel._log.tabIndex = 0;
        panel._log.setAttribute('aria-label', 'Save progress log');
        panel.appendChild(head); panel.appendChild(panel._wait); panel.appendChild(panel._log);
        doc.body.appendChild(panel);
        return panel;
    }
    function hide() { if (panel) panel.hidden = true; }
    function fmt(ms) { return (Math.max(0, ms) / 1000).toFixed(1) + ' s'; }

    function within(target, node) {
        return !!(node && target && typeof node.contains === 'function' && node.contains(target));
    }
    function visible(node) {
        return !!node && !(node.style && node.style.display === 'none') && !node.hidden;
    }
    function allowed(target) {
        if (!session) return true;
        if (within(target, panel)) return true;
        const conflict = doc.getElementById && doc.getElementById('lumpSaveStaleConflictDialog');
        if (visible(conflict) && within(target, conflict)) return true;
        return session.allowed.some(node => node === target || within(target, node));
    }
    function focusables() {
        const list = session ? session.allowed.slice() : [];
        const conflict = doc.getElementById && doc.getElementById('lumpSaveStaleConflictDialog');
        if (visible(conflict) && typeof conflict.querySelectorAll === 'function') {
            Array.prototype.forEach.call(conflict.querySelectorAll('button:not([disabled])'), b => list.push(b));
        }
        if (panel && !panel.hidden && panel._close && !panel._close.hidden) list.push(panel._close);
        if (panel && !panel.hidden && panel._log) list.push(panel._log);
        return list.filter(n => n && !n.hidden && !n.disabled && typeof n.focus === 'function');
    }
    function trapTab(event) {
        const list = focusables();
        if (!list.length) return;
        const active = doc.activeElement;
        let i = list.indexOf(active);
        i = i < 0 ? 0 : (i + (event.shiftKey ? -1 : 1) + list.length) % list.length;
        try { list[i].focus(); } catch (_) {}
    }
    function guard(event) {
        if (!session) return;
        const isKey = /^key/.test(event.type);
        if (isKey) {
            const key = event.key;
            const permitted = allowed(event.target);
            // Global/document shortcuts never run while pending, even when the
            // focus sits on an approval control or the console.
            event.stopImmediatePropagation();
            if (key === 'Tab') {
                event.preventDefault();
                if (event.type === 'keydown') trapTab(event);
                return;
            }
            const activation = (key === 'Enter' || key === ' ' || key === 'Spacebar') &&
                !event.ctrlKey && !event.metaKey && !event.altKey;
            // Native button activation still occurs (default not prevented);
            // everything else, including Escape, F-keys and modifiers, is blocked.
            if (!(permitted && activation)) event.preventDefault();
            return;
        }
        if (allowed(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    function beforeUnload(event) {
        if (!session) return;
        event.preventDefault();
        event.returnValue = 'A Save LUMP operation is still pending.';
        return event.returnValue;
    }
    function setListeners(on) {
        if (!root || typeof root.addEventListener !== 'function' || on === listenersOn) return;
        const fn = on ? 'addEventListener' : 'removeEventListener';
        BLOCKED.forEach(type => root[fn](type, guard, true));
        root[fn]('beforeunload', beforeUnload);
        listenersOn = on;
        if (doc && doc.documentElement && doc.documentElement.classList) {
            doc.documentElement.classList.toggle('spc-locked', on);
        }
    }
    function log(message, kind) {
        if (!session) return;
        const at = now() - session.startedAt;
        session.entries.push({ at, message, kind: kind || 'info' });
        const p = ensurePanel();
        if (!p) return;
        const li = el('li', 'spc-entry spc-' + (kind || 'info'));
        li.appendChild(el('span', 'spc-at', fmt(at)));
        li.appendChild(el('span', 'spc-msg', message));
        p._log.appendChild(li);
        p._log.scrollTop = p._log.scrollHeight;
        session.lastAt = now();
    }
    function rect(n) {
        try { return n && typeof n.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null; }
        catch (_) { return null; }
    }
    function overlaps(a, b) {
        return !!a && !!b && a.width > 0 && b.width > 0 &&
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    }
    function controls() {
        const list = focusables().filter(n => !within(n, panel));
        // Terminal incidents release the input lock, but their recovery
        // controls still need space. Do not redock over Close/Retry merely
        // because the pending session has ended.
        if (!session && doc && doc.getElementById) {
            const dialog = doc.getElementById('saveNSDialog');
            if (visible(dialog) && typeof dialog.querySelectorAll === 'function') {
                Array.prototype.forEach.call(dialog.querySelectorAll('button:not([disabled])'),
                    button => { if (visible(button)) list.push(button); });
            }
        }
        return list;
    }
    // Placement: bottom normally; whenever interactive approval/conflict
    // controls exist, dock compactly at the top; if it still overlaps a
    // control, try bottom, then collapse to a single status line.
    function place() {
        if (!panel) return 'none';
        const ctl = controls();
        const set = (dock) => { panel.dataset.dock = dock; return dock; };
        if (!ctl.length) return set('bottom');
        const clear = () => { const r = rect(panel); return !ctl.some(c => overlaps(r, rect(c))); };
        for (const dock of ['top', 'bottom', 'top-mini', 'bottom-mini']) {
            set(dock);
            if (clear()) return dock;
        }
        return set('top-mini');
    }
    function tick() {
        if (!session || !panel) return;
        place();
        panel._wait.textContent = session.waitingFor
            ? `Waiting for ${session.waitingFor}: ${fmt(now() - session.lastAt)} (total ${fmt(now() - session.startedAt)})`
            : `Elapsed ${fmt(now() - session.startedAt)}`;
    }

    function begin(kind, title) {
        if (session) return null;
        hookDiagnostics();
        const token = 'spc-' + (++seq);
        session = { token, kind, startedAt: now(), lastAt: now(), entries: [], allowed: [],
            waitingFor: null, committed: false, timer: null };
        const p = ensurePanel();
        if (p) {
            p.hidden = false;
            p.dataset.state = 'pending';
            p._title.textContent = title || 'Save LUMP';
            p._state.textContent = 'In progress';
            p._close.hidden = true;
            while (p._log.firstChild) p._log.removeChild(p._log.firstChild);
        }
        setListeners(true);
        if (typeof setInterval === 'function') session.timer = setInterval(tick, 250);
        tick();
        return token;
    }
    function owns(token) { return !!session && !!token && session.token === token; }
    function stage(token, message, waitingFor) {
        if (!owns(token)) return false;
        session.waitingFor = waitingFor || null;
        log(message, 'info');
        tick();
        return true;
    }
    function allow(token, nodes) {
        if (!owns(token)) return false;
        session.allowed = (nodes || []).filter(Boolean);
        session.waitingFor = session.allowed.length ? 'your approval' : session.waitingFor;
        if (panel) panel.dataset.state = session.allowed.length ? 'approval' : 'pending';
        tick();
        place();
        return true;
    }
    function current() { return session ? session.token : null; }
    const TERMINAL = {
        success: ['Saved', 'ok'], handoff: ['Review ready', 'ok'], cancelled: ['Cancelled', 'info'],
        error: ['Failed', 'error'], unknown: ['Outcome unknown', 'unknown'], ended: ['Ended', 'info'],
    };
    function end(token, outcome, message) {
        if (!owns(token)) return false;
        const t = TERMINAL[outcome] || TERMINAL.ended;
        if (message) log(message, t[1]);
        const s = session;
        if (s.timer && typeof clearInterval === 'function') clearInterval(s.timer);
        s.waitingFor = null;
        tick();
        session = null;
        setListeners(false);
        if (panel) {
            panel.dataset.state = outcome;
            panel._state.textContent = t[0];
            panel._close.hidden = false;
            panel._wait.textContent = 'Total ' + fmt(now() - s.startedAt);
            place();
            // Keep the log visible on failures; quiet successes fade away.
            if (outcome === 'handoff' || outcome === 'cancelled') hide();
            else if (outcome === 'success' && typeof setTimeout === 'function') {
                setTimeout(() => { if (!session && panel && panel.dataset.state === 'success') hide(); }, 2500);
            }
        }
        return true;
    }
    function committed() { return !!session && session.committed; }

    // Forward safe diagnostic enums only (stage, event, outcome).
    function onDiagnostic(stageName, eventName, values) {
        if (!session) return;
        const label = STAGE_LABEL[String(stageName)] || 'Save';
        const outcome = values && values.outcome;
        if (eventName === 'start') {
            if (stageName === 'capture') return;
            session.waitingFor = label.toLowerCase();
            log(label + ' started', 'info');
        } else if (eventName === 'complete') {
            if (stageName === 'commit' && outcome === 'committed') session.committed = true;
            session.waitingFor = null;
            log(label + ' finished (' + (outcome === 'committed' ? 'committed'
                : outcome === 'rejected' ? 'rejected' : 'outcome not confirmed') + ')',
                outcome === 'rejected' ? 'error' : outcome === 'committed' ? 'ok' : 'unknown');
        } else if (eventName === 'exception') {
            session.waitingFor = null;
            log(label + ' raised an error', 'error');
        }
        tick();
    }
    function hookDiagnostics() {
        const d = root && root.LumpSaveDiagnostics;
        if (!d || d.__spcHooked) return;
        const wrap = (name, fn) => {
            const orig = d[name];
            if (typeof orig !== 'function') return;
            d[name] = function () {
                const result = orig.apply(this, arguments);
                try { fn.apply(null, arguments); } catch (_) {}
                return result;
            };
        };
        wrap('stageStart', (m, s) => onDiagnostic(s, 'start'));
        wrap('stageComplete', (m, s, o) => onDiagnostic(s, 'complete', { outcome: o }));
        wrap('stageException', (m, s, e, v) => onDiagnostic(s, 'exception', v));
        try { d.__spcHooked = true; } catch (_) {}
    }
    hookDiagnostics();

    function yieldPaint() {
        return new Promise(resolve => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => setTimeout(resolve, 0));
            } else setTimeout(resolve, 0);
        });
    }

    const api = { begin, stage, allow, end, current, owns, committed, yieldPaint,
        hookDiagnostics, _onDiagnostic: onDiagnostic, _guard: guard, _allowed: allowed,
        _locked: () => listenersOn, _place: place };
    if (root) root.SaveProgressConsole = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : null));
