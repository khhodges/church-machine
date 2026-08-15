// ── Editor Find / Find & Replace ─────────────────────────────────────────
// Scoped entirely to the #asmEditor textarea.
// Public API (all window-exposed):
//   _editorFindOpen(replaceMode)  — open bar; true = Find & Replace mode
//   _editorFindClose()            — close bar
//   _editorFindNext()             — next match
//   _editorFindPrev()             — previous match
//   _editorFindReplace()          — replace current match and advance
//   _editorFindReplaceAll()       — replace all matches
// ─────────────────────────────────────────────────────────────────────────
(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────────
    var _matches  = [];   // [{start, end}, …]
    var _matchIdx = -1;   // index of the highlighted match
    var _replMode = false;

    // ── DOM helpers ────────────────────────────────────────────────────────
    function _el(id) { return document.getElementById(id); }

    function _ed()  { return _el('asmEditor'); }

    // ── Open ───────────────────────────────────────────────────────────────
    function _editorFindOpen(replaceMode) {
        _replMode = !!replaceMode;
        var bar      = _el('editorFindBar');
        var replRow  = _el('editorReplaceRow');
        if (!bar) return;

        bar.style.display = 'flex';
        if (replRow) replRow.style.display = _replMode ? 'flex' : 'none';

        // Pre-populate search field from current selection (single line only)
        var ed  = _ed();
        var inp = _el('editorFindInput');
        if (ed && inp) {
            var sel = ed.value.substring(ed.selectionStart, ed.selectionEnd);
            if (sel && sel.length < 200 && !sel.includes('\n')) {
                inp.value = sel;
            }
        }
        if (inp) { inp.focus(); inp.select(); }
        _update();
    }
    window._editorFindOpen = _editorFindOpen;

    // ── Close ──────────────────────────────────────────────────────────────
    function _editorFindClose() {
        var bar = _el('editorFindBar');
        if (bar) bar.style.display = 'none';
        _matches  = [];
        _matchIdx = -1;
        _setCount('');
        var ed = _ed();
        if (ed) ed.focus();
    }
    window._editorFindClose = _editorFindClose;

    // ── Core search ────────────────────────────────────────────────────────
    function _update() {
        var inp      = _el('editorFindInput');
        var caseChk  = _el('editorFindCase');
        var wordChk  = _el('editorFindWord');
        var ed       = _ed();
        if (!inp || !ed) return;

        var needle   = inp.value;
        inp.classList.remove('editor-find-no-match');
        _matches  = [];
        _matchIdx = -1;

        if (!needle) { _setCount(''); return; }

        var caseSensitive = caseChk && caseChk.checked;
        var wholeWord     = wordChk && wordChk.checked;
        var text    = ed.value;
        var hayText = caseSensitive ? text   : text.toLowerCase();
        var pin     = caseSensitive ? needle : needle.toLowerCase();
        var nLen    = pin.length;

        var pos = 0;
        while (pos <= hayText.length - nLen) {
            var idx = hayText.indexOf(pin, pos);
            if (idx === -1) break;
            if (wholeWord) {
                var pre  = idx > 0 ? hayText[idx - 1] : ' ';
                var post = idx + nLen < hayText.length ? hayText[idx + nLen] : ' ';
                if (/\W/.test(pre) && /\W/.test(post)) {
                    _matches.push({ start: idx, end: idx + nLen });
                }
            } else {
                _matches.push({ start: idx, end: idx + nLen });
            }
            pos = idx + 1;
        }

        if (_matches.length === 0) {
            inp.classList.add('editor-find-no-match');
            _setCount('No matches');
            return;
        }

        // Stay on the match closest to the current cursor
        var cur   = ed.selectionStart;
        var best  = 0;
        var bestD = Math.abs(_matches[0].start - cur);
        for (var i = 1; i < _matches.length; i++) {
            var d = Math.abs(_matches[i].start - cur);
            if (d < bestD) { bestD = d; best = i; }
        }
        _goto(best);
    }
    window._editorFindUpdate = _update;

    // ── Navigation ─────────────────────────────────────────────────────────
    function _goto(idx) {
        var ed = _ed();
        if (!ed || _matches.length === 0) return;
        _matchIdx = ((idx % _matches.length) + _matches.length) % _matches.length;
        var m = _matches[_matchIdx];
        // Only pull focus into the editor when the user explicitly navigated
        // (Next / Prev / Enter).  When called from _update() the find input
        // still has focus — stealing it here causes the one-character-per-click
        // bug where every keystroke refocuses the editor and the user has to
        // click the input again to type the next character.
        var _active = document.activeElement;
        var _inp    = _el('editorFindInput');
        var _rInp   = _el('editorReplaceInput');
        var _findHasFocus = (_active && (_active === _inp || _active === _rInp));
        if (!_findHasFocus) ed.focus();
        ed.setSelectionRange(m.start, m.end);
        _scrollTo(ed, m.start);
        _setCount((_matchIdx + 1) + ' / ' + _matches.length);
    }

    function _scrollTo(ed, pos) {
        // Estimate the Y offset of pos and scroll the textarea
        var text       = ed.value.substring(0, pos);
        var lineNo     = (text.match(/\n/g) || []).length;
        var lineHeight = parseFloat(window.getComputedStyle(ed).lineHeight) || 18;
        var approxTop  = lineNo * lineHeight;
        ed.scrollTop   = Math.max(0, approxTop - ed.clientHeight / 2);
    }

    function _editorFindNext() {
        if (_matches.length === 0) { _update(); return; }
        _goto(_matchIdx + 1);
    }
    window._editorFindNext = _editorFindNext;

    function _editorFindPrev() {
        if (_matches.length === 0) { _update(); return; }
        _goto(_matchIdx - 1);
    }
    window._editorFindPrev = _editorFindPrev;

    // ── Replace ────────────────────────────────────────────────────────────
    function _editorFindReplace() {
        var ed       = _ed();
        var replInp  = _el('editorReplaceInput');
        if (!ed || !replInp || _matches.length === 0 || _matchIdx < 0) return;
        var m        = _matches[_matchIdx];
        var repl     = replInp.value;
        var val      = ed.value;
        ed.value     = val.substring(0, m.start) + repl + val.substring(m.end);
        ed.setSelectionRange(m.start, m.start + repl.length);
        ed.dispatchEvent(new Event('input'));  // trigger dirty tracking
        _update();
        _editorFindNext();
    }
    window._editorFindReplace = _editorFindReplace;

    function _editorFindReplaceAll() {
        var ed      = _ed();
        var replInp = _el('editorReplaceInput');
        if (!ed || !replInp) return;
        _update();  // refresh match list with current search term
        if (_matches.length === 0) return;
        var repl   = replInp.value;
        var val    = ed.value;
        var count  = _matches.length;
        // Replace back-to-front so earlier offsets stay valid
        for (var i = _matches.length - 1; i >= 0; i--) {
            var m = _matches[i];
            val   = val.substring(0, m.start) + repl + val.substring(m.end);
        }
        ed.value = val;
        ed.dispatchEvent(new Event('input'));
        _matches  = [];
        _matchIdx = -1;
        _setCount(count + ' replaced');
    }
    window._editorFindReplaceAll = _editorFindReplaceAll;

    // ── Match counter & nav-button state ───────────────────────────────────
    function _setCount(text) {
        var el = _el('editorFindCount');
        if (el) el.textContent = text;
        var hasMatches = _matches.length > 0;
        var p = _el('editorFindPrev'), n = _el('editorFindNext');
        if (p) p.disabled = !hasMatches;
        if (n) n.disabled = !hasMatches;
    }

    // ── Wire up the bar's own inputs after the DOM is ready ────────────────
    function _wireBarEvents() {
        var inp     = _el('editorFindInput');
        var replInp = _el('editorReplaceInput');
        var caseChk = _el('editorFindCase');
        var wordChk = _el('editorFindWord');

        if (inp) {
            inp.addEventListener('input', _update);
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) _editorFindPrev(); else _editorFindNext();
                } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    _editorFindClose();
                }
            });
        }
        if (replInp) {
            replInp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); _editorFindReplace(); }
                else if (e.key === 'Escape') { e.stopPropagation(); _editorFindClose(); }
            });
        }
        if (caseChk) caseChk.addEventListener('change', _update);
        if (wordChk) wordChk.addEventListener('change', _update);

        var closeBtn   = _el('editorFindClose');
        var prevBtn    = _el('editorFindPrev');
        var nextBtn    = _el('editorFindNext');
        var replBtn    = _el('editorReplaceOne');
        var replAllBtn = _el('editorReplaceAll');

        if (closeBtn)   closeBtn.addEventListener('click', _editorFindClose);
        if (prevBtn)    prevBtn.addEventListener('click', _editorFindPrev);
        if (nextBtn)    nextBtn.addEventListener('click', _editorFindNext);
        if (replBtn)    replBtn.addEventListener('click', _editorFindReplace);
        if (replAllBtn) replAllBtn.addEventListener('click', _editorFindReplaceAll);
    }

    // ── Global Ctrl+F / Ctrl+H — only when editor view is visible ─────────
    // The asmEditor keydown handler (app-shell.js) handles it when the
    // textarea is focused; this global capture handles the rest.
    document.addEventListener('keydown', function (e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        var key = e.key.toLowerCase();
        if (key !== 'f' && key !== 'h') return;
        // Only intercept when the editor view is visible
        var editorView = document.getElementById('editor');
        if (!editorView || editorView.style.display === 'none') return;
        e.preventDefault();
        if (key === 'f') _editorFindOpen(false);
        else             _editorFindOpen(true);
    }, true /* capture so we beat the browser's built-in Ctrl+F */);

    // ── Init ───────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _wireBarEvents);
    } else {
        _wireBarEvents();
    }
})();
