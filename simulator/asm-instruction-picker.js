// asm-instruction-picker.js
// New-line instruction picker popup for assembler editors (web IDE + simulator)
// Appears when Enter is pressed and cursor lands on a fresh blank line.
//
// SYNC NOTE: The instruction categories and items below must stay in sync with
// the right-click context menu defined in web/index.html (#codeContextMenu).
// When adding or removing instructions from that menu, update INSTR_CATEGORIES
// here too, then copy this file to simulator/asm-instruction-picker.js.

(function () {
    'use strict';

    var INSTR_CATEGORIES = [
        {
            name: 'Capability', icon: '\uD83D\uDD11', items: [
                { label: 'LOAD destCR srcCR idx', instr: 'LOAD',   ops: 'destCR srcCR idx' },
                { label: 'SAVE destCR srcDR',     instr: 'SAVE',   ops: 'destCR srcDR' },
                { label: 'CALL cr',               instr: 'CALL',   ops: 'cr' },
                { label: 'RETURN',                instr: 'RETURN', ops: '' },
                { label: 'CHANGE offset',         instr: 'CHANGE', ops: 'offset' },
                { label: 'SWITCH cr',             instr: 'SWITCH', ops: 'cr' },
                { label: 'TPERM cr mask',             instr: 'TPERM',       ops: 'cr mask' },
                { label: 'LAMBDA cr',                 instr: 'LAMBDA',      ops: 'cr' },
                { label: 'ELOADCALL cr name',         instr: 'ELOADCALL',   ops: 'cr name' },
                { label: 'XLOADLAMBDA cr name',       instr: 'XLOADLAMBDA', ops: 'cr name' },
            ]
        },
        {
            name: 'Arithmetic', icon: '+', items: [
                { label: 'ADD dest src',   instr: 'ADD',  ops: 'dest src' },
                { label: 'SUB dest src',   instr: 'SUB',  ops: 'dest src' },
                { label: 'MUL dest src',   instr: 'MUL',  ops: 'dest src' },
                { label: 'NEG dest src',   instr: 'NEG',  ops: 'dest src' },
                { label: 'ADDI dest imm',  instr: 'ADDI', ops: 'dest imm' },
                { label: 'SUBI dest imm',  instr: 'SUBI', ops: 'dest imm' },
            ]
        },
        {
            name: 'Logic', icon: '&', items: [
                { label: 'AND dest src', instr: 'AND', ops: 'dest src' },
                { label: 'ORR dest src', instr: 'ORR', ops: 'dest src' },
                { label: 'EOR dest src', instr: 'EOR', ops: 'dest src' },
                { label: 'BIC dest src', instr: 'BIC', ops: 'dest src' },
                { label: 'NOT dest src', instr: 'NOT', ops: 'dest src' },
            ]
        },
        {
            name: 'Move', icon: '\u2192', items: [
                { label: 'MOV dest src',        instr: 'MOV',    ops: 'dest src' },
                { label: 'MVN dest src',        instr: 'MVN',    ops: 'dest src' },
                { label: 'DREAD dr cr addr',    instr: 'DREAD',  ops: 'dr cr addr' },
                { label: 'DWRITE dr cr addr',   instr: 'DWRITE', ops: 'dr cr addr' },
            ]
        },
        {
            name: 'Shift', icon: '\u27f7', items: [
                { label: 'LSL dest src amt', instr: 'LSL', ops: 'dest src amt' },
                { label: 'LSR dest src amt', instr: 'LSR', ops: 'dest src amt' },
                { label: 'ASR dest src amt', instr: 'ASR', ops: 'dest src amt' },
                { label: 'ROR dest src amt', instr: 'ROR', ops: 'dest src amt' },
            ]
        },
        {
            name: 'Compare', icon: '=', items: [
                { label: 'CMP r1 r2', instr: 'CMP', ops: 'r1 r2' },
                { label: 'CMN r1 r2', instr: 'CMN', ops: 'r1 r2' },
                { label: 'TST r1 r2', instr: 'TST', ops: 'r1 r2' },
                { label: 'TEQ r1 r2', instr: 'TEQ', ops: 'r1 r2' },
            ]
        },
        {
            name: 'Branch', icon: '\u21b7', items: [
                { label: 'B offset',      instr: 'B',  ops: 'offset' },
                { label: 'B EQ offset',   instr: 'B',  ops: 'EQ offset' },
                { label: 'B NE offset',   instr: 'B',  ops: 'NE offset' },
                { label: 'B GT offset',   instr: 'B',  ops: 'GT offset' },
                { label: 'B LT offset',   instr: 'B',  ops: 'LT offset' },
                { label: 'BL offset',     instr: 'BL', ops: 'offset' },
            ]
        },
        {
            name: 'C-List', icon: '\uD83D\uDD11', items: []   // populated dynamically at showPicker()
        },
        {
            name: 'Namespace', icon: '\u25C6', items: []   // populated dynamically at showPicker() from sim.nsLabels
        },
    ];

    // Flat list of every item across all categories (rebuilt by rebuildSourceIndex)
    var allSourceItems = [];

    // WeakMap: item object → category name (rebuilt by rebuildSourceIndex)
    var itemCategoryMap = new WeakMap();

    function rebuildSourceIndex() {
        allSourceItems = [];
        itemCategoryMap = new WeakMap();
        INSTR_CATEGORIES.forEach(function (cat) {
            cat.items.forEach(function (item) {
                allSourceItems.push(item);
                itemCategoryMap.set(item, cat.name);
            });
        });
    }

    // Populate the C-List category from METHOD_REGISTER_CONVENTIONS (app-absdetail.js).
    // Runs every time the picker opens so new abstractions added at runtime appear.
    function refreshCListItems() {
        var clistCat = null;
        for (var ci = 0; ci < INSTR_CATEGORIES.length; ci++) {
            if (INSTR_CATEGORIES[ci].name === 'C-List') { clistCat = INSTR_CATEGORIES[ci]; break; }
        }
        if (!clistCat) return;
        clistCat.items = [];

        var conv = (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') ? METHOD_REGISTER_CONVENTIONS : null;
        if (!conv) { rebuildSourceIndex(); return; }

        Object.keys(conv).sort().forEach(function (absName) {
            // One LOAD entry per abstraction
            clistCat.items.push({
                label: 'LOAD  ' + absName,
                instr: 'LOAD',
                ops: 'CR0, ' + absName,
                _clistAbs: absName
            });
            // One ELOADCALL entry per method, sorted by method index
            var methods = conv[absName];
            var methodNames = Object.keys(methods).sort(function (a, b) {
                return ((methods[a] && methods[a].index) || 0) - ((methods[b] && methods[b].index) || 0);
            });
            methodNames.forEach(function (mName) {
                var mc = methods[mName];
                var hint = '';
                if (mc && mc.input && mc.input !== 'none') hint = '  \u2190 ' + mc.input;
                clistCat.items.push({
                    label: absName + '.' + mName + hint,
                    instr: 'ELOADCALL',
                    ops: 'CR0, ' + absName + ', ' + mName,
                    _clistAbs: absName
                });
            });
        });

        rebuildSourceIndex();
    }

    // Populate the Namespace category from sim.nsLabels (live simulator state) and
    // METHOD_REGISTER_CONVENTIONS (abstraction names known before simulation starts).
    // Each named GT slot becomes a LOAD snippet; the fuzzy filter narrows the list
    // immediately when the picker opens with a prefill string.
    function refreshNSItems() {
        var nsCat = null;
        for (var ci = 0; ci < INSTR_CATEGORIES.length; ci++) {
            if (INSTR_CATEGORIES[ci].name === 'Namespace') { nsCat = INSTR_CATEGORIES[ci]; break; }
        }
        if (!nsCat) return;
        nsCat.items = [];
        var seen = Object.create(null);

        // 1. Live namespace labels from the running simulator
        var simObj = (typeof sim !== 'undefined') ? sim : null;
        var liveLabels = (simObj && simObj.nsLabels) ? simObj.nsLabels : {};
        var slots = Object.keys(liveLabels).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
        slots.forEach(function (idx) {
            var name = liveLabels[idx];
            if (!name) return;
            var key = name.toUpperCase();
            if (seen[key]) return;
            seen[key] = true;
            nsCat.items.push({
                label: name + '  \u00b7 NS ' + idx,
                instr: 'LOAD',
                ops: 'CR11, ' + name,
                _nsSlot: parseInt(idx, 10),
                _nsName: name
            });
        });

        // 2. Abstraction names from METHOD_REGISTER_CONVENTIONS (pre-boot fallback)
        var conv = (typeof METHOD_REGISTER_CONVENTIONS !== 'undefined') ? METHOD_REGISTER_CONVENTIONS : null;
        if (conv) {
            Object.keys(conv).sort().forEach(function (absName) {
                var key = absName.toUpperCase();
                if (seen[key]) return;
                seen[key] = true;
                nsCat.items.push({
                    label: absName + '  \u00b7 abstraction',
                    instr: 'LOAD',
                    ops: 'CR11, ' + absName,
                    _nsName: absName
                });
            });
        }

        rebuildSourceIndex();
    }

    rebuildSourceIndex(); // initial build (static categories only; C-List and Namespace empty until showPicker)

    // ── Configurable shortcut ────────────────────────────────────────────────
    // Override before or after the script loads via window.AsmInstructionPickerConfig:
    //   window.AsmInstructionPickerConfig = { code: 'KeyI', ctrl: true };
    //
    // Supported fields (all optional — defaults shown):
    //   code  {string}  — KeyboardEvent.code value (default: 'Space')
    //   ctrl  {boolean} — require Ctrl (Windows/Linux) or Cmd (macOS) (default: true)
    //   shift {boolean} — require Shift (default: false)
    //   alt   {boolean} — require Alt/Option (default: false)
    var SHORTCUT_DEFAULTS = { code: 'Space', ctrl: true, shift: false, alt: false };

    function matchesPickerShortcut(e) {
        var cfg = window.AsmInstructionPickerConfig || {};
        var code  = cfg.code  !== undefined ? cfg.code  : SHORTCUT_DEFAULTS.code;
        var ctrl  = cfg.ctrl  !== undefined ? cfg.ctrl  : SHORTCUT_DEFAULTS.ctrl;
        var shift = cfg.shift !== undefined ? cfg.shift : SHORTCUT_DEFAULTS.shift;
        var alt   = cfg.alt   !== undefined ? cfg.alt   : SHORTCUT_DEFAULTS.alt;

        // Match by e.code (reliable) with e.key as a fallback for older browsers
        var codeMatch = (e.code === code) || (code === 'Space' && e.key === ' ');
        if (!codeMatch) return false;
        if (ctrl  ? !(e.ctrlKey || e.metaKey) : (e.ctrlKey || e.metaKey)) return false;
        if (shift ? !e.shiftKey : e.shiftKey) return false;
        if (alt   ? !e.altKey  : e.altKey)   return false;
        return true;
    }

    var pickerEl = null;
    var filterInputEl = null;
    var pickerBodyEl = null;
    var pickerTabsEl = null;
    var activeEditorEl = null;
    var selectedIndex = -1;
    var allFlatItems = [];   // items currently visible (filtered or all)
    var currentOnSelect = null;
    var activeCatName = null;  // null = All; otherwise the active category name string

    // ── DOM helpers ─────────────────────────────────────────────────────────

    function getOrCreatePicker() {
        if (!pickerEl) {
            pickerEl = document.createElement('div');
            pickerEl.id = 'asmInstrPicker';
            pickerEl.className = 'asm-instr-picker';
            pickerEl.setAttribute('role', 'listbox');
            pickerEl.setAttribute('aria-label', 'Instruction picker');
            pickerEl.style.display = 'none';
            document.body.appendChild(pickerEl);
        }
        return pickerEl;
    }

    function buildPickerContent(onSelect) {
        currentOnSelect = onSelect;
        var picker = getOrCreatePicker();
        picker.innerHTML = '';
        allFlatItems = [];
        selectedIndex = -1;
        filterInputEl = null;
        pickerBodyEl = null;
        pickerTabsEl = null;

        var header = document.createElement('div');
        header.className = 'asm-picker-header';
        header.textContent = 'Insert instruction \u00b7 \u2191\u2193 navigate \u00b7 Enter confirm \u00b7 Esc dismiss';
        picker.appendChild(header);

        // ── Category tabs ──────────────────────────────────────────────────
        pickerTabsEl = document.createElement('div');
        pickerTabsEl.className = 'asm-picker-tabs';
        INSTR_CATEGORIES.forEach(function (cat) {
            var tab = document.createElement('button');
            tab.className = 'asm-picker-tab' + (activeCatName === cat.name ? ' asm-picker-tab--active' : '');
            tab.textContent = cat.name;
            tab.addEventListener('mousedown', function (e) { e.preventDefault(); onTabSelect(cat.name); });
            pickerTabsEl.appendChild(tab);
        });
        picker.appendChild(pickerTabsEl);

        // Filter input
        filterInputEl = document.createElement('input');
        filterInputEl.type = 'text';
        filterInputEl.className = 'asm-picker-filter';
        filterInputEl.placeholder = 'Filter\u2026';
        filterInputEl.setAttribute('aria-label', 'Filter instructions');
        filterInputEl.setAttribute('autocomplete', 'off');
        filterInputEl.setAttribute('spellcheck', 'false');
        picker.appendChild(filterInputEl);

        // Body container
        pickerBodyEl = document.createElement('div');
        pickerBodyEl.className = 'asm-picker-body';
        picker.appendChild(pickerBodyEl);

        renderByCategory(activeCatName);

        filterInputEl.addEventListener('input', function () {
            renderFiltered(filterInputEl.value);
        });

        filterInputEl.addEventListener('keydown', function (e) {
            handleFilterKeydown(e);
        });
    }

    // Switch active tab and re-render body accordingly
    function onTabSelect(catName) {
        activeCatName = catName;
        if (pickerTabsEl) {
            var tabs = pickerTabsEl.querySelectorAll('.asm-picker-tab');
            tabs.forEach(function (tab, i) {
                tab.classList.toggle('asm-picker-tab--active', INSTR_CATEGORIES[i].name === catName);
            });
        }
        var q = filterInputEl ? filterInputEl.value.trim() : '';
        if (q) {
            renderFiltered(filterInputEl.value);
        } else {
            renderByCategory(catName);
        }
        if (filterInputEl) filterInputEl.focus();
    }

    // Render items from one category in a flat vertical list
    function renderByCategory(catName) {
        pickerBodyEl.innerHTML = '';
        allFlatItems = [];
        selectedIndex = -1;
        pickerBodyEl.className = 'asm-picker-body asm-picker-body--flat';
        var cat = null;
        for (var ci = 0; ci < INSTR_CATEGORIES.length; ci++) {
            if (INSTR_CATEGORIES[ci].name === catName) { cat = INSTR_CATEGORIES[ci]; break; }
        }
        if (!cat || !cat.items.length) {
            var empty = document.createElement('div');
            empty.className = 'asm-picker-empty';
            empty.textContent = catName === 'C-List' ? 'No abstractions registered' : 'No items';
            pickerBodyEl.appendChild(empty);
            return;
        }

        // C-List: inject a group-header row each time the abstraction name changes
        var lastAbs = null;
        cat.items.forEach(function (item) {
            if (catName === 'C-List' && item._clistAbs && item._clistAbs !== lastAbs) {
                lastAbs = item._clistAbs;
                var hdr = document.createElement('div');
                hdr.className = 'asm-picker-clist-hdr';
                hdr.textContent = item._clistAbs;
                pickerBodyEl.appendChild(hdr);
            }
            var flatIdx = allFlatItems.length;
            allFlatItems.push(item);
            pickerBodyEl.appendChild(makeItemRow(item, flatIdx));
        });
        if (allFlatItems.length > 0) setSelected(0);
    }

    // Render all instructions in the standard grouped horizontal layout
    function renderGrouped() {
        pickerBodyEl.innerHTML = '';
        allFlatItems = [];
        selectedIndex = -1;
        pickerBodyEl.className = 'asm-picker-body';

        INSTR_CATEGORIES.forEach(function (cat) {
            var group = document.createElement('div');
            group.className = 'asm-picker-group';

            var label = document.createElement('div');
            label.className = 'asm-picker-group-label';
            label.textContent = cat.name;
            group.appendChild(label);

            cat.items.forEach(function (item) {
                var flatIdx = allFlatItems.length;
                allFlatItems.push(item);

                var row = makeItemRow(item, flatIdx);
                group.appendChild(row);
            });

            pickerBodyEl.appendChild(group);
        });
    }

    // Returns { positions: [label indices matched], score: number } or null.
    // Fuzzy: every character of q must appear in order in label (case-insensitive).
    // Score is lower for earlier / tighter matches so results can be sorted best-first.
    // Word-boundary bonus: each matched position that is at index 0 or immediately
    // follows a space in the label subtracts 200 from the score, floating
    // semantically relevant matches (e.g. "ds" hitting "dest" + "src") to the top.
    function fuzzyScore(label, q) {
        var lLower = label.toLowerCase();
        var positions = [];
        var li = 0;
        for (var qi = 0; qi < q.length; qi++) {
            var found = lLower.indexOf(q[qi], li);
            if (found === -1) return null;
            positions.push(found);
            li = found + 1;
        }
        var first = positions[0];
        var last = positions[positions.length - 1];
        var boundaryBonus = 0;
        for (var bi = 0; bi < positions.length; bi++) {
            var p = positions[bi];
            if (p === 0 || lLower[p - 1] === ' ') {
                boundaryBonus -= 200;
            }
        }
        return { positions: positions, score: first * 1000 + (last - first) + boundaryBonus };
    }

    // Render items matching query in a flat vertical list (fuzzy, sorted by score)
    function renderFiltered(query) {
        pickerBodyEl.innerHTML = '';
        allFlatItems = [];
        selectedIndex = -1;
        pickerBodyEl.className = 'asm-picker-body asm-picker-body--flat';

        var q = query.trim().toLowerCase();
        if (!q) {
            if (activeCatName === null) renderGrouped();
            else renderByCategory(activeCatName);
            return;
        }

        var sourceItems = activeCatName
            ? allSourceItems.filter(function (item) { return itemCategoryMap.get(item) === activeCatName; })
            : allSourceItems;
        var scored = [];
        sourceItems.forEach(function (item) {
            var result = fuzzyScore(item.label, q);
            if (result) scored.push({ item: item, positions: result.positions, score: result.score });
        });

        scored.sort(function (a, b) { return a.score - b.score; });

        if (scored.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'asm-picker-empty';
            empty.textContent = 'No matches';
            pickerBodyEl.appendChild(empty);
            return;
        }

        scored.forEach(function (entry) {
            var flatIdx = allFlatItems.length;
            allFlatItems.push(entry.item);
            pickerBodyEl.appendChild(makeItemRow(entry.item, flatIdx, entry.positions));
        });

        setSelected(0);
    }

    // Populate el with label text, wrapping each individually matched character
    // position in a <span class="asm-picker-match"> highlight span.
    // positions is an array of character indices within label.
    function applyHighlight(el, label, positions) {
        var posSet = Object.create(null);
        positions.forEach(function (p) { posSet[p] = true; });
        var i = 0;
        while (i < label.length) {
            if (posSet[i]) {
                var mark = document.createElement('span');
                mark.className = 'asm-picker-match';
                mark.textContent = label[i];
                el.appendChild(mark);
                i++;
            } else {
                var start = i;
                while (i < label.length && !posSet[i]) i++;
                el.appendChild(document.createTextNode(label.substring(start, i)));
            }
        }
    }

    function makeItemRow(item, flatIdx, positions) {
        var row = document.createElement('div');
        row.className = 'asm-picker-item';
        row.setAttribute('role', 'option');
        row.setAttribute('data-idx', flatIdx);
        // Mark LOAD rows inside C-List for the accent CSS rule
        if (item._clistAbs && item.instr === 'LOAD') {
            row.setAttribute('data-clist-load', '1');
        }
        if (positions && positions.length) {
            applyHighlight(row, item.label, positions);
        } else {
            row.textContent = item.label;
        }
        row.addEventListener('mousedown', function (e) {
            e.preventDefault();
            currentOnSelect(item);
        });
        row.addEventListener('mouseenter', function () {
            setSelected(flatIdx);
        });
        return row;
    }

    function setSelected(idx) {
        selectedIndex = idx;
        var picker = getOrCreatePicker();
        picker.querySelectorAll('.asm-picker-item').forEach(function (el) {
            var elIdx = parseInt(el.getAttribute('data-idx'), 10);
            el.classList.toggle('asm-picker-item--active', elIdx === idx);
        });
        var activeEl = picker.querySelector('.asm-picker-item[data-idx="' + idx + '"]');
        if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    // ── Filter-input keyboard handler ────────────────────────────────────────

    function handleFilterKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            hidePicker();
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = (selectedIndex < 0) ? 0 : Math.min(selectedIndex + 1, allFlatItems.length - 1);
            setSelected(next);
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = (selectedIndex < 0) ? allFlatItems.length - 1 : Math.max(selectedIndex - 1, 0);
            setSelected(prev);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && allFlatItems[selectedIndex]) {
                insertIntoEditor(allFlatItems[selectedIndex]);
            }
            return;
        }
    }

    // ── Cursor pixel position ────────────────────────────────────────────────
    // Creates a hidden mirror element matching the textarea's metrics to
    // calculate where the caret is on screen.

    function getCaretPixelPos(textarea) {
        var div = document.createElement('div');
        var cs = window.getComputedStyle(textarea);
        var props = [
            'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
            'textTransform', 'wordSpacing', 'textIndent',
            'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
            'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth',
            'boxSizing', 'lineHeight', 'tabSize',
        ];
        props.forEach(function (p) { div.style[p] = cs[p]; });
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'pre-wrap';
        div.style.wordWrap = 'break-word';
        div.style.width = textarea.clientWidth + 'px';
        div.style.height = 'auto';
        div.style.top = '-9999px';
        div.style.left = '-9999px';
        div.style.overflow = 'hidden';

        var textBefore = textarea.value.substring(0, textarea.selectionStart);
        div.textContent = textBefore;

        var span = document.createElement('span');
        span.textContent = '\u200b'; // zero-width space as caret marker
        div.appendChild(span);

        document.body.appendChild(div);

        var taRect = textarea.getBoundingClientRect();
        var lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 16;

        var x = taRect.left + span.offsetLeft - textarea.scrollLeft;
        var y = taRect.top + span.offsetTop - textarea.scrollTop + lineH + 4;

        document.body.removeChild(div);
        return { x: x, y: y };
    }

    // ── Show / hide ──────────────────────────────────────────────────────────

    function positionPicker(textarea) {
        var picker = getOrCreatePicker();
        var pos = getCaretPixelPos(textarea);
        var pickerWidth = 580;
        var pickerMaxHeight = 300;
        var viewW = window.innerWidth;
        var viewH = window.innerHeight;

        var left = pos.x;
        var top = pos.y;

        if (left + pickerWidth > viewW) left = viewW - pickerWidth - 8;
        if (left < 4) left = 4;
        if (top + pickerMaxHeight > viewH) top = pos.y - pickerMaxHeight - 20;
        if (top < 4) top = 4;

        picker.style.left = left + 'px';
        picker.style.top = top + 'px';
    }

    // prefill: optional string — pre-populates the filter box and immediately
    // narrows the results. Used when Ctrl+Space is pressed mid-word: the chars
    // already typed (1–3+) are passed in so matching GT / instruction entries
    // appear highlighted without any extra keypresses.
    function showPicker(textarea, prefill) {
        refreshCListItems();  // rebuild C-List items from METHOD_REGISTER_CONVENTIONS
        refreshNSItems();     // rebuild Namespace items from sim.nsLabels
        activeCatName = null; // show "All" tab so Namespace items are visible
        activeEditorEl = textarea;
        buildPickerContent(function (item) { insertIntoEditor(item); });
        var picker = getOrCreatePicker();
        picker.style.display = 'flex';
        positionPicker(textarea);
        if (filterInputEl) {
            var q = (prefill || '').trim();
            filterInputEl.value = q;
            if (q) {
                renderFiltered(q);   // immediately apply prefix filter
            }
            filterInputEl.focus();
        }
    }

    function hidePicker() {
        if (pickerEl) pickerEl.style.display = 'none';
        selectedIndex = -1;
        // Return focus to the editor
        if (activeEditorEl) activeEditorEl.focus();
    }

    function isPickerVisible() {
        return !!(pickerEl && pickerEl.style.display !== 'none');
    }

    // ── Insertion ────────────────────────────────────────────────────────────

    function insertIntoEditor(item) {
        if (!activeEditorEl) return;
        var editor = activeEditorEl;
        var instr = item.instr;
        var ops = item.ops;

        var text = ops ? instr + ' ' + ops : instr;

        // Append comment if the web IDE's instructionComments table is present
        if (typeof instructionComments !== 'undefined' && instructionComments && instructionComments[instr]) {
            text += '  ; ' + instructionComments[instr];
        }

        var val = editor.value;
        var pos = editor.selectionStart;
        editor.value = val.substring(0, pos) + text + val.substring(pos);
        var newPos = pos + text.length;
        editor.selectionStart = newPos;
        editor.selectionEnd = newPos;
        editor.focus();

        hidePicker();

        if (typeof updateLineNumbers === 'function') updateLineNumbers();
        if (typeof markUserTabDirty === 'function') markUserTabDirty();
    }

    // ── Keyboard navigation (textarea keydown — handles picker before focus moves) ──

    function handlePickerKeydown(e) {
        if (!isPickerVisible()) return false;

        if (e.key === 'Escape') {
            e.preventDefault();
            hidePicker();
            return true;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = (selectedIndex < 0) ? 0 : Math.min(selectedIndex + 1, allFlatItems.length - 1);
            setSelected(next);
            // Ensure filter input keeps focus
            if (filterInputEl) filterInputEl.focus();
            return true;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = (selectedIndex < 0) ? allFlatItems.length - 1 : Math.max(selectedIndex - 1, 0);
            setSelected(prev);
            if (filterInputEl) filterInputEl.focus();
            return true;
        }

        if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            insertIntoEditor(allFlatItems[selectedIndex]);
            return true;
        }

        // Redirect focus to the filter input so the user's keystroke lands there
        if (filterInputEl && (e.key.length === 1 || e.key === 'Backspace')) {
            filterInputEl.focus();
            // Don't call preventDefault — let the character reach the input
        }

        return false;
    }

    // ── Attach to a textarea ─────────────────────────────────────────────────

    function attachToEditor(textarea) {
        if (!textarea || textarea._asmPickerAttached) return;
        textarea._asmPickerAttached = true;

        textarea.addEventListener('keydown', function (e) {
            // Let picker handle navigation / confirm / dismiss first
            if (handlePickerKeydown(e)) return;

            // Configurable shortcut (default: Ctrl+Space / Cmd+Space) — open/close picker on demand
            if (matchesPickerShortcut(e)) {
                e.preventDefault();
                if (isPickerVisible()) {
                    hidePicker();
                } else {
                    // Extract trailing word characters before the cursor (1–3+ chars)
                    // and pass them as a prefill so GT/instruction entries are
                    // filtered immediately without extra keystrokes.
                    var _val = textarea.value;
                    var _pos = textarea.selectionStart;
                    var _before = _val.slice(0, _pos);
                    var _wm = _before.match(/(\w+)$/);
                    var _prefill = _wm ? _wm[1] : '';
                    showPicker(textarea, _prefill);
                }
                return;
            }

            if (e.key === 'Enter') {
                // After the browser inserts the newline, check if new line is blank
                setTimeout(function () {
                    var val = textarea.value;
                    var pos = textarea.selectionStart;
                    var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
                    var lineEnd = val.indexOf('\n', pos);
                    var currentLine = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
                    if (currentLine.trim() === '') {
                        showPicker(textarea);
                    }
                }, 0);
            }
        });

        // Dismiss on outside click (use document capture so we catch everything)
        document.addEventListener('mousedown', function (e) {
            if (!isPickerVisible()) return;
            var picker = getOrCreatePicker();
            if (!picker.contains(e.target) && e.target !== textarea) {
                hidePicker();
            }
        }, true);
    }

    // ── Auto-attach on DOMContentLoaded ─────────────────────────────────────

    function autoAttach() {
        var webEditor = document.getElementById('codeEditor');
        if (webEditor) attachToEditor(webEditor);
        var simEditor = document.getElementById('asmEditor');
        if (simEditor) attachToEditor(simEditor);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoAttach);
    } else {
        autoAttach();
    }

    // Public API (for debugging or future extension)
    window.AsmInstructionPicker = {
        attach: attachToEditor,
        show: showPicker,         // showPicker(textarea, prefill?) — prefill pre-filters the list
        hide: hidePicker,
        isVisible: isPickerVisible,
        refreshNS: refreshNSItems,
        shortcutDefaults: SHORTCUT_DEFAULTS,
        fuzzyScore: fuzzyScore,
    };

}());
