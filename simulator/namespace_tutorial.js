class NamespaceTutorial {
    constructor() {
        this.currentStep = -1;
        this.NS_TABLE_BASE = 0xFD00;
        this.TOTAL_WORDS = 65536;
        this.NS_ENTRY_WORDS = 3;
        this.SLOT_SIZE = 256;
        this.steps = this._buildSteps();
    }

    _hex(n) { return '0x' + n.toString(16).toUpperCase().padStart(4, '0'); }

    _memMap(highlighted) {
        const nsTableEnd = this.TOTAL_WORDS - 1;
        const nsTableStart = this.NS_TABLE_BASE;
        const lumpEnd = nsTableStart - 1;

        const sections = [
            {
                id: 'lumps',
                label: 'Lump Space',
                sub: `${this._hex(0)} \u2013 ${this._hex(lumpEnd)}  \u00b7  one ${this.SLOT_SIZE}-word slot per abstraction`,
                bg: '#001830', border: '#2070b0', text: '#70b8ff'
            },
            {
                id: 'nstable',
                label: 'NS Table',
                sub: `${this._hex(nsTableStart)} \u2013 ${this._hex(nsTableEnd)}  \u00b7  3\u202fwords per entry \u00b7 up to 256 entries`,
                bg: '#1a1000', border: '#b07820', text: '#f0c050'
            },
        ];
        const heights = { lumps: 96, nstable: 80 };
        const addrLabels = { lumps: `${this._hex(0)} \u2192`, nstable: `${this._hex(nsTableStart)} \u2192` };

        let html = '<div style="display:flex;gap:8px;margin:12px 0 4px 0;align-items:stretch;">';
        html += '<div style="display:flex;flex-direction:column;justify-content:flex-start;width:88px;flex-shrink:0;font-size:0.68rem;color:#666;font-family:monospace;">';
        for (const s of sections) {
            html += `<div style="height:${heights[s.id]}px;display:flex;align-items:flex-start;padding-top:6px;justify-content:flex-end;padding-right:4px;box-sizing:border-box;">${addrLabels[s.id]}</div>`;
        }
        html += '</div>';
        html += '<div style="flex:1;display:flex;flex-direction:column;">';
        for (const s of sections) {
            const isHL = s.id === highlighted;
            const outline = isHL ? `3px solid ${s.border}` : `1px solid ${s.border}`;
            const opacity = (!highlighted || isHL) ? '1' : '0.45';
            const shadow = isHL ? `0 0 16px ${s.border}44` : 'none';
            html += `<div style="height:${heights[s.id]}px;background:${s.bg};border:${outline};box-shadow:${shadow};opacity:${opacity};padding:6px 10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;transition:opacity 0.2s;">`;
            html += `<span style="color:${s.text};font-weight:700;font-size:0.85rem;">${s.label}</span>`;
            html += `<span style="color:#aaa;font-size:0.75rem;margin-top:2px;">${s.sub}</span>`;
            html += '</div>';
            if (s.id !== 'nstable') html += '<div style="height:2px;background:#111;"></div>';
        }
        html += '</div></div>';
        return html;
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
<div class="sr-key-concept"><div class="sr-concept-title">Two Regions, One Address Space</div>
<p>The ${hex(this.TOTAL_WORDS)}-word physical address space is divided into two regions: <strong>Lump Space</strong> (${hex(0)}\u202f\u2013\u202f${hex(this.NS_TABLE_BASE - 1)}) where abstraction and thread lumps are allocated, and the <strong>NS Table</strong> (${NS}\u202f\u2013\u202f${END}) where the hardware stores the 3-word metadata entry for every slot. <strong>NS Slot\u202f0</strong> (the root entry) describes the entire physical address space and encodes the NS Table size in its metadata.</p></div>`
            },
            {
                title: '\u2460 Lump Space \u2014 Slot Allocations',
                type: 'lumps',
                content: `${this._memMap('lumps')}
<p>Lump space spans from ${hex(0)} to ${hex(this.NS_TABLE_BASE - 1)}. The IDE allocates each abstraction or thread a fixed-size slot of <strong>${SLOT} words</strong> (${hex(SLOT)} words). Slots are assigned by slot index:</p>
<table class="sr-table"><tr><th>Slot index</th><th>Lump base address</th><th>Default occupant</th></tr>
<tr><td>0</td><td colspan="2"><em>NS Slot 0 is the namespace root \u2014 its lump IS the entire physical memory (see slide 3)</em></td></tr>
<tr><td>1</td><td>${hex(1 * SLOT)}</td><td>Thread Abstraction (boot thread)</td></tr>
<tr><td>2</td><td>${hex(2 * SLOT)}</td><td>Boot.Abstr (CLOOMC entry point)</td></tr>
<tr><td>3\u2026N</td><td>${hex(3 * SLOT)}\u202f\u2026</td><td>Programmer-uploaded abstractions</td></tr>
</table>
<p>Each ${SLOT}-word slot is self-contained: code + c-list for abstractions, GT zone + stack + heap + DR for threads. The hardware locates any lump from its NS entry\u2019s <code>word0_location</code>.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Slot Index = Lump Address / ${SLOT}</div>
<p>For every slot except Slot\u202f0, <code>word0_location\u202f=\u202fidx\u202f\u00d7\u202f${SLOT}</code>. This means the hardware can compute any lump base from the slot index alone without reading memory. Slot\u202f0 is the exception: its lump is the full physical address space.</p></div>`
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
<tr><td>word2 seal</td><td>FNV-32(0, ${this.TOTAL_WORDS - 1})</td><td>Hardware-verified at every mLoad of CR15</td></tr>
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
<tr><td>+2</td><td>word2</td><td>Version + FNV-32 seal</td></tr>
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
                title: 'NS Entry word2 \u2014 Version and FNV Seal',
                type: 'word2',
                content: `<p>NS entry word2 provides two security mechanisms: a version counter for revocation and a cryptographic seal for forgery detection.</p>
<table class="sr-table"><tr><th>Bits</th><th>Field</th><th>Meaning</th></tr>
<tr><td>[24:0]</td><td>seal</td><td>Low 25 bits of FNV-32 computed over <code>(word0_location, limit)</code></td></tr>
<tr><td>[31:25]</td><td>version</td><td>7-bit counter. Starts at 0; incremented on every revocation of this slot.</td></tr>
</table>
<p>Every GT word that points to a slot carries the slot\u2019s version at the time the GT was issued. On every mLoad, CALL, or RETURN the hardware checks:</p>
<ol>
<li><strong>Seal</strong>: recompute FNV-32 from the live NS entry; compare to the GT\u2019s stored seal. Mismatch \u2192 <code>SEAL_MISMATCH</code> fault.</li>
<li><strong>Version</strong>: compare GT\u2019s version field to the NS entry\u2019s version. Mismatch \u2192 <code>VERSION</code> fault (capability revoked).</li>
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
<tr><td>word3</td><td>NS Slot\u202f0 word2_seals</td><td>version + FNV seal</td></tr>
</table>
<p>CR15 is in the <strong>privileged zone</strong> (CR12\u2013CR15) \u2014 it cannot be used as a source or destination for DREAD/DWRITE. It is loaded once at boot and is per-thread: saved and restored by CHANGE as part of per-thread context.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Zero Perms \u2014 Inform-Only</div>
<p>The GT in CR15 has no permission bits set (no R, W, X, L, S, E). It is purely informational: it proves to the hardware \u2014 via the FNV seal \u2014 that the namespace description it carries is authentic and unmodified. Any code that attempts to use CR15 as a data or code capability will receive a <code>PERM</code> fault.</p></div>`
            },
            {
                title: 'Namespace Lifecycle \u2014 Upload to GC',
                type: 'lifecycle',
                content: `<p>The namespace evolves through a sequence of operations from system boot to runtime:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Initialisation.</strong> The simulator calls <code>_initNamespaceTable()</code> on hard reset. It writes all built-in abstraction entries into the NS Table at ${NS}, sets Slot\u202f0 with <code>location=${hex(0)}</code>, <code>limit=${this.TOTAL_WORDS - 1}</code>, and <code>clistCount=N</code> (number of entries). The Boot.Abstr c-list GTs are packed into Slot\u202f2\u2019s lump.</div>
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
