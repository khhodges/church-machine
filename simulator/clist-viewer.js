// clist-viewer.js
// C-List Viewer popup for the assembly editor toolbar.
// Shows every Golden Token in the current thread's C-List (CR6),
// with permissions, B/F bits, and pet name.
//
// Depends on globals set up by other simulator scripts:
//   sim           — ChurchMachineSim instance (app-shell.js)
//   _petNameCRMap — slot-indexed pet name map  (app-run.js)
//
// This file loads synchronously AFTER asm-instruction-picker.js, so
// window.AsmInstructionPicker is already defined at the point the IIFE runs.
// Mutual exclusion is wired without a polling loop:
//   • CListViewer.show() calls AsmInstructionPicker.hide() directly.
//   • AsmInstructionPicker.show is wrapped once, synchronously, at the
//     bottom of this file, to call CListViewer.hide() before showing.
//
// Public API: window.CListViewer = { show, hide, toggle, isVisible }

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    var DEFAULT_SHORTCUT = { code: 'KeyC', ctrl: true, shift: true };

    // ── State ─────────────────────────────────────────────────────────────────
    var popupEl      = null;
    var activeEditor = null;
    var focusedRow   = -1;

    // ── DOM helpers ───────────────────────────────────────────────────────────
    function getOrCreatePopup() {
        if (popupEl) return popupEl;
        popupEl = document.createElement('div');
        popupEl.className = 'clist-viewer-popup';
        popupEl.setAttribute('role', 'listbox');
        popupEl.setAttribute('aria-label', 'C-List viewer');
        document.body.appendChild(popupEl);

        // ── Delegated click handler: handles row clicks without inline onclick ─
        popupEl.addEventListener('click', function (e) {
            var row = e.target.closest('.clist-row[data-slot]');
            if (!row || row.classList.contains('clist-row--null')) return;
            insertCROperand(parseInt(row.dataset.slot, 10));
        });

        // ── Close on outside click ─────────────────────────────────────────────
        document.addEventListener('mousedown', function (e) {
            if (!popupEl) return;
            if (!popupEl.contains(e.target) &&
                !e.target.classList.contains('btn-clist-viewer')) {
                hideViewer();
            }
        });

        document.addEventListener('keydown', onDocKeyDown, true);
        return popupEl;
    }

    // ── Keyboard handler ──────────────────────────────────────────────────────
    function onDocKeyDown(e) {
        if (!isVisible()) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            hideViewer();
            return;
        }

        var rows = popupEl ? popupEl.querySelectorAll('.clist-row[data-slot]') : [];
        if (!rows.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusedRow = Math.min(focusedRow + 1, rows.length - 1);
            applyRowFocus(rows);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusedRow = Math.max(focusedRow - 1, 0);
            applyRowFocus(rows);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (focusedRow >= 0 && focusedRow < rows.length) {
                insertCROperand(parseInt(rows[focusedRow].dataset.slot, 10));
            }
        }
    }

    function applyRowFocus(rows) {
        rows.forEach(function (r, i) {
            if (i === focusedRow) {
                r.classList.add('clist-row--focused');
                r.scrollIntoView({ block: 'nearest' });
            } else {
                r.classList.remove('clist-row--focused');
            }
        });
    }

    // ── Insert CR operand into editor ─────────────────────────────────────────
    function insertCROperand(slotIdx) {
        var ed = activeEditor || document.getElementById('asmEditor');
        if (!ed) return;
        var token = 'CR' + slotIdx;
        var start = ed.selectionStart;
        var end   = ed.selectionEnd;
        var val   = ed.value;
        ed.value = val.slice(0, start) + token + val.slice(end);
        ed.selectionStart = ed.selectionEnd = start + token.length;
        ed.dispatchEvent(new Event('input', { bubbles: true }));
        hideViewer();
        ed.focus();
    }

    // ── Data helpers ──────────────────────────────────────────────────────────
    var PERM_LABELS = ['R', 'W', 'X', 'L', 'S', 'E'];
    var PERM_COLORS = {
        R: '#5b9aef',
        W: '#e07b54',
        X: '#7ecb61',
        L: '#b87ee0',
        S: '#e0d25b',
        E: '#f4b942',
    };

    function permChipsHtml(perms) {
        return PERM_LABELS.map(function (p) {
            var on = perms && perms[p];
            return '<span class="clist-perm-chip' + (on ? ' clist-perm-chip--on' : '') + '"' +
                   (on ? ' style="background:' + PERM_COLORS[p] + '22;color:' + PERM_COLORS[p] + ';border-color:' + PERM_COLORS[p] + '55;"' : '') +
                   '>' + p + '</span>';
        }).join('');
    }

    function buildContent() {
        /* global sim, _petNameCRMap */
        var s = (typeof sim !== 'undefined') ? sim : null;

        if (!s || !s.bootComplete) {
            return emptyState('No C-List loaded — boot a program first.');
        }

        var cr6 = s.cr && s.cr[6];
        if (!cr6 || (cr6.word0 >>> 0) === 0) {
            return emptyState('No C-List loaded — boot a program first.');
        }

        var clistBase  = cr6.word1 >>> 0;
        var clistCount = 0;
        try {
            clistCount = s.parseNSWord1(cr6.word2).clistCount;
        } catch (e) {
            clistCount = 0;
        }

        if (clistCount === 0) {
            return emptyState('No C-List loaded — boot a program first.');
        }

        var petMap = (typeof _petNameCRMap !== 'undefined') ? (_petNameCRMap || {}) : {};

        var html = '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List (CR6)</span>' +
            '<span class="clist-viewer-hint">\u2191\u2193 navigate \u00b7 Enter insert \u00b7 Esc close</span>' +
            '</div>' +
            '<div class="clist-viewer-body">';

        for (var i = 0; i < clistCount; i++) {
            var rawWord = (s.memory && s.memory[clistBase + i] !== undefined)
                ? (s.memory[clistBase + i] >>> 0)
                : 0;
            var isNull = rawWord === 0;

            if (isNull) {
                html += '<div class="clist-row clist-row--null" data-slot="' + i + '" tabindex="-1">' +
                    '<span class="clist-slot">CR' + i + '</span>' +
                    '<span class="clist-null-label">\u2014 null \u2014</span>' +
                    '</div>';
                continue;
            }

            var gt = {};
            try { gt = s.parseGT(rawWord); } catch (e) { gt = { permissions: {}, index: 0 }; }

            var nsIdx = gt.index || 0;
            var nsEntry = s.nsTable && s.nsTable[nsIdx];
            var bFlag = 0, fFlag = 0;
            if (nsEntry) {
                try {
                    var nsParsed = s.parseNSWord1(nsEntry.word1_limit);
                    bFlag = nsParsed.b || 0;
                    fFlag = nsParsed.f || 0;
                } catch (e2) { /* ignore */ }
            }

            var petName = petMap[i] || (s.nsLabels && s.nsLabels[nsIdx]) || '';

            html += '<div class="clist-row" data-slot="' + i + '" tabindex="-1">' +
                '<span class="clist-slot">CR' + i + '</span>' +
                '<span class="clist-perms">' + permChipsHtml(gt.permissions) + '</span>' +
                '<span class="clist-b-badge' + (bFlag ? ' clist-b-badge--on' : '') + '" title="Bind bit">B</span>' +
                '<span class="clist-f-badge' + (fFlag ? ' clist-f-badge--on' : '') + '" title="Fault-on-use bit">F</span>' +
                '<span class="clist-name">' + escHtml(petName || '\u2014') + '</span>' +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    function emptyState(msg) {
        return '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List (CR6)</span>' +
            '</div>' +
            '<div class="clist-viewer-empty">' + escHtml(msg) + '</div>';
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Position popup below the toolbar button ───────────────────────────────
    function positionPopup() {
        var btn = document.querySelector('.btn-clist-viewer');
        var popup = getOrCreatePopup();
        if (!btn) {
            popup.style.left = '8px';
            popup.style.top = '80px';
            return;
        }
        var rect = btn.getBoundingClientRect();
        var popupW = 480;
        var left = rect.left;
        var top  = rect.bottom + 4;

        if (left + popupW > window.innerWidth) left = window.innerWidth - popupW - 8;
        if (left < 4) left = 4;

        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
    }

    // ── Public API ────────────────────────────────────────────────────────────
    function showViewer() {
        // Mutual exclusion: close the instruction picker if open
        if (window.AsmInstructionPicker && window.AsmInstructionPicker.hide) {
            window.AsmInstructionPicker.hide();
        }

        activeEditor = document.getElementById('asmEditor');
        focusedRow = -1;

        var popup = getOrCreatePopup();
        popup.innerHTML = buildContent();
        popup.style.display = 'flex';
        positionPopup();

        var btn = document.querySelector('.btn-clist-viewer');
        if (btn) btn.classList.add('btn-clist-viewer--active');
    }

    function hideViewer() {
        if (popupEl) popupEl.style.display = 'none';
        focusedRow = -1;
        var btn = document.querySelector('.btn-clist-viewer');
        if (btn) btn.classList.remove('btn-clist-viewer--active');
    }

    function toggleViewer() {
        if (isVisible()) hideViewer();
        else showViewer();
    }

    function isVisible() {
        return !!(popupEl && popupEl.style.display !== 'none');
    }

    // ── Keyboard shortcut (Ctrl+Shift+C / Cmd+Shift+C) ───────────────────────
    document.addEventListener('keydown', function (e) {
        var cfg = (window.CListViewerConfig) ? window.CListViewerConfig : DEFAULT_SHORTCUT;
        var wantCtrl  = (cfg.ctrl  !== undefined) ? cfg.ctrl  : DEFAULT_SHORTCUT.ctrl;
        var wantShift = (cfg.shift !== undefined) ? cfg.shift : DEFAULT_SHORTCUT.shift;
        var wantCode  = cfg.code || DEFAULT_SHORTCUT.code;
        var ctrlOrCmd = e.ctrlKey || e.metaKey;

        if (e.code === wantCode &&
            ctrlOrCmd === wantCtrl &&
            e.shiftKey === wantShift) {
            var ed = document.getElementById('asmEditor');
            if (!ed) return;
            e.preventDefault();
            toggleViewer();
        }
    });

    // Publish API first so the mutual-exclusion wrap below can reference it
    window.CListViewer = {
        show:      showViewer,
        hide:      hideViewer,
        toggle:    toggleViewer,
        isVisible: isVisible,
    };

    // ── Mutual exclusion: wrap AsmInstructionPicker.show synchronously ────────
    // clist-viewer.js loads after asm-instruction-picker.js in the same
    // <script> sequence, so window.AsmInstructionPicker is already defined here.
    // No polling timer is needed.
    if (window.AsmInstructionPicker && window.AsmInstructionPicker.show) {
        var _origPickerShow = window.AsmInstructionPicker.show;
        window.AsmInstructionPicker.show = function () {
            hideViewer();
            return _origPickerShow.apply(this, arguments);
        };
    }

}());
