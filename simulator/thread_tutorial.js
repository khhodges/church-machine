class ThreadTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _memMap(highlighted) {
        const sections = [
            { id: 'cap',   label: '\u2460 Capabilities',     sub: 'GT for CR1\u2013CR11  (44 words, fixed)',  bg: '#3a2c00', border: '#c8a020', text: '#f0d060' },
            { id: 'stack', label: '\u2461 FIFO Stack \u2193', sub: 'Expands down \u00b7 limit set by NS slot',  bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { id: 'free',  label: '\u2462 Freespace',         sub: 'Dynamic gap \u00b7 shrinks as stack/heap grow', bg: '#181818', border: '#404040', text: '#888' },
            { id: 'heap',  label: '\u2463 Heap \u2191',       sub: 'Fixed size \u00b7 defined by IDE slot metadata', bg: '#002a10', border: '#20a040', text: '#60d080' },
            { id: 'dr',    label: '\u2464 Data Registers',    sub: 'DR0\u2013DR15  (16 \u00d7 32-bit, fixed at base)',  bg: '#1e0840', border: '#8040c0', text: '#b080f0' },
        ];
        const heights = { cap: 72, stack: 96, free: 56, heap: 72, dr: 64 };
        const addrLabels = {
            cap:   'word 0 \u2192',
            stack: 'word 44 \u2192',
            free:  'stack bottom \u2192',
            heap:  'heap base \u2192',
            dr:    'DR base \u2192',
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
        return html;
    }

    _buildSteps() {
        return [
            {
                title: 'What Is a Thread Abstraction?',
                type: 'intro',
                content: `<p>A <strong>Thread Abstraction</strong> is the Church Machine\u2019s representation of a running computation. Like all abstractions it lives inside a <em>lump</em> (a contiguous block of namespace words), but its internal structure is different from a plain abstraction: it carries both a protected capability set <em>and</em> a live execution context.</p>
<p>The thread is identified by a Golden Token stored in <strong>CR8</strong> during boot. That token points to NS Slot 1, whose metadata defines the lump size and heap limit.</p>
${this._memMap(null)}
<div class="sr-key-concept"><div class="sr-concept-title">Five Regions, One Lump</div>
<p>Reading top-to-bottom (low address \u2192 high address): <strong>\u2460 Capabilities \u2192 \u2461 Stack \u2192 \u2462 Freespace \u2192 \u2463 Heap \u2192 \u2464 Data Registers</strong>. Every region lives inside the same protected lump; the hardware enforces bounds on every access.</p></div>`
            },
            {
                title: '\u2460 Capabilities \u2014 GT for CR1\u2013CR11',
                type: 'capabilities',
                content: `${this._memMap('cap')}
<p>The top of the thread lump holds <strong>11 Golden Token entries</strong>, one for each of CR1\u2013CR11. Each entry is 4 words wide (128 bits), giving a fixed 44-word region at the start of the lump.</p>
<table class="sr-table"><tr><th>Slot</th><th>CR</th><th>Typical contents</th></tr>
<tr><td>0\u20133</td><td>CR1</td><td>Caller\u2019s return capability</td></tr>
<tr><td>4\u20137</td><td>CR2</td><td>Thread-local Constants GT</td></tr>
<tr><td>8\u201311</td><td>CR3</td><td>Thread-local Memory GT</td></tr>
<tr><td>12\u201315</td><td>CR4</td><td>Thread-local I/O device GT</td></tr>
<tr><td>16\u201319</td><td>CR5</td><td>Spare / user-defined</td></tr>
<tr><td>20\u201323</td><td>CR6</td><td>C-list (L-only) for current abstraction</td></tr>
<tr><td>24\u201327</td><td>CR7</td><td>Code segment (X-only)</td></tr>
<tr><td>28\u201331</td><td>CR8</td><td>Thread identity (self-reference)</td></tr>
<tr><td>32\u201335</td><td>CR9</td><td>Heap base GT</td></tr>
<tr><td>36\u201339</td><td>CR10</td><td>Namespace root (R/W admin)</td></tr>
<tr><td>40\u201343</td><td>CR11</td><td>Spare / extended capability</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Why at the Top?</div>
<p>Placing capabilities at word 0 means the GT base address equals the thread lump base. A single add-zero lookup reaches any capability. The fixed 44-word size means the stack always starts at <strong>word 44</strong>, regardless of which thread it is.</p></div>`
            },
            {
                title: '\u2461 FIFO Stack \u2014 Grows Downward',
                type: 'stack',
                content: `${this._memMap('stack')}
<p>Immediately after the capability region, the <strong>FIFO call stack</strong> begins at word 44 and expands <em>downward</em> (toward higher addresses). Each CALL frame pushes two words: the return PC and the caller\u2019s CR snapshot. RETURN pops them.</p>
<ul>
<li><strong>Stack top</strong>: word 44 (just after capabilities)</li>
<li><strong>Stack limit</strong>: set by the NS slot field <code>clistStart \u2212 1</code> inside <code>word0_location</code></li>
<li><strong>Overflow</strong>: a hardware fault fires if the stack pointer reaches the limit</li>
<li><strong>2-word call frame</strong>: <code>[return_PC | packed_CRs]</code></li>
</ul>
<table class="sr-table"><tr><th>Frame word</th><th>Contents</th></tr>
<tr><td>word 0</td><td>Return PC (18-bit instruction address)</td></tr>
<tr><td>word 1</td><td>MASK-selected CR snapshot (up to 12 capability registers)</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">FIFO, Not LIFO</div>
<p>The stack discipline is <strong>First-In First-Out</strong> from the runtime\u2019s perspective: CALL is the entry, RETURN is the exit, and nested calls push sequentially downward. The abstraction model guarantees no frame can be forged or overwritten because all stack words are inside the thread\u2019s lump boundary.</p></div>`
            },
            {
                title: '\u2462 Freespace \u2014 The Dynamic Buffer',
                type: 'freespace',
                content: `${this._memMap('free')}
<p>Between the bottom of the current stack frame and the top of the heap lies <strong>unallocated freespace</strong>. This region shrinks from two directions:</p>
<ul>
<li>\u2193 The <strong>stack grows down</strong> as calls are nested deeper</li>
<li>\u2191 The <strong>heap grows up</strong> as objects are allocated</li>
</ul>
<p>Freespace is not a named region at the hardware level \u2014 it is simply the words between the current stack pointer and the current heap pointer. The IDE sets the initial allocation so that even a fully-populated stack and a full heap leave a small safety margin.</p>
<div class="sr-key-concept"><div class="sr-concept-title">Stack Overflow = Hardware Fault</div>
<p>The NS slot\u2019s limit field is the hardware guard. If the stack pointer exceeds it (i.e., the stack hits the freespace floor), a <code>FAULT [STACK_OVERFLOW]</code> fires before any write occurs. No smash possible \u2014 the hardware stops the access before it corrupts the heap.</p></div>`
            },
            {
                title: '\u2463 Heap \u2014 Fixed-Size Object Store',
                type: 'heap',
                content: `${this._memMap('heap')}
<p>Above the Data Registers, the <strong>heap</strong> holds dynamically-allocated objects. Its size is fixed at thread-creation time by the IDE slot metadata stored in the NS entry\u2019s word1 field (<code>clistCount</code> encodes heap word count for threads).</p>
<ul>
<li><strong>Heap base</strong>: <code>lump base + allocSize \u2212 heapWords \u2212 16</code> (16 = DR region)</li>
<li><strong>Allocation</strong>: objects grow upward from heap base toward freespace</li>
<li><strong>Fixed ceiling</strong>: the heap cannot expand beyond its allocated words</li>
<li><strong>GC</strong>: the Garbage Collector (accessible via <code>runGC()</code>) reclaims unreachable heap objects and compacts the live set</li>
</ul>
<table class="sr-table"><tr><th>NS word1 field</th><th>Encodes</th></tr>
<tr><td>clistCount (bits 26\u201317)</td><td>Number of heap words reserved</td></tr>
<tr><td>limit (bits 16\u20130)</td><td>Total lump word count \u2212 1</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">Why Fixed at Design Time?</div>
<p>The IDE declares heap size as part of the thread\u2019s capability contract. A thread cannot silently consume unbounded memory \u2014 it must declare its maximum heap at upload time, and Navana enforces that limit at allocation. This makes memory usage auditable before the program runs.</p></div>`
            },
            {
                title: '\u2464 Data Registers \u2014 The Register File',
                type: 'dr',
                content: `${this._memMap('dr')}
<p>The final 16 words of the thread lump hold the <strong>Data Register file</strong>: DR0\u2013DR15. These are 32-bit general-purpose registers used by Turing-domain instructions (IADD, ISUB, BFEXT, MCMP, SHL, SHR, DREAD, DWRITE).</p>
<table class="sr-table"><tr><th>Register</th><th>Conventional use</th></tr>
<tr><td>DR0</td><td>Return value / first argument</td></tr>
<tr><td>DR1\u2013DR3</td><td>Arguments 2\u20134</td></tr>
<tr><td>DR4\u2013DR11</td><td>Local variables (caller-saved)</td></tr>
<tr><td>DR12\u2013DR14</td><td>Temporaries</td></tr>
<tr><td>DR15</td><td>Stack-spill pointer / reserved</td></tr>
</table>
<p>Being at the <em>fixed base</em> of the lump means the CPU always knows their addresses: <code>lumpBase + allocSize \u2212 16</code>. No pointer arithmetic needed at runtime.</p>
<div class="sr-key-concept"><div class="sr-concept-title">DREAD / DWRITE</div>
<p>DR registers are addressed by the <strong>DREAD</strong> and <strong>DWRITE</strong> instructions using a Golden Token (like every other memory region). This means a TPERM check runs on every register access \u2014 no register can be read or written without the correct permission bits in the GT.</p></div>`
            },
            {
                title: 'Complete Layout \u2014 Putting It Together',
                type: 'summary',
                content: `${this._memMap(null)}
<p>The full thread lump, from word 0 to <code>allocSize \u2212 1</code>:</p>
<table class="sr-table"><tr><th>Region</th><th>Start</th><th>Size</th><th>Defined by</th></tr>
<tr><td>\u2460 Capabilities</td><td>word 0</td><td>44 words (fixed)</td><td>Architecture constant (11 \u00d7 4)</td></tr>
<tr><td>\u2461 FIFO Stack</td><td>word 44</td><td>variable \u2193</td><td>NS slot clistStart field</td></tr>
<tr><td>\u2462 Freespace</td><td>stack bottom</td><td>dynamic</td><td>Remaining after stack + heap</td></tr>
<tr><td>\u2463 Heap</td><td>heap base</td><td>fixed \u2191</td><td>IDE slot metadata (clistCount)</td></tr>
<tr><td>\u2464 Data Registers</td><td>allocSize\u221216</td><td>16 words (fixed)</td><td>Architecture constant (DR0\u2013DR15)</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">CR8 \u2014 The Thread Handle</div>
<p>The boot microcode stores the thread\u2019s Golden Token in <strong>CR8</strong> (INIT_THRD step, boot step B:02). The GT\u2019s <code>index</code> field is NS Slot 1. The NS entry at Slot 1 supplies <code>word0_location</code> (lump base address) and <code>word0_limit + 1</code> (allocSize). All five regions are derived from these two values plus the architecture constants above.</p></div>`
            },
            {
                title: 'Thread Lifecycle',
                type: 'lifecycle',
                content: `<p>A thread moves through four phases from boot to garbage collection:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Boot \u2014 INIT_THRD (B:02).</strong> <code>sim._bootStep()</code> loads NS Slot 1 into CR8. The lump is now the active thread context. All five regions are ready but empty.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>CALL.</strong> Entering any abstraction pushes a 2-word frame onto the FIFO stack. The CALL instruction checks CR14 bounds, then writes <code>[return_PC, MASK\u2019d CRs]</code> to the stack top. Stack pointer advances by 2.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>RETURN.</strong> The RETURN instruction reads the MASK field (12-bit), restores the selected CRs from the frame, and jumps to return_PC. Stack pointer retreats by 2.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>Heap allocation.</strong> New objects are written into the heap region via DWRITE (with a heap-GT stored in CR9). The heap pointer advances. When freespace is exhausted, a <code>FAULT [HEAP_FULL]</code> fires before any overwrite.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>GC.</strong> The Church Machine\u2019s Garbage Collector (<strong>Run GC</strong> button) scans the heap for unreachable objects, compacts the live set, and updates all in-heap GTs. Freespace is restored without moving the stack or the capability region.</div>
</div>
<div class="sr-key-concept"><div class="sr-concept-title">No Stack Smash, No Heap Spray</div>
<p>Because every region has hardware-enforced bounds derived from immutable NS slot metadata, <strong>buffer overflows, stack smashes, and heap sprays are impossible</strong>. An attacker cannot push the stack pointer past its limit, cannot write past the heap ceiling, and cannot forge the GTs in the capability region \u2014 all without any OS, runtime check, or compiler mitigation.</p></div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';
        html += '<div class="sr-header">';
        html += '<h2>Thread Abstraction</h2>';
        html += '<p class="sr-tagline">Capabilities &bull; FIFO Stack &bull; Heap &bull; Data Registers &bull; Hardware-Enforced Layout</p>';
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
            html += '<p>This tutorial walks through the five memory regions of a Church Machine Thread Abstraction: its fixed capability set, the FIFO call stack, the dynamic freespace buffer, the fixed-size heap, and the hardware register file at the base.</p>';
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
