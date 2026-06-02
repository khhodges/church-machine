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
// Public API: window.CListViewer = { show, hide, toggle, isVisible, getNullSlotPetNames }

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    var DEFAULT_SHORTCUT = { code: 'KeyC', ctrl: true, shift: true };

    // ── State ─────────────────────────────────────────────────────────────────
    var popupEl      = null;
    var activeEditor = null;
    var focusedRow   = -1;

    // ── User-declared pet names for null c-list slots ─────────────────────────
    // Persisted to localStorage so they survive page reloads and recompilation.
    // Keys are numeric slot indices (stored as strings in JSON).
    var _LS_KEY_CLIST_PET = 'church_clist_pet_names';
    var _nullSlotPetNames = (function () {
        try { return JSON.parse(localStorage.getItem(_LS_KEY_CLIST_PET) || '{}'); } catch (e) { return {}; }
    }());

    // ── NS slot→name cache (populated once from /api/lumps/list) ─────────────
    var _nsSlotNameCache   = null;   // null = not yet fetched; {} = fetched (may be empty)
    var _nsSlotNamePromise = null;   // in-flight promise — prevents duplicate concurrent fetches

    function _fetchNsSlotNames() {
        if (_nsSlotNameCache !== null) return Promise.resolve(_nsSlotNameCache);
        if (_nsSlotNamePromise !== null) return _nsSlotNamePromise;
        _nsSlotNamePromise = fetch('/api/lumps/list').then(function (resp) {
            return resp.ok ? resp.json() : [];
        }).then(function (lumps) {
            var map = {};
            if (Array.isArray(lumps)) {
                lumps.forEach(function (entry) {
                    var slot = entry.ns_slot;
                    var name = entry.abstraction || entry.name || '';
                    if (slot !== null && slot !== undefined && name) {
                        map[slot] = name;
                    }
                });
            }
            _nsSlotNameCache = map;
            _nsSlotNamePromise = null;
            return map;
        }).catch(function () {
            _nsSlotNameCache = {};
            _nsSlotNamePromise = null;
            return {};
        });
        return _nsSlotNamePromise;
    }

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
            var backBtn = e.target.closest('[data-action="show-view"]');
            if (backBtn) { showViewer(); return; }

            var addBtn = e.target.closest('[data-action="show-picker"]');
            if (addBtn) { showPicker(); return; }

            var permToggle = e.target.closest('.clist-perm-toggle[data-perm]');
            if (permToggle) { permToggle.classList.toggle('clist-perm-toggle--on'); return; }

            var insertNullBtn = e.target.closest('[data-action="insert-null-slot"]');
            if (insertNullBtn) {
                var _form = popupEl && popupEl.querySelector('.clist-null-form');
                var _ni = _form && _form.querySelector('.clist-null-name-input');
                var _nm = _ni ? _ni.value.trim() : '';
                if (!_nm) { if (_ni) _ni.focus(); return; }
                var _activePerms = _form
                    ? Array.from(_form.querySelectorAll('.clist-perm-toggle--on')).map(function (b) { return b.dataset.perm; }).join('')
                    : '';
                _insertCapability(_nm, _activePerms);
                return;
            }

            var resolveBtn = e.target.closest('[data-action="resolve-pending"]');
            if (resolveBtn) {
                e.stopPropagation();
                if (resolveBtn.classList.contains('clist-resolve-btn--disabled')) {
                    _showDisabledResolveToast(resolveBtn);
                    return;
                }
                var _rpSlot = parseInt(resolveBtn.dataset.slot, 10);
                var _rpName = resolveBtn.dataset.pendingName || '';
                showResolvePicker(_rpSlot, _rpName);
                return;
            }

            var resolvePickerRow = e.target.closest('.clist-resolve-row[data-ns-idx]');
            if (resolvePickerRow) {
                var _rsSlot  = parseInt(resolvePickerRow.dataset.slot, 10);
                var _rsNsIdx = parseInt(resolvePickerRow.dataset.nsIdx, 10);
                var _rsName  = resolvePickerRow.dataset.name || '';
                var _rsSim = (typeof sim !== 'undefined') ? sim : null;
                if (_rsSim && _rsSim.resolvePendingSlot) {
                    var _rsResult = _rsSim.resolvePendingSlot(_rsSlot, _rsNsIdx);
                    if (_rsResult && _rsResult.ok && _rsName) {
                        if (typeof _petNameCRMap !== 'undefined') {
                            _petNameCRMap[_rsSlot] = _rsName;
                        }
                        if (_rsSim.nsLabels) {
                            _rsSim.nsLabels[_rsNsIdx] = _rsName;
                        }
                    }
                }
                showViewer();
                return;
            }

            var pickerRow = e.target.closest('.clist-picker-row[data-cap-name]');
            if (pickerRow) {
                if (pickerRow.dataset.capName === '__NULL__') { showNullSlotForm(); return; }
                _insertCapability(pickerRow.dataset.capName, pickerRow.dataset.capRights || '');
                return;
            }

            var row = e.target.closest('.clist-row[data-slot]');
            if (!row) return;
            var slotIdx = parseInt(row.dataset.slot, 10);
            if (row.classList.contains('clist-row--null')) {
                _editNullSlotPetName(row, slotIdx);
                return;
            }
            if (row.classList.contains('clist-row--pending')) {
                var _pName = row.dataset.pendingName || '';
                var _rowCanResolve = (typeof sim !== 'undefined') && sim && sim.bootComplete;
                if (!_rowCanResolve) {
                    var _disabledBtn = row.querySelector('.clist-resolve-btn--disabled');
                    if (_disabledBtn) _showDisabledResolveToast(_disabledBtn);
                    return;
                }
                showResolvePicker(slotIdx, _pName);
                return;
            }
            insertCROperand(slotIdx);
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

        // While an inline pet-name input is active, let the input handle keys itself
        if (popupEl && popupEl.querySelector('.clist-pet-name-input')) return;

        var inPicker = !!(popupEl && popupEl.querySelector('.clist-back-btn'));

        if (e.key === 'Escape') {
            e.preventDefault();
            if (inPicker) showViewer(); else hideViewer();
            return;
        }

        var rows = inPicker
            ? (popupEl ? popupEl.querySelectorAll('.clist-picker-row[data-cap-name]') : [])
            : (popupEl ? popupEl.querySelectorAll('.clist-row[data-slot]') : []);
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
                if (inPicker) {
                    var _fRow = rows[focusedRow];
                    if (_fRow.dataset.capName === '__NULL__') { showNullSlotForm(); }
                    else { _insertCapability(_fRow.dataset.capName, _fRow.dataset.capRights || ''); }
                } else {
                    insertCROperand(parseInt(rows[focusedRow].dataset.slot, 10));
                }
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

    // ── Inline pet-name editor for null c-list slots ──────────────────────────
    function _editNullSlotPetName(row, slotIdx) {
        var existing = _nullSlotPetNames[slotIdx] || _nullSlotPetNames[String(slotIdx)] || '';
        row.innerHTML =
            '<span class="clist-slot">CR' + slotIdx + '</span>' +
            '<input class="clist-pet-name-input" type="text" ' +
                'value="' + escHtml(existing) + '" ' +
                'placeholder="placeholder name\u2026" maxlength="32" />';
        var input = row.querySelector('.clist-pet-name-input');
        if (!input) return;
        input.focus();
        input.select();

        var _saved = false;
        function _save() {
            if (_saved) return;
            _saved = true;
            var name = input.value.trim();
            var key = String(slotIdx);
            if (name) {
                _nullSlotPetNames[key] = name;
                /* Also push into the global map so other views benefit immediately */
                if (typeof _petNameCRMap !== 'undefined') _petNameCRMap[slotIdx] = name;
            } else {
                delete _nullSlotPetNames[key];
                if (typeof _petNameCRMap !== 'undefined') delete _petNameCRMap[slotIdx];
            }
            try { localStorage.setItem(_LS_KEY_CLIST_PET, JSON.stringify(_nullSlotPetNames)); } catch (e2) { /* ignore */ }
            showViewer(); /* re-render the viewer with updated names */
        }
        function _cancel() {
            if (_saved) return;
            _saved = true;
            showViewer();
        }

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); _save();   }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _cancel(); }
        }, true);
        input.addEventListener('blur', _save);
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

    // ── Inline GT decode (used by the static-binary path, no sim needed) ─────
    function _decodeGTWord(raw32) {
        raw32 = raw32 >>> 0;
        var permBits = (raw32 >>> 25) & 0x7F;
        return {
            type:  (raw32 >>> 23) & 0x3,
            index:  raw32 & 0xFFFF,
            permissions: {
                B: (permBits >>> 6) & 1,
                E: (permBits >>> 5) & 1,
                S: (permBits >>> 4) & 1,
                L: (permBits >>> 3) & 1,
                X: (permBits >>> 2) & 1,
                W: (permBits >>> 1) & 1,
                R: (permBits >>> 0) & 1,
            },
        };
    }

    function _decodeAbstractGTWord(raw32) {
        raw32 = raw32 >>> 0;
        var ab_type      = (raw32 >>> 27) & 0x1F;
        var ab_data      =  raw32 & 0xFFFF;
        var device_class = (ab_data >>> 8) & 0xFF;
        var device_data  =  ab_data & 0xFF;
        return { ab_type, device_class, device_data, ab_data };
    }

    // ── Named-slot badge HTML ─────────────────────────────────────────────────
    // Returns a small teal badge when the slot is registered in petNameMemory
    // (i.e. a NULL access will trigger LAZY_RESOLVE instead of a hard fault).
    function _namedBadgeHtml(s, slotIdx) {
        if (s && s.isNamedSlot && s.isNamedSlot(slotIdx)) {
            return '<span class="clist-named-badge" title="named: LAZY_RESOLVE on first access">named</span>';
        }
        return '';
    }

    // ── Build rows HTML from a flat array of raw GT words ────────────────────
    function _buildRowsFromWords(gtWords, petMap, nsLabels, nsTable, s) {
        var DC = { 1: 'LED', 2: 'UART', 3: 'Button', 4: 'Timer', 5: 'Display' };
        var html = '';
        for (var i = 0; i < gtWords.length; i++) {
            var rawWord = gtWords[i] >>> 0;
            var isNull  = rawWord === 0;

            // ── Pending GT slot (named, not yet introduced to a live GT) ──────
            var _CSSim  = (typeof ChurchSimulator !== 'undefined') ? ChurchSimulator : null;
            var isPending = !isNull && _CSSim && _CSSim.isPendingGT && _CSSim.isPendingGT(rawWord);
            if (isPending) {
                var _pendingName = _CSSim.pendingGTName(rawWord);
                var _canResolve  = (typeof sim !== 'undefined') && sim && sim.bootComplete;
                html += '<div class="clist-row clist-row--pending" data-slot="' + i + '" ' +
                    'data-pending-name="' + escHtml(_pendingName) + '" tabindex="-1" ' +
                    'title="' + escHtml(_pendingName) + ' \u2014 declared but not yet introduced to a live GT.' +
                    (_canResolve ? ' Click to resolve.' : ' Boot the program first to resolve.') + '">' +
                    '<span class="clist-slot">CR' + i + '</span>' +
                    _namedBadgeHtml(s, i) +
                    '<span class="clist-pending-name">' + escHtml(_pendingName) + '</span>' +
                    '<span class="clist-pending-badge">not yet introduced</span>' +
                    '<button class="clist-resolve-btn' + (_canResolve ? '' : ' clist-resolve-btn--disabled') + '" ' +
                          'data-action="resolve-pending" ' +
                          'data-slot="' + i + '" data-pending-name="' + escHtml(_pendingName) + '" ' +
                          'title="' + (_canResolve
                              ? 'Resolve Now: introduce a live GT to this slot'
                              : 'Boot the program first to resolve this slot') + '">' +
                          '\u26A1 Resolve</button>' +
                    '</div>';
                continue;
            }

            if (isNull) {
                var _nullPet = (petMap && (petMap[i] || petMap[String(i)])) ||
                               (_nullSlotPetNames && (_nullSlotPetNames[i] || _nullSlotPetNames[String(i)])) || '';
                if (_nullPet) {
                    html += '<div class="clist-row clist-row--null clist-row--named" data-slot="' + i + '" tabindex="-1" title="Click to rename \u2018' + escHtml(_nullPet) + '\u2019 (placeholder, not yet populated)">' +
                        '<span class="clist-slot">CR' + i + '</span>' +
                        _namedBadgeHtml(s, i) +
                        '<span class="clist-null-pet">' + escHtml(_nullPet) + '</span>' +
                        '<span class="clist-null-edit-hint">\u270e</span>' +
                        '</div>';
                } else {
                    html += '<div class="clist-row clist-row--null" data-slot="' + i + '" tabindex="-1" title="Click to add a placeholder name for this empty slot">' +
                        '<span class="clist-slot">CR' + i + '</span>' +
                        _namedBadgeHtml(s, i) +
                        '<span class="clist-null-label">\u2014 null \u2014<span class="clist-null-hint">\u2295 name</span></span>' +
                        '</div>';
                }
                continue;
            }

            var gt = _decodeGTWord(rawWord);
            var nsIdx   = gt.index || 0;
            var bFlag = 0, fFlag = 0;
            if (nsTable && nsTable[nsIdx]) {
                try {
                    var nsParsed = s && s.parseNSWord1 ? s.parseNSWord1(nsTable[nsIdx].word1_limit) : null;
                    if (nsParsed) { bFlag = nsParsed.b || 0; fFlag = nsParsed.f || 0; }
                } catch (e2) { /* ignore */ }
            }

            var petName = (petMap && petMap[i]) || (nsLabels && nsLabels[nsIdx]) || '';
            if (!petName && gt.type === 3) {
                try {
                    var ab = _decodeAbstractGTWord(rawWord);
                    petName = ab.ab_type === 0
                        ? (DC[ab.device_class] || ('dc' + ab.device_class)) + '[' + ab.device_data + ']'
                        : 'M-Elev 0x' + ab.ab_data.toString(16).toUpperCase();
                } catch (e2) { /* ignore */ }
            }

            var displayName = petName || ('0x' + (rawWord >>> 0).toString(16).toUpperCase().padStart(8, '0'));
            html += '<div class="clist-row" data-slot="' + i + '" tabindex="-1">' +
                '<span class="clist-slot">CR' + i + '</span>' +
                '<span class="clist-perms">' + permChipsHtml(gt.permissions) + '</span>' +
                _namedBadgeHtml(s, i) +
                '<span class="clist-b-badge' + (bFlag ? ' clist-b-badge--on' : '') + '" title="Bind bit">B</span>' +
                '<span class="clist-f-badge' + (fFlag ? ' clist-f-badge--on' : '') + '" title="Fault-on-use bit">F</span>' +
                '<span class="clist-name">' + escHtml(displayName) + '</span>' +
                '</div>';
        }
        return html;
    }

    function _wrapRows(titleExtra, rows) {
        return '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List' + (titleExtra ? ' \u2014 ' + titleExtra : ' (CR6)') + '</span>' +
            '<span style="display:flex;align-items:center;gap:6px;">' +
            '<button class="clist-add-btn" data-action="show-picker" title="Add a capability to the source c-list">\u2295 Add</button>' +
            '<span class="clist-viewer-hint">\u2191\u2193 navigate \u00b7 Enter insert \u00b7 Esc close</span>' +
            '</span>' +
            '</div>' +
            '<div class="clist-viewer-body">' + rows + '</div>';
    }

    // ── Async builder: live-sim takes priority when booted; static-binary otherwise ──
    async function buildContentAsync() {
        /* global sim, _petNameCRMap */
        var s      = (typeof sim !== 'undefined') ? sim : null;
        var petMap = (typeof _petNameCRMap !== 'undefined') ? (_petNameCRMap || {}) : {};

        // ── Path 0: source-declared capabilities (editor textarea) ────────────
        // When the editor has a capabilities { } block, show its declared names
        // as the primary view so the viewer stays in sync while the user edits,
        // even before the program is compiled or run.
        var srcEd = activeEditor || document.getElementById('asmEditor');
        if (srcEd && srcEd.value) {
            var capSrcRe = /capabilities\s*\{([^}]*)\}/;
            var capSrcM  = capSrcRe.exec(srcEd.value);
            if (capSrcM) {
                // Parse entry-by-entry: split on newlines AND commas so both
                // single-line  capabilities { LED0 R W, LED1 R W }
                // and multi-line block formats are supported.
                // First token = name; remaining tokens = rights (R, W, X, L, S, E).
                var KNOWN_RIGHTS = /^[RWXLSErwxlse]+$/;
                var capSrcEntries = capSrcM[1].split(/[\n,]/)
                    .map(function (line) { return line.replace(/;.*$/, '').trim(); })
                    .filter(function (line) { return line && !/^[;/]/.test(line); })
                    .map(function (line) {
                        var tokens = line.split(/\s+/).filter(Boolean);
                        var name   = tokens[0] || '';
                        var rights = tokens.slice(1).filter(function (t) { return KNOWN_RIGHTS.test(t); });
                        return name ? { name: name, rights: rights } : null;
                    })
                    .filter(Boolean);
                if (capSrcEntries.length > 0) {
                    var srcRows = '';
                    var _srcSim = (typeof sim !== 'undefined') ? sim : null;
                    for (var si = 0; si < capSrcEntries.length; si++) {
                        var se = capSrcEntries[si];
                        var rightsHtml = se.rights.length > 0
                            ? '<span class="clist-perms">' +
                              se.rights.join('').split('').map(function (ch) {
                                  var col = PERM_COLORS[ch.toUpperCase()] || '#666';
                                  return '<span class="clist-perm-chip clist-perm-chip--on" style="background:' + col + '22;color:' + col + ';border-color:' + col + '55;">' + ch.toUpperCase() + '</span>';
                              }).join('') +
                              '</span>'
                            : '';
                        srcRows += '<div class="clist-row" data-slot="' + si + '" tabindex="-1">' +
                            '<span class="clist-slot" title="slot ' + si + ' \u2014 declared in source (not yet compiled)">CR' + si + '</span>' +
                            rightsHtml +
                            _namedBadgeHtml(_srcSim, si) +
                            '<span class="clist-name">' + escHtml(se.name) + '</span>' +
                            '</div>';
                    }
                    return _wrapRows('source', srcRows);
                }
            }
        }

        // ── Path 1: live sim (boot-complete) — preferred when simulator is running ─
        if (s && s.bootComplete) {
            var cr6 = s.cr && s.cr[6];
            if (cr6 && (cr6.word0 >>> 0) !== 0) {
                var clistBase  = cr6.word1 >>> 0;
                var clistCount = 0;
                try {
                    clistCount = s.parseNSWord1(cr6.word2).clistCount;
                } catch (e) { clistCount = 0; }

                if (clistCount > 0) {
                    var liveWords = [];
                    for (var j = 0; j < clistCount; j++) {
                        liveWords.push((s.memory && s.memory[clistBase + j] !== undefined)
                            ? (s.memory[clistBase + j] >>> 0)
                            : 0);
                    }
                    var liveRows = _buildRowsFromWords(liveWords, petMap,
                        s.nsLabels, s.nsTable, s);
                    return _wrapRows(null, liveRows);
                }
            }
        }

        // ── Path 2: decode from the last saved LUMP binary (no boot required) ─
        var savedToken = window._editorLastSavedToken || null;
        if (savedToken) {
            try {
                var resp = await fetch('/api/lump/' + savedToken + '/words');
                if (resp.ok) {
                    var data = await resp.json();
                    var words = data.words;
                    if (words && words.length > 0) {
                        var hdr      = words[0] >>> 0;
                        var cc       = hdr & 0xFF;
                        var nMinus6  = (hdr >>> 23) & 0xF;
                        var lumpSize = 1 << (nMinus6 + 6);

                        if (cc > 0 && lumpSize <= words.length && (lumpSize - cc) >= 0) {
                            var gtWords = words.slice(lumpSize - cc, lumpSize);
                            // Merge sim nsLabels (if any) with server manifest names
                            var manifestNames = await _fetchNsSlotNames();
                            var mergedNsLabels = Object.assign({}, manifestNames,
                                (s && s.nsLabels) ? s.nsLabels : {});
                            var rows = _buildRowsFromWords(gtWords, petMap,
                                mergedNsLabels, s && s.nsTable, s);
                            return _wrapRows('saved binary', rows);
                        }
                        return emptyState('This LUMP has no C-List (cc = 0).');
                    }
                }
            } catch (e) { /* fall through */ }
        }

        // ── Path 3: nothing available ─────────────────────────────────────────
        if (!savedToken) {
            return emptyState('No LUMP saved yet — compile and save first.');
        }
        return emptyState('No C-List loaded — boot a program first.');
    }

    function emptyState(msg) {
        return '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List (CR6)</span>' +
            '<span style="display:flex;align-items:center;gap:6px;">' +
            '<button class="clist-add-btn" data-action="show-picker" title="Add a capability to the source c-list">\u2295 Add</button>' +
            '</span>' +
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

    function _showDisabledResolveToast(btn) {
        if (btn._disabledToastActive) return;
        btn._disabledToastActive = true;
        var orig = btn.textContent;
        btn.textContent = 'Run the program first to introduce a live GT';
        btn.classList.add('clist-resolve-btn--toast');
        setTimeout(function () {
            btn.textContent = orig;
            btn.classList.remove('clist-resolve-btn--toast');
            btn._disabledToastActive = false;
        }, 2000);
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

    // ── GT Picker ─────────────────────────────────────────────────────────────
    // Built-in system Inform GTs — always present in the boot namespace.
    // These are lump-backed abstractions with fixed NS slots; all require E to call.
    var PICKER_SYSTEM = [
        { name: 'Salvation',    slot: 4,  hint: 'First callable abstraction'      },
        { name: 'Navana',       slot: 5,  hint: 'Namespace slot guardian'         },
        { name: 'Mint',         slot: 6,  hint: 'GT issuance / encoding'          },
        { name: 'Memory',       slot: 7,  hint: 'Physical RAM zone guardian'      },
        { name: 'Scheduler',    slot: 8,  hint: 'Thread scheduling & IRQ'         },
        { name: 'Stack',        slot: 9,  hint: 'Managed call stack'              },
        { name: 'DijkstraFlag', slot: 10, hint: 'Semaphore / synchronisation'     },
        { name: 'UART',         slot: 11, hint: 'Serial I/O namespace entry'      },
        { name: 'LED',          slot: 12, hint: 'LED namespace entry'             },
        { name: 'Button',       slot: 13, hint: 'Button namespace entry'          },
        { name: 'Timer',        slot: 14, hint: 'Timer namespace entry'           },
        { name: 'Display',      slot: 15, hint: 'Display namespace entry'         },
        { name: 'SlideRule',    slot: 16, hint: 'Floating-point math'             },
        { name: 'Abacus',       slot: 17, hint: 'Integer arithmetic'              },
        { name: 'Constants',    slot: 18, hint: 'Mathematical constants (Pi…)'    },
        { name: 'Loader',       slot: 19, hint: 'Lazy lump loader'                },
        { name: 'Tunnel',       slot: 31, hint: 'FPGA \u2194 IDE I/O channel'     },
        { name: 'GC',           slot: 44, hint: 'Garbage collector (PP250)'       },
        { name: 'Circle',       slot: 46, hint: 'Geometry (inherits SlideRule)'   },
    ];

    var PICKER_DEVICES = [
        { name: 'LED0',     hint: 'LED \u00b7 device 0',     rights: 'RW' },
        { name: 'LED1',     hint: 'LED \u00b7 device 1',     rights: 'RW' },
        { name: 'LED2',     hint: 'LED \u00b7 device 2',     rights: 'RW' },
        { name: 'LED3',     hint: 'LED \u00b7 device 3',     rights: 'RW' },
        { name: 'LED4',     hint: 'LED \u00b7 device 4',     rights: 'RW' },
        { name: 'LED5',     hint: 'LED \u00b7 device 5',     rights: 'RW' },
        { name: 'UART0',    hint: 'UART \u00b7 device 0',    rights: 'RW' },
        { name: 'Button0',  hint: 'Button \u00b7 device 0',  rights: 'R'  },
        { name: 'Timer0',   hint: 'Timer \u00b7 device 0',   rights: 'RW' },
        { name: 'Display0', hint: 'Display \u00b7 device 0', rights: 'W'  },
    ];

    async function buildPickerContentAsync() {
        var s = (typeof sim !== 'undefined') ? sim : null;
        var bodyRows = '';

        // Section 0: NULL — custom named placeholder slot (filled at compile/runtime)
        bodyRows += '<div class="clist-picker-section-header">Custom</div>' +
            '<div class="clist-picker-row clist-picker-row--null-slot" data-cap-name="__NULL__">' +
            '<span class="clist-picker-type clist-picker-type--null">Null</span>' +
            '<span class="clist-picker-name">NULL</span>' +
            '<span class="clist-picker-hint">named placeholder \u00b7 choose perms</span>' +
            '</div>';

        // Section 1: System — built-in Inform GTs always present in the boot namespace
        bodyRows += '<div class="clist-picker-section-header">System</div>';
        PICKER_SYSTEM.forEach(function (a) {
            bodyRows += '<div class="clist-picker-row" data-cap-name="' + a.name + '" data-cap-rights="E">' +
                '<span class="clist-picker-type clist-picker-type--inform">Inform</span>' +
                '<span class="clist-picker-name">' + escHtml(a.name) + '</span>' +
                '<span class="clist-picker-hint">NS[' + a.slot + '] \u00b7 ' + escHtml(a.hint) + ' \u00b7 E</span>' +
                '</div>';
        });

        // Section 2: Abstractions — Inform GTs from lump library (ns_slot != null)
        try {
            var lresp = await fetch('/api/lumps/list');
            if (lresp.ok) {
                var lumps = await lresp.json();
                var withSlots = Array.isArray(lumps) ? lumps.filter(function (l) {
                    return l.ns_slot !== null && l.ns_slot !== undefined &&
                           (l.abstraction || l.name);
                }) : [];
                if (withSlots.length > 0) {
                    bodyRows += '<div class="clist-picker-section-header">Abstractions</div>';
                    withSlots.forEach(function (l) {
                        var name = escHtml(l.abstraction || l.name);
                        bodyRows += '<div class="clist-picker-row" data-cap-name="' + name + '" data-cap-rights="E">' +
                            '<span class="clist-picker-type clist-picker-type--inform">Inform</span>' +
                            '<span class="clist-picker-name">' + name + '</span>' +
                            '<span class="clist-picker-hint">NS[' + l.ns_slot + '] \u00b7 E</span>' +
                            '</div>';
                    });
                }
            }
        } catch (e2) { /* network error — skip section */ }

        // Section 2: Devices — Abstract GTs (hardcoded device capability names)
        bodyRows += '<div class="clist-picker-section-header">Devices</div>';
        PICKER_DEVICES.forEach(function (d) {
            bodyRows += '<div class="clist-picker-row" data-cap-name="' + d.name + '" data-cap-rights="' + (d.rights || '') + '">' +
                '<span class="clist-picker-type clist-picker-type--abstract">Abstract</span>' +
                '<span class="clist-picker-name">' + d.name + '</span>' +
                '<span class="clist-picker-hint">' + escHtml(d.hint) + (d.rights ? ' \u00b7 ' + d.rights : '') + '</span>' +
                '</div>';
        });

        // Section 3: Outform GTs — from running sim nsTable (F-bit set), if booted
        if (s && s.nsTable && s.nsLabels) {
            var outRows = '';
            for (var oi = 0; oi < s.nsTable.length; oi++) {
                var oentry = s.nsTable[oi];
                if (!oentry) continue;
                try {
                    var onp = s.parseNSWord1(oentry.word1_limit);
                    if (onp && onp.f === 1) {
                        var olbl = escHtml((s.nsLabels && s.nsLabels[oi]) || ('NS[' + oi + ']'));
                        outRows += '<div class="clist-picker-row" data-cap-name="' + olbl + '" data-cap-rights="X">' +
                            '<span class="clist-picker-type clist-picker-type--outform">Outform</span>' +
                            '<span class="clist-picker-name">' + olbl + '</span>' +
                            '<span class="clist-picker-hint">NS[' + oi + '] F-bit \u00b7 X</span>' +
                            '</div>';
                    }
                } catch (e3) { /* skip */ }
            }
            if (outRows) {
                bodyRows += '<div class="clist-picker-section-header">Outform</div>' + outRows;
            }
        }

        return '<div class="clist-viewer-header">' +
            '<button class="clist-back-btn" data-action="show-view">\u2190 Back</button>' +
            '<span class="clist-viewer-title">Add Capability</span>' +
            '<span class="clist-viewer-hint">click to add \u00b7 Esc to go back</span>' +
            '</div>' +
            '<div class="clist-viewer-body">' + bodyRows + '</div>';
    }

    // ── Null Slot Form ────────────────────────────────────────────────────────
    function showNullSlotForm() {
        var popup = getOrCreatePopup();
        focusedRow = -1;
        var permsHtml = ['R', 'W', 'X', 'L', 'S', 'E'].map(function (p) {
            return '<button class="clist-perm-toggle" data-perm="' + p + '">' + p + '</button>';
        }).join('');
        popup.innerHTML =
            '<div class="clist-viewer-header">' +
            '<button class="clist-back-btn" data-action="show-picker">\u2190 Back</button>' +
            '<span class="clist-viewer-title">New Null Slot</span>' +
            '</div>' +
            '<div class="clist-null-form">' +
            '<div class="clist-null-form-label">Pet name</div>' +
            '<input class="clist-pet-name-input clist-null-name-input" type="text" placeholder="placeholder label\u2026" maxlength="32" />' +
            '<div class="clist-null-form-label">Permissions</div>' +
            '<div class="clist-perm-toggles">' + permsHtml + '</div>' +
            '<button class="clist-null-insert-btn" data-action="insert-null-slot">Insert</button>' +
            '</div>';
        positionPopup();
        var inp = popup.querySelector('.clist-null-name-input');
        if (inp) {
            inp.focus();
            // Enter in the name field activates Insert
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); popup.querySelector('[data-action="insert-null-slot"]').click(); }
            }, true);
        }
    }

    // ── Resolve Picker: choose an NS abstraction to introduce to a pending slot ─
    function showResolvePicker(slotIdx, pendingName) {
        var popup = getOrCreatePopup();
        focusedRow = -1;

        var s = (typeof sim !== 'undefined') ? sim : null;
        var bodyRows = '';

        // Section 1: System abstractions (fixed NS slots, always available)
        bodyRows += '<div class="clist-picker-section-header">System</div>';
        PICKER_SYSTEM.forEach(function (a) {
            bodyRows +=
                '<div class="clist-resolve-row" data-slot="' + slotIdx + '" data-ns-idx="' + a.slot + '" data-name="' + escHtml(a.name) + '">' +
                '<span class="clist-resolve-ns-slot">NS[' + a.slot + ']</span>' +
                '<span class="clist-resolve-name">' + escHtml(a.name) + '</span>' +
                '<span class="clist-resolve-hint">' + escHtml(a.hint) + '</span>' +
                '</div>';
        });

        // Section 2: Live namespace entries not already in PICKER_SYSTEM
        if (s && s.nsTable && s.nsLabels) {
            var liveRows = '';
            for (var li = 0; li < s.nsTable.length; li++) {
                if (!s.nsTable[li]) continue;
                var _lbl = (s.nsLabels && s.nsLabels[li]) || '';
                if (!_lbl) continue;
                var _alreadySystem = PICKER_SYSTEM.some(function (a) { return a.slot === li; });
                if (_alreadySystem) continue;
                try {
                    if (s.isNSEntryValid(li)) {
                        liveRows +=
                            '<div class="clist-resolve-row" data-slot="' + slotIdx + '" data-ns-idx="' + li + '" data-name="' + escHtml(_lbl) + '">' +
                            '<span class="clist-resolve-ns-slot">NS[' + li + ']</span>' +
                            '<span class="clist-resolve-name">' + escHtml(_lbl) + '</span>' +
                            '<span class="clist-resolve-hint">live</span>' +
                            '</div>';
                    }
                } catch (e3) { /* skip */ }
            }
            if (liveRows) {
                bodyRows += '<div class="clist-picker-section-header">Live Namespace</div>' + liveRows;
            }
        }

        popup.innerHTML =
            '<div class="clist-viewer-header">' +
            '<button class="clist-back-btn" data-action="show-view">\u2190 Back</button>' +
            '<span class="clist-viewer-title">Resolve \u201c' + escHtml(pendingName || ('CR' + slotIdx)) + '\u201d</span>' +
            '<span class="clist-viewer-hint">pick an abstraction</span>' +
            '</div>' +
            '<div class="clist-resolve-pending-label">CR' + slotIdx +
            (pendingName ? ' \u201c' + escHtml(pendingName) + '\u201d' : '') +
            ' \u2014 introduce to a live GT:</div>' +
            '<div class="clist-viewer-body">' + bodyRows + '</div>';
        popup.style.display = 'flex';
        positionPopup();
    }

    function showPicker() {
        var popup = getOrCreatePopup();
        focusedRow = -1;
        popup.innerHTML = '<div class="clist-viewer-header">' +
            '<button class="clist-back-btn" data-action="show-view">\u2190 Back</button>' +
            '<span class="clist-viewer-title">Add Capability</span>' +
            '</div>' +
            '<div class="clist-viewer-empty" style="opacity:0.6;">\u29BF Loading\u2026</div>';
        buildPickerContentAsync().then(function (html) {
            if (popup.style.display !== 'none') {
                popup.innerHTML = html;
                positionPopup();
            }
        }).catch(function () {
            if (popup.style.display !== 'none') {
                popup.innerHTML = '<div class="clist-viewer-empty">Picker unavailable.</div>';
            }
        });
    }

    function _scrollEditorToPos(ed, pos) {
        // Scroll the textarea so the character at `pos` is roughly centred.
        var lines = ed.value.slice(0, pos).split('\n');
        var lineIndex = lines.length - 1;
        var lineH = parseFloat(getComputedStyle(ed).lineHeight) || 20;
        var paddingTop = parseFloat(getComputedStyle(ed).paddingTop) || 0;
        ed.scrollTop = Math.max(0, paddingTop + lineIndex * lineH - ed.clientHeight / 3);
    }

    // ── Format a capabilities block from an ordered list of [name, rights] pairs ──
    // Produces clean 4-space-indented multi-line layout, no blank lines.
    // Example output:
    //   capabilities {
    //       Salvation E
    //       Navana E
    //   }
    function _formatCapBlock(entries) {
        if (!entries.length) return 'capabilities {\n}';
        return 'capabilities {\n' +
            entries.map(function (e) {
                return '    ' + e[0] + (e[1] ? ' ' + e[1] : '');
            }).join('\n') +
            '\n}';
    }

    // ── Parse all [name, rights] pairs from the interior of a capabilities block ──
    // Strips blank lines, comments, and trailing commas; returns ordered list.
    function _parseCapEntries(inner) {
        return inner.split('\n')
            .map(function (line) { return line.replace(/[;,].*$/, '').trim(); })
            .filter(Boolean)
            .map(function (line) {
                var parts = line.split(/\s+/);
                return parts[0] ? [parts[0], (parts[1] || '').toUpperCase()] : null;
            })
            .filter(function (e) { return e && !/^[;/]/.test(e[0]); });
    }

    function _insertCapability(capName, rights) {
        if (!capName) { hideViewer(); return; }
        var ed = activeEditor || document.getElementById('asmEditor');
        if (!ed) { hideViewer(); return; }
        var src = ed.value;
        var insertPos = -1;

        // The token written into the capabilities block: "Name RIGHTS" (e.g. "Tunnel E")
        var rightsStr = (rights && rights.trim()) ? rights.trim().toUpperCase() : '';
        var token = capName + (rightsStr ? ' ' + rightsStr : '');

        // Find the first capabilities { ... } block
        var capRe = /capabilities\s*\{([^}]*)\}/;
        var cm = capRe.exec(src);
        if (cm) {
            var entries = _parseCapEntries(cm[1]);
            var alreadyPresent = entries.some(function (e) { return e[0] === capName; });
            if (!alreadyPresent) {
                entries.push([capName, rightsStr]);
                var newBlock = _formatCapBlock(entries);
                var before = src.slice(0, cm.index);
                var after  = src.slice(cm.index + cm[0].length);
                ed.value = before + newBlock + after;
                // Position cursor on the newly added entry (last line before closing })
                var nameOffset = before.length + newBlock.lastIndexOf(capName);
                insertPos = nameOffset >= before.length ? nameOffset : before.length;
                ed.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // Already present — locate and select the existing entry so
                // the user can see it rather than getting a silent no-op.
                var existingMatch = new RegExp('\\b' + capName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
                var em = existingMatch.exec(src);
                insertPos = em ? em.index : -1;
            }
        } else {
            // No capabilities block — insert after the abstraction { opening line
            var token = capName + (rightsStr ? ' ' + rightsStr : '');
            var absRe = /(abstraction\s+\w+\s*\{[^\n]*)/;
            var am = absRe.exec(src);
            if (am) {
                var pos = am.index + am[0].length;
                var newBlock2 = '\n    ' + _formatCapBlock([[capName, rightsStr]]).replace(/\n/g, '\n    ');
                ed.value = src.slice(0, pos) + newBlock2 + src.slice(pos);
                insertPos = pos + newBlock2.indexOf(token);
            } else {
                var newBlock3 = _formatCapBlock([[capName, rightsStr]]);
                ed.value = newBlock3 + '\n\n' + src;
                insertPos = newBlock3.indexOf(token);
            }
            ed.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Scroll editor to the insertion / existing location and select the name.
        // When the source was actually changed, re-render the viewer so the source
        // path immediately reflects the new entry — the popup stays open so the
        // user can see the updated list and optionally add another capability.
        // When the cap was already present, close the popup and refocus the editor.
        if (insertPos >= 0) {
            _scrollEditorToPos(ed, insertPos);
            ed.setSelectionRange(insertPos, insertPos + token.length);
        }
        if (src !== ed.value) {
            showViewer();
        } else {
            hideViewer();
            ed.focus();
        }
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

        // Show a loading spinner immediately, then populate asynchronously
        popup.innerHTML = '<div class="clist-viewer-header">' +
            '<span class="clist-viewer-title">C-List</span>' +
            '</div>' +
            '<div class="clist-viewer-empty" style="opacity:0.6;">\u29BF Loading\u2026</div>';
        popup.style.display = 'flex';
        positionPopup();

        var btn = document.querySelector('.btn-clist-viewer');
        if (btn) btn.classList.add('btn-clist-viewer--active');

        buildContentAsync().then(function (html) {
            if (popup.style.display !== 'none') {
                popup.innerHTML = html;
                positionPopup();
            }
        }).catch(function () {
            if (popup.style.display !== 'none') {
                popup.innerHTML = emptyState('C-List unavailable.');
            }
        });
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
    // getNullSlotPetNames() — returns a copy of the slot-index → pet-name map.
    // Used by the assembler to resolve null-GT row names (e.g. "Mum") to their
    // c-list slot indices so  LOAD CR2, Mum  encodes correctly.
    function getNullSlotPetNames() {
        return Object.assign({}, _nullSlotPetNames);
    }

    window.CListViewer = {
        show:                showViewer,
        hide:                hideViewer,
        toggle:              toggleViewer,
        isVisible:           isVisible,
        getNullSlotPetNames: getNullSlotPetNames,
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
