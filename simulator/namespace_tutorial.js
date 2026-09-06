class NamespaceTutorial {
    constructor() {
        this.currentStep = -1;
        this.TOTAL_WORDS    = 32768;
        this.SLOT_SIZE      = 64;   // 64 words per slot — hardware minimum (Task #1205)
        this.NS_ENTRY_WORDS = 4;
        // Zone 1 — Bootstrap: NS root (slot 0) + boot thread (slot 1)
        // First abstraction is loaded from Thread.CR0 — set via ⚡ in the Namespace table.
        // Slots 2–5 are MMIO device-register windows (UART, LED, BTN, TIMER — NS entries point at physical hardware addresses).
        this.BOOTSTRAP_SLOTS = 2;
        this.BOOTSTRAP_WORDS = this.BOOTSTRAP_SLOTS * this.SLOT_SIZE;   // 2 × 64 = 128
        // Zone 2 — Resident: always-loaded IDE abstractions (IDE-set count)
        this.RESIDENT_SLOTS  = 10;
        this.RESIDENT_WORDS  = this.RESIDENT_SLOTS  * this.SLOT_SIZE;   // 640
        // Zone 4 — V20 NS Table: 64 entries at the architectural top of
        // memory. Simulator addresses are words; ISA addresses are bytes.
        this.NS_TABLE_BASE   = 0x7F00;  // word address; byte address 0x1FC00
        this.NS_TABLE_BASE_BYTE = 0x1FC00;
        this.NS_ENTRY_BYTES  = 16;
        this.NS_ENTRY_WORDS  = 4;
        this.NS_SLOT_CAPACITY = (this.TOTAL_WORDS - this.NS_TABLE_BASE) / this.NS_ENTRY_WORDS;
        this.NS_CW           = (this.NS_SLOT_CAPACITY >> 8) & 0x1FFF;
        this.NS_CC           = this.NS_SLOT_CAPACITY & 0xFF;
        this.steps = this._buildSteps();
    }

    _hex(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }

    _headerRef() {
        const fields = [
            { bits: '[31:27]', name: 'magic',  val: '0x1F', note: 'Header sentinel: parser and loader accept this word as a LUMP header; instruction fetch must not execute it', w: 5,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[26:23]', name: 'n\u22126', val: '1',     note: 'Power-of-two allocation exponent: lumpSize = 2^(n\u22126+6) = 128 words (512 bytes) for this example', w: 4,  bg: '#3a2000', border: '#c86000', text: '#f09040' },
            { bits: '[22:10]', name: 'cw',     val: String(this.NS_CW), note: `Namespace slot-capacity high bits: slotCapacity = (cw<<8)|cc; ${this.NS_SLOT_CAPACITY} slots \u2192 cw=${this.NS_CW}`, w: 13, bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { bits: '[9:8]',   name: 'typ',    val: '01',    note: 'Namespace/data layout: the root describes memory and NS entries; it is not an executable code LUMP',   w: 2,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[7:0]',   name: 'cc',     val: String(this.NS_CC), note: `Namespace slot-capacity low bits: cc=${this.NS_CC}; together with cw this reserves ${this.NS_SLOT_CAPACITY} four-word NS entries (not a live-entry count)`, w: 8, bg: '#1a1000', border: '#b07820', text: '#f0c050' },
        ];
        let bar = '<div style="display:flex;width:100%;border-radius:3px;overflow:hidden;margin-bottom:2px;">';
        for (const f of fields) {
            bar += `<div style="flex:${f.w};background:${f.bg};border:1px solid ${f.border};padding:2px 3px;text-align:center;overflow:hidden;min-width:0;" title="${f.bits} ${f.name}=${f.val} \u2014 ${f.note}">`;
            bar += `<span style="color:${f.text};font-size:0.62rem;font-weight:700;font-family:monospace;white-space:nowrap;">${f.name}</span><br>`;
            bar += `<span style="color:${f.text};font-size:0.58rem;font-family:monospace;opacity:0.8;">${f.val}</span>`;
            bar += '</div>';
        }
        bar += '</div>';
        let meta = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">';
        for (const f of fields) {
            meta += `<span style="font-size:0.65rem;font-family:monospace;color:#777;">`
                  + `<span style="color:${f.text}">${f.bits}&nbsp;${f.name}=${f.val}</span>`
                  + `&nbsp;\u00b7&nbsp;${f.note}</span>`;
        }
        meta += '</div>';
        return `<div style="background:#111;border:1px solid #333;border-radius:4px;padding:6px 8px 4px 8px;margin-bottom:8px;">`
             + `<div style="font-size:0.62rem;color:#555;font-family:monospace;margin-bottom:4px;">Header[0] \u2014 Namespace Lump \u00b7 Slot\u202f0 (typ=01) \u00b7 32 bits</div>`
             + bar + meta + `</div>`;
    }

    _memMap(highlighted) {
        const h  = this._hex.bind(this);
        const B  = this.BOOTSTRAP_WORDS;
        const R  = this.RESIDENT_WORDS;
        const NS = this.NS_TABLE_BASE;
        const freespaceEnd = NS - 1;

        const capacity = this.NS_SLOT_CAPACITY;
        const sections = [
            {
                id: 'bootstrap',
                label: '\u2460 Bootstrap',
                sub: `0x0000 \u00b7 design-fixed \u00b7 ${this.BOOTSTRAP_SLOTS} slots (NS root \u00b7 Boot Thread) \u00b7 \u2026 ${h(B-1)}`,
                bg: '#1a0030', border: '#8040c0', text: '#b080f0'
            },
            {
                id: 'resident',
                label: '\u2461 Resident Lumps',
                sub: `${h(B)} \u00b7 IDE-set \u00b7 ${this.RESIDENT_SLOTS} always-loaded slots \u00b7 \u2026 ${h(B+R-1)}`,
                bg: '#001830', border: '#2070b0', text: '#70b8ff'
            },
            {
                id: 'freespace',
                label: '\u2462 Freespace \u2195',
                sub: `${h(B+R)} \u00b7 IDE-set \u00b7 cache for lazy-loaded lumps \u00b7 \u2026 ${h(freespaceEnd)}`,
                bg: '#0a0a0a', border: '#303030', text: '#555'
            },
            {
                id: 'nstable',
                label: '\u2463 NS Table \u2191',
                sub: `${capacity} slots \u00d7 ${this.NS_ENTRY_WORDS} words = ${capacity * this.NS_ENTRY_WORDS} words \u00b7 ${h(NS)} \u2026 0xFFFF`,
                bg: '#1a1000', border: '#b07820', text: '#f0c050'
            },
        ];
        const heights = { bootstrap: 58, resident: 66, freespace: 72, nstable: 58 };
        const addrLabels = {
            bootstrap: `0x0000`,
            resident:  `${h(B)}`,
            freespace: `${h(B+R)} \u2195`,
            nstable:   `${h(this.TOTAL_WORDS - 1)} \u2191`,
        };

        let html = '<div style="display:flex;gap:8px;margin:12px 0 4px 0;align-items:stretch;">';
        html += '<div style="display:flex;flex-direction:column;justify-content:flex-start;width:88px;flex-shrink:0;font-size:0.68rem;color:#666;font-family:monospace;">';
        for (const s of sections) {
            html += `<div style="height:${heights[s.id]}px;display:flex;align-items:flex-start;padding-top:6px;justify-content:flex-end;padding-right:4px;box-sizing:border-box;white-space:nowrap;">${addrLabels[s.id]}</div>`;
        }
        html += '</div>';
        html += '<div style="flex:1;display:flex;flex-direction:column;">';
        for (const s of sections) {
            const isHL = s.id === highlighted || (highlighted === 'lumps' && s.id !== 'nstable');
            const outline = isHL ? `3px solid ${s.border}` : `1px solid ${s.border}`;
            const opacity = (!highlighted || isHL) ? '1' : '0.38';
            const shadow  = isHL ? `0 0 16px ${s.border}44` : 'none';
            html += `<div style="height:${heights[s.id]}px;background:${s.bg};border:${outline};box-shadow:${shadow};opacity:${opacity};padding:6px 10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;transition:opacity 0.2s;">`;
            html += `<span style="color:${s.text};font-weight:700;font-size:0.85rem;">${s.label}</span>`;
            html += `<span style="color:${s.id === 'freespace' ? '#444' : '#aaa'};font-size:0.75rem;margin-top:2px;">${s.sub}</span>`;
            html += '</div>';
            if (s.id !== 'nstable') html += '<div style="height:2px;background:#111;"></div>';
        }
        html += '</div></div>';
        return this._headerRef() + html;
    }

    _buildSteps() {
        const hex = this._hex.bind(this);
        const NS = hex(this.NS_TABLE_BASE);
        const END = hex(this.TOTAL_WORDS - 1);
        const SLOT = this.SLOT_SIZE;

        return [
            {
                title: 'What Is the Namespace Abstraction?',
                type: 'intro',
                content: `<p>The <strong>Namespace Abstraction</strong> is the Church Machine\u2019s description of its own physical memory. It is not a computation \u2014 it is the container that holds all computations. Every abstraction, every thread, every capability lives inside the namespace.</p>
${this._memMap(null)}
<div class="sr-key-concept"><div class="sr-concept-title">Four Zones, One Namespace</div>
<p>The ${hex(this.TOTAL_WORDS)}-word physical address space is divided into four IDE-set zones, top to bottom:</p>
<table class="sr-table" style="margin-top:4px;">
<tr><th>Zone</th><th>Start</th><th>Size</th><th>Purpose</th></tr>
<tr><td><strong>\u2460 Bootstrap</strong></td><td><code>0x0000</code> \u2191</td><td>IDE-set</td><td>NS root (Slot\u202f0) \u00b7 Boot Thread (Slot\u202f1) \u2014 First Abstraction loaded from Thread.CR0 (set via \u26a1 in NS table)</td></tr>
<tr><td><strong>\u2461 Resident Lumps</strong></td><td>${hex(this.BOOTSTRAP_WORDS)} \u2191</td><td>IDE-set</td><td>Always-loaded abstractions \u2014 never evicted</td></tr>
<tr><td><strong>\u2462 Freespace</strong></td><td>${hex(this.BOOTSTRAP_WORDS + this.RESIDENT_WORDS)} \u2195</td><td>IDE-set</td><td>Cache for lazy-loaded lumps \u2014 dynamic, grows from both ends</td></tr>
<tr><td><strong>\u2463 NS Table</strong></td><td>${hex(this.NS_TABLE_BASE)} \u2191</td><td>${this.NS_SLOT_CAPACITY * this.NS_ENTRY_WORDS} words</td><td>${this.NS_SLOT_CAPACITY} four-word metadata entries \u2014 slot\u202f0 is the highest-address entry; each following slot descends by 16 bytes</td></tr>
</table></div>`
            },
            {
                title: 'Header[0] \u2014 Namespace Lump Bit Fields',
                type: 'header',
                content: `${this._headerRef()}
<p>Word 0 of every lump is a <strong>32-bit header word</strong>. For the Namespace root (Slot\u202f0), the common header fields describe the root allocation and data layout, while <code style="color:#60b8f0">cw</code>/<code style="color:#f0c050">cc</code> are Namespace-specific: together they encode the configured maximum number of Namespace slots. They do <em>not</em> mean executable code words and c-list entries in this header. Hover any field box above to read its bit range and actual use.</p>
<table class="sr-table">
<tr><th>Field</th><th>Bits</th><th>Width</th><th>NS Slot\u202f0 value</th><th>Meaning</th></tr>
<tr><td><code style="color:#888">magic</code></td><td>[31:27]</td><td>5&nbsp;b</td><td><code>0x1F</code></td><td>Header sentinel used by the parser/loader to recognize a valid LUMP header; it is not executable payload</td></tr>
<tr><td><code style="color:#f09040">n\u22126</code></td><td>[26:23]</td><td>4&nbsp;b</td><td><code>1</code></td><td><code>lumpSize = 2^(n\u22126+6)</code> = 128 words / 512 bytes in this worked header</td></tr>
<tr><td><code style="color:#60b8f0">cw</code></td><td>[22:10]</td><td>13&nbsp;b</td><td><code>${this.NS_CW}</code></td><td><strong>High bits of Namespace slot capacity</strong>: the loader combines it with <code>cc</code> as <code>(cw&lt;&lt;8)|cc</code>; this is <code>${this.NS_SLOT_CAPACITY}</code> slots, not code-word count</td></tr>
<tr><td><code style="color:#888">typ</code></td><td>[9:8]</td><td>2&nbsp;b</td><td><code>01</code></td><td>Identifies the Namespace root as a data/Namespace layout, not an executable code LUMP</td></tr>
<tr><td><code style="color:#f0c050">cc</code></td><td>[7:0]</td><td>8&nbsp;b</td><td><code>${this.NS_CC}</code></td><td><strong>Low bits of Namespace slot capacity</strong>: completes <code>(cw&lt;&lt;8)|cc</code>; it sizes the reserved four-word-per-slot NS table. Live occupancy is tracked separately.</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Address Space Layout \u2014 Four Zones</div>
<p>The namespace divides physical memory into four IDE-set zones. Lump zones grow <strong>upward \u2191</strong> from <code>0x0000</code>; the V20 NS Table occupies the top-of-memory byte range <code>0x1FC00\u20130x1FFFF</code>. The combined Namespace capacity is <code>(cw&lt;&lt;8)|cc</code> slots, with ${this.NS_ENTRY_WORDS} words per entry; slot 0 is the highest-address entry and later slots descend by 16 bytes.</p>
<table class="sr-table" style="margin:6px 0;"><tr><th>Zone</th><th>Base</th><th>Top</th><th>Size</th></tr>
<tr><td>\u2460 Bootstrap</td><td><code>0x0000</code></td><td>below <code>${hex(this.NS_TABLE_BASE)}</code></td><td>IDE-set (boot slots)</td></tr>
<tr><td>\u2461 Resident Lumps</td><td>Bootstrap end + 1</td><td>Resident end</td><td>IDE-set (always-loaded)</td></tr>
<tr><td>\u2462 Freespace</td><td>Resident end + 1</td><td>below <code>${hex(this.NS_TABLE_BASE)}</code></td><td>IDE-set (lazy-load cache)</td></tr>
<tr><td>\u2463 NS Table</td><td><code>${hex(this.NS_TABLE_BASE)}</code></td><td><code>${hex(this.TOTAL_WORDS - 1)}</code></td><td>${this.NS_SLOT_CAPACITY} entries \u00d7 ${this.NS_ENTRY_WORDS} words</td></tr>
</table>
<p>The V20 NS Table begins at byte address <code>0x1FC00</code> (word address <code>0x7F00</code>) and ends at <code>0x1FFFF</code>. Each entry is 16 bytes: slot 0 begins at <code>0x1FFC0</code>, while slot 63 begins at <code>0x1FC00</code>.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Encoding Formula</div>
<p><code>(0x1F &lt;&lt; 27) | (n_minus_6 &lt;&lt; 23) | (cw &lt;&lt; 10) | (0b01 &lt;&lt; 8) | cc</code></p>
<p>Example \u2014 65536-word namespace with 1024 slots (cw=4, cc=0, n\u22126=10):</p>
<p><code style="color:#f0c050;font-size:1rem;">0xFD00_1100</code>&nbsp;&nbsp;(magic=0x1F, n\u22126=10, cw=4, typ=01, cc=0 \u2192 capacity (4&lt;&lt;8)|0 = 1024 slots)</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Three Lump Types \u2014 Same Header, Different Field Semantics</div>
<p>All three lump types share the same 32-bit header format. The hardware uses <code>typ</code> to decide which interpretation applies:</p>
<table class="sr-table" style="margin-top:6px;"><tr><th>Field</th><th>Programmed (typ=00)</th><th>Thread (typ=10)</th><th>Namespace (typ=01)</th></tr>
<tr><td><code>cw</code></td><td>Code word count</td><td>Stack words (sw)</td><td>Slot capacity high bits (slots &gt;&gt; 8)</td></tr>
<tr><td><code>cc</code></td><td>C-list GT count</td><td>Heap size (max N words)</td><td>Slot capacity low byte (slots &amp; 0xFF)</td></tr>
</table></div>`,
            },
            {
                title: '\u2460\u2461\u2462 Lump Zones \u2014 Bootstrap, Resident, Freespace',
                type: 'lumps',
                content: `${this._memMap('lumps')}
<p>The three lump zones each serve a distinct purpose. All sizes are <strong>IDE-set</strong>; every slot is ${SLOT} words (one abstraction or thread per slot). The hardware locates any lump from its NS entry\u2019s <code>word0_location</code> = slot\u202f\u00d7\u202f${SLOT}.</p>
<table class="sr-table">
<tr><th>Zone</th><th>Slots</th><th>Base</th><th>Purpose</th></tr>
<tr><td><strong>\u2460 Bootstrap</strong></td><td>0\u20131 (fixed)</td><td><code>0x0000</code></td><td>NS root (Slot\u202f0), Boot Thread (Slot\u202f1) \u2014 First Abstraction loaded from Thread.CR0 (set via \u26a1 in NS table)</td></tr>
<tr><td><strong>\u2461 Resident Lumps</strong></td><td>2\u2026${1 + this.RESIDENT_SLOTS} (IDE)</td><td>${hex(this.BOOTSTRAP_WORDS)}</td><td>Always-loaded abstractions: installed at boot, <em>never</em> evicted from namespace memory</td></tr>
<tr><td><strong>\u2462 Freespace</strong></td><td>${2 + this.RESIDENT_SLOTS}\u2026 (IDE)</td><td>${hex(this.BOOTSTRAP_WORDS + this.RESIDENT_WORDS)}</td><td>Cache pool for lazy-loaded lumps: allocated on first CALL, evicted when memory pressure demands</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Lazy Loading via Freespace</div>
<p>When the hardware raises <code>FaultType.ABSENT_OUTFORM</code> (0x11) on a CALL to an unloaded abstraction, the SW trap handler downloads and deflates the lump into a free slot in Zone\u202f\u2462. The slot remains warm for subsequent calls. If freespace runs out, the IDE evicts the least-recently-used cached lump before loading the new one. Bootstrap and Resident zones are <em>never</em> eligible for eviction.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Slot Index = Lump Address \u00f7 ${SLOT}</div>
<p>For every slot except Slot\u202f0, <code>word0_location\u202f=\u202fidx\u202f\u00d7\u202f${SLOT}</code>. The hardware computes any lump base from the slot index alone without reading memory. Slot\u202f0 is the exception \u2014 its \u201clump\u201d is the full physical address space.</p></div>`
            },
            {
                title: 'NS Slot 0 \u2014 The Namespace Root',
                type: 'slot0',
                content: `${this._memMap(null)}
<p>NS Slot\u202f0 is the <strong>Namespace Root</strong>. Unlike all other slots it does not describe a single abstraction\u2019s lump. Instead it describes the <em>entire physical address space</em> and encodes the NS Table size in its metadata.</p>
<table class="sr-table"><tr><th>NS Slot 0 field</th><th>Value</th><th>Meaning</th></tr>
<tr><td>word0_location</td><td>${hex(0)}</td><td>Physical memory base \u2014 the namespace starts at word\u202f0</td></tr>
<tr><td>word1 limit</td><td>${this.TOTAL_WORDS - 1} (= ${hex(this.TOTAL_WORDS - 1)})</td><td>Total physical memory size \u2212\u202f1 \u2014 defines the full namespace extent</td></tr>
<tr><td>word1 clistCount</td><td><em>N</em> (count of active NS entries)</td><td>NS Table size \u2014 how many 4-word entries exist</td></tr>
<tr><td>word2 seal</td><td>CRC-16(0, ${this.TOTAL_WORDS - 1})</td><td>Hardware-verified at every mLoad of CR15</td></tr>
</table>
<p>At boot (B:01) the hardware loads Slot\u202f0 into <strong>CR15</strong> (the Namespace register). From that point on, <code>CR15.limit\u202f=\u202f${this.TOTAL_WORDS - 1}</code> tells every mLoad how large the physical namespace is, and <code>CR15.clistCount\u202f=\u202fN</code> tells the hardware how many NS entries are valid.</p>
<div class="sr-key-concept"><div class="sr-concept-title">clistCount IS the NS Table Size</div>
<p>The <code>clistCount</code> metadata field in Slot\u202f0 is repurposed as the NS Table entry count. The NS Table therefore occupies <code>N\u202f\u00d7\u202f${this.NS_ENTRY_WORDS}\u202fwords</code> (${this.NS_ENTRY_WORDS} words per entry: W0\u202flocation, W1\u202fmetadata, W2\u202fseal, W3\u202freserved) starting at ${NS}. Every upload that creates a new slot increments this count; GC that frees a slot decrements it.</p></div>`
            },
            {
                title: '\u2461 NS Table \u2014 One Entry per Slot',
                type: 'nstable',
                content: `${this._memMap('nstable')}
<p>The NS Table occupies the top of physical memory from ${NS} to ${END}. It holds one <strong>4-word entry</strong> for every namespace slot, in descending order: slot\u202f0 is the highest-address entry and entry\u202f<em>i</em> starts at word address <code>${hex(this.TOTAL_WORDS)}\u202f\u2212\u202f(i+1)\u202f\u00d7\u202f${this.NS_ENTRY_WORDS}</code>.</p>
<table class="sr-table"><tr><th>Offset within entry</th><th>Name</th><th>Contents</th></tr>
<tr><td>+0</td><td>word0</td><td>Lump base address (<code>word0_location</code>)</td></tr>
<tr><td>+1</td><td>word1</td><td>Packed metadata: limit, clistCount, flags (see next slide)</td></tr>
<tr><td>+2</td><td>word2</td><td>GT Seq (gt_seq) + CRC-16 seal</td></tr>
<tr><td>+3</td><td>word3</td><td><em>Reserved</em> \u2014 always zero; future Navana per-slot GT (must not be executed)</td></tr>
</table>
<p>The hardware reads these four words on every <strong>mLoad</strong>, every <strong>CALL</strong>, and every <strong>RETURN</strong>. The seal in word2 is re-verified on each use to detect stale or forged capabilities. Word3 is reserved and ignored by current hardware.</p>
<div class="sr-key-concept"><div class="sr-concept-title">NS Table Capacity</div>
<p>Slot capacity is a <strong>power of two chosen at design time</strong> \u2014 64 (default/minimum), 128, 256, 512, or 1024 entries. This worked example uses 64 entries: the ${hex(this.NS_TABLE_BASE)}\u202f\u2013\u202f${END} region holds ${this.TOTAL_WORDS - this.NS_TABLE_BASE} words \u00f7 ${this.NS_ENTRY_WORDS} words/entry = ${(this.TOTAL_WORDS - this.NS_TABLE_BASE) / this.NS_ENTRY_WORDS} entries. The first <em>N</em> entries (where <em>N</em> = Slot\u202f0 <code>clistCount</code>) are live. Entries above <em>N</em> are unallocated. GC may compact and reduce <em>N</em>.</p></div>`
            },
            {
                title: 'NS Entry word1 \u2014 Packed Metadata',
                type: 'word1',
                content: `<p>NS entry word1 is a 32-bit packed field encoding six distinct pieces of metadata about the slot:</p>
<table class="sr-table"><tr><th>Bits</th><th>Field</th><th>Meaning</th></tr>
<tr><td>[16:0]</td><td>limit</td><td>Lump size\u202f\u2212\u202f1 (17 bits \u2014 up to 131\u2009071 words). For Slot\u202f0: ${this.TOTAL_WORDS - 1} (full physical memory minus 1).</td></tr>
<tr><td>[25:17]</td><td>clistCount</td><td>9-bit field. For abstractions: C-List word count. For Slot\u202f0: NS Table entry count (number of active slots).</td></tr>
<tr><td>[26]</td><td>chainable</td><td>1\u202f=\u202fthis slot may be bound into another\u2019s c-list via BIND.</td></tr>
<tr><td>[27]</td><td>gtType</td><td>1\u202f=\u202fvalid/active entry. 0\u202f=\u202fempty (GC may reclaim).</td></tr>
<tr><td>[30]</td><td>fFlag</td><td>Fragile: 1\u202f=\u202fentry is invalidated if referenced GT is revoked.</td></tr>
<tr><td>[31]</td><td>bFlag</td><td>Bindable override: 1\u202f=\u202fpermits BIND into foreign c-lists.</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Reading limit and clistCount from word1</div>
<p>Given <code>word1</code>: <br>
<code>limit\u202f=\u202fword1\u202f&amp;\u202f0x1FFFF</code> (bits 16:0)<br>
<code>clistCount\u202f=\u202f(word1\u202f&gt;&gt;&gt;\u202f17)\u202f&amp;\u202f0x1FF</code> (bits 25:17)</p>
<p>For Slot\u202f0, <code>limit\u202f=\u202f${this.TOTAL_WORDS - 1}</code> and <code>clistCount\u202f=\u202fN</code> (live entry count). For any other slot, <code>limit\u202f=\u202f${SLOT - 1}</code> and <code>clistCount</code> is the C-List size for that abstraction or thread.</p></div>`
            },
            {
                title: 'NS Entry word2 \u2014 GT Seq and CRC-16 Seal',
                type: 'word2',
                content: `<p>NS entry word2 provides two security mechanisms: a sequence counter for revocation and a CRC-16 seal for forgery detection.</p>
<table class="sr-table"><tr><th>Bits</th><th>Field</th><th>Meaning</th></tr>
<tr><td>[15:0]</td><td>seal</td><td>CRC-16/CCITT (poly 0x1021, init 0xFFFF) computed over <code>(word0_location, limit)</code></td></tr>
<tr><td>[31:25]</td><td>gt_seq</td><td>7-bit counter. Starts at 0; incremented on every revocation of this slot.</td></tr>
</table>
<p>Every GT word that points to a slot carries the slot\u2019s gt_seq at the time the GT was issued. On every mLoad, CALL, or RETURN the hardware checks:</p>
<ol>
<li><strong>Seal</strong>: recompute CRC-16 from the live NS entry; compare to the stored CRC. Mismatch \u2192 <code>SEAL_MISMATCH</code> fault.</li>
<li><strong>GT Seq</strong>: compare GT\u2019s gt_seq field to the NS entry\u2019s gt_seq. Mismatch \u2192 <code>VERSION</code> fault (capability revoked).</li>
</ol>
<div class="sr-key-concept"><div class="sr-concept-title">Revocation Is O(1)</div>
<p>To revoke all capabilities to a slot, the IDE simply increments the version field in word2. Every existing GT for that slot now has a stale version and will fault immediately on use. No scan of memory is required. This is why the Church Machine can revoke a capability instantly regardless of how many GTs reference it.</p></div>`
            },
            {
                title: 'CR15 \u2014 The Namespace Register',
                type: 'cr15',
                content: `<p>At boot B:01 (LOAD_NS) the hardware loads NS Slot\u202f0 into <strong>CR15</strong> (the Namespace register). CR15 gives the running thread a read-only view of the physical memory layout.</p>
<table class="sr-table"><tr><th>CR15 word</th><th>Source</th><th>Value</th></tr>
<tr><td>word0 (GT)</td><td>createGT(0, slot=0, zero perms)</td><td>Inform-type GT, index=0, all perm bits clear</td></tr>
<tr><td>word1</td><td>NS Slot\u202f0 word0_location</td><td>${hex(0)} \u2014 physical namespace base</td></tr>
<tr><td>word2</td><td>NS Slot\u202f0 word1_limit</td><td>limit=${this.TOTAL_WORDS - 1} + clistCount=<em>N</em></td></tr>
<tr><td>word3</td><td>NS Slot\u202f0 word2_seals</td><td>gt_seq + CRC-16 seal</td></tr>
</table>
<p>CR15 is in the <strong>privileged zone</strong> (CR12\u2013CR15) \u2014 it cannot be used as a source or destination for DREAD/DWRITE. It is loaded once at boot and is per-thread: saved and restored by CHANGE as part of per-thread context.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Zero Perms \u2014 Inform-type Identity Token</div>
<p>The GT in CR15 has no permission bits set (no R, W, X, L, S, E). It is purely structural: it proves to the hardware \u2014 via the CRC-16 seal \u2014 that the namespace description it carries is authentic and unmodified. Any code that attempts to use CR15 as a data or code capability will receive a <code>PERM</code> fault.</p></div>`
            },
            {
                title: 'Calling a Resident Abstraction \u2014 Constants Dot-Notation',
                type: 'dotnotation',
                content: `<p>Knowing the NS Table structure, we can now trace exactly what happens when a program calls a resident abstraction using dot-notation. <strong>Constants</strong> lives at <strong>NS[18]</strong> and exposes five read-only mathematical values as named methods.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Step 1 \u2014 LOAD CR11, Constants (NS[18] lookup + E-GT into CR11)</div>
<p><code>LOAD CR11, Constants</code> triggers the <strong>mLoad pipeline</strong> against NS entry&nbsp;18:</p>
<ol style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.9;">
<li>Hardware reads the 4-word NS entry at <code>${hex(this.NS_TABLE_BASE)}&nbsp;+&nbsp;18&nbsp;\u00d7&nbsp;4</code>.</li>
<li>word2 <strong>CRC-16 seal</strong> is recomputed over <code>(word0_location, limit)</code> and compared to the stored seal &mdash; mismatch \u2192 <code>SEAL_MISMATCH</code> fault.</li>
<li>word2 <strong>gt_seq</strong> is compared to the issuing sequence counter &mdash; mismatch \u2192 <code>VERSION</code> fault (capability revoked).</li>
<li>The <strong>E (Execute)</strong> permission bit is checked; Constants holds only E. No R/W bits &mdash; it is a pure callable.</li>
<li>An <strong>E-GT</strong> (Execute Golden Token) is synthesised and written into <strong>CR11</strong>.</li>
</ol>
<p>After LOAD, CR11 holds a hardware-verified E-GT. The GT embeds the seal and gt_seq fields so each subsequent CALL can re-verify them without re-reading the NS Table entry from memory.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Step 2 \u2014 CALL Constants.Pi (method dispatch via dot-notation)</div>
<p>The assembler resolves <code>Constants.Pi</code> to method index&nbsp;0 at assembly time &mdash; no runtime name lookup. <code>CALL Constants.Pi</code> uses the E-GT already in CR11:</p>
<ol style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.9;">
<li>Hardware verifies the E-GT in CR11 is still valid (seal + gt_seq re-checked).</li>
<li>Execution jumps to method&nbsp;0 inside the Constants lump (entry-point table offset 0).</li>
<li>Constants returns <code>0x40490FDB</code> (&pi;&nbsp;\u2248&nbsp;3.14159) in DR1 and issues RETURN.</li>
<li>Control resumes at the instruction after CALL.</li>
</ol></div>
<div class="sr-key-concept"><div class="sr-concept-title">Assembly \u2014 two calling styles</div>
<p><strong>Style A</strong> &mdash; LOAD once, then CALL each method (efficient when calling multiple methods):</p>
<pre class="sr-encoding" style="text-align:left;font-size:0.82rem;line-height:1.6;">LOAD   CR11, Constants   <span style="color:#666">; CR11 = E-GT for NS[18] (mLoad pipeline)</span>
TPERM  CR11, E           <span style="color:#666">; assert E permission &rarr; faults if absent</span>
CALL   Constants.Pi      <span style="color:#666">; DR1 &larr; 0x40490FDB  (&pi; &asymp; 3.14159)</span>
CALL   Constants.E       <span style="color:#666">; DR1 &larr; 0x402DF854  (e &asymp; 2.71828)</span>
CALL   Constants.Phi     <span style="color:#666">; DR1 &larr; 0x3FCFBE77  (&phi; &asymp; 1.61803)</span></pre>
<p><strong>Style B</strong> &mdash; ELOADCALL fuses load + permission check + call into one instruction (best for one-off calls):</p>
<pre class="sr-encoding" style="text-align:left;font-size:0.82rem;line-height:1.6;">ELOADCALL CR8, Constants, Pi    <span style="color:#666">; DR1 &larr; &pi;  (NS[18] lookup + call in 1 op)</span>
ELOADCALL CR8, Constants, E     <span style="color:#666">; DR1 &larr; e</span>
ELOADCALL CR8, Constants, Phi   <span style="color:#666">; DR1 &larr; &phi; (golden ratio)</span></pre></div>
<table class="sr-table" style="margin-top:0.5rem">
<tr><th>Method</th><th>Index</th><th>NS slot</th><th>Value (IEEE 754 hex)</th><th>Decimal</th></tr>
<tr><td><code>Constants.Pi</code></td><td>0</td><td>NS[18]</td><td><code>0x40490FDB</code></td><td>&pi; &asymp; 3.14159265</td></tr>
<tr><td><code>Constants.E</code></td><td>1</td><td>NS[18]</td><td><code>0x402DF854</code></td><td>e &asymp; 2.71828183</td></tr>
<tr><td><code>Constants.Phi</code></td><td>2</td><td>NS[18]</td><td><code>0x3FCFBE77</code></td><td>&phi; &asymp; 1.61803399</td></tr>
<tr><td><code>Constants.Zero</code></td><td>3</td><td>NS[18]</td><td><code>0x00000000</code></td><td>0.0</td></tr>
<tr><td><code>Constants.One</code></td><td>4</td><td>NS[18]</td><td><code>0x3F800000</code></td><td>1.0</td></tr>
</table>
<p style="margin-top:0.75rem;">Try it now: switch to <strong>Assembly</strong> language, click the <strong>Constants Dot \u2605</strong> example tab, then click <strong>Assemble &amp; Run</strong>. Watch the mLoad pipeline verify NS[18] on the first LOAD, then each CALL dispatch through the E-GT already in CR11.</p>`
            },
            {
                title: 'Namespace Lifecycle \u2014 Upload to GC',
                type: 'lifecycle',
                content: `<p>The namespace evolves through a sequence of operations from system boot to runtime:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Initialisation.</strong> The simulator calls <code>_initNamespaceTable()</code> on hard reset. It writes all built-in abstraction entries into the NS Table at ${NS}, sets Slot\u202f0 with <code>location=${hex(0)}</code>, <code>limit=${this.TOTAL_WORDS - 1}</code>, and <code>clistCount=N</code> (number of entries). The hardware boot ROM (3 instructions: LOAD → CHANGE → CALL) runs from IMEM, not from a LUMP. Slot\u202f2 is the first catalog slot (null NS entry, available for user abstractions).</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>Boot B:01 \u2014 LOAD_NS.</strong> <code>sim._bootStep()</code> calls mLoad on a zero-perm GT for Slot\u202f0. The result is written into <strong>CR15</strong>: the thread now knows the full physical namespace extent and the live entry count.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>Upload.</strong> When the user uploads a new abstraction via the IDE, a new NS entry is written at index <em>N</em>, the lump is placed at <code>N\u202f\u00d7\u202f${SLOT}</code>, and Slot\u202f0\u2019s <code>clistCount</code> is incremented to <em>N+1</em>. An E-GT for the new slot is issued and can be bound into any c-list that holds an S-permissioned GT for the target c-list.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>mLoad (at runtime).</strong> Any instruction that loads a capability reads the NS entry, verifies the seal and version, then derives the correct GT fields. CR15\u2019s version and seal are re-checked on every use to ensure the namespace root has not been tampered with.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>Revocation.</strong> To revoke all access to a slot, the IDE increments word2[31:25] (the version). All existing GTs for that slot immediately become stale. The next use faults with <code>VERSION</code>. No memory scan is needed.</div>
<div class="sr-sec-item"><span class="sr-sec-num">6</span><strong>GC.</strong> The Garbage Collector scans for unreachable slots (slots not reachable from any live c-list). Unreachable lumps are zeroed, their NS entries are cleared (<code>gtType=0</code>), and Slot\u202f0\u2019s <code>clistCount</code> is updated. Slot indices may be compacted to keep the live entries contiguous.</div>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">The Namespace Is Immutable Once Sealed</div>
<p>Physical memory layout (NS_TABLE_BASE, slot size, maximum entry count) is fixed at system initialisation time and cannot be changed at runtime. Slot\u202f0\u2019s <code>location=0</code> and <code>limit=${this.TOTAL_WORDS - 1}</code> are constants. Only <code>clistCount</code> changes as slots are allocated or freed. The hardware verifies the seal on every access, so any in-flight modification of Slot\u202f0 would be detected immediately.</p></div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';
        html += '<div class="sr-header">';
        html += '<h2>Namespace Abstraction \u2014 Legacy Tutorial</h2>';
        html += '<p class="sr-tagline">Historical design walkthrough \u00b7 non-authoritative field/security descriptions</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="nsTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="nsTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
        html += '</div>';
        html += '</div>';

        html += '<div class="sr-body">';
        html += '<div class="sr-key-concept"><div class="sr-concept-title">LEGACY / NON-AUTHORITATIVE</div><p>This preserved tutorial contains obsolete CRC-16, sequence-position, Slot 0, and namespace metadata descriptions. Current NS entries use W0 location, W1 limit/9-bit sequence/GC/far flags, W2 public unkeyed <code>integrity32</code>, and W3 a non-authoritative cache token. Use the live Reference documents and hardware source for shipped behavior.</p></div>';
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];
            html += `<div class="sr-step-container sr-type-${step.type}">`;
            html += `<div class="sr-step-title">${step.title}</div>`;
            if (step.subtitle) html += `<div class="sr-step-subtitle">${step.subtitle}</div>`;
            html += `<div class="sr-step-content">${step.content}</div>`;
            html += '</div>';
        } else {
            html += '<div class="sr-step-container sr-type-intro">';
            html += '<div class="sr-step-title">Namespace Abstraction</div>';
            html += '<div class="sr-step-content">';
            html += `<p>This tutorial covers the Church Machine\u2019s physical memory structure. Namespace Slot\u202f0 is the root entry: it defines the full physical address space (${this._hex(0)}\u202f\u2013\u202f${this._hex(this.TOTAL_WORDS - 1)}) and encodes the NS Table size in its metadata. The NS Table lives at the top of memory (${this._hex(this.NS_TABLE_BASE)}\u202f\u2013\u202f${this._hex(this.TOTAL_WORDS - 1)}), one 4-word entry per slot (W0\u202flocation, W1\u202fmetadata, W2\u202fseal, W3\u202freserved).</p>`;
            html += '<p>Click <strong>Next</strong> to begin.</p>';
            html += '</div></div>';
        }
        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    stepForward() {
        if (this.currentStep >= this.steps.length - 1) { this.reset(); return; }
        this.currentStep++;
        this.render('tutorialView');
    }

    stepBack() {
        if (this.currentStep <= 0) return;
        this.currentStep--;
        this.render('tutorialView');
    }

    reset() {
        this.currentStep = -1;
        this.render('tutorialView');
    }
}
