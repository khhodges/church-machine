class NamespaceTutorial {
    constructor() {
        this.currentStep = -1;
        this.TOTAL_WORDS    = 65536;
        this.SLOT_SIZE      = 64;   // 64 words per slot — hardware minimum (Task #1205)
        this.NS_ENTRY_WORDS = 3;
        // Zone 1 — Bootstrap: NS root (slot 0) + boot thread (slot 1)
        // First abstraction is loaded from Thread.CR0 — set via ⚡ in the Namespace table.
        // Slot 2 is null (freed); Boot.Abstr occupies slot 3 at physical address 0x0140.
        this.BOOTSTRAP_SLOTS = 2;
        this.BOOTSTRAP_WORDS = this.BOOTSTRAP_SLOTS * this.SLOT_SIZE;   // 2 × 64 = 128
        // Zone 2 — Resident: always-loaded IDE abstractions (IDE-set count)
        this.RESIDENT_SLOTS  = 10;
        this.RESIDENT_WORDS  = this.RESIDENT_SLOTS  * this.SLOT_SIZE;   // 640
        // Zone 4 — NS Table: sits at the top, grows downward
        this.NS_TABLE_BASE   = 0xFD00;
        this.NS_CW           = this.TOTAL_WORDS - this.NS_TABLE_BASE;   // 768 = 256 entries × 3 words
        this.steps = this._buildSteps();
    }

    _hex(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }

    _headerRef() {
        const fields = [
            { bits: '[31:27]', name: 'magic',  val: '0x1F', note: 'Trap-on-execute guard',                                  w: 5,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[26:23]', name: 'n\u22126', val: 'HW',    note: 'lumpSize = 2^(val+6) = full physical address space (n\u22126=10 for 65536 words)', w: 4,  bg: '#3a2000', border: '#c86000', text: '#f09040' },
            { bits: '[22:10]', name: 'cw',     val: 'HW',    note: 'NS Table word count; NS Table base = 2^cc \u2212 cw (e.g. cw=768 \u2192 256 entries \u00d7 3 words)', w: 13, bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { bits: '[9:8]',   name: 'typ',    val: '10',    note: 'clist-only \u2014 Namespace data lump (same as Thread)',   w: 2,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[7:0]',   name: 'cc',     val: 'HW',    note: 'Physical address space = 2^cc words (e.g. cc=16 \u2192 65\u202f536 total words); NS Table starts at 2^cc and grows \u2193', w: 8,  bg: '#1a1000', border: '#b07820', text: '#f0c050' },
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
             + `<div style="font-size:0.62rem;color:#555;font-family:monospace;margin-bottom:4px;">Header[0] \u2014 Namespace Lump \u00b7 Slot\u202f0 (typ=10) \u00b7 32 bits</div>`
             + bar + meta + `</div>`;
    }

    _memMap(highlighted) {
        const h  = this._hex.bind(this);
        const B  = this.BOOTSTRAP_WORDS;
        const R  = this.RESIDENT_WORDS;
        const NS = this.NS_TABLE_BASE;
        const freespaceEnd = NS - 1;

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
                sub: `2^cc\u2212cw = ${h(NS)} \u00b7 cw words \u00b7 ${this.NS_ENTRY_WORDS} per entry \u00b7 \u2026 0xFFFF`,
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
<tr><td><strong>\u2463 NS Table</strong></td><td>0xFFFF \u2191</td><td>cw words</td><td>3-word metadata entry per slot \u2014 slot\u202f1 at 0xFFFF, each new slot steps up toward freespace; base = 2^cc\u2212cw</td></tr>
</table></div>`
            },
            {
                title: 'Header[0] \u2014 Namespace Lump Bit Fields',
                type: 'header',
                content: `${this._headerRef()}
<p>Word 0 of every lump is a <strong>32-bit header word</strong>. For the Namespace root (Slot\u202f0) the five fields are <em>repurposed</em> just as they are for Thread lumps. The two key fields are <code style="color:#f0c050">cc</code> (physical address space size as a power of two) and <code style="color:#60b8f0">cw</code> (NS Table word count). Hover any field box above to read its bit range and note.</p>
<table class="sr-table">
<tr><th>Field</th><th>Bits</th><th>Width</th><th>NS Slot\u202f0 value</th><th>Meaning</th></tr>
<tr><td><code style="color:#888">magic</code></td><td>[31:27]</td><td>5&nbsp;b</td><td><code>0x1F</code></td><td>Trap-on-execute guard \u2014 executing word&nbsp;0 always faults</td></tr>
<tr><td><code style="color:#f09040">n\u22126</code></td><td>[26:23]</td><td>4&nbsp;b</td><td>HW</td><td><code>lumpSize = 2^(n\u22126+6)</code> = full physical address space; for 65536-word NS: n\u22126=10</td></tr>
<tr><td><code style="color:#60b8f0">cw</code></td><td>[22:10]</td><td>13&nbsp;b</td><td>HW</td><td><strong>NS Table word count</strong> (repurposed from code word count); NS Table base = 2^cc \u2212 cw \u2193; e.g. cw=768 = 256 entries \u00d7 3 words/entry</td></tr>
<tr><td><code style="color:#888">typ</code></td><td>[9:8]</td><td>2&nbsp;b</td><td><code>10</code></td><td>clist-only \u2014 same type code as Thread; marks NS as a data lump, not a callable</td></tr>
<tr><td><code style="color:#f0c050">cc</code></td><td>[7:0]</td><td>8&nbsp;b</td><td>HW</td><td><strong>Physical address space = 2^cc words</strong> (repurposed from c-list count); e.g. cc=16 \u2192 2^16 = 65\u202f536 total words; NS Table starts at 2^cc and grows \u2193</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Address Space Layout \u2014 Four Zones</div>
<p>The namespace divides physical memory into four IDE-set zones. Lump zones grow <strong>upward \u2191</strong> from <code>0x0000</code>; the NS Table grows <strong>downward \u2193</strong> from <code>2^cc</code>.</p>
<table class="sr-table" style="margin:6px 0;"><tr><th>Zone</th><th>Base</th><th>Top</th><th>Size</th></tr>
<tr><td>\u2460 Bootstrap</td><td><code>0x0000</code></td><td>2^cc\u2212cw\u2212resident\u2212free\u22121</td><td>IDE-set (boot slots)</td></tr>
<tr><td>\u2461 Resident Lumps</td><td>Bootstrap end + 1</td><td>Resident end</td><td>IDE-set (always-loaded)</td></tr>
<tr><td>\u2462 Freespace</td><td>Resident end + 1</td><td>2^cc\u2212cw\u22121</td><td>IDE-set (lazy-load cache)</td></tr>
<tr><td>\u2463 NS Table</td><td><code>2^cc \u2212 cw</code></td><td><code>2^cc \u2212 1</code></td><td>cw words (IDE-set)</td></tr>
</table>
<p>The NS Table base: since the Table ends at <code>2^cc \u2212 1</code> and occupies <code>cw</code> words, its base = <code>(2^cc \u2212 1 + 1) \u2212 cw = 2^cc \u2212 cw</code>. Example: cc=16, cw=768 \u2192 base = 65\u202f536 \u2212 768 = <strong>0xFD00</strong>.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Encoding Formula</div>
<p><code>(0x1F &lt;&lt; 27) | (n_minus_6 &lt;&lt; 23) | (cw &lt;&lt; 10) | (0b10 &lt;&lt; 8) | cc</code></p>
<p>Example \u2014 65536-word namespace (cc=16, cw=768 NS Table words, n\u22126=10):</p>
<p><code style="color:#f0c050;font-size:1rem;">0xFD0C_0210</code>&nbsp;&nbsp;(magic=0x1F, n\u22126=10, cw=768, typ=10, cc=16)</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Three Lump Types \u2014 Same Header, Different Field Semantics</div>
<p>All three lump types share the same 32-bit header format. The hardware uses <code>typ</code> to decide which interpretation applies:</p>
<table class="sr-table" style="margin-top:6px;"><tr><th>Field</th><th>Programmed (typ=00)</th><th>Thread (typ=10)</th><th>Namespace (typ=10)</th></tr>
<tr><td><code>cw</code></td><td>Code word count</td><td>Stack words (sw)</td><td>NS Table word count</td></tr>
<tr><td><code>cc</code></td><td>C-list GT count</td><td>Heap size (max N words)</td><td>Physical space = 2^cc words</td></tr>
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
<tr><td>word1 clistCount</td><td><em>N</em> (count of active NS entries)</td><td>NS Table size \u2014 how many 3-word entries exist</td></tr>
<tr><td>word2 seal</td><td>CRC-16(0, ${this.TOTAL_WORDS - 1})</td><td>Hardware-verified at every mLoad of CR15</td></tr>
</table>
<p>At boot (B:01) the hardware loads Slot\u202f0 into <strong>CR15</strong> (the Namespace register). From that point on, <code>CR15.limit\u202f=\u202f${this.TOTAL_WORDS - 1}</code> tells every mLoad how large the physical namespace is, and <code>CR15.clistCount\u202f=\u202fN</code> tells the hardware how many NS entries are valid.</p>
<div class="sr-key-concept"><div class="sr-concept-title">clistCount IS the NS Table Size</div>
<p>The <code>clistCount</code> metadata field in Slot\u202f0 is repurposed as the NS Table entry count. The NS Table therefore occupies <code>N\u202f\u00d7\u202f${this.NS_ENTRY_WORDS}\u202fwords</code> starting at ${NS}. Every upload that creates a new slot increments this count; GC that frees a slot decrements it.</p></div>`
            },
            {
                title: '\u2461 NS Table \u2014 One Entry per Slot',
                type: 'nstable',
                content: `${this._memMap('nstable')}
<p>The NS Table occupies the top of physical memory from ${NS} to ${END}. It holds one <strong>3-word entry</strong> for every namespace slot. Entry\u202f<em>i</em> starts at address <code>${NS}\u202f+\u202fi\u202f\u00d7\u202f${this.NS_ENTRY_WORDS}</code>.</p>
<table class="sr-table"><tr><th>Offset within entry</th><th>Name</th><th>Contents</th></tr>
<tr><td>+0</td><td>word0</td><td>Lump base address (<code>word0_location</code>)</td></tr>
<tr><td>+1</td><td>word1</td><td>Packed metadata: limit, clistCount, flags (see next slide)</td></tr>
<tr><td>+2</td><td>word2</td><td>GT Seq (gt_seq) + CRC-16 seal</td></tr>
</table>
<p>The hardware reads these three words on every <strong>mLoad</strong>, every <strong>CALL</strong>, and every <strong>RETURN</strong>. The seal is re-verified on each use to detect stale or forged capabilities.</p>
<div class="sr-key-concept"><div class="sr-concept-title">NS Table Capacity</div>
<p>Up to <strong>256 entries</strong> fit in the ${hex(this.NS_TABLE_BASE)}\u202f\u2013\u202f${END} region (${this.TOTAL_WORDS - this.NS_TABLE_BASE} words \u00f7 ${this.NS_ENTRY_WORDS} words/entry). The first <em>N</em> entries (where <em>N</em> = Slot\u202f0 <code>clistCount</code>) are live. Entries above <em>N</em> are unallocated. GC may compact and reduce <em>N</em>.</p></div>`
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
<li>Hardware reads the 3-word NS entry at <code>${hex(this.NS_TABLE_BASE)}&nbsp;+&nbsp;18&nbsp;\u00d7&nbsp;3</code>.</li>
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
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Initialisation.</strong> The simulator calls <code>_initNamespaceTable()</code> on hard reset. It writes all built-in abstraction entries into the NS Table at ${NS}, sets Slot\u202f0 with <code>location=${hex(0)}</code>, <code>limit=${this.TOTAL_WORDS - 1}</code>, and <code>clistCount=N</code> (number of entries). Boot.Abstr GTs are packed into the Boot.Thread lump c-list; Slot\u202f2 is null (available for catalog abstractions).</div>
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
        html += '<h2>Namespace Abstraction</h2>';
        html += '<p class="sr-tagline">Physical Memory \u00b7 Slot\u202f0 Root \u00b7 NS Table \u00b7 Entry Format \u00b7 CR15 \u00b7 Version &amp; Seal</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="nsTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="nsTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
        html += '</div>';
        html += '</div>';

        html += '<div class="sr-body">';
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
            html += `<p>This tutorial covers the Church Machine\u2019s physical memory structure. Namespace Slot\u202f0 is the root entry: it defines the full physical address space (${this._hex(0)}\u202f\u2013\u202f${this._hex(this.TOTAL_WORDS - 1)}) and encodes the NS Table size in its metadata. The NS Table lives at the top of memory (${this._hex(this.NS_TABLE_BASE)}\u202f\u2013\u202f${this._hex(this.TOTAL_WORDS - 1)}), one 3-word entry per slot.</p>`;
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
