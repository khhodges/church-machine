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
<div class="sr-obj-item"><span class="sr-obj-num">1</span>The 20-instruction Church Machine architecture: Church domain (capability) and Turing domain (data)</div>
<div class="sr-obj-item"><span class="sr-obj-num">2</span>Capability security with Golden Tokens: permissions, instant revocation, and the single-lump abstraction model</div>
<div class="sr-obj-item"><span class="sr-obj-num">3</span>The CLOOMC++ compiler and how six front-ends &mdash; English, JavaScript, Haskell, Symbolic Math, Lambda Calculus, and Machine Code &mdash; all target the same 32-bit instruction set</div>
</div>
<div class="sr-key-concept" style="margin-top:1rem">
<div class="sr-concept-title">CLOOMC++ Language Tutorial</div>
<p>The <strong>CLOOMC++ Language Tutorial</strong> (select it above) continues where this study ends: it walks through the SlideRule mathematical abstraction implemented in all six front-ends, compares instruction counts and algorithm choices across languages, and explains how the Lump Library and Locator work together to deploy compiled abstractions on demand.</p>
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
<tr><td>4</td><td><span class="sr-instr-tip" data-tooltip="CHANGE — Replace one capability with another in a context register. Used to swap tokens during abstraction dispatch.">CHANGE</span></td><td>Thread Swap (Suspension/Activation)</td></tr>
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
                content: `<p>A Golden Token (GT) is a 32-bit unforgeable capability — one word stored in a c-list slot:</p>
<pre class="sr-encoding"> 31      25 24  23 22      16 15           0
&#x250C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2510;
&#x2502;B R W X  &#x2502; typ  &#x2502;  gt_seq   &#x2502;  object_id   &#x2502;
&#x2502; L S E   &#x2502; [2]  &#x2502;   [7]    &#x2502;    [16]     &#x2502;
&#x2502;  [7]    &#x2502;      &#x2502;          &#x2502;             &#x2502;
&#x2514;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2518;</pre>
<table class="sr-table sr-table-wide"><tr><th>Field</th><th>Bits</th><th>Purpose</th></tr>
<tr><td>Perms (B&thinsp;R&thinsp;W&thinsp;X&thinsp;L&thinsp;S&thinsp;E)</td><td>7</td><td>Capability permissions. Turing domain: R(ead), W(rite), X(ecute). Church domain: L(oad), S(ave), E(nter). B = Bounds (access-size limit). MSB=B, LSB=E.</td></tr>
<tr><td>typ</td><td>2</td><td>00=NULL (invalid), 01=Real (GT points to an NS entry &rarr; memory lump), 10=Abstract (GT <em>is</em> the value), 11=Outform (GT resolved by Abstraction Library, e.g. GitHub).</td></tr>
<tr><td>gt_seq</td><td>7</td><td>Revocation counter. Incrementing gt_seq in the NS entry instantly invalidates every derived copy — the next mLoad that presents a stale gt_seq faults.</td></tr>
<tr><td>object_id</td><td>16</td><td>Index into the namespace (65&thinsp;536 possible entries).</td></tr>
</table>
<div class="sr-key-concept">
<div class="sr-concept-title">Instant Revocation</div>
<p>Incrementing a token's <strong>gt_seq</strong> in the namespace entry invalidates every copy of every derived token immediately. No garbage collection of permissions, no race condition, no eventually-consistent revocation. The next mLoad that presents a stale gt_seq faults.</p>
</div>`
            },
            {
                title: "Abstractions & the Single-Lump Model",
                type: "architecture",
                content: `<p>An abstraction is the fundamental security block. Each occupies a single contiguous memory region called a <em>lump</em>, described by one namespace (NS) entry.</p>
<p><strong>NS Entry (E-GT plus 3&nbsp;NS slot words)</strong></p>
<pre class="sr-encoding">  127      113 112 111          96   &#x2190; Word&nbsp;3
&#x250C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2510;
&#x2502; spare[15]&#x2502; <span style="color:var(--church-gold)">G[1]</span>&#x2502;   <span style="color:var(--church-gold)">CRC [16]</span>   &#x2502;
&#x2514;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2518;
   95   92 91      85 84         64  &#x2190; Word&nbsp;2
&#x250C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x252C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2510;
&#x2502;spare &#x2502;  <span style="color:var(--church-gold)">gt_seq</span>  &#x2502; limit_offset  &#x2502;
&#x2502; [4]  &#x2502;   <span style="color:var(--church-gold)">[7]</span>    &#x2502;    [21]       &#x2502;
&#x2514;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2534;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2518;
   63                           32   &#x2190; Word&nbsp;1
&#x250C;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2510;
&#x2502;           <span style="color:#7ee787">base [32]</span>            &#x2502;
&#x2514;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2518;</pre>
<p><strong>Header word (lump word&nbsp;0)</strong></p>
<pre class="sr-encoding">31      27 26    23 22                10 9   8 7              0
+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+
&#x2502; 0x1F [5] &#x2502; <span style="color:#f85149">n-6[4]</span> &#x2502;     <span style="color:#7ee787">cw [13]</span>      &#x2502;typ[2]&#x2502;    <span style="color:var(--church-gold)">cc [8]</span>      &#x2502;
+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;+</pre>
<p>The size is encoded in the header word as the field <span style="color:#f85149"><strong>n-6</strong></span> (4 bits wide).</p>
<p style="margin:0.25rem 0"><code>lumpSize = 2<sup>n</sup></code>, where <code>n = (n-6 field) + 6</code>.</p>
<table class="sr-table sr-table-wide" style="margin:0.5rem 0"><tr><th></th><th>n-6 field</th><th>n</th><th>lumpSize</th><th>Bytes</th></tr>
<tr><td><strong>Minimum</strong></td><td>0</td><td>6</td><td>64 words</td><td>256 bytes</td></tr>
<tr><td><strong>Maximum</strong></td><td>8</td><td>14</td><td>16,384 words</td><td>65,536 bytes</td></tr></table>
<p>The n-6 field is 4 bits, so it can technically hold values 0&ndash;15, but Mint rejects any lump where n-6&nbsp;&gt;&nbsp;8 (that would be n=15, a 32K-word lump). Values 9&ndash;15 are reserved and treated as invalid.</p>
<p><strong>Why the minimum is 64 words:</strong> A valid lump needs at least Word&nbsp;0 (header), at least one code word, and room for the c-list. Smaller than 64 words leaves no practical room for all three regions simultaneously.</p>
<p><strong>Why the maximum is 16K words (64 KB):</strong> The <code>limit_offset</code> field in the GT (CR Words 1&ndash;2) is 21 bits, which caps the addressable region. 16K words (65,536 bytes) fits comfortably within that bound and keeps the NS Table manageable (256 slots &times; 16 bytes = 4&nbsp;KB in BSRAM).</p>
<p>The wire protocol in Tunnel reflects this directly &mdash; the valid range for <code>byte_count</code> in the length frame is 256 bytes (n=6) to 65,536 bytes (n=14).</p>
<div class="sr-lump-diagram" style="border-color:#f85149">
<div class="sr-lump-region sr-lump-code">Code (Turing domain, X) &larr; CR14 &nbsp;&middot;&nbsp; max 8&thinsp;191 words</div>
<div class="sr-lump-region sr-lump-free">FREESPACE (inaccessible)</div>
<div class="sr-lump-region sr-lump-clist">C-list (Church domain, L) &larr; CR6 &nbsp;&middot;&nbsp; max 255 entries</div>
</div>
<p>When CALL enters an abstraction, it reads <code>clistCount</code> from word1 and splits the lump:</p>
<ul>
<li><strong>CR14 (code):</strong> base address, limit = clistStart - 1, permissions = <strong>X only</strong> [privileged]</li>
<li><strong>CR6 (c-list):</strong> base + clistStart, limit = clistCount - 1, permissions = <strong>L only</strong></li>
</ul>
<p>These permissions are <strong>architecturally hardcoded</strong> by CALL. Code cannot read its own capabilities (no GT leakage) and capabilities cannot be executed as code (no injection).</p>`
            },
            {
                title: "The CLOOMC++ Compiler",
                type: "compiler",
                content: `<p>CLOOMC++ is a multi-language compiler with a single back-end. All front-ends produce the same output: arrays of 32-bit Church Machine instruction words.</p>
<div class="sr-compiler-diagram">
<div class="sr-comp-inputs">
<div class="sr-comp-input" data-tooltip="English: Add(a, b) &mdash; add two numbers&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">English<br><small style="opacity:0.65;font-size:0.75em">Experimental</small></div>
<div class="sr-comp-input" data-tooltip="JavaScript: result = a + b; return(result)&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">Java/Script<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Haskell: method Add(a, b) = a + b&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">Haskell<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Symbolic Math (Ada): let result = a + b in result&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">Symbolic Math<br><small style="opacity:0.65;font-size:0.75em">Ada&rsquo;s Version</small></div>
<div class="sr-comp-input" data-tooltip="Lambda Calculus: &lambda;a b &rarr; a + b&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000">Lambda Calculus<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Machine code: 0x7F600000, 0x1F800000&#10;&#10;Direct 32-bit words:&#10;0x7F600000 = IADD DR0, DR0, DR1&#10;0x1F800000 = RETURN&#10;No compilation needed &mdash; injected verbatim">Machine Code<br><small style="opacity:0.65;font-size:0.75em">Full</small></div>
</div>
<div class="sr-comp-arrow">&darr;</div>
<div style="display:flex;gap:0.5rem;align-items:stretch;width:100%">
<div class="sr-comp-side-panel open" style="flex:1;min-width:0">
<div class="sr-comp-side-title">First-Class Variables</div>
<p>The real advantage of CLOOMC++ is <strong>first-class variables</strong>: Golden Tokens pass complex ideas as secure packages.</p>
<p>For example, the PP250 statement <code>CALL.Connect(me, to: my_mother)</code> passes two capability tokens &mdash; each an unforgeable, permission-carrying reference &mdash; as ordinary variables.</p>
<p>No raw pointers, no shared memory, no ambient authority. The compiler ensures every variable is a sealed capability.</p>
</div>
<div class="sr-comp-core" style="flex:0 0 auto;padding:0.3rem 1rem">CLOOMC++ Compiler<br><small>Resident Object Model</small></div>
<div class="sr-comp-side-panel open" style="flex:1;min-width:0">
<div class="sr-comp-side-title">Bare Metal Security</div>
<p>CLOOMC++ runs on <strong>bare metal hardware</strong> with no operating system required.</p>
<p>No malware. No ransomware. No ethical constraints on AI behaviour to patch after the fact. No lethal autonomous software. No AI breakout problems.</p>
<p>The hardware enforces security at every cycle &mdash; software cannot override what the silicon forbids.</p>
</div>
</div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-output"><strong>Lump Library (GitHub)</strong><br><small>32-bit code words &rarr; lump.zip</small></div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-output" style="background:rgba(30,100,200,0.12);border-color:rgba(30,100,200,0.35);color:#79c0ff"><strong>Locator</strong><br><small>on-demand fetch &amp; install</small></div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">Resident Object Model</div>
<p>The compiler maintains a mapping of abstraction names to c-list offsets. When a program declares <code>capabilities { Constants }</code>, the compiler knows Constants occupies slot 0. A call to <code>Constants.Pi()</code> compiles to LOAD from c-list offset 0 + CALL.</p>
<p>The c-list <em>is</em> the compiler's symbol table for external references. The capabilities declared in source are exactly those wired into the lump. There is no separate linking phase.</p>
</div>`
            },
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

        // progress bar removed
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
