class ThreadTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _memMap(highlighted) {
        const sections = [
            { id: 'cap',   label: '\u2460 Capabilities',     sub: 'GT for CR0\u2013CR11  (12 words, fixed)',      bg: '#3a2c00', border: '#c8a020', text: '#f0d060' },
            { id: 'stack', label: '\u2461 FIFO Stack \u2193', sub: 'Expands down \u00b7 limit set by NS slot',     bg: '#002a40', border: '#2080c0', text: '#60b8f0' },
            { id: 'free',  label: '\u2462 Freespace',         sub: 'Dynamic gap \u00b7 shrinks as stack/heap grow',bg: '#181818', border: '#404040', text: '#888'    },
            { id: 'heap',  label: '\u2463 Heap \u2191',       sub: 'Fixed size \u00b7 defined by IDE slot metadata',bg: '#002a10', border: '#20a040', text: '#60d080' },
            { id: 'dr',    label: '\u2464 Data Registers',    sub: 'DR0\u2013DR15  (16 \u00d7 32-bit, fixed at base)', bg: '#1e0840', border: '#8040c0', text: '#b080f0' },
        ];
        const heights = { cap: 72, stack: 96, free: 56, heap: 72, dr: 64 };
        const addrLabels = {
            cap:   'word 0 \u2192',
            stack: 'word 12 \u2192',
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
<p>Reading top-to-bottom (word 0 \u2192 base): <strong>\u2460 Capabilities \u2192 \u2461 Stack \u2192 \u2462 Freespace \u2192 \u2463 Heap \u2192 \u2464 Data Registers</strong>. Every region lives inside the same protected lump; the hardware enforces bounds on every access.</p></div>`
            },
            {
                title: '\u2460 Capabilities \u2014 GT Zone for CR0\u2013CR11',
                type: 'capabilities',
                content: `${this._memMap('cap')}
<p>The top 12 words of the thread lump are the <strong>GT zone</strong>: one 32-bit Golden Token word for each of CR0\u2013CR11. Three of these are <em>architecture-defined</em>; the remaining nine are freely allocated by the programmer.</p>
<table class="sr-table"><tr><th>Word</th><th>CR</th><th>Role</th><th>Controlled by</th></tr>
<tr><td>0</td><td>CR0</td><td>Return value \u00b7 first return GT</td><td><strong>Architecture</strong></td></tr>
<tr><td>1</td><td>CR1</td><td>First argument GT</td><td><strong>Architecture</strong></td></tr>
<tr><td>2</td><td>CR2</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>3</td><td>CR3</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>4</td><td>CR4</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>5</td><td>CR5</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>6</td><td>CR6</td><td>C-list (L-only) \u00b7 set by CALL/RETURN</td><td><strong>Architecture</strong></td></tr>
<tr><td>7</td><td>CR7</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>8</td><td>CR8</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>9</td><td>CR9</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>10</td><td>CR10</td><td>Programmer-defined</td><td>Programmer</td></tr>
<tr><td>11</td><td>CR11</td><td>Programmer-defined</td><td>Programmer</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">mLoad Keeps the GT Zone in Sync</div>
<p>Every time mLoad executes it <strong>writes the loaded GT back into the corresponding GT-zone word</strong> (word N for CR_N). This guarantees the lump\u2019s GT zone always mirrors the live CR registers. When CHANGE suspends the thread, the hardware simply reads the GT zone directly \u2014 no separate save step needed for CR0\u2013CR11.</p></div>`
            },
            {
                title: '\u2461 FIFO Stack \u2014 Grows Downward',
                type: 'stack',
                content: `${this._memMap('stack')}
<p>Immediately after the GT zone, the <strong>FIFO call stack</strong> begins at word 12 and expands <em>downward</em> (toward higher addresses). Each CALL frame pushes two words: the caller\u2019s E-GT (used by RETURN to revalidate and re-derive CR6/CR14) and the MASK-selected CR snapshot. RETURN pops them.</p>
<ul>
<li><strong>Stack top</strong>: word 12 (immediately after the GT zone)</li>
<li><strong>Stack limit</strong>: set by the NS slot field <code>clistStart \u2212 1</code> inside <code>word0_location</code></li>
<li><strong>Overflow</strong>: a hardware fault fires if the stack pointer reaches the limit</li>
<li><strong>2-word call frame</strong>: <code>[caller E-GT \u00b7 MASK\u2019d CR snapshot]</code></li>
</ul>
<table class="sr-table"><tr><th>Frame word</th><th>Contents</th></tr>
<tr><td>word 0</td><td>Caller\u2019s E-GT (revalidated by RETURN to re-derive CR6 + CR14)</td></tr>
<tr><td>word 1</td><td>MASK-selected CR snapshot (up to 12 capability registers, bit N = clear CR_N)</td></tr>
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
<li><strong>GC</strong>: the Garbage Collector (<code>runGC()</code>) reclaims unreachable heap objects and compacts the live set</li>
</ul>
<table class="sr-table"><tr><th>NS word1 field</th><th>Encodes</th></tr>
<tr><td>clistCount (bits 25\u201317)</td><td>Number of heap words reserved</td></tr>
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
<tr><td>DR0</td><td>Return value \u00b7 first argument</td></tr>
<tr><td>DR1\u2013DR3</td><td>Arguments 2\u20134</td></tr>
<tr><td>DR4\u2013DR11</td><td>Local variables (caller-saved)</td></tr>
<tr><td>DR12\u2013DR14</td><td>Temporaries</td></tr>
<tr><td>DR15</td><td>Stack-spill pointer \u00b7 reserved</td></tr>
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
<tr><td>\u2460 GT Zone (Capabilities)</td><td>word 0</td><td>12 words (fixed)</td><td>Architecture constant  (1 word \u00d7 CR0\u2013CR11)</td></tr>
<tr><td>\u2461 FIFO Stack</td><td>word 12</td><td>variable \u2193</td><td>NS slot clistStart field</td></tr>
<tr><td>\u2462 Freespace</td><td>stack bottom</td><td>dynamic</td><td>Remaining after stack + heap</td></tr>
<tr><td>\u2463 Heap</td><td>heap base</td><td>fixed \u2191</td><td>IDE slot metadata (clistCount)</td></tr>
<tr><td>\u2464 Data Registers</td><td>allocSize\u221216</td><td>16 words (fixed)</td><td>Architecture constant (DR0\u2013DR15)</td></tr>
</table>
<div class="sr-key-concept"><div class="sr-concept-title">CR8 \u2014 The Thread Handle</div>
<p>The boot microcode stores the thread\u2019s Golden Token in <strong>CR8</strong> (INIT_THRD step, boot step B:02). The GT\u2019s <code>index</code> field is NS Slot 1. The NS entry at Slot 1 supplies <code>word0_location</code> (lump base address) and <code>word0_limit + 1</code> (allocSize). All five regions are derived from these two values plus the architecture constants above.</p></div>`
            },
            {
                title: 'Thread Lifecycle \u2014 mLoad, CHANGE, and Suspension',
                type: 'lifecycle',
                content: `<p>A thread moves through phases from boot to suspension and back:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Boot \u2014 INIT_THRD (B:02).</strong> <code>sim._bootStep()</code> loads NS Slot 1 into CR8. The lump is now the active thread context. The GT zone (words 0\u201311) holds the initial capability set.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>mLoad \u2014 GT zone maintenance.</strong> Every time mLoad loads a GT into CR_N, it <strong>writes the same GT word back to lump word N</strong>. The GT zone is always a live mirror of CR0\u2013CR11. No separate \u201csave\u201d step is needed at context-switch time.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>CALL.</strong> Entering any abstraction pushes a 2-word frame onto the FIFO stack at word 12+. The CALL instruction checks CR14 bounds, writes <code>[caller E-GT, MASK\u2019d CRs]</code>, and advances the stack pointer by 2.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>RETURN.</strong> Reads the MASK field (12-bit), restores the selected CRs from the frame, re-derives CR6 and CR14 by re-running the NS split on the caller\u2019s E-GT, then jumps to the return address.</div>
<div class="sr-sec-item"><span class="sr-sec-num">5</span><strong>CHANGE \u2014 Suspend &amp; Resume.</strong> CHANGE atomically swaps CR8 for a new thread GT. The outgoing thread\u2019s context is saved in two parts: (a) <strong>the GT zone (CR0\u2013CR11) is already persisted</strong> \u2014 mLoad wrote every GT back to the lump in real time, so no additional save is needed; (b) CHANGE <strong>explicitly saves</strong> the remaining live state: <strong>DR0\u2013DR15</strong> (data registers), <strong>CR14</strong> (the CLOOMC code-segment register), <strong>NAI</strong> (Next Address Index \u2014 the program counter), and <strong>FLAGS</strong> (condition codes). The NS slot is updated only if lump metadata has changed.</div>
<div class="sr-sec-item"><span class="sr-sec-num">6</span><strong>Resume.</strong> CHANGE restores the incoming thread\u2019s saved context from its thread-table entry. CR12 and CR13 (fault/interrupt handlers) are system-wide and are <em>not</em> changed.</div>
<div class="sr-sec-item"><span class="sr-sec-num">7</span><strong>Heap allocation &amp; GC.</strong> Objects are written into the heap via DWRITE using CR9. When freespace is exhausted a <code>FAULT [HEAP_FULL]</code> fires. The <strong>Run GC</strong> button triggers the Garbage Collector, which compacts the live heap set and restores freespace without moving the stack or the GT zone.</div>
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
        html += '<p class="sr-tagline">GT Zone \u00b7 FIFO Stack \u00b7 Heap \u00b7 Data Registers \u00b7 mLoad Sync \u00b7 CHANGE Suspension</p>';
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
            html += '<p>This tutorial walks through the five memory regions of a Church Machine Thread Abstraction: the GT zone (CR0\u2013CR11), the FIFO call stack, the dynamic freespace buffer, the fixed-size heap, and the hardware register file at the base. It also covers mLoad\u2019s GT-zone maintenance and how CHANGE suspends and resumes threads.</p>';
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
