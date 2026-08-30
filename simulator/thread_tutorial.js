class ThreadTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _headerRef() {
        const fields = [
            { bits: '[31:27]', name: 'magic',  val: '0x1F',  note: 'Trap-on-execute guard',              w: 5,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[26:23]', name: 'n\u22126', val: 'IDE',   note: 'lumpSize = 2^(val+6)',               w: 4,  bg: '#3a2000', border: '#c86000', text: '#f09040' },
            { bits: '[22:10]', name: 'cw/sw',  val: 'IDE',   note: 'Stack words (cw reinterpreted for typ=10)', w: 13, bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { bits: '[9:8]',   name: 'typ',    val: '10',    note: 'clist-only = Thread abstraction',    w: 2,  bg: '#2a2a2a', border: '#555',    text: '#888'    },
            { bits: '[7:0]',   name: 'cc',     val: '12',    note: 'Capability-home count: CR0\u2013CR11 at the lump tail', w: 8,  bg: '#3a2c00', border: '#c8a020', text: '#f0d060' },
        ];
        const total = 32;
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
             + `<div style="font-size:0.62rem;color:#555;font-family:monospace;margin-bottom:4px;">Header[0] \u2014 Thread Lump (typ=10) \u00b7 32 bits</div>`
             + bar + meta
             + `</div>`;
    }

    _memMap(highlighted) {
        const sections = [
            { id: 'header',label: 'Header',                    sub: 'Word +0 \u00b7 geometry and resource contract', bg: '#2a2a2a', border: '#555',    text: '#aaa'    },
            { id: 'dr',    label: '\u2464 Data Registers',    sub: 'DR0\u2013DR15  (16 \u00d7 32-bit, fixed)',        bg: '#1e0840', border: '#8040c0', text: '#b080f0' },
            { id: 'sto',   label: '\u25c6 Protected STO',      sub: 'Machine-protected Thread word +17 \u00b7 FLAGS/SZ/STO \u00b7 not heap storage', bg: '#3a2200', border: '#f59e0b', text: '#fbbf24' },
            { id: 'heap',  label: '\u2463 Heap',       sub: 'HeapWords = 2^((n\u22126)+6) \u2212 cw \u2212 30 \u00b7 starts at +18 and fills through stackStart\u22121', bg: '#002a10', border: '#20a040', text: '#60d080' },
            { id: 'stack', label: '\u2462 LIFO Stack \u2193', sub: 'sw words immediately before tail capability homes', bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { id: 'cap',   label: '\u2461 Capabilities',     sub: '12 persisted GT homes: CR0\u2013CR11 (lumpSize\u221212 \u2026 lumpSize\u22121)', bg: '#3a2c00', border: '#c8a020', text: '#f0d060' },
        ];
        const heights = { header: 44, dr: 64, sto: 64, heap: 72, stack: 96, cap: 72 };
        const addrLabels = {
            header:'+0 \u2192',
            dr:    'word 1 \u2192',
            sto:   'word 17 \u2192',
            heap:  'word 18 \u2192',
            stack: 'lumpSize\u221212\u2212sw \u2192',
            cap:   'lumpSize\u221212 \u2192',
        };
        let html = '<div style="display:flex;gap:8px;margin:12px 0 4px 0;align-items:stretch;">';
        html += '<div style="display:flex;flex-direction:column;justify-content:flex-start;width:140px;flex-shrink:0;font-size:0.68rem;color:#666;font-family:monospace;">';
        for (const s of sections) {
            html += `<div style="height:${heights[s.id]}px;display:flex;align-items:flex-start;padding-top:6px;justify-content:flex-end;padding-right:4px;box-sizing:border-box;white-space:nowrap;">${addrLabels[s.id]}</div>`;
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
            if (s.id !== 'dr') html += '<div style="height:2px;background:#111;"></div>';
        }
        html += '</div></div>';
        return this._headerRef() + html;
    }

    _buildSteps() {
        return [
            {
                title: 'What Is a Thread Abstraction?',
                type: 'intro',
                content: `<p>A <strong>Thread Abstraction</strong> is the Church Machine\u2019s representation of a running computation. Like all abstractions it lives inside a <em>lump</em> (a contiguous block of namespace words), but its internal structure is different from a Programmed Abstraction: it carries both a protected capability set <em>and</em> a live execution context.</p>
<p>A dormant Thread uses a size declared by header <code>n\u22126</code>. CR0\u2013CR11 are restored from the final twelve words, <code>+(lumpSize\u221212)\u2026+(lumpSize\u22121)</code>. Word <code>+17</code> is the machine-protected STO slot; the ordinary software heap starts at <code>+18</code> and extends to the stack. There is no packed PC, serialized M flag, or CR14 home.</p>
${this._memMap(null)}
<div class="sr-key-concept"><div class="sr-concept-title">Five Regions, Tail-Derived Capability Homes</div>
<p>Reading top-to-bottom: <strong>Header \u2192 Data Registers \u2192 Protected STO \u2192 Heap \u2192 Stack \u2192 Capabilities</strong>. The machine-protected STO indicator occupies reserved word <code>+17</code>; Heap begins at <code>+18</code>, ends immediately before Stack, and grows when <code>n\u22126</code> grows. Stack is immediately before the final twelve capability homes. There is no Thread Freespace region.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Object Garbage Collection</div>
<p>Zone \u2463 (Heap) is <strong>not individually scanned</strong> by the hardware GC. The G-bit mark-and-sweep operates at the <em>Thread object</em> level: when the system GC marks the Thread GT as reachable, the <strong>entire lump</strong> is considered live and left untouched. If the Thread GT becomes unreachable, the whole lump is reclaimed at once. All heap memory management within Zone \u2463 \u2014 allocation, compaction, and freeing \u2014 is a <strong>software concern</strong> left to the thread\u2019s own code.</p></div>`
            },
            {
                title: 'Header[0] \u2014 Thread Lump Bit Fields',
                type: 'header',
                content: `${this._headerRef()}
<p>Word 0 of every lump is a <strong>32-bit header word</strong>. For Thread lumps (<code>typ=10</code>) the five packed fields encode the lump\u2019s geometry and the IDE\u2019s resource allocation. Hover any field box above to read its bit range and note.</p>
<table class="sr-table">
<tr><th>Field</th><th>Bits</th><th>Width</th><th>Thread value</th><th>Meaning</th></tr>
<tr><td><code style="color:#888">magic</code></td><td>[31:27]</td><td>5&nbsp;b</td><td><code>0x1F</code></td><td>Trap-on-execute guard \u2014 executing word&nbsp;0 always faults</td></tr>
<tr><td><code style="color:#f09040">n\u22126</code></td><td>[26:23]</td><td>4&nbsp;b</td><td>IDE</td><td><code>lumpSize = 2^(val+6)</code>; e.g. val=2 \u2192 2^8 = 256 words</td></tr>
<tr><td><code style="color:#60b8f0">cw/sw</code></td><td>[22:10]</td><td>13&nbsp;b</td><td>IDE</td><td><strong>Stack words</strong> \u2014 <code>cw</code> field reinterpreted for typ=10; Stack ends immediately before the tail homes</td></tr>
<tr><td><code style="color:#888">typ</code></td><td>[9:8]</td><td>2&nbsp;b</td><td><code>10</code></td><td>clist-only \u2014 identifies this lump as a Thread (no executable code)</td></tr>
<tr><td><code style="color:#f0d060">cc</code></td><td>[7:0]</td><td>8&nbsp;b</td><td><code>12</code></td><td><strong>Capability-home count</strong> \u2014 the twelve CR0\u2013CR11 homes occupy the final 12 words</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Encoding Formula</div>
<p><code>(0x1F &lt;&lt; 27) | (n_minus_6 &lt;&lt; 23) | (sw &lt;&lt; 10) | (0b10 &lt;&lt; 8) | 12</code></p>
<p>Canonical 256-word example \u2014 sw=32 stack words, cc=12 homes:</p>
<p><code style="color:#f0d060;font-size:1rem;">0xF900_820C</code>&nbsp;&nbsp;(magic=0x1F, n\u22126=2, sw=32, typ=10, cc=12)</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Why Reinterpret <code>cw</code> and <code>cc</code>?</div>
<p>A Thread carries <em>no executable code</em>, so the 13-bit <code>cw</code> (code-word count) field is reinterpreted as <code>sw</code> (stack words) when <code>typ=10</code>. The stack occupies <code>+(lumpSize\u221212\u2212sw)\u2026+(lumpSize\u221213)</code>; <code>cc=12</code> records the persisted-home count. Heap is the remaining region from <code>+18</code> to the stack start\u22121.</p></div>`,
            },
            {
                title: '\u2460 Capabilities \u2014 GT Zone for CR0\u2013CR11',
                type: 'capabilities',
                content: `${this._memMap('cap')}
<p>V20 reserves <strong>exactly 12 words</strong> at fixed offsets <code>+244\u2026+255</code> as the persisted <strong>GT homes</strong>: one Golden Token home for each of CR0\u2013CR11 in the defined 256-word body. CR12\u2013CR15 are privileged/runtime registers, not persisted homes; CR14 is derived transiently from restored CR0.</p>
<table class="sr-table"><tr><th>Offset (+244+N)</th><th>CR</th><th>Role</th><th>Controlled by</th></tr>
<tr><td>+244</td><td>CR0</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+245</td><td>CR1</td><td>CALL/RETURN ABI \u00b7 argument GT in; return GT out</td><td><strong>Architecture</strong></td></tr>
<tr><td>+246</td><td>CR2</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+247</td><td>CR3</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+248</td><td>CR4</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+249</td><td>CR5</td><td>Heap GT \u00b7 Zone \u2463 bounds (18 \u2026 18+heapWords\u22121) \u00b7 installed by CHANGE; excludes protected STO</td><td><strong>Convention</strong></td></tr>
<tr><td>+250</td><td>CR6</td><td>C-list view (E+M+B?-only) \u00b7 re-derived on CALL/RETURN/CHANGE</td><td><strong>Architecture</strong></td></tr>
<tr><td>+251</td><td>CR7</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+252</td><td>CR8</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+253</td><td>CR9</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+254</td><td>CR10</td><td>General-purpose</td><td>Programmer</td></tr>
<tr><td>+255</td><td>CR11</td><td>General-purpose</td><td>Programmer</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">System GTs Live in C-list Slots</div>
<p>Capabilities for system services \u2014 Scheduler, Mint, NS write authority, etc. \u2014 are held in <strong>c-list slots</strong>, not in fixed CRs. A thread LOADs the GT it needs into any free general-purpose CR immediately before use. This is identical to how data registers work: the register is a transient holder; the durable home is the c-list.</p>
<p>The architecture assigns no permanent role to CR0 or CR2\u2013CR11. Only <strong>CR1</strong> (CALL/RETURN ABI) and <strong>CR6</strong> (hardware-managed c-list view) are hardware-defined within Zone \u2460.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">mLoad Keeps the GT Zone in Sync</div>
<p>Scheduler CHANGE saves and restores CR0\u2013CR11 and DR0\u2013DR15 only. PC, flags, M state, STO, CR14, and CR15 are not serialized in Thread data.</p></div>`
            },
            {
                title: '\u2461 LIFO Stack \u2014 Grows Downward',
                type: 'stack',
                content: `${this._memMap('stack')}
<p>The <strong>LIFO call stack</strong> begins at the word offset set by the IDE (<code>sw</code> field in the thread header) and expands <em>downward</em> toward lower offsets into freespace. The current stack position is held in the <strong>cursor register</strong> \u2014 a single 32-bit hardware-only register that packs both the current instruction offset (NIA) and the current stack top offset (STO) into one word. CALL pushes a 2-word frame; LAMBDA pushes a 1-word frame. RETURN pops the correct number based on the SZ bit.</p>
<ul>
<li><strong>Stack top</strong> (<code>sp_max</code>): <code>+243</code> \u2014 fixed immediately below the persisted capability homes; initial cursor STO field = 243</li>
<li><strong>Stack floor</strong> (<code>sp_min</code>): <code>244 \u2212 sw + 2</code> \u2014 IDE-controlled via the header <code>cw/sw</code> field</li>
<li><strong>Overflow</strong>: hardware raises <code>STACK_OVERFLOW</code> <em>before any write</em> when STO &lt; sp_min; raises <code>STACK_CORRUPT</code> when STO &gt; sp_max</li>
<li><strong>2-word CALL frame (SZ=1)</strong>: <code>[E-GT \u00b7 frame\u202fword]</code> \u2014 cursor STO field decreases by 2</li>
<li><strong>1-word LAMBDA frame (SZ=0)</strong>: <code>[frame\u202fword only]</code> \u2014 cursor STO field decreases by 1</li>
</ul>
<div class="sr-key-concept"><div class="sr-concept-title">The Cursor Register \u2014 NIA + STO in One Word</div>
<p>The Church Machine keeps both the current instruction pointer and the current stack top in a single 32-bit hardware register that is <strong>never addressable by data instructions</strong>:</p>
<table class="sr-table"><tr><th>Bits</th><th>Field</th><th>Meaning</th></tr>
<tr><td>31</td><td>0 (live)</td><td>Always zero while running \u2014 the SZ tag only appears in stored frame words</td></tr>
<tr><td>30:16</td><td>NIA [15]</td><td>Current word offset from CR14.base (next instruction to execute)</td></tr>
<tr><td>15:0</td><td>STO [16]</td><td>Current stack top word offset from thread lump base</td></tr>
</table>
<p>A frame word pushed onto the stack is a <strong>direct snapshot</strong> of this register with bit 31 set (SZ tag) and NIA pre-incremented to the return address:</p></div>
<table class="sr-table"><tr><th>Stack slot</th><th>Contents</th></tr>
<tr><td>STO+0 \u2014 frame word (both frame types)</td><td><code>FLAGS[4] | return_PC[15] | prior_SZ[1] | prev_STO[12]</code></td></tr>
<tr><td>STO\u22121 \u2014 E-GT word (CALL only)</td><td>Caller\u2019s E-GT Word 0 \u2014 RETURN revalidates it to re-derive CR6 and CR14</td></tr>
</table>
<table class="sr-table"><tr><th>Frame word field</th><th>Bits</th><th>Meaning</th></tr>
<tr><td>SZ</td><td>31</td><td>1 = 2-word CALL frame \u00b7 0 = 1-word LAMBDA frame</td></tr>
<tr><td>return_PC</td><td>30:16</td><td>NIA + 1: word offset of the instruction <em>after</em> CALL in the caller\u2019s code</td></tr>
<tr><td>prev_STO</td><td>15:0</td><td>STO at the moment of CALL \u2014 restored into cursor register by RETURN</td></tr>
</table>
<p>RETURN recovers the full execution state in <strong>one memory read and one register write</strong>: it reads the frame word at STO+0 and writes it back into the cursor register with bit 31 cleared. Both NIA and STO are restored atomically. The cursor is runtime state, not an additional persisted CR home.</p>
<div class="sr-key-concept"><div class="sr-concept-title">STO Is Hardware-Only \u2014 No Data Instruction Can Reach It</div>
<p>The live cursor register is <strong>inaccessible to DREAD and DWRITE</strong>. Its STO field is stored in the reserved machine-protected word at <code>+17</code>. CR5 begins at <code>+18</code>, so no ordinary heap capability can address STO. CALL, RETURN, LAMBDA, and CHANGE maintain the cursor/backing state and apply <code>sp_min</code> from header <code>cw/sw</code> plus the architecture-fixed <code>sp_max=+243</code> before stack writes.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">LIFO, Not FIFO</div>
<p>The stack discipline is <strong>Last-In First-Out</strong>: CALL decrements the STO field of the cursor register and RETURN increments it (via <code>prev_STO</code> in the frame word). Nested calls push sequentially deeper; unwinding always reverses that order. No frame can be forged or overwritten because all stack words are inside the thread\u2019s lump and bounds are hardware-enforced. Initial STO in protected word <code>+17</code> is <code>sp_max = +243</code> (the 12 persisted capability homes begin at +244).</p></div>`
            },
            {
                title: '\u2463 Heap \u2014 Derived Object Store',
                type: 'heap',
                content: `${this._memMap('heap')}
<p>After the Data Registers and protected STO, the <strong>heap</strong> holds dynamically-allocated objects. Its size is derived: it starts at <code>+18</code> and fills every word through <code>stackStart\u22121</code>. Increasing the <code>n\u22126</code> lump size grows Heap when stack size is unchanged.</p>
<ul>
<li><strong>Heap base</strong>: word 18 (after the protected STO word at +17)</li>
<li><strong>Heap limit</strong>: word <code>stackStart\u22121</code>; Stack begins at <code>lumpSize\u221212\u2212sw</code></li>
<li><strong>Allocation</strong>: thread objects advance the heap pointer upward (bump allocation) toward Stack</li>
<li><strong>Derived ceiling</strong>: each Thread owns its Heap region exclusively; select a larger lump to enlarge it</li>
<li><strong>Object GC</strong>: Zone \u2463 is not individually scanned \u2014 the hardware G-bit GC operates at the Thread object level; the entire lump is live or reclaimed as one unit; heap memory management within Zone \u2463 is a software concern</li>
</ul>
<table class="sr-table"><tr><th>Header[0] field</th><th>Bits</th><th>Encodes</th></tr>
<tr><td>n\u22126</td><td>[26:23]</td><td>total lump size; its growth enlarges Heap</td></tr>
<tr><td>cc</td><td>[7:0]</td><td>12 persisted capability homes, not heap words</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">How Is the Heap Limit Enforced? \u2014 CR5</div>
<p><strong>CR5</strong> is the Heap Golden Token. It is installed by CHANGE each time this thread is resumed. Its two key fields set the hardware boundary:</p>
<table class="sr-table"><tr><th>CR5 field</th><th>Value</th><th>Effect</th></tr>
<tr><td>word1_location</td><td>lumpBase + 18\u00d74 (byte addr)</td><td>Heap base \u2014 first valid byte of Zone \u2463, after protected STO</td></tr>
<tr><td>limit_offset</td><td>heapWords \u2212 1</td><td>Inclusive word count; last valid index from base</td></tr>
</table>
<p>Every <code>DREAD</code> and <code>DWRITE</code> instruction that uses CR5 runs a <strong>TPERM bounds check</strong> before touching memory: <code>offset \u2264 CR5.limit_offset</code>. CR5 starts at word <code>+18</code>, so protected STO at <code>+17</code> is unreachable. A write beyond word <code>18+heapWords\u22121</code> faults immediately \u2014 the heap can never silently overflow into freespace or the stack. The IDE sets <code>heapWords</code> via the <code>cc</code> field in Header[0] (bits [7:0]); CHANGE loads the correct CR5 on every resume; the hardware enforces the ceiling on every access.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Why Fixed at Design Time?</div>
<p>The IDE declares heap size as part of the thread\u2019s capability contract. A thread cannot silently consume unbounded memory \u2014 it must declare its maximum heap at upload time, and Navana enforces that limit at allocation. This makes memory usage auditable before the program runs.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">Object Garbage Collection</div>
<p>Zone \u2463 is <strong>not individually scanned</strong> by the hardware GC. The G-bit mark-and-sweep operates at the <em>Thread object</em> level: when the system GC marks the Thread GT as reachable, the entire lump \u2014 including Zone \u2463 \u2014 is live and untouched. If the Thread GT becomes unreachable, the whole lump is reclaimed at once. All allocation, object layout, compaction, and freeing within Zone \u2463 is a <strong>software concern</strong> left to the thread\u2019s own code running inside the lump.</p></div>`
            },
            {
                title: '\u2464 Data Registers \u2014 The Register File',
                type: 'dr',
                content: `${this._memMap('dr')}
<p>The <strong>first</strong> 16 words of the thread lump (words +1 \u2026 +16, immediately after the header) hold the <strong>Data Register file</strong>: DR0\u2013DR15. These are 32-bit general-purpose registers used by Turing-domain instructions (IADD, ISUB, BFEXT, MCMP, SHL, SHR, DREAD, DWRITE).</p>
<table class="sr-table"><tr><th>Register</th><th>Conventional use</th></tr>
<tr><td>DR0</td><td>Return value \u00b7 first argument</td></tr>
<tr><td>DR1\u2013DR3</td><td>Arguments 2\u20134</td></tr>
<tr><td>DR4</td><td>Local variable (caller-saved)</td></tr>
<tr><td>DR5</td><td><strong>Heap allocation pointer</strong> (by convention) \u00b7 offset from Zone \u2463 base to next free word \u00b7 pairs with CR5 (Heap GT)</td></tr>
<tr><td>DR6\u2013DR11</td><td>Local variables (caller-saved)</td></tr>
<tr><td>DR12\u2013DR15</td><td>Temporaries</td></tr>
</table>
<p>Because the Data Register file always occupies a <strong>fixed position at the head</strong> of the thread lump (word offset +1, immediately after the header word), the CPU derives their physical address at thread-creation time and never recalculates it: <code>lumpBase + 1</code>. This eliminates any runtime pointer arithmetic for register save/restore during CHANGE \u2014 CHANGE writes DR0\u2013DR15 directly to those fixed words and reads them back on resume without walking any indirection chain.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Stack Overrun Prevention \u2014 CR12 + TPERM</div>
<p>Stack overrun is prevented not by a separate spill mechanism but by the <strong>thread stack GT in CR12</strong> together with the <strong>TPERM offset check</strong>. CR12\u2019s NS entry encodes the thread lump\u2019s base and total word count (allocSize). Every stack write goes through a TPERM check that validates the STO-derived offset against those bounds. If the offset would land outside the lump the instruction is blocked before the write occurs \u2014 no frame word is ever placed beyond the allocated region.</p></div>
<div class="sr-key-concept"><div class="sr-concept-title">DREAD / DWRITE</div>
<p>DR registers are addressed by the <strong>DREAD</strong> and <strong>DWRITE</strong> instructions using a Golden Token (like every other memory region). This means a TPERM check runs on every register access \u2014 no register can be read or written without the correct permission bits in the GT.</p></div>`
            },
            {
                title: 'Complete Layout \u2014 Putting It Together',
                type: 'summary',
                content: `${this._memMap(null)}
<p>The full thread lump, from word 0 to <code>allocSize \u2212 1</code>:</p>
<table class="sr-table"><tr><th>Region</th><th>Start</th><th>Size</th><th>Defined by</th></tr>
<tr><td>Header</td><td>word 0</td><td>1 word (fixed)</td><td>0xF900_8240 (magic, typ=10, sw=32, heapWords=cc=64)</td></tr>
<tr><td>\u2464 Data Registers</td><td>word 1</td><td>16 words (fixed)</td><td>Architecture constant (DR0\u2013DR15)</td></tr>
<tr><td>\u25c6 Protected STO</td><td>word 17</td><td>1 word</td><td>Machine-protected FLAGS/SZ/STO indicator; excluded from heap</td></tr>
<tr><td>\u2463 Heap</td><td>word 18</td><td><code>heapWords</code> \u2193</td><td>Header[0] <code>cc</code> field \u00b7 IDE-set</td></tr>
<tr><td>\u2462 Freespace</td><td>18+heapWords</td><td>dynamic</td><td>Residual gap between heap top and stack floor</td></tr>
<tr><td>\u2461 LIFO Stack</td><td><code>244\u2212sw</code> \u2026 <code>243</code></td><td><code>cw/sw</code> words \u2193</td><td>Header <code>cw/sw</code> field \u00b7 cursor STO = 243 (empty)</td></tr>
<tr><td>\u2460 GT Zone (Capabilities)</td><td>word 244</td><td>12 words (architecture-fixed)</td><td>CR0\u2013CR11 at +244\u2026+255; CR12\u2013CR15 are runtime-only</td></tr>
</table>
<p>The Thread header must describe the supported 256-word body. A larger allocation is rejected; words after <code>+255</code> have no defined Thread format, ownership, or access policy.</p>
<div class="sr-key-concept"><div class="sr-concept-title">CR12 \u2014 Thread Stack (Privileged, System-Wide)</div>
<p>Boot step B:02 (INIT_THRD) loads <strong>one</strong> register from NS Slot 1:</p>
<ul>
<li><strong>CR12 \u2014 Thread Stack</strong> (Inform-type, zero perms, Priv zone CR12\u2013CR15). Loaded from NS Slot 1 via mLoad at B:02. CR12 holds the thread stack capability. The actual stack position is tracked by the <strong>cursor register</strong> (hardware-only 32-bit word: NIA[30:16] | STO[15:0]). CR12\u2013CR15 are privileged/runtime registers, not persisted Thread homes; CHANGE persists only CR0\u2013CR11 at +244\u2026+255.</li>
<li>CR8 is programmer-defined (Prog zone CR7\u2013CR11) and carries no architecture-assigned role.</li>
</ul></div>`
            },
            {
                title: 'Thread Lifecycle \u2014 mLoad, CHANGE, and Suspension',
                type: 'lifecycle',
                content: `<p>A thread moves through phases from boot to suspension and back:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Boot \u2014 INIT_THRD (B:02).</strong> <code>sim._bootStep()</code> loads NS Slot 1 into <strong>CR12</strong> (thread stack GT, zero perms, Inform-type) via mLoad. CR12 encodes the lump base and total size; the stack region and heap bounds are derived from this metadata by the hardware. The lump is now the active thread context; CR0\u201311 hold the initial capability set. CR8 is not touched at boot and is available for programmer use.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>mLoad \u2014 GT zone maintenance.</strong> The fixed GT homes mirror persisted CR0\u2013CR11 only: CR<sub>N</sub> maps to <code>+244+N</code>. CR12\u2013CR15 have no Thread-memory homes. No separate \u201csave\u201d step is needed at context-switch time.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>CALL.</strong> Entering any abstraction pushes a <strong>2-word frame (SZ=1)</strong> onto the LIFO stack: slot STO\u22121 = caller\u2019s E-GT Word 0, slot STO+0 = frame word <code>SZ=1 | return_PC[15] | prev_STO[16]</code>. The cursor register\u2019s STO field decreases by 2. LAMBDA pushes a <strong>1-word frame (SZ=0)</strong>: slot STO+0 = frame word <code>SZ=0 | lambda_arg[15] | prev_STO[16]</code>, cursor STO field decreases by 1. Before any write, hardware checks STO against header-derived <code>sp_min=244\u2212cw+2</code> and architecture-fixed <code>sp_max=+243</code> \u2014 a violation raises a fault and blocks the push.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>RETURN.</strong> One memory read: the frame word at cursor STO+0. One register write: the cursor register \u2190 frame word with bit 31 cleared. Both NIA and STO are restored atomically in that single assignment. SZ=1 only: re-derives CR6 and CR14 by revalidating the caller\u2019s E-GT at slot STO\u22121. Applies the MASK literal in the RETURN instruction to clear the specified CRs.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>CHANGE \u2014 Save homes.</strong> Save CR0\u2013CR11 at +244\u2026+255 and DR0\u2013DR15 at +1\u2026+16 only.</div>
<div class="sr-sec-item"><span class="sr-sec-num">6</span><strong>Dormant entry.</strong> Restore those homes, validate CR0, derive executable CR14 from its code LUMP header, and begin at word 1 without a CALL frame.</div>
<div class="sr-sec-item"><span class="sr-sec-num">7</span><strong>Heap allocation &amp; Object GC.</strong> Objects are written into the heap (Zone \u2463) via DWRITE using CR5 (Heap GT). When freespace is exhausted a <code>FAULT [HEAP_FULL]</code> fires. Zone \u2463 is <strong>not individually scanned</strong> by the hardware GC \u2014 the G-bit mark-and-sweep operates at the Thread object level. When the system GC marks the Thread GT as reachable, the entire lump including Zone \u2463 is live; if the Thread GT becomes unreachable, the whole lump is reclaimed at once. All allocation, compaction, and freeing within Zone \u2463 is a <strong>software concern</strong> left to thread code. The simulator\u2019s <strong>Run GC</strong> button provides a manual trigger for interactive demonstration only.</div>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">No Stack Smash, No Heap Spray</div>
<p>Because every region has hardware-enforced bounds derived from immutable NS slot metadata, <strong>buffer overflows, stack smashes, and heap sprays are impossible</strong>. If the stack pointer reaches its limit, the hardware raises <code>STACK_OVERFLOW</code>, suspends the thread, and blocks the write \u2014 the heap is never touched. An attacker cannot forge the GTs in the capability region. All without any OS, runtime check, or compiler mitigation.</p></div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';
        html += '<div class="sr-header">';
        html += '<h2>Thread Abstraction</h2>';
        html += '<p class="sr-tagline">GT Zone \u00b7 LIFO Stack \u00b7 Heap \u00b7 Data Registers \u00b7 mLoad Sync \u00b7 CHANGE Suspension</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="threadTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="threadTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-title">Thread Abstraction Memory Layout</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial walks through the seven memory regions of a Church Machine Thread Abstraction: Header, the data-register file, protected STO, heap, dynamic freespace, LIFO call stack, and fixed GT homes (CR0\u2013CR11). It also covers mLoad\u2019s GT-zone maintenance and how CHANGE suspends and resumes threads.</p>';
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
