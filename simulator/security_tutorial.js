class SecurityTutorial {
    constructor() {
        this.steps = this._buildSteps();
        this.currentStep = -1;
    }

    _buildSteps() {
        return [
            {
                title: "Security: What the Compiler Cannot Do",
                type: "security",
                content: `<p>Regardless of language or compilation strategy, the CLOOMC++ compiler <strong>cannot</strong>:</p>
<div class="sr-security-list">
<div class="sr-sec-item"><span class="sr-sec-num">1</span><strong>Forge a Golden Token.</strong> Tokens are created only by Mint.Create (via Navana). The compiler produces Turing-domain code words &mdash; no access to Church-domain token creation.</div>
<div class="sr-sec-item"><span class="sr-sec-num">2</span><strong>Escape the lump.</strong> CALL hardcodes CR14 boundaries. Out-of-bounds branches trigger a hardware fault.</div>
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
<div class="sr-concept-title">Negotiated Approval Made Concrete</div>
<p>The c-list is digital approval made concrete. A spy cannot grant their abstraction access to resources the owner does to approve by providing a copy of the key, the Golden Token. Revoking a GT increments the version and instantly cuts access — all prior copies become invalid.</p>
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
<p>20 instructions. 4-word NS entries. 32-bit tokens. A motivated undergraduate can understand the entire architecture in a semester.</p>
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
<div class="sr-con-item">
<div class="sr-con-title">Networked distribution appears to add latency overhead</div>
<p>Capability-checked atomic distribution requires every cross-node message to carry a validated Golden Token, which appears to add per-packet overhead compared to a raw OS socket.</p>
<p class="sr-objection"><strong>Objection:</strong> The CM Tunnel eliminates the entire OS/IO stack. A conventional networked call traverses: user space → syscall → kernel TCP/IP → NIC driver → wire → reverse. The CM Tunnel replaces this with a direct abstraction-to-abstraction pipe — capability validation is a single word comparison in hardware, not a kernel round-trip. The result is dramatically lower latency and higher throughput for distributed atomic operations. Security is not the cost; the OS stack was the cost.</p>
</div>
</div>`
            },
            {
                title: "The Universal Target Argument",
                type: "conclusion",
                content: `<p>The fact that all four languages &mdash; English, JavaScript, Haskell, and Machine code &mdash; compile to the same 20 instructions is not merely a compiler trick. It is a demonstration of <strong>computational universality</strong>.</p>
<table class="sr-table sr-table-wide"><tr><th>Language</th><th>Style</th><th>Compiles to</th><th>Security model</th></tr>
<tr><td>English</td><td>Natural language</td><td>20 instructions + abstraction calls</td><td>Identical</td></tr>
<tr><td>JavaScript</td><td>Imperative</td><td>20 instructions</td><td>Identical</td></tr>
<tr><td>Haskell</td><td>Functional</td><td>20 instructions</td><td>Identical</td></tr>
<tr><td>Machine code</td><td>Direct hex</td><td>20 instructions (verbatim)</td><td>Identical</td></tr>
</table>
<ul>
<li>The instruction set is <strong>Turing-complete</strong> (conditional branching + memory access)</li>
<li>The instruction set is <strong>Church-complete</strong> (LAMBDA + CALL)</li>
<li>Any computable function can be expressed in these 20 instructions</li>
<li>No language can bypass the capability model &mdash; not even raw machine code</li>
</ul>
<p><strong>Case-by-Case: <code>Add(a, b)</code> &mdash; parameters: a&rarr;DR0, b&rarr;DR1</strong></p>
<table class="sr-table sr-table-wide">
<tr><th>Language</th><th>Source</th><th>Compiled Assembly</th><th>Hex words</th></tr>
<tr>
  <td><strong>English</strong></td>
  <td><code>Add(a, b):<br>&nbsp;&nbsp;Add a to b and return the result.</code></td>
  <td><code>IADD DR0, DR0, DR1<br>RETURN</code></td>
  <td><code>0x7F000001<br>0x1F000000</code></td>
</tr>
<tr>
  <td><strong>JavaScript</strong></td>
  <td><code>method Add(a, b) {<br>&nbsp;&nbsp;result = a + b<br>&nbsp;&nbsp;return(result)<br>}</code></td>
  <td><code>IADD DR0, DR0, DR1<br>RETURN</code></td>
  <td><code>0x7F000001<br>0x1F000000</code></td>
</tr>
<tr>
  <td><strong>Haskell</strong></td>
  <td><code>method Add(a, b) = a + b</code></td>
  <td><code>IADD DR0, DR0, DR1<br>RETURN</code></td>
  <td><code>0x7F000001<br>0x1F000000</code></td>
</tr>
<tr>
  <td><strong>Machine code</strong></td>
  <td><code>0x7F000001<br>0x1F000000</code></td>
  <td><code>IADD DR0, DR0, DR1<br>RETURN</code></td>
  <td><code>0x7F000001<br>0x1F000000</code></td>
</tr>
</table>
<p style="font-size:0.85em;color:var(--sr-muted,#888)"><strong>Hex verified:</strong> IADD=opcode 15, cond AL=14, dst=DR0, srcA=DR0, srcB=DR1&rarr;imm=1 &rarr; <code>(15&lt;&lt;27)|(14&lt;&lt;23)|(0&lt;&lt;19)|(0&lt;&lt;15)|1 = 0x7F000001</code>. RETURN=opcode 3 &rarr; <code>(3&lt;&lt;27)|(14&lt;&lt;23) = 0x1F000000</code>.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Separation of Concerns</div>
<p>The programmer writes in any comfortable notation &mdash; natural English, imperative JavaScript, functional Haskell, or direct hex. The compiler reduces it to the universal substrate. The hardware enforces security at every instruction, regardless of source language.</p>
<p><strong>Expressiveness at the top, security at the bottom.</strong></p>
</div>`
            },
            {
                title: "Try It: Write Your Own Abstraction",
                type: "tutorial",
                content: `<div class="sr-tutorial-steps">
<div class="sr-tut-step">
<span class="sr-tut-num">1</span>
<div><strong>Choose a language.</strong> Open the <strong>Code</strong> tab. You can write the same abstraction in any of the six languages:</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">2</span>
<div><strong>English</strong> &mdash; describe what each method does in plain language:</div>
<pre class="sr-code sr-code-en">abstraction MyMath {
    capabilities { Constants }  -- imports Constants E-GT into c-list CR0

    Double(n):                  -- one parameter: n maps to DR0
        Add n to n and return the result.
        -- compiler maps "Add X to Y" -> IADD; "return" -> RETURN

    Square(n):                  -- one parameter: n maps to DR0
        Multiply n by n using repeated addition
        and return the product.
        -- "Multiply ... using repeated addition" -> IADD loop + RETURN
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">3</span>
<div><strong>JavaScript</strong> &mdash; imperative style with explicit loops:</div>
<pre class="sr-code sr-code-js">abstraction MyMath {
    capabilities { Constants }  // Constants E-GT written to c-list CR0
    method Double(n) {          // n arrives in DR0
        result = n + n          // allocates DR4; emits IADD DR4, DR0, DR0
        return(result)          // moves DR4 -> DR0; emits RETURN
    }
    method Square(n) {          // n arrives in DR0
        acc = 0                 // allocates DR4; emits IADD DR4, 0, 0
        i = n                   // allocates DR5; emits IADD DR5, DR0, 0
        while (i > 0) {         // emits MCMP DR5, 0 + BRANCH.LE exit
            acc = acc + n       // emits IADD DR4, DR4, DR0
            i = i - 1           // emits ISUB DR5, DR5, 1
        }
        return(acc)             // moves DR4 -> DR0; emits RETURN
    }
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">4</span>
<div><strong>Haskell</strong> &mdash; functional style with single expressions:</div>
<pre class="sr-code sr-code-hs">abstraction MyMath {
    capabilities { Constants }   -- Constants E-GT into c-list CR0
    method Double(n) = n + n     -- n in DR0; emits IADD DR0, DR0, DR0 + RETURN
    method Square(n) = n * n     -- * expands to repeated IADD loop; result in DR0
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">5</span>
<div><strong>Ada's Symbolic Math</strong> &mdash; Ada-inspired syntax with strong typing and formal <code>begin/end</code> blocks:</div>
<pre class="sr-code sr-code-sym">abstraction MyMath {
    capabilities { Constants }           -- Constants E-GT into c-list CR0

    function Double(n : Integer)         -- n : Integer -> n mapped to DR0
                     return Integer is   -- explicit return type declaration
    begin
        return n + n;                    -- emits IADD DR0, DR0, DR0 + RETURN
    end Double;

    function Square(n : Integer)
                     return Integer is
        acc : Integer := 0;              -- local DR4 allocated; IADD DR4, 0, 0
        i   : Integer := n;              -- local DR5 allocated; IADD DR5, DR0, 0
    begin
        while i &gt; 0 loop               -- emits MCMP DR5, 0 + BRANCH.LE exit
            acc := acc + n;              -- emits IADD DR4, DR4, DR0
            i   := i - 1;               -- emits ISUB DR5, DR5, 1
        end loop;                        -- emits unconditional BRANCH back to MCMP
        return acc;                      -- moves DR4 -> DR0; emits RETURN
    end Square;
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">6</span>
<div><strong>Lambda Calculus</strong> &mdash; pure anonymous functions; recursion via self-application (Z-combinator pattern):</div>
<pre class="sr-code sr-code-lc">abstraction MyMath {
    capabilities { Constants }         -- Constants E-GT into c-list CR0

    Double &equiv; &lambda;n &rarr; n + n           -- anonymous fn of n (DR0); emits IADD + RETURN

    Square &equiv; &lambda;n &rarr;                 -- outer lambda captures n in DR0
        let go = &lambda;self acc i &rarr;           -- recursive helper; self=own E-GT, acc=running total, i=counter
            if i = 0 then acc          -- base case: emits MCMP + BRANCH; returns acc in DR0
            else self self (acc + n) (i - 1)
            -- recursive step: CALL self (Z-combinator); acc+n emits IADD; i-1 emits ISUB
        in go go 0 n                   -- kickstart: passes go's E-GT as self, acc=0, i=n
}</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">7</span>
<div><strong>Machine code</strong> &mdash; direct 32-bit hex words, no compiler needed:</div>
<pre class="sr-code sr-code-asm">"methods": [
  { "name": "Double", "code": [
      "0x7F600000",  // IADD DR0, DR0, DR0
      "0x1F800000"   // RETURN
  ]},
  { "name": "Square", "code": [
      "0x8F808000",  // MOVI DR4, 0 (acc)
      "0x8F828000",  // MOVI DR5, n (counter)
      "0x97600001",  // BFEXT DR3, DR5, 0, 1
      "0xA7618000",  // MCMP DR3, 1
      "0xB0020000",  // BRANCH.NE +2
      "0x7F808000",  // IADD DR4, DR4, DR0
      "0x9F610001",  // SHR DR5, DR5, 1
      "0xA7610000",  // MCMP DR5, 0
      "0xB0F90000",  // BRANCH.GT -7
      "0x1F800000"   // RETURN
  ]}
]</pre>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">8</span>
<div><strong>Compile.</strong> Click the gold <strong>CLOOMC++</strong> button. The compiler auto-detects the language (English, JavaScript, Haskell, Ada, or Lambda Calculus). Machine code bypasses the compiler entirely.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">9</span>
<div><strong>Inspect.</strong> Verify each method ends with RETURN, branch targets are in bounds, and capability count matches declarations. All six languages produce the same secure output format.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">10</span>
<div><strong>Save.</strong> Click the blue <strong>Save Upload JSON</strong> button to download the upload file. The JSON format is identical regardless of source language.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">11</span>
<div><strong>Create.</strong> Click <strong>Boot</strong>, then <strong>Create Abstraction</strong>. Navana validates the upload, allocates a lump, writes code + c-list, and forges an E-GT back to the creator.</div>
</div>
<div class="sr-tut-step">
<span class="sr-tut-num">12</span>
<div><strong>Test.</strong> Switch to the <strong>Pure Math</strong> tab and call your methods. The results are identical whichever language you chose &mdash; the hardware enforces the same security model on all six.</div>
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
<li>Dennis &amp; Van Horn (1966). <a href="https://doi.org/10.1145/365230.365252" target="_blank" rel="noopener">"Programming Semantics for Multiprogrammed Computations."</a> <em>CACM</em> 9(3).</li>
<li>Levy (1984). <a href="https://homes.cs.washington.edu/~levy/capabook/" target="_blank" rel="noopener"><em>Capability-Based Computer Systems</em></a>. Digital Press.</li>
<li>Church (1936). <a href="https://doi.org/10.2307/2371045" target="_blank" rel="noopener">"An Unsolvable Problem of Elementary Number Theory."</a> <em>Amer. J. Math.</em> 58(2).</li>
<li>Turing (1936). <a href="https://doi.org/10.1112/plms/s2-42.1.230" target="_blank" rel="noopener">"On Computable Numbers."</a> <em>Proc. London Math. Soc.</em> 2(42).</li>
<li>Kocher et al. (2019). <a href="https://doi.org/10.1109/SP.2019.00002" target="_blank" rel="noopener">"Spectre Attacks."</a> <em>IEEE S&amp;P</em>.</li>
<li>Watson et al. (2015). <a href="https://doi.org/10.1109/SP.2015.27" target="_blank" rel="noopener">"CHERI."</a> <em>IEEE S&amp;P</em>.</li>
<li>Woodruff et al. (2014). <a href="https://doi.org/10.1145/2678373.2665740" target="_blank" rel="noopener">"The CHERI Capability Model."</a> <em>ISCA '14</em>.</li>
<li>Halton (1972). <a href="https://web.archive.org/web/2024/https://hamer-hodges.com/pp250.html" target="_blank" rel="noopener">"Hardware of the System 250 for Communication Control."</a> <em>ISS</em>, MIT.</li>
<li>Hamer-Hodges (2024). <a href="https://www.amazon.com/dp/1964148669" target="_blank" rel="noopener"><em>Civilizing Cyberspace</em></a>. Studio of Books. ISBN 978-1964148663.</li>
<li>Hamer-Hodges (2023). <a href="https://www.amazon.com/dp/1964148545" target="_blank" rel="noopener"><em>The Fate of AI Society</em></a>. Studio of Books. ISBN 978-1964148540.</li>
<li>Hamer-Hodges (2025). <a href="https://www.amazon.com/dp/1964864984" target="_blank" rel="noopener"><em>Winning World War III</em></a>. Studio of Books. ISBN 978-1964864983.</li>
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
        html += '<h2>Church Machine Security</h2>';
        html += '<p class="sr-tagline">Capability Security &bull; Hardware Enforcement &bull; Zero Trust Architecture</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="securityTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="securityTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
        html += '</div>';

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
            html += '<div class="sr-step-container sr-type-security">';
            html += '<div class="sr-step-title">Welcome to Church Machine Security</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial covers the security architecture of the Church Machine &mdash; how capability tokens, hardware enforcement, and the compiler work together to eliminate entire classes of attack.</p>';
            html += '<p>Click <strong>Next</strong> to begin.</p>';
            html += '</div></div>';
        }
        html += '</div>';
        html += '</div>';

        container.innerHTML = html;
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
