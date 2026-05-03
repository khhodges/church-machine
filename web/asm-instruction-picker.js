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
                { label: 'MOV dest src', instr: 'MOV', ops: 'dest src' },
                { label: 'MVN dest src', instr: 'MVN', ops: 'dest src' },
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
            name: 'Capability', icon: '\uD83D\uDD11', items: [
                { label: 'LOAD destCR srcCR idx', instr: 'LOAD',   ops: 'destCR srcCR idx' },
                { label: 'SAVE destCR srcDR',     instr: 'SAVE',   ops: 'destCR srcDR' },
                { label: 'CALL cr',               instr: 'CALL',   ops: 'cr' },
                { label: 'RETURN',                instr: 'RETURN', ops: '' },
                { label: 'CHANGE offset',         instr: 'CHANGE', ops: 'offset' },
                { label: 'SWITCH cr',             instr: 'SWITCH', ops: 'cr' },
                { label: 'TPERM cr mask',         instr: 'TPERM',  ops: 'cr mask' },
            ]
        },
    ];

    var pickerEl = null;
    var activeEditorEl = null;
    var selectedIndex = -1;
    var allFlatItems = [];

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
        var picker = getOrCreatePicker();
        picker.innerHTML = '';
        allFlatItems = [];

        var header = document.createElement('div');
        header.className = 'asm-picker-header';
        header.textContent = 'Insert instruction \u00b7 \u2191\u2193 navigate \u00b7 Enter confirm \u00b7 Esc dismiss';
        picker.appendChild(header);

        var body = document.createElement('div');
        body.className = 'asm-picker-body';

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

                var row = document.createElement('div');
                row.className = 'asm-picker-item';
                row.setAttribute('role', 'option');
                row.setAttribute('data-idx', flatIdx);
                row.textContent = item.label;
                row.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    onSelect(item);
                });
                row.addEventListener('mouseenter', function () {
                    setSelected(flatIdx);
                });
                group.appendChild(row);
            });

            body.appendChild(group);
        });

        picker.appendChild(body);
        selectedIndex = -1;
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
        var pickerMaxHeight = 260;
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

    function showPicker(textarea) {
        activeEditorEl = textarea;
        buildPickerContent(function (item) { insertIntoEditor(item); });
        var picker = getOrCreatePicker();
        picker.style.display = 'flex';
        positionPicker(textarea);
    }

    function hidePicker() {
        if (pickerEl) pickerEl.style.display = 'none';
        selectedIndex = -1;
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

    // ── Keyboard navigation ──────────────────────────────────────────────────

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
            return true;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = (selectedIndex < 0) ? allFlatItems.length - 1 : Math.max(selectedIndex - 1, 0);
            setSelected(prev);
            return true;
        }

        if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            insertIntoEditor(allFlatItems[selectedIndex]);
            return true;
        }

        // Any printable key or destructive key dismisses the picker
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
            hidePicker();
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
        hide: hidePicker,
        isVisible: isPickerVisible,
    };

}());
