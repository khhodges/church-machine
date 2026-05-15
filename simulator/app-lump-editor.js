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
        { label: '64 K words  (Ti60 F225, n=2)',    n: 2  },
        { label: '128 K words (Tang Nano 20K, n=3)',n: 3  },
        { label: '256 K words (n=4)',               n: 4  },
        { label: '512 K words (XC7A100T, n=5)',     n: 5  },
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

    var state = {
        activeType: 'thread',
        thread: { heap: 256, stack: 32, count: 1 },
        ns: { n_minus_6: 3, slots: 2000 }
    };

    function loadState() {
        try {
            var s = JSON.parse(localStorage.getItem('lump_editor_state') || '{}');
            if (s.activeType) state.activeType = s.activeType;
            if (s.thread) {
                state.thread.heap  = s.thread.heap  || 256;
                state.thread.stack = s.thread.stack || 32;
                state.thread.count = (s.thread.count !== undefined) ? clamp(s.thread.count, 1, 10) : 1;
            }
            if (s.ns) { state.ns.n_minus_6 = (s.ns.n_minus_6 !== undefined) ? s.ns.n_minus_6 : 3; state.ns.slots = s.ns.slots || 2000; }
        } catch (e) {}
    }

    function saveState() {
        try { localStorage.setItem('lump_editor_state', JSON.stringify(state)); } catch (e) {}
    }

    // ── memory bar ────────────────────────────────────────────────────────────

    function renderBar(zones) {
        var total = zones.reduce(function (s, z) { return s + z.words; }, 0);
        if (total <= 0) return '';
        return '<div class="le-bar">' + zones.map(function (z) {
            if (z.words <= 0) return '';
            var pct = (z.words / total * 100).toFixed(2);
            return '<div class="le-bar-zone ' + esc(z.cls) + '" style="flex:' + z.words + '" title="' + esc(z.label + ': ' + z.words.toLocaleString() + ' words') + '">' +
                   '<span class="le-bar-label">' + esc(z.label) + '</span>' +
                   '<span class="le-bar-pct">' + esc(pct + '%') + '</span></div>';
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

    // ── Thread panel ──────────────────────────────────────────────────────────

    function renderThreadPanel() {
        var heap  = clamp(state.thread.heap,  1, 8191);
        var stack = clamp(state.thread.stack, 1, 255);
        var count = clamp(state.thread.count, 1, 10);
        var needed    = 1 + heap + stack;
        var lumpSize  = nextPow2(needed);
        var n         = log2Exact(lumpSize) - 6;
        var free      = lumpSize - 1 - heap - stack;
        var totalMem  = lumpSize * count;
        var word      = packHdr(n, heap, stack, 2);
        var wordHex   = hex8(word);

        var grid = renderGrid([
            ['Lump size',      esc(fmtWords(lumpSize) + ' words  (2^' + (n + 6) + ')'), 'le-val-gold'],
            ['Thread count',   esc(String(count)), ''],
            ['Total memory',   esc(fmtWords(totalMem) + ' words  (' + count + ' × ' + fmtWords(lumpSize) + ')'), 'le-val-gold'],
            ['n_minus_6',      esc(String(n)), ''],
            ['typ field',      '10  (Thread)', ''],
            ['Heap (cw)',      esc(heap.toLocaleString() + ' words'), ''],
            ['Freespace',      esc(free.toLocaleString() + ' words'), ''],
            ['Stack (cc)',     esc(stack.toLocaleString() + ' frames'), ''],
            ['Header word',    '<span id="le-thread-hex" class="le-hex">' + esc(wordHex) + '</span>' + copyBtn('le-thread-hex'), 'le-val-mono']
        ]);

        var bar = renderBar([
            { label: 'Header', words: 1,    cls: 'le-zone-hdr'   },
            { label: 'Heap',   words: heap,  cls: 'le-zone-heap'  },
            { label: 'Free',   words: free,  cls: 'le-zone-free'  },
            { label: 'Stack',  words: stack, cls: 'le-zone-stack' }
        ]);

        return '<div class="le-panel">' +
            '<p class="le-panel-desc">Set heap and stack sizes. Lump allocation rounds up to the next power of two.</p>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Thread count<span class="le-range-hint"> 1 – 10</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-count-sl"  min="1" max="10" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-count-num" min="1" max="10" value="' + count + '" oninput="lumpEditorThreadCount(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Heap words<span class="le-range-hint"> 1 – 8,191</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-heap-sl"  min="1" max="8191" value="' + heap  + '" oninput="lumpEditorThreadHeap(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-heap-num" min="1" max="8191" value="' + heap  + '" oninput="lumpEditorThreadHeap(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-field-row">' +
                '<label class="le-label">Stack frames<span class="le-range-hint"> 1 – 255</span></label>' +
                '<div class="le-input-group">' +
                    '<input type="range"  class="le-slider" id="le-t-stack-sl"  min="1" max="255" value="' + stack + '" oninput="lumpEditorThreadStack(this.value)">' +
                    '<input type="number" class="le-number" id="le-t-stack-num" min="1" max="255" value="' + stack + '" oninput="lumpEditorThreadStack(this.value)">' +
                '</div>' +
            '</div>' +
            '<div class="le-divider"></div>' +
            grid +
            '<div class="le-divider"></div>' +
            '<div class="le-bar-label-row"><span>Single thread memory layout</span></div>' +
            bar +
        '</div>';
    }

    // ── Namespace panel ───────────────────────────────────────────────────────

    function renderNSPanel() {
        var n      = clamp(state.ns.n_minus_6, 0, 15);
        var total  = Math.pow(2, n + 14);
        var maxSl  = total / 64;
        var slots  = clamp(state.ns.slots, 1, maxSl);
        var nsWords = slots * 4;
        var FOUND   = 384;
        var pool    = total - nsWords - FOUND;
        var cw      = (slots >>> 8) & 0x1FFF;
        var cc      =  slots & 0xFF;
        var word    = packHdr(n, cw, cc, 1);
        var wordHex = hex8(word);

        var presetOpts = NS_PRESETS.map(function (p) {
            return '<option value="' + p.n + '"' + (p.n === n ? ' selected' : '') + '>' + esc(p.label) + '</option>';
        }).join('');

        var grid = renderGrid([
            ['Total words',    esc(total.toLocaleString() + '  (2^' + (n + 14) + ')'), 'le-val-gold'],
            ['n_minus_6',     esc(String(n)), ''],
            ['typ field',     '01  (Namespace, reserved)', ''],
            ['Max slots',      esc(maxSl.toLocaleString() + '  (total ÷ 64)'), ''],
            ['NS table',       esc(nsWords.toLocaleString() + ' words  (slots × 4)'), ''],
            ['Foundation',     esc(FOUND + ' words (est.)'), ''],
            ['Pool available', pool >= 0 ? esc(pool.toLocaleString() + ' words') : '<span class="le-overflow">overflow</span>', ''],
            ['cw field',       esc(String(cw) + '  (slots >> 8)'), ''],
            ['cc field',       esc(String(cc) + '  (slots & 0xFF)'), ''],
            ['Header word',    '<span id="le-ns-hex" class="le-hex">' + esc(wordHex) + '</span>' + copyBtn('le-ns-hex'), 'le-val-mono']
        ]);

        var bar = renderBar([
            { label: 'Foundation', words: FOUND,              cls: 'le-zone-hdr'   },
            { label: 'NS Table',   words: nsWords,             cls: 'le-zone-heap'  },
            { label: 'Pool',       words: Math.max(pool, 0),  cls: 'le-zone-free'  }
        ]);

        return '<div class="le-panel">' +
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
            '<div class="le-divider"></div>' +
            grid +
            '<div class="le-divider"></div>' +
            '<div class="le-bar-label-row"><span>Memory layout</span></div>' +
            bar +
        '</div>';
    }

    // ── top-level render ──────────────────────────────────────────────────────

    function render() {
        var el = document.getElementById('lumpEditorPanel');
        if (!el) return;
        var isThread = (state.activeType === 'thread');
        el.innerHTML =
            '<div class="le-type-tab-row">' +
                '<button class="le-type-tab' + (isThread ? ' active' : '') + '" onclick="lumpEditorSetType(\'thread\')">Thread LUMP</button>' +
                '<button class="le-type-tab' + (!isThread ? ' active' : '') + '" onclick="lumpEditorSetType(\'namespace\')">Namespace LUMP</button>' +
            '</div>' +
            (isThread ? renderThreadPanel() : renderNSPanel());
    }

    // ── public handlers ───────────────────────────────────────────────────────

    window.lumpEditorSetType = function (t) {
        state.activeType = t;
        saveState();
        render();
    };

    window.lumpEditorThreadCount = function (v) {
        state.thread.count = clamp(v, 1, 10);
        saveState();
        var sl  = document.getElementById('le-t-count-sl');
        var num = document.getElementById('le-t-count-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.thread.count;
        if (num && num !== document.activeElement) num.value = state.thread.count;
        render();
    };

    window.lumpEditorThreadHeap = function (v) {
        state.thread.heap = clamp(v, 1, 8191);
        saveState();
        var sl  = document.getElementById('le-t-heap-sl');
        var num = document.getElementById('le-t-heap-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.thread.heap;
        if (num && num !== document.activeElement) num.value = state.thread.heap;
        render();
    };

    window.lumpEditorThreadStack = function (v) {
        state.thread.stack = clamp(v, 1, 255);
        saveState();
        var sl  = document.getElementById('le-t-stack-sl');
        var num = document.getElementById('le-t-stack-num');
        if (sl  && sl  !== document.activeElement) sl.value  = state.thread.stack;
        if (num && num !== document.activeElement) num.value = state.thread.stack;
        render();
    };

    window.lumpEditorNSSize = function (v) {
        state.ns.n_minus_6 = clamp(v, 0, 15);
        var maxSl = Math.pow(2, state.ns.n_minus_6 + 14) / 64;
        if (state.ns.slots > maxSl) state.ns.slots = maxSl;
        saveState();
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

    window.initLumpEditor = function () {
        loadState();
        render();
    };

}());
