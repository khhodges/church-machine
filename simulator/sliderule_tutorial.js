class SlideRuleTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "The Church Turing Machine: Solving Lethal Autonomous Weapons",
                type: "intro",
                content: `<p>The root cause of modern computer insecurity is in the hardware. Conventional processors grant every program <strong>shared access rights to physical memory</strong> &mdash; any running code can read or write any address the hardware can reach. This single design flaw forces the entire industry to build centralised operating systems and privileged monitors that attempt to <em>restrict</em> what programs can do after the fact.</p>
<p>The result is <strong>ambient authority</strong>: programs run with broad permissions granted by the operating system, and security is enforced by checking identity rather than capability. A web browser, a text editor, and a cryptocurrency wallet all execute under the same user account, with the same file system access. Because the underlying hardware does not enforce boundaries, every layer of software protection &mdash; access-control lists, process isolation, sandboxes &mdash; is easily bypassed, as the global epidemic of malware proves daily. Lethal autonomous weapons go even further: <strong>lethal autonomous software</strong> is the ultimate threat of the information age.</p>
<p>The Church Machine takes a different approach, building on the capability-based addressing model first proposed by Dennis and Van Horn (1966) and first implemented in hardware by the Plessey System 250 (PP250) (Halton, 1972). Every memory access &mdash; every read, every write, every function call &mdash; requires an <strong>unforgeable capability token</strong>. There is no operating system. There is no privileged mode. There is no superuser. Authority is not ambient &mdash; it is carried by tokens that the hardware itself validates on every cycle.</p>
<p>The broader case for why this architectural revolution is necessary is developed in Hamer-Hodges: <em>Civilizing Cyberspace</em> (2024), <em>The Fate of AI Society</em> (2023), and <em>Winning World War III</em> (2025). These works expose the serious problems posed by <strong>lethal autonomous weapons</strong> &mdash; systems that select and engage targets without meaningful human control &mdash; built on the same fundamentally insecure hardware. Without capability-secured architecture, the danger does not end with weapons: it extends to <strong>lethal autonomous software</strong> throughout the information age, where unsecured programs controlling critical infrastructure, medical systems, transport, and finance inherit the same bypassable protections and can cause catastrophic harm at machine speed.</p>`
            },
            {
                title: "What You Will Learn",
                type: "overview",
                content: `<div class="sr-objectives">
<div class="sr-obj-item"><span class="sr-obj-num">1</span>The 20-instruction Church Machine architecture</div>
<div class="sr-obj-item"><span class="sr-obj-num">2</span>How the CLOOMC++ compiler targets it from JavaScript and Haskell</div>
<div class="sr-obj-item"><span class="sr-obj-num">3</span>A side-by-side comparison of the SlideRule abstraction in both languages</div>
<div class="sr-obj-item"><span class="sr-obj-num">4</span>Performance analysis on the Tang Nano 20K FPGA (27 MHz)</div>
<div class="sr-obj-item"><span class="sr-obj-num">5</span>Why the CLOOMC++ compiler can produce incorrect programs but never insecure ones</div>
<div class="sr-obj-item"><span class="sr-obj-num">6</span>How to write and compile your own abstraction</div>
</div>
<p class="sr-hardware">Target: Sipeed Tang Nano 20K &mdash; Gowin GW2AR-18 FPGA, QN88 package, 20,736 LUTs, 27 MHz clock. Synthesised with Amaranth HDL and oss-cad-suite.</p>`
            },
            {
                title: "The 20-Instruction Set",
                type: "architecture",
                content: `<p>The Church Machine has exactly 20 instructions, divided into two domains:</p>
<div class="sr-two-col">
<div class="sr-col">
<div class="sr-col-title">Church Domain (capability)</div>
<table class="sr-table"><tr><th>Op</th><th>Instruction</th><th>Purpose</th></tr>
<tr><td>0</td><td>LOAD</td><td>Load GT from c-list</td></tr>
<tr><td>1</td><td>SAVE</td><td>Save GT to c-list</td></tr>
<tr><td>2</td><td>CALL</td><td>Enter abstraction via E-GT</td></tr>
<tr><td>3</td><td>RETURN</td><td>Return from abstraction</td></tr>
<tr><td>4</td><td>CHANGE</td><td>Replace capability</td></tr>
<tr><td>5</td><td>SWITCH</td><td>Switch execution context</td></tr>
<tr><td>6</td><td>TPERM</td><td>Reduce token permissions</td></tr>
<tr><td>7</td><td>LAMBDA</td><td>Invoke a method</td></tr>
<tr><td>8</td><td>ELOADCALL</td><td>Fused load-and-call</td></tr>
<tr><td>9</td><td>XLOADLAMBDA</td><td>Fused load-and-lambda</td></tr>
</table>
</div>
<div class="sr-col">
<div class="sr-col-title">Turing Domain (data)</div>
<table class="sr-table"><tr><th>Op</th><th>Instruction</th><th>Purpose</th></tr>
<tr><td>10</td><td>DREAD</td><td>Read from data memory</td></tr>
<tr><td>11</td><td>DWRITE</td><td>Write to data memory</td></tr>
<tr><td>12</td><td>BFEXT</td><td>Extract a bitfield</td></tr>
<tr><td>13</td><td>BFINS</td><td>Insert a bitfield</td></tr>
<tr><td>14</td><td>MCMP</td><td>Compare (set flags)</td></tr>
<tr><td>15</td><td>IADD</td><td>Integer addition</td></tr>
<tr><td>16</td><td>ISUB</td><td>Integer subtraction</td></tr>
<tr><td>17</td><td>BRANCH</td><td>Conditional branch</td></tr>
<tr><td>18</td><td>SHL</td><td>Shift left</td></tr>
<tr><td>19</td><td>SHR</td><td>Shift right</td></tr>
</table>
</div>
</div>
<p>RETURN (opcode 3) is shared by both domains.</p>`
            },
            {
                title: "Instruction Encoding & Domain Purity",
                type: "architecture",
                content: `<p>Every instruction is 32 bits wide:</p>
<pre class="sr-encoding">31    27 26  23 22  19 18  15 14           0
|opcode | cond |  dst |  src |    imm15    |
| 5 bit | 4 bit| 4 bit| 4 bit|   15 bits   |</pre>
<p>All instructions support ARM-style <strong>conditional execution</strong> via the 4-bit condition field (EQ, NE, CS, CC, MI, PL, etc.). This lets the compiler generate branchless code for simple conditionals.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Domain Purity Invariant</div>
<p>The architecture enforces strict separation:</p>
<ul>
<li><strong>Turing permissions:</strong> R (read), W (write), X (execute)</li>
<li><strong>Church permissions:</strong> L (load), S (save), E (enter)</li>
</ul>
<p>Mixing domains &mdash; attempting to Read a capability or Execute a c-list &mdash; triggers an immediate <strong>hardware fault</strong>. Code is data (Turing domain), capabilities are authority (Church domain), and never shall the two be confused.</p>
</div>`
            },
            {
                title: "Golden Tokens",
                type: "architecture",
                content: `<p>A Golden Token (GT) is a 32-bit unforgeable capability:</p>
<pre class="sr-encoding">31        25 24          8 7      2 1  0
| version  |    index    | perms  |type|
|  7 bits  |   17 bits   | 6 bits |2 b |</pre>
<table class="sr-table sr-table-wide"><tr><th>Field</th><th>Bits</th><th>Purpose</th></tr>
<tr><td>Version</td><td>7</td><td>Anti-replay counter. Revoking increments version &mdash; all copies instantly invalid.</td></tr>
<tr><td>Index</td><td>17</td><td>Points to a namespace entry (128K possible entries).</td></tr>
<tr><td>Permissions</td><td>6</td><td>R, W, X, L, S, E.</td></tr>
<tr><td>Type</td><td>2</td><td>00=NULL, 01=Inform (memory via NS), 10=Outform (remote), 11=Abstract (GT <em>is</em> value).</td></tr>
</table>
<div class="sr-key-concept">
<div class="sr-concept-title">Instant Revocation</div>
<p>Incrementing a token's version in the namespace entry invalidates every copy of every derived token immediately. No garbage collection of permissions, no race condition, no eventually-consistent revocation. The next mLoad that presents the old version faults.</p>
</div>`
            },
            {
                title: "Abstractions & the Single-Lump Model",
                type: "architecture",
                content: `<p>An abstraction is the fundamental security block. Each occupies a single contiguous memory region called a <em>lump</em>, described by one namespace (NS) entry:</p>
<pre class="sr-encoding">NS Entry:
  word0: location (base address of lump)
  word1: B|F|G|chain|type|clistCount|limit
  word2: version | FNV seal</pre>
<div class="sr-lump-diagram">
<div class="sr-lump-region sr-lump-code">Code (Turing domain, X) &larr; CR7</div>
<div class="sr-lump-region sr-lump-free">FREESPACE (inaccessible)</div>
<div class="sr-lump-region sr-lump-clist">C-list (Church domain, L) &larr; CR6</div>
</div>
<p>When CALL enters an abstraction, it reads <code>clistCount</code> from word1 and splits the lump:</p>
<ul>
<li><strong>CR7 (code):</strong> base address, limit = clistStart - 1, permissions = <strong>X only</strong></li>
<li><strong>CR6 (c-list):</strong> base + clistStart, limit = clistCount - 1, permissions = <strong>L only</strong></li>
</ul>
<p>These permissions are <strong>architecturally hardcoded</strong> by CALL. Code cannot read its own capabilities (no GT leakage) and capabilities cannot be executed as code (no injection).</p>`
            },
            {
                title: "The CLOOMC++ Compiler",
                type: "compiler",
                content: `<p>CLOOMC++ is a multi-language compiler with a single back-end. Both front-ends produce the same output: arrays of 32-bit Church Machine instruction words.</p>
<div class="sr-compiler-diagram">
<div class="sr-comp-input">JavaScript source</div>
<div class="sr-comp-input">Haskell source</div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-core">CLOOMC++ Compiler<br><small>Resident Object Model</small></div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-output">32-bit code words &rarr; upload.json</div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">Resident Object Model</div>
<p>The compiler maintains a mapping of abstraction names to c-list offsets. When a program declares <code>capabilities { Constants }</code>, the compiler knows Constants occupies slot 0. A call to <code>Constants.Pi()</code> compiles to LOAD from c-list offset 0 + CALL.</p>
<p>The c-list <em>is</em> the compiler's symbol table for external references. The capabilities declared in source are exactly those wired into the lump. There is no separate linking phase.</p>
</div>`
            },
            {
                title: "Register Allocation & Upload Format",
                type: "compiler",
                content: `<p>The Church Machine provides 16 data registers:</p>
<table class="sr-table sr-table-wide"><tr><th>Registers</th><th>Purpose</th><th>Saved by</th></tr>
<tr><td>DR0&ndash;DR3</td><td>Arguments and return values</td><td>Caller</td></tr>
<tr><td>DR4&ndash;DR11</td><td>Local variables</td><td>Callee</td></tr>
<tr><td>DR12&ndash;DR15</td><td>Temporaries (compiler scratch)</td><td>Caller</td></tr>
</table>
<p>The compiler output is a JSON structure consumed by <code>Navana.Abstraction.Add</code>:</p>
<pre class="sr-code">{
  "abstraction": "SlideRule",
  "type": "abstraction",
  "grants": ["E"],
  "capabilities": [
    { "target": 18, "name": "Constants", "grants": ["E"] }
  ],
  "methods": [
    { "name": "Add", "code": ["0x7f600000", ...] },
    { "name": "Sub", "code": ["0x87600000", ...] }
  ]
}</pre>
<p>Navana validates the upload (bounds checking, capability delegation, integer overflow protection), allocates a power-of-2 lump, writes code + c-list, creates the NS entry, and forges an Inform E-GT back to the creator.</p>`
            },
            {
                title: "JavaScript SlideRule",
                type: "code",
                lang: "js",
                content: `<p>The JavaScript front-end uses an imperative style with explicit control flow. 8 methods, 110 lines:</p>
<pre class="sr-code sr-code-js">abstraction SlideRule {
    capabilities { Constants }

    method Add(a, b) {
        result = a + b
        return(result)
    }

    method Sub(a, b) {
        result = a - b
        return(result)
    }

    method Mul(a, b) {
        acc = 0
        sign = 0
        if (b &lt; 0) {
            b = 0 - b
            sign = 1
        }
        while (b &gt; 0) {
            low = bfext(b, 0, 1)
            if (low == 1) {
                acc = acc + a
            }
            a = a &lt;&lt; 1
            b = b &gt;&gt; 1
        }
        if (sign == 1) {
            acc = 0 - acc
        }
        return(acc)
    }

    method Div(a, b) {
        if (b == 0) { return(0) }
        sign = 0
        if (a &lt; 0) { a = 0 - a; sign = sign + 1 }
        if (b &lt; 0) { b = 0 - b; sign = sign + 1 }
        quot = 0
        while (a &gt;= b) {
            a = a - b
            quot = quot + 1
        }
        if (sign == 1) { quot = 0 - quot }
        return(quot)
    }
    // + Sqrt, Pow, ToDegrees, ToRadians
}</pre>
<p><strong>Key characteristics:</strong> Explicit <code>while</code> loops, manual shift-and-add for Mul, repeated subtraction for Div, bitfield extraction via <code>bfext()</code>.</p>`
            },
            {
                title: "Haskell SlideRule",
                type: "code",
                lang: "hs",
                content: `<p>The Haskell front-end uses a functional style with expression-based methods. 9 methods:</p>
<pre class="sr-code sr-code-hs">abstraction SlideRuleHS {
    capabilities { Constants }

    method Add(a, b) = a + b
    method Sub(a, b) = a - b
    method Mul(a, b) = a * b

    method Sqrt(n) = if n &lt; 1 then 0
                     else if n &lt; 4 then 1
                     else if n &lt; 9 then 2
                     else if n &lt; 16 then 3
                     ...else 10

    method Pow2(exp) = if exp == 0 then 1
                       else if exp == 1 then 2
                       else if exp == 2 then 4
                       ...else 256

    method Abs(n) = if n &lt; 0 then 0 - n else n

    method Signum(n) = if n == 0 then 0
                       else if n &gt; 0 then 1
                       else 0 - 1

    method Max(a, b) = if a &gt; b then a else b
    method Min(a, b) = if a &lt; b then a else b

    method Clamp(x, lo, hi) = if x &lt; lo then lo
                              else if x &gt; hi then hi
                              else x
}</pre>
<p><strong>Key characteristics:</strong> Each method is a single expression. Pattern-matching via <code>if/then/else</code> compiles to MCMP + BRANCH chains. Sqrt and Pow2 use conditional lookup tables &mdash; correct for values in range. The <code>*</code> operator expands to repeated addition.</p>`
            },
            {
                title: "Compiled Output Comparison",
                type: "comparison",
                content: `<p><strong>Semantically equivalent methods</strong> (produce identical results):</p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>JS (instr)</th><th>HS (instr)</th><th>HS Reduction</th><th>Semantics</th></tr>
<tr><td>Add</td><td>5</td><td>4</td><td>20%</td><td>Identical: a + b</td></tr>
<tr><td>Sub</td><td>4</td><td>3</td><td>25%</td><td>Identical: a - b</td></tr>
</table>
<p><strong>Semantically different methods</strong> (same name, different algorithms):</p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>JS</th><th>HS</th><th>JS Algorithm</th><th>HS Algorithm</th></tr>
<tr><td>Mul</td><td>35</td><td>8</td><td>Shift-and-add O(log n) &check;</td><td>Repeated addition O(n) &check;</td></tr>
<tr><td>Sqrt</td><td>38</td><td>27</td><td>Newton-Raphson iteration &check;</td><td>Conditional lookup table &check;</td></tr>
<tr><td>Pow/Pow2</td><td>29</td><td>19</td><td>General base^exp loop &check;</td><td>2^exp lookup table &check;</td></tr>
</table>
<p><strong>Haskell-only methods</strong> (all correct):</p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>Instructions</th><th>Correct</th></tr>
<tr><td>Abs</td><td>13</td><td>&check;</td></tr>
<tr><td>Signum</td><td>25</td><td>&check;</td></tr>
<tr><td>Max</td><td>10</td><td>&check;</td></tr>
<tr><td>Min</td><td>10</td><td>&check;</td></tr>
<tr><td>Clamp</td><td>18</td><td>&check;</td></tr>
</table>
<div class="sr-totals">
<div class="sr-total-item"><strong>JavaScript:</strong> 8 methods, 153 instructions, 612 bytes</div>
<div class="sr-total-item"><strong>Haskell:</strong> 11 methods, 151 instructions, 604 bytes</div>
<div class="sr-total-note">Haskell: 37.5% more methods in 1.3% less code &mdash; but JS has correct algorithms for all methods.</div>
</div>`
            },
            {
                title: "Disassembly: Add (JS vs Haskell)",
                type: "disassembly",
                content: `<div class="sr-two-col">
<div class="sr-col">
<div class="sr-col-title">JavaScript Add(a, b) &mdash; 5 instructions</div>
<pre class="sr-asm">0: IADD.AL DR12, DR0, #0   ; DR12 = a
1: IADD.AL DR12, DR12, #0  ; DR12 += b
2: IADD.AL DR4, DR12, #0   ; result = DR12
3: IADD.AL DR0, DR4, #0    ; DR0 = result
4: RETURN.AL                ; return</pre>
</div>
<div class="sr-col">
<div class="sr-col-title">Haskell Add(a, b) = a + b &mdash; 4 instructions</div>
<pre class="sr-asm">0: IADD.AL DR12, DR0, #0   ; DR12 = a
1: IADD.AL DR12, DR0, #0   ; DR12 = a + b
2: IADD.AL DR0, DR12, #0   ; DR0 = result
3: RETURN.AL                ; return</pre>
</div>
</div>
<p>Haskell saves one instruction &mdash; it does not allocate an explicit local variable (<code>result</code>). The functional compiler knows <code>a + b</code> yields the return value directly.</p>`
            },
            {
                title: "Disassembly: Mul (the dramatic difference)",
                type: "disassembly",
                content: `<p>JavaScript's Mul is <strong>35 instructions</strong>: an explicit shift-and-add loop with sign handling, bitfield extraction, accumulation, and conditional negation.</p>
<p>Haskell's <code>a * b</code> is <strong>8 instructions</strong>:</p>
<pre class="sr-asm">0: IADD.AL  DR12, DR0, #0   ; DR12 = a (accumulator)
1: MCMP.AL  DR1, DR0, #0    ; compare b to 0
2: BRANCH.EQ  #6            ; if b == 0, done
3: IADD.AL  DR12, DR12, #0  ; acc += a
4: ISUB.AL  DR1, DR1, #1    ; b -= 1
5: BRANCH.AL  #1            ; loop back
6: IADD.AL  DR0, DR12, #0   ; DR0 = result
7: RETURN.AL                 ; return</pre>
<div class="sr-key-concept">
<div class="sr-concept-title">Smaller Code &ne; Faster Execution</div>
<p>For <code>Mul(7, 100)</code>:</p>
<ul>
<li><strong>JavaScript:</strong> shift-and-add runs 7 iterations (ceil(log2(100))). ~8 instr/iter = <strong>~56 dynamic instructions</strong></li>
<li><strong>Haskell:</strong> repeated addition runs 100 iterations. ~4 instr/iter = <strong>~400 dynamic instructions</strong></li>
</ul>
<p>JavaScript is <strong>7x faster</strong> despite having 4x more static code.</p>
</div>`
            },
            {
                title: "Disassembly: Clamp (Haskell's expressiveness)",
                type: "disassembly",
                content: `<p><code>if x &lt; lo then lo else if x &gt; hi then hi else x</code> compiles to 18 instructions using chained MCMP + BRANCH:</p>
<pre class="sr-asm"> 0: MCMP.AL  DR0, DR1, #0    ; compare x to lo
 1: IADD.LT  DR12, DR0, #1   ; flag = 1 if x &lt; lo
 2: IADD.GE  DR12, DR0, #0   ; flag = 0 if x &gt;= lo
 3: MCMP.AL  DR12, DR0, #0   ; test flag
 4: BRANCH.EQ  #7            ; if not less, check upper
 5: IADD.AL  DR12, DR1, #0   ; result = lo
 6: BRANCH.AL  #16           ; jump to return
 7: MCMP.AL  DR0, DR2, #0    ; compare x to hi
 8: IADD.GT  DR12, DR0, #1   ; flag = 1 if x &gt; hi
 9: IADD.LE  DR12, DR0, #0   ; flag = 0 if x &lt;= hi
10: MCMP.AL  DR12, DR0, #0   ; test flag
11: BRANCH.EQ  #14           ; if not greater, use x
12: IADD.AL  DR12, DR2, #0   ; result = hi
13: BRANCH.AL  #15           ; jump to return
14: IADD.AL  DR12, DR0, #0   ; result = x
15: IADD.AL  DR12, DR12, #0  ; (identity)
16: IADD.AL  DR0, DR12, #0   ; DR0 = result
17: RETURN.AL                 ; return</pre>
<p>Note <strong>conditional IADD</strong> (lines 1-2 and 8-9): <code>IADD.LT</code> and <code>IADD.GE</code> execute based on flags set by MCMP. ARM-style predicated execution &mdash; both paths encoded, only one fires.</p>`
            },
            {
                title: "Performance: Static Code Size",
                type: "performance",
                content: `<p>On the Tang Nano 20K, each instruction is one 32-bit word (4 bytes):</p>
<table class="sr-table sr-table-wide"><tr><th>Implementation</th><th>Methods</th><th>Instructions</th><th>Code Size</th><th>Lump Size</th></tr>
<tr><td>JavaScript</td><td>8</td><td>153</td><td>612 bytes</td><td>1024 bytes</td></tr>
<tr><td>Haskell</td><td>11</td><td>151</td><td>604 bytes</td><td>1024 bytes</td></tr>
</table>
<p>Both fit in a 1024-byte lump (256 words). Lump allocation is power-of-2, so both versions occupy the same physical memory despite Haskell being slightly smaller.</p>
<p><strong>Execution time:</strong> 1 instruction/cycle at 27 MHz = ~37 ns per instruction.</p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>JS Cycles</th><th>JS Time</th><th>HS Cycles</th><th>HS Time</th></tr>
<tr><td>Add</td><td>5</td><td>185 ns</td><td>4</td><td>148 ns</td></tr>
<tr><td>Sub</td><td>4</td><td>148 ns</td><td>3</td><td>111 ns</td></tr>
</table>`
            },
            {
                title: "The Code Size vs. Runtime Trade-off",
                type: "performance",
                content: `<table class="sr-table sr-table-wide"><tr><th>Property</th><th>JavaScript</th><th>Haskell</th></tr>
<tr><td>Source lines</td><td>110</td><td>38</td></tr>
<tr><td>Static code size</td><td>153 instructions</td><td>151 instructions</td></tr>
<tr><td>Algorithmic sophistication</td><td>High (bit-level)</td><td>Low (expressions)</td></tr>
<tr><td>Worst-case runtime</td><td>O(log n) for Mul</td><td>O(n) for Mul</td></tr>
<tr><td>Programmer effort</td><td>High (manual algorithms)</td><td>Low (declarative)</td></tr>
<tr><td>Debugging difficulty</td><td>High (loop state)</td><td>Low (pure expressions)</td></tr>
</table>
<div class="sr-key-concept">
<div class="sr-concept-title">The Fundamental Trade-off</div>
<p>Haskell is more concise and easier to reason about. JavaScript can encode more efficient algorithms because the programmer has direct access to bitfield operations and explicit loop control.</p>
<p>Both compile to the same 20 instructions. The Church Machine does not favour one paradigm over another.</p>
</div>`
            },
            {
                title: "Security: What the Compiler Cannot Do",
                type: "security",
                content: `<p>Regardless of language or compilation strategy, the CLOOMC++ compiler <strong>cannot</strong>:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Forge a Golden Token.</strong> Tokens are created only by Mint.Create (via Navana). The compiler produces Turing-domain code words &mdash; no access to Church-domain token creation.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>Escape the lump.</strong> CALL hardcodes CR7 boundaries. Out-of-bounds branches trigger a hardware fault.</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span><strong>Read its own capabilities.</strong> CR6 has L-only permission. DREAD on the c-list faults. LOAD reads GTs into capability registers, not data registers.</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span><strong>Access undeclared abstractions.</strong> The c-list contains exactly the declared capabilities. If you don't declare Memory, no instruction sequence can reach it.</div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">The Architectural Insight</div>
<p>The compiler can produce <strong>incorrect</strong> programs but cannot produce <strong>insecure</strong> ones. A buggy compiler gives wrong answers within the correct security perimeter. The capability model constrains from below.</p>
</div>`
            },
            {
                title: "Security: The C-List as Authority",
                type: "security",
                content: `<p>The <code>capabilities { Constants }</code> declaration is not merely a compiler directive &mdash; it is a <strong>security declaration</strong>. When Navana processes the upload, it:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span>Verifies the creator holds a valid GT for the Constants abstraction</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span>Checks the creator has sufficient permissions to delegate E access</div>
<div class="sr-sec-item"><span class="sr-sec-num">3</span>Writes the Constants E-GT into the lump's c-list region</div>
<div class="sr-sec-item"><span class="sr-sec-num">4</span>Sets <code>clistCount = 1</code> in the NS entry's word1</div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">Parental Approval Made Concrete</div>
<p>The c-list is parental approval made concrete. A child cannot grant their abstraction access to resources the parent has not provided. Revoking a GT (incrementing version) instantly cuts access &mdash; all copies become invalid.</p>
</div>`
            },
            {
                title: "Advantages",
                type: "pros",
                content: `<div class="sr-pros-list">
<div class="sr-pro-item">
<div class="sr-pro-title">Hardware-enforced security</div>
<p>The mLoad/mSave validation pipeline runs on every memory access in hardware. No debug mode, no privileged instruction, no escape hatch. Verifiable by inspection of the HDL, not analysis of unbounded software.</p>
</div>
<div class="sr-pro-item">
<div class="sr-pro-title">Instant capability revocation</div>
<p>Increment the version &rarr; every copy of every derived token is instantly invalid. No garbage collection of permissions, no race condition.</p>
</div>
<div class="sr-pro-item">
<div class="sr-pro-title">Language independence</div>
<p>The 20 instructions are a universal substrate. JS and Haskell both compile to it. Any language with variables, arithmetic, conditionals, and function calls can target it.</p>
</div>
<div class="sr-pro-item">
<div class="sr-pro-title">Scale-free security</div>
<p>The same model that protects a child's homework from a sibling works unchanged for enterprise security, IoT isolation, or multi-tenant cloud.</p>
</div>
<div class="sr-pro-item">
<div class="sr-pro-title">Auditable simplicity</div>
<p>20 instructions. 3-word NS entries. 32-bit tokens. A motivated undergraduate can understand the entire architecture in a semester.</p>
</div>
</div>`
            },
            {
                title: "Limitations (with Objections)",
                type: "cons",
                content: `<div class="sr-cons-list">
<div class="sr-con-item">
<div class="sr-con-title">No hardware multiply or divide</div>
<p>Mul requires 35-instruction shift-and-add (JS) or 8-instruction repeated addition (HS). Division takes 40 instructions.</p>
<p class="sr-objection"><strong>Objection:</strong> Deliberate design choice. The Tang Nano 20K has limited LUTs (20,736). A hardware multiplier consumes significant area. The ISA can be extended with MUL/DIV while preserving the security model.</p>
</div>
<div class="sr-con-item">
<div class="sr-con-title">No floating-point arithmetic</div>
<p>The SlideRule cannot compute trig or logarithms to floating-point precision.</p>
<p class="sr-objection"><strong>Objection:</strong> Fixed-point (Q16.16) can be implemented with IADD/ISUB/SHL/SHR. Lambda Calculus layer can represent arbitrary precision via Church numerals.</p>
</div>
<div class="sr-con-item">
<div class="sr-con-title">25-bit seal</div>
<p>~33 million values. Brute-force collision feasible on fast hardware.</p>
<p class="sr-objection"><strong>Objection:</strong> At 27 MHz, brute-force takes hours. The seal is tamper-detection, not cryptographic barrier. Width can be increased in production.</p>
</div>
<div class="sr-con-item">
<div class="sr-con-title">Register pressure</div>
<p>16 data registers. Complex algorithms can exhaust the register file.</p>
<p class="sr-objection"><strong>Objection:</strong> Register spilling via DWRITE/DREAD is a compiler limitation, not architectural. DR4-DR11 (8 locals) + DR12-DR15 (4 temps) suffices for most educational examples.</p>
</div>
<div class="sr-con-item">
<div class="sr-con-title">Single-issue pipeline</div>
<p>~1,000x slower than a modern desktop CPU for raw computation.</p>
<p class="sr-objection"><strong>Objection:</strong> The Church Machine deliberately avoids superscalar/speculative execution &mdash; these are attack surfaces (Spectre, Meltdown). The simple pipeline eliminates this entire class of attack.</p>
</div>
<div class="sr-con-item">
<div class="sr-con-title">Haskell lacks iterative algorithms</div>
<p>Sqrt and Pow2 use conditional lookup tables rather than iterative Newton-Raphson or shift-and-multiply. Division is omitted entirely from the Haskell version.</p>
<p class="sr-objection"><strong>Objection:</strong> The Haskell front-end compiles pure expressions without loop support. Lookup tables are correct within their defined range. The JS front-end handles the full iterative algorithms. Recursion support is future work.</p>
</div>
</div>`
            },
            {
                title: "The Universal Target Argument",
                type: "conclusion",
                content: `<p>The fact that both JavaScript and Haskell compile to the same 20 instructions is not merely a compiler trick &mdash; it is a demonstration of <strong>computational universality</strong>.</p>
<ul>
<li>The instruction set is <strong>Turing-complete</strong> (conditional branching + memory access)</li>
<li>The instruction set is <strong>Church-complete</strong> (LAMBDA + CALL)</li>
<li>Any computable function can be expressed in these 20 instructions</li>
</ul>
<div class="sr-key-concept">
<div class="sr-concept-title">Separation of Concerns</div>
<p>The programmer writes in a comfortable notation. The compiler reduces it to the universal substrate. The hardware enforces security at every instruction.</p>
<p><strong>Expressiveness at the top, security at the bottom.</strong></p>
</div>`
            },
            {
                title: "Try It: Write Your Own Abstraction",
                type: "tutorial",
                content: `<div class="sr-tutorial-steps">
<div class="sr-tut-step">
<span class="sr-tut-num">1</span>
<div><strong>Write the source.</strong> Open the <strong>Code</strong> tab and type:</div>
<pre class="sr-code sr-code-js">abstraction MyMath {
    capabilities { Constants }
    method Double(n) {
        result = n + n
        return(result)
    }
    method Square(n) {
        acc = 0
        i = n
        while (i > 0) {
            acc = acc + n
            i = i - 1
        }
        return(acc)
    }
}</pre>
<p>Or in Haskell:</p>
<pre class="sr-code sr-code-hs">abstraction MyMath {
    capabilities { Constants }
    method Double(n) = n + n
    method Square(n) = n * n
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">2</span>
<div><strong>Compile.</strong> Click the gold <strong>CLOOMC++</strong> button. The compiler auto-detects the language.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">3</span>
<div><strong>Inspect.</strong> Verify each method ends with RETURN, branch targets are in bounds, and capability count matches declarations.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">4</span>
<div><strong>Save.</strong> Click the blue <strong>Save Upload JSON</strong> button to download the upload file.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">5</span>
<div><strong>Create.</strong> Click <strong>Boot</strong>, then <strong>Create Abstraction</strong>. Navana allocates the lump and forges an E-GT.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">6</span>
<div><strong>Test.</strong> Switch to the <strong>REPL</strong> tab and call your methods.</div>
</div>
</div>`
            },
            {
                title: "Conclusion & References",
                type: "conclusion",
                content: `<p>The Church Machine demonstrates that security and computation can be separated at the hardware level. The 20-instruction set provides a universal computation substrate &mdash; any language can target it, and the security model holds regardless of what the compiler produces.</p>
<p>The architecture is intentionally minimal. It sacrifices raw performance for verifiable security. It sacrifices instruction set richness for auditable simplicity. It sacrifices compiler optimisation for a one-semester learning curve.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">The Church Machine's Answer</div>
<p>"Who can access my data?" is not a policy, not a configuration file, not a permission dialog. It is a hardware gate that checks an unforgeable token on every memory access, every cycle, without exception.</p>
</div>
<div class="sr-references">
<div class="sr-ref-title">References</div>
<ol>
<li>Dennis &amp; Van Horn (1966). "Programming Semantics for Multiprogrammed Computations." <em>CACM</em> 9(3).</li>
<li>Levy (1984). <em>Capability-Based Computer Systems</em>. Digital Press.</li>
<li>Church (1936). "An Unsolvable Problem of Elementary Number Theory." <em>Amer. J. Math.</em> 58(2).</li>
<li>Turing (1936). "On Computable Numbers." <em>Proc. London Math. Soc.</em> 2(42).</li>
<li>Kocher et al. (2019). "Spectre Attacks." <em>IEEE S&amp;P</em>.</li>
<li>Watson et al. (2015). "CHERI." <em>IEEE S&amp;P</em>.</li>
<li>Woodruff et al. (2014). "The CHERI Capability Model." <em>ISCA '14</em>.</li>
<li>Halton (1972). "Hardware of the System 250 for Communication Control." <em>ISS</em>, MIT.</li>
<li>Hamer-Hodges (2024). <em>Civilizing Cyberspace</em>. Studio of Books. ISBN 978-1964148663.</li>
<li>Hamer-Hodges (2023). <em>The Fate of AI Society</em>. Studio of Books. ISBN 978-1964148540.</li>
<li>Hamer-Hodges (2025). <em>Winning World War III</em>. Studio of Books. ISBN 978-1964864983.</li>
</ol>
</div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';

        html += '<div class="sr-header">';
        html += '<h2>The Church Machine: SlideRule Comparative Study</h2>';
        html += '<p class="sr-tagline">Multi-Language Compilation &bull; Capability Security &bull; Universal Target</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="slideRuleTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="slideRuleTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
        html += '</div>';

        html += this._renderProgressBar();
        html += '</div>';

        html += '<div class="sr-body">';
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];
            html += `<div class="sr-step-container sr-type-${step.type}">`;
            html += `<div class="sr-step-title">${step.title}</div>`;
            if (step.subtitle) {
                html += `<div class="sr-step-subtitle">${step.subtitle}</div>`;
            }
            html += `<div class="sr-step-content">${step.content}</div>`;
            html += '</div>';
        } else {
            html += '<div class="sr-step-container sr-type-intro">';
            html += '<div class="sr-step-title">Welcome to the SlideRule Tutorial</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial walks through the Church Machine architecture using the SlideRule mathematical abstraction as a concrete example.</p>';
            html += '<p>You will see the same abstraction implemented in both JavaScript (imperative) and Haskell (functional), both compiling to the same 20-instruction target.</p>';
            html += '<p>Click <strong>Next</strong> to begin.</p>';
            html += '</div></div>';
        }
        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
    }

    _renderProgressBar() {
        const sections = [
            { label: 'Intro', start: 0, end: 1 },
            { label: 'Architecture', start: 2, end: 5 },
            { label: 'Compiler', start: 6, end: 7 },
            { label: 'Code', start: 8, end: 9 },
            { label: 'Compare', start: 10, end: 13 },
            { label: 'Performance', start: 14, end: 15 },
            { label: 'Security', start: 16, end: 17 },
            { label: 'Evaluation', start: 18, end: 20 },
            { label: 'Tutorial', start: 21, end: 22 },
        ];

        let html = '<div class="sr-progress-bar">';
        for (const sec of sections) {
            let cls = 'sr-prog-pending';
            if (this.currentStep >= sec.end) cls = 'sr-prog-done';
            else if (this.currentStep >= sec.start) cls = 'sr-prog-active';
            html += `<div class="sr-prog-section ${cls}"><span>${sec.label}</span></div>`;
        }
        html += '</div>';
        return html;
    }

    stepForward() {
        if (this.currentStep >= this.steps.length - 1) {
            this.reset();
            return;
        }
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SlideRuleTutorial;
}
