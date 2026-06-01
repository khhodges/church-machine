var _activeAsmErrors = [];
var _activeAsmWarnings = [];

function _showCompileFailedBanner(count) {
    var banner = document.getElementById('compileFailedBanner');
    var text   = document.getElementById('compileFailedBannerText');
    if (!banner) return;
    if (text) text.textContent = '\u2716 COMPILE FAILED \u2014 ' + count + ' error' + (count !== 1 ? 's' : '');
    banner.style.display = 'flex';
}

function _hideCompileFailedBanner() {
    var banner = document.getElementById('compileFailedBanner');
    if (banner) banner.style.display = 'none';
}

var _asmAdvisoryPopupEl = null;
var _asmAdvisoryKeydownBound = false;

function _dismissAsmAdvisoryPopup() {
    if (_asmAdvisoryPopupEl && _asmAdvisoryPopupEl.parentNode) {
        _asmAdvisoryPopupEl.parentNode.removeChild(_asmAdvisoryPopupEl);
    }
    _asmAdvisoryPopupEl = null;
}

function _showAsmAdvisoryPopup(entry, isWarning, anchorX, anchorY) {
    _dismissAsmAdvisoryPopup();
    if (!entry) return;

    var popup = document.createElement('div');
    popup.className = 'asm-advisory-popup' + (isWarning ? ' is-warning' : '');
    _asmAdvisoryPopupEl = popup;

    var sugg = (typeof _getSyntaxSuggestion === 'function') ? _getSyntaxSuggestion(entry.message) : null;

    var headerHtml = '<div class="asm-advisory-popup-header">'
        + '<span class="asm-advisory-popup-msg">' + _escHtml(entry.message || '') + '</span>'
        + '<button type="button" class="asm-advisory-popup-dismiss" title="Dismiss">\u00d7</button>'
        + '</div>';

    var suggHtml = '';
    if (sugg) {
        suggHtml = '<div class="asm-advisory-popup-sugg">'
            + '<div class="asm-advisory-popup-sugg-title">&#x1F4A1; ' + _escHtml(sugg.title) + '</div>'
            + '<div class="asm-advisory-popup-sugg-body">' + _escHtml(sugg.body) + '</div>'
            + '<pre class="asm-advisory-popup-sugg-code">' + _escHtml(sugg.example) + '</pre>'
            + '</div>';
    }

    var footerHtml = '';
    if (entry.line != null && !isNaN(entry.line)) {
        footerHtml = '<div class="asm-advisory-popup-footer">'
            + '<button type="button" class="asm-advisory-popup-jump" data-line="' + entry.line + '">Jump to error in panel \u2193</button>'
            + '</div>';
    }

    popup.innerHTML = headerHtml + suggHtml + footerHtml;
    document.body.appendChild(popup);

    var vpW = window.innerWidth, vpH = window.innerHeight;
    var px = Math.min(anchorX + 10, vpW - 440);
    var py = anchorY + 20;
    if (py + 260 > vpH) py = Math.max(4, anchorY - 270);
    popup.style.left = Math.max(4, px) + 'px';
    popup.style.top  = Math.max(4, py) + 'px';

    popup.querySelector('.asm-advisory-popup-dismiss').addEventListener('click', function() {
        _dismissAsmAdvisoryPopup();
    });

    var jumpBtn = popup.querySelector('.asm-advisory-popup-jump');
    if (jumpBtn) {
        jumpBtn.addEventListener('click', function() {
            var ln = parseInt(jumpBtn.getAttribute('data-line'), 10);
            if (typeof _jumpToAsmLine === 'function') _jumpToAsmLine(ln);
            _dismissAsmAdvisoryPopup();
            var panel = document.getElementById('asmErrorPanel');
            if (!panel) panel = document.getElementById('asmWarningPanel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    popup.addEventListener('mouseleave', function() {
        _dismissAsmAdvisoryPopup();
    });
}

// ── Sticky Patches ────────────────────────────────────────────────────────
// Keyed by nsIdx. Each entry: { words, newCW, nsIdx, crIdx, src }.
// Re-applied automatically after every boot sequence completes.
var _stickyPatches = {};

// ── Editor source persistence (localStorage, keyed by NS slot) ────────────
// #asmEditor source is auto-saved on every keystroke, keyed by NS slot, so
// it survives CR-panel switches and page refresh.  The patch → test → edit
// loop therefore never loses in-flight source.
// Sticky patches are also serialised to localStorage so they survive refresh
// and are re-applied automatically on the next boot.
var _asmEditorNsIdx = null;   // NS slot currently "owned" by #asmEditor

function _asmSrcKey(nsIdx)    { return 'cm_asm_src_'  + nsIdx; }
function _asmStickyKey(nsIdx) { return 'cm_sticky_p_' + nsIdx; }

function _asmSrcSave(nsIdx, text) {
    if (nsIdx === null || nsIdx === undefined) return;
    try { localStorage.setItem(_asmSrcKey(nsIdx), text || ''); } catch(_) {}
}
function _asmSrcLoad(nsIdx) {
    try { return localStorage.getItem(_asmSrcKey(nsIdx)); } catch(_) { return null; }
}

// Switch the editor's "owned" NS slot.  Flushes the outgoing slot's source
// to localStorage, then restores the incoming slot's source
// (localStorage → sticky-patch src fallback → leave blank for a fresh CR).
// Called by updateCRDetail() on every CR selection change.
function _asmSrcSwitchContext(newNsIdx) {
    const ed = document.getElementById('asmEditor');
    if (!ed) return;
    // Flush outgoing slot before switching.
    if (_asmEditorNsIdx !== null && _asmEditorNsIdx !== newNsIdx) {
        _asmSrcSave(_asmEditorNsIdx, ed.value);
    }
    _asmEditorNsIdx = newNsIdx;
    if (newNsIdx === null) return;
    // Restore incoming slot.
    const saved = _asmSrcLoad(newNsIdx);
    if (saved !== null) {
        ed.value = saved;
    } else {
        const sp = _stickyPatches[newNsIdx];
        if (sp && sp.src) ed.value = sp.src;
        // else leave editor as-is (blank for a fresh CR, unchanged for same CR)
    }
}

function _persistStickyPatch(nsIdx) {
    const p = _stickyPatches[nsIdx];
    if (!p) return;
    try { localStorage.setItem(_asmStickyKey(nsIdx), JSON.stringify(p)); } catch(_) {}
}

function _clearPersistedStickyPatch(nsIdx) {
    try { localStorage.removeItem(_asmStickyKey(nsIdx)); } catch(_) {}
    // If the editor currently owns this slot, also wipe the source draft and
    // blank the editor — the user explicitly cleared the patch, so they want
    // a clean slate.
    if (_asmEditorNsIdx === nsIdx) {
        try { localStorage.removeItem(_asmSrcKey(nsIdx)); } catch(_) {}
        const ed = document.getElementById('asmEditor');
        if (ed) ed.value = '';
    }
}

// Restore sticky patches persisted from a previous session.  Runs once at
// script load so _reapplyStickyPatches() (called at boot) can find them.
(function _restorePersistedStickyPatches() {
    try {
        const PREFIX = 'cm_sticky_p_';
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIX)) {
                try {
                    const p = JSON.parse(localStorage.getItem(k));
                    if (p && typeof p.nsIdx === 'number' && Array.isArray(p.words)) {
                        _stickyPatches[p.nsIdx] = p;
                    }
                } catch(_) {}
            }
        }
    } catch(_) {}
})();

// Wire up keystroke auto-save once the DOM is ready.
document.addEventListener('DOMContentLoaded', function() {
    var ed = document.getElementById('asmEditor');
    if (ed) {
        ed.addEventListener('input', function() {
            _asmSrcSave(_asmEditorNsIdx, ed.value);
            _hideCompileFailedBanner();
            _dismissAsmAdvisoryPopup();
        });

        ed.addEventListener('keydown', function() {
            _dismissAsmAdvisoryPopup();
        });

        ed.addEventListener('click', function(ev) {
            var lines = ed.value.split('\n');
            var pos = ed.selectionStart;
            var lineNum = 1;
            var counted = 0;
            for (var i = 0; i < lines.length; i++) {
                counted += lines[i].length + 1;
                if (counted > pos) { lineNum = i + 1; break; }
            }

            var errorEntry = null;
            var isWarning = false;
            for (var ei = 0; ei < _activeAsmErrors.length; ei++) {
                if (_activeAsmErrors[ei].line === lineNum) {
                    errorEntry = _activeAsmErrors[ei];
                    break;
                }
            }
            if (!errorEntry) {
                for (var wi = 0; wi < _activeAsmWarnings.length; wi++) {
                    if (_activeAsmWarnings[wi].line === lineNum) {
                        errorEntry = _activeAsmWarnings[wi];
                        isWarning = true;
                        break;
                    }
                }
            }

            if (errorEntry) {
                _showAsmAdvisoryPopup(errorEntry, isWarning, ev.clientX, ev.clientY);
            } else {
                _dismissAsmAdvisoryPopup();
            }
        });
    }
});

function _jumpToAsmLine(lineNum) {
    var editor = document.getElementById('asmEditor');
    if (!editor || !lineNum) return;
    var lines = editor.value.split('\n');
    var targetLine = Math.max(1, Math.min(lineNum, lines.length));
    var offset = 0;
    for (var i = 0; i < targetLine - 1; i++) {
        offset += lines[i].length + 1;
    }
    editor.focus();
    // Position cursor at start of the line without selecting text —
    // a full-line selection would show as blue and fight the red error overlay.
    editor.setSelectionRange(offset, offset);
    var style = getComputedStyle(editor);
    var lineHeight = parseFloat(style.lineHeight) || 19.2;
    var paddingTop = parseFloat(style.paddingTop) || 0;
    var targetScrollTop = paddingTop + (targetLine - 1) * lineHeight - editor.clientHeight / 3;
    editor.scrollTop = Math.max(0, targetScrollTop);
    var overlay = document.getElementById('asmErrorOverlay');
    if (overlay) {
        overlay.scrollTop = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
    }
    var warnOverlay = document.getElementById('asmWarningOverlay');
    if (warnOverlay) {
        warnOverlay.scrollTop = editor.scrollTop;
        warnOverlay.scrollLeft = editor.scrollLeft;
    }
}

function _getSyntaxSuggestion(msg) {
    if (!msg) return null;
    var OPCODES = 'LOAD · SAVE · CALL · RETURN · CHANGE · SWITCH · TPERM · LAMBDA · DREAD · DWRITE · BFEXT · BFINS · MCMP · IADD · ISUB · BRANCH · SHL · SHR · ELOADCALL · XLOADLAMBDA';

    if (/don.t recognis|don.t recognize|unrecognized.*opcode/i.test(msg)) {
        var m1 = msg.match(/"([^"]+)"/);
        var bad = m1 ? m1[1] : 'this word';
        return {
            title: 'Unknown instruction',
            body: '<strong>' + _escHtml(bad) + '</strong> is not a valid opcode. Did you mean one of these?',
            example: OPCODES + '\n\nExamples:\n  LOAD   CR1, CR0, #5   ; load abstraction\n  CALL   CR1, CR0, #0   ; call method 0\n  DREAD  DR2, CR3, #0   ; read data register\n  BRANCH #MyLabel        ; jump to label\n  RETURN CR0             ; return from method'
        };
    }
    if (/is a DR alias.*expected a CR/i.test(msg)) {
        return {
            title: 'Use a CR here, not a DR',
            body: 'This instruction needs a <strong>capability register</strong> (CR0–CR15). Data registers (DR0–DR15) hold plain values; CRs hold Golden Tokens.',
            example: 'LOAD   CR1, CR0, #5   ; CR in every position\nCALL   CR1, CR0, #0   ; CR as destination and source\nSWITCH CR8            ; CR only'
        };
    }
    if (/is a CR alias.*expected a DR/i.test(msg)) {
        return {
            title: 'Use a DR here, not a CR',
            body: 'This instruction needs a <strong>data register</strong> (DR0–DR15). DRs hold 32-bit integers; CRs hold capabilities.',
            example: 'DREAD  DR2, CR3, #0   ; DR as destination\nDWRITE DR1, CR4, #0   ; DR as source\nIADD   DR0, DR1, #10  ; DR arithmetic'
        };
    }
    if (/label.*is not defined|define it with.*:/i.test(msg)) {
        var m2 = msg.match(/"([^"]+)"/);
        var lbl = m2 ? m2[1] : 'MyLabel';
        return {
            title: 'Label not defined',
            body: 'Labels must be declared with a colon before you can branch to them.',
            example: _escHtml(lbl) + ':               ; ← declare the label\n    DREAD  DR1, CR3, #0\n    IADD   DR1, DR1, #1\n    BRANCH #' + _escHtml(lbl) + '   ; ← jump to it'
        };
    }
    if (/not a known method|no method conventions/i.test(msg)) {
        return {
            title: 'Unknown method name',
            body: 'The dot-name you used doesn\'t match any registered method. Use a numeric selector (0–15) or check the abstraction\'s C-list.',
            example: 'CALL   CR1, CR0, #0          ; numeric selector\nCALL   CR11, SlideRule.Multiply  ; dot-notation\nCALL   CR11, SlideRule.Divide    ; known methods only'
        };
    }
    if (/has not been loaded.*LOAD/i.test(msg)) {
        return {
            title: 'Abstraction not loaded into a CR',
            body: 'You must LOAD an abstraction from the C-list into a CR before you can CALL or use dot-notation with it.',
            example: 'LOAD   CR1, CR0, #5   ; load from C-list slot 5 into CR1\nCALL   CR1, CR0, #0   ; then call its method 0'
        };
    }
    if (/privilege zone|priv.*zone|CR1[2-5].*reserved|reserved.*CR1[2-5]/i.test(msg)) {
        return {
            title: 'CR12–CR15 are reserved',
            body: 'CR12, CR13, and CR15 are managed by the OS — user code cannot reference them.\nCR14 (Current-Lump) is the one exception: it has read+execute permission, so DREAD DR, CR14, offset is valid and lets your code read embedded data constants from the code lump.',
            example: 'LOAD   CR1, CR0, #5      ; CR0–CR11 are always safe\nDREAD  DR0, CR14, #2     ; OK — reads a constant from the code lump'
        };
    }
    if (/capability register.*needed.*nothing|nothing was given.*capability/i.test(msg)) {
        return {
            title: 'Missing capability register operand',
            body: 'This instruction expects a CR operand (CR0–CR15) but none was supplied.',
            example: 'LOAD   CR1, CR0, #5\nCALL   CR0, CR1, #0\nRETURN CR0'
        };
    }
    if (/invalid \.pet syntax|pet syntax/i.test(msg)) {
        return {
            title: '.pet alias syntax',
            body: '<code>.pet</code> creates a friendly name for a register.',
            example: '.pet result  DR1    ; alias DR1 as "result"\n.pet ledSlot CR11  ; alias CR11 as "ledSlot"\n\nDREAD  result, ledSlot, #0'
        };
    }
    if (/defined more than once|duplicate label/i.test(msg)) {
        return {
            title: 'Duplicate label name',
            body: 'Each label must have a unique name. Rename one of them.',
            example: 'loopA:\n    BRANCH #loopA\nloopB:\n    BRANCH #loopB'
        };
    }
    if (/no abstraction declaration|Expected:.*abstraction/i.test(msg)) {
        return {
            title: 'Missing abstraction declaration',
            body: 'CLOOMC++ files must start with <code>abstraction Name { ... }</code>.',
            example: 'abstraction MyCounter {\n    method Increment() {\n        Write 1 to the result\n    }\n}'
        };
    }
    if (/let binding uses = not ==/i.test(msg)) {
        return {
            title: 'Assignment uses = not ==',
            body: 'In CLOOMC++ Haskell mode, <code>let</code> bindings use a single <code>=</code>, not <code>==</code>.',
            example: 'let x = 5\nlet y = x + 3'
        };
    }
    if (/undefined.*variable|undefined variable/i.test(msg)) {
        var m3 = msg.match(/:\s*(\w+)/);
        var varName = m3 ? m3[1] : 'x';
        return {
            title: 'Undefined variable',
            body: 'The variable <code>' + _escHtml(varName) + '</code> was used before it was declared.',
            example: 'let ' + _escHtml(varName) + ' = 0     ; declare before using\nlet result = ' + _escHtml(varName) + ' + 1'
        };
    }
    if (/cannot compile statement|cannot parse.*statement/i.test(msg)) {
        return {
            title: 'Unrecognised statement',
            body: 'This line couldn\'t be compiled. Check the language you\'ve selected in the dropdown.',
            example: '/* JavaScript / CLOOMC++ */\nabstraction MyIdea {\n    method DoSomething() {\n        Write 1 to the result\n    }\n}'
        };
    }
    if (/cannot understand/i.test(msg)) {
        return {
            title: 'Unrecognised English statement',
            body: 'The underlined word starts a statement the English compiler doesn\'t recognise. Try one of the forms below, or switch to the Reference tab for the full vocabulary.',
            example: '-- Sentence form:\nSet result to x plus y\nIf x is greater than y:\n  Return x\nReturn the result\n\n-- Block form:\nMyMethod(x, y):\n    set result to x plus y\n    return result'
        };
    }
    if (/Expected a capability register like CR0/i.test(msg)) {
        return {
            title: 'Expected a capability register',
            body: 'Provide a CR argument like <code>CR0</code>, <code>CR1</code>, … <code>CR11</code>.',
            example: 'LOAD   CR1, CR0, #5   ; valid CR operands\nCALL   CR2, CR1, #0'
        };
    }
    if (/Expected a data register like DR0/i.test(msg)) {
        return {
            title: 'Expected a data register',
            body: 'Provide a DR argument like <code>DR0</code>, <code>DR1</code>, … <code>DR15</code>.',
            example: 'DREAD  DR0, CR3, #0   ; valid DR operands\nIADD   DR1, DR0, #1'
        };
    }
    if (/is out of range for a 32-bit Church Machine register/i.test(msg)) {
        var litMatch = msg.match(/Literal\s+(-?\d+)/);
        var badLit = litMatch ? litMatch[1] : 'the value';
        return {
            title: 'Literal too large for a 32-bit register',
            body: 'Church Machine registers hold signed 32-bit integers. <strong>' + _escHtml(badLit) + '</strong> does not fit. Use a value between <code>-2147483648</code> and <code>2147483647</code>.',
            example: 'let x = 2147483647   -- largest positive 32-bit value\nlet y = -2147483648  -- most negative 32-bit value\nlet z = 0x7FFF       -- small hex literals are fine'
        };
    }
    return null;
}

function _showAsmErrors(errors, titleOverride) {
    var panel = document.getElementById('asmErrorPanel');
    if (!panel) return;
    if (!errors || errors.length === 0) { _clearAsmErrors(); return; }
    var count = errors.length;
    var title = titleOverride || ('Assembly error' + (count > 1 ? 's' : '') + ' \u2014 code not applied');
    var html = '<div class="asm-error-panel-header">'
             + '<span class="asm-error-panel-icon">&#x26A0;</span>'
             + '<span class="asm-error-panel-title">' + _escHtml(title) + '</span>'
             + '</div>'
             + '<ul class="asm-error-panel-list">';
    errors.forEach(function(e) {
        var sugg = _getSyntaxSuggestion(e.message);
        var hasLine = e.line != null && !isNaN(e.line);
        if (hasLine) {
            html += '<li>'
                  + '<button type="button" class="asm-error-item" data-line="' + e.line + '" title="Jump to line ' + e.line + '">'
                  + '<span class="asm-error-line">Line ' + e.line + ':</span>' + _escHtml(e.message)
                  + '</button>';
        } else {
            html += '<li>'
                  + '<span class="asm-error-item asm-error-item-noline">'
                  + _escHtml(e.message)
                  + '</span>';
        }
        if (sugg) {
            var absMatch = e.message.match(/(?:on|for) ['"]([^'"]+)['"]/i);
            var absName = absMatch ? absMatch[1] : null;
            var pickBtn = '';
            if (absName && typeof apiLookupByName !== 'undefined' && apiLookupByName(absName)) {
                pickBtn = '<button type="button" class="asm-error-pick-btn"'
                    + ' data-abs="' + _escHtml(absName) + '"'
                    + (e.colStart != null ? ' data-col-start="' + e.colStart + '"' : '')
                    + (e.colEnd   != null ? ' data-col-end="'   + e.colEnd   + '"' : '')
                    + (e.line     != null ? ' data-line-pick="'  + e.line     + '"' : '')
                    + '>Browse ' + _escHtml(absName) + ' methods \u2192</button>';
            }
            html += '<div class="asm-error-suggestion">'
                  + '<div class="aes-title">&#x1F4A1; ' + sugg.title + '</div>'
                  + '<div class="aes-body">' + sugg.body + '</div>'
                  + '<pre class="aes-example">' + _escHtml(sugg.example) + '</pre>'
                  + pickBtn
                  + '</div>';
        }
        html += '</li>';
    });
    html += '</ul>';
    panel.innerHTML = html;
    panel.querySelectorAll('.asm-error-item[data-line]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            _jumpToAsmLine(parseInt(btn.getAttribute('data-line'), 10));
        });
    });
    panel.querySelectorAll('.asm-error-pick-btn').forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var absName  = btn.getAttribute('data-abs');
            var linePick = parseInt(btn.getAttribute('data-line-pick'), 10);
            var colStart = parseInt(btn.getAttribute('data-col-start'), 10);
            var colEnd   = parseInt(btn.getAttribute('data-col-end'),   10);
            if (typeof window._showApiPopupForAbs === 'function') {
                window._showApiPopupForAbs(absName, btn, function(methodName) {
                    var editor = document.getElementById('asmEditor');
                    if (!editor) return;
                    if (!isNaN(linePick) && !isNaN(colStart) && !isNaN(colEnd)) {
                        var lines = editor.value.split('\n');
                        var idx = linePick - 1;
                        if (lines[idx] !== undefined) {
                            lines[idx] = lines[idx].slice(0, colStart) + methodName + lines[idx].slice(colEnd);
                            editor.value = lines.join('\n');
                            if (typeof _clearAsmErrors === 'function') _clearAsmErrors();
                            if (typeof assembleAndLoad === 'function') assembleAndLoad();
                        }
                    }
                });
            }
        });
    });
    panel.style.display = 'flex';
    _activeAsmErrors = errors.slice();
    _highlightAsmErrorLines(errors);
    _showCompileFailedBanner(errors.length);
}

function _clearAsmErrors() {
    var panel = document.getElementById('asmErrorPanel');
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
    _activeAsmErrors = [];
    _highlightAsmErrorLines([]);
    _hideCompileFailedBanner();
}

function _highlightAsmErrorLines(errors) {
    document.querySelectorAll('#lineNumbers span.line-num-error').forEach(function(el) {
        el.classList.remove('line-num-error');
    });

    var overlay = document.getElementById('asmErrorOverlay');
    if (overlay) overlay.innerHTML = '';

    if (!errors || errors.length === 0) return;

    var minLine = null;
    errors.forEach(function(e) {
        if (!e.line) return;
        var span = document.getElementById('ln-' + e.line);
        if (span) span.classList.add('line-num-error');
        if (minLine === null || e.line < minLine) minLine = e.line;
    });

    var editor = document.getElementById('asmEditor');
    if (editor && overlay) {
        var style = getComputedStyle(editor);
        var lineHeight = parseFloat(style.lineHeight) || 19.2;
        var paddingTop = parseFloat(style.paddingTop) || 0;
        var paddingLeft = parseFloat(style.paddingLeft) || 0;
        var totalLines = editor.value.split('\n').length;
        var sourceLines = editor.value.split('\n');

        // Measure monospace character width via canvas using the editor's computed font.
        var charWidth = 0;
        try {
            var _cvs = document.createElement('canvas');
            var _ctx = _cvs.getContext('2d');
            _ctx.font = style.fontSize + ' ' + (style.fontFamily || "'Courier New', monospace");
            charWidth = _ctx.measureText('M').width;
        } catch (_ex) { charWidth = 0; }

        // Compute the minimum inner width so underlines on long lines stay
        // within the scrollable content and aren't clipped.
        var maxLineLen = 0;
        sourceLines.forEach(function(l) { if (l.length > maxLineLen) maxLineLen = l.length; });
        var innerMinWidth = paddingLeft + maxLineLen * charWidth + paddingLeft;

        var inner = document.createElement('div');
        inner.className = 'asm-error-overlay-inner';
        inner.style.height = (paddingTop * 2 + totalLines * lineHeight) + 'px';
        if (charWidth > 0) inner.style.minWidth = innerMinWidth + 'px';

        // Pass 1: one background bar per unique line.
        var seenLines = {};
        errors.forEach(function(e) {
            if (!e.line || seenLines[e.line]) return;
            seenLines[e.line] = true;
            var bgDiv = document.createElement('div');
            bgDiv.className = 'asm-error-line-bg';
            bgDiv.style.top = (paddingTop + (e.line - 1) * lineHeight) + 'px';
            bgDiv.style.height = lineHeight + 'px';
            inner.appendChild(bgDiv);
        });

        // Pass 2: one underline per error (multiple errors on the same line each
        // get their own underline, so every offending token is marked).
        errors.forEach(function(e) {
            if (!e.line || !charWidth || e.line > sourceLines.length) return;

            var lineText = sourceLines[e.line - 1] || '';
            var lineTop = paddingTop + (e.line - 1) * lineHeight;
            var colStart = 0, colEnd = 0;

            if (e.colStart !== undefined && e.colEnd !== undefined) {
                // Compiler/assembler-supplied precise column range (assembly, English,
                // JavaScript, Haskell, Symbolic Math, Lambda Calculus) — use directly.
                colStart = e.colStart;
                colEnd   = e.colEnd;
            } else {
                // Legacy fallback: try to locate the quoted token from the error message.
                var tokenFound = false;
                if (e.message) {
                    var qm = e.message.match(/"([^"]+)"/);
                    if (qm) {
                        var tok = qm[1];
                        var idx = lineText.indexOf(tok);
                        if (idx < 0) idx = lineText.toUpperCase().indexOf(tok.toUpperCase());
                        if (idx >= 0) {
                            colStart = idx;
                            colEnd = idx + tok.length;
                            tokenFound = true;
                        }
                    }
                }
                if (!tokenFound) {
                    // Last resort: underline from first non-whitespace to end of non-comment content.
                    var strippedLine = lineText.replace(/;.*$/, '').replace(/\s+$/, '');
                    var firstNonWs = strippedLine.search(/\S/);
                    colStart = firstNonWs >= 0 ? firstNonWs : 0;
                    colEnd = strippedLine.length;
                }
            }

            if (colEnd > colStart) {
                var ulDiv = document.createElement('div');
                ulDiv.className = 'asm-error-underline';
                ulDiv.style.top = (lineTop + lineHeight - 3) + 'px';
                ulDiv.style.left = (paddingLeft + colStart * charWidth) + 'px';
                ulDiv.style.width = ((colEnd - colStart) * charWidth) + 'px';
                inner.appendChild(ulDiv);
            }
        });

        overlay.appendChild(inner);
        overlay.scrollTop = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
    }

    if (minLine && editor) {
        var style2 = getComputedStyle(editor);
        var lineHeight2 = parseFloat(style2.lineHeight) || 19.2;
        var paddingTop2 = parseFloat(style2.paddingTop) || 0;
        var targetScrollTop = paddingTop2 + (minLine - 1) * lineHeight2 - editor.clientHeight / 3;
        editor.scrollTop = Math.max(0, targetScrollTop);
        if (overlay) {
            overlay.scrollTop = editor.scrollTop;
            overlay.scrollLeft = editor.scrollLeft;
        }
        var warnOvl2 = document.getElementById('asmWarningOverlay');
        if (warnOvl2) {
            warnOvl2.scrollTop = editor.scrollTop;
            warnOvl2.scrollLeft = editor.scrollLeft;
        }
    }
}

function _highlightAsmWarningLines(warnings) {
    document.querySelectorAll('#lineNumbers span.line-num-warning').forEach(function(el) {
        el.classList.remove('line-num-warning');
    });

    var overlay = document.getElementById('asmWarningOverlay');
    if (overlay) overlay.innerHTML = '';

    if (!warnings || warnings.length === 0) return;

    warnings.forEach(function(w) {
        if (!w.line) return;
        var span = document.getElementById('ln-' + w.line);
        if (span) span.classList.add('line-num-warning');
    });

    var editor = document.getElementById('asmEditor');
    if (editor && overlay) {
        var style = getComputedStyle(editor);
        var lineHeight = parseFloat(style.lineHeight) || 19.2;
        var paddingTop = parseFloat(style.paddingTop) || 0;
        var paddingLeft = parseFloat(style.paddingLeft) || 0;
        var totalLines = editor.value.split('\n').length;
        var sourceLines = editor.value.split('\n');

        var charWidth = 0;
        try {
            var _cvs = document.createElement('canvas');
            var _ctx = _cvs.getContext('2d');
            _ctx.font = style.fontSize + ' ' + (style.fontFamily || "'Courier New', monospace");
            charWidth = _ctx.measureText('M').width;
        } catch (_ex) { charWidth = 0; }

        var maxLineLen = 0;
        sourceLines.forEach(function(l) { if (l.length > maxLineLen) maxLineLen = l.length; });
        var innerMinWidth = paddingLeft + maxLineLen * charWidth + paddingLeft;

        var inner = document.createElement('div');
        inner.className = 'asm-warning-overlay-inner';
        inner.style.height = (paddingTop * 2 + totalLines * lineHeight) + 'px';
        if (charWidth > 0) inner.style.minWidth = innerMinWidth + 'px';

        var seenLines = {};
        warnings.forEach(function(w) {
            if (!w.line || seenLines[w.line]) return;
            seenLines[w.line] = true;
            var bgDiv = document.createElement('div');
            bgDiv.className = 'asm-warning-line-bg';
            bgDiv.style.top = (paddingTop + (w.line - 1) * lineHeight) + 'px';
            bgDiv.style.height = lineHeight + 'px';
            inner.appendChild(bgDiv);
        });

        warnings.forEach(function(w) {
            if (!w.line || !charWidth || w.line > sourceLines.length) return;

            var lineText = sourceLines[w.line - 1] || '';
            var lineTop = paddingTop + (w.line - 1) * lineHeight;
            var colStart = 0, colEnd = 0;

            if (w.colStart !== undefined && w.colEnd !== undefined) {
                // Assembler-supplied precise column range — use directly.
                colStart = w.colStart;
                colEnd   = w.colEnd;
            } else {
                // Fallback: try to locate the quoted token from the warning message.
                var tokenFound = false;
                if (w.message) {
                    var qm = w.message.match(/"([^"]+)"/);
                    if (qm) {
                        var tok = qm[1];
                        var idx = lineText.indexOf(tok);
                        if (idx < 0) idx = lineText.toUpperCase().indexOf(tok.toUpperCase());
                        if (idx >= 0) {
                            colStart = idx;
                            colEnd = idx + tok.length;
                            tokenFound = true;
                        }
                    }
                }
                if (!tokenFound) {
                    // Last resort: underline from first non-whitespace to end of non-comment content.
                    var strippedLine = lineText.replace(/;.*$/, '').replace(/\s+$/, '');
                    var firstNonWs = strippedLine.search(/\S/);
                    colStart = firstNonWs >= 0 ? firstNonWs : 0;
                    colEnd = strippedLine.length;
                }
            }

            if (colEnd > colStart) {
                var ulDiv = document.createElement('div');
                ulDiv.className = 'asm-warning-underline';
                ulDiv.style.top = (lineTop + lineHeight - 3) + 'px';
                ulDiv.style.left = (paddingLeft + colStart * charWidth) + 'px';
                ulDiv.style.width = ((colEnd - colStart) * charWidth) + 'px';
                inner.appendChild(ulDiv);
            }
        });

        overlay.appendChild(inner);
        overlay.scrollTop = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
    }
}

function _updateAsmWarnBadge(count) {
    var badge = document.getElementById('asmWarnBadge');
    var badgeCount = document.getElementById('asmWarnBadgeCount');
    if (!badge) return;
    if (count > 0) {
        if (badgeCount) badgeCount.textContent = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
        if (badgeCount) badgeCount.textContent = '';
    }
    if (!badge._warnClickBound) {
        badge._warnClickBound = true;
        badge.addEventListener('click', function() {
            var panel = document.getElementById('asmWarningPanel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }
}

function _showAsmWarnings(warnings) {
    var panel = document.getElementById('asmWarningPanel');
    if (!warnings || warnings.length === 0) { _clearAsmWarnings(); return; }
    _activeAsmWarnings = warnings.slice();
    _highlightAsmWarningLines(warnings);
    _updateAsmWarnBadge(warnings.length);
    if (!panel) return;
    var count = warnings.length;
    var title = 'Warning' + (count > 1 ? 's' : '') + ' \u2014 ' + count + ' issue' + (count > 1 ? 's' : '') + ' to review';
    var html = '<div class="asm-warning-panel-header">'
             + '<span class="asm-warning-panel-icon">&#x26A0;</span>'
             + '<span class="asm-warning-panel-title">' + _escHtml(title) + '</span>'
             + '</div>'
             + '<ul class="asm-warning-panel-list">';
    warnings.forEach(function(w) {
        var hasLine = w.line != null && !isNaN(w.line);
        if (hasLine) {
            html += '<li>'
                  + '<button type="button" class="asm-warning-item" data-line="' + w.line + '" title="Jump to line ' + w.line + '">'
                  + '<span class="asm-warning-line-label">Line ' + w.line + ':</span>' + _escHtml(w.message)
                  + '</button>'
                  + '</li>';
        } else {
            html += '<li>'
                  + '<span class="asm-warning-item asm-warning-item-noline">'
                  + _escHtml(w.message)
                  + '</span>'
                  + '</li>';
        }
    });
    html += '</ul>';
    panel.innerHTML = html;
    panel.querySelectorAll('.asm-warning-item[data-line]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            _jumpToAsmLine(parseInt(btn.getAttribute('data-line'), 10));
        });
    });
    panel.style.display = 'flex';
}

function _clearAsmWarnings() {
    var panel = document.getElementById('asmWarningPanel');
    if (panel) {
        panel.style.display = 'none';
        panel.innerHTML = '';
    }
    _activeAsmWarnings = [];
    _highlightAsmWarningLines([]);
    _updateAsmWarnBadge(0);
}

function _updateEditorPatchBar() {
    var bar = document.getElementById('editorPatchBar');
    if (!bar) return;
    if (_editorCREditActive && _editorCREditCR !== null) {
        bar.style.display = 'flex';
        var label = document.getElementById('editorPatchLabel');
        if (label) label.textContent = 'Editing CR' + _editorCREditCR + ' \u00B7 NS[' + _editorCREditNS + ']';
    } else {
        bar.style.display = 'none';
    }
}

function clearEditorCREdit() {
    _editorCREditActive = false;
    _editorCREditCR = null;
    _editorCREditNS = null;
    _clearAsmErrors();
    _clearAsmWarnings();
    _updateEditorPatchBar();
    var asmEd = document.getElementById('asmEditor');
    if (asmEd) asmEd.value = '';
    var outputEl = document.getElementById('assemblyOutput');
    if (outputEl) outputEl.innerHTML = '';
    document.querySelectorAll('.example-tab').forEach(function(t) { t.classList.remove('active'); });
    renderUserTabs();
    updateSaveUserTabBtn();
    var sel = document.getElementById('langSelector');
    if (sel) showIntro(sel.value);
}

function injectCRCode(logEl) {
    const log = msg => { if (logEl) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; } };

    if (selectedCR === null) { log('Error: No CR selected.'); return null; }
    const crIdx = selectedCR;
    const cr = sim.getFormattedCR(crIdx);
    const baseLoc = cr.word1_location >>> 0;
    const nsIdx = cr.gtIndex;

    const src = (document.getElementById('asmEditor') || {}).value || '';
    if (!src.trim()) { log('Editor is empty — type or paste your code first, then click Patch.'); return null; }

    let newWords, newCW;
    let petNameCaps = null;

    const compiler = new CLOOMCCompiler();
    if (compiler._detectPetName(src)) {
        log('Pet-name expression mode detected.');
        const compResult = compiler.compilePetName(src, []);
        if (compResult.errors && compResult.errors.length > 0) {
            log('Pet-name compilation failed:');
            compResult.errors.forEach(e => log(`  Line ${e.line}: ${e.message}`));
            return null;
        }
        const allCode = [];
        for (const m of compResult.methods) {
            if (m.code) allCode.push(...m.code);
        }
        newWords = allCode;
        newCW = newWords.length;
        if (compResult._neededCaps && compResult._neededCaps.length > 0) {
            petNameCaps = compResult._neededCaps;
        }
        _petNameDRMap = compResult._petNameDR || {};
        _petNameCRMap = compResult._petNameCR || {};
        log(`Compiled ${newCW} instruction${newCW !== 1 ? 's' : ''} (language: petname).`);
    } else {
        _petNameDRMap = {};
        _petNameCRMap = {};
        const asmObj = new ChurchAssembler(typeof METHOD_REGISTER_CONVENTIONS !== 'undefined' ? METHOD_REGISTER_CONVENTIONS : {});
        const result = asmObj.assemble(src);
        if (result.errors && result.errors.length > 0) {
            _showAsmErrors(result.errors);
            log('Assembly failed:');
            result.errors.forEach(e => log(`  Line ${e.line}: ${e.message}`));
            return null;
        }
        _clearAsmErrors();
        newWords = result.words || [];
        newCW = newWords.length;
        const _asmAliases = asmObj.getAliases();
        _petNameDRMap = {};
        for (const [alias, regIdx] of Object.entries(_asmAliases.dr || {})) _petNameDRMap[regIdx] = alias;
        _petNameCRMap = {};
        for (const [alias, regIdx] of Object.entries(_asmAliases.cr || {})) _petNameCRMap[regIdx] = alias;
    }

    delete _lumpManifests[nsIdx];

    const hdrWord = (baseLoc < sim.memory.length) ? (sim.memory[baseLoc] >>> 0) : 0;
    const lumpHdr = sim.parseLumpHeader(hdrWord);
    if (!lumpHdr.valid) {
        log('Error: No valid lump header at 0x' + baseLoc.toString(16).toUpperCase().padStart(4,'0') + '.');
        return null;
    }

    const codeStart = baseLoc + 1;
    const oldCW = lumpHdr.cw;

    const maxCW = Math.max(0, lumpHdr.lumpSize - lumpHdr.cc - 1);
    if (newCW > maxCW) {
        // ── NEW-LUMP PATH ────────────────────────────────────────────────────
        // Code too large for the existing lump — allocate a fresh properly-sized
        // LUMP in the extended-code area (same logic as sim.loadProgram).
        const DEMO_CC       = 18;
        const EXTENDED_BASE = 0x0400;
        let newLumpSize = 64;
        while (newLumpSize < 1 + newCW + DEMO_CC) newLumpSize <<= 1;

        if (EXTENDED_BASE + newLumpSize > sim.NS_TABLE_BASE) {
            log(`Error: Code too large — ${newCW} words, max ${maxCW} words (lumpSize=${lumpHdr.lumpSize}, c-list=${lumpHdr.cc}).`);
            return null;
        }

        const n_minus_6   = Math.max(0, Math.log2(newLumpSize) - 6) | 0;
        const newLumpBase = EXTENDED_BASE;

        // Write new lump header (cc=0) + code words
        sim.memory[newLumpBase] = sim.packLumpHeader(n_minus_6, newCW, 0, 0);
        for (let i = 0; i < newCW; i++) {
            sim.memory[newLumpBase + 1 + i] = newWords[i] >>> 0;
        }

        // Update NS entry: location, limit17, cc=0, reseal
        const nsBase2       = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
        const oldW1nl       = sim.memory[nsBase2 + 1] >>> 0;
        const oldW2nl       = sim.memory[nsBase2 + 2] >>> 0;
        const w1fnl         = sim.parseNSWord1(oldW1nl);
        const existingGtSeq = (oldW2nl >>> 25) & 0x7F;
        sim.memory[nsBase2 + 0] = newLumpBase >>> 0;
        sim.memory[nsBase2 + 1] = sim.packNSWord1(newCW, w1fnl.b, w1fnl.g, w1fnl.chainable, w1fnl.gtType, 0);
        sim.memory[nsBase2 + 2] = sim.makeVersionSeals(existingGtSeq, newLumpBase, newCW);

        // Update the patched CR (word1 = new base, word2/word3 = updated NS words)
        if (sim.cr[crIdx]) {
            sim.cr[crIdx].word1 = newLumpBase >>> 0;
            sim.cr[crIdx].word2 = sim.memory[nsBase2 + 1];
            sim.cr[crIdx].word3 = sim.memory[nsBase2 + 2];
        }

        // Reset CR6 so the DEMO_CLIST injection below rebuilds it for the new lump
        if (sim.cr[6]) sim.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

        // Inject DEMO_CLIST into new lump (mirrors _applyPendingSimLoad lazy injection)
        if (sim.bootComplete && sim.demoClistGTs && sim.demoClistGTs.length > 0) {
            const cc        = sim.demoClistGTs.length;
            const clistBase = newLumpBase + newLumpSize - cc;
            for (let i = 0; i < cc; i++) {
                sim.memory[clistBase + i] = sim.demoClistGTs[i] >>> 0;
            }
            const updatedHdr = sim.memory[newLumpBase] >>> 0;
            sim.memory[newLumpBase] = ((updatedHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
            const nsW1Updated = sim.packNSWord1(newCW, w1fnl.b, w1fnl.g, w1fnl.chainable, w1fnl.gtType, cc);
            sim.memory[nsBase2 + 1] = nsW1Updated;
            const cr6GT = sim.createGT(0, nsIdx, { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, 1);
            sim.cr[6] = { word0: cr6GT, word1: clistBase >>> 0, word2: nsW1Updated >>> 0, word3: sim.memory[nsBase2 + 2] >>> 0, m: 0 };
            if (sim.cr[crIdx]) { sim.cr[crIdx].word2 = nsW1Updated; }
        }

        log(`New LUMP allocated at 0x${newLumpBase.toString(16)} (${newLumpSize} words) for ${newCW}-word program.`);
        log(`Simulator patched — ${newCW} word${newCW !== 1 ? 's' : ''} written.`);

        sim.pc = 0; sim.halted = false; sim.running = false; sim.sto = 243;
        sim.callStack = []; sim.flags = { N: false, Z: false, C: false, V: false };
        sim.lambdaActive = false; sim.lambdaReturnPC = 0; sim.lambdaCachedFrame = null;
        updateCRDisplay(); updateDRDisplay(); updateFlagsDisplay(); updateInfoDisplay();
        return { newWords, baseLoc: newLumpBase, codeStart: newLumpBase + 1, newCW, oldCW: lumpHdr.cw, nsIdx };
    }

    log(`CR${crIdx}  NS[${nsIdx}]  base=0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}  old cw=${oldCW}  new cw=${newCW}  (max ${maxCW})`);

    for (let i = 0; i < newCW; i++) {
        const addr = codeStart + i;
        if (addr < sim.memory.length) sim.memory[addr] = newWords[i] >>> 0;
    }
    for (let i = newCW; i < oldCW; i++) {
        const addr = codeStart + i;
        if (addr < sim.memory.length) sim.memory[addr] = 0;
    }

    if (newCW !== oldCW) {
        const newHdrWord = ((hdrWord >>> 0) & ~(0x1FFF << 10)) | ((newCW & 0x1FFF) << 10);
        sim.memory[baseLoc] = newHdrWord >>> 0;

        const nsBase = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
        const oldW1 = sim.memory[nsBase + 1] >>> 0;
        const oldW2 = sim.memory[nsBase + 2] >>> 0;
        const w1f = sim.parseNSWord1(oldW1);
        const newLimit17 = newCW;
        const newW1 = sim.packNSWord1(newLimit17, w1f.b, w1f.g, w1f.chainable, w1f.gtType, w1f.clistCount);
        sim.memory[nsBase + 1] = newW1;

        const existingGtSeq = (oldW2 >>> 25) & 0x7F;
        const newW2 = sim.makeVersionSeals(existingGtSeq, baseLoc, newLimit17);
        sim.memory[nsBase + 2] = newW2;

        if (sim.cr[crIdx]) {
            sim.cr[crIdx].word3 = newW2;
            sim.cr[crIdx].word2 = newW1 >>> 0;
        }

        log(`Resized: lump cw updated, NS[${nsIdx}] limit17=${newLimit17} (cw=${newCW}), CRC recomputed (gt_seq=${existingGtSeq} preserved).`);
    }

    if (petNameCaps && petNameCaps.length > 0) {
        const clistBase = sim.cr[6].word1;
        for (let ci = 0; ci < petNameCaps.length; ci++) {
            const cap = petNameCaps[ci];
            const clistOffset = cap.capIndex + 1;
            const clistAddr = clistBase + clistOffset;
            if (clistAddr < sim.memory.length) {
                const w2 = sim.memory[sim.NS_TABLE_BASE + cap.nsSlot * sim.NS_ENTRY_WORDS + 2] >>> 0;
                const gtSeq = (w2 >>> 25) & 0x7F;
                const gtWord = sim.createGT(gtSeq, cap.nsSlot, { R: 0, W: 0, X: 0, L: 0, S: 0, E: 1 }, 1);
                sim.memory[clistAddr] = gtWord;
                log(`  c-list[${clistOffset}] <- GT for ${cap.name} (NS[${cap.nsSlot}], GT=0x${gtWord.toString(16).toUpperCase().padStart(8, '0')})`);
            } else {
                log(`  Warning: c-list address 0x${clistAddr.toString(16)} out of range`);
            }
        }
    }

    log(`Simulator patched — ${newCW} word${newCW !== 1 ? 's' : ''} written.`);

    sim.pc = 0;
    sim.halted = false;
    sim.running = false;
    sim.sto = 243;
    sim.callStack = [];
    sim.flags = { N: false, Z: false, C: false, V: false };
    sim.lambdaActive = false;
    sim.lambdaReturnPC = 0;
    sim.lambdaCachedFrame = null;

    updateCRDisplay();
    updateDRDisplay();
    updateFlagsDisplay();
    updateInfoDisplay();
    return { newWords, baseLoc, codeStart, newCW, oldCW, nsIdx };
}

async function injectCRCodeToFPGA(logEl) {
    const log = msg => { if (logEl) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; } };

    const patch = injectCRCode(logEl);
    if (!patch) return false;

    const board = getSelectedBoard();
    if (board === 'tang-nano-20k-iot' && typeof FULL_ONLY_OPCODES !== 'undefined') {
        const patchWords = patch.newWords || [];
        for (let i = 0; i < patchWords.length; i++) {
            const opcode = (patchWords[i] >>> 27) & 0x1F;
            if (FULL_ONLY_OPCODES.includes(opcode)) {
                const opName = FULL_ONLY_OPCODE_NAMES[opcode] || `opcode ${opcode}`;
                log(`ERROR: Assembled code contains Full-only instruction ${opName} at word ${i}. This cannot run on the Tang Nano 20K (IoT profile). Switch to Ti60 F225 or remove Full-only instructions (LAMBDA, CHANGE, SWITCH, ELOADCALL, XLOADLAMBDA).`);
                return false;
            }
        }
    }

    if (!TangSerial.isConnected()) {
        log('FPGA not connected — simulator updated only. Connect to FPGA and retry.');
        return false;
    }

    const { newWords, baseLoc, newCW, nsIdx } = patch;

    if (patch.newCW !== patch.oldCW) {
        log('Sending updated NS entry to FPGA...');
        const nsBase = sim.NS_TABLE_BASE + nsIdx * sim.NS_ENTRY_WORDS;
        const nsSlice = Array.from(sim.memory.slice(0, TangSerial.NS_WORDS));
        const clSlice = Array.from(sim.memory.slice(TangSerial.NS_WORDS, TangSerial.NS_WORDS + TangSerial.CLIST_WORDS));
        try {
            await TangSerial.uploadToFPGA(nsSlice, clSlice, msg => log('  ' + msg));
        } catch(e) {
            log('NS upload failed: ' + e.message);
            return false;
        }
    }

    log(`Sending code lump (${newCW} words at 0x${baseLoc.toString(16).toUpperCase().padStart(4,'0')}) to FPGA...`);
    let patchResult;
    try {
        patchResult = await TangSerial.patchLump(baseLoc, newWords, msg => log('  ' + msg));
    } catch(e) {
        log('FPGA patch failed: ' + e.message);
        return false;
    }
    if (!patchResult || !patchResult.success) {
        log('FPGA patch failed — no valid echo from hardware.');
        return false;
    }
    log('FPGA patch confirmed by echo.');

    log('Sending RUN command...');
    try {
        await TangSerial.runFPGA(msg => log('  ' + msg));
        return true;
    } catch(e) {
        log('RUN command failed: ' + e.message);
        return false;
    }
}

function _quickHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

function _currentEditorHash() {
    const ed = document.getElementById('asmEditor');
    return ed ? _quickHash(ed.value) : '';
}

function _getConsecutiveCleanRuns() {
    if (!_simRunHash) return 0;
    const h = _currentEditorHash();
    if (h !== _simRunHash) return 0;
    let count = 0;
    for (let i = _simRunHistory.length - 1; i >= 0; i--) {
        const r = _simRunHistory[i];
        if (r.hash !== _simRunHash) break;
        if (!r.passed) break;
        count++;
    }
    return count;
}

function _isSourceStale() {
    return !_simRunHash || _currentEditorHash() !== _simRunHash;
}

function _updateMtbfIndicator() {
    const el = document.getElementById('mtbfIndicator');
    if (!el) return;
    if (_isSourceStale()) {
        el.textContent = 'MTBF: —';
        el.className = 'mtbf-badge mtbf-red';
        _updateFaultFreeCounter();
        return;
    }
    const n = _getConsecutiveCleanRuns();
    const total = _simRunHistory.filter(r => r.hash === _simRunHash).length;
    const eligible = _faultFreeInstrTotal >= 1000;
    if (total === 0) {
        el.textContent = 'MTBF: —';
        el.className = 'mtbf-badge mtbf-red';
    } else if (eligible) {
        el.textContent = 'MTBF: 0.0001';
        el.className = 'mtbf-badge mtbf-green';
    } else {
        el.textContent = `MTBF: ${n}/${total}`;
        el.className = 'mtbf-badge ' + (n >= 5 ? 'mtbf-green' : n >= 3 ? 'mtbf-amber' : 'mtbf-red');
    }
    _updateFaultFreeCounter();
}

function _updateFaultFreeCounter() {
    const el = document.getElementById('faultFreeCounter');
    if (!el) return;
    const stale = _isSourceStale();
    const ffi = stale ? 0 : _faultFreeInstrTotal;
    const eligible = ffi >= 1000;
    if (stale || ffi === 0) {
        el.textContent = '0\u202F/\u202F1K';
        el.className = 'fault-free-badge ff-zero';
        el.title = 'Fault-free instructions: run a clean program to accumulate';
    } else if (eligible) {
        el.textContent = '\u2713 MTBF 0.0001';
        el.className = 'fault-free-badge ff-eligible';
        el.title = `${ffi.toLocaleString()} fault-free instructions \u2014 eligible to save as LUMP`;
    } else {
        el.textContent = `${ffi.toLocaleString()}\u202F/\u202F1K`;
        el.className = 'fault-free-badge ff-progress';
        el.title = `${ffi.toLocaleString()} / 1,000 fault-free instructions \u2014 run clean programs to reach the threshold`;
    }
}

function patchSimulator() {
    _runStopped = true;
    sim.running = false;

    const ed = document.getElementById('asmEditor');
    const srcHash = ed ? _quickHash(ed.value) : '';
    const src = ed ? ed.value : '';
    const logEl = document.getElementById('crInjectLog');
    if (logEl) { logEl.style.display = 'block'; logEl.textContent = ''; }
    let result;
    try {
        result = injectCRCode(logEl);
    } catch (e) {
        console.error('patchSimulator error:', e);
        if (logEl) logEl.textContent += '\nError: ' + (e.message || e);
    }
    const logText = logEl ? logEl.textContent.trim() : '';
    showPatchModal(!!result, 'Patch Simulator', logText);
    if (result) {
        const _patchToastEl = document.getElementById('patchToastOverlay');
        if (_patchToastEl) {
            const _saveLnk = document.createElement('a');
            _saveLnk.href = '#';
            _saveLnk.className = 'patch-toast-save-link';
            _saveLnk.textContent = '\u2192 Save to Repository';
            _saveLnk.onclick = function(ev) {
                ev.preventDefault();
                if (typeof switchView === 'function') switchView('lumps');
                setTimeout(function() {
                    const _b = document.getElementById('liveLumpBanner');
                    if (_b) _b.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 150);
            };
            _patchToastEl.appendChild(_saveLnk);
        }
        if (srcHash !== _simRunHash) {
            _simRunHistory = [];
            _simRunHash = srcHash;
            _faultFreeInstrTotal = 0;
        }
        // Store sticky patch — survives reset+boot, re-applied automatically.
        // Also persist to localStorage so it survives page refresh.
        _stickyPatches[result.nsIdx] = {
            words: result.newWords,
            newCW: result.newCW,
            nsIdx: result.nsIdx,
            crIdx: selectedCR,
            src,
        };
        _asmSrcSave(result.nsIdx, src);
        _persistStickyPatch(result.nsIdx);
        _updateMtbfIndicator();
        updateCRDetail();
    }
}

// Re-apply all sticky patches from _stickyPatches after a boot sequence.
// Called by _autoLoadDefaultProgram() (app-run.js) on every boot completion.
window._reapplyStickyPatches = function() {
    const entries = Object.entries(_stickyPatches);
    if (entries.length === 0) return;
    for (const [nsIdxStr, patch] of entries) {
        const nsIdx2 = parseInt(nsIdxStr);
        const nse = sim.readNSEntry(nsIdx2);
        if (!nse) continue;
        const baseLoc2 = nse.word0_location >>> 0;
        if (baseLoc2 === 0 || baseLoc2 >= sim.memory.length) continue;

        const hdr2 = sim.parseLumpHeader(sim.memory[baseLoc2] >>> 0);
        if (!hdr2.valid) continue;

        const { words, newCW, crIdx: patchCRIdx } = patch;
        const maxCW2    = Math.max(0, hdr2.lumpSize - hdr2.cc - 1);

        if (newCW > maxCW2) {
            // Large program — allocate a new LUMP in the extended-code area
            // (mirrors the new-LUMP path in injectCRCode / sim.loadProgram).
            const DEMO_CC       = 18;
            const EXTENDED_BASE = 0x0400;
            let newLumpSize = 64;
            while (newLumpSize < 1 + newCW + DEMO_CC) newLumpSize <<= 1;
            if (EXTENDED_BASE + newLumpSize > sim.NS_TABLE_BASE) {
                console.warn('[sticky] Program too large to re-apply NS[' + nsIdx2 + '] (' + newCW + 'w) — skipped');
                continue;
            }
            const n_minus_6   = Math.max(0, Math.log2(newLumpSize) - 6) | 0;
            const newLumpBase = EXTENDED_BASE;
            sim.memory[newLumpBase] = sim.packLumpHeader(n_minus_6, newCW, 0, 0);
            for (let i = 0; i < newCW; i++) sim.memory[newLumpBase + 1 + i] = words[i] >>> 0;

            const nsBase2r  = sim.NS_TABLE_BASE + nsIdx2 * sim.NS_ENTRY_WORDS;
            const oldW1r    = sim.memory[nsBase2r + 1] >>> 0;
            const oldW2r    = sim.memory[nsBase2r + 2] >>> 0;
            const w1fr      = sim.parseNSWord1(oldW1r);
            const gtSeqr    = (oldW2r >>> 25) & 0x7F;
            sim.memory[nsBase2r + 0] = newLumpBase >>> 0;
            sim.memory[nsBase2r + 1] = sim.packNSWord1(newCW, w1fr.b, w1fr.g, w1fr.chainable, w1fr.gtType, 0);
            sim.memory[nsBase2r + 2] = sim.makeVersionSeals(gtSeqr, newLumpBase, newCW);

            if (patchCRIdx != null && sim.cr[patchCRIdx]) {
                sim.cr[patchCRIdx].word1 = newLumpBase >>> 0;
                sim.cr[patchCRIdx].word2 = sim.memory[nsBase2r + 1];
                sim.cr[patchCRIdx].word3 = sim.memory[nsBase2r + 2];
            }
            if (sim.cr[6]) sim.cr[6] = { word0: 0, word1: 0, word2: 0, word3: 0, m: 0 };

            if (sim.bootComplete && sim.demoClistGTs && sim.demoClistGTs.length > 0) {
                const cc        = sim.demoClistGTs.length;
                const clistBase = newLumpBase + newLumpSize - cc;
                for (let i = 0; i < cc; i++) sim.memory[clistBase + i] = sim.demoClistGTs[i] >>> 0;
                const updHdr   = sim.memory[newLumpBase] >>> 0;
                sim.memory[newLumpBase] = ((updHdr & ~0xFF) | (cc & 0xFF)) >>> 0;
                const nsW1r    = sim.packNSWord1(newCW, w1fr.b, w1fr.g, w1fr.chainable, w1fr.gtType, cc);
                sim.memory[nsBase2r + 1] = nsW1r;
                const cr6GTr   = sim.createGT(0, nsIdx2, { R:0, W:0, X:0, L:0, S:0, E:1 }, 1);
                sim.cr[6] = { word0: cr6GTr, word1: clistBase >>> 0, word2: nsW1r >>> 0, word3: sim.memory[nsBase2r + 2] >>> 0, m: 0 };
                if (patchCRIdx != null && sim.cr[patchCRIdx]) sim.cr[patchCRIdx].word2 = nsW1r;
            }
            console.log('[sticky] Re-applied large patch NS[' + nsIdx2 + '] (' + newCW + 'w) → new LUMP at 0x' + newLumpBase.toString(16));
            continue;
        }

        // ── Patch-in-place (code fits in existing lump) ──────────────────────
        const oldCW2    = hdr2.cw;
        const codeStart2 = baseLoc2 + 1;
        for (let i = 0; i < newCW; i++) {
            if (codeStart2 + i < sim.memory.length)
                sim.memory[codeStart2 + i] = words[i] >>> 0;
        }
        for (let i = newCW; i < oldCW2; i++) {
            if (codeStart2 + i < sim.memory.length)
                sim.memory[codeStart2 + i] = 0;
        }

        const nsBase2     = sim.NS_TABLE_BASE + nsIdx2 * sim.NS_ENTRY_WORDS;
        const nsStoredBase2 = sim.memory[nsBase2 + 0] >>> 0;
        const crNow       = (patchCRIdx != null) ? sim.cr[patchCRIdx] : null;
        const crNowBase   = crNow ? (crNow.word1 >>> 0) : baseLoc2;
        // Sync NS + CR whenever cw changed OR the stored base diverged from baseLoc2
        // OR the CR's physical-base word diverged (e.g. after reboot resets CR14.word1).
        if (newCW !== oldCW2 || nsStoredBase2 !== baseLoc2 || crNowBase !== baseLoc2) {
            if (newCW !== oldCW2) {
                const hdrW = sim.memory[baseLoc2] >>> 0;
                sim.memory[baseLoc2] = ((hdrW & ~(0x1FFF << 10)) | ((newCW & 0x1FFF) << 10)) >>> 0;
            }
            const oldW1   = sim.memory[nsBase2 + 1] >>> 0;
            const oldW2   = sim.memory[nsBase2 + 2] >>> 0;
            const w1f     = sim.parseNSWord1(oldW1);
            const newW1   = sim.packNSWord1(newCW, w1f.b, w1f.g, w1f.chainable, w1f.gtType, w1f.clistCount);
            // Always keep NS slot word0 pointing at the actual lump base
            sim.memory[nsBase2 + 0] = baseLoc2 >>> 0;
            sim.memory[nsBase2 + 1] = newW1;
            const gtSeq  = (oldW2 >>> 25) & 0x7F;
            sim.memory[nsBase2 + 2] = sim.makeVersionSeals(gtSeq, baseLoc2, newCW);
            if (crNow) {
                // word1 is the physical base — must always match NS slot word0
                crNow.word1 = baseLoc2 >>> 0;
                crNow.word2 = sim.memory[nsBase2 + 1];
                crNow.word3 = sim.memory[nsBase2 + 2];
            }
        }
        console.log('[sticky] Re-applied patch NS[' + nsIdx2 + '] (' + newCW + 'w)');

        // Restore source to editor if this slot is currently active and the
        // editor is blank — keeps the patch → reset → test → edit loop intact.
        if (patch.src) {
            _asmSrcSave(nsIdx2, patch.src);
            if (_asmEditorNsIdx === nsIdx2) {
                const _re = document.getElementById('asmEditor');
                if (_re && !_re.value.trim()) _re.value = patch.src;
            }
        }
    }
};

// Remove a sticky patch by NS slot index (called from the Code tab clear button).
window.clearStickyPatch = function(nsIdx) {
    delete _stickyPatches[nsIdx];
    _clearPersistedStickyPatch(nsIdx);
    if (typeof updateCRDetail === 'function') updateCRDetail();
};

// ── Boot-image sticky-patch eviction ─────────────────────────────────────────
// Called from app-shell.js and app-memory.js immediately after a successful
// sim.loadBootImage() call.  For each NS slot the boot image owns (0..nsCount-1):
//
//   Patch words == boot-image words  →  redundant; clear silently.
//   Patch words != boot-image words  →  stale; clear it, log each differing
//                                       word (old vs new disassembly) to the
//                                       IDE console, and raise a persistent
//                                       toast (duration=0) the programmer must
//                                       explicitly dismiss.
//
// Defined here so it can access _stickyPatches without exposing that variable.
window._clearBootImageStickyPatches = function(nsCount) {
    var staleCleared = [];
    var _dis = function(w) {
        try {
            return (typeof ChurchAssembler !== 'undefined')
                ? ChurchAssembler.disassemble(w >>> 0)
                : ('0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0'));
        } catch (_e) {
            return '0x' + (w >>> 0).toString(16).toUpperCase().padStart(8, '0');
        }
    };

    for (var _slot = 0; _slot < nsCount; _slot++) {
        var _patch = _stickyPatches[_slot];
        if (!_patch) continue;

        // Locate this slot's lump in sim.memory
        var _nse    = (typeof sim !== 'undefined' && sim && typeof sim.readNSEntry === 'function')
                          ? sim.readNSEntry(_slot) : null;
        var _base   = _nse ? (_nse.word0_location >>> 0) : 0;
        var _pWords = Array.isArray(_patch.words) ? _patch.words : [];
        var _pCW    = (_patch.newCW > 0) ? _patch.newCW : _pWords.length;

        // Compare patch words vs what loadBootImage wrote to sim.memory
        var _diffs = [];
        for (var _wi = 0; _wi < _pCW; _wi++) {
            var _pw = (_pWords[_wi] || 0) >>> 0;
            var _mw = (_base && typeof sim !== 'undefined' && (_base + 1 + _wi) < sim.memory.length)
                          ? (sim.memory[_base + 1 + _wi] >>> 0) : 0;
            if (_pw !== _mw) _diffs.push({ wi: _wi, old: _pw, cur: _mw });
        }

        var _label = (typeof sim !== 'undefined' && sim.nsLabels && sim.nsLabels[_slot])
                         || ('NS[' + _slot + ']');

        // Always remove the patch — either it's redundant (matches) or stale (differs)
        delete _stickyPatches[_slot];
        _clearPersistedStickyPatch(_slot);

        if (_diffs.length > 0) {
            staleCleared.push({ slot: _slot, label: _label, diffs: _diffs, pCW: _pCW });
        }
    }

    if (typeof updateCRDetail === 'function') updateCRDetail();
    if (staleCleared.length === 0) return;   // all redundant — nothing to report

    // ── IDE console: per-slot, per-word diff ─────────────────────────────
    if (typeof appendOutput === 'function') {
        appendOutput('── Boot image updated — ' + staleCleared.length +
            ' stale sticky patch' + (staleCleared.length !== 1 ? 'es' : '') + ' cleared ──', 'info');
        for (var _sc of staleCleared) {
            appendOutput('  ' + _sc.label + ' (' + _sc.pCW + ' word' + (_sc.pCW !== 1 ? 's' : '') + '):');
            for (var _d of _sc.diffs) {
                appendOutput('    [' + _d.wi + ']  was: ' + _dis(_d.old) +
                             '   now: ' + _dis(_d.cur));
            }
        }
    }

    // ── Persistent toast (stays until dismissed) ──────────────────────────
    if (typeof _showFpgaToast === 'function') {
        var _names  = staleCleared.map(function(s) { return s.label; }).join(', ');
        var _plural = staleCleared.length !== 1;
        _showFpgaToast(
            'Stale patch' + (_plural ? 'es' : '') + ' cleared',
            (_plural
                ? staleCleared.length + ' sticky patches (' + _names + ') were built against ' +
                  'an older boot image and have been removed. See the IDE console for the word-by-word diff.'
                : 'Your sticky patch for ' + _names + ' was built against an older boot image ' +
                  'and has been removed. See the IDE console for the word-by-word diff.'),
            'warn',
            0   // duration=0 — stays until the programmer explicitly dismisses it
        );
    }
};

async function patchFPGA() {
    const logEl = document.getElementById('crInjectLog');
    if (logEl) { logEl.style.display = 'block'; logEl.textContent = ''; }
    const ok = await injectCRCodeToFPGA(logEl);
    const logText = logEl ? logEl.textContent.trim() : '';
    showPatchModal(ok, 'Patch FPGA', logText);
}

/*
 * exportPatchFile() — Export a .patch file for command-line FPGA flashing.
 *
 * .patch file format (CHPF v1):
 *   Bytes 0-3:  Magic "CHPF" (0x43 0x48 0x50 0x46)
 *   Byte  4:    Version (0x01)
 *   Byte  5:    Number of PATCH_LUMP blocks (1-255)
 *   Byte  6:    Flags (bit 0 = file includes RUN sentinel after blocks)
 *   Byte  7:    Reserved (0x00)
 *   Then for each block, a complete UART frame:
 *     Bytes 0-1:   Tag [0xBE][0xEF]
 *     Bytes 2-3:   Address (big-endian, BRAM word address)
 *     Bytes 4-5:   Word count N (big-endian)
 *     Bytes 6..6+N*4-1:  N words (little-endian, 4 bytes each)
 *     Last 2 bytes: CRC-16/CCITT over the frame body (tag+addr+count+words)
 *   If flags bit 0 is set, a 2-byte RUN sentinel follows all blocks:
 *     [0xBE][0xAA]
 *
 * The CLI tool (tools/patch_fpga.py) sends each stored frame verbatim
 * over UART — no recomputation needed.
 */
function exportPatchFile() {
    if (_isSourceStale()) {
        appendOutput('Export Patch blocked — source has been edited since last Patch. Click Patch to recompile and run before exporting.', 'error');
        return;
    }
    const cleanRuns = _getConsecutiveCleanRuns();
    if (cleanRuns < 3) {
        appendOutput(`Export Patch blocked — requires 3 consecutive clean runs (you have ${cleanRuns}). Click Patch then Run repeatedly. The code must halt cleanly with no faults each time.`, 'error');
        return;
    }

    const logEl = document.getElementById('crInjectLog');
    if (logEl) { logEl.style.display = 'block'; logEl.textContent = ''; }
    const log = msg => { if (logEl) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; } };

    const patch = injectCRCode(logEl);
    if (!patch) return;

    const board = getSelectedBoard();
    if (board === 'tang-nano-20k-iot' && typeof FULL_ONLY_OPCODES !== 'undefined') {
        const patchWords = patch.newWords || [];
        for (let i = 0; i < patchWords.length; i++) {
            const opcode = (patchWords[i] >>> 27) & 0x1F;
            if (FULL_ONLY_OPCODES.includes(opcode)) {
                const opName = FULL_ONLY_OPCODE_NAMES[opcode] || `opcode ${opcode}`;
                log(`ERROR: Assembled code contains Full-only instruction ${opName} at word ${i}. Cannot export for Tang Nano 20K (IoT profile). Switch to Ti60 F225 or remove Full-only instructions.`);
                return;
            }
        }
    }

    const { newWords, baseLoc, codeStart, newCW, oldCW, nsIdx } = patch;

    const blocks = [];
    const nsChanged = newCW !== oldCW;

    if (nsChanged) {
        const nsSlice = Array.from(sim.memory.slice(0, TangSerial.NS_WORDS));
        const clSlice = Array.from(sim.memory.slice(TangSerial.NS_WORDS, TangSerial.NS_WORDS + TangSerial.CLIST_WORDS));
        const totalWords = TangSerial.NS_WORDS + TangSerial.CLIST_WORDS;
        const nsWords = new Array(totalWords);
        for (let i = 0; i < TangSerial.NS_WORDS; i++) nsWords[i] = i < nsSlice.length ? nsSlice[i] : 0;
        for (let i = 0; i < TangSerial.CLIST_WORDS; i++) nsWords[TangSerial.NS_WORDS + i] = i < clSlice.length ? clSlice[i] : 0;
        blocks.push({ addr: 0x0000, words: nsWords });
        log(`Block 0: NS table update  addr=0x0000  words=${totalWords}`);
    }

    blocks.push({ addr: codeStart, words: newWords });
    log(`Block ${blocks.length - 1}: Code lump  addr=0x${codeStart.toString(16).toUpperCase().padStart(4,'0')}  words=${newCW}`);
    log(`NS table update included: ${nsChanged ? 'yes' : 'no'}`);

    function crc16ccitt(data) {
        let crc = 0xFFFF;
        for (const byte of data) {
            for (let b = 0; b < 8; b++) {
                const bit = ((byte >>> (7 - b)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        return crc;
    }

    const numBlocks = blocks.length;
    const frameBuffers = [];
    for (const blk of blocks) {
        const bodyLen = 6 + blk.words.length * 4;
        const frame = new Uint8Array(bodyLen + 2);
        frame[0] = 0xBE;
        frame[1] = 0xEF;
        frame[2] = (blk.addr >> 8) & 0xFF;
        frame[3] = blk.addr & 0xFF;
        frame[4] = (blk.words.length >> 8) & 0xFF;
        frame[5] = blk.words.length & 0xFF;
        for (let i = 0; i < blk.words.length; i++) {
            const w = blk.words[i] >>> 0;
            frame[6 + i * 4 + 0] = w & 0xFF;
            frame[6 + i * 4 + 1] = (w >> 8) & 0xFF;
            frame[6 + i * 4 + 2] = (w >> 16) & 0xFF;
            frame[6 + i * 4 + 3] = (w >> 24) & 0xFF;
        }
        const crc = crc16ccitt(frame.subarray(0, bodyLen));
        frame[bodyLen] = (crc >> 8) & 0xFF;
        frame[bodyLen + 1] = crc & 0xFF;
        frameBuffers.push({ frame, crc });
    }

    const runSentinel = new Uint8Array([0xBE, 0xAA]);
    let totalFrameBytes = 0;
    for (const fb of frameBuffers) totalFrameBytes += fb.frame.length;
    const fileSize = 8 + totalFrameBytes + runSentinel.length;
    const fileData = new Uint8Array(fileSize);
    fileData[0] = 0x43;
    fileData[1] = 0x48;
    fileData[2] = 0x50;
    fileData[3] = 0x46;
    fileData[4] = 0x01;
    fileData[5] = numBlocks;
    fileData[6] = 0x01;
    fileData[7] = 0x00;

    let offset = 8;
    for (const fb of frameBuffers) {
        fileData.set(fb.frame, offset);
        offset += fb.frame.length;
    }
    fileData.set(runSentinel, offset);

    log('');
    log('--- Patch Preview (cross-check with patch_fpga.py output) ---');
    for (let i = 0; i < blocks.length; i++) {
        const blk = blocks[i];
        const fb = frameBuffers[i];
        log(`  Block ${i}: addr=0x${blk.addr.toString(16).toUpperCase().padStart(4,'0')}  words=${blk.words.length}  CRC=0x${fb.crc.toString(16).toUpperCase().padStart(4,'0')}  frame=${fb.frame.length} bytes`);
    }
    log(`  RUN sentinel: [0xBE 0xAA] included in file`);
    log(`  File size: ${fileSize} bytes`);
    log('');

    const crIdx = selectedCR !== null ? selectedCR : 0;
    const fileName = `CR${crIdx}_patch.patch`;

    const blob = new Blob([fileData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`Downloaded: ${fileName}`);
    log('');
    log('To flash to FPGA, run:');
    log(`  python3 tools/patch_fpga.py /dev/ttyUSB1 ${fileName}`);

    const logText = logEl ? logEl.textContent.trim() : '';
    showPatchModal(true, 'Export Patch', logText);
}

/*
 * exportLumpAsPatch() — Load a pre-built .lump binary and wrap it as a .patch
 * file for command-line FPGA flashing via tools/patch_fpga.py.
 *
 * The .lump file stores 32-bit words big-endian (per the lump specification).
 * The UART PATCH_LUMP protocol on the Ti60 F225 expects words little-endian.
 * This function performs the byte-swap on each word during frame construction.
 *
 * User supplies:
 *   • A .lump file (picked via the browser file-picker)
 *   • A target BRAM word address (prompted; default 0x0100 = after NS/clist area)
 *
 * The resulting .patch file uses the same CHPF v1 format as exportPatchFile().
 */
function exportLumpAsPatch() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lump,application/octet-stream';

    input.onchange = function() {
        const file = input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            const buf = evt.target.result;
            _processLumpFileForPatch(file.name, buf);
        };
        reader.readAsArrayBuffer(file);
    };

    input.click();
}

function _processLumpFileForPatch(fileName, buf) {
    const msgs = [];
    const log = msg => msgs.push(msg);

    if (buf.byteLength < 64 * 4) {
        appendOutput('Export Lump as Patch: file too small — minimum lump is 64 words (256 bytes).', 'error');
        return;
    }
    if (buf.byteLength % 4 !== 0) {
        appendOutput('Export Lump as Patch: file size is not a multiple of 4 bytes — not a valid .lump.', 'error');
        return;
    }

    const view = new DataView(buf);
    const word0 = view.getUint32(0, false);

    const magic   = (word0 >>> 27) & 0x1F;
    const nMinus6 = (word0 >>> 23) & 0x0F;
    const cw      = (word0 >>> 10) & 0x1FFF;
    const typ     = (word0 >>> 8)  & 0x03;
    const cc      = word0 & 0xFF;

    if (magic !== 0x1F) {
        appendOutput(`Export Lump as Patch: invalid magic 0x${magic.toString(16)} in "${fileName}" — expected 0x1F.`, 'error');
        return;
    }

    const lumpSize = 64 << nMinus6;
    if (buf.byteLength !== lumpSize * 4) {
        appendOutput(`Export Lump as Patch: file size ${buf.byteLength} bytes does not match header lump_size=${lumpSize} words (${lumpSize * 4} bytes).`, 'error');
        return;
    }

    const addrInput = prompt(
        `Export Lump "${fileName}" as FPGA patch\n\nTarget BRAM word address (hex, default 0x0100):`,
        '0x0100'
    );
    if (addrInput === null) return;

    const targetAddr = parseInt(addrInput, 16);
    if (isNaN(targetAddr) || targetAddr < 0 || targetAddr > 0xFFFF) {
        appendOutput('Export Lump as Patch: invalid target address.', 'error');
        return;
    }

    log(`Lump: "${fileName}"`);
    log(`  Header:    0x${word0.toString(16).padStart(8, '0')}`);
    log(`  lump_size: ${lumpSize} words`);
    log(`  cw:        ${cw}  typ: ${typ}  cc: ${cc}`);
    log(`  Target:    BRAM word address 0x${targetAddr.toString(16).toUpperCase().padStart(4, '0')}`);
    log('');

    const lumpWords = [];
    for (let i = 0; i < lumpSize; i++) {
        lumpWords.push(view.getUint32(i * 4, false));
    }

    function crc16ccitt(data) {
        let crc = 0xFFFF;
        for (const byte of data) {
            for (let b = 0; b < 8; b++) {
                const bit = ((byte >>> (7 - b)) & 1) ^ ((crc >>> 15) & 1);
                crc = ((crc << 1) & 0xFFFF) ^ (bit ? 0x1021 : 0);
            }
        }
        return crc;
    }

    const N = lumpWords.length;
    const bodyLen = 6 + N * 4;
    const frame = new Uint8Array(bodyLen + 2);
    frame[0] = 0xBE;
    frame[1] = 0xEF;
    frame[2] = (targetAddr >> 8) & 0xFF;
    frame[3] = targetAddr & 0xFF;
    frame[4] = (N >> 8) & 0xFF;
    frame[5] = N & 0xFF;
    for (let i = 0; i < N; i++) {
        const w = lumpWords[i] >>> 0;
        frame[6 + i * 4 + 0] = w & 0xFF;
        frame[6 + i * 4 + 1] = (w >> 8) & 0xFF;
        frame[6 + i * 4 + 2] = (w >> 16) & 0xFF;
        frame[6 + i * 4 + 3] = (w >> 24) & 0xFF;
    }
    const crc = crc16ccitt(frame.subarray(0, bodyLen));
    frame[bodyLen]     = (crc >> 8) & 0xFF;
    frame[bodyLen + 1] = crc & 0xFF;

    log(`Block 0: lump  addr=0x${targetAddr.toString(16).toUpperCase().padStart(4,'0')}  words=${N}  CRC=0x${crc.toString(16).toUpperCase().padStart(4,'0')}`);

    const runSentinel = new Uint8Array([0xBE, 0xAA]);
    const fileSize = 8 + frame.length + runSentinel.length;
    const fileData = new Uint8Array(fileSize);
    fileData[0] = 0x43;
    fileData[1] = 0x48;
    fileData[2] = 0x50;
    fileData[3] = 0x46;
    fileData[4] = 0x01;
    fileData[5] = 0x01;
    fileData[6] = 0x01;
    fileData[7] = 0x00;
    fileData.set(frame, 8);
    fileData.set(runSentinel, 8 + frame.length);

    const baseName = fileName.replace(/\.lump$/i, '');
    const outName = `${baseName}_0x${targetAddr.toString(16).toUpperCase().padStart(4,'0')}.patch`;

    const blob = new Blob([fileData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    log(`File size: ${fileSize} bytes`);
    log(`Downloaded: ${outName}`);
    log('');
    log('To flash to FPGA, run:');
    log(`  python3 tools/patch_fpga.py /dev/ttyUSB1 ${outName}`);
    log('');
    log('Hardware verification checklist (Efinix Ti60 F225):');
    log(`  1. Flash: python3 tools/patch_fpga.py /dev/ttyUSB1 ${outName}`);
    log('  2. Expected UART echo after flash: "ACK <N> words written"');
    log('  3. Verify lump header in BRAM with READ_BRAM (0xBEAD) at the target address');
    log(`     Expected word 0: 0x${word0.toString(16).padStart(8, '0')} (magic=0x1F)`);
    log('  4. Construct a GT pointing to the lump base and CALL into it');
    log('     Expected: PC=1 (code region entry), correct CR14/CR6 derived by hardware');
    log('  5. If CALL completes with no FAULT_MAGIC/FAULT_BOUNDS: lump loaded correctly');

    appendOutput(`Export Lump as Patch: "${outName}" — ${lumpSize} words at 0x${targetAddr.toString(16).toUpperCase().padStart(4,'0')} (${fileSize} bytes)`, 'info');
    showPatchModal(true, 'Export Lump as Patch', msgs.join('\n'));
}

function showPatchModal(ok, opName, logText) {
    const existing = document.getElementById('patchToastOverlay');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'patchToastOverlay';
    toast.className = 'patch-toast ' + (ok ? 'patch-toast-ok' : 'patch-toast-fail');

    const lines = (logText || '').split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1] || (ok ? 'Done.' : 'Operation failed.');

    toast.innerHTML = `
        <div class="patch-toast-header">
            <span class="patch-toast-icon">${ok ? '&#x2713;' : '&#x2717;'}</span>
            <span class="patch-toast-title">${opName} &mdash; ${ok ? 'Success' : 'Failed'}</span>
            <button class="patch-toast-close" onclick="document.getElementById('patchToastOverlay').remove()">&#x2715;</button>
        </div>
        <div class="patch-toast-summary">${lastLine}</div>
        ${lines.length > 1 ? `<pre class="patch-toast-log">${lines.join('\n')}</pre>` : ''}
    `;

    document.body.appendChild(toast);
}


function _storeLumpManifest(nsIdx, baseLoc, methods, manifest, capabilities) {
    const annot = {};
    let methodTableSize = methods.length;
    for (let mi = 0; mi < methods.length; mi++) {
        annot[baseLoc + 1 + mi] = { desc: `method-table[${mi}] \u2192 ${methods[mi].name}`, compiler: true };
    }
    const commentsByMethod = {};
    if (manifest) {
        for (const entry of manifest) {
            const comments = {};
            if (entry.mapping) {
                let seqIdx = 0;
                for (const m of entry.mapping) {
                    if (m.comment !== undefined) {
                        comments[seqIdx++] = { desc: m.comment, compiler: !!m.auto };
                    } else if (m.addr !== undefined && m.desc) {
                        comments[m.addr] = { desc: m.desc, compiler: /^LOAD CR\d+.*\(/.test(m.desc) };
                    }
                }
            }
            commentsByMethod[entry.name] = comments;
        }
    }
    let wordAddr = baseLoc + 1 + methodTableSize;
    for (const m of methods) {
        const mc = commentsByMethod[m.name] || {};
        for (let i = 0; i < (m.code || []).length; i++) {
            if (mc[i]) {
                annot[wordAddr] = mc[i];
            }
            wordAddr++;
        }
    }
    if (capabilities && capabilities.length > 0) {
        annot._caps = capabilities.slice();
    }
    // Store methods metadata for the API tab (.pet preamble generation).
    if (methods && methods.length > 0) {
        annot._methods = methods.map(m => ({
            name:     m.name,
            offset:   m.offset,
            length:   m.length,
            pet_names: m.pet_names || {},
            inputs:   m.inputs   || [],
            outputs:  m.outputs  || [],
            aliasOf:  m.aliasOf  || null,
        }));
        // Merge DR/CR pet_names across all methods as a top-level fallback.
        const allDR = {};
        const allCR = {};
        for (const m of annot._methods) {
            for (const [k, v] of Object.entries((m.pet_names.DR) || {})) allDR[k] = v;
            for (const [k, v] of Object.entries((m.pet_names.CR) || {})) allCR[k] = v;
        }
        annot.pet_names = { DR: allDR, CR: allCR };
    }
    _lumpManifests[nsIdx] = annot;
}

function _resolveClistPetName(clistBase, imm, nsIdx) {
    if (clistBase > 0 && sim && (clistBase + imm) < sim.memory.length) {
        const gtWord = sim.memory[clistBase + imm] >>> 0;
        if (gtWord !== 0) {
            const parsed = sim.parseGT(gtWord);
            if (parsed.type === 3) {
                // Abstract GT: bits[15:0] is ab_data = (device_class<<8)|instance, not an NS slot.
                try {
                    const ab = sim.parseAbstractGT(gtWord);
                    const DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
                    if (ab.ab_type === 0) return `${DC[ab.device_class] || 'dc'+ab.device_class}${ab.device_data}`;
                    return `M-Elev 0x${ab.ab_data.toString(16).toUpperCase()}`;
                } catch(_e) {}
            }
            return (sim.nsLabels && sim.nsLabels[parsed.index]) || `NS[${parsed.index}]`;
        }
    }
    const stored = _lumpManifests[nsIdx];
    const caps = stored && stored._caps;
    if (caps && imm > 0 && imm <= caps.length) {
        return caps[imm - 1];
    }
    return null;
}

const _brColors = ['#e94560','#4ecdc4','#f7b731','#a55eea','#26de81','#fd9644','#45aaf2','#fc5c65'];

function _computeBranchArrows(words) {
    const n = words.length;
    const branches = [];
    for (let i = 0; i < n; i++) {
        const w = words[i] >>> 0;
        if (w === 0) continue;
        const opcode = (w >>> 27) & 0x1F;
        if (opcode === 17) {
            const imm = w & 0x7FFF;
            const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
            const tgtRow = i + soff;
            if (tgtRow >= 0 && tgtRow < n && tgtRow !== i) {
                const top = Math.min(i, tgtRow);
                const bot = Math.max(i, tgtRow);
                branches.push({ src: i, tgt: tgtRow, top, bot, span: bot - top });
            }
        }
    }
    if (branches.length === 0) return { html: new Array(n).fill(''), hasBranches: false };
    branches.sort((a, b) => a.span - b.span);
    for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        for (let lane = 0; lane < 8; lane++) {
            let ok = true;
            for (let j = 0; j < i; j++) {
                if (branches[j].lane !== lane) continue;
                if (branches[j].top <= b.bot && branches[j].bot >= b.top) { ok = false; break; }
            }
            if (ok) { b.lane = lane; break; }
        }
        if (b.lane === undefined) b.lane = 0;
        b.color = _brColors[i % _brColors.length];
    }
    const maxLane = Math.max(...branches.map(b => b.lane)) + 1;
    const laneW = 7;
    const tickW = 5;
    const svgW = maxLane * laneW + tickW + 2;
    const h = 18;
    const mid = h / 2;
    const result = [];
    for (let row = 0; row < n; row++) {
        let lines = '';
        for (const b of branches) {
            if (row < b.top || row > b.bot) continue;
            const x = svgW - tickW - (b.lane * laneW) - 2;
            const col = b.color;
            if (row === b.top) {
                lines += `<line x1="${x}" y1="${mid}" x2="${x}" y2="${h}" stroke="${col}" stroke-width="1.5"/>`;
                lines += `<line x1="${x}" y1="${mid}" x2="${svgW}" y2="${mid}" stroke="${col}" stroke-width="1.5"/>`;
                if (row === b.tgt) lines += `<polygon points="${svgW},${mid} ${svgW-4},${mid-3} ${svgW-4},${mid+3}" fill="${col}"/>`;
            } else if (row === b.bot) {
                lines += `<line x1="${x}" y1="0" x2="${x}" y2="${mid}" stroke="${col}" stroke-width="1.5"/>`;
                lines += `<line x1="${x}" y1="${mid}" x2="${svgW}" y2="${mid}" stroke="${col}" stroke-width="1.5"/>`;
                if (row === b.tgt) lines += `<polygon points="${svgW},${mid} ${svgW-4},${mid-3} ${svgW-4},${mid+3}" fill="${col}"/>`;
            } else {
                lines += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${col}" stroke-width="1.5"/>`;
            }
        }
        if (lines) {
            result.push(`<svg class="br-svg" width="${svgW}" height="${h}">${lines}</svg>`);
        } else {
            result.push('');
        }
    }
    return { html: result, hasBranches: true, svgW };
}

const _deviceRegNames = {
    'LED':    ['LED0','LED1','LED2','LED3','LED4','LED5'],
    'UART':   ['TxData','RxData','Status','BaudDiv'],
    'Button': ['State','Edge','Mask'],
    'Timer':  ['Count','Reload','Control','Status'],
    'Display':['Cmd','Data','Status','CursorX','CursorY']
};

function _regName(pet, offset) {
    if (!pet) return null;
    const regs = _deviceRegNames[pet];
    return (regs && offset >= 0 && offset < regs.length) ? regs[offset] : null;
}

/**
 * Apply a text transform only to the text-node portions of an HTML string,
 * skipping over HTML tags (<...>) and HTML entities (&...;) unchanged.
 * This prevents hover-span injection into tag markup or attribute values,
 * and ensures the transform cannot match across span boundaries even when
 * _highlightCLOOMCSource has already split the text into .lump-hl-* spans.
 */
function _transformTextNodes(html, transform) {
    return html.replace(/(<[^>]*>|&[^;]+;)|([^<&]+)/g, function(m, markup, text) {
        if (markup !== undefined) return markup;
        return text ? transform(text) : m;
    });
}

function _wrapCRHover(html) {
    return _transformTextNodes(html, function(text) {
        return text.replace(/\bCR(1[0-5]|[0-9])\b/g, function(m, d) {
            const n = parseInt(d, 10);
            return `<span class="cr-hover-target" onmouseenter="showCRPopup(event,${n})" onmouseleave="hideCRPopup()">${m}</span>`;
        });
    });
}

function _wrapDRHover(html) {
    return _transformTextNodes(html, function(text) {
        return text.replace(/\bDR(1[0-5]|[0-9])\b/g, function(m, d) {
            const n = parseInt(d, 10);
            return `<span class="dr-hover-target" onmouseenter="showDRPopup(event,${n})" onmouseleave="hideCRPopup()">${m}</span>`;
        });
    });
}

function _wrapRegHover(html) {
    return _wrapDRHover(_wrapCRHover(html));
}

function _wrapCListHover(html, clistBase, cc) {
    if (!clistBase || clistBase <= 0) return html;
    const ccArg = (cc > 0) ? `,${cc}` : '';
    return html.replace(
        /(<span[^>]*onmouseenter="showCRPopup\(event,6\)"[^>]*>CR6<\/span>)(\[0x([0-9A-Fa-f]+)\])/g,
        function(m, _cr6Span, slotBracket, hexDigits) {
            const slotIdx = parseInt(hexDigits, 16);
            const newCR6 = `<span class="cr-hover-target clist-cr6-hover" onmouseenter="showCListPopup(event,${clistBase}${ccArg})" onmouseleave="hideCRPopup()">CR6</span>`;
            const newSlot = `<span class="clist-slot-hover" onmouseenter="showCListSlotPopup(event,${clistBase},${slotIdx}${ccArg})" onmouseleave="hideCRPopup()">${slotBracket}</span>`;
            return newCR6 + newSlot;
        }
    );
}

/**
 * Annotate raw disassembly text: find CR6[0xNNNN] patterns and replace the
 * bracket portion with a pet-name tooltip span.
 *
 * Must be called on PLAIN disassembly text BEFORE _applyMethodCRNames /
 * _wrapRegHover so that pet-name substitution of CR6 (e.g. "NS(CR6)") does
 * not push the bracket away from the CR6 token and break the pattern.
 *
 * CR6 == "My List" — slot names come from _resolveClistPetName which reads
 * the actual runtime c-list and sim.nsLabels, NOT abstractionRegistry.
 */
function _annotateRawClistSlot(text, clistBase, nsIdx) {
    if (!text) return text;
    return text.replace(/CR6\[0x([0-9A-Fa-f]+)\]/g, function(m, hex) {
        const slotIdx = parseInt(hex, 16);
        const label = _resolveClistPetName(clistBase || 0, slotIdx, nsIdx);
        if (!label) return m;
        const safe = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `CR6<span class="clist-petname-ref" ` +
               `onmouseenter="showPetNameTip(event,'${safe}')" ` +
               `onmouseleave="hidePetNameTip()">[0x${hex}]</span>`;
    });
}

function _crTag(crNum, crPets) {
    const pet = crPets && crPets[crNum];
    return pet ? `${pet.toLowerCase()}(CR${crNum})` : `CR${crNum}`;
}

function _drTag(drNum) {
    const pet = _petNameDRMap[drNum];
    return pet ? `${pet}(DR${drNum})` : `DR${drNum}`;
}

/**
 * Post-process a disassembly string to replace "DRN" tokens with
 * "petName(DRN)" using per-method pet_names first, falling back to the
 * global _petNameDRMap.  Returns the input string unchanged when no names
 * are available.
 */
function _applyMethodDRNames(text, methodObj) {
    const own = (((methodObj && methodObj.pet_names) || {}).DR) || {};
    let drMap;
    if (Object.keys(own).length > 0) {
        drMap = {};
        for (const [k, v] of Object.entries(own)) drMap[parseInt(k)] = v;
    } else if (Object.keys(_petNameDRMap).length > 0) {
        drMap = _petNameDRMap;
    } else {
        return text;
    }
    return text.replace(/\bDR(\d+)\b/g, (match, numStr) => {
        const pet = drMap[parseInt(numStr)];
        return pet ? `${pet}(DR${numStr})` : match;
    });
}

function _applyCRNames(text) {
    return _applyMethodCRNames(text, null);
}

/**
 * Look up the method object from _lumpManifests[nsIdx]._methods that contains
 * the given 0-based code-region offset.  Returns null when not found.
 */
function _methodAtOffset(nsIdx, codeOffset) {
    const manifest = _lumpManifests[nsIdx];
    if (!manifest) return null;
    const methods = manifest._methods;
    if (!methods) return null;
    for (const m of methods) {
        if (typeof m.offset !== 'number' || m.aliasOf) continue;
        const len = typeof m.length === 'number' ? m.length : ((m.code && m.code.length) || 0);
        if (codeOffset >= m.offset && codeOffset < m.offset + len) return m;
    }
    return null;
}

/**
 * Post-process a disassembly string to replace "CRN" tokens with
 * "petName(CRN)" using per-method pet_names first, falling back to the
 * global _petNameCRMap.  Returns the input string unchanged when no names
 * are available.
 */
function _applyMethodCRNames(text, methodObj) {
    const own = (((methodObj && methodObj.pet_names) || {}).CR) || {};
    let crMap;
    if (Object.keys(own).length > 0) {
        crMap = {};
        for (const [k, v] of Object.entries(own)) crMap[parseInt(k)] = v;
    } else if (_petNameCRMap && Object.keys(_petNameCRMap).length > 0) {
        crMap = _petNameCRMap;
    } else {
        return text;
    }
    return text.replace(/\bCR(\d+)\b/g, (match, numStr) => {
        const pet = crMap[parseInt(numStr)];
        return pet ? `${pet}(CR${numStr})` : match;
    });
}

function _decompileWord(word, addr, nsIdx, clistBase, crPets) {
    word = word >>> 0;
    if (word === 0) return null;
    const opcode = (word >>> 27) & 0x1F;
    const cond = (word >>> 23) & 0xF;
    const crDst = (word >>> 19) & 0xF;
    const crSrc = (word >>> 15) & 0xF;
    const imm = word & 0x7FFF;

    if (opcode === 0x1F) return null;

    const _condNames = ['EQ','NE','CS','CC','MI','PL','VS','VC','HI','LS','GE','LT','GT','LE','','NV'];
    const _condDescs = ['if equal to zero','if not equal to zero','if carry set','if carry clear',
        'if negative','if positive/zero','if overflow','if no overflow',
        'if unsigned higher','if unsigned lower/same','if signed \u2265','if signed <',
        'if signed >','if signed \u2264','','never'];
    const cc = cond === 14 ? '' : _condNames[cond];
    const ccDesc = cond === 14 ? '' : ` [${_condDescs[cond]}]`;

    const stored = _lumpManifests[nsIdx];

    if (opcode === 0 && crSrc === 6) {
        const pet = _resolveClistPetName(clistBase, imm, nsIdx);
        if (pet) {
            if (crPets) crPets[crDst] = pet;
            return { desc: _escDecomp(`load${cc} ${pet.toLowerCase()} \u2192 CR${crDst}${ccDesc}`), compiler: true, pet: pet };
        }
        if (crPets) delete crPets[crDst];
        return { desc: _escDecomp(`load${cc} clist[${imm}] \u2192 CR${crDst}${ccDesc}`), compiler: true };
    }

    if (opcode === 0) {
        const dTag = _crTag(crDst, crPets);
        const sTag = _crTag(crSrc, crPets);
        if (crPets && crPets[crSrc]) crPets[crDst] = crPets[crSrc];
        return { desc: _escDecomp(`load${cc} ${dTag} \u2190 ${sTag}[${imm}]${ccDesc}`), compiler: false };
    }

    if (opcode === 1) {
        const dTag = _crTag(crDst, crPets);
        const sTag = _crTag(crSrc, crPets);
        return { desc: _escDecomp(`save${cc} ${dTag} \u2192 ${sTag}[${imm}]${ccDesc}`), compiler: false };
    }

    if (opcode === 2) {
        if (crDst === 6) return { desc: _escDecomp(`recall${cc} self${ccDesc}`), compiler: false };
        const tag = _crTag(crDst, crPets);
        let methodStr = '';
        const pet = crPets && crPets[crDst];
        if (pet && typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') {
            const conv = METHOD_REGISTER_CONVENTIONS[pet];
            if (conv) {
                let dr3Val = null;
                if (sim && sim.memory && addr > 0) {
                    const prevW = sim.memory[addr - 1] >>> 0;
                    const prevOp = (prevW >>> 27) & 0x1F;
                    const prevDst = (prevW >>> 19) & 0xF;
                    const prevImm = prevW & 0x7FFF;
                    if (prevOp === 15 && prevDst === 3 && (prevImm & 0x4000)) {
                        dr3Val = prevImm & 0x3FFF;
                    }
                    if (dr3Val === null) {
                        const prev2W = addr > 1 ? (sim.memory[addr - 2] >>> 0) : 0;
                        const p2Op = (prev2W >>> 27) & 0x1F;
                        const p2Dst = (prev2W >>> 19) & 0xF;
                        const p2Imm = prev2W & 0x7FFF;
                        if (p2Op === 15 && p2Dst === 3 && (p2Imm & 0x4000)) {
                            dr3Val = p2Imm & 0x3FFF;
                        }
                    }
                }
                if (dr3Val === null && sim && sim.dr) {
                    dr3Val = sim.dr[3] >>> 0;
                }
                if (dr3Val !== null) {
                    const mEntry = Object.entries(conv).find(([, v]) => v.index === dr3Val);
                    if (mEntry) methodStr = `.${mEntry[0]}`;
                }
            }
        }
        return { desc: _escDecomp(`call${cc} ${tag}${methodStr}${ccDesc}`), compiler: false };
    }

    if (opcode === 3) return { desc: _escDecomp(`return${cc}${ccDesc}`), compiler: false };

    if (opcode === 4) {
        const dTag = _crTag(crDst, crPets);
        return { desc: _escDecomp(`change${cc} ${dTag}, ${imm}${ccDesc}`), compiler: false };
    }

    if (opcode === 5) {
        const sTag = _crTag(crSrc, crPets);
        return { desc: _escDecomp(`switch${cc} ${sTag}, ${imm & 7}${ccDesc}`), compiler: false };
    }

    if (opcode === 6) {
        const dTag = _crTag(crDst, crPets);
        const presetNames = ['CLEAR','R','RW','X','RX','RWX','L','S','E','LS'];
        const presetDescs = ['remove all perms','read only','read+write','execute only',
            'read+execute','read+write+execute','load only','store only','enter only','load+store'];
        const pidx = imm & 0xF;
        const bFlag = (imm >>> 4) & 1;
        const pName = presetNames[pidx] || `0x${pidx.toString(16)}`;
        const pDesc = presetDescs[pidx] || '';
        const bStr = bFlag ? 'B' : '';
        const explain = pDesc ? ` [${pDesc}${bStr ? ', bounded' : ''}]` : '';
        return { desc: _escDecomp(`tperm${cc} ${dTag} ${pName}${bStr}${explain}${ccDesc}`), compiler: false };
    }

    if (opcode === 7) {
        const dTag = _crTag(crDst, crPets);
        return { desc: _escDecomp(`lambda${cc} \u2192 ${dTag}${ccDesc}`), compiler: false };
    }

    if (opcode === 8) {
        const pet = _resolveClistPetName(clistBase, imm, nsIdx);
        if (pet) {
            if (crPets) crPets[crDst] = pet;
            let eMethodStr = '';
            if (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') {
                const eConv = METHOD_REGISTER_CONVENTIONS[pet];
                if (eConv) {
                    let eDr3 = null;
                    if (sim && sim.memory && addr > 0) {
                        const ePrev = sim.memory[addr - 1] >>> 0;
                        if (((ePrev >>> 27) & 0x1F) === 15 && ((ePrev >>> 19) & 0xF) === 3 && (ePrev & 0x4000)) {
                            eDr3 = ePrev & 0x3FFF;
                        }
                    }
                    if (eDr3 === null && sim && sim.dr) eDr3 = sim.dr[3] >>> 0;
                    if (eDr3 !== null) {
                        const eM = Object.entries(eConv).find(([, v]) => v.index === eDr3);
                        if (eM) eMethodStr = `.${eM[0]}`;
                    }
                }
            }
            return { desc: _escDecomp(`eloadcall${cc} ${pet.toLowerCase()}${eMethodStr}(CR${crDst})${ccDesc}`), compiler: true, pet: pet };
        }
        return { desc: _escDecomp(`eloadcall${cc} clist[${imm}] \u2192 CR${crDst}${ccDesc}`), compiler: true };
    }

    if (opcode === 9) {
        const dTag = _crTag(crDst, crPets);
        const sTag = _crTag(crSrc, crPets);
        return { desc: _escDecomp(`xloadlambda${cc} ${dTag} \u2190 ${sTag}[${imm}]${ccDesc}`), compiler: false };
    }

    if (opcode === 10 || opcode === 11) {
        const sTag = _crTag(crSrc, crPets);
        const verb = opcode === 10 ? 'read' : 'write';
        const pet = crPets && crPets[crSrc];
        const rn = _regName(pet, imm);
        const offStr = rn ? `.${rn}` : `[${imm}]`;
        const drV = sim && sim.dr ? (sim.dr[crDst] >>> 0) : null;
        let valStr = '';
        if (drV !== null) {
            const nsCheckIdx = sim.cr && sim.cr[crSrc] ? sim.parseGT(sim.cr[crSrc].word0).index : -1;
            if (nsCheckIdx === 12) {
                const ledNow = (opcode === 11 && sim.ledBits !== undefined && sim.ledMode === 'program') ? (sim.ledBits >> imm) & 1 : null;
                if (ledNow !== null) {
                    const willBe = drV & 1 ? 'ON' : 'OFF';
                    const was = ledNow ? 'ON' : 'OFF';
                    const transition = (ledNow & 1) === (drV & 1) ? `turns ${willBe}` : `${was} \u2192 ${willBe}`;
                    valStr = ` (LED${imm}: ${transition})`;
                } else {
                    valStr = ` (=${drV} \u2192 LED${imm} ${drV & 1 ? 'ON' : 'OFF'})`;
                }
            } else if (nsCheckIdx === 11) {
                const uartReg = imm === 0 ? 'TX' : imm === 1 ? 'STATUS' : 'RX';
                valStr = ` (=${drV} → UART.${uartReg})`;
            } else if (nsCheckIdx === 14) {
                const tReg = ['TICKS_LO','TICKS_HI','TOD_EPOCH','ALARM_CMP','ALARM_CTL'][imm] || 'reg';
                valStr = ` (=${drV} → TIMER.${tReg})`;
            } else {
                valStr = ` (=${_fmtVal(drV)})`;
            }
        }
        return { desc: _escDecomp(`${verb}${cc} ${_drTag(crDst)}, ${sTag}${offStr}${valStr}${ccDesc}`), compiler: false };
    }

    if (opcode === 12) {
        const pos = (imm >>> 5) & 0x1F;
        const width = imm & 0x1F;
        const srcV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        const valStr = srcV !== null ? ` (=${_fmtVal(srcV)})` : '';
        return { desc: _escDecomp(`bfext${cc} ${_drTag(crDst)} \u2190 ${_drTag(crSrc)}[${pos}:${pos+width-1}]${valStr}${ccDesc}`), compiler: false };
    }

    if (opcode === 13) {
        const pos = (imm >>> 5) & 0x1F;
        const width = imm & 0x1F;
        const srcV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        const valStr = srcV !== null ? ` (=${_fmtVal(srcV)})` : '';
        return { desc: _escDecomp(`bfins${cc} ${_drTag(crDst)}[${pos}:${pos+width-1}] \u2190 ${_drTag(crSrc)}${valStr}${ccDesc}`), compiler: false };
    }

    if (opcode === 14) {
        const dV = sim && sim.dr ? (sim.dr[crDst] >>> 0) : null;
        const sV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        const vals = (dV !== null && sV !== null) ? ` (${_fmtVal(dV)} vs ${_fmtVal(sV)})` : '';
        return { desc: _escDecomp(`mcmp${cc} ${_drTag(crDst)}, ${_drTag(crSrc)}${vals}${ccDesc}`), compiler: false };
    }

    if (opcode === 15 || opcode === 16) {
        const op = opcode === 15 ? '+' : '\u2212';
        const isImm = (imm & 0x4000) !== 0;
        const srcV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        if (isImm) {
            const immVal = imm & 0x3FFF;
            const res = opcode === 15 ? ((srcV + immVal) >>> 0) : ((srcV - immVal) >>> 0);
            const valStr = srcV !== null ? ` (${_fmtVal(srcV)}${op}${immVal}=${_fmtVal(res)})` : '';
            return { desc: _escDecomp(`${_drTag(crDst)}= ${_drTag(crSrc)} ${op} #${immVal}${valStr}${ccDesc}`), compiler: false };
        } else {
            const drOp = imm & 0xF;
            const opV = sim && sim.dr ? (sim.dr[drOp] >>> 0) : null;
            const res = opcode === 15 ? ((srcV + opV) >>> 0) : ((srcV - opV) >>> 0);
            const valStr = (srcV !== null && opV !== null) ? ` (${_fmtVal(srcV)}${op}${_fmtVal(opV)}=${_fmtVal(res)})` : '';
            return { desc: _escDecomp(`${_drTag(crDst)}= ${_drTag(crSrc)} ${op} ${_drTag(drOp)}${valStr}${ccDesc}`), compiler: false };
        }
    }

    if (opcode === 17) {
        const soff = (imm & 0x4000) ? (imm | 0xFFFF8000) : imm;
        const condLabel = cc || 'AL';
        const condExplain = cond === 14 ? ' [always]' : ` [${_condDescs[cond]}]`;
        return { desc: _escDecomp(`branch${cc} ${soff > 0 ? '+' : ''}${soff}${condExplain}`), compiler: false };
    }

    if (opcode === 18) {
        const shamt = imm & 0x1F;
        const srcV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        const res = (srcV << shamt) >>> 0;
        const valStr = srcV !== null ? ` (${_fmtVal(srcV)}\u00AB${shamt}=${_fmtVal(res)})` : '';
        return { desc: _escDecomp(`${_drTag(crDst)}= ${_drTag(crSrc)} \u00AB ${shamt}${valStr}${ccDesc}`), compiler: false };
    }

    if (opcode === 19) {
        const arith = (imm >>> 5) & 1;
        const shamt = imm & 0x1F;
        const srcV = sim && sim.dr ? (sim.dr[crSrc] >>> 0) : null;
        const sym = arith ? '\u00BB\u00BB' : '\u00BB';
        const res = arith ? (srcV >> shamt) : (srcV >>> shamt);
        const valStr = srcV !== null ? ` (${_fmtVal(srcV)}${sym}${shamt}=${_fmtVal(res)})` : '';
        return { desc: _escDecomp(`${_drTag(crDst)}= ${_drTag(crSrc)} ${sym} ${shamt}${valStr}${ccDesc}`), compiler: false };
    }

    if (stored && stored[addr]) {
        const s = stored[addr];
        return { desc: _escDecomp(s.desc), compiler: s.compiler };
    }

    return null;
}

function _fmtVal(v) {
    v = v >>> 0;
    if (v <= 9999) return String(v);
    return '0x' + v.toString(16).toUpperCase();
}

function _escDecomp(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

