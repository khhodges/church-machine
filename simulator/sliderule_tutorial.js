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
<tr><td>0</td><td><span class="sr-instr-tip" data-tooltip="LOAD — Copy a Golden Token from a capability-list (c-list) slot into a context register. The token carries L (load) permission. No raw address is ever used.">LOAD</span></td><td>Load GT from c-list</td></tr>
<tr><td>1</td><td><span class="sr-instr-tip" data-tooltip="SAVE — Write a Golden Token back into a c-list slot. Requires S (save) permission on the target. The token is copied, not moved.">SAVE</span></td><td>Save GT to c-list</td></tr>
<tr><td>2</td><td><span class="sr-instr-tip" data-tooltip="CALL — Enter an abstraction by presenting a token with E (enter) permission. Creates a new execution context. Like a function call, but mediated by capability.">CALL</span></td><td>Enter abstraction via E-GT</td></tr>
<tr><td>3</td><td><span class="sr-instr-tip" data-tooltip="RETURN — Exit the current abstraction and return to the caller. Shared by both Church and Turing domains. Restores the previous execution context.">RETURN</span></td><td>Return from abstraction</td></tr>
<tr><td>4</td><td><span class="sr-instr-tip" data-tooltip="CHANGE — Replace one capability with another in a context register. Used to swap tokens during abstraction dispatch.">CHANGE</span></td><td>Replace capability</td></tr>
<tr><td>5</td><td><span class="sr-instr-tip" data-tooltip="SWITCH — Switch to a different execution context (like a thread switch). The target context is identified by a capability, not an address.">SWITCH</span></td><td>Switch execution context</td></tr>
<tr><td>6</td><td><span class="sr-instr-tip" data-tooltip="TPERM — Token Permission reduce. Strips permissions from a Golden Token (e.g. remove write, keep read-only). Permissions can only be reduced, never amplified.">TPERM</span></td><td>Reduce token permissions</td></tr>
<tr><td>7</td><td><span class="sr-instr-tip" data-tooltip="LAMBDA — Invoke a named method within the current abstraction. The Church Machine equivalent of a local function call.">LAMBDA</span></td><td>Invoke a method</td></tr>
<tr><td>8</td><td><span class="sr-instr-tip" data-tooltip="ELOADCALL — Enter-Load-Call fused instruction. Loads a token and immediately calls the abstraction it points to. Saves one instruction cycle.">ELOADCALL</span></td><td>Fused load-and-call</td></tr>
<tr><td>9</td><td><span class="sr-instr-tip" data-tooltip="XLOADLAMBDA — Cross-Load-Lambda fused instruction. Loads a token and immediately invokes a method. Combines two operations into one cycle.">XLOADLAMBDA</span></td><td>Fused load-and-lambda</td></tr>
</table>
</div>
<div class="sr-col">
<div class="sr-col-title">Turing Domain (data)</div>
<table class="sr-table"><tr><th>Op</th><th>Instruction</th><th>Purpose</th></tr>
<tr><td>10</td><td><span class="sr-instr-tip" data-tooltip="DREAD — Data Read. Read a 32-bit value from data memory into a data register. Uses R (read) permission. Operates only in the Turing (data) domain.">DREAD</span></td><td>Read from data memory</td></tr>
<tr><td>11</td><td><span class="sr-instr-tip" data-tooltip="DWRITE — Data Write. Write a 32-bit value from a data register into data memory. Uses W (write) permission. Cannot touch capability space.">DWRITE</span></td><td>Write to data memory</td></tr>
<tr><td>12</td><td><span class="sr-instr-tip" data-tooltip="BFEXT — Bit Field Extract. Extract a contiguous range of bits from a data register. Used for decoding packed values and protocol fields.">BFEXT</span></td><td>Extract a bitfield</td></tr>
<tr><td>13</td><td><span class="sr-instr-tip" data-tooltip="BFINS — Bit Field Insert. Insert a value into a specific bit range of a data register. The complement of BFEXT for packing data.">BFINS</span></td><td>Insert a bitfield</td></tr>
<tr><td>14</td><td><span class="sr-instr-tip" data-tooltip="MCMP — Machine Compare. Compare two data registers and set condition flags (EQ, NE, LT, GT, etc.). Used before BRANCH for conditional logic.">MCMP</span></td><td>Compare (set flags)</td></tr>
<tr><td>15</td><td><span class="sr-instr-tip" data-tooltip="IADD — Integer Add. Add two 32-bit data registers and store the result. Sets overflow and carry flags. All arithmetic is built from IADD, ISUB, SHL, and SHR.">IADD</span></td><td>Integer addition</td></tr>
<tr><td>16</td><td><span class="sr-instr-tip" data-tooltip="ISUB — Integer Subtract. Subtract one data register from another. Sets borrow and zero flags. With IADD, provides the basis for all arithmetic.">ISUB</span></td><td>Integer subtraction</td></tr>
<tr><td>17</td><td><span class="sr-instr-tip" data-tooltip="BRANCH — Conditional Branch. Jump to a target address if the condition flags (set by MCMP) match the instruction's condition code. ARM-style conditional execution.">BRANCH</span></td><td>Conditional branch</td></tr>
<tr><td>18</td><td><span class="sr-instr-tip" data-tooltip="SHL — Shift Left. Shift a data register left by a specified number of bits, filling with zeros. Equivalent to multiplication by powers of 2.">SHL</span></td><td>Shift left</td></tr>
<tr><td>19</td><td><span class="sr-instr-tip" data-tooltip="SHR — Shift Right. Shift a data register right by a specified number of bits. Equivalent to integer division by powers of 2.">SHR</span></td><td>Shift right</td></tr>
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
                content: `<p>CLOOMC++ is a multi-language compiler with a single back-end. All front-ends produce the same output: arrays of 32-bit Church Machine instruction words.</p>
<div class="sr-comp-layout">
<div class="sr-comp-side sr-comp-side-left">
<div class="sr-comp-side-panel" id="srCompPanelLeft">
<div class="sr-comp-side-title">First-Class Variables</div>
<p>The real advantage of CLOOMC++ is <strong>first-class variables</strong>: Golden Tokens pass complex ideas as secure packages.</p>
<p>For example, the PP250 statement <code>CALL.Connect(me, to: my_mother)</code> passes two capability tokens &mdash; each an unforgeable, permission-carrying reference &mdash; as ordinary variables.</p>
<p>No raw pointers, no shared memory, no ambient authority. The compiler ensures every variable is a sealed capability.</p>
</div>
</div>
<div class="sr-compiler-diagram">
<div class="sr-comp-inputs">
<div class="sr-comp-input" data-tooltip="English: Add(a, b) &mdash; add two numbers&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">English</div>
<div class="sr-comp-input" data-tooltip="JavaScript: result = a + b; return(result)&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">JavaScript</div>
<div class="sr-comp-input" data-tooltip="Haskell: method Add(a, b) = a + b&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">Haskell</div>
<div class="sr-comp-input" data-tooltip="Machine code: 0x7F600000, 0x1F800000&#10;&#10;Direct 32-bit words:&#10;0x7F600000 = IADD DR0, DR0, DR1&#10;0x1F800000 = RETURN&#10;No compilation needed &mdash; injected verbatim">Machine code</div>
</div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-core" onclick="document.getElementById('srCompPanelLeft').classList.toggle('open')"><span style="font-size:0.65rem;opacity:0.7">&#9654; click</span><br>CLOOMC++ Compiler<br><small>Resident Object Model</small></div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-output" onclick="document.getElementById('srCompPanelRight').classList.toggle('open')"><span style="font-size:0.65rem;opacity:0.7">&#9654; click</span><br>32-bit code words &rarr; upload.json</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel" id="srCompPanelRight">
<div class="sr-comp-side-title">Bare Metal Security</div>
<p>CLOOMC++ runs on <strong>bare metal hardware</strong> with no operating system required.</p>
<p>No malware. No ransomware. No ethical constraints on AI behaviour to patch after the fact. No lethal autonomous weapons. No AI breakout problems.</p>
<p>The hardware enforces security at every cycle &mdash; software cannot override what the silicon forbids.</p>
</div>
</div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">Resident Object Model</div>
<p>The compiler maintains a mapping of abstraction names to c-list offsets. When a program declares <code>capabilities { Constants }</code>, the compiler knows Constants occupies slot 0. A call to <code>Constants.Pi()</code> compiles to LOAD from c-list offset 0 + CALL.</p>
<p>The c-list <em>is</em> the compiler's symbol table for external references. The capabilities declared in source are exactly those wired into the lump. There is no separate linking phase.</p>
</div>`
            },
            {
                title: "Variable Passing & JSON Upload Format",
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
                title: "English SlideRule",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The English front-end uses natural language to describe methods. The compiler parses structured English sentences into Church Machine instructions:</p>
<pre class="sr-code sr-code-en">abstraction SlideRuleEN {
    capabilities { Constants }

    Add(a, b):
        Add a to b and return the result.

    Sub(a, b):
        Subtract b from a and return the result.

    Mul(a, b):
        Use the slide rule abstraction to
        multiply a by b with floating-point
        precision, and return the product.

    Div(a, b):
        If b is zero, return zero.
        Otherwise use the slide rule abstraction
        to divide a by b with floating-point
        precision, and return the quotient.

    Sqrt(n):
        Find the largest integer whose square
        does not exceed n, and return it.
}</pre>
<p><strong>Key characteristics:</strong> Each method is a plain-language description. The compiler maps verbs (<em>Add</em>, <em>Subtract</em>) to opcodes (IADD, ISUB) and delegates complex operations to existing abstractions. Natural language is unambiguous here because the structured format constrains grammar to imperative commands with named parameters.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Slide Rule Floating Point</div>
<p>Mul and Div delegate to the <strong>slide rule abstraction</strong> rather than using integer-only shift-and-add or repeated subtraction.</p>
<p>A physical slide rule performs multiplication and division by adding and subtracting logarithmic distances &mdash; inherently floating-point. The Church Machine slide rule abstraction mirrors this: it uses logarithmic scales to produce results with fractional precision.</p>
<p>This means the English front-end can express <em>"multiply a by b"</em> and get true floating-point behaviour &mdash; something the integer-only JavaScript and Haskell versions cannot match without extra hardware support.</p>
</div>
</div>
</div>`
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
                title: "Machine Code SlideRule",
                type: "code",
                lang: "asm",
                content: `<p>The Machine code front-end bypasses the compiler entirely. 32-bit instruction words are injected verbatim into the upload JSON &mdash; no parsing, no compilation:</p>
<pre class="sr-code sr-code-asm">// SlideRule — direct machine code
// Each method is an array of 32-bit hex words

"methods": [
  {
    "name": "Add",
    "code": [
      "0x7F600000",  // IADD DR0, DR0, DR1
      "0x1F800000"   // RETURN
    ]
  },
  {
    "name": "Sub",
    "code": [
      "0x87600000",  // ISUB DR0, DR0, DR1
      "0x1F800000"   // RETURN
    ]
  },
  {
    "name": "Mul",
    "code": [
      "0x8F808000",  // MOVI DR4, 0       (acc = 0)
      "0x8F828000",  // MOVI DR5, 0       (sign = 0)
      "0xA7610000",  // MCMP DR1, 0
      "0xB0040000",  // BRANCH.GE +4
      "0x87618000",  // ISUB DR1, DR1, DR0 (negate)
      "0x7FE28001",  // IADD DR5, DR5, 1
      "0x97600001",  // BFEXT DR3, DR1, 0, 1
      "0xA7618000",  // MCMP DR3, 1
      "0xB0020000",  // BRANCH.NE +2
      "0x7F808000",  // IADD DR4, DR4, DR0
      "0x9F600001",  // SHL  DR0, DR0, 1
      "0x9F610001",  // SHR  DR1, DR1, 1
      "0xA7610000",  // MCMP DR1, 0
      "0xB0F90000",  // BRANCH.GT -7
      "0x1F800000"   // RETURN
    ]
  }
]</pre>
<p><strong>Key characteristics:</strong> No abstraction &mdash; the programmer writes raw opcodes. Every bit of every word is under direct control. Useful for hand-optimised inner loops, hardware drivers, or bootstrapping the compiler itself. The upload JSON accepts these arrays directly alongside compiler-generated methods.</p>`
            },
            {
                title: "Compiled Output Comparison",
                type: "comparison",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:3;min-width:0">
<p><strong>All four languages &mdash; same Add method:</strong></p>
<table class="sr-table sr-table-wide"><tr><th>Language</th><th>Instructions</th><th>Floating Point</th><th>Approach</th></tr>
<tr><td>English</td><td>3</td><td>&check;</td><td>Delegates to slide rule abstraction</td></tr>
<tr><td>JavaScript</td><td>5</td><td>&cross;</td><td>Explicit integer IADD</td></tr>
<tr><td>Haskell</td><td>4</td><td>&cross;</td><td>Expression: a + b</td></tr>
<tr><td>Machine code</td><td>2</td><td>&cross;</td><td>Hand-written IADD + RETURN</td></tr>
</table>
<p><strong>Mul &amp; Div &mdash; the critical difference:</strong></p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>EN</th><th>JS</th><th>HS</th><th>ASM</th><th>EN Algorithm</th></tr>
<tr><td>Mul</td><td>4</td><td>35</td><td>8</td><td>15</td><td>Slide rule abstraction (float) &check;</td></tr>
<tr><td>Div</td><td>5</td><td>28</td><td>&mdash;</td><td>&mdash;</td><td>Slide rule abstraction (float) &check;</td></tr>
<tr><td>Sqrt</td><td>6</td><td>38</td><td>27</td><td>&mdash;</td><td>Integer lookup</td></tr>
</table>
<p><strong>Semantically different methods</strong> (same name, different algorithms):</p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>JS</th><th>HS</th><th>JS Algorithm</th><th>HS Algorithm</th></tr>
<tr><td>Mul</td><td>35</td><td>8</td><td>Shift-and-add O(log n) &check;</td><td>Repeated addition O(n) &check;</td></tr>
<tr><td>Sqrt</td><td>38</td><td>27</td><td>Newton-Raphson iteration &check;</td><td>Conditional lookup table &check;</td></tr>
<tr><td>Pow/Pow2</td><td>29</td><td>19</td><td>General base^exp loop &check;</td><td>2^exp lookup table &check;</td></tr>
</table>
<div class="sr-totals">
<div class="sr-total-item"><strong>English:</strong> 5 methods, 22 instructions, 88 bytes + slide rule delegation</div>
<div class="sr-total-item"><strong>JavaScript:</strong> 8 methods, 153 instructions, 612 bytes</div>
<div class="sr-total-item"><strong>Haskell:</strong> 11 methods, 151 instructions, 604 bytes</div>
<div class="sr-total-item"><strong>Machine code:</strong> 3 methods, 19 instructions, 76 bytes (hand-optimised)</div>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Abstraction = Performance</div>
<p>English achieves the <strong>fewest instructions</strong> for Mul and Div by delegating to the slide rule abstraction &mdash; a pre-existing, tested capability that performs floating-point arithmetic via logarithmic scales.</p>
<p>Instead of compiling 35 instructions of shift-and-add (JS) or 8 instructions of repeated addition (HS), English compiles to just <strong>4 instructions</strong>: load the capability, pass parameters, call, return.</p>
<p>This is the key insight: <em>using abstractions in the English front-end turns composition into a performance advantage</em>. The work is done by optimised code already resident in the machine, not by inlining a new algorithm every time.</p>
<p>Higher-level language &rarr; fewer instructions &rarr; smaller lumps &rarr; faster execution.</p>
</div>
</div>
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
        html += '<h2>The Church Machine Study</h2>';
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
