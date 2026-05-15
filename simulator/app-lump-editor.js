// LUMP Header Settings Editor
// Covers Thread LUMP (typ=10) and Namespace LUMP (typ=01)

(function () {

    function nextPow2(n) {
        if (n <= 64) return 64;
        var p = 64;
        while (p < n) p <<= 1;
        return p;
    }

    function log2Exact(n) { return Math.round(Math.log2(n)); }

    function fmtWords(w) {
        if (w >= 1073741824) return (w / 1073741824).toFixed(w % 1073741824 === 0 ? 0 : 1) + ' G';
        if (w >= 1048576)    return (w / 1048576).toFixed(w % 1048576 === 0 ? 0 : 1) + ' M';
        if (w >= 1024)       return (w / 1024).toFixed(w % 1024 === 0 ? 0 : 1) + ' K';
        return w.toString();
    }

    function packHdr(n_minus_6, cw, cc, typ) {
        return (
            (0x1F               << 27) |
            ((n_minus_6 & 0xF)  << 23) |
            ((cw & 0x1FFF)      << 10) |
            ((typ & 0x3)        <<  8) |
            (cc & 0xFF)
        ) >>> 0;
    }

    function hex8(v) {
        return '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    function clamp(v, lo, hi) {
        v = parseInt(v, 10);
        if (isNaN(v)) v = lo;
        return Math.max(lo, Math.min(hi, v));
    }

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // NS size presets (n_minus_6 value → totalNamespaceWords = 2^(n+14))
    var NS_PRESETS = [
        { label: '16 K words  (min, n=0)',          n: 0  },
        { label: '32 K words  (n=1)',               n: 1  },
        { label: '64 K words  (n=2)',               n: 2  },
        { label: '128 K words (n=3)',               n: 3  },
        { label: '256 K words (n=4)',               n: 4  },
        { label: '512 K words (n=5)',               n: 5  },
        { label: '1 M words   (n=6)',               n: 6  },
        { label: '2 M words   (n=7)',               n: 7  },
        { label: '4 M words   (n=8)',               n: 8  },
        { label: '8 M words   (n=9)',               n: 9  },
        { label: '16 M words  (n=10)',              n: 10 },
        { label: '32 M words  (n=11)',              n: 11 },
        { label: '64 M words  (n=12)',              n: 12 },
        { label: '128 M words (n=13)',              n: 13 },
        { label: '256 M words (n=14)',              n: 14 },
        { label: '512 M words (max, n=15)',         n: 15 }
    ];

    // Returns only the NS_PRESETS that fit within the given board RAM (in words).
    // Each preset requires 2^(n+14) words; presets larger than boardRam are excluded.
    // Always returns at least one entry (the minimum 16 K preset) so the UI is never empty.
    // Board RAM limits:
    //   Tang Nano 9K          2,048 w  → no preset fits → fallback to min (shows warning)
    //   Tang Nano 20K / IoT  16,384 w  → only n=0 (16 K) shown
    //   Efinix Ti60 F225     65,536 w  → n=0–2 (16 K–64 K) shown
    //   Wukong XC7A100T     131,072 w  → n=0–3 (16 K–128 K) shown
    function getValidNSPresets(boardRam) {
        var fits = NS_PRESETS.filter(function (p) {
            return Math.pow(2, p.n + 14) <= boardRam;
        });
        return fits.length > 0 ? fits : [NS_PRESETS[0]];
    }

    // Set when clampNSStateToBoard() reduces n_minus_6 due to a board switch.
    // Cleared by an explicit user preset pick or banner dismissal.
    var _nsSizeClampedInfo = null;  // { savedN, clampedN, boardLabel } | null

    // Set when clampThreadStateToBoard() reduces lumpPow2 due to a board switch.
    // Cleared by an explicit user lump-size pick or banner dismissal.
    var _threadLumpClampedInfo = null;  // { savedExp, clampedExp, boardLabel } | null

    // Set when clampThreadStateToBoard() reduces thread count due to a board switch.
    // Cleared by an explicit user count change or banner dismissal.
    var _threadCountClampedInfo = null;  // { savedCount, clampedCount, boardLabel } | null

    // Clamps lumpPow2 to the maximum valid value for the current board.
    // Call this whenever the board selection changes to keep state consistent.
    function clampThreadStateToBoard() {
        var profile  = getBoardProfile();
        var budget   = Math.floor(profile.totalRamWords / 2);

        // Step 1: compute effective max count from saved lump size and board budget,
        // then clamp count and record a warning if it was reduced.
        var savedLumpSize = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, MAX_EXP));
        var maxCount = profile.singleThread ? 1 : Math.min(10, Math.max(1, Math.floor(budget / savedLumpSize)));
        if (state.thread.count > maxCount) {
            var savedCount = state.thread.count;
            state.thread.count = maxCount;
            _threadCountClampedInfo = { savedCount: savedCount, clampedCount: maxCount, boardLabel: profile.label };
        } else {
            _threadCountClampedInfo = null;
        }

        // Step 2: clamp lump size using the (possibly clamped) count.
        var count        = clamp(state.thread.count, 1, maxCount);
        var maxLumpWords = Math.max(64, Math.floor(budget / count));
        var maxExp       = maxExpForWords(Math.min(maxLumpWords, 8192));
        if (state.thread.lumpPow2 > maxExp) {
            var savedExp = state.thread.lumpPow2;
            state.thread.lumpPow2 = maxExp;
            _threadLumpClampedInfo = { savedExp: savedExp, clampedExp: maxExp, boardLabel: profile.label };
        } else {
            _threadLumpClampedInfo = null;
        }

        saveState();
    }

    // Clamps n_minus_6 to the maximum valid preset for the current board.
    // Call this whenever the board selection changes to keep state consistent.
    function clampNSStateToBoard() {
        var profile = getBoardProfile();
        var valid   = getValidNSPresets(profile.totalRamWords);
        var maxN    = valid[valid.length - 1].n;
        if (state.ns.n_minus_6 > maxN) {
            var savedN = state.ns.n_minus_6;
            state.ns.n_minus_6 = maxN;
            var newMaxSl = Math.pow(2, maxN + 14) / 64;
            if (state.ns.slots > newMaxSl) state.ns.slots = newMaxSl;
            _nsSizeClampedInfo = { savedN: savedN, clampedN: maxN, boardLabel: profile.label };
            saveState();
        } else {
            // Current size fits the new board — clear any stale clamp warning.
            _nsSizeClampedInfo = null;
            saveState();
        }
    }

    // state.thread.lumpPow2: exponent for lump size (e.g. 8 = 256 words)
    // state.thread.stackFrames: number of stack frames (each frame = 2 words)
    var state = {
        thread: { lumpPow2: 8, stackFrames: 16, count: 1 },
        ns: { n_minus_6: 3, slots: 2000 }
    };

    function loadState() {
        try {
            var s = JSON.parse(localStorage.getItem('lump_editor_state') || '{}');
            if (s.thread) {
                if (s.thread.lumpPow2 !== undefined) {
                    state.thread.lumpPow2 = clamp(s.thread.lumpPow2, 6, 13);
                }
                if (s.thread.stackFrames !== undefined) {
                    state.thread.stackFrames = clamp(s.thread.stackFrames, 10, 255);
                }
                state.thread.count = (s.thread.count !== undefined) ? clamp(s.thread.count, 1, 10) : 1;
            }
            if (s.ns) {
                state.ns.n_minus_6 = (s.ns.n_minus_6 !== undefined) ? s.ns.n_minus_6 : 3;
                state.ns.slots = s.ns.slots || 2000;
            }
            // Restore the board-switch clamp warning if it is still applicable.
            // It is applicable when the current n_minus_6 still matches what the
            // clamp forced it to, meaning the user has not explicitly chosen a new size.
            if (s.nsSizeClampedInfo &&
                    typeof s.nsSizeClampedInfo.savedN    === 'number' &&
                    typeof s.nsSizeClampedInfo.clampedN  === 'number' &&
                    typeof s.nsSizeClampedInfo.boardLabel === 'string' &&
                    state.ns.n_minus_6 === s.nsSizeClampedInfo.clampedN) {
                _nsSizeClampedInfo = s.nsSizeClampedInfo;
            }
        } catch (e) {}
    }

    function saveState() {
        try {
            var payload = JSON.parse(JSON.stringify(state));
            payload.nsSizeClampedInfo = _nsSizeClampedInfo || null;
            localStorage.setItem('lump_editor_state', JSON.stringify(payload));
        } catch (e) {}
    }

    // ── memory bar ────────────────────────────────────────────────────────────

    function renderBar(zones) {
        var total = zones.reduce(function (s, z) { return s + z.words; }, 0);
        if (total <= 0) return '';
        return '<div class="le-bar">' + zones.map(function (z) {
            if (z.words <= 0) return '';
            var pct = (z.words / total * 100).toFixed(2);
            var clickAttr = z.onclick ? ' onclick="' + z.onclick + '" style="flex:' + z.words + ';cursor:pointer"' : ' style="flex:' + z.words + '"';
            return '<div class="le-bar-zone ' + esc(z.cls) + '"' + clickAttr + ' title="' + esc(z.label + ': ' + z.words.toLocaleString() + ' words' + (z.onclick ? ' — click to open' : '')) + '">' +
                   '<span class="le-bar-label">' + esc(z.label) + '</span>' +
                   '<span class="le-bar-pct">' + esc(pct + '%') + '</span></div>';
        }).join('') + '</div>';
    }

    function renderMagBar(zones) {
        var total = zones.reduce(function (s, z) { return s + z.words; }, 0);
        if (total <= 0) return '';
        var floor = Math.max(1, Math.ceil(total * 0.08));
        return '<div class="le-mag-caption">&#x1F50D; Magnified — small zones expanded to 8 % min</div>' +
               '<div class="le-bar le-bar-mag">' + zones.map(function (z) {
            if (z.words <= 0) return '';
            var flex = Math.max(z.words, floor);
            var realPct = (z.words / total * 100).toFixed(2);
            var clickAttr = z.onclick ? ' onclick="' + z.onclick + '" style="flex:' + flex + ';cursor:pointer"' : ' style="flex:' + flex + '"';
            return '<div class="le-bar-zone ' + esc(z.cls) + '"' + clickAttr + ' title="' + esc(z.label + ': ' + z.words.toLocaleString() + ' words  (' + realPct + '%)' + (z.onclick ? ' — click to open' : '')) + '">' +
                   '<span class="le-bar-label">' + esc(z.label) + '</span>' +
                   '<span class="le-bar-pct">' + esc(z.words.toLocaleString() + ' w') + '</span></div>';
        }).join('') + '</div>';
    }

    // ── summary grid ──────────────────────────────────────────────────────────

    function renderGrid(rows) {
        return '<dl class="le-grid">' + rows.map(function (r) {
            return '<dt class="le-grid-label">' + esc(r[0]) + '</dt>' +
                   '<dd class="le-grid-value' + (r[2] ? ' ' + esc(r[2]) : '') + '">' + r[1] + '</dd>';
        }).join('') + '</dl>';
    }

    function copyBtn(id) {
        return ' <button class="le-copy-btn" onclick="lumpEditorCopy(\'' + esc(id) + '\')" title="Copy to clipboard">copy</button>';
    }

    // ── step1 boot-config POST helper ────────────────────────────────────────

    function _getStep1Payload() {
        var board    = (typeof localStorage !== 'undefined' && localStorage.getItem('fpga_board_target')) || 'wukong-xc7a100t';
        var profile  = BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
        var boardRam = profile.totalRamWords;
        var validPresets = getValidNSPresets(boardRam);
        var maxN               = validPresets[validPresets.length - 1].n;
        var n                  = clamp(state.ns.n_minus_6, 0, maxN);
        var totalNamespaceWords = Math.pow(2, n + 14);
        var threadLumpWords     = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, MAX_EXP));
        return {
            targetBoard: board,
            step1: {
                totalNamespaceWords: totalNamespaceWords,
                namespaceLumpWords:  64,
                threadLumpWords:     threadLumpWords
            }
        };
    }

    function _postStep1(statusEl, errEl) {
        var s1payload = _getStep1Payload();
        if (statusEl) statusEl.textContent = 'Saving step 1\u2026';
        if (errEl)    errEl.textContent    = '';
        return fetch('/api/boot-config')
        .then(function(r) { return r.json(); })
        .then(function(current) {
            var merged = {
                targetBoard: s1payload.targetBoard,
                step1:       s1payload.step1,
                step2:       (current && current.config && current.config.step2) || { lumps: [] },
                step3:       (current && current.config && current.config.step3) || { emptySlotCount: 0 }
            };
            return fetch('/api/boot-config', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(merged)
            });
        })
        .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
        .then(function(res) {
            if (!res.ok || res.body.ok === false) {
                if (statusEl) statusEl.textContent = '';
                if (errEl)    errEl.textContent    = (res.body && res.body.error) || 'Save failed.';
                return false;
            }
            window.bootConfig = res.body.config;
            if (statusEl) statusEl.textContent = 'Step 1 saved. Reset the simulator to apply.';
            return true;
        })
        .catch(function(err) {
            if (statusEl) statusEl.textContent = '';
            if (errEl)    errEl.textContent    = 'Save failed: ' + err;
            return false;
        });
    }

    // ── Resident Lumps panel state ────────────────────────────────────────────

    var _rl = {
        catalog:        [],
        step2State:     {},
        emptySlotCount: 0,
        limits:         { maxNsEntries: 256, baseNamedNsCount: 47 },
        loaded:         false,
        loading:        false,
        errorMsg:       '',
        statusMsg:      ''
    };

    function _rlLoad() {
        if (_rl.loading) return;
        _rl.loading   = true;
        _rl.loaded    = false;
        _rl.errorMsg  = '';
        _rl.statusMsg = '';
        var el = document.getElementById('lumpResidentPanel');
        if (el) el.innerHTML = '<div class="le-panel"><p class="le-panel-desc">Loading catalog\u2026</p></div>';
        fetch('/api/boot-config')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _rl.loading = false;
                _rl.loaded  = true;
                _rl.catalog = (data && data.lumpCatalog) || [];
                _rl.limits  = (data && data.limits) || { maxNsEntries: 256, baseNamedNsCount: 47 };
                var cfg = (data && data.config) || (data && data.defaults) || {};
                _rlInitStep2(cfg);
                var s3 = cfg.step3 || {};
                _rl.emptySlotCount = Number.isFinite(s3.emptySlotCount) ? s3.emptySlotCount : 0;
                renderResidentPanel();
            })
            .catch(function(err) {
                _rl.loading  = false;
                _rl.loaded   = false;
                _rl.errorMsg = 'Failed to load boot config: ' + err;
                renderResidentPanel();
            });
    }

    function _rlInitStep2(cfg) {
        _rl.step2State = {};
        var savedLumps = (cfg && cfg.step2 && cfg.step2.lumps) || [];
        var savedMap = {};
        for (var i = 0; i < savedLumps.length; i++) {
            savedMap[savedLumps[i].nsSlot] = savedLumps[i];
        }
        for (var j = 0; j < _rl.catalog.length; j++) {
            var cat = _rl.catalog[j];
            var saved = savedMap[cat.nsSlot];
            _rl.step2State[cat.nsSlot] = {
                resident:    !!(saved && saved.resident),
                physAddr:    (saved && Number.isFinite(saved.physAddr)) ? saved.physAddr : null,
                lumpSize:    cat.lumpSize,
                abstraction: cat.abstraction
            };
        }
    }

    function _rlAddrRange() {
        var p    = _getStep1Payload();
        var s1   = p.step1;
        var board        = p.targetBoard || 'wukong-xc7a100t';
        var boardProfile = BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
        var bootSlot = parseInt(localStorage.getItem('bootEntrySlot'), 10);
        if (!Number.isFinite(bootSlot) || bootSlot < 0) bootSlot = 3;
        var bootCatEntry = null;
        for (var bi = 0; bi < _rl.catalog.length; bi++) {
            if (_rl.catalog[bi].nsSlot === bootSlot) { bootCatEntry = _rl.catalog[bi]; break; }
        }
        var bootAbstrSz  = (bootCatEntry && bootCatEntry.lumpSize) ? bootCatEntry.lumpSize : 64;
        var NS_TABLE_RESERVE = 0x400;
        var sum    = (s1.namespaceLumpWords || 0) + (s1.threadLumpWords || 0) + bootAbstrSz;
        var total  = s1.totalNamespaceWords || 0;
        var usable = total - NS_TABLE_RESERVE;
        var boardTotalWords = boardProfile.totalRamWords;
        return {
            min:        sum,
            max:        Math.min(usable, boardTotalWords) - 1,
            boardLabel: boardProfile.label
        };
    }

    function _rlValidate() {
        var p    = _getStep1Payload();
        var s1   = p.step1;
        var board        = p.targetBoard || 'wukong-xc7a100t';
        var boardProfile = BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
        var boardTotalWords = boardProfile.totalRamWords;
        var bootSlotV = parseInt(localStorage.getItem('bootEntrySlot'), 10);
        if (!Number.isFinite(bootSlotV) || bootSlotV < 0) bootSlotV = 3;
        var bootCatEntryV = null;
        for (var bvi = 0; bvi < _rl.catalog.length; bvi++) {
            if (_rl.catalog[bvi].nsSlot === bootSlotV) { bootCatEntryV = _rl.catalog[bvi]; break; }
        }
        var bootAbstrSz  = (bootCatEntryV && bootCatEntryV.lumpSize) ? bootCatEntryV.lumpSize : 64;
        var NS_TABLE_RESERVE = 0x400;
        var sum    = (s1.namespaceLumpWords || 0) + (s1.threadLumpWords || 0) + bootAbstrSz;
        var total  = s1.totalNamespaceWords || 0;
        var usable = total - NS_TABLE_RESERVE;
        var occ = [];
        for (var slotStr in _rl.step2State) {
            var st = _rl.step2State[slotStr];
            if (!st.resident) continue;
            var lbl = (st.abstraction || '?') + ' (NS ' + slotStr + ')';
            if (!Number.isFinite(st.physAddr) || st.physAddr < 0) {
                return lbl + ': physAddr is required for resident lumps.';
            }
            if (st.physAddr !== Math.floor(st.physAddr)) {
                return lbl + ': physAddr must be a whole-word address (got ' + st.physAddr + ').';
            }
            var sz = st.lumpSize || 0;
            if (sz <= 0) return lbl + ': missing lumpSize.';
            if (st.physAddr < sum) {
                return lbl + ': physAddr ' + st.physAddr + ' overlaps the foundational region (0\u2026' + (sum - 1) + ').';
            }
            if (st.physAddr + sz > boardTotalWords) {
                return lbl + ': ' + sz + '-word lump at physAddr ' + st.physAddr +
                       ' extends past the ' + boardProfile.label + ' board RAM limit (' +
                       boardTotalWords + ' words). Reduce physAddr or choose a larger board.';
            }
            if (st.physAddr + sz > usable) {
                return lbl + ': ' + sz + '-word lump at ' + st.physAddr + ' extends past usable namespace region (' + usable + ' words).';
            }
            for (var k = 0; k < occ.length; k++) {
                if (!(st.physAddr + sz <= occ[k].start || st.physAddr >= occ[k].end)) {
                    return lbl + ': overlaps ' + occ[k].label + '.';
                }
            }
            occ.push({ start: st.physAddr, end: st.physAddr + sz, label: lbl });
        }
        var maxNs   = _rl.limits.maxNsEntries   || 256;
        var baseNs  = _rl.limits.baseNamedNsCount || 47;
        var emptyCount = _rl.emptySlotCount || 0;
        if (!Number.isFinite(emptyCount) || emptyCount < 0) {
            return 'Empty NS slot count must be a non-negative integer.';
        }
        var need = baseNs + emptyCount;
        if (need > maxNs) {
            return 'Reserving ' + emptyCount + ' empty slots after the ' + baseNs +
                   ' named slots would need ' + need + ' entries but the NS table only holds ' +
                   maxNs + '. Max reservable: ' + (maxNs - baseNs) + '.';
        }
        return '';
    }

    function _rlOnChange(ev) {
        var slot  = parseInt(ev.target.getAttribute('data-rl-slot'), 10);
        var field = ev.target.getAttribute('data-rl-field');
        var st    = _rl.step2State[slot] || {};
        if (field === 'resident') {
            st.resident = !!ev.target.checked;
        } else if (field === 'physAddr') {
            var v = ev.target.value;
            st.physAddr = (v === '' ? null : parseInt(v, 10));
        }
        _rl.step2State[slot] = st;
        renderResidentPanel();
    }

    function renderResidentPanel() {
        var el = document.getElementById('lumpResidentPanel');
        if (!el) return;

        if (!_rl.loaded && !_rl.errorMsg) {
            _rlLoad();
            return;
        }

        var err    = _rlValidate();
        var maxNs  = _rl.limits.maxNsEntries    || 256;
        var baseNs = _rl.limits.baseNamedNsCount || 47;

        // 3-LUMP starter kit — always shown at top, locked as Boot
        var bootSlot = parseInt(localStorage.getItem('bootEntrySlot'), 10);
        if (!Number.isFinite(bootSlot) || bootSlot < 0) bootSlot = 3;
        var bootCatEntry = null;
        for (var bi = 0; bi < _rl.catalog.length; bi++) {
            if (_rl.catalog[bi].nsSlot === bootSlot) { bootCatEntry = _rl.catalog[bi]; break; }
        }

        var p1 = _getStep1Payload();
        var nsSize     = p1.step1.namespaceLumpWords || 64;
        var threadSize = Math.pow(2, state.thread.lumpPow2);
        var bootEntrySize = bootCatEntry ? (bootCatEntry.lumpSize != null ? bootCatEntry.lumpSize : '\u2014') : '\u2014';
        var bootEntryNsSlot = bootCatEntry ? bootCatEntry.nsSlot : bootSlot;

        var bootEntryCell;
        if (!_rl.catalog.length) {
            bootEntryCell = '<td class="le-rl-td"><span class="le-rl-boot-note">\u2014 loading catalog \u2014</span></td>';
        } else {
            var showAll = localStorage.getItem('bootDropdownShowAll') === '1';
            var validBootTarget = function (ce) {
                return ce.nsSlotPolicy !== 'dynamic' && ce.hasExecutableMethods;
            };
            var hiddenCount = 0;
            for (var hci = 0; hci < _rl.catalog.length; hci++) {
                var hce = _rl.catalog[hci];
                if (!validBootTarget(hce) && hce.nsSlot !== bootSlot) hiddenCount++;
            }
            var selectOpts = '';
            for (var ci = 0; ci < _rl.catalog.length; ci++) {
                var ce = _rl.catalog[ci];
                var isValid = validBootTarget(ce);
                if (!showAll && !isValid && ce.nsSlot !== bootSlot) continue;
                var optSuffix = (!isValid) ? ' \u26a0 not a boot target' : '';
                var optLabel = esc((ce.abstraction || 'Slot ' + ce.nsSlot) +
                    ' (NS slot ' + ce.nsSlot + ', ' + (ce.lumpSize != null ? ce.lumpSize : '?') + ' words)' + optSuffix);
                selectOpts += '<option value="' + ce.nsSlot + '"' +
                    (ce.nsSlot === bootSlot ? ' selected' : '') + '>' + optLabel + '</option>';
            }
            var showAllToggle = hiddenCount > 0
                ? '<label class="le-rl-show-all-toggle">' +
                  '<input type="checkbox" onchange="lumpEditorBootShowAllToggle(this.checked)"' +
                  (showAll ? ' checked' : '') + '> show all (' + hiddenCount + ' hidden)</label>'
                : '';
            var bootWarn = '';
            if (bootCatEntry && !validBootTarget(bootCatEntry)) {
                var warnReasons = [];
                if (bootCatEntry.nsSlotPolicy === 'dynamic') {
                    warnReasons.push('dynamic-policy lump \u2014 NS slot is ephemeral and cannot serve as the boot entry');
                }
                if (!bootCatEntry.hasExecutableMethods) {
                    warnReasons.push('no executable methods \u2014 nothing to run at boot');
                }
                bootWarn = '<div class="le-rl-boot-warn">\u26a0\ufe0f ' + esc(warnReasons.join('; ')) + '</div>';
            }
            bootEntryCell = '<td class="le-rl-td">' +
                '<select class="le-rl-boot-select" onchange="lumpEditorBootEntryChange(parseInt(this.value,10))">' +
                selectOpts + '</select>' + showAllToggle + bootWarn + '</td>';
        }

        var rows =
            '<tr class="le-rl-row le-rl-boot-row">' +
                '<td class="le-rl-td">Boot.NS <span class="le-rl-boot-note">Namespace root</span></td>' +
                '<td class="le-rl-td le-rl-td-num">0</td>' +
                '<td class="le-rl-td le-rl-td-num">' + esc(String(nsSize)) + '</td>' +
                '<td class="le-rl-td"><span class="le-rl-boot-badge">Boot</span></td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
            '</tr>' +
            '<tr class="le-rl-row le-rl-boot-row">' +
                '<td class="le-rl-td">Boot.Thread <span class="le-rl-boot-note">Initial thread \u00b7 size set on Thread tab</span></td>' +
                '<td class="le-rl-td le-rl-td-num">1</td>' +
                '<td class="le-rl-td le-rl-td-num">' + esc(String(threadSize)) + '</td>' +
                '<td class="le-rl-td"><span class="le-rl-boot-badge">Boot</span></td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
            '</tr>' +
            '<tr class="le-rl-row le-rl-boot-row le-rl-boot-entry-row">' +
                bootEntryCell +
                '<td class="le-rl-td le-rl-td-num">' + esc(String(bootEntryNsSlot)) + '</td>' +
                '<td class="le-rl-td le-rl-td-num">' + esc(String(bootEntrySize)) + '</td>' +
                '<td class="le-rl-td"><span class="le-rl-boot-badge">Boot</span></td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
                '<td class="le-rl-td le-rl-addr-na">\u2014</td>' +
            '</tr>';

        var addrRange    = _rlAddrRange();
        var addrHintText = 'Valid range: 0x' + addrRange.min.toString(16).toUpperCase() +
                           '\u20130x' + addrRange.max.toString(16).toUpperCase() +
                           ' for ' + addrRange.boardLabel;

        var _bootBadge = function (cat) {
            if (cat.nsSlotPolicy === 'dynamic') {
                return '<span class="le-rl-badge le-rl-badge-floating"' +
                    ' data-tooltip="Allocated dynamically at runtime — NS slot assigned on first use">\u2014 Floating</span>';
            }
            if (cat.hasExecutableMethods) {
                return '<span class="le-rl-badge le-rl-badge-bootable le-rl-badge-bootable-click"' +
                    ' onclick="lumpEditorBootBadgeClick(' + cat.nsSlot + ')"' +
                    ' data-tooltip="Click to set as boot entry">\u2713 Bootable</span>';
            }
            return '<span class="le-rl-badge le-rl-badge-data"' +
                ' data-tooltip="No executable methods — cannot be set as boot entry">\u2014 Data only</span>';
        };

        if (!_rl.catalog.length) {
            rows += '<tr><td colspan="6" class="le-rl-empty-msg">No catalog lumps available ' +
                   '(server/lumps/manifest.json has no assignable entries).</td></tr>';
        } else {
            for (var i = 0; i < _rl.catalog.length; i++) {
                var cat = _rl.catalog[i];
                var st  = _rl.step2State[cat.nsSlot] || {};
                var physVal = (st.physAddr != null && Number.isFinite(st.physAddr))
                              ? st.physAddr : '';
                rows +=
                    '<tr class="le-rl-row">' +
                    '<td class="le-rl-td">' + esc(cat.abstraction || '?') + '</td>' +
                    '<td class="le-rl-td le-rl-td-num">' + esc(String(cat.nsSlot)) + '</td>' +
                    '<td class="le-rl-td le-rl-td-num">' + esc(cat.lumpSize != null ? String(cat.lumpSize) : '?') + '</td>' +
                    '<td class="le-rl-td">' +
                      '<label class="le-rl-mode-label' + (st.resident ? ' le-rl-mode-resident' : '') + '">' +
                        '<input type="checkbox" class="le-rl-check"' +
                          ' data-rl-slot="' + cat.nsSlot + '"' +
                          ' data-rl-field="resident"' +
                          (st.resident ? ' checked' : '') + '> ' +
                        (st.resident ? 'Resident' : 'Lazy') +
                      '</label>' +
                    '</td>' +
                    '<td class="le-rl-td">' +
                      '<input type="number" min="' + addrRange.min + '" max="' + addrRange.max + '" step="1"' +
                        ' class="le-rl-addr"' +
                        ' data-rl-slot="' + cat.nsSlot + '"' +
                        ' data-rl-field="physAddr"' +
                        ' value="' + esc(String(physVal)) + '"' +
                        (st.resident ? '' : ' disabled') + '>' +
                      '<div class="le-rl-addr-hint' + (st.resident ? '' : ' le-rl-addr-hint-inactive') + '">' +
                        esc(addrHintText) +
                      '</div>' +
                    '</td>' +
                    '<td class="le-rl-td le-rl-td-boot">' + _bootBadge(cat) + '</td>' +
                    '</tr>';
            }
        }

        var errorBanner  = err
            ? '<div class="le-error-banner">\u26A0 ' + esc(err) + '</div>'
            : '';
        var rlErrorMsg   = _rl.errorMsg
            ? '<div class="le-error-banner">' + esc(_rl.errorMsg) + '</div>'
            : '';
        var statusBanner = (_rl.statusMsg && !err)
            ? '<div class="le-rl-status">' + esc(_rl.statusMsg) + '</div>'
            : '';

        el.innerHTML =
            '<div class="le-panel le-panel-wide">' +
            '<p class="le-panel-desc">Pick which catalog lumps are baked into the boot image at a fixed physical address ' +
            '(<strong style="color:var(--church-gold)">Resident</strong>) and which are fetched on first ' +
            '<code>CALL</code> (<strong>Lazy</strong>). Resident lumps require a physical address inside the usable ' +
            'region (after the foundational lumps, before the NS table).</p>' +
            rlErrorMsg +
            '<div class="le-rl-table-wrap">' +
            '<table class="le-rl-table">' +
            '<thead><tr>' +
            '<th class="le-rl-th">Lump</th>' +
            '<th class="le-rl-th le-rl-th-narrow">NS</th>' +
            '<th class="le-rl-th le-rl-th-narrow">Size&nbsp;(w)</th>' +
            '<th class="le-rl-th le-rl-th-mode">Mode</th>' +
            '<th class="le-rl-th">Phys addr&nbsp;(resident only)</th>' +
            '<th class="le-rl-th le-rl-th-boot">Boot?</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
            '</table>' +
            '</div>' +
            '<div class="le-divider"></div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Empty NS slots<span class="le-range-hint">Reserve N extra slots at boot for runtime growth</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="number" class="le-number" id="le-rl-empty-slots" min="0" step="1"' +
                        ' value="' + esc(String(_rl.emptySlotCount)) + '"' +
                        ' oninput="lumpEditorRLEmptySlots(this.value)">' +
                    '<span class="le-rl-hint">baseline ' + baseNs + ' named + reserve \u2264 ' + maxNs + ' total</span>' +
                '</div>' +
            '</div>' +
            errorBanner +
            statusBanner +
            '<div id="le-rl-save-status" class="le-rl-status" style="min-height:1.2em;"></div>' +
            '<div id="le-rl-gen-result" class="le-rl-status" style="min-height:1em;"></div>' +
            '<div class="le-save-row le-rl-btn-row">' +
                '<button class="le-save-btn"' + (err ? ' disabled' : '') + ' onclick="lumpEditorRLSave()">' +
                    '\u2714\ufe0e Save boot config' +
                '</button>' +
                '<button class="le-rl-gen-btn" id="le-rl-gen-btn" onclick="lumpEditorRLGenerate()"' +
                    ' title="Generate the binary boot image from the saved config and produce a downloadable .bin">' +
                    '\u2699\ufe0e Generate Boot Image' +
                '</button>' +
                '<button class="le-rl-gen-btn" onclick="lumpEditorRLUpload()"' +
                    ' title="Upload a pre-built boot-image.bin from your computer">' +
                    '\u2B06\ufe0e Upload .bin' +
                '</button>' +
            '</div>' +
            '<div class="le-rl-drop-zone" id="le-rl-drop-zone"' +
                ' ondragover="event.preventDefault();event.dataTransfer.dropEffect=\'copy\';this.classList.add(\'le-rl-drop-active\')"' +
                ' ondragleave="this.classList.remove(\'le-rl-drop-active\')"' +
                ' ondrop="event.preventDefault();this.classList.remove(\'le-rl-drop-active\');' +
                          'var _f=event.dataTransfer.files&&event.dataTransfer.files[0];' +
                          'if(_f){if(!_f.name.toLowerCase().endsWith(\'.bin\')&&_f.type!==\'application/octet-stream\'){' +
                          'document.getElementById(\'le-rl-gen-result\').textContent=\'Only .bin boot image files are accepted.\';' +
                          '}else{document.getElementById(\'le-rl-gen-result\').textContent=\'\';' +
                          'if(typeof uploadBootImageFile===\'function\')uploadBootImageFile(_f);}}">' +
                'Drop a <code>.bin</code> boot image file here to upload' +
            '</div>' +
            '<input type="file" id="le-rl-upload-input" accept=".bin,application/octet-stream"' +
                ' style="display:none;" onchange="lumpEditorRLHandleUpload(this)">' +
            '</div>';

        el.querySelectorAll('.le-rl-check, .le-rl-addr').forEach(function(inp) {
            inp.oninput = inp.onchange = _rlOnChange;
        });
    }

    // ── Thread panel ──────────────────────────────────────────────────────────

    var DR_WORDS  = 16;   // DR0–DR15, static
    var CAP_WORDS = 12;   // CR0–CR11 GT home slots, static
    var MIN_EXP   = 6;    // 64 words minimum lump
    var MAX_EXP   = 13;   // 8192 words cap

    var BOARD_PROFILES = {
        'tang-nano-20k-iot': { label: 'Tang Nano 20K',      totalRamWords: 16384,  singleThread: true  },
        'ti60-f225':         { label: 'Ti60 F225',           totalRamWords: 65536,  singleThread: false },
        'wukong-xc7a100t':   { label: 'Wukong XC7A100T',    totalRamWords: 131072, singleThread: false }
    };

    function getBoardProfile() {
        var board = (typeof localStorage !== 'undefined' && localStorage.getItem('fpga_board_target')) || 'wukong-xc7a100t';
        return BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
    }

    // Returns the largest exponent e such that 2^e ≤ n, bounded to [MIN_EXP, MAX_EXP]
    function maxExpForWords(n) {
        if (n <= 0) return MIN_EXP;
        var e = Math.floor(Math.log2(n));
        return Math.max(MIN_EXP, Math.min(MAX_EXP, e));
    }

    function renderThreadPanel() {
        var profile      = getBoardProfile();
        var budget       = Math.floor(profile.totalRamWords / 2);

        // Count is bounded by singleThread rule; compute preliminary max
        var count        = clamp(state.thread.count, 1, profile.singleThread ? 1 : 10);

        // Max lump size = floor(budget / count), capped at 8192 words
        var maxLumpWords = Math.max(64, Math.floor(budget / count));
        var maxLumpPow2  = maxExpForWords(Math.min(maxLumpWords, 8192));

        // Clamp stored exponent to valid range
        var lumpPow2     = clamp(state.thread.lumpPow2, MIN_EXP, maxLumpPow2);
        var lumpSize     = Math.pow(2, lumpPow2);
        var n            = lumpPow2 - 6;

        // Stack frames: 10–255
        var stackFrames  = clamp(state.thread.stackFrames, 10, 255);
        var stackWords   = stackFrames * 2;

        // Heap is derived — may go negative (over-capacity)
        var heap         = lumpSize - 1 - DR_WORDS - stackWords - CAP_WORDS;
        var overCapacity = heap <= 0;

        // cw encodes heap words; cc encodes frame count
        var cw = overCapacity ? 0 : heap;
        var cc = stackFrames;
        var word    = packHdr(n, cw, cc, 2);
        var wordHex = hex8(word);

        // Thread count max recalculated with actual lump size
        var maxCount    = profile.singleThread ? 1 : Math.min(10, Math.max(1, Math.floor(budget / lumpSize)));
        count           = clamp(count, 1, maxCount);
        var totalMem    = lumpSize * count;
        var overBudget  = totalMem > budget;

        // Build lump size dropdown options (powers of 2 from MIN_EXP to maxLumpPow2)
        var lumpOpts = '';
        for (var e = MIN_EXP; e <= maxLumpPow2; e++) {
            var words = Math.pow(2, e);
            var optLabel = fmtWords(words) + ' words  (2^' + e + ')';
            lumpOpts += '<option value="' + e + '"' + (e === lumpPow2 ? ' selected' : '') + '>' + esc(optLabel) + '</option>';
        }

        var heapDisplay = overCapacity
            ? '<span class="le-overflow">⚠ over capacity — increase lump size or reduce stack</span>'
            : esc(heap.toLocaleString() + ' words');

        var memStatus = overBudget
            ? '<span class="le-overflow">⚠ ' + esc(fmtWords(totalMem) + ' words — exceeds 50 % budget') + '</span>'
            : esc(fmtWords(totalMem) + ' words  (' + count + ' × ' + fmtWords(lumpSize) + ')');

        var zones = overCapacity ? [] : [
            { label: 'Header',    words: 1,           cls: 'le-zone-hdr'   },
            { label: 'Data Regs', words: DR_WORDS,    cls: 'le-zone-dr'    },
            { label: 'Heap',      words: heap,         cls: 'le-zone-heap'  },
            { label: 'Stack',     words: stackWords,   cls: 'le-zone-stack' },
            { label: 'Cap Regs',  words: CAP_WORDS,   cls: 'le-zone-caps'  }
        ];

        var grid = renderGrid([
            ['Target board',   esc(profile.label), 'le-val-gold'],
            ['Physical RAM',   esc(profile.totalRamWords.toLocaleString() + ' words'), ''],
            ['Thread budget',  esc(fmtWords(budget) + ' words  (50 % of RAM)'), ''],
            ['Lump size',      esc(fmtWords(lumpSize) + ' words  (2^' + lumpPow2 + ')'), 'le-val-gold'],
            ['Thread count',   esc(String(count) + (profile.singleThread ? '  (max 1 — single-thread board)' : '  (max ' + maxCount + ')')), ''],
            ['Total memory',   memStatus, overBudget ? '' : 'le-val-gold'],
            ['n_minus_6',      esc(String(n)), ''],
            ['typ field',      '10  (Thread)', ''],
            ['Header',         '1 word', ''],
            ['Data Regs',      esc(DR_WORDS + ' words  (DR0–DR15, static)'), ''],
            ['Heap (cw)',      heapDisplay, overCapacity ? '' : ''],
            ['Stack (cc)',     esc(stackFrames + ' frames  (' + stackWords + ' words)'), ''],
            ['Cap Regs',       esc(CAP_WORDS + ' words  (CR0–CR11 GT slots, static)'), ''],
            ['Header word',    '<span id="le-thread-hex" class="le-hex">' + esc(wordHex) + '</span>' + copyBtn('le-thread-hex'), 'le-val-mono']
        ]);

        var countHint = profile.singleThread ? ' (single-thread board)' : ' 1\u2013' + maxCount;

        var overCapWarning = overCapacity
            ? '<div class="le-error-banner">&#x26A0; <strong>Over capacity</strong> \u2014 stack + static zones exceed lump size; heap would be negative. Increase the lump size or reduce stack frames to unlock Save\u00a0/\u00a0Build LUMP.</div>'
            : '';

        var threadCountClampBanner = '';
        if (_threadCountClampedInfo) {
            var tcci = _threadCountClampedInfo;
            threadCountClampBanner = '<div class="le-warn-banner">' +
                '\u26A0 Your saved thread count (' + tcci.savedCount + ') ' +
                'exceeds the maximum for <strong>' + esc(tcci.boardLabel) + '</strong> and has been ' +
                'reduced to ' + tcci.clampedCount + '. ' +
                'Adjust the thread count below to confirm.' +
                '<button class="le-warn-dismiss" onclick="lumpEditorDismissThreadCountWarning()" title="Dismiss">\u00d7</button>' +
            '</div>';
        }

        var threadClampBanner = '';
        if (_threadLumpClampedInfo) {
            var tci = _threadLumpClampedInfo;
            var savedWords   = fmtWords(Math.pow(2, tci.savedExp));
            var clampedWords = fmtWords(Math.pow(2, tci.clampedExp));
            threadClampBanner = '<div class="le-warn-banner">' +
                '\u26A0 Your saved lump size (' + esc(savedWords) + ' words, 2^' + tci.savedExp + ') ' +
                'exceeds the maximum for <strong>' + esc(tci.boardLabel) + '</strong> and has been ' +
                'adjusted to ' + esc(clampedWords) + ' words (2^' + tci.clampedExp + '). ' +
                'Pick a new lump size below to confirm.' +
                '<button class="le-warn-dismiss" onclick="lumpEditorDismissThreadWarning()" title="Dismiss">\u00d7</button>' +
            '</div>';
        }

        var saveBtn = '<div class="le-save-row">' +
            '<button class="le-save-btn"' + (overCapacity ? ' disabled' : '') +
            ' onclick="lumpEditorSaveThread()"' +
            ' title="Build and download a .lump binary with the current Thread LUMP header, and save step 1 sizes to boot config">' +
            '\u2B07 Save\u00a0/\u00a0Build LUMP' +
            '</button>' +
            '<span id="le-t-step1-status" class="le-rl-status" style="margin-left:0.75rem;"></span>' +
            '<span id="le-t-step1-err" class="le-rl-status" style="margin-left:0.5rem;color:#f77;"></span>' +
            '</div>';

        return '<div class="le-panel">' +
            threadCountClampBanner +
            threadClampBanner +
            overCapWarning +
            '<p class="le-panel-desc">Choose lump size first (power of two, bounded by board thread budget). Set stack frames. Heap is derived automatically — no wasted freespace.</p>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Lump size<span class="le-range-hint"> 2^' + MIN_EXP + '\u2013' + maxLumpPow2 + ', max ' + fmtWords(Math.pow(2, maxLumpPow2)) + ' w</span></label>' +
                '<div class="le-input-group le-input-group-wide">' +
                    '<select class="le-select" id="le-t-lump-sel" onchange="lumpEditorThreadLumpSize(this.value)">' + lumpOpts + '</select>' +
                '</div>' +
            '</div>' +
            '<div class="le-thread-sync-note">' +
                '<span class="le-thread-sync-badge">Boot.Thread lump\u00a0= ' + esc(fmtWords(lumpSize)) + '\u00a0words\u00a0(2^' + lumpPow2 + ')\u00a0\u2014 reflected\u00a0in\u00a0Resident\u00a0Lumps\u00a0SIZE\u00a0column</span>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Thread count<span class="le-range-hint">' + esc(countHint) + '</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-count-sl"  min="1" max="' + maxCount + '" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-count-num" min="1" max="' + maxCount + '" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Stack frames<span class="le-range-hint"> 10\u2013255  (' + stackWords + ' words)</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-stack-sl"  min="10" max="255" value="' + stackFrames + '" oninput="lumpEditorThreadStack(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-stack-num" min="10" max="255" value="' + stackFrames + '" oninput="lumpEditorThreadStack(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row le-field-readonly">' +
                '<label class="le-label">Heap words<span class="le-range-hint"> (derived)</span></label>' +
                '<div class="le-input-group">' +
                    '<div class="le-readonly-val">' + heapDisplay + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="le-bar-label-row"><span>Single thread memory layout</span><span class="le-bar-label-count">' + esc(lumpSize.toLocaleString() + ' words') + '</span></div>' +
            (zones.length ? renderBar(zones) : '') +
            (zones.length ? renderMagBar(zones) : '') +
            '<div class="le-divider"></div>' +
            grid +
            saveBtn +
        '</div>';
    }

    // ── Namespace panel ───────────────────────────────────────────────────────

    function renderNSPanel() {
        var profile    = getBoardProfile();
        var boardRam   = profile.totalRamWords;
        var budget     = Math.floor(boardRam / 2);
        var validPresets = getValidNSPresets(boardRam);
        var noFit = (validPresets.length === 1 && Math.pow(2, validPresets[0].n + 14) > boardRam);
        var maxN   = validPresets[validPresets.length - 1].n;
        var n      = clamp(state.ns.n_minus_6, 0, maxN);

        var clampBanner = '';
        if (_nsSizeClampedInfo) {
            var ci = _nsSizeClampedInfo;
            var savedWords  = fmtWords(Math.pow(2, ci.savedN  + 14));
            var clampedWords = fmtWords(Math.pow(2, ci.clampedN + 14));
            clampBanner = '<div class="le-warn-banner">' +
                '\u26A0 Your saved namespace size (' + esc(savedWords) + ' words, n=' + ci.savedN + ') ' +
                'exceeds the maximum for <strong>' + esc(ci.boardLabel) + '</strong> and has been ' +
                'adjusted to ' + esc(clampedWords) + ' words (n=' + ci.clampedN + '). ' +
                'Pick a new size below to confirm.' +
                '<button class="le-warn-dismiss" onclick="lumpEditorDismissNSWarning()" title="Dismiss">\u00d7</button>' +
            '</div>';
        }
        var total  = Math.pow(2, n + 14);
        var maxSl  = total / 64;
        var slots  = clamp(state.ns.slots, 1, maxSl);
        var NS_TABLE_FIXED = 768;
        var threadLump   = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, MAX_EXP));
        var maxCount     = profile.singleThread ? 1 : Math.min(10, Math.max(1, Math.floor(budget / threadLump)));
        var threadCount  = clamp(state.thread.count, 1, maxCount);
        // Boot overhead = Boot.NS lump (64 w) + Boot.Thread lump (threadLump w).
        // Null slot 2 has been removed — no 64-word gap between Thread and Boot.Abstr.
        var namespaceLumpWords = 64;
        var bootOverhead = namespaceLumpWords + threadLump;
        var pool    = total - bootOverhead - NS_TABLE_FIXED;
        var cw      = (slots >>> 8) & 0x1FFF;
        var cc      =  slots & 0xFF;
        var word    = packHdr(n, cw, cc, 1);
        var wordHex = hex8(word);

        var presetOpts = validPresets.map(function (p) {
            return '<option value="' + p.n + '"' + (p.n === n ? ' selected' : '') + '>' + esc(p.label) + '</option>';
        }).join('');

        var boardInfo = noFit
            ? '<span class="le-overflow">⚠ ' + esc(profile.label + ' (' + boardRam.toLocaleString() + ' w) is smaller than the minimum NS LUMP (16,384 w)') + '</span>'
            : esc(profile.label + '  (' + boardRam.toLocaleString() + ' words total)');

        var allZones = [
            { label: 'Boot.NS + Boot.Thread', words: bootOverhead, cls: 'le-zone-hdr' },
            { label: 'Pool',          words: Math.max(pool, 0),     cls: 'le-zone-free' },
            { label: 'NS Table',      words: NS_TABLE_FIXED,        cls: 'le-zone-heap', onclick: "switchView('namespace')" }
        ];

        var grid = renderGrid([
            ['Target board',   boardInfo, 'le-val-gold'],
            ['Total words',    esc(total.toLocaleString() + '  (2^' + (n + 14) + ')'), noFit ? '' : 'le-val-gold'],
            ['n_minus_6',     esc(String(n)), ''],
            ['typ field',     '01  (Namespace, reserved)', ''],
            ['Max slots',      esc(maxSl.toLocaleString() + '  (total ÷ 64)'), ''],
            ['NS table',       '768 words (fixed reservation)', ''],
            ['Boot overhead',  esc(bootOverhead.toLocaleString() + ' words (Boot.NS 64 + Boot.Thread ' + threadLump.toLocaleString() + ')'), ''],
            ['Pool available', pool >= 0 ? esc(pool.toLocaleString() + ' words') : '<span class="le-overflow">overflow</span>', ''],
            ['cw field',       esc(String(cw) + '  (slots >> 8)'), ''],
            ['cc field',       esc(String(cc) + '  (slots & 0xFF)'), ''],
            ['Header word',    '<span id="le-ns-hex" class="le-hex">' + esc(wordHex) + '</span>' + copyBtn('le-ns-hex'), 'le-val-mono']
        ]);

        var decDisabled = threadCount <= 1       ? ' disabled' : '';
        var incDisabled = threadCount >= maxCount ? ' disabled' : '';
        var threadStepper =
            '<div class="le-field-row">' +
                '<label class="le-label">Thread count<span class="le-range-hint"> 1\u2013' + maxCount + '\u00a0\u00a0' + esc(fmtWords(threadLump) + ' w each') + '</span></label>' +
                '<div class="le-input-group le-stepper-group">' +
                    '<button class="le-stepper-btn"' + decDisabled + ' onclick="lumpEditorThreadCount(' + (threadCount - 1) + ')">\u2212</button>' +
                    '<span class="le-stepper-val">' + threadCount + '</span>' +
                    '<button class="le-stepper-btn"' + incDisabled + ' onclick="lumpEditorThreadCount(' + (threadCount + 1) + ')">+</button>' +
                '</div>' +
            '</div>';

        return '<div class="le-panel">' +
            clampBanner +
            '<p class="le-panel-desc">Choose total namespace memory and slot capacity. Slot count is encoded across cw and cc as <code>(cw&lt;&lt;8)|cc</code>.</p>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Total namespace memory</label>' +
                '<div class="le-input-group le-input-group-wide">' +
                    '<select class="le-select" id="le-ns-size-sel" onchange="lumpEditorNSSize(this.value)">' + presetOpts + '</select>' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">NS slot capacity<span class="le-range-hint"> 1 – ' + maxSl.toLocaleString() + '</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-ns-slots-sl"  min="1" max="' + maxSl + '" value="' + slots + '" oninput="lumpEditorNSSlots(this.value)">' +
                    '<input type="number" class="le-number" id="le-ns-slots-num" min="1" max="' + maxSl + '" value="' + slots + '" oninput="lumpEditorNSSlots(this.value)">' +
                '</div>' +
            '</div>' +
            threadStepper +
            '<div class="le-bar-label-row"><span>Memory layout</span><span class="le-bar-label-count">' + esc(total.toLocaleString() + ' words') + '</span></div>' +
            renderBar(allZones) +
            renderMagBar(allZones) +
            '<div class="le-divider"></div>' +
            grid +
            '<div class="le-save-row">' +
                '<button class="le-save-btn" onclick="lumpEditorPostStep1()"' +
                ' title="Save current NS + Thread lump sizes as step 1 in the boot config">' +
                '\u2714\ufe0e Save to boot config' +
                '</button>' +
                '<span id="le-ns-step1-status" class="le-rl-status" style="margin-left:0.75rem;"></span>' +
                '<span id="le-ns-step1-err" class="le-rl-status" style="margin-left:0.5rem;color:#f77;"></span>' +
            '</div>' +
        '</div>';
    }

    // ── top-level render ──────────────────────────────────────────────────────

    function render() {
        var tEl = document.getElementById('lumpThreadPanel');
        var nEl = document.getElementById('lumpNSPanel');
        if (tEl) tEl.innerHTML = renderThreadPanel();
        if (nEl) nEl.innerHTML = renderNSPanel();
    }

    // ── public handlers ───────────────────────────────────────────────────────

    window.lumpEditorThreadLumpSize = function (exp) {
        var profile  = getBoardProfile();
        var budget   = Math.floor(profile.totalRamWords / 2);
        var count    = clamp(state.thread.count, 1, profile.singleThread ? 1 : 10);
        var maxWords = Math.min(Math.floor(budget / count), 8192);
        var maxExp   = Math.max(MIN_EXP, Math.min(MAX_EXP, Math.floor(Math.log2(maxWords))));
        state.thread.lumpPow2 = clamp(exp, MIN_EXP, maxExp);
        _threadLumpClampedInfo = null;

        // Patch count slider max in-place so it reacts before the full re-render
        var lumpSize = Math.pow(2, state.thread.lumpPow2);
        var maxCount = profile.singleThread ? 1 : Math.min(10, Math.max(1, Math.floor(budget / lumpSize)));
        state.thread.count = clamp(state.thread.count, 1, maxCount);
        var sl  = document.getElementById('le-t-count-sl');
        var num = document.getElementById('le-t-count-num');
        if (sl)  { sl.max  = maxCount; sl.value  = state.thread.count; }
        if (num) { num.max = maxCount; num.value = state.thread.count; }

        saveState();
        render();
    };

    window.lumpEditorThreadCount = function (v) {
        state.thread.count = clamp(v, 1, 10);
        _threadCountClampedInfo = null;
        saveState();
        var sl  = document.getElementById('le-t-count-sl');
        var num = document.getElementById('le-t-count-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.thread.count;
        if (num && num !== document.activeElement) num.value = state.thread.count;
        render();
    };

    window.lumpEditorThreadStack = function (v) {
        state.thread.stackFrames = clamp(v, 10, 255);
        saveState();
        var sl  = document.getElementById('le-t-stack-sl');
        var num = document.getElementById('le-t-stack-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.thread.stackFrames;
        if (num && num !== document.activeElement) num.value = state.thread.stackFrames;
        render();
    };

    window.lumpEditorNSSize = function (v) {
        state.ns.n_minus_6 = clamp(v, 0, 15);
        var maxSl = Math.pow(2, state.ns.n_minus_6 + 14) / 64;
        if (state.ns.slots > maxSl) state.ns.slots = maxSl;
        _nsSizeClampedInfo = null;
        saveState();
        render();
    };

    window.lumpEditorDismissNSWarning = function () {
        _nsSizeClampedInfo = null;
        saveState();
        render();
    };

    window.lumpEditorDismissThreadWarning = function () {
        _threadLumpClampedInfo = null;
        render();
    };

    window.lumpEditorDismissThreadCountWarning = function () {
        _threadCountClampedInfo = null;
        render();
    };

    window.lumpEditorNSSlots = function (v) {
        var maxSl = Math.pow(2, state.ns.n_minus_6 + 14) / 64;
        state.ns.slots = clamp(v, 1, maxSl);
        saveState();
        var sl  = document.getElementById('le-ns-slots-sl');
        var num = document.getElementById('le-ns-slots-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.ns.slots;
        if (num && num !== document.activeElement) num.value = state.ns.slots;
        render();
    };

    window.lumpEditorCopy = function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var txt = el.textContent.trim();
        if (navigator.clipboard) {
            navigator.clipboard.writeText(txt).then(function () {
                el.classList.add('le-copy-flash');
                setTimeout(function () { el.classList.remove('le-copy-flash'); }, 1000);
            });
        }
    };

    window.lumpEditorRender = function () { clampThreadStateToBoard(); clampNSStateToBoard(); render(); };
    window.lumpEditorRenderResidentPanel = function () {
        var panel = document.getElementById('lumpResidentPanel');
        if (panel && panel.offsetParent !== null) renderResidentPanel();
    };

    window.lumpEditorBootEntryChange = function (nsSlot) {
        if (typeof setBootEntrySlot === 'function') {
            setBootEntrySlot(nsSlot);
        } else {
            localStorage.setItem('bootEntrySlot', String(nsSlot));
            renderResidentPanel();
        }
    };

    window.lumpEditorBootBadgeClick = function (nsSlot) {
        lumpEditorBootEntryChange(nsSlot);
        var targetRow = document.querySelector('.le-rl-boot-entry-row');
        if (targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            targetRow.classList.remove('le-rl-boot-row-flash');
            void targetRow.offsetWidth;
            targetRow.classList.add('le-rl-boot-row-flash');
        }
    };

    window.lumpEditorBootShowAllToggle = function (checked) {
        localStorage.setItem('bootDropdownShowAll', checked ? '1' : '0');
        renderResidentPanel();
    };

    window.initLumpEditor = function () {
        loadState();
        render();
    };

    // ── Thread + NS step1 save helpers ────────────────────────────────────────

    window.lumpEditorSaveThread = function () {
        if (typeof buildAndDownloadLump === 'function') buildAndDownloadLump();
        var statusEl = document.getElementById('le-t-step1-status');
        var errEl    = document.getElementById('le-t-step1-err');
        _postStep1(statusEl, errEl);
    };

    window.lumpEditorPostStep1 = function () {
        var statusEl = document.getElementById('le-ns-step1-status');
        var errEl    = document.getElementById('le-ns-step1-err');
        _postStep1(statusEl, errEl);
    };

    // ── Resident Lumps panel public handlers ──────────────────────────────────

    window.lumpEditorRLEmptySlots = function (v) {
        _rl.emptySlotCount = Math.max(0, parseInt(v, 10) || 0);
        var err = _rlValidate();
        _rl.errorMsg = err || '';
        var errBanner = document.querySelector('#lumpResidentPanel .le-error-banner');
        var saveBtn   = document.querySelector('#lumpResidentPanel .le-save-row .le-save-btn');
        if (errBanner) {
            errBanner.textContent = err ? '\u26A0 ' + err : '';
        } else {
            renderResidentPanel();
        }
        if (saveBtn) saveBtn.disabled = !!err;
    };

    window.lumpEditorRLSave = function () {
        var err = _rlValidate();
        if (err) return;

        var step2Lumps = [];
        for (var slotStr in _rl.step2State) {
            var st = _rl.step2State[slotStr];
            var row = { nsSlot: parseInt(slotStr, 10), resident: !!st.resident };
            if (st.resident) {
                row.physAddr = st.physAddr;
                if (st.lumpSize) row.lumpSize = st.lumpSize;
            }
            step2Lumps.push(row);
        }

        var p = _getStep1Payload();
        var payload = {
            targetBoard: p.targetBoard,
            step1:       p.step1,
            step2:       { lumps: step2Lumps },
            step3:       { emptySlotCount: _rl.emptySlotCount || 0 }
        };

        var statusEl = document.getElementById('le-rl-save-status');
        var errEl    = document.querySelector('#lumpResidentPanel .le-error-banner');
        if (statusEl) statusEl.textContent = 'Saving\u2026';
        if (errEl)    errEl.textContent    = '';

        fetch('/api/boot-config', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        })
        .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, body: j }; }); })
        .then(function(res) {
            if (!res.ok || res.body.ok === false) {
                if (statusEl) statusEl.textContent = '';
                _rl.errorMsg = (res.body && res.body.error) || 'Save failed.';
                renderResidentPanel();
                return;
            }
            window.bootConfig = res.body.config;
            _rl.statusMsg = 'Saved. Reset the simulator to apply the new boot config.';
            _rl.errorMsg  = '';
            renderResidentPanel();
        })
        .catch(function(saveErr) {
            _rl.errorMsg = 'Save failed: ' + saveErr;
            renderResidentPanel();
        });
    };

    window.lumpEditorRLGenerate = function () {
        if (typeof generateBootImage === 'function') generateBootImage();
    };

    window.lumpEditorRLUpload = function () {
        var inp = document.getElementById('le-rl-upload-input');
        if (inp) inp.click();
    };

    window.lumpEditorRLHandleUpload = function (input) {
        var file = input.files && input.files[0];
        if (!file) return;
        input.value = '';
        if (!file.name.toLowerCase().endsWith('.bin') && file.type !== 'application/octet-stream') {
            var genRes = document.getElementById('le-rl-gen-result');
            if (genRes) genRes.textContent = 'Only .bin boot image files are accepted.';
            return;
        }
        if (typeof uploadBootImageFile === 'function') {
            uploadBootImageFile(file);
        }
    };

    window.initResidentPanel = function () {
        loadState();
        _rl.loaded    = false;
        _rl.loading   = false;
        _rl.statusMsg = '';
        _rl.errorMsg  = '';
        _rlLoad();
    };

    window.addEventListener('storage', function (ev) {
        if (ev.key === 'fpga_board_target') {
            clampThreadStateToBoard();
            clampNSStateToBoard();
            render();
            var panel = document.getElementById('lumpResidentPanel');
            if (panel && panel.offsetParent !== null) {
                renderResidentPanel();
            }
        }
    });

}());
