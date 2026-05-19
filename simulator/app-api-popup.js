// =============================================================================
// app-api-popup.js — In-editor Abstraction API Contextual Popup
// =============================================================================
//
// Shows a small floating popup when the programmer hovers over or types an
// abstraction name or dot-notation method call (e.g. `Salvation`, `Navana.Init`,
// `CALL SlideRule.Sqrt`) in the CLOOMC assembly editor (#asmEditor).
//
// Depends on: api-data.js (API_INDEX, API_DATA, API_LAYER_NAMES)
//
// Popup dismisses on:
//   • click-away
//   • Escape key
//   • cursor moves off the word
//
// Matches the Church Gold dark theme via CSS variables.
// Never overlaps the current editing line — positioned above or below as needed.
// =============================================================================

(function _initApiPopup() {
    if (typeof window === 'undefined') return;
    if (window._apiPopupInitialized) return;
    window._apiPopupInitialized = true;

    // ── State ────────────────────────────────────────────────────────────────
    let _popup = null;
    let _hoverTimer = null;
    let _currentToken = null;
    let _mouseX = 0, _mouseY = 0;
    let _pickCallback = null;

    // ── Create popup DOM element ──────────────────────────────────────────────
    function _getPopup() {
        if (_popup) return _popup;
        _popup = document.createElement('div');
        _popup.id = 'apiPopup';
        _popup.className = 'api-popup';
        _popup.style.display = 'none';
        _popup.addEventListener('click', function(e) { e.stopPropagation(); });
        document.body.appendChild(_popup);
        return _popup;
    }

    // ── Position popup near mouse, avoiding current line ─────────────────────
    function _positionPopup(popup, anchorX, anchorY) {
        popup.style.display = 'block';
        const pw = popup.offsetWidth || 320;
        const ph = popup.offsetHeight || 120;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const OFFSET = 18;
        let left = anchorX;
        let top = anchorY + OFFSET;

        // Flip above if would go off bottom
        if (top + ph > vh - 12) {
            top = anchorY - ph - OFFSET;
        }
        // Stay within horizontal viewport
        if (left + pw > vw - 12) {
            left = vw - pw - 12;
        }
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    // ── Build popup HTML ──────────────────────────────────────────────────────
    function _buildPopupHtml(entry) {
        const { abs, method } = entry;
        if (!abs) return '';

        const layerName = (typeof API_LAYER_NAMES !== 'undefined' && API_LAYER_NAMES[abs.layer])
            || ('Layer ' + abs.layer);
        const implBadge = abs.implemented === true ? 'api-popup-badge-impl'
            : abs.implemented === 'partial' ? 'api-popup-badge-partial'
            : 'api-popup-badge-planned';
        const implLabel = abs.implemented === true ? 'Implemented'
            : abs.implemented === 'partial' ? 'Partial'
            : 'Planned';
        const profileBadge = abs.profile !== 'Full'
            ? `<span class="api-popup-profile">${abs.profile}</span>`
            : '';

        if (method) {
            // Method-level popup
            const mImplBadge = method.implemented
                ? 'api-popup-badge-impl' : 'api-popup-badge-planned';
            const mImplLabel = method.implemented ? 'Implemented' : 'Planned';
            return `
<div class="api-popup-header">
  <span class="api-popup-abs-name">${_esc(abs.name)}</span>
  <span class="api-popup-dot">.</span>
  <span class="api-popup-method-name">${_esc(method.name)}</span>
  <span class="api-popup-slot">NS[${abs.slot}]</span>
  ${profileBadge}
</div>
<div class="api-popup-sig"><code>${_esc(method.signature)}</code></div>
<div class="api-popup-meta">
  <span class="api-popup-layer">${_esc(layerName)}</span>
  <span class="api-popup-perm-label">Permission:</span>
  <span class="api-popup-perm">${_esc(method.perms)}</span>
  <span class="api-popup-badge ${mImplBadge}">${mImplLabel}</span>
</div>
<div class="api-popup-desc">${_esc(method.description)}</div>
<div class="api-popup-footer">Press <kbd>Esc</kbd> or click away to dismiss &ensp;&bull;&ensp; <a class="api-popup-ref-link" onclick="_apiPopupGoToRef(${abs.slot});return false;" href="#">Full reference &rarr;</a></div>
`;
        } else {
            // Abstraction-level popup — show first few methods
            const shownMethods = abs.methods.slice(0, 6);
            const more = abs.methods.length > 6 ? ` +${abs.methods.length - 6} more` : '';
            const methodsHtml = shownMethods.length > 0
                ? `<div class="api-popup-method-list">${shownMethods.map(m => {
                    const pickAttr = _pickCallback
                        ? ` data-pick-method="${_esc(m.name)}" role="button" tabindex="0" title="Insert ${_esc(m.name)}"`
                        : '';
                    const pickClass = _pickCallback ? ' api-popup-method-row-pick' : '';
                    return `<div class="api-popup-method-row${pickClass}"${pickAttr}>
                      <code class="api-popup-method-sig">${_esc(m.name)}</code>
                      <span class="api-popup-method-brief">${_esc(m.description)}</span>
                    </div>`;
                  }).join('')}${more ? `<div class="api-popup-method-more">${more}</div>` : ''}</div>`
                : '<div class="api-popup-method-list api-popup-empty">No callable methods (boot / value type)</div>';

            return `
<div class="api-popup-header">
  <span class="api-popup-abs-name">${_esc(abs.name)}</span>
  <span class="api-popup-slot">NS[${abs.slot}]</span>
  ${profileBadge}
</div>
<div class="api-popup-meta">
  <span class="api-popup-layer">${_esc(layerName)}</span>
  <span class="api-popup-perm-label">Permission:</span>
  <span class="api-popup-perm">${_esc(abs.perms)}</span>
  <span class="api-popup-badge ${implBadge}">${implLabel}</span>
</div>
<div class="api-popup-desc">${_esc(abs.description)}</div>
${methodsHtml}
<div class="api-popup-footer">Press <kbd>Esc</kbd> or click away to dismiss &ensp;&bull;&ensp; <a class="api-popup-ref-link" onclick="_apiPopupGoToRef(${abs.slot});return false;" href="#">Full reference &rarr;</a></div>
`;
        }
    }

    function _esc(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Public: show popup for a named abstraction with optional pick callback ─
    // Called from the "Unknown method" error button in the assembler error panel.
    // absName  — canonical abstraction name, e.g. 'SlideRule'
    // anchorEl — DOM element to position the popup near (optional)
    // onPick   — called with the method name string when user clicks a method row
    window._showApiPopupForAbs = function(absName, anchorEl, onPick) {
        if (typeof apiLookupByName === 'undefined') return;
        const abs = apiLookupByName(absName);
        if (!abs) return;
        _pickCallback = onPick || null;
        const entry = { abs, method: null };
        let x = Math.max(8, Math.floor(window.innerWidth / 2) - 160);
        let y = Math.max(8, Math.floor(window.innerHeight / 4));
        if (anchorEl) {
            const r = anchorEl.getBoundingClientRect();
            x = r.left;
            y = r.bottom + 4;
        }
        _currentToken = absName;
        _showPopup(entry, x, y);
    };

    // ── Navigate to Reference panel for the given NS slot ─────────────────────
    window._apiPopupGoToRef = function(slot) {
        _hidePopup();
        if (typeof switchView === 'function') switchView('reference');
        if (typeof switchRefTab === 'function') switchRefTab('abstractions');
        setTimeout(function() {
            if (typeof showApiAbstractionDetail === 'function') {
                showApiAbstractionDetail(slot);
            }
        }, 80);
    };

    // ── Show / hide ────────────────────────────────────────────────────────────
    function _showPopup(entry, x, y) {
        const html = _buildPopupHtml(entry);
        if (!html) return;
        const popup = _getPopup();
        popup.innerHTML = html;
        _positionPopup(popup, x, y);
        if (_pickCallback) {
            popup.querySelectorAll('[data-pick-method]').forEach(function(row) {
                row.addEventListener('click', function() {
                    const mName = row.getAttribute('data-pick-method');
                    const cb = _pickCallback;
                    _hidePopup();
                    if (cb) cb(mName);
                });
            });
        }
    }

    function _hidePopup() {
        _pickCallback = null;
        _currentToken = null;
        const popup = _getPopup();
        popup.style.display = 'none';
        popup.innerHTML = '';
    }

    // ── Extract token at offset in text ───────────────────────────────────────
    function _tokenAt(text, offset) {
        if (offset < 0 || offset > text.length) return null;
        // Extend left to find word start (alphanumeric + dot + underscore)
        let start = offset;
        while (start > 0 && /[\w.]/.test(text[start - 1])) start--;
        let end = offset;
        while (end < text.length && /[\w.]/.test(text[end])) end++;
        if (start === end) return null;
        return text.slice(start, end);
    }

    // ── Approximate character position from mouse coords in textarea ──────────
    // Uses a hidden mirror div technique for accurate character measurement.
    function _charOffsetFromMouse(textarea, mouseX, mouseY) {
        const style = window.getComputedStyle(textarea);
        const mirror = document.getElementById('_apiPopupMirror') || (function() {
            const m = document.createElement('div');
            m.id = '_apiPopupMirror';
            m.style.cssText = [
                'position:fixed', 'top:0', 'left:-9999px', 'visibility:hidden',
                'overflow:auto', 'white-space:pre-wrap', 'word-break:break-word'
            ].join(';');
            document.body.appendChild(m);
            return m;
        })();

        // Copy relevant textarea styles to mirror
        const props = ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing',
                        'paddingTop','paddingRight','paddingBottom','paddingLeft',
                        'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
                        'boxSizing','tabSize'];
        for (const p of props) mirror.style[p] = style[p];
        mirror.style.width = textarea.offsetWidth + 'px';
        mirror.style.height = 'auto';
        mirror.style.maxHeight = 'none';

        // Paste content up to a limit to save time
        const text = textarea.value;
        const LIMIT = 5000;
        const sliced = text.length > LIMIT ? text.slice(0, LIMIT) : text;

        mirror.textContent = sliced;
        const rect = textarea.getBoundingClientRect();
        const relX = mouseX - rect.left + textarea.scrollLeft;
        const relY = mouseY - rect.top + textarea.scrollTop;

        // Walk characters to find which one the mouse is nearest
        // Use a temporary span for the character at each offset — too slow for
        // large documents; instead use line-based approximation.
        const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const lineIndex = Math.max(0, Math.floor((relY - paddingTop) / lineH));

        const lines = sliced.split('\n');
        let lineStart = 0;
        for (let i = 0; i < lineIndex && i < lines.length - 1; i++) {
            lineStart += lines[i].length + 1;
        }
        const line = lines[Math.min(lineIndex, lines.length - 1)] || '';
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const charW = parseFloat(style.fontSize) * 0.6; // monospace approximation
        const col = Math.max(0, Math.round((relX - paddingLeft) / charW));
        return lineStart + Math.min(col, line.length);
    }

    // ── Caret pixel position from character offset ────────────────────────────
    // Returns {x, y} in viewport coordinates for the given character offset.
    // Uses the same mirror-div approach as _charOffsetFromMouse but goes in
    // reverse: given the offset, measure where that character sits on screen.
    // Applied line-height approximation keeps this O(lines) not O(chars).
    function _caretPixelPos(textarea, offset) {
        const rect = textarea.getBoundingClientRect();
        const style = window.getComputedStyle(textarea);
        const lineH = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const charW = parseFloat(style.fontSize) * 0.6;

        const text = textarea.value.slice(0, Math.min(offset, textarea.value.length));
        const lines = text.split('\n');
        const lineIndex = lines.length - 1;
        const col = lines[lineIndex].length;

        const x = rect.left + paddingLeft + col * charW;
        const y = rect.top + paddingTop + lineIndex * lineH - textarea.scrollTop;

        // Clamp into viewport so popup always has a reasonable anchor
        return {
            x: Math.min(Math.max(x, rect.left + 8), rect.right - 8),
            y: Math.min(Math.max(y, rect.top + 8), rect.bottom - 8)
        };
    }

    // ── Mouse hover on editor ─────────────────────────────────────────────────
    function _onEditorMouseMove(e) {
        _mouseX = e.clientX;
        _mouseY = e.clientY;
        clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(function() {
            _processHover(e.target, _mouseX, _mouseY);
        }, 450);
    }

    function _processHover(textarea, x, y) {
        if (!textarea || textarea.id !== 'asmEditor') return;
        if (typeof API_INDEX === 'undefined') return;

        const offset = _charOffsetFromMouse(textarea, x, y);
        const token = _tokenAt(textarea.value, offset);
        if (!token) { _hidePopup(); return; }
        if (token === _currentToken) return;

        const entry = apiLookupToken(token);
        if (!entry) {
            _hidePopup();
            return;
        }
        _currentToken = token;
        _showPopup(entry, x, y);
    }

    function _onEditorMouseLeave() {
        clearTimeout(_hoverTimer);
        setTimeout(_hidePopup, 150);
    }

    // ── Keyboard: show popup when cursor rests on a known token ───────────────
    function _onEditorKeyUp(e) {
        if (e.key === 'Escape') { _hidePopup(); return; }
        clearTimeout(_hoverTimer);
        _hoverTimer = setTimeout(function() {
            _processKeyPos(e.target);
        }, 600);
    }

    function _processKeyPos(textarea) {
        if (!textarea || textarea.id !== 'asmEditor') return;
        if (typeof API_INDEX === 'undefined') return;
        const offset = textarea.selectionStart;
        const token = _tokenAt(textarea.value, offset);
        if (!token) { _hidePopup(); return; }
        const entry = apiLookupToken(token);
        if (!entry) { _hidePopup(); return; }
        if (token === _currentToken) return;
        _currentToken = token;

        // Compute caret pixel position so popup appears near the active token.
        // Falls back to below the top-left of the editor if measurement fails.
        const caretPos = _caretPixelPos(textarea, offset);
        _showPopup(entry, caretPos.x, caretPos.y);
    }

    // ── Global dismiss ─────────────────────────────────────────────────────────
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') _hidePopup();
    });
    document.addEventListener('click', function(e) {
        const popup = document.getElementById('apiPopup');
        if (popup && popup.style.display !== 'none') {
            if (!popup.contains(e.target)) _hidePopup();
        }
    });

    // ── Attach to editor once it exists ──────────────────────────────────────
    function _attachToEditor() {
        const ta = document.getElementById('asmEditor');
        if (!ta) return;
        ta.addEventListener('mousemove', _onEditorMouseMove);
        ta.addEventListener('mouseleave', _onEditorMouseLeave);
        ta.addEventListener('keyup', _onEditorKeyUp);
        ta.addEventListener('scroll', _hidePopup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _attachToEditor);
    } else {
        _attachToEditor();
    }

    // Re-attach if editor is ever recreated
    window._reattachApiPopup = _attachToEditor;
})();
