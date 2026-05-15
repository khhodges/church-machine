class AbstractionTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _headerRef() {
        const fields = [
            { bits: '[31:27]', name: 'magic',  val: '0x1F', note: 'Trap-on-execute guard',                                w: 5,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[26:23]', name: 'n\u22126', val: 'IDE',   note: 'lumpSize = 2^(val+6)',                                w: 4,  bg: '#3a2000', border: '#c86000', text: '#f09040' },
            { bits: '[22:10]', name: 'cw',     val: 'IDE',   note: 'Code word count (instruction words, compiler-set)',   w: 13, bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { bits: '[9:8]',   name: 'typ',    val: '00',    note: 'callable \u00b7 Enter only \u2014 Programmed Abstraction', w: 2,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[7:0]',   name: 'cc',     val: 'IDE',   note: 'C-list size \u2014 compiler-set GT count (0\u2013255)',    w: 8,  bg: '#1a1000', border: '#c08020', text: '#f0c050' },
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
             + `<div style="font-size:0.62rem;color:#555;font-family:monospace;margin-bottom:4px;">Header[0] \u2014 Programmed Abstraction (typ=00) \u00b7 32 bits</div>`
             + bar + meta + `</div>`;
    }

    _memMap(highlighted) {
        const sections = [
            { id: 'code',  label: '\u2460 Code',             sub: 'Instruction words  (word\u202f0 \u2192 codeEnd)', bg: '#001a30', border: '#2080c0', text: '#70bfff', dashed: false },
            { id: 'free',  label: '\u00b7\u00b7\u00b7 Freespace', sub: 'Unused headroom \u2014 artifact of power-of-2 lump sizing',  bg: '#070707', border: '#333', text: '#555', dashed: true },
            { id: 'clist', label: '\u2461 C-List',            sub: 'Golden Token words  (clistStart \u2192 allocSize\u22121)',        bg: '#1a1000', border: '#c08020', text: '#f0c050', dashed: false },
        ];
        const heights = { code: 100, free: 50, clist: 80 };
        const addrLabels = {
            code:  'word\u202f0 \u2192',
            free:  '\u2195 gap',
            clist: 'clistStart \u2192',
        };
        let html = '<div style="display:flex;gap:8px;margin:12px 0 4px 0;align-items:stretch;">';
        html += '<div style="display:flex;flex-direction:column;justify-content:flex-start;width:88px;flex-shrink:0;font-size:0.68rem;color:#666;font-family:monospace;">';
        for (const s of sections) {
            html += `<div style="height:${heights[s.id]}px;display:flex;align-items:flex-start;padding-top:6px;justify-content:flex-end;padding-right:4px;box-sizing:border-box;">${addrLabels[s.id]}</div>`;
        }
        html += '</div>';
        html += '<div style="flex:1;display:flex;flex-direction:column;">';
        for (const s of sections) {
            const isHL = s.id === highlighted;
            const borderLine = s.dashed ? 'dashed' : 'solid';
            const outline = isHL ? `3px solid ${s.border}` : `1px ${borderLine} ${s.border}`;
            const opacity = (!highlighted || isHL) ? '1' : '0.38';
            const shadow = isHL ? `0 0 16px ${s.border}44` : 'none';
            html += `<div style="height:${heights[s.id]}px;background:${s.bg};border:${outline};box-shadow:${shadow};opacity:${opacity};padding:6px 10px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;transition:opacity 0.2s;">`;
            html += `<span style="color:${s.text};font-weight:700;font-size:0.85rem;">${s.label}</span>`;
            html += `<span style="color:${s.id === 'free' ? '#444' : '#aaa'};font-size:0.75rem;margin-top:2px;">${s.sub}</span>`;
            html += '</div>';
        }
        html += '</div></div>';
        return this._headerRef() + html;
    }

    _p2Sizes() {
        const sizes = [64, 128, 256, 512, 1024, 2048, 4096];
        let html = '<div style="margin:6px 0 10px 0;">';
        html += '<span style="font-size:0.72rem;color:#555;font-family:monospace;letter-spacing:0.02em;">allocSize options (power-of-2, in words):</span>';
        html += '<div style="display:flex;gap:5px;margin-top:5px;flex-wrap:wrap;">';
        for (const n of sizes) {
            html += `<span style="background:#0f0f0f;border:1px solid #2a2a2a;color:#777;font-family:monospace;font-size:0.72rem;padding:2px 8px;border-radius:3px;">${n}</span>`;
        }
        html += '</div>';
        html += '<span style="font-size:0.68rem;color:#444;margin-top:4px;display:block;">freeWords = allocSize \u2212 codeWords \u2212 clistWords \u2265 0</span>';
        html += '</div>';
        return html;
    }

    _buildSteps() {
        return [
            {
                title: 'What Is a Programmed Abstraction?',
                type: 'intro',
                content: `<p>A <strong>Programmed Abstraction</strong> is the Church Machine\u2019s fundamental computational unit \u2014 the equivalent of a class with methods. It lives inside a <em>lump</em> (a contiguous, <strong>power-of-2-sized</strong> block of namespace words) with three zones, top to bottom.</p>
${this._memMap(null)}
${this._p2Sizes()}
<div class="sr-key-concept"><div class="sr-concept-title">Three Zones, One Lump</div>
<p>Reading top-to-bottom (word\u202f0\u202f\u2192\u202fbase): <strong>\u2460\u202fCode \u2192 \u00b7\u00b7\u00b7\u202fFreespace \u2192 \u2461\u202fC-List</strong>.</p>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.7;">
<li>The <strong>Code</strong> region holds instruction words (word\u202f0 upward). Its size is fixed at upload time by the compiler.</li>
<li>The <strong>Freespace</strong> is the unaddressed gap between the end of code and the start of the C-List. It exists because lump sizes must be a power of\u202f2 \u2014 the IDE packs code and C-List to the two ends, and any leftover words sit between them, inaccessible at runtime.</li>
<li>The <strong>C-List</strong> is packed at the high end of the lump (clistStart through allocSize\u22121). Each word is a Golden Token giving this abstraction access to some named object or service outside itself.</li>
</ul></div>
<div class="sr-key-concept"><div class="sr-concept-title">Separation of Concerns \u2014 Abstractions vs Threads</div>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.7;">
<li><strong>Static code</strong> lives in the abstraction\u2019s Code region \u2014 read-only (X-perm), never modified at runtime.</li>
<li><strong>Static capabilities</strong> live in the C-List \u2014 the abstraction\u2019s fixed authority boundary, frozen at upload unless an explicit S-permissioned GT was issued to a writer.</li>
<li><strong>Dynamic data</strong> (stack frames, temporaries, heap objects, DR0\u2013DR15) lives exclusively in the <em>Thread</em> lump \u2014 never inside the abstraction.</li>
<li><strong>Abstractions are stateless and shareable</strong> \u2014 any number of threads can hold an E-GT for the same abstraction and enter it concurrently without interference, because the lump is never written during execution.</li>
<li><strong>Threads carry all mutable state</strong>: the LIFO stack, heap, data registers, and the privileged CR12\u2013CR15 window. The abstraction lump is unchanged between calls.</li>
</ul></div>`
            },
            {
                title: 'Header[0] \u2014 Programmed Abstraction Bit Fields',
                type: 'header',
                content: `${this._headerRef()}
<p>Word 0 of every lump is a <strong>32-bit header word</strong>. For Programmed Abstractions (<code>typ=00</code>) the five fields encode the lump geometry and the compiler\u2019s layout choices. Hover any field box above to read its bit range and note.</p>
<table class="sr-table">
<tr><th>Field</th><th>Bits</th><th>Width</th><th>Value</th><th>Meaning</th></tr>
<tr><td><code style="color:#888">magic</code></td><td>[31:27]</td><td>5&nbsp;b</td><td><code>0x1F</code></td><td>Trap-on-execute guard \u2014 executing word&nbsp;0 always faults</td></tr>
<tr><td><code style="color:#f09040">n\u22126</code></td><td>[26:23]</td><td>4&nbsp;b</td><td>IDE</td><td><code>lumpSize = 2^(val+6)</code>; e.g. val=2 \u2192 2^8 = 256 words</td></tr>
<tr><td><code style="color:#60b8f0">cw</code></td><td>[22:10]</td><td>13&nbsp;b</td><td>IDE</td><td><strong>Code word count</strong> \u2014 compiler-set; instruction words occupy words&nbsp;0 \u2026 cw\u22121</td></tr>
<tr><td><code style="color:#888">typ</code></td><td>[9:8]</td><td>2&nbsp;b</td><td><code>00</code></td><td>callable \u00b7 Enter only \u2014 identifies this lump as a Programmed Abstraction</td></tr>
<tr><td><code style="color:#f0c050">cc</code></td><td>[7:0]</td><td>8&nbsp;b</td><td>IDE</td><td><strong>C-list size</strong> \u2014 compiler-set GT count; the last <code>cc</code> words of the lump form the C-List</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Encoding Formula</div>
<p><code>(0x1F &lt;&lt; 27) | (n_minus_6 &lt;&lt; 23) | (cw &lt;&lt; 10) | (0b00 &lt;&lt; 8) | cc</code></p>
<p>Example \u2014 128-word lump, cw=107 code words, cc=0 c-list words:</p>
<p><code style="color:#60b8f0;font-size:1rem;">0xF881_AC00</code>&nbsp;&nbsp;(magic=0x1F, n\u22126=1, cw=107, typ=00, cc=0)</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Lump Geometry from the Header</div>
<p>Given the header word, the hardware can derive all three zone boundaries without any additional metadata: <strong>code zone</strong> = words 0 \u2026 cw\u22121, <strong>freespace</strong> = words cw \u2026 (lumpSize\u2212cc\u22121), <strong>C-List</strong> = words lumpSize\u2212cc \u2026 lumpSize\u22121. The freespace is always inaccessible at runtime; it exists solely as a power-of-2 rounding artifact.</p></div>`,
            },
            {
                title: 'Calling Methods \u2014 Three Access Paths',
                type: 'egt',
                content: `<p>A caller can invoke a method inside a Programmed Abstraction by three different paths, depending on how the E-GT for the callee was obtained.</p>
<table class="sr-table"><tr><th>Path</th><th>Mechanism</th><th>When to use</th></tr>
<tr><td><strong>By Name</strong></td><td>The CLOOMC compiler resolves the method name to a C-List index at compile time and emits <code>ELOAD CRd, &lt;idx&gt;</code> automatically.</td><td>Normal application code written in CLOOMC++. The programmer writes <code>object.methodName(args)</code> and the compiler handles the rest.</td></tr>
<tr><td><strong>By Number</strong></td><td>The programmer directly specifies the C-List slot index in an <code>ELOAD CRd, idx</code> or <code>LOAD CRd, idx</code> / <code>CALL CRd</code> pair. The index is a compile-time constant.</td><td>Assembly-level code or performance-critical paths where the slot number is a well-known fixed interface contract.</td></tr>
<tr><td><strong>By Address</strong></td><td>An E-GT for the callee has already been loaded into a CR by a prior <code>LOAD</code> or passed in as an argument (CR0\u2013CR5). The caller issues <code>CALL CRd</code> directly against the pre-loaded GT without consulting the C-List.</td><td>Higher-order code (callbacks, dispatch tables, dependency injection) where the callee is determined at runtime.</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">\ud83d\udd12 Security Advantage of By-Name Access</div>
<p>When a caller invokes a method by name, the <strong>programmer never handles the raw GT</strong>. The CLOOMC compiler resolves the name to a C-List index at compile time, inside a trusted compilation boundary. This gives three security properties that by-number and by-address cannot guarantee:</p>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.7;">
<li><strong>No GT leakage.</strong> The capability never appears in a programmer-visible variable, register, or data structure. A bug or injection in application code cannot read it out and pass it to an untrusted third party.</li>
<li><strong>No type confusion.</strong> The compiler verifies the callee\u2019s interface at compile time. Calling the wrong entry point \u2014 a classic confused-deputy attack \u2014 is a compile error, not a runtime surprise.</li>
<li><strong>Binding survives C-List reorganisation.</strong> If the IDE reorders C-List slots (e.g. after an update), the name rebinds automatically. By-number code breaks silently; by-name code is always correct.</li>
</ul>
<p>By-number and by-address access are still fully protected by the hardware seal and permission check \u2014 they cannot forge a GT \u2014 but they push more responsibility onto the programmer. Reserve them for trusted, performance-critical, or higher-order patterns where name resolution is impossible.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">\ud83d\udd11 Fourth Layer \u2014 GT Pass Key (as used by the Mint Abstraction)</div>
<p>Holding an E-GT to <em>call</em> a method is only one gate. A Programmed Abstraction can demand a second, independent proof of authority by requiring the caller to pass a <strong>GT Pass Key</strong> as an argument (typically in CR1). The method inspects this GT before doing any work:</p>
<ul style="margin:4px 0 0 0;padding-left:1.2em;line-height:1.7;">
<li><strong>What the Mint does.</strong> The Mint abstraction issues new Golden Tokens. Its API requires the caller to present a Mint-specific Pass Key GT (carried in CR1) that was issued to authorised minters only at system setup. The Mint checks that the Pass Key\u2019s NS slot and permissions match the expected pattern before creating any GT \u2014 a caller who can reach the Mint\u2019s entry point but does not hold the Pass Key is rejected before a single token is minted.</li>
<li><strong>Two independent barriers.</strong> An attacker must simultaneously hold (1) an E-GT to call the method and (2) a valid Pass Key GT \u2014 two unforgeable capabilities issued through separate authority chains. Compromising one does not grant the other.</li>
<li><strong>Audit and revocation.</strong> The Pass Key is a normal GT with a seal and NS entry. The issuer can revoke it by invalidating its NS slot version. All future calls to the Mint by that holder fail immediately, even if the caller still holds a valid E-GT.</li>
<li><strong>General pattern.</strong> Any Programmed Abstraction can use this pattern for privileged APIs \u2014 set the Pass Key GT as a required argument and reject callers who present the wrong or zero-permission GT. It is a purely software contract enforced by the capability-check logic inside the method, with the hardware seal guaranteeing the GT cannot be forged or replayed from a revoked session.</li>
</ul></div>
<div class="sr-key-concept"><div class="sr-concept-title">All Three Paths Arrive at the Same Hardware Gate</div>
<p>Regardless of how the E-GT was obtained, the hardware performs the same validation on <code>CALL</code>: check E\u202f=\u202f1, recompute the CRC-16 seal against the NS entry, derive CR14 and CR6, push the 2-word frame, set PC\u202f=\u202f0. The three paths are only distinguished at the <em>source of the E-GT</em> \u2014 name (compiler), number (C-List index), or address (pre-loaded register). Once the GT is in a CR the call mechanism is identical.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">ELOAD = LOAD + CALL in One Instruction</div>
<p><code>ELOAD CRd, idx</code> reads the GT at C-List[idx] into CRd and immediately calls it in a single atomic operation \u2014 equivalent to <code>LOAD CRd, idx; CALL CRd</code> but without the GT remaining in the register after the call returns. Use <code>LOAD</code> + <code>CALL</code> separately only when you need to inspect or retain the GT.</p></div>`
            },
            {
                title: '\u2460 Code Region \u2014 CR14 (CLOOMC)',
                type: 'code',
                content: `${this._memMap('code')}
<p>The Code region starts at <strong>word\u202f0</strong> of the lump. Instruction words are fetched and executed sequentially from PC\u202f=\u202f0 on every CALL entry. CR14 always carries <strong>RX</strong> permission (hardware-enforced), so Turing instructions can also <em>read</em> data words from within the lump via CR14 \u2014 giving the abstraction direct access to read-only constants embedded in the code region without needing a separate heap GT.</p>
<table class="sr-table"><tr><th>Register</th><th>Field</th><th>Meaning</th></tr>
<tr><td rowspan="3">CR14</td><td>base</td><td>Lump base address (= word\u202f0 of the lump) \u2014 from NS slot <code>word0_location</code></td></tr>
<tr><td>limit</td><td>NS slot <code>word1 limit[16:0]</code> = allocSize\u202f\u2212\u202f1 \u2014 <strong>set by the IDE</strong> at upload time</td></tr>
<tr><td>perm</td><td><strong>RX</strong> \u2014 hardware-enforced, always R+X; X\u2011perm for fetch; R\u2011perm enables data reads via CR14</td></tr>
</table>
<p>CR14 is the <strong>CLOOMC</strong> register (CLass\u202fOf\u202fObjects Memory Code). The CPU checks X\u2011perm before every instruction fetch. A BOUNDS fault fires if PC exceeds the limit. The limit is set by the IDE at upload time, encoded in NS slot metadata, and never recomputed by the hardware.</p>
<div class="sr-key-concept"><div class="sr-concept-title">RX Permission \u2014 Read-Only Data Inside the Code Region</div>
<p>CR14 always carries <strong>RX</strong> permission (hardware-enforced). Turing instructions can issue data reads directly against CR14 \u2014 accessing read-only constants (lookup tables, string literals, fixed coefficients) packed within the lump. No heap GT is required. Write operations via CR14 are always forbidden \u2014 CR14 carries R and X, never W.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">CR14 is Per-Thread, Not Per-Abstraction</div>
<p>CR14 lives in the <em>thread\u2019s</em> privileged register zone (CR12\u2013CR15) and is re-derived on every CALL from the callee\u2019s NS slot metadata. It is saved and restored across context switches (CHANGE) as part of per-thread state. The abstraction\u2019s lump is never modified during execution \u2014 any number of threads can share the same abstraction safely.</p></div>`
            },
            {
                title: '\u2461 C-List \u2014 CR6 (Capability List)',
                type: 'clist',
                content: `${this._memMap('clist')}
<p>The C-List spans from <strong>word\u202fclistStart</strong> to <strong>allocSize\u202f\u2212\u202f1</strong>. Each word is a 32-bit Golden Token. The C-List is indexed from offset\u202f0 to clistCount\u202f\u2212\u202f1.</p>
<table class="sr-table"><tr><th>Register</th><th>Field</th><th>Meaning</th></tr>
<tr><td rowspan="3">CR6</td><td>base</td><td>lump base\u202f+\u202fclistStart (first GT word)</td></tr>
<tr><td>limit</td><td>clistCount\u202f\u2212\u202f1 \u2014 number of GT slots minus one</td></tr>
<tr><td>perm</td><td>L (load) \u2014 only used for LOAD, SAVE, ELOAD; never R, W, or X</td></tr>
</table>
<p>Three instructions access the C-List:</p>
<table class="sr-table"><tr><th>Instruction</th><th>Operation</th></tr>
<tr><td>LOAD CRd, idx</td><td>Read c-list[idx] \u2014 loads the GT at offset idx into CRd</td></tr>
<tr><td>SAVE CRs, idx</td><td>Write CRs \u2014 stores CRs GT into c-list[idx] (S permission required)</td></tr>
<tr><td>ELOAD CRd, idx</td><td>Entry-point load \u2014 like LOAD but followed by an inline CALL</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">The C-List is the Abstraction\u2019s Capability Boundary</div>
<p>An abstraction can only access the outside world through GTs in its own C-List. It cannot forge a GT, cannot use a GT it was never given, and cannot read another abstraction\u2019s C-List without an L-permissioned GT. This is the mechanism by which the Church Machine enforces the principle of least authority at hardware level.</p></div>`
            },
            {
                title: 'The E-GT \u2014 Execute Golden Token',
                type: 'egt',
                content: `<p>To enter an abstraction, the caller needs an <strong>E-GT</strong> (Execute-permission Golden Token). The E-GT points to the callee\u2019s NS slot and carries exactly one permission bit: <code>E</code> (execute).</p>
<table class="sr-table"><tr><th>GT word field</th><th>Value</th></tr>
<tr><td>NS slot index</td><td>Callee\u2019s namespace slot number</td></tr>
<tr><td>Permissions</td><td>E\u202f=\u202f1, all others 0</td></tr>
<tr><td>Seal</td><td>CRC-16 of (location, limit) \u2014 hardware-checked on every use</td></tr>
</table>
<p>On CALL the hardware performs these steps from the E-GT:</p>
<ol>
<li><strong>Validate</strong> \u2014 check E\u202f=\u202f1, check seal (CRC-16 matches NS entry)</li>
<li><strong>Derive CR14</strong> \u2014 base\u202f=\u202fNS slot <code>word0_location</code>, limit\u202f=\u202fNS slot <code>word1 limit[16:0]</code> (= allocSize\u202f\u2212\u202f1, set by IDE), perm\u202f=\u202fRX (hardware-enforced)</li>
<li><strong>Derive CR6</strong> \u2014 base\u202f=\u202fcallee lump base\u202f+\u202fclistStart, limit\u202f=\u202fclistCount\u202f\u2212\u202f1, L perm</li>
<li><strong>Set PC\u202f=\u202f0</strong> \u2014 always enters at the first instruction word</li>
</ol>
<p>The E-GT is also <strong>saved in the CALL frame</strong> (the 2-word CALL frame\u2019s word\u202f0 is the caller\u2019s E-GT). RETURN uses it to re-derive the caller\u2019s CR6 and CR14 after popping the frame.</p>
<div class="sr-key-concept"><div class="sr-concept-title">The Seal Prevents Forgery</div>
<p>The CRC-16/CCITT seal in the GT is computed over <code>(word0_location, limit)</code> when the NS entry is written. The hardware recomputes the seal on every CALL and RETURN. A forged or stale GT that points to wrong memory will have a mismatched seal and cause a <code>SEAL_MISMATCH</code> fault \u2014 no memory access occurs.</p></div>`
            },
            {
                title: 'CALL \u2014 Entering an Abstraction',
                type: 'call',
                content: `<p>CALL enters an abstraction by consuming an E-GT from CRs, pushing a 2-word frame onto the <em>thread\u2019s</em> LIFO stack, and transferring control to PC\u202f=\u202f0 of the callee.</p>
<table class="sr-table"><tr><th>Event</th><th>Detail</th></tr>
<tr><td>E-GT validated</td><td>E perm checked; seal recomputed and verified against NS entry</td></tr>
<tr><td>Frame word pushed</td><td><code>FLAGS[31:28] | PC[27:13] | SZ=1[12] | STO[11:0]</code> (saved return address and stack state)</td></tr>
<tr><td>E-GT pushed</td><td>Caller\u2019s E-GT stored at frame word\u202f0 (RETURN uses it to restore CR6/CR14)</td></tr>
<tr><td>STO += 2</td><td>Thread\u2019s stack-top-offset advances by 2 (2-word frame)</td></tr>
<tr><td>CR6 replaced</td><td>Callee\u2019s C-List GT derived from NS slot metadata</td></tr>
<tr><td>CR14 replaced</td><td>Callee\u2019s code GT derived from NS slot metadata</td></tr>
<tr><td>PC = 0</td><td>Execution begins at callee\u2019s first instruction word</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">The Stack Belongs to the Thread, Not the Abstraction</div>
<p>CALL frame words are written into the <em>calling thread\u2019s</em> lump (the LIFO stack region, word\u202f12 onward from the thread lump base). The abstraction\u2019s own lump is not modified. This is why abstractions can be shared across threads: their code and c-list are immutable during execution.</p></div>`
            },
            {
                title: 'RETURN \u2014 Leaving an Abstraction',
                type: 'return',
                content: `<p>RETURN pops the call frame from the thread\u2019s LIFO stack and restores the caller\u2019s execution context. It also applies a capability mask declared in the RETURN instruction itself.</p>
<table class="sr-table"><tr><th>Step</th><th>Detail</th></tr>
<tr><td>Read SZ from frame word[12]</td><td>1 \u2192 2-word CALL frame \u00b7 0 \u2192 1-word LAMBDA frame</td></tr>
<tr><td>Restore FLAGS, PC, STO</td><td>From frame word bits [31:28], [27:13], [11:0]</td></tr>
<tr><td>Re-derive CR6 and CR14</td><td>SZ\u202f=\u202f1 only: frame word\u202f0 is the caller\u2019s E-GT; re-validate seal then re-derive both registers</td></tr>
<tr><td>Apply MASK[11:0]</td><td>Low 12 bits of the RETURN literal: each 1-bit clears that CR. Enforces callee-declared capability cleanup.</td></tr>
</table>
<p>The MASK lives in the <strong>RETURN instruction</strong>, not the frame. This leaves all 12 STO bits free in the frame word and ensures the callee (not the caller) controls which CRs are cleared on exit.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Re-deriving CR6 / CR14 \u2014 Why Not Just Restore?</div>
<p>RETURN does not restore CR6 and CR14 from saved copies \u2014 it <em>re-derives</em> them by re-running the same E-GT validation used during CALL. This means if the NS entry has been revoked or its seal invalidated since the CALL, the RETURN will fault rather than silently restoring a stale capability. Security properties are enforced on the way back out, not just on the way in.</p></div>`
            },
            {
                title: 'Complete Layout \u2014 NS Slot Metadata',
                type: 'summary',
                content: `${this._memMap(null)}
${this._p2Sizes()}
<p>The full abstraction lump, from word\u202f0 to allocSize\u202f\u2212\u202f1:</p>
<table class="sr-table"><tr><th>Zone</th><th>Start</th><th>Size</th><th>Defined by</th></tr>
<tr><td>\u2460 Code</td><td>word\u202f0</td><td>codeWords</td><td>compiler (instructions placed from word\u202f0 upward)</td></tr>
<tr><td>\u00b7\u00b7\u00b7 Freespace</td><td>word\u202fcodeWords</td><td>allocSize \u2212 codeWords \u2212 clistCount</td><td>rounding up to next power-of-2</td></tr>
<tr><td>\u2461 C-List</td><td>word\u202fclistStart</td><td>clistCount words</td><td>NS slot word1 field clistCount[25:17]</td></tr>
</table>
<p>The NS slot holds everything the hardware needs to enter and leave any abstraction:</p>
<table class="sr-table"><tr><th>NS slot field</th><th>Encodes</th></tr>
<tr><td>word0_location</td><td>Lump base address in namespace memory</td></tr>
<tr><td>word1 limit[16:0]</td><td>allocSize \u2212 1 (total lump word count minus one)</td></tr>
<tr><td>word1 clistCount[25:17]</td><td>Number of C-List GT slots (= C-List size in words)</td></tr>
<tr><td>word2 seal</td><td>CRC-16/CCITT of (location, limit) \u2014 checked on every CALL and RETURN</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">clistStart = allocSize \u2212 clistCount</div>
<p>The C-List is always packed at the <em>top</em> (highest addresses) of the lump. The Code region occupies word\u202f0 upward. Any unused words between codeEnd and clistStart are <strong>freespace</strong> \u2014 an inert gap that arises from the power-of-2 lump constraint. The hardware derives clistStart from allocSize and clistCount on every CALL entry \u2014 there is no separate pointer stored anywhere.</p></div>`
            },
            {
                title: 'Abstraction Lifecycle \u2014 Boot to CALL/RETURN',
                type: 'lifecycle',
                content: `<p>An abstraction moves through these phases from namespace setup to active execution:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Upload.</strong> The IDE writes the abstraction\u2019s lump into namespace memory and creates an NS entry: <code>word0_location</code> = lump base, <code>word1</code> = packed limit and clistCount, <code>word2</code> = CRC-16 seal. The C-List GT words are placed at lump[clistStart\u202f\u2192\u202fallocSize\u22121].</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>Boot B:03 \u2014 INIT_ABSTR.</strong> The hardware loads the Boot.Abstr NS slot (Slot\u202f3) into a temporary E-perm GT for CR6 to confirm the boot abstraction\u2019s identity.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>Boot B:04 \u2014 LOAD_NUC.</strong> From the NS Slot\u202f3 metadata the hardware derives and writes <strong>CR14</strong> (code GT: base = NS <code>word0_location</code>, limit = NS <code>word1 limit[16:0]</code> = allocSize\u22121, perm = RX (hardware-enforced)) and <strong>CR6</strong> (c-list GT: base = lump base\u202f+\u202fclistStart, limit = clistCount\u22121, L perm). PC is set to 0. Boot code begins executing.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>CALL \u2014 Entering any abstraction.</strong> The calling thread presents an E-GT. The hardware validates it, pushes a 2-word frame [E-GT\u202f|\u202fframe\u202fword] onto the thread\u2019s LIFO stack (STO\u202f+=\u202f2), re-derives CR6 and CR14 from the callee\u2019s NS slot, and sets PC\u202f=\u202f0. CR0 (return) and CR1 (first argument) are set by the caller beforehand.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>Execution.</strong> Instructions run sequentially from PC\u202f=\u202f0. The abstraction accesses capabilities via LOAD/SAVE/ELOAD through CR6. All memory access outside the lump requires a valid GT in a CR. DR0\u2013DR15 and the thread stack are part of the <em>calling thread\u2019s</em> lump, not the abstraction.</div>
<div class="sr-sec-item"><span class="sr-sec-num">6</span><strong>RETURN.</strong> The RETURN instruction pops the frame (SZ=1: 2 words), re-derives the caller\u2019s CR6 and CR14 from the saved E-GT, restores PC, FLAGS, STO, and applies the MASK to clear any CRs the callee declares as output-only. Control returns to the instruction after the original CALL.</div>
<div class="sr-sec-item"><span class="sr-sec-num">7</span><strong>CHANGE (abstraction as CLOOMC).</strong> A scheduler thread can switch which abstraction is the \u201crunning code\u201d by saving CR14 and CR6 as part of per-thread context and restoring them for a different thread. The abstraction\u2019s own lump is never modified during a context switch.</div>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">No Mutable State in an Abstraction</div>
<p>Unlike a Thread, a Programmed Abstraction has <strong>no mutable live state</strong> in its lump between calls. Its code words are never writable (CR14 carries RX, never W). Its C-List can be written only via SAVE (S permission), and only by code that holds a SAVE-permissioned GT for that c-list. If no such GT is issued, the abstraction\u2019s capabilities are frozen at upload time.</p></div>`
            },
            {
                title: 'Method Inheritance \u2014 Extending an Abstraction',
                type: 'inheritance',
                content: `<p>An abstraction can declare a <strong>parent</strong>. When a method call arrives for a name the child does not define locally, the dispatcher walks the parent chain until it finds a bound handler &mdash; or faults with <code>METHOD</code> if none exists.</p>
<p>The concrete example already in the system: <strong>Circle</strong> (Layer\u202f3, index\u202f46) declares its own <code>Area</code> and <code>Circumference</code> methods and sets <code>parent\u202f=\u202fSlideRule</code> (index\u202f16). Calling <code>Circle.Multiply</code> at the simulator level silently delegates to <code>SlideRule.Multiply</code>.</p>
<table class="sr-table">
<tr><th>Method</th><th>Declared on</th><th>Resolved via</th></tr>
<tr><td><code>Area</code></td><td>Circle (own)</td><td>Circle dispatch table</td></tr>
<tr><td><code>Circumference</code></td><td>Circle (own)</td><td>Circle dispatch table</td></tr>
<tr><td><code>Multiply</code></td><td>inherited</td><td>parent: SlideRule</td></tr>
<tr><td><code>Sqrt</code></td><td>inherited</td><td>parent: SlideRule</td></tr>
<tr><td><code>Sin</code>, <code>Cos</code>, \u2026</td><td>inherited</td><td>parent: SlideRule</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Inheritance is a Registry Concept, Not a Hardware Concept</div>
<p>The Church Machine hardware has no knowledge of parent chains &mdash; it executes the 32-bit instruction words it finds in the lump it was called into. Inheritance lives entirely in the <em>abstraction registry</em>: the IDE-side table that maps abstraction names to metadata and JavaScript simulation handlers.</p>
<p>At the <strong>assembly level</strong>, Circle\u2019s own C-List holds its own methods (<code>Area</code>\u202f=\u202fslot\u202f0, <code>Circumference</code>\u202f=\u202fslot\u202f1) and a capability to SlideRule (in some later slot). Circle\u2019s <code>Area</code> lump code calls <code>ELOADCALL (SlideRule GT), Multiply</code> &mdash; explicit delegation, not transparent inheritance at the instruction level. The registry inheritance makes this delegation <em>visible and navigable</em> from the IDE without altering the hardware model.</p>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Defining a Parent</div>
<pre class="sr-code sr-code-asm">// In AbstractionRegistry._registerAll():
this.createAbstraction(46, 'Circle', 3,
    ['Area', 'Circumference'],
    'Geometry \u2014 own methods; inherits all SlideRule maths',
    { parent: 16 }   // 16 = SlideRule
);

// getAllMethods(46) now returns:
// [
//   { name: 'Area',          own: true,  from: 'Circle' },
//   { name: 'Circumference', own: true,  from: 'Circle' },
//   { name: 'Multiply',      own: false, from: 'SlideRule' },
//   { name: 'Sqrt',          own: false, from: 'SlideRule' },
//   ...22 SlideRule methods total
// ]</pre>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">Override by Declaring the Method Locally</div>
<p>A child that <em>does</em> add its own <code>Multiply</code> to its dispatch table will have that handler called first &mdash; the parent entry is shadowed exactly as in classical single-dispatch OOP. The parent is only reached when no local binding exists.</p>
</div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';
        html += '<div class="sr-header">';
        html += '<h2>Programmed Abstractions</h2>';
        html += '<p class="sr-tagline">Code Region \u00b7 C-List \u00b7 E-GT \u00b7 CALL / RETURN \u00b7 CR6 \u00b7 CR14 \u00b7 Three Method-Access Paths</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="abstrTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="abstrTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-title">Programmed Abstractions</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial walks through the structure of a Church Machine Programmed Abstraction: the Code region (CR14), C-List (CR6), E-GT mechanism, CALL/RETURN derivation, and the three paths by which a caller can invoke a method \u2014 by name, by C-List index, or by pre-loaded address.</p>';
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
