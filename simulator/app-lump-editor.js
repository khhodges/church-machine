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

    // V20 architecture profile:
    //   * power-of-two namespace slot capacity: 64 (default/min) … 1024 (max)
    //   * 16 bytes (4 words) per entry
    //   * slot 0 is the highest-address entry; slots descend toward the base
    //   * the NS Table occupies the top of the selected total-memory window
    // Keep the total-memory selector available for board experiments, but
    // constrain the architectural slot capacity so the page cannot save a
    // configuration that contradicts the V20 namespace contract.
    var NS_CAP_OPTIONS        = [64, 128, 256, 512, 1024];
    var NS_CAP_MIN            = 64;
    var NS_CAP_MAX            = 1024;
    var V20_NS_ENTRY_BYTES    = 16;

    // Snap any saved/legacy slot count to the nearest valid power-of-two
    // capacity (rounding up), clamped to [64, 1024].
    function snapNSCap(v) {
        v = parseInt(v, 10);
        if (!Number.isFinite(v) || v <= NS_CAP_MIN) return NS_CAP_MIN;
        return Math.min(nextPow2(v), NS_CAP_MAX);
    }
    var V20_NS_TOTAL_N        = 1;   // 2^(1+14) = 32K words = 128 KiB
    var V20_THREAD_LUMP_POW2  = 8;   // 256 words: the complete defined Thread layout
    var THREAD = window.ThreadDesign;
    if (!THREAD || !THREAD.normative) {
        throw new Error('Normative Thread design is unavailable');
    }
    var V20_WCH_BASE_BYTE     = 0x1600;
    var V20_WCH_END_BYTE      = 0x17FF;

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
    //   (legacy ti60-f225)   65,536 w  → n=0–2 (16 K–64 K) shown
    //   Wukong XC7A100T      16,384 w  → only n=0 (16 K) shown
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
        var maxCount = Math.min(boardThreadCountLimit(profile), Math.max(1, Math.floor(budget / savedLumpSize)));
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
            var serverMaxCl = (_rl && _rl.limits && _rl.limits.maxNsEntries) || 1024;
            var newMaxSl = Math.min(Math.pow(2, maxN + 14) / 64, serverMaxCl, NS_CAP_MAX);
            if (state.ns.slots > newMaxSl) state.ns.slots = snapNSCap(Math.min(state.ns.slots, newMaxSl));
            _nsSizeClampedInfo = { savedN: savedN, clampedN: maxN, boardLabel: profile.label };
            saveState();
        } else {
            // Current size fits the new board — clear any stale clamp warning.
            _nsSizeClampedInfo = null;
            saveState();
        }
    }

    // state.thread.lumpPow2: exponent for lump size (e.g. 8 = 256 words)
    // Thread geometry fields are encoded directly in the Thread header:
    // cw/sw = stack words and cc = the 12 capability-home count.
    var state = {
        thread: { lumpPow2: V20_THREAD_LUMP_POW2, stackFrames: 16, count: 1 },
        ns: { n_minus_6: V20_NS_TOTAL_N, slots: NS_CAP_MIN },
        // Design-intent tuple definitions for the Heap zone (browser-saved
        // with this Thread design only; never sent to boot-config/binary).
        tuples: []
    };

    var _hadSavedState = false;   // true when a previously saved design exists in localStorage
    var _threadDesigns = Object.create(null);
    var _threadDesignKey = 'legacy';

    function rememberThreadDesign() {
        _threadDesigns[_threadDesignKey] = JSON.parse(JSON.stringify({
            thread: state.thread, tuples: state.tuples,
            tuplesUnreadable: state.tuplesUnreadable
        }));
    }

    function restoreThreadDesign(key) {
        var d = _threadDesigns[key];
        state.thread = JSON.parse(JSON.stringify(d.thread));
        state.tuples = [];
        delete state.tuplesUnreadable;
        if (d.tuplesUnreadable !== undefined) state.tuplesUnreadable = d.tuplesUnreadable;
        try { state.tuples = window.ThreadTupleDesign.normalize(d.tuples || []); }
        catch (e) { state.tuplesUnreadable = d.tuples; }
        _threadDesignKey = key;
        _tupleMsg = null;
        _threadLumpClampedInfo = null;
        _threadCountClampedInfo = null;
    }

    function threadBindings() {
        var rows = _nsDrill.entries || [];
        var ns = rows.find(function (r) { return Number(r.slot) === 0; });
        return rows.filter(function (r) {
            return r.name && (r.header_typ === 2 || r.type === 'Thread' || r.typ === 2 ||
                r.name === 'Boot.Thread' || /^Thread\.\d+$/.test(r.name));
        }).map(function (r) {
            return { row: r, key: window.ThreadTupleDesign.bindingKey(ns ? ns.name : 'Namespace', r, ns && ns.seq) };
        });
    }

    function renderThreadSelector() {
        var bindings = threadBindings();
        var options = '<option value="legacy">Legacy shared boot layout (unassigned draft)</option>';
        bindings.forEach(function (b) {
            options += '<option value="' + esc(b.key) + '"' +
                (b.key === _threadDesignKey ? ' selected' : '') + '>' +
                esc(b.row.name) + ' — NS[' + Number(b.row.slot) + ']</option>';
        });
        if (_threadDesignKey !== 'legacy' && !bindings.some(function (b) { return b.key === _threadDesignKey; })) {
            options += '<option selected value="' + esc(_threadDesignKey) + '">Saved Thread (binding unavailable)</option>';
        }
        return '<div class="le-panel"><label for="le-thread-design">Thread design</label> ' +
            '<select id="le-thread-design" onchange="lumpEditorSelectThread(this.value)">' + options + '</select>' +
            '<p>Each named Thread has an independent browser-saved layout and tuple reservations. Selection never builds, installs, or activates a Thread.</p>' +
            (_nsDrill.errorMsg ? '<p>' + esc(_nsDrill.errorMsg) + '</p>' : '') + '</div>';
    }

    window.lumpEditorSelectThread = function (key) {
        var binding = threadBindings().find(function (b) { return b.key === key; });
        if (key !== 'legacy' && !binding) return;
        if (!saveState()) {
            _tupleMsg = { err: true, text: 'Cannot switch: browser storage failed. Export your tuples and retry. The current design is unchanged.' };
            render();
            return;
        }
        if (!_threadDesigns[key]) _threadDesigns[key] = window.ThreadTupleDesign.newDesign(binding && binding.row);
        restoreThreadDesign(key);
        var ta = document.getElementById('le-tu-json');
        if (ta) ta.value = '';
        saveState();
        render();
    };

    function loadState() {
        try {
            var raw = localStorage.getItem('lump_editor_state');
            _hadSavedState = !!raw;
            var s = JSON.parse(raw || '{}');
            _threadDesignKey = 'legacy';
            _threadDesigns = Object.create(null);
            if (s.thread) {
                if (s.thread.lumpPow2 !== undefined) {
                    state.thread.lumpPow2 = clamp(s.thread.lumpPow2, 6, 13);
                }
                if (s.thread.stackFrames !== undefined) {
                    state.thread.stackFrames = clamp(s.thread.stackFrames, 10, 255);
                }
                // Retired heapWords is intentionally ignored. Thread Heap size
                // is derived from total size and cw/sw.
                state.thread.count = (s.thread.count !== undefined) ? clamp(s.thread.count, 1, 9) : 1;
            }
            if (s.ns) {
                state.ns.n_minus_6 = (s.ns.n_minus_6 !== undefined) ? s.ns.n_minus_6 : V20_NS_TOTAL_N;
                // Migrate legacy non-power-of-two slot counts (old 1–64 slider)
                // to the nearest valid power-of-two capacity (min 64).
                state.ns.slots = snapNSCap(s.ns.slots || NS_CAP_MIN);
            }
            if (s.tuplesUnreadable !== undefined) state.tuplesUnreadable = s.tuplesUnreadable;
            if (Array.isArray(s.tuples) && window.ThreadTupleDesign) {
                try { state.tuples = window.ThreadTupleDesign.normalize(s.tuples); }
                catch (te) { state.tuples = []; state.tuplesUnreadable = s.tuples; _tupleMsg = { err: true, text: 'Saved tuple definitions were unreadable and were not loaded.' }; }
            }
            // Migrate the old page defaults, but preserve deliberate user
            // choices.  This keeps an existing browser profile from silently
            // reopening with the pre-V20 256-word/256-slot contract.
            if (state.thread.lumpPow2 === 8 && state.ns.n_minus_6 === 3) {
                state.thread.lumpPow2 = V20_THREAD_LUMP_POW2;
                state.ns.n_minus_6 = V20_NS_TOTAL_N;
                state.ns.slots = NS_CAP_MIN;
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
            rememberThreadDesign();
            if (s.threadDesigns && typeof s.threadDesigns === 'object') {
                Object.keys(s.threadDesigns).forEach(function (key) {
                    var d = s.threadDesigns[key];
                    if (d && d.thread) _threadDesigns[key] = d;
                });
                if (_threadDesigns[s.selectedThreadDesign]) restoreThreadDesign(s.selectedThreadDesign);
            }
        } catch (e) {}
    }

    function saveState() {
        try {
            rememberThreadDesign();
            var payload = JSON.parse(JSON.stringify(state));
            // Preserve the old top-level contract as the unassigned boot draft.
            Object.assign(payload, _threadDesigns.legacy);
            payload.threadDesigns = _threadDesigns;
            payload.selectedThreadDesign = _threadDesignKey;
            payload.nsSizeClampedInfo = _nsSizeClampedInfo || null;
            localStorage.setItem('lump_editor_state', JSON.stringify(payload));
            return true;
        } catch (e) { return false; }
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
                    '<span class="le-bar-label">' + esc(z.label) + (z.formula ? '<span class="le-bar-formula">' + esc(z.formula) + '</span>' : '') + '</span>' +
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
                    '<span class="le-bar-label">' + esc(z.label) + (z.formula ? '<span class="le-bar-formula">' + esc(z.formula) + '</span>' : '') + '</span>' +
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
        var buildThread = _threadDesignKey === 'legacy' ? state.thread : _threadDesigns.legacy.thread;
        var board    = (typeof localStorage !== 'undefined' && localStorage.getItem('fpga_board_target')) || 'wukong-xc7a100t';
        var profile  = BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
        var boardRam = profile.totalRamWords;
        var validPresets = getValidNSPresets(boardRam);
        var maxN               = validPresets[validPresets.length - 1].n;
        var n                  = clamp(state.ns.n_minus_6, 0, maxN);
        var totalNamespaceWords = Math.pow(2, n + 14);
        var threadLumpWords     = Math.pow(2, clamp(buildThread.lumpPow2, MIN_EXP, MAX_EXP));
        var serverMax           = (_rl && _rl.limits && _rl.limits.maxNsEntries) || 1024;
        var maxSl               = Math.min(totalNamespaceWords / 64, serverMax, NS_CAP_MAX);
        var nsSlotsMax          = Math.min(snapNSCap(state.ns.slots), maxSl);
        var threadCount         = clamp(buildThread.count, 1, boardThreadCountLimit(profile));
        return {
            targetBoard: board,
            step1: {
                totalNamespaceWords: totalNamespaceWords,
                namespaceLumpWords:  64,
                threadLumpWords:     threadLumpWords,
                threadStackWords:    clamp(buildThread.stackFrames, 10, 255) * 2,
                nsSlotsMax:          nsSlotsMax,
                threadCount:         threadCount
            }
        };
    }

    function _postStep1(statusEl, errEl) {
        if (_threadDesignKey !== 'legacy') {
            if (errEl) errEl.textContent = 'Select the legacy shared boot layout before reviewing global geometry. No build changed.';
            return Promise.resolve(false);
        }
        var s1payload = _getStep1Payload();
        if (statusEl) statusEl.textContent = 'Saving step 1\u2026';
        if (errEl)    errEl.textContent    = '';
        return fetch('/api/boot-config', { cache: 'no-store' })
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
                headers: Object.assign({'Content-Type': 'application/json'},
                    (window.BuildApprovalView && window.BuildApprovalView._authHeaders
                        ? window.BuildApprovalView._authHeaders() : {})),
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
            const memoryChanged = typeof window._setActiveBootConfig === 'function'
                ? window._setActiveBootConfig(
                    res.body.config, res.body.bootImageInvalidated === true,
                    res.body.invalidatedBootImageWords)
                : false;
            if (memoryChanged && sim && typeof sim.reset === 'function') {
                sim.reset();
            }
            // Saving the designer changes the persisted boot geometry, which
            // also determines the generated Thread.2…Thread.N namespace
            // entries.  Do not leave the live simulator on the previous
            // boot-image snapshot: regenerate and load it now so the
            // Namespace Table reflects the saved design immediately.
            if (statusEl) statusEl.textContent = 'Step 1 saved. Updating Namespace Table…';
            if (typeof generateBootImage === 'function') {
                generateBootImage(function(applied) {
                    if (statusEl) {
                        statusEl.textContent = applied
                            ? 'Step 1 saved. Namespace Table updated.'
                            : 'Step 1 saved. Reset the simulator to apply.';
                    }
                    if (applied && typeof updateNamespace === 'function') updateNamespace();
                });
            } else if (statusEl) {
                statusEl.textContent = 'Step 1 saved. Reset the simulator to apply.';
            }
            return true;
        })
        .catch(function(err) {
            if (statusEl) statusEl.textContent = '';
            if (errEl)    errEl.textContent    = 'Save failed: ' + err;
            return false;
        });
    }

    // ── Resident Lumps panel state ────────────────────────────────────────────

    // Must match server/app.py BASE_NAMED_NS_COUNT / RESERVED_NS_SLOTS.
    // Slots 0..10 are foundational boot objects and MMIO.  They may appear in
    // the catalog (and may be selected as the Lightning Bolt entry), but Step 2
    // must never serialize them as programmer-configurable resident LUMPs.
    var FIXED_BOOT_STEP2_SLOT_COUNT = 11;

    function _isFixedBootStep2Slot(slot) {
        slot = Number(slot);
        return Number.isInteger(slot) && slot >= 0 && slot < FIXED_BOOT_STEP2_SLOT_COUNT;
    }

    var _rl = {
        catalog:        [],
        step2State:     {},
        emptySlotCount: 0,
        bootEntrySlot:  null,
        namespaceFingerprint: '',
        namespaceRows:  [],
        showAllBootTargets: false,
        limits:         { maxNsEntries: 256, baseNamedNsCount: 47 },
        loaded:         false,
        loading:        false,
        saveInFlight:   false,
        errorMsg:       '',
        statusMsg:      ''
    };



    function _rlValidate() {
        var p    = _getStep1Payload();
        var s1   = p.step1;
        var board        = p.targetBoard || 'wukong-xc7a100t';
        var boardProfile = BOARD_PROFILES[board] || BOARD_PROFILES['wukong-xc7a100t'];
        var boardTotalWords = boardProfile.totalRamWords;
        var bootAbstrSz = (_rl.limits && _rl.limits.bootAbstrLumpWords) || 64;
        var nsReserveV = Math.max(16, Math.round(state.ns.slots) * 4);
        var threadCount = Math.max(1, Math.min(
            boardThreadCountLimit(boardProfile), parseInt(s1.threadCount, 10) || 1));
        var sum = (s1.threadLumpWords || 0) * threadCount + bootAbstrSz + (4 * 64);
        var total  = s1.totalNamespaceWords || 0;
        var usable = total - nsReserveV;
        var occ = [];
        for (var slotStr in _rl.step2State) {
            if (_isFixedBootStep2Slot(slotStr)) continue;
            var st = _rl.step2State[slotStr];
            if (st.loadPolicy !== 'Resident') continue;
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
        var baseNs  = 11 + Math.max(0, _getStep1Payload().step1.threadCount - 1);
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

    // ── Built Namespace (read-only, AS BUILT) ─────────────────────────────────
    // Membership and raw descriptor words come only from the committed boot
    // image bytes served by GET /api/boot-image/built-namespace. Names,
    // filenames and hashes come only from hash-matched retained provenance.
    // No catalog, boot-config, or browser design state is consulted here.
    var _bn = { seq: 0, ctrl: null, data: null, error: '', loading: false, tab: 'ns', heapPage: {},
        scroll: { top: 0, left: 0, appliedTop: 0, appliedLeft: 0 } };
    var BN_HEAP_PAGE = 64;

    function _bnHex(v) {
        return (typeof v === 'number' && Number.isFinite(v)) ? hex8(v) : '\u2014';
    }
    function _bnText(v) {
        return (v === null || v === undefined || v === '') ?
            '<span class="le-bn-absent">Unavailable</span>' : esc(String(v));
    }
    function _bnName(e) {
        if (e.name === null || e.name === undefined || e.name === '')
            return '<span class="le-bn-absent" title="No verified name: saved Namespace fingerprint does not match this image and no build record names it">Unavailable</span>';
        var src = e.nameSource === 'matched-namespace' ? 'saved Namespace (fingerprint match)' :
            (e.nameSource === 'build-record' ? 'build record' : 'source not stated');
        return '<span class="le-bn-name">' + esc(String(e.name)) + '</span><span class="le-bn-sub">' + esc(src) + '</span>';
    }
    function _bnArtifact(e) {
        if (e.artifactStatus === 'not-applicable')
            return '<span class="le-bn-na" title="Hardware device entry; no file artifact exists">N/A \u2014 hardware device, no file</span>';
        if (e.artifactStatus === 'recorded' || e.filename || e.artifactSha256)
            return (e.filename ? '<span class="le-bn-file">' + esc(String(e.filename)) + '</span>' : '<span class="le-bn-absent">Not recorded</span>');
        return '<span class="le-bn-absent">Not recorded</span>';
    }
    function _bnDec(dec, k, hexy) {
        if (!dec || dec[k] === null || dec[k] === undefined) return '<span class="le-bn-absent">\u2014</span>';
        var v = dec[k];
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        if (typeof v === 'number' && hexy) return '<code>' + esc(hex8(v)) + '</code>';
        if (typeof v === 'object') return esc(JSON.stringify(v));
        return esc(String(v));
    }
    function _bnFields(o) {
        if (o === null || o === undefined) return _bnText(null);
        if (typeof o !== 'object') return '<code>' + esc(String(o)) + '</code>';
        var keys = Object.keys(o);
        if (!keys.length) return '<span class="le-bn-absent">empty</span>';
        return '<dl class="le-bn-kv">' + keys.map(function (k) {
            var v = o[k];
            var t = (typeof v === 'number') ? esc(String(v)) + (v > 9 ? ' <span class="le-bn-sub">' + esc(hex8(v)) + '</span>' : '') :
                (v !== null && typeof v === 'object') ? '<code>' + esc(JSON.stringify(v)) + '</code>' : _bnText(v);
            return '<dt>' + esc(k) + '</dt><dd>' + t + '</dd>';
        }).join('') + '</dl>';
    }

    function _bnLoad() {
        _bn.seq += 1;
        var mySeq = _bn.seq;
        if (_bn.ctrl && typeof _bn.ctrl.abort === 'function') {
            try { _bn.ctrl.abort(); } catch (e) {}
        }
        _bn.ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
        // Clear the previous table: a failed refresh must never show stale evidence.
        _bn.data = null;
        _bn.error = '';
        _bn.loading = true;
        renderResidentPanel();
        var opts = { method: 'GET', cache: 'no-store' };
        if (_bn.ctrl) opts.signal = _bn.ctrl.signal;
        return fetch('/api/boot-image/built-namespace', opts)
            .then(function (r) {
                return r.json().catch(function () { return null; })
                    .then(function (j) { return { status: r.status, ok: r.ok, body: j }; });
            })
            .then(function (res) {
                if (mySeq !== _bn.seq) return;
                _bn.loading = false;
                if (!res.ok) {
                    var detail = (res.body && res.body.error) ? ': ' + res.body.error : '';
                    if (res.status === 404) _bn.error = 'No built boot image exists' + detail + '.';
                    else if (res.status === 422) _bn.error = 'Committed boot-image bytes are invalid or unrecognizable' + detail + '.';
                    else _bn.error = 'Built Namespace evidence unavailable (HTTP ' + res.status + ')' + detail + '.';
                } else if (!res.body || !Array.isArray(res.body.entries)) {
                    _bn.error = 'Built Namespace evidence response is malformed.';
                } else {
                    _bn.data = res.body;
                }
                _bnValidateTab();
                renderResidentPanel();
            })
            .catch(function (err) {
                if (mySeq !== _bn.seq) return;
                _bn.loading = false;
                _bn.data = null;
                _bn.error = 'Built Namespace evidence unavailable: ' + (err && err.message ? err.message : err);
                _bnValidateTab();
                renderResidentPanel();
            });
    }


    function _bnThreads() {
        return (_bn.data && Array.isArray(_bn.data.threads)) ? _bn.data.threads.filter(function (t) { return t && typeof t.slot === 'number'; }) : [];
    }
    function _bnValidateTab() {
        var ok = _bnThreads().some(function (t) { return t.slot === _bn.tab; });
        if (!ok) { _bn.tab = 'ns'; }
        var keep = {};
        _bnThreads().forEach(function (t) { if (_bn.heapPage[t.slot] !== undefined) keep[t.slot] = _bn.heapPage[t.slot]; });
        _bn.heapPage = keep;
    }
    function _bnTabLabel(t) {
        return (t.name !== null && t.name !== undefined && t.name !== '') ? String(t.name) : 'Thread NS[' + t.slot + ']';
    }
    function _bnTabId(k) { return 'le-bn-tab-' + k; }
    function _bnPanelId(k) { return 'le-bn-tp-' + k; }
    function _bnAddr(abs, rel) {
        return '<code>' + _bnHex(abs) + '</code><span class="le-bn-sub">+' + (typeof rel === 'number' ? rel + ' (' + hex8(rel) + ')' : '\u2014') + '</span>';
    }
    var BN_STATUS = {
        'resolved': 'resolved', 'name-unavailable': 'Name unavailable', 'slot-missing': 'Slot missing from Namespace',
        'generation-mismatch': 'Generation mismatch', 'not-resolved': 'Not resolved'
    };
    function _bnTarget(c) {
        if (c.targetStatus === 'null') return '<span class="le-bn-absent">No target (null GT)</span>';
        if (c.targetStatus === null || c.targetStatus === undefined) return '<span class="le-bn-absent">Target evidence unavailable</span>';
        var slot = typeof c.targetSlot === 'number' ? 'NS[' + c.targetSlot + ']' : '';
        if (c.targetStatus === 'resolved' && c.targetName)
            return '<span class="le-bn-name">' + esc(String(c.targetName)) + '</span><span class="le-bn-sub">' + esc(slot) + '</span>';
        var cls = c.targetStatus === 'resolved' || c.targetStatus === 'name-unavailable' ? 'warn' : 'bad';
        return (slot ? '<code>' + esc(slot) + '</code> ' : '') + '<span class="le-bn-badge le-bn-' + cls + '">' +
            esc(BN_STATUS[c.targetStatus] || String(c.targetStatus)) + '</span>';
    }
    function _bnThreadPanel(t) {
        if (t.error) {
            return '<div class="le-error-banner" role="alert">Thread NS[' + esc(String(t.slot)) + '] could not be decoded from the image bytes: ' +
                esc(String(t.error)) + '. No layout, heap or capabilities are shown.</div>';
        }
        var out = renderGrid([
            ['Slot', 'NS[' + esc(String(t.slot)) + ']'],
            ['Name', t.name ? esc(String(t.name)) : '<span class="le-bn-absent">Unavailable (not verified)</span>'],
            ['Location', '<code>' + _bnHex(t.location) + '</code>'],
            ['Header word', '<code>' + _bnHex(t.headerWord) + '</code>'],
            ['Size', _bnText(t.sizeWords) + ' words'],
            ['Stack', _bnText(t.stackWords) + ' words']
        ]);
        var zones = Array.isArray(t.zones) ? t.zones : [];
        out += '<h4 class="le-bn-h4">Zones</h4>' + (zones.length ?
            '<div class="le-bn-scroll"><table class="le-bn-table"><thead><tr><th>Zone</th><th>Start (abs / rel)</th><th>End (abs / rel)</th><th>Words</th></tr></thead><tbody>' +
            zones.map(function (z) {
                return '<tr><td>' + esc(String(z.name)) + '</td><td>' + _bnAddr(z.absoluteStart, z.startOffset) + '</td><td>' +
                    _bnAddr(z.absoluteEnd, z.endOffset) + '</td><td>' + _bnText(z.words) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="le-panel-desc">No zones reported.</p>');
        var h = t.heap;
        out += '<h4 class="le-bn-h4">Tuple heap</h4>';
        if (!h) out += '<p class="le-panel-desc"><span class="le-bn-absent">Heap not reported.</span></p>';
        else {
            var words = Array.isArray(h.initialWords) ? h.initialWords : [];
            var pages = Math.max(1, Math.ceil(words.length / BN_HEAP_PAGE));
            var pg = Math.min(_bn.heapPage[t.slot] || 0, pages - 1);
            var base = (typeof t.location === 'number' ? t.location : 0) + (h.startOffset || 0);
            out += renderGrid([
                ['Capacity', _bnText(h.words) + ' words'],
                ['Offsets', _bnText(h.startOffset) + ' \u2013 ' + _bnText(h.endOffset)],
                ['Nonzero initial words', _bnText(h.nonzeroWords)],
                ['Named tuple definitions', '<span class="le-bn-absent">Not recorded in this build</span>']
            ]) + '<p class="le-panel-desc">Exact initial words from the image. A zero word is only a zero value; it does not prove the word is unallocated.</p>' +
                '<details class="le-bn-details le-bn-heap"><summary>Initial heap words (' + words.length + ')</summary>';
            if (words.length) {
                var slice = words.slice(pg * BN_HEAP_PAGE, (pg + 1) * BN_HEAP_PAGE);
                out += '<div class="le-bn-hexgrid">' + slice.map(function (w, i) {
                    var off = (h.startOffset || 0) + pg * BN_HEAP_PAGE + i;
                    return '<span class="le-bn-hw' + (w ? '' : ' le-bn-zero') + '" title="abs ' + hex8(base + pg * BN_HEAP_PAGE + i) + ', rel +' + off + '"><span class="le-bn-sub">+' + off + '</span><code>' + _bnHex(w) + '</code></span>';
                }).join('') + '</div>';
                if (pages > 1) out += '<div class="le-bn-pager"><button type="button" class="le-copy-btn" ' + (pg <= 0 ? 'disabled ' : '') +
                    'onclick="lumpEditorBnHeapPage(' + t.slot + ',-1)">Previous</button><span>Page ' + (pg + 1) + ' / ' + pages +
                    '</span><button type="button" class="le-copy-btn" ' + (pg >= pages - 1 ? 'disabled ' : '') +
                    'onclick="lumpEditorBnHeapPage(' + t.slot + ',1)">Following</button></div>';
            } else out += '<p class="le-panel-desc">Heap has no words.</p>';
            out += '</details>';
        }
        var caps = Array.isArray(t.capabilities) ? t.capabilities : [];
        out += '<h4 class="le-bn-h4">Initial capability registers (as built, not live)</h4>' +
            '<div class="le-bn-scroll"><table class="le-bn-table"><thead><tr><th>Register</th><th>Offset</th><th>Address</th><th>GT (raw)</th><th>Type</th><th>Seq</th><th>Target</th></tr></thead><tbody>' +
            caps.map(function (c) {
                return '<tr><td class="le-bn-slot">' + esc(String(c.register)) + '</td><td>' + _bnText(c.offset) + '</td><td><code>' + _bnHex(c.address) +
                    '</code></td><td><code>' + _bnHex(c.value) + '</code></td><td>' + _bnText(c.type) + '</td><td>' + _bnText(c.sequence) +
                    '</td><td class="le-bn-namecell">' + _bnTarget(c) + '</td></tr>';
            }).join('') +
            (Array.isArray(t.runtimeRegisters) ? t.runtimeRegisters : [12, 13, 14, 15]).map(function (r) {
                return '<tr class="le-bn-rt"><td class="le-bn-slot">CR' + esc(String(r)) + '</td><td colspan="6"><span class="le-bn-absent">Runtime-only \u2014 not stored in the image</span></td></tr>';
            }).join('') + '</tbody></table></div>';
        return out;
    }

    function _bnProvBadge(s) {
        var cls = s === 'verified' ? 'ok' : (s === 'mismatch' ? 'bad' : 'warn');
        return '<span class="le-bn-badge le-bn-' + cls + '">' + esc(s || 'unknown') + '</span>';
    }

    function _bnCaptureScroll() {
        var root = document.getElementById('lumpResidentPanel');
        var pane = root && root.querySelector ? root.querySelector('.le-bn-tp') : null;
        if (!pane) return;
        // Preserve the shared requested position when a shorter tab clamps it.
        if (pane.scrollTop !== _bn.scroll.appliedTop) _bn.scroll.top = pane.scrollTop;
        if (pane.scrollLeft !== _bn.scroll.appliedLeft) _bn.scroll.left = pane.scrollLeft;
    }
    function _bnRestoreScroll() {
        var root = document.getElementById('lumpResidentPanel');
        var pane = root && root.querySelector ? root.querySelector('.le-bn-tp') : null;
        if (!pane) return;
        pane.scrollTop = _bn.scroll.top;
        pane.scrollLeft = _bn.scroll.left;
        _bn.scroll.appliedTop = pane.scrollTop;
        _bn.scroll.appliedLeft = pane.scrollLeft;
    }

    function renderResidentPanel() {
        var el = document.getElementById('lumpResidentPanel');
        if (!el) return;
        _bnCaptureScroll();
        var head = '<div class="le-panel le-bn">' +
            '<div class="le-bn-head"><h3 class="le-panel-title">Namespace \u2014 as built</h3>' +
            '<button type="button" class="le-copy-btn" data-bn-refresh="1" onclick="lumpEditorBuiltNamespaceRefresh()">Refresh</button></div>' +
            '<p class="le-panel-desc">Read-only. Decoded from the committed boot-image bytes in this workspace. ' +
            'This is the built image, not the live physical FPGA, and the currently saved Namespace may differ.</p>';
        if (_bn.loading) {
            el.innerHTML = head + '<p class="le-panel-desc">Reading committed boot image\u2026</p></div>';
            return;
        }
        if (_bn.error || !_bn.data) {
            el.innerHTML = head + '<div class="le-error-banner" role="alert">' +
                esc(_bn.error || 'Built Namespace evidence has not been loaded.') +
                ' No table is shown.</div></div>';
            return;
        }
        var d = _bn.data;
        var match = d.savedNamespaceMatchesBuilt === true ? 'yes' :
            (d.savedNamespaceMatchesBuilt === false ? 'no \u2014 saved Namespace differs from this build' : 'unknown');
        var ev = renderGrid([
            ['Image SHA-256', '<code class="le-bn-hash">' + _bnText(d.imageSha256) + '</code>'],
            ['Image bytes', _bnText(d.bytes)],
            ['Total words', _bnText(d.totalWords)],
            ['Max entries', _bnText(d.maxEntries)],
            ['NS table base', typeof d.nsTableBase === 'number' ? esc(hex8(d.nsTableBase)) + ' (' + d.nsTableBase + ')' : _bnText(d.nsTableBase)],
            ['Provenance', _bnProvBadge(d.provenanceStatus)],
            ['Built Namespace fingerprint', '<code class="le-bn-hash">' + _bnText(d.builtNamespaceFingerprint) + '</code>'],
            ['Saved Namespace matches built', esc(match)]
        ]);
        var struct = '<div class="le-bn-struct"><section><h4>NS header</h4>' + _bnFields(d.nsHeader) + '</section></div>';
        var rows = d.entries.map(function (e) {
            e = e || {};
            var dec = e.decoded || null;
            return '<tr><td class="le-bn-slot">' + _bnText(e.slot) + '</td>' +
                '<td class="le-bn-namecell">' + _bnName(e) + '</td>' +
                '<td>' + _bnDec(dec, 'location', true) + '</td><td>' + _bnDec(dec, 'limit', true) + '</td>' +
                '<td>' + _bnDec(dec, 'sequence') + '</td><td>' + _bnDec(dec, 'f') + '</td><td>' + _bnDec(dec, 'g') + '</td>' +
                '<td>' + _bnDec(dec, 'seal', true) + '</td><td>' + _bnDec(dec, 'accessGt', true) + '</td>' +
                '<td>' + _bnArtifact(e) + '</td>' +
                '<td class="le-bn-evcell"><details class="le-bn-details"><summary>Raw words &amp; hash</summary>' +
                '<dl class="le-bn-kv"><dt>w0</dt><dd><code>' + _bnHex(e.w0) + '</code></dd><dt>w1</dt><dd><code>' + _bnHex(e.w1) + '</code></dd>' +
                '<dt>w2</dt><dd><code>' + _bnHex(e.w2) + '</code></dd><dt>w3</dt><dd><code>' + _bnHex(e.w3) + '</code></dd>' +
                '<dt>Artifact SHA-256</dt><dd><code class="le-bn-hash">' +
                (e.artifactStatus === 'not-applicable' ? 'N/A (hardware device, no file)' :
                    (e.artifactSha256 ? esc(String(e.artifactSha256)) : '<span class="le-bn-absent">Not recorded</span>')) +
                '</code></dd></dl></details></td></tr>';
        }).join('');
        var table = d.entries.length ?
            '<div class="le-bn-scroll"><table class="le-bn-table"><thead><tr><th>Slot</th><th>Name</th><th>Location</th><th>Limit</th>' +
            '<th>Seq</th><th>F</th><th>G</th><th>Seal</th><th>Access</th><th>Artifact</th><th>Evidence</th></tr></thead><tbody>' +
            rows + '</tbody></table></div>' :
            '<p class="le-panel-desc">The committed image contains no occupied Namespace slots.</p>';
        var threads = _bnThreads();
        var keys = ['ns'].concat(threads.map(function (t) { return t.slot; }));
        var tabs = '<div class="le-bn-tabs" role="tablist" aria-label="Built Namespace views">' + keys.map(function (k, i) {
            var sel = _bn.tab === k;
            var lbl = k === 'ns' ? 'Namespace' : _bnTabLabel(threads[i - 1]);
            var bad = k !== 'ns' && threads[i - 1].error;
            return '<button type="button" role="tab" class="le-bn-tab' + (bad ? ' le-bn-tab-err' : '') + '" id="' + _bnTabId(k) + '" aria-controls="' + _bnPanelId(k) +
                '" aria-selected="' + sel + '" tabindex="' + (sel ? '0' : '-1') + '" data-bn-tab="' + k + '" onclick="lumpEditorBnTab(\'' + k +
                '\')" onkeydown="lumpEditorBnTabKey(event)">' + esc(lbl) + '</button>';
        }).join('') + '</div>';
        if (_bn.tab !== 'ns') {
            var cur = threads.filter(function (t) { return t.slot === _bn.tab; })[0];
            el.innerHTML = head + tabs + '<div role="tabpanel" class="le-bn-tp" id="' + _bnPanelId(_bn.tab) + '" aria-labelledby="' + _bnTabId(_bn.tab) +
                '" tabindex="0">' + _bnThreadPanel(cur) + '</div></div>';
            _bnRestoreScroll();
            return;
        }
        el.innerHTML = head + tabs + '<div role="tabpanel" class="le-bn-tp" id="' + _bnPanelId('ns') + '" aria-labelledby="' + _bnTabId('ns') + '" tabindex="0">' + ev + struct +
            '<p class="le-panel-desc">' + d.entries.length + ' committed slot(s). Membership and descriptor words come only from the image. ' +
            'Names appear only when verified (saved Namespace fingerprint equals the image-bound fingerprint, or a build record); otherwise Unavailable. ' +
            'Artifact N/A means a hardware device with no file; Not recorded means no file evidence was retained.</p>' +
            table + '</div></div>';
        _bnRestoreScroll();
    }

    function _bnObsolete(name) {
        return function () {
            if (typeof console !== 'undefined') console.warn('[lump-editor] ' + name + ' ignored: built Namespace view is read-only.');
            return false;
        };
    }

    // ── Thread panel ──────────────────────────────────────────────────────────

    var DR_WORDS  = THREAD.dataRegisters.words;
    var CAP_WORDS = THREAD.capabilityHomes.words;
    var MIN_EXP   = Math.log2(Math.min.apply(null, THREAD.supportedBodyWords));
    var MAX_EXP   = Math.log2(Math.max.apply(null, THREAD.supportedBodyWords));

    var BOARD_PROFILES = {
        'tang-nano-20k-iot': { label: 'Tang Nano 20K',      totalRamWords: 16384,  singleThread: true  },
        // Match the synthesized 16K-word Namespace BRAM (not FPGA capacity).
        'wukong-xc7a100t':   { label: 'Wukong XC7A100T',    totalRamWords: 16384, singleThread: false, maxThreadCount: 3 }
    };

    function boardThreadCountLimit(profile) {
        return profile.singleThread ? 1 : (profile.maxThreadCount || 9);
    }

    function getBoardProfile() {
        var board = (typeof localStorage !== 'undefined' && localStorage.getItem('fpga_board_target')) || 'wukong-xc7a100t';
        if (board === 'ti60-f225') board = 'wukong-xc7a100t';   // legacy stored value
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
        var count        = clamp(state.thread.count, 1, boardThreadCountLimit(profile));

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

        var capsStart = lumpSize - CAP_WORDS;
        var capsEnd = lumpSize - 1;
        var stackEnd = capsStart - 1;
        var stackStart = stackEnd - stackWords + 1;
        var heapStart = 18;
        var heapEnd = stackStart - 1;
        var heap = Math.max(0, heapEnd - heapStart + 1);
        var overCapacity = heapEnd < heapStart;

        // Thread headers reinterpret cw as stack words; cc is always 12.
        var cw = overCapacity ? 0 : stackWords;
        var cc = CAP_WORDS;
        var word    = packHdr(n, cw, cc, 2);
        var wordHex = hex8(word);

        // Thread count max recalculated with actual lump size
        var maxCount    = Math.min(boardThreadCountLimit(profile), Math.max(1, Math.floor(budget / lumpSize)));
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

        var heapFormula = 'HeapWords = 2^((n−6)+6) − cw − 30';
        var heapDisplay = overCapacity
            ? '<span class="le-overflow">⚠ over capacity — increase lump size or reduce stack</span>'
            : esc(heap.toLocaleString() + ' words  (+18 … +' + heapEnd + '; derived)');
        heapDisplay += '<br><span class="le-range-hint">' + esc(heapFormula) + '</span>';

        var memStatus = overBudget
            ? '<span class="le-overflow">⚠ ' + esc(fmtWords(totalMem) + ' words — exceeds 50 % budget') + '</span>'
            : esc(fmtWords(totalMem) + ' words  (' + count + ' × ' + fmtWords(lumpSize) + ')');

        var zones = overCapacity ? [] : [
            { label: 'Header',    words: 1,           cls: 'le-zone-hdr'   },
            { label: 'Data Regs', words: DR_WORDS,    cls: 'le-zone-dr'    },
            { label: 'Protected STO', words: 1,         cls: 'le-zone-hdr'   },
             { label: 'Heap',      words: heap,          cls: 'le-zone-heap', formula: heapFormula },
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
            ['Protected STO',  '+17 (machine-protected)', ''],
            ['Heap',           heapDisplay, overCapacity ? '' : ''],
            ['Stack (cw/sw)',  esc(stackFrames + ' frames  (' + stackWords + ' words; +' + stackStart + ' … +' + stackEnd + ')'), ''],
            ['Cap Regs (cc)',  esc(CAP_WORDS + ' words  (CR0–CR11 persisted homes)'), ''],
            ['Capability offset', esc('+' + capsStart + ' … +' + capsEnd + '  (lump-size tail)'), 'le-val-gold'],
            ['Thread size policy', esc(lumpSize + ' words  (n−6 defines this total allocation)'), 'le-val-gold'],
            ['WukongCallHome', esc('0x' + V20_WCH_BASE_BYTE.toString(16).toUpperCase() + '–0x' + V20_WCH_END_BYTE.toString(16).toUpperCase() + '  (after full Thread allocation)'), 'le-val-gold'],
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

        var saveBtn = _threadDesignKey !== 'legacy'
            ? '<p class="le-panel-desc">Layout and tuples are saved locally for this Thread. They are design intent only, not an installed layout. Global boot changes remain separate under the legacy shared boot layout and require explicit review.</p>'
            : '<p class="le-panel-desc"><strong>Boot layout — separate from tuple definitions.</strong> Only the button below submits Thread sizes for review. Tuple edits are saved in this browser; viewing the next page does not apply them to a boot image.</p><div class="le-save-row">' +
            '<button class="le-save-btn"' + (overCapacity ? ' disabled' : '') +
            ' onclick="lumpEditorSaveThread()"' +
            ' title="Review and save the page geometry to boot configuration. Does not save tuple definitions or compile editor source.">' +
            'Review / save boot layout' +
            '</button>' +
             '<button class="le-next-btn" onclick="lumpEditorNextStep(\'lump-resident\')"' +
             ' title="View the Namespace as built in the committed boot image (read-only)">' +
             'View built Namespace \u2192' +
             '</button>' +
            '<span id="le-t-step1-status" class="le-rl-status" style="margin-left:0.75rem;"></span>' +
            '<span id="le-t-step1-err" class="le-rl-status" style="margin-left:0.5rem;color:#f77;"></span>' +
            '</div>';

        return '<div class="le-panel">' +
            threadCountClampBanner +
            threadClampBanner +
            overCapWarning +
             '<p class="le-panel-desc">This design is normative for every Thread. n\u22126 defines the total lump size; after Header, DR0\u2013DR15, and protected STO +17, Heap fills +18 through the stack start. The LIFO Stack is immediately before the twelve persisted CR0\u2013CR11 homes at the lump tail (lumpSize\u221212 \u2026 lumpSize\u22121). cc is the fixed capability-home count (12), not a heap size. Increasing lump size grows Heap; Threads have no Freespace zone.</p>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Lump size<span class="le-range-hint"> 2^' + MIN_EXP + '\u2013' + maxLumpPow2 + ', max ' + fmtWords(Math.pow(2, maxLumpPow2)) + ' w</span></label>' +
                '<div class="le-input-group le-input-group-wide">' +
                    '<select class="le-select" id="le-t-lump-sel" onchange="lumpEditorThreadLumpSize(this.value)">' + lumpOpts + '</select>' +
                '</div>' +
            '</div>' +
                '<div class="le-thread-sync-note">' +
                '<span class="le-thread-sync-badge">Thread = ' + esc(fmtWords(lumpSize)) + ' words (2^' + lumpPow2 + ') \u00b7 cw/sw=' + stackWords + ' \u00b7 cc=12 homes \u00b7 Heap=' + heap + ' words \u00b7 CR0\u2013CR11 @ +' + capsStart + '\u2026+' + capsEnd + '</span>' +
            '</div>' +
            (_threadDesignKey === 'legacy' ? '<div class="le-field-row">' +
                '<label class="le-label">Thread count<span class="le-range-hint">' + esc(countHint) + '</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-count-sl"  min="1" max="' + maxCount + '" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-count-num" min="1" max="' + maxCount + '" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                '</div>' +
            '</div>' : '') +
            '<div class="le-field-row">' +
                '<label class="le-label">Stack frames<span class="le-range-hint"> 10\u2013255  (' + stackWords + ' words)</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-stack-sl"  min="10" max="255" value="' + stackFrames + '" oninput="lumpEditorThreadStack(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-stack-num" min="10" max="255" value="' + stackFrames + '" oninput="lumpEditorThreadStack(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-bar-label-row"><span>Single thread memory layout</span><span class="le-bar-label-count">' + esc(lumpSize.toLocaleString() + ' words') + '</span></div>' +
            (zones.length ? renderBar(zones) : '') +
            (zones.length ? renderMagBar(zones) : '') +
            '<div class="le-divider"></div>' +
            grid +
            renderTuplePanel(overCapacity ? 0 : heap, overCapacity) +
            saveBtn +
        '</div>';
    }

    // ── Heap tuple definitions (design intent) ───────────────────────────────

    var _tupleMsg = null;      // { err: bool, text } | null
    var _tupleHeapWords = 0;   // heap size used by the last render

    function currentHeapWords() {
        var profile  = getBoardProfile();
        var budget   = Math.floor(profile.totalRamWords / 2);
        var count    = clamp(state.thread.count, 1, boardThreadCountLimit(profile));
        var maxPow2  = maxExpForWords(Math.min(Math.max(64, Math.floor(budget / count)), 8192));
        var lumpSize = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, maxPow2));
        var stackW   = clamp(state.thread.stackFrames, 10, 255) * 2;
        return Math.max(0, lumpSize - CAP_WORDS - stackW - 18);
    }

    function renderTuplePanel(heapWords, overCapacity) {
        var TT = window.ThreadTupleDesign;
        _tupleHeapWords = heapWords;
        if (!TT) return '';
        var tuples = state.tuples || [];
        var problems = TT.validate(tuples, heapWords);
        var used = tuples.reduce(function (s, t) { return s + TT.tupleWords(t); }, 0);
        var tplOpts = Object.keys(TT.TEMPLATES).map(function (k) {
            return '<option value="' + esc(k) + '">' + esc(TT.TEMPLATES[k].label) + '</option>';
        }).join('');
        var typeOpts = function (sel) {
            return Object.keys(TT.TYPES).map(function (k) {
                return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(k) + '</option>';
            }).join('');
        };
        var polOpts = function (sel) {
            return Object.keys(TT.POLICIES).map(function (k) {
                return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(TT.POLICIES[k]) + '</option>';
            }).join('');
        };
        var list = tuples.map(function (t, i) {
            var w = TT.tupleWords(t), lay = TT.layout(t), id = 'le-tu-' + i;
            var rows = t.fields.map(function (f, j) {
                var fid = id + '-f' + j, L = lay[j];
                var sizeCell = (f.type === 'utf8' || f.type === 'words')
                    ? '<input type="number" class="le-number" id="' + fid + '-size" min="1" max="' + (f.type === 'utf8' ? 1024 : 4096) + '" value="' + esc(f.size) + '" aria-label="' + esc(t.name + '.' + f.name + (f.type === 'utf8' ? ' capacity in bytes' : ' size in words')) + '" onchange="lumpEditorTupleField(' + i + ',' + j + ',\'size\',this.value)">'
                    : '<span class="le-tu-fixed">1 w</span>';
                var initCell = f.type === 'words'
                    ? '<span class="le-tu-fixed">zero</span>'
                    : '<input type="' + (f.type === 'utf8' ? 'text' : 'number') + '" class="le-tu-input' + (f.type === 'utf8' ? '' : ' le-tu-num') + '" id="' + fid + '-init" value="' + esc(f.initial) + '" aria-label="' + esc(t.name + '.' + f.name + ' initial value') + '" onchange="lumpEditorTupleField(' + i + ',' + j + ',\'initial\',this.value)">';
                return '<tr>' +
                    '<td class="le-tu-mono">+' + L.offset + '</td>' +
                    '<td><input type="text" class="le-tu-input" id="' + fid + '-name" value="' + esc(f.name) + '" maxlength="32" aria-label="' + esc(t.name + ' field ' + (j + 1) + ' name') + '" onchange="lumpEditorTupleField(' + i + ',' + j + ',\'name\',this.value)"></td>' +
                    '<td><select class="le-select" aria-label="' + esc(t.name + '.' + f.name + ' type') + '" onchange="lumpEditorTupleField(' + i + ',' + j + ',\'type\',this.value)">' + typeOpts(f.type) + '</select></td>' +
                    '<td>' + sizeCell + '</td>' +
                    '<td>' + initCell + '</td>' +
                    '<td class="le-tu-mono">' + L.words + '</td>' +
                    '<td><button type="button" class="le-copy-btn" onclick="lumpEditorTupleRemoveField(' + i + ',' + j + ')" aria-label="' + esc('Remove field ' + f.name + ' from ' + t.name) + '"' + (t.fields.length < 2 ? ' disabled' : '') + '>remove</button></td>' +
                '</tr>';
            }).join('');
            return '<fieldset class="le-tu-card">' +
                '<legend class="le-tu-legend">' + esc(t.name) + ' <span class="le-tu-mono">heap +' + esc(t.offset) + ' \u2026 +' + esc(t.offset + w - 1) + ' \u00b7 ' + w + ' w \u00b7 ' + esc(t.template) + '</span></legend>' +
                '<div class="le-tu-head">' +
                    '<label class="le-tu-lbl" for="' + id + '-name">Name</label>' +
                    '<input type="text" class="le-tu-input" id="' + id + '-name" maxlength="32" value="' + esc(t.name) + '" onchange="lumpEditorTupleSet(' + i + ',\'name\',this.value)">' +
                    '<label class="le-tu-lbl" for="' + id + '-off">Heap offset</label>' +
                    '<input type="number" class="le-number" id="' + id + '-off" min="0" max="' + Math.max(0, heapWords - 1) + '" value="' + esc(t.offset) + '" onchange="lumpEditorTupleSet(' + i + ',\'offset\',this.value)">' +
                    '<label class="le-tu-lbl" for="' + id + '-pol">Start-up intent</label>' +
                    '<select class="le-select" id="' + id + '-pol" onchange="lumpEditorTupleSet(' + i + ',\'policy\',this.value)">' + polOpts(t.policy) + '</select>' +
                '</div>' +
                '<div class="le-tu-scroll"><table class="le-tu-table"><caption class="le-tu-sr">Fields of ' + esc(t.name) + '</caption>' +
                    '<thead><tr><th scope="col">Rel</th><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Initial</th><th scope="col">Words</th><th scope="col"><span class="le-tu-sr">Actions</span></th></tr></thead>' +
                    '<tbody>' + rows + '</tbody></table></div>' +
                '<div class="le-tu-actions">' +
                    '<button type="button" class="le-next-btn" onclick="lumpEditorTupleAddField(' + i + ')">Add field</button>' +
                    '<button type="button" class="le-copy-btn" onclick="lumpEditorTupleDelete(' + i + ')" aria-label="' + esc('Delete tuple ' + t.name) + '">Delete tuple</button>' +
                '</div>' +
            '</fieldset>';
        }).join('');
        var empty = tuples.length ? '' :
            '<div class="le-tu-empty">No tuples defined. The whole ' + heapWords + '-word Heap is unassigned design space. Pick a template to begin.</div>';
        var msg = _tupleMsg ? '<div class="' + (_tupleMsg.err ? 'le-error-banner' : 'le-tu-ok') + '">' + esc(_tupleMsg.text) + '</div>' : '';
        var probs = problems.length
            ? '<div class="le-warn-banner"><strong>Saved tuples no longer fit this geometry.</strong> ' + esc(problems.join(' ')) + ' Adjust offsets or Thread geometry; nothing was deleted.</div>' : '';
        var unreadable = state.tuplesUnreadable !== undefined
            ? '<div class="le-warn-banner">Unreadable saved tuple data is kept untouched in browser storage.</div>' : '';
        return '<div class="le-divider"></div>' +
            '<section class="le-tu" aria-labelledby="le-tu-title">' +
            '<h3 class="le-tu-title" id="le-tu-title">Heap tuple definitions <span class="le-tu-mono">' + used + ' / ' + heapWords + ' heap words assigned</span></h3>' +
            '<p class="le-panel-desc" id="le-tu-scope"><strong>Scope:</strong> design intent for the Heap zone (CR5) of this Thread design. ' +
            'Definitions are saved in this browser together with the Thread design and apply to every Thread built from it, not to one individual Thread. ' +
            'They are <strong>not</strong> included in the boot config, the Thread header, the built .lump file, simulator memory or hardware; ' +
            'nothing initializes or preserves them at run time yet, so the start-up intent is a recorded plan only. Use Export JSON to carry them to another browser. ' +
            'Offsets are relative to Heap start (Thread +18). Tuples add no capability or privacy boundary: every abstraction on the Thread can reach the whole heap; isolate state with a separate Thread.</p>' +
            unreadable + probs + msg +
            '<div class="le-tu-add" role="group" aria-label="Add tuple">' +
                '<label class="le-tu-lbl" for="le-tu-template">Template</label>' +
                '<select class="le-select" id="le-tu-template">' + tplOpts + '</select>' +
                '<button type="button" class="le-next-btn" id="le-tu-add-btn" onclick="lumpEditorTupleAdd()"' + (overCapacity ? ' disabled' : '') + '>Add tuple</button>' +
            '</div>' +
            '<div aria-live="polite">' + empty + list + '</div>' +
            '<div class="le-tu-actions"><button type="button" class="le-next-btn" onclick="lumpEditorTupleSave()">Save tuple definitions locally</button><span class="le-tu-lbl">No boot-configuration change, compilation, or hardware action.</span></div>' +
            '<details class="le-tu-io" id="le-tu-io"><summary>Export / import definitions (JSON)</summary>' +
                '<div class="le-tu-actions">' +
                    '<button type="button" class="le-next-btn" onclick="lumpEditorTupleExport()">Export JSON</button>' +
                    '<label class="le-copy-btn le-tu-file">Load file<input type="file" accept="application/json,.json" class="le-tu-sr" onchange="lumpEditorTupleFile(this)"></label>' +
                    '<button type="button" class="le-next-btn" onclick="lumpEditorTupleImport()">Validate and replace</button>' +
                '</div>' +
                '<label class="le-tu-lbl" for="le-tu-json">Definitions JSON (validated against the current Heap before anything is replaced)</label>' +
                '<textarea id="le-tu-json" class="le-tu-json" rows="6" spellcheck="false"></textarea>' +
            '</details>' +
            '</section>';
    }

    function _tupleApply(res, okText) {
        if (res.error) { _tupleMsg = { err: true, text: res.error + ' Nothing changed.' }; }
        else {
            state.tuples = res.tuples;
            if (saveState()) _tupleMsg = okText ? { err: false, text: okText } : null;
            else _tupleMsg = { err: true, text: 'Change kept on this page but NOT saved: browser storage is unavailable or full. Use Export JSON to keep a copy.' };
        }
        render();
    }
    function _num(v) { var s = String(v).trim(); return /^-?\d+$/.test(s) ? Number(s) : NaN; }

    window.lumpEditorTupleSave = function () {
        var errors = window.ThreadTupleDesign.validate(state.tuples, currentHeapWords());
        _tupleApply({ tuples: state.tuples, error: errors.length ? errors.join(' ') : null },
            'Tuple definitions saved in this browser. Boot configuration and hardware are unchanged.');
    };

    window.lumpEditorTupleAdd = function () {
        var sel = document.getElementById('le-tu-template');
        var key = sel ? sel.value : 'custom';
        _tupleApply(window.ThreadTupleDesign.addFromTemplate(state.tuples, key, currentHeapWords()), 'Tuple added and saved with this browser\u2019s Thread design.');
    };
    window.lumpEditorTupleSet = function (i, key, v) {
        var patch = {}; patch[key] = key === 'offset' ? _num(v) : String(v);
        _tupleApply(window.ThreadTupleDesign.updateTuple(state.tuples, i, patch, currentHeapWords()));
    };
    window.lumpEditorTupleDelete = function (i) {
        var t = state.tuples[i]; if (!t) return;
        if (typeof confirm === 'function' && !confirm('Delete tuple definition "' + t.name + '"? This changes only the saved design.')) return;
        _tupleApply(window.ThreadTupleDesign.removeTuple(state.tuples, i), 'Tuple deleted.');
    };
    window.lumpEditorTupleAddField = function (i) {
        _tupleApply(window.ThreadTupleDesign.addField(state.tuples, i, currentHeapWords()));
    };
    window.lumpEditorTupleRemoveField = function (i, j) {
        _tupleApply(window.ThreadTupleDesign.removeField(state.tuples, i, j, currentHeapWords()));
    };
    window.lumpEditorTupleField = function (i, j, key, v) {
        var f = state.tuples[i] && state.tuples[i].fields[j];
        var patch = {};
        if (key === 'size') patch.size = _num(v);
        else if (key === 'initial') patch.initial = (f && f.type === 'utf8') ? String(v) : _num(v);
        else patch[key] = String(v);
        _tupleApply(window.ThreadTupleDesign.updateField(state.tuples, i, j, patch, currentHeapWords()));
    };
    window.lumpEditorTupleExport = function () {
        var json = window.ThreadTupleDesign.exportJson(state.tuples, currentHeapWords());
        var ta = document.getElementById('le-tu-json'); if (ta) ta.value = json;
        try {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            a.download = 'thread-design-tuples.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        } catch (e) {}
    };
    window.lumpEditorTupleFile = function (input) {
        var file = input && input.files && input.files[0]; if (!file) return;
        var r = new FileReader();
        var owner = _threadDesignKey;
        r.onload = function () { if (owner !== _threadDesignKey) return; var ta = document.getElementById('le-tu-json'); if (ta) ta.value = String(r.result); };
        r.readAsText(file);
    };
    window.lumpEditorTupleImport = function () {
        var ta = document.getElementById('le-tu-json');
        var text = ta ? ta.value : '';
        try {
            var list = window.ThreadTupleDesign.importJson(text, currentHeapWords());
            if (state.tuples.length && typeof confirm === 'function' &&
                    !confirm('Replace ' + state.tuples.length + ' tuple definition(s) with ' + list.length + ' imported?')) return;
            _tupleApply({ tuples: list, error: null }, 'Imported ' + list.length + ' tuple definition(s).');
        } catch (e) {
            _tupleMsg = { err: true, text: 'Import rejected: ' + e.message + ' Nothing changed.' };
            render();
            ta = document.getElementById('le-tu-json'); if (ta) ta.value = text;
        }
    };

    // ── Namespace panel ───────────────────────────────────────────────────────

    function renderNSPanel() {
        if (_threadDesignKey !== 'legacy') {
            return '<div class="le-panel"><p>The selected named Thread is a local draft. ' +
                'Namespace build settings use the separate shared boot layout. Switch to that layout before editing or saving global geometry.</p>' +
                '<button type="button" class="le-save-btn" onclick="lumpEditorSelectThread(\'legacy\')">Edit shared boot layout</button></div>';
        }
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
        var total      = Math.pow(2, n + 14);
        var serverMax  = (_rl && _rl.limits && _rl.limits.maxNsEntries) || 1024;
        var maxSl      = Math.min(total / 64, serverMax, NS_CAP_MAX);
        var capOptions = NS_CAP_OPTIONS.filter(function (c) { return c <= maxSl; });
        if (!capOptions.length) capOptions = [NS_CAP_MIN];
        var slots      = snapNSCap(state.ns.slots);
        if (slots > capOptions[capOptions.length - 1]) slots = capOptions[capOptions.length - 1];
        var NS_TABLE_COMPUTED = slots * 4;
        var threadLump   = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, MAX_EXP));
        var maxCount     = Math.min(boardThreadCountLimit(profile), Math.max(1, Math.floor(budget / threadLump)));
        var threadCount  = clamp(state.thread.count, 1, maxCount);
        // Boot overhead = Boot.NS lump (64 w) + one resident Thread lump per thread.
        // Null slot 2 has been removed — no 64-word gap between Thread and Boot.Abstr.
        var namespaceLumpWords = 64;
        var bootOverhead = namespaceLumpWords + threadLump * threadCount;
        var pool    = total - bootOverhead - NS_TABLE_COMPUTED;
        var nsTableBaseByte = total * 4 - NS_TABLE_COMPUTED * 4;
        var nsTableEndByte  = total * 4 - 1;
        var slot0Byte       = nsTableBaseByte + (slots - 1) * V20_NS_ENTRY_BYTES;
        var lastSlotByte    = nsTableBaseByte;
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
            { label: 'Boot.NS', words: namespaceLumpWords, cls: 'le-zone-hdr' }
        ];
        for (var _ti = 1; _ti <= threadCount; _ti++) {
            allZones.push({
                label: 'Thread.' + _ti,
                words: threadLump,
                cls: 'le-zone-stack'
            });
        }
        allZones.push(
            { label: 'Pool',     words: Math.max(pool, 0), cls: 'le-zone-free' },
            { label: 'NS Table', words: NS_TABLE_COMPUTED, cls: 'le-zone-heap', onclick: 'lumpEditorToggleNSDrill()' }
        );

        var threadZoneDesc = threadCount === 1
            ? 'Thread.1 (' + threadLump.toLocaleString() + ' w)'
            : threadCount + ' \u00d7 ' + threadLump.toLocaleString() + ' w (Thread.1, Thread.2\u2026Thread.' + threadCount + ')';
        var generatedThreadSlots = threadCount > 1
            ? 'NS slots 11\u2013' + (9 + threadCount) + ' (Thread.2\u2026Thread.' + threadCount + ')'
            : 'None (Thread.1 remains the fixed NS slot 1 entry)';
        var nsTableDesc = esc(NS_TABLE_COMPUTED.toLocaleString() + ' words (' + slots + ' slots × 4)');
        var grid = renderGrid([
            ['Target board',   boardInfo, 'le-val-gold'],
            ['Total words',    esc(total.toLocaleString() + '  (2^' + (n + 14) + ')'), noFit ? '' : 'le-val-gold'],
            ['Generated Thread slots', esc(generatedThreadSlots), ''],
            ['n_minus_6',     esc(String(n)), ''],
            ['typ field',     '01  (Namespace, reserved)', ''],
            ['Slot capacity',  esc(slots.toLocaleString() + '  (power of two; up to ' + Math.min(maxSl, NS_CAP_MAX).toLocaleString() + ' for this memory size)'), ''],
            ['NS table',       nsTableDesc, ''],
            ['Placement',      'Top of memory \u00b7 inverted physical order', 'le-val-gold'],
            ['Slot order',     esc('Slot 0 @ 0x' + slot0Byte.toString(16).toUpperCase() + ' \u2192 Slot ' + (slots - 1) + ' @ 0x' + lastSlotByte.toString(16).toUpperCase() + '  (descending)'), ''],
            ['ISA table range', esc('0x' + nsTableBaseByte.toString(16).toUpperCase() + '\u20130x' + nsTableEndByte.toString(16).toUpperCase() + ' (' + V20_NS_ENTRY_BYTES + ' bytes/slot)'), ''],
            ['Boot overhead',  esc(bootOverhead.toLocaleString() + ' words (Boot.NS 64 + ' + threadZoneDesc + ')'), ''],
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

        var capOpts = capOptions.map(function (c) {
            return '<option value="' + c + '"' + (c === slots ? ' selected' : '') + '>' +
                c.toLocaleString() + ' slots  (' + (c * 4).toLocaleString() + ' table words)' +
                (c === NS_CAP_MIN ? '  \u2014 default' : '') + '</option>';
        }).join('');

        return '<div class="le-panel">' +
            clampBanner +
            '<p class="le-panel-desc">V20 uses a power-of-two namespace table (64\u20131024 entries, 16 bytes each) at the top of memory. Slot 0 is the highest-address entry and each following slot descends by 16 bytes. The slot count is encoded across <code>cw</code> and <code>cc</code> as <code>(cw&lt;&lt;8)|cc</code>. Click the NS Table zone in the memory layout below to drill into its physical slot layout.</p>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Total namespace memory</label>' +
                '<div class="le-input-group le-input-group-wide">' +
                    '<select class="le-select" id="le-ns-size-sel" onchange="lumpEditorNSSize(this.value)">' + presetOpts + '</select>' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">NS slot capacity<span class="le-range-hint"> power of two \u00b7 64 (default) \u2013 ' + Math.min(maxSl, NS_CAP_MAX).toLocaleString() + '</span></label>' +
                '<div class="le-input-group le-input-group-wide">' +
                    '<select class="le-select" id="le-ns-slots-sel" onchange="lumpEditorNSSlots(this.value)">' + capOpts + '</select>' +
                '</div>' +
            '</div>' +
            threadStepper +
            '<div class="le-bar-label-row"><span>Memory layout</span><span class="le-bar-label-count">' + esc(total.toLocaleString() + ' words') + '</span></div>' +
            renderBar(allZones) +
            renderMagBar(allZones) +
            renderNSDrilldown(n, slots, total) +
            '<div class="le-divider"></div>' +
            grid +
            '<div class="le-save-row">' +
                '<button class="le-save-btn" onclick="lumpEditorPostStep1()"' +
                ' title="Save current NS + Thread lump sizes as step 1 in the boot config">' +
                '\u2714\ufe0e Save to boot config' +
                '</button>' +
                '<button class="le-next-btn" onclick="lumpEditorNextStep(\'lump-thread\')"' +
                ' title="View Thread LUMP without saving boot-layout changes">' +
                'Next: Thread LUMP \u2192' +
                '</button>' +
                '<span id="le-ns-step1-status" class="le-rl-status" style="margin-left:0.75rem;"></span>' +
                '<span id="le-ns-step1-err" class="le-rl-status" style="margin-left:0.5rem;color:#f77;"></span>' +
            '</div>' +
        '</div>';
    }

    // ── NS Table drill-down (committed-state inspection + fault flagging) ────

    var _nsDrill = {
        open:     false,
        expanded: {},      // slot index → true
        entries:  [],      // committed rich NS rows from /api/boot-image/ns-state
        committed: null,   // authoritative raw view {totalWords, maxEntries, header, entries:[{slot,w0..w3}]}
        seeded:   false,   // approved settings seeded from committed geometry (first load, no saved design)
        loaded:   false,
        loading:  false,
        errorMsg: ''
    };

    function _nsStateLoad(force) {
        if (_nsDrill.loading) return;
        if (_nsDrill.loaded && !force) return;
        _nsDrill.loading = true;
        fetch('/api/boot-image/ns-state', { cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                _nsDrill.loading  = false;
                _nsDrill.loaded   = true;
                _nsDrill.errorMsg = (data && data.error) ? String(data.error) : '';
                _nsDrill.entries  = (data && Array.isArray(data.abstractions)) ? data.abstractions : [];
                _nsDrill.committed = (data && data.committed) ? data.committed : null;
                if (data && typeof data.namespaceFingerprint === 'string') {
                    _rl.namespaceFingerprint = data.namespaceFingerprint;
                    _rl.namespaceRows = _nsDrill.entries.slice();
                    var _nsBootRow = _rl.namespaceRows.find(function(row) {
                        return row && row.boot === true &&
                            Number.isInteger(Number(row.slot));
                    });
                    _rl.bootEntrySlot = _nsBootRow ? Number(_nsBootRow.slot) : null;
                }
                // First-run seeding: when the programmer has never saved a
                // design locally, adopt the committed image's geometry as the
                // approved starting point so a valid committed image opens clean.
                if (!_nsDrill.seeded && !_hadSavedState && _nsDrill.committed) {
                    _nsDrill.seeded = true;
                    var tw = _nsDrill.committed.totalWords;
                    var lg = Math.log2(tw);
                    if (Number.isInteger(lg) && lg >= 14 && lg <= 29) state.ns.n_minus_6 = lg - 14;
                    state.ns.slots = snapNSCap(_nsDrill.committed.maxEntries || NS_CAP_MIN);
                    // Seed thread geometry from the committed Thread.1 block too,
                    // so the memory-truth checks open clean on a valid image.
                    var ct = _nsDrill.committed.thread;
                    if (ct && _threadDesignKey === 'legacy') {
                        var tlg = Math.log2(ct.size || 0);
                        if (Number.isInteger(tlg) && tlg >= MIN_EXP && tlg <= MAX_EXP) state.thread.lumpPow2 = tlg;
                        if (typeof ct.count === 'number' && ct.count >= 1 && ct.count <= 9) state.thread.count = ct.count;
                    }
                    saveState();
                }
                render();
            })
            .catch(function (err) {
                _nsDrill.loading  = false;
                _nsDrill.loaded   = true;
                _nsDrill.errorMsg = 'Failed to load committed NS state: ' + err;
                _nsDrill.entries  = [];
                render();
            });
    }

    function _parseHexField(v) {
        if (typeof v === 'number') return v >>> 0;
        if (typeof v === 'string') {
            var p = parseInt(v, 16);
            return isNaN(p) ? null : (p >>> 0);
        }
        return null;
    }

    var MMIO_BASE_WORD = 0x40000000;   // device-register windows live outside RAM by design

    // Compare one committed NS row against the approved interactive design.
    // Returns an array of fault strings (empty = clean).
    function _nsSlotFaults(e, slots, totalWords) {
        var faults = [];
        if (e.slot >= slots) {
            faults.push('occupied slot ' + e.slot + ' is beyond the approved capacity of ' + slots + ' slots');
        }
        // Prefer the authoritative raw committed words over snapshot fields.
        var raw   = _nsRawEntry(e.slot);
        var loc   = raw ? (raw.w0 >>> 0) : _parseHexField(e.location);
        var limit = raw ? (_decodeNSWord1(raw.w1 >>> 0).limit) : _parseHexField(e.limit);
        if (loc !== null && loc < MMIO_BASE_WORD) {
            var end = loc + (limit !== null ? limit : 0);
            if (loc >= totalWords || end >= totalWords) {
                faults.push('location 0x' + loc.toString(16).toUpperCase() +
                    (limit !== null ? ' + limit 0x' + limit.toString(16).toUpperCase() : '') +
                    ' falls outside the approved ' + totalWords.toLocaleString() + '-word memory');
            }
        }
        return faults;
    }

    var GT_TYPE_NAMES = ['Null', 'Inform', 'Outform', 'Abstract'];

    // Decode word1 per the v2.0 NS layout (matches simulator.js parseNSWord1
    // and boot_image.py pack_ns_word1): b@31, g@29, gtType@[27:26], clistCount@[25:17], limit17@[16:0].
    function _decodeNSWord1(w1) {
        return {
            b:          (w1 >>> 31) & 1,
            g:          (w1 >>> 29) & 1,
            gtType:     (w1 >>> 26) & 3,
            clistCount: (w1 >>> 17) & 0x1FF,
            limit:      w1 & 0x1FFFF
        };
    }

    // Decode a v2.0 GT word (boot_image.py create_gt / simulator.js createGT):
    // perm3@[30:28], dom@27, gtType@[26:25], gt_seq@[24:16], slot@[15:0].
    function _decodeGTWord(w) {
        return {
            perm3:  (w >>> 28) & 7,
            dom:    (w >>> 27) & 1,
            gtType: (w >>> 25) & 3,
            seq:    (w >>> 16) & 0x1FF,
            slot:   w & 0xFFFF
        };
    }

    function _permStr(p3) {
        return ((p3 & 4) ? 'R' : '\u00b7') + ((p3 & 2) ? 'W' : '\u00b7') + ((p3 & 1) ? 'X' : '\u00b7');
    }

    // Committed raw 4-word entry for a slot, or null when absent.
    function _nsRawEntry(slot) {
        var c = _nsDrill.committed;
        if (!c || !Array.isArray(c.entries)) return null;
        for (var i = 0; i < c.entries.length; i++) {
            if (c.entries[i].slot === slot) return c.entries[i];
        }
        return null;
    }

    function _nsSlotDetail(e, isMMIO) {
        var raw = _nsRawEntry(e.slot);
        var rows;
        if (raw) {
            var d1 = _decodeNSWord1(raw.w1 >>> 0);
            rows = [
                ['+0', 'word0 \u2014 location', hex8(raw.w0 >>> 0),
                 (isMMIO ? 'MMIO device-register window' : 'Lump base (word address)')],
                ['+1', 'word1 \u2014 authority', hex8(raw.w1 >>> 0),
                 'type=' + (GT_TYPE_NAMES[d1.gtType] || d1.gtType) + ' \u00b7 limit=' + d1.limit.toLocaleString() +
                 ' (' + (d1.limit + 1).toLocaleString() + ' words) \u00b7 clistCount=' + d1.clistCount +
                 ' \u00b7 b=' + d1.b + ' \u00b7 g=' + d1.g],
                ['+2', 'word2 \u2014 integrity', hex8(raw.w2 >>> 0),
                 'gt_seq=' + (((raw.w2 >>> 25) & 0x7F)) + ' \u00b7 CRC-16 parity=0x' + (raw.w2 & 0xFFFF).toString(16).toUpperCase()],
                ['+3', 'word3 \u2014 cache token T', hex8(raw.w3 >>> 0),
                 raw.w3 === 0 ? 'No trusted cache binding recorded' :
                 '32-bit lookup/cache value only \u00b7 never identity or authority']
            ];
        } else {
            // No raw words available (older server / missing boot image):
            // show the snapshot's decoded fields only, without fabricated hex.
            rows = [
                ['+0', 'word0 \u2014 location', '\u2014', 'snapshot: ' + esc(String(e.location)) + (isMMIO ? ' (MMIO)' : '')],
                ['+1', 'word1 \u2014 authority', '\u2014', 'snapshot: type=' + esc(String(e.type)) + ' \u00b7 limit=' + esc(String(e.limit)) + ' \u00b7 g=' + (e.g || 0)],
                ['+2', 'word2 \u2014 integrity', '\u2014', 'snapshot: gt_seq=' + (e.seq || 0) + ' \u00b7 seal=' + esc(String(e.seal))],
                ['+3', 'word3 \u2014 cache token T', '\u2014', 'raw words unavailable (boot image not readable)']
            ];
        }
        return '<table class="le-nsd-words"><thead><tr>' +
            '<th>Off</th><th>Word</th><th>Hex (committed)</th><th>Decoded</th>' +
            '</tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr><td class="le-nsd-mono">' + r[0] + '</td><td>' + r[1] +
                    '</td><td class="le-nsd-mono">' + r[2] + '</td><td>' + r[3] + '</td></tr>';
            }).join('') +
            '</tbody></table>';
    }

    function _nsDrillRow(idx, addrByte, e, faults) {
        var addr = '0x' + addrByte.toString(16).toUpperCase();
        if (!e) {
            return '<div class="le-nsd-row le-nsd-empty">' +
                '<span class="le-nsd-slot">Slot ' + idx + '</span>' +
                '<span class="le-nsd-addr le-nsd-mono">' + addr + '</span>' +
                '<span class="le-nsd-name le-nsd-dim">\u2014 empty \u2014</span>' +
                '</div>';
        }
        var raw     = _nsRawEntry(e.slot);
        var loc     = raw ? (raw.w0 >>> 0) : _parseHexField(e.location);
        var lim     = raw ? _decodeNSWord1(raw.w1 >>> 0).limit : _parseHexField(e.limit);
        var isMMIO  = loc !== null && loc >= MMIO_BASE_WORD;
        var faulted = faults.length > 0;
        var expanded = !!_nsDrill.expanded[idx];
        var badges = '';
        if (e.boot)  badges += '<span class="le-nsd-badge le-nsd-badge-boot">boot</span>';
        if (isMMIO)  badges += '<span class="le-nsd-badge le-nsd-badge-mmio">MMIO</span>';
        if (faulted) badges += '<span class="le-nsd-badge le-nsd-badge-fault">\u26A0 FAULT</span>';
        var html =
            '<div class="le-nsd-row le-nsd-pop' + (faulted ? ' le-nsd-fault' : '') + (expanded ? ' le-nsd-open' : '') + '"' +
                ' onclick="lumpEditorNSDrillSlot(' + idx + ')" title="Click to ' + (expanded ? 'collapse' : 'inspect the 4-word entry') + '">' +
                '<span class="le-nsd-slot">Slot ' + idx + '</span>' +
                '<span class="le-nsd-addr le-nsd-mono">' + addr + '</span>' +
                '<span class="le-nsd-name">' + esc(e.name || '?') + '</span>' +
                '<span class="le-nsd-meta le-nsd-mono">' + esc(String(e.type || '?')) +
                ' \u00b7 loc ' + (loc !== null ? '0x' + loc.toString(16).toUpperCase().padStart(8, '0') : esc(String(e.location))) +
                ' \u00b7 lim ' + (lim !== null ? '0x' + lim.toString(16).toUpperCase() : esc(String(e.limit))) + '</span>' +
                badges +
                '<span class="le-nsd-caret">' + (expanded ? '\u25BE' : '\u25B8') + '</span>' +
            '</div>';
        if (faulted) {
            html += '<div class="le-nsd-fault-detail">' + faults.map(function (f) {
                return '\u26A0 ' + esc(f);
            }).join('<br>') + '</div>';
        }
        if (expanded) {
            html += '<div class="le-nsd-detail">' + _nsSlotDetail(e, isMMIO) + '</div>';
        }
        return html;
    }

    function renderNSDrilldown(n, slots, total) {
        if (!_nsDrill.open) {
            return '<div class="le-nsd-toggle-row">' +
                '<button class="le-nsd-toggle-btn" onclick="lumpEditorToggleNSDrill()">' +
                '\u25B8 NS Table drill-down \u2014 physical slot layout &amp; committed-state check</button></div>';
        }
        var nsTableBaseByte = total * 4 - slots * V20_NS_ENTRY_BYTES;
        var bySlot = {};
        var beyond = [];
        var faultCount = 0;
        var shapeFaults = [];
        for (var i = 0; i < _nsDrill.entries.length; i++) {
            var e = _nsDrill.entries[i];
            if (!e || typeof e.slot !== 'number') continue;
            if (e.slot < slots) bySlot[e.slot] = e; else beyond.push(e);
        }
        // Table-shape check against the authoritative committed geometry
        // (raw boot-image.bin header + NS-table extent) — not heuristics on
        // individual slot limits.
        var committed = _nsDrill.committed;
        if (committed) {
            if (committed.totalWords !== total) {
                shapeFaults.push('committed image is ' + committed.totalWords.toLocaleString() +
                    ' words; the approved Total-memory setting is ' + total.toLocaleString() + ' words');
            }
            if (committed.maxEntries !== slots) {
                shapeFaults.push('committed NS table reserves ' + committed.maxEntries.toLocaleString() +
                    ' slots (' + (committed.maxEntries * 4).toLocaleString() + ' words); the approved capacity is ' +
                    slots.toLocaleString() + ' slots (' + (slots * 4).toLocaleString() + ' words) \u2014 cw/cc mismatch');
            }
            // NS header encoding truth: the server synthesizes the architectural
            // V20 namespace header from the committed geometry; it must equal
            // the header this designer page displays (packHdr slot-count split).
            if (committed.nsHeader && typeof committed.nsHeader.word === 'number') {
                var expNsHdr = packHdr(n, (slots >> 8) & 0x1FFF, slots & 0xFF, 1) >>> 0;
                if ((committed.nsHeader.word >>> 0) !== expNsHdr) {
                    shapeFaults.push('committed NS header encodes as ' + hex8(committed.nsHeader.word >>> 0) +
                        '; the approved design encodes ' + hex8(expNsHdr) +
                        ' (n\u22126=' + n + ', slots=' + slots + ', typ=01)');
                }
            }
            // Word-0 header type truth: must be a Thread header (typ=10)
            // regardless of whether the server produced a thread block.
            if (committed.header && committed.header.typ !== 2) {
                shapeFaults.push('word 0 header typ=' + committed.header.typ + ' \u2014 expected a Thread header (typ=10)');
            }
            // Thread memory-truth: header at word 0, size, count, CR0 boot-entry GT.
            if (committed.thread) {
                var _thr = committed.thread;
                var _apprSize = Math.pow(2, clamp(state.thread.lumpPow2, MIN_EXP, MAX_EXP));
                var _board2   = (typeof localStorage !== 'undefined' && localStorage.getItem('fpga_board_target')) || 'wukong-xc7a100t';
                var _prof2    = BOARD_PROFILES[_board2] || BOARD_PROFILES['wukong-xc7a100t'];
                var _apprCnt  = clamp(state.thread.count, 1, boardThreadCountLimit(_prof2));
                if (_thr.size !== _apprSize) {
                    shapeFaults.push('committed Thread lump is ' + _thr.size.toLocaleString() +
                        ' words; the approved Thread size is ' + _apprSize.toLocaleString() + ' words');
                }
                if (typeof _thr.count === 'number' && _thr.count !== _apprCnt) {
                    shapeFaults.push('committed image carries ' + _thr.count + ' thread' + (_thr.count === 1 ? '' : 's') +
                        '; the approved design specifies ' + _apprCnt);
                }
                if (!_thr.cr0Word) {
                    shapeFaults.push('Thread CR0 boot-entry capability at +' + (_thr.capsOffset || 244) + ' is a Null GT \u2014 boot cannot dispatch');
                } else {
                    var _cr0 = _decodeGTWord(_thr.cr0Word >>> 0);
                    var _bootMarkerRow = _nsDrill.entries.find(function(row) {
                        return row && row.boot === true;
                    });
                    var _apprBoot = _bootMarkerRow &&
                        Number.isInteger(Number(_bootMarkerRow.slot))
                        ? Number(_bootMarkerRow.slot) : null;
                    if (typeof _thr.bootSlot === 'number' && _cr0.slot !== _thr.bootSlot) {
                        shapeFaults.push('Thread CR0 targets NS slot ' + _cr0.slot +
                            ' but the committed boot-entry sentinel says slot ' + _thr.bootSlot);
                    } else if (_apprBoot !== null && _cr0.slot !== _apprBoot) {
                        shapeFaults.push('Thread CR0 targets NS slot ' + _cr0.slot +
                            '; the selected boot entry is slot ' + _apprBoot);
                    }
                }
            } else if (committed.header && committed.header.kind === 'thread' && committed.header.typ !== 2) {
                shapeFaults.push('word 0 header typ=' + committed.header.typ + ' \u2014 expected a Thread header (typ=10)');
            }
        }
        var rowsHtml = '';
        // Out-of-contract committed slots first — impossible to miss.
        for (var b = 0; b < beyond.length; b++) {
            var be = beyond[b];
            var bf = _nsSlotFaults(be, slots, total);
            faultCount += bf.length ? 1 : 0;
            rowsHtml += _nsDrillRow(be.slot, total * 4 - (be.slot + 1) * V20_NS_ENTRY_BYTES, be, bf);
        }
        for (var s = 0; s < slots; s++) {
            var addrByte = nsTableBaseByte + (slots - 1 - s) * V20_NS_ENTRY_BYTES;
            var ent = bySlot[s] || null;
            var flts = ent ? _nsSlotFaults(ent, slots, total) : [];
            if (ent && flts.length) faultCount++;
            rowsHtml += _nsDrillRow(s, addrByte, ent, flts);
        }
        var totalFaults = faultCount + shapeFaults.length;
        var banner;
        if (_nsDrill.loading || !_nsDrill.loaded) {
            banner = '<div class="le-nsd-banner le-nsd-banner-info">Loading committed NS state\u2026</div>';
        } else if (_nsDrill.errorMsg) {
            banner = '<div class="le-nsd-banner le-nsd-banner-fault">\u26A0 ' + esc(_nsDrill.errorMsg) + '</div>';
        } else if (totalFaults > 0) {
            banner = '<div class="le-nsd-banner le-nsd-banner-fault">\u26A0 ' + totalFaults +
                ' fault' + (totalFaults === 1 ? '' : 's') + ' \u2014 committed namespace data contradicts the approved design' +
                (shapeFaults.length ? '<br>' + shapeFaults.map(esc).join('<br>') : '') + '</div>';
        } else {
            banner = '<div class="le-nsd-banner le-nsd-banner-ok">\u2714 Committed NS state is consistent with the approved design (' +
                Object.keys(bySlot).length + ' occupied / ' + slots + ' slots)</div>';
        }
        return '<div class="le-nsd-panel">' +
            '<div class="le-nsd-toggle-row">' +
                '<button class="le-nsd-toggle-btn" onclick="lumpEditorToggleNSDrill()">' +
                '\u25BE NS Table drill-down \u2014 physical slot layout &amp; committed-state check</button>' +
                '<button class="le-nsd-refresh-btn" onclick="lumpEditorNSDrillRefresh()" title="Re-fetch the committed NS state snapshot">\u21BB refresh</button>' +
            '</div>' +
            '<div class="le-nsd-caption">One 4-word (16-byte) entry per slot \u00b7 descending from slot 0 @ 0x' +
                (nsTableBaseByte + (slots - 1) * V20_NS_ENTRY_BYTES).toString(16).toUpperCase() +
                ' to slot ' + (slots - 1) + ' @ 0x' + nsTableBaseByte.toString(16).toUpperCase() +
                ' \u00b7 tracks the interactive Total-memory / capacity settings \u00b7 read-only</div>' +
            banner +
            '<div class="le-nsd-list">' + rowsHtml + '</div>' +
        '</div>';
    }

    window.lumpEditorToggleNSDrill = function () {
        _nsDrill.open = !_nsDrill.open;
        if (_nsDrill.open) _nsStateLoad(true);
        render();
    };

    window.lumpEditorNSDrillRefresh = function () {
        _nsDrill.loaded = false;
        _nsStateLoad(true);
        render();
    };

    window.lumpEditorNSDrillSlot = function (idx) {
        _nsDrill.expanded[idx] = !_nsDrill.expanded[idx];
        render();
    };

    // ── design reference sections (Thread / Namespace design pages) ──────────

    var _designCache = { thread: null, ns: null };
    var _designRetryTimer = null;

    function renderDesignHero(kind) {
        var title = (kind === 'thread') ? 'Thread Lump \u2014 Design Page' : 'Namespace Lump \u2014 Design Page';
        var blurb = (kind === 'thread')
            ? 'Thread n\u22126 defines total allocation. Header cw/sw is stack words; cc=12 is the capability-home count. Heap runs from +18 to Stack, Stack precedes the twelve tail CR0\u2013CR11 homes, and Threads have no Freespace zone; CR12\u2013CR15 remain privileged/runtime state.'
            : 'The V20 Namespace Lump (NS Slot\u202f0) describes the physical address space with a power-of-two number of sixteen-byte entries (64\u20131024, chosen interactively) at the top of memory. Slot 0 is the highest-address entry; slots descend by 16 bytes toward the table base.';
        return '<div class="le-design-hero">' +
            '<div class="le-design-hero-title">' + esc(title) + '</div>' +
            '<div class="le-design-hero-board">QMTECH Wukong \u00b7 Artix-7 XC7A100T</div>' +
            '<p class="le-design-hero-blurb">' + esc(blurb) + '</p>' +
            (kind === 'thread' ?
                '<button type="button" class="thr-btn" id="btnThreadHeapRecord" ' +
                    'aria-haspopup="dialog" aria-describedby="threadHeapRecordContext" ' +
                    'onclick="openThreadHeapRecord(this)">Thread heap record</button>' +
                '<p class="le-design-hero-blurb" id="threadHeapRecordContext">' +
                    'Uses the active, paused software simulator Thread\u2019s canonical CR5 heap, ' +
                    'not the saved/build design being edited here. Opening is read-only: ' +
                    'it does not prepare a Thread, change targets, reserve or allocate records, ' +
                    'save or build a LUMP, change source, or access hardware.</p>' : '') +
        '</div>';
    }

    function renderDesignSection(kind) {
        if (_designCache[kind]) return _designCache[kind];
        var Cls = (kind === 'thread')
            ? (typeof ThreadTutorial    !== 'undefined' ? ThreadTutorial    : null)
            : (typeof NamespaceTutorial !== 'undefined' ? NamespaceTutorial : null);
        if (!Cls) {
            // tutorial scripts load async — retry once they arrive
            if (!_designRetryTimer) {
                _designRetryTimer = setTimeout(function () {
                    _designRetryTimer = null;
                    render();
                }, 400);
            }
            return '<div class="le-design-ref le-design-loading"><p class="le-panel-desc">Loading design reference\u2026</p></div>';
        }
        var steps;
        try { steps = new Cls().steps || []; } catch (e) { steps = []; }
        var html = '<div class="le-design-ref">' +
            '<div class="le-design-ref-caption">Design reference \u2014 click a section to expand</div>' +
            steps.map(function (s, i) {
                return '<details class="le-design-step"' + (i === 0 ? ' open' : '') + '>' +
                    '<summary class="le-design-step-title">' + s.title + '</summary>' +
                    '<div class="sr-step-content le-design-step-body">' + s.content + '</div>' +
                '</details>';
            }).join('') +
        '</div>';
        _designCache[kind] = html;
        return html;
    }

    // ── top-level render ──────────────────────────────────────────────────────

    // Capture focus/selection and draft UI state that innerHTML would destroy.
    function _captureUi(doc) {
        var a = doc.activeElement, io = doc.getElementById('le-tu-io'), ta = doc.getElementById('le-tu-json');
        var snap = { id: a && a.id ? a.id : null, start: null, end: null,
            ioOpen: io ? !!io.open : null, json: ta ? ta.value : null };
        try { if (a && typeof a.selectionStart === 'number') { snap.start = a.selectionStart; snap.end = a.selectionEnd; } } catch (e) {}
        return snap;
    }
    function _restoreUi(doc, snap) {
        if (!snap) return;
        var io = doc.getElementById('le-tu-io'), ta = doc.getElementById('le-tu-json');
        if (io && snap.ioOpen !== null) io.open = snap.ioOpen;
        if (ta && snap.json !== null && !ta.value) ta.value = snap.json;
        var el = snap.id && doc.getElementById(snap.id);
        if (!el || typeof el.focus !== 'function') return;
        try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
        if (snap.start !== null && typeof el.setSelectionRange === 'function') {
            try {
                var n = String(el.value || '').length;
                el.setSelectionRange(Math.min(snap.start, n), Math.min(snap.end, n));
            } catch (e) {}
        }
    }
    window._lumpEditorUiState = { capture: _captureUi, restore: _restoreUi };

    function render() {
        var tEl = document.getElementById('lumpThreadPanel');
        var nEl = document.getElementById('lumpNSPanel');
        var snap = _captureUi(document);
        if (tEl) tEl.innerHTML =
            renderDesignHero('thread') +
            renderDesignSection('thread') +
            renderThreadSelector() +
            '<div class="le-design-editor-caption">Interactive build settings</div>' +
            renderThreadPanel();
        if (nEl) nEl.innerHTML =
            renderDesignHero('ns') +
            renderDesignSection('ns') +
            '<div class="le-design-editor-caption">Interactive build settings</div>' +
            renderNSPanel();
        _restoreUi(document, snap);
    }

    // ── public handlers ───────────────────────────────────────────────────────

    window.lumpEditorThreadLumpSize = function (exp) {
        var profile  = getBoardProfile();
        var budget   = Math.floor(profile.totalRamWords / 2);
        var count    = clamp(state.thread.count, 1, boardThreadCountLimit(profile));
        var maxWords = Math.min(Math.floor(budget / count), 8192);
        var maxExp   = Math.max(MIN_EXP, Math.min(MAX_EXP, Math.floor(Math.log2(maxWords))));
        state.thread.lumpPow2 = clamp(exp, MIN_EXP, maxExp);
        _threadLumpClampedInfo = null;

        // Patch count slider max in-place so it reacts before the full re-render
        var lumpSize = Math.pow(2, state.thread.lumpPow2);
        var maxCount = Math.min(boardThreadCountLimit(profile), Math.max(1, Math.floor(budget / lumpSize)));
        state.thread.count = clamp(state.thread.count, 1, maxCount);
        var sl  = document.getElementById('le-t-count-sl');
        var num = document.getElementById('le-t-count-num');
        if (sl)  { sl.max  = maxCount; sl.value  = state.thread.count; }
        if (num) { num.max = maxCount; num.value = state.thread.count; }

        saveState();
        render();
    };

    window.lumpEditorThreadCount = function (v) {
        if (_threadDesignKey !== 'legacy') return;
        state.thread.count = clamp(v, 1, boardThreadCountLimit(getBoardProfile()));
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
        var serverMaxNS = (_rl && _rl.limits && _rl.limits.maxNsEntries) || 1024;
        var maxSl = Math.min(Math.pow(2, state.ns.n_minus_6 + 14) / 64, serverMaxNS, NS_CAP_MAX);
        if (state.ns.slots > maxSl) state.ns.slots = snapNSCap(Math.min(state.ns.slots, maxSl));
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
        var serverMaxSlots = (_rl && _rl.limits && _rl.limits.maxNsEntries) || 1024;
        var maxSl = Math.min(Math.pow(2, state.ns.n_minus_6 + 14) / 64, serverMaxSlots, NS_CAP_MAX);
        state.ns.slots = snapNSCap(Math.min(snapNSCap(v), maxSl));
        saveState();
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

    window.lumpEditorRender = function () { render(); };
    window.lumpEditorRenderResidentPanel = function () {
        var panel = document.getElementById('lumpResidentPanel');
        if (panel && panel.offsetParent !== null) renderResidentPanel();
    };

    window.lumpEditorBootEntryChange = _bnObsolete('lumpEditorBootEntryChange');

    window.lumpEditorBootBadgeClick = _bnObsolete('lumpEditorBootBadgeClick');

    window.lumpEditorBootShowAllToggle = _bnObsolete('lumpEditorBootShowAllToggle');

    window.initLumpEditor = function () {
        loadState();
        _nsStateLoad(true);   // refresh committed NS data whenever the design page opens
        render();
    };

    // ── Thread + NS step1 save helpers ────────────────────────────────────────

    window.lumpEditorSaveThread = function () {
        var statusEl = document.getElementById('le-t-step1-status');
        var errEl    = document.getElementById('le-t-step1-err');
        if (_threadDesignKey !== 'legacy') {
            if (errEl) errEl.textContent = 'This Thread design is saved locally only. The shared boot-layout endpoint cannot apply individual Thread layouts. No build changed; select the legacy shared boot layout to review global geometry.';
            return Promise.resolve(false);
        }
        return _postStep1(statusEl, errEl);
    };

    window.lumpEditorPostStep1 = function () {
        var statusEl = document.getElementById('le-ns-step1-status');
        var errEl    = document.getElementById('le-ns-step1-err');
        return _postStep1(statusEl, errEl);
    };

    window.lumpEditorNextStep = function (tab) {
        // Geometry review is an explicit action, never a side effect of
        // browsing. Rejection therefore cannot strand the user on another page.
        if (tab === 'build') {
            var err = _rlValidate();
            if (err) {
                _rl.errorMsg = err;
                renderResidentPanel();
                return;
            }
            lumpEditorRLSave();
        }
        if (typeof switchBuilderViewTab === 'function') {
            switchBuilderViewTab(tab);
        }
    };

    // ── Resident Lumps panel public handlers ──────────────────────────────────

    window.lumpEditorRLEmptySlots = _bnObsolete('lumpEditorRLEmptySlots');


    window.lumpEditorRLSave = _bnObsolete('lumpEditorRLSave');

    window.lumpEditorRLGenerate = _bnObsolete('lumpEditorRLGenerate');

    // ── _computeLumpToken ──────────────────────────────────────────────────
    // Shared helper: given instruction words + capability declarations,
    // builds the canonical LUMP binary (big-endian, zero-padded to next
    // power-of-2 ≥ 64 words) and returns the CRC-32 token string (8 hex
    // digits, no "0x" prefix).  Used by buildLumpFromAssembly, assembleAndLoad,
    // confirmSaveToNamespace, and faultModalOpenBinaryLump so they all derive
    // exactly the same fingerprint from the same content.
    window._computeLumpToken = function (words, caps) {
        caps = caps || [];
        var cw          = words.length;
        var cc          = caps.length;
        var totalNeeded = 1 + cw + cc;
        var lumpSize    = 64;
        while (lumpSize < totalNeeded) lumpSize <<= 1;

        var n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;
        var hdr       = packHdr(n_minus_6, cw, cc, 0);

        var byteLen = lumpSize * 4;
        var buf     = new Uint8Array(byteLen);

        function writeU32BE(offset, val) {
            val = val >>> 0;
            buf[offset]     = (val >>> 24) & 0xFF;
            buf[offset + 1] = (val >>> 16) & 0xFF;
            buf[offset + 2] = (val >>>  8) & 0xFF;
            buf[offset + 3] =  val         & 0xFF;
        }

        writeU32BE(0, hdr);
        for (var i = 0; i < cw; i++) writeU32BE((1 + i) * 4, words[i]);
        // The content token must describe the bytes actually emitted.  Raw
        // candidates carry their already validated GT materialization here;
        // treating their c-list as all-zero would fingerprint a different,
        // capability-stripped artifact.
        for (var ci = 0; ci < cc; ci++) {
            var cap = caps[ci];
            var capToken = cap && typeof cap === 'object' && cap.token !== undefined
                ? Number(cap.token) : 0;
            writeU32BE((1 + cw + ci) * 4,
                Number.isFinite(capToken) ? capToken : 0);
        }

        var crcTable = (function () {
            var t = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[n] = c;
            }
            return t;
        }());
        var crc = 0xFFFFFFFF;
        for (var b = 0; b < buf.length; b++) crc = crcTable[(crc ^ buf[b]) & 0xFF] ^ (crc >>> 8);
        return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toLowerCase().padStart(8, '0');
    };

    function _crc32Bytes(buf) {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1)
                ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c;
        }
        var crc = 0xFFFFFFFF;
        for (var b = 0; b < buf.length; b++) {
            crc = table[(crc ^ buf[b]) & 0xFF] ^ (crc >>> 8);
        }
        return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toLowerCase().padStart(8, '0');
    }

    function _exportCapabilityContext() {
        return {
            sim: (typeof sim !== 'undefined') ? sim : null,
            lumps: (typeof _lumpsCache !== 'undefined' && Array.isArray(_lumpsCache))
                ? _lumpsCache : [],
        };
    }

    // Audit the exact serialized code LUMP, rather than merely trusting the
    // candidate metadata that led to it.  This is deliberately strict: an
    // unresolved/pending/null GT cannot become a downloadable artifact.
    function _auditExportedCodeLump(finalWords, cw, caps) {
        var cc = caps.length;
        var header = finalWords[0] >>> 0;
        var nMinus6 = (header >>> 23) & 0xF;
        var declaredSize = Math.pow(2, nMinus6 + 6);
        if ((header >>> 27) !== 0x1F || ((header >>> 10) & 0x1FFF) !== cw ||
                (header & 0xFF) !== cc || declaredSize !== finalWords.length ||
                1 + cw + cc > finalWords.length) {
            return { ok: false, error: 'Exported LUMP failed structural header/C-list bounds audit.' };
        }
        for (var i = 0; i < cc; i++) {
            var cap = caps[i] || {};
            var expected = cap.null_row === true ? 0 : Number(cap.token);
            if (!Number.isFinite(expected)) {
                return {
                    ok: false,
                    error: 'Capability "' + (cap.name || i) +
                        '" has no materialized Golden Token for export.'
                };
            }
            if ((finalWords[1 + cw + i] >>> 0) !== (expected >>> 0)) {
                return {
                    ok: false,
                    error: 'Capability "' + (cap.name || i) +
                        '" C-list bytes differ from its validated Golden Token.'
                };
            }
        }
        if (cc > 0) {
            if (typeof CapabilityTokens === 'undefined' ||
                    typeof CapabilityTokens.validateClist !== 'function') {
                return { ok: false, error: 'Capability validator is unavailable for export audit.' };
            }
            var capAudit = CapabilityTokens.validateClist(
                finalWords, 1 + cw, caps, _exportCapabilityContext());
            if (!capAudit.ok) {
                return {
                    ok: false,
                    error: 'Exported LUMP C-list audit failed: ' +
                        (capAudit.errors || []).join('; ')
                };
            }
        }
        return { ok: true };
    }

    // ── buildLumpFromAssembly ──────────────────────────────────────────────
    // Packages the most-recently assembled instruction words (lastAssembledWords)
    // into a floating LUMP binary and triggers a browser download.
    //
    // Layout (big-endian 32-bit words):
    //   Word 0       : header — magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
    //   Words 1..cw  : instruction words (from the assembler)
    //   Words cw+1..cw+cc : materialized capability GT c-list
    //   Remaining words   : zero-pad to lump_size
    //
    // cc    — derived from lastAssembledCapabilities.length (0 if none declared).
    //         Every non-NULL c-list row is the exact validated GT carried by
    //         the candidate; cc=0 leaves the ambient boot c-list in use.
    // typ=0 — standard code lump, not a Thread or Namespace header.
    window.buildLumpFromAssembly = async function (candidate) {
        const activeCandidate = candidate || (window.IDEActionState &&
            window.IDEActionState.get().candidate);
        if (activeCandidate && activeCandidate.isaProfile === 'IDX1') {
            const error = window.ChurchIDX1IDE.SAVE_MESSAGE;
            if (typeof appendOutput === 'function') appendOutput(error, 'warn');
            return { ok: false, error };
        }
        // IDEActions passes its immutable candidate explicitly. The legacy
        // no-argument form remains for existing callers that export a loaded
        // assembly buffer.
        if (candidate && Array.isArray(candidate.binary) && candidate.binary.length) {
            // High-level compilation already built and audited this complete
            // immutable artifact (including its source/content frame). Export
            // those exact bytes; rebuilding from execution words would invent
            // a different method-table/c-list layout.
            var _candidateBuf = new Uint8Array(candidate.binary.length * 4);
            var _candidateView = new DataView(_candidateBuf.buffer);
            candidate.binary.forEach(function(word, index) {
                _candidateView.setUint32(index * 4, word >>> 0, false);
            });
            var _candidateToken = _crc32Bytes(_candidateBuf);
            var _candidateFile = await window.LumpContentFrame.lumpPackFile(_candidateBuf);
            var _candidateUrl = URL.createObjectURL(new Blob(
                [_candidateFile], { type: 'application/octet-stream' }));
            var _candidateLink = document.createElement('a');
            _candidateLink.href = _candidateUrl;
            _candidateLink.download = _candidateToken + '.lump';
            document.body.appendChild(_candidateLink);
            _candidateLink.click();
            document.body.removeChild(_candidateLink);
            URL.revokeObjectURL(_candidateUrl);
            if (typeof appendCompileOutput === 'function') {
                appendCompileOutput('LUMP exported from the exact build candidate: ' +
                    _candidateLink.download, 'info');
            }
            return { ok: true, token: _candidateToken };
        }
        var words = candidate && Array.isArray(candidate.words)
            ? candidate.words.slice()
            : ((typeof lastAssembledWords !== 'undefined') ? lastAssembledWords : null);
        if (!words || !words.length) {
            const error = 'Nothing assembled yet — compile your assembly program first.';
            alert(error);
            return { ok: false, error: error };
        }

        // Raw candidates contain the GT materialization that capability
        // validation approved at build time.  Preserve those exact values in
        // the portable c-list; never replace non-NULL declarations with zero.
        var caps = candidate && Array.isArray(candidate.capabilities)
            ? candidate.capabilities.slice()
            : ((typeof lastAssembledCapabilities !== 'undefined' &&
                    lastAssembledCapabilities) ? lastAssembledCapabilities : []);
        var cw          = words.length;
        var cc          = caps.length;
        var totalNeeded = 1 + cw + cc;
        var lumpSize    = 64;
        while (lumpSize < totalNeeded) lumpSize <<= 1;

        var n_minus_6 = Math.round(Math.log2(lumpSize)) - 6;
        var hdr       = packHdr(n_minus_6, cw, cc, 0);

        // Build big-endian byte array
        var byteLen = lumpSize * 4;
        var buf     = new Uint8Array(byteLen);

        function writeU32BE(offset, val) {
            val = val >>> 0;
            buf[offset]     = (val >>> 24) & 0xFF;
            buf[offset + 1] = (val >>> 16) & 0xFF;
            buf[offset + 2] = (val >>>  8) & 0xFF;
            buf[offset + 3] =  val         & 0xFF;
        }

        writeU32BE(0, hdr);
        for (var i = 0; i < cw; i++) writeU32BE((1 + i) * 4, words[i]);
        for (var capIndex = 0; capIndex < cc; capIndex++) {
            var declaredCap = caps[capIndex] || {};
            var declaredToken = declaredCap.null_row === true ? 0
                : Number(declaredCap.token);
            if (!Number.isFinite(declaredToken)) {
                var noTokenError = 'Capability "' + (declaredCap.name || capIndex) +
                    '" has no materialized Golden Token for export.';
                alert(noTokenError);
                return { ok: false, error: noTokenError };
            }
            writeU32BE((1 + cw + capIndex) * 4, declaredToken);
        }

        // Decode the final bytes and audit that representation, ensuring the
        // header, c-list placement, and GT words match the downloaded payload.
        var finalWords = new Array(lumpSize);
        var finalView = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (var wordIndex = 0; wordIndex < lumpSize; wordIndex++) {
            finalWords[wordIndex] = finalView.getUint32(wordIndex * 4, false);
        }
        var exportAudit = _auditExportedCodeLump(finalWords, cw, caps);
        if (!exportAudit.ok) {
            alert(exportAudit.error);
            return { ok: false, error: exportAudit.error };
        }

        var token = _crc32Bytes(buf);

        var filename = token + '.lump';
        var packedFile = await window.LumpContentFrame.lumpPackFile(buf);
        var blob     = new Blob([packedFile], { type: 'application/octet-stream' });
        var url      = URL.createObjectURL(blob);
        var a        = document.createElement('a');
        a.href       = url;
        a.download   = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Brief console confirmation
        if (typeof appendCompileOutput === 'function') {
            var _capNames = caps.map(function(c){ return c.name; }).join(', ');
            appendCompileOutput(
                'LUMP exported: ' + filename +
                '  (cw=' + cw + ' cc=' + cc + (cc > 0 ? ' [' + _capNames + ']' : '') + ' lump_size=' + lumpSize + ')',
                'info'
            );
        }
        return { ok: true, token: token };
    };

    window.lumpEditorRLUpload = _bnObsolete('lumpEditorRLUpload');

    window.lumpEditorRLHandleUpload = _bnObsolete('lumpEditorRLHandleUpload');

    // Retained pure helper (no I/O); used only by legacy-format tests.
    function _rlBuildStep2Lumps(step2State) {
        var step2Lumps = [];
        for (var slotStr in step2State) {
            var slot = parseInt(slotStr, 10);
            if (_isFixedBootStep2Slot(slot)) continue;
            var st = step2State[slotStr];
            var row = {
                nsSlot: slot,
                loadPolicy: ['Empty', 'Resident', 'Preload', 'Lazy'].indexOf(st.loadPolicy) >= 0
                    ? st.loadPolicy : 'Lazy',
                abstraction: st.abstraction,
                lumpToken: st.lumpToken
            };
            if (row.loadPolicy === 'Resident') {
                row.physAddr = st.physAddr;
                if (st.lumpSize) row.lumpSize = st.lumpSize;
            } else if (row.loadPolicy === 'Preload') {
                // Catalog-derived bridge bindings, never programmer inputs.
                if (st.lumpSize) row.lumpSize = st.lumpSize;
                if (st.binaryHash) row.binaryHash = st.binaryHash;
                if (st.identityHash) row.identityHash = st.identityHash;
            }
            step2Lumps.push(row);
        }
        return step2Lumps;
    }

    window.initResidentPanel = function () {
        loadState();
        _bnLoad();
    };

    window.lumpEditorBuiltNamespaceRefresh = function () { return _bnLoad(); };
    // Local-only view state: no requests or writes.
    window.lumpEditorBnTab = function (k) {
        var key = k === 'ns' ? 'ns' : Number(k);
        if (key !== 'ns' && !_bnThreads().some(function (t) { return t.slot === key; })) key = 'ns';
        _bn.tab = key;
        renderResidentPanel();
        var b = document.getElementById(_bnTabId(key));
        if (b && typeof b.focus === 'function') b.focus({ preventScroll: true });
    };
    window.lumpEditorBnTabKey = function (ev) {
        var keys = ['ns'].concat(_bnThreads().map(function (t) { return t.slot; }));
        var i = keys.indexOf(_bn.tab), n = keys.length, j;
        if (ev.key === 'ArrowRight') j = (i + 1) % n;
        else if (ev.key === 'ArrowLeft') j = (i - 1 + n) % n;
        else if (ev.key === 'Home') j = 0;
        else if (ev.key === 'End') j = n - 1;
        else return;
        if (ev.preventDefault) ev.preventDefault();
        window.lumpEditorBnTab(String(keys[j]));
    };
    window.lumpEditorBnHeapPage = function (slot, d) {
        _bn.heapPage[slot] = Math.max(0, (_bn.heapPage[slot] || 0) + d);
        renderResidentPanel();
        var p = document.getElementById(_bnPanelId(slot));
        var det = p && p.querySelector ? p.querySelector('.le-bn-heap') : null;
        if (det) det.open = true;
        _bnRestoreScroll();
    };

    window.addEventListener('storage', function (ev) {
        if (ev.key === 'fpga_board_target') {
            clampThreadStateToBoard();
            clampNSStateToBoard();
            render();
        }
    });

}());
