// Assembly dot completion. Only exact embedded APIs accepted by compile are
// authority; documentation catalogs and conventional Run/Main are not fallbacks.
(function () {
    'use strict';
    var popup, list, editor, snapshot, items = [], selected = -1, generation = 0;

    function context(textarea) {
        if (textarea.readOnly || textarea.disabled) return null;
        var pos = textarea.selectionStart;
        if (pos !== textarea.selectionEnd) return null;
        var before = textarea.value.slice(0, pos);
        // Mask comments and quoted literals without shifting source offsets.
        var clean = before.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|;[^\n]*|"(?:\\.|[^"\\])*(?:"|$)|'(?:\\.|[^'\\])*(?:'|$)/g,
            function (s) { return s.replace(/[^\n]/g, ' '); });
        var m = /(?:^|\s)CALL\s+([A-Za-z_][\w.]*)\.([A-Za-z0-9_]*)$/i.exec(clean);
        if (!m || /^(?:CR|DR)\d+$/i.test(m[1])) return null;
        var bindings = typeof _sourceCallApiBindings === 'function'
            ? _sourceCallApiBindings(textarea.value) : [];
        // A fully declared dotted capability is a target, not a method.
        if (m[2] && bindings.some(function (b) {
            return b.petname.toLowerCase() === (m[1] + '.' + m[2]).toLowerCase();
        })) return null;
        var matches = bindings.filter(function (b) { return b.petname.toLowerCase() === m[1].toLowerCase(); });
        return {
            target: m[1], filter: m[2], start: pos - m[2].length,
            end: pos + (textarea.value.slice(pos).match(/^\w*/)[0].length),
            binding: matches.length === 1 ? matches[0] : { petname: m[1] },
            collision: matches.length > 1
        };
    }
    function ensure() {
        if (popup) return;
        popup = document.createElement('div');
        popup.id = 'asmMethodPopup';
        popup.className = 'asm-method-popup';
        popup.setAttribute('role', 'listbox');
        popup.setAttribute('aria-label', 'Method picker');
        var header = document.createElement('div');
        header.className = 'asm-method-popup-header';
        header.textContent = 'Methods · ↑↓ navigate · Enter/Tab choose · Esc dismiss';
        popup.appendChild(header);
        list = document.createElement('ul');
        list.className = 'asm-method-popup-list';
        popup.appendChild(list);
        document.body.appendChild(popup);
    }
    function hide() {
        generation++;
        if (popup) popup.style.display = 'none';
        editor = snapshot = null;
        items = [];
        selected = -1;
    }
    function current() {
        return editor && snapshot && document.activeElement === editor &&
            snapshot.owner === owner() && !editor.readOnly && !editor.disabled &&
            editor.value === snapshot.value && editor.selectionStart === snapshot.pos &&
            editor.selectionEnd === snapshot.pos && editor.isConnected !== false;
    }
    function owner() {
        return typeof _currentEditorOwner === 'function' ? JSON.stringify(_currentEditorOwner()) : '';
    }
    function highlight() {
        Array.from(list.children).forEach(function (li, i) {
            li.classList.toggle('asm-method-popup-item--active', i === selected);
            li.setAttribute('aria-selected', String(i === selected));
            if (i === selected) li.scrollIntoView({ block: 'nearest' });
        });
    }
    // Keep the existing textarea-mirror placement: completion belongs at the
    // caret, including in scrolled source, not at the top of the editor.
    function caretPixelPos(textarea) {
        var cs = window.getComputedStyle(textarea), div = document.createElement('div');
        ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
            'padding', 'border', 'boxSizing', 'tabSize'].forEach(function (p) { div.style[p] = cs[p]; });
        Object.assign(div.style, { position: 'absolute', visibility: 'hidden',
            whiteSpace: 'pre-wrap', wordWrap: 'break-word', width: textarea.clientWidth + 'px',
            top: '-9999px', left: '-9999px' });
        div.textContent = textarea.value.slice(0, textarea.selectionStart);
        var span = document.createElement('span');
        span.textContent = '\u200b';
        div.appendChild(span);
        document.body.appendChild(div);
        var rect = textarea.getBoundingClientRect();
        var pos = { x: rect.left + span.offsetLeft - textarea.scrollLeft,
            y: rect.top + span.offsetTop - textarea.scrollTop + (parseFloat(cs.lineHeight) || 16) + 4 };
        document.body.removeChild(div);
        return pos;
    }
    function choose(i) {
        if (!current() || !items[i]) { hide(); return; }
        var el = editor, ctx = snapshot.ctx, name = items[i].name;
        // Explicit selection is consent to this token-only edit, not to any
        // background source replacement or Namespace/repository mutation.
        el.setRangeText(name, ctx.start, ctx.end, 'end');
        hide();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        hide();
        if (typeof updateLineNumbers === 'function') updateLineNumbers();
        if (typeof markUserTabDirty === 'function') markUserTabDirty();
    }
    function render(methods, message) {
        list.innerHTML = '';
        items = methods;
        selected = methods.length ? 0 : -1;
        if (!methods.length) {
            var status = document.createElement('li');
            status.textContent = message;
            status.setAttribute('role', 'status');
            list.appendChild(status);
        }
        methods.forEach(function (method, i) {
            var li = document.createElement('li');
            li.className = 'asm-method-popup-item';
            li.setAttribute('role', 'option');
            li.textContent = method.name;
            if (method.signature || method.perms) {
                var detail = document.createElement('span');
                detail.className = 'asm-method-popup-desc';
                detail.textContent = [method.signature, method.perms].filter(Boolean).join(' · ');
                li.appendChild(detail);
            }
            li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
            li.addEventListener('mousemove', function () { selected = i; highlight(); });
            list.appendChild(li);
        });
        highlight();
    }
    async function refresh(el) {
        hide();
        var ctx = context(el);
        if (!ctx || document.activeElement !== el) return;
        var requestId = generation;
        editor = el;
        snapshot = { value: el.value, pos: el.selectionStart, ctx: ctx, owner: owner() };
        if (window.AsmInstructionPicker) window.AsmInstructionPicker.hide();
        ensure();
        var pos = caretPixelPos(el);
        popup.style.left = Math.max(4, Math.min(pos.x, window.innerWidth - 430)) + 'px';
        popup.style.top = Math.max(4, Math.min(pos.y, window.innerHeight - 230)) + 'px';
        popup.style.display = 'flex';
        render([], 'Loading exact selected LUMP API…');
        try {
            if (ctx.collision) throw new Error('Ambiguous target binding');
            var response = await fetch('/api/compile/call-methods', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ call_api_bindings: [ctx.binding] })
            });
            if (!response.ok) throw new Error('API lookup failed (HTTP ' + response.status + ')');
            var data = await response.json();
            if (requestId !== generation) return;
            if (!current()) { hide(); return; }
            var authorities = data.call_api_authorities || {};
            var keys = Object.keys(authorities).filter(function (key) { return key.toLowerCase() === ctx.target.toLowerCase(); });
            var a = keys.length === 1 ? authorities[keys[0]] : null;
            if (!a || !(a.embedded === true || a.source === 'embedded-binary' || a.authority === 'embedded-binary') ||
                (a.selectedToken != null && String(a.selectedToken) !== String(a.token)) ||
                (a.selectedRevision != null && String(a.selectedRevision) !== String(a.revision)) ||
                !a.api || !Array.isArray(a.api.methods)) {
                render([], 'Exact selected LUMP API unavailable.'); return;
            }
            var methods = a.api.methods.filter(function (m) {
                return m && typeof m.name === 'string' && /^[A-Za-z_]\w*$/.test(m.name) &&
                    m.name.toLowerCase().indexOf(ctx.filter.toLowerCase()) === 0;
            });
            render(methods, a.api.methods.length ? 'No matching API methods.' : 'The embedded API declares no methods.');
        } catch (err) {
            if (requestId === generation && current()) render([], 'Exact selected LUMP API unavailable: ' + err.message);
        }
    }
    function attach(el) {
        if (!el || el._asmMethodPopupAttached) return;
        el._asmMethodPopupAttached = true;
        el.addEventListener('input', function () { refresh(el); });
        el.addEventListener('click', function () { refresh(el); });
        el.addEventListener('keyup', function (e) {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) >= 0) refresh(el);
        });
        el.addEventListener('keydown', function (e) {
            if (editor !== el) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); hide(); return; }
            if (!current()) { hide(); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (items.length) selected = (selected + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
                highlight();
            } else if ((e.key === 'Enter' || e.key === 'Tab') && selected >= 0) {
                e.preventDefault(); e.stopImmediatePropagation(); choose(selected);
            } else { hide(); }
        }, true); // Before the editor's ordinary Tab indentation/Enter handlers.
        el.addEventListener('blur', hide);
        el.addEventListener('scroll', hide);
    }
    document.addEventListener('selectionchange', function () { if (editor && !current()) hide(); });
    document.addEventListener('mousedown', function (e) {
        if (popup && !popup.contains(e.target) && e.target !== editor) hide();
    }, true);
    function autoAttach() {
        attach(document.getElementById('asmEditor'));
        attach(document.getElementById('codeEditor'));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoAttach);
    else autoAttach();
    window.AsmMethodPopup = { attach: attach, hide: hide };
}());