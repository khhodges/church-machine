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
