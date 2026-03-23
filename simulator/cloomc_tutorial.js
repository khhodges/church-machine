class CLOOMCTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "CLOOMC++ — Six Front-Ends, One Target",
                type: "compiler",
                content: `<p>CLOOMC++ is a multi-language compiler with a <strong>single back-end</strong>. Every front-end produces the same output: arrays of 32-bit Church Machine instruction words that are packaged into a <code>lump.zip</code> and stored in the Lump Library.</p>
<div class="sr-compiler-diagram">
<div class="sr-comp-inputs">
<div class="sr-comp-input" data-tooltip="English: Add(a, b) &mdash; natural language method descriptions&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000&#10;&#10;Highest abstraction level. Delegates complex&#10;operations to existing abstractions.">English<br><small style="opacity:0.65;font-size:0.75em">Experimental</small></div>
<div class="sr-comp-input" data-tooltip="JavaScript: result = a + b; return(result)&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000&#10;&#10;Imperative style with explicit control flow,&#10;while loops, and bitfield extraction.">Java/Script<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Haskell: method Add(a, b) = a + b&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000&#10;&#10;Functional style. Single expression per method.&#10;Pattern-matching via if/then/else chains.">Haskell<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Symbolic Math (Ada): Ada-style declarations with begin/end blocks&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000&#10;&#10;Strong typing, explicit variable declarations,&#10;for/while loops with Ada loop syntax.">Symbolic Math<br><small style="opacity:0.65;font-size:0.75em">Ada&rsquo;s Version</small></div>
<div class="sr-comp-input" data-tooltip="Lambda Calculus: &lambda;a b &rarr; a + b&#10;&#10;Compiles to:&#10;IADD DR0, DR0, DR1  &rarr; 0x7F600000&#10;RETURN              &rarr; 0x1F800000&#10;&#10;Pure function definitions. Recursion via&#10;fixed-point combinator (self-application).">Lambda Calculus<br><small style="opacity:0.65;font-size:0.75em">Version 1</small></div>
<div class="sr-comp-input" data-tooltip="Machine code: 0x7F600000, 0x1F800000&#10;&#10;Direct 32-bit words:&#10;0x7F600000 = IADD DR0, DR0, DR1&#10;0x1F800000 = RETURN&#10;No compilation needed &mdash; injected verbatim">Machine Code<br><small style="opacity:0.65;font-size:0.75em">Full</small></div>
</div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-core" style="flex:0 0 auto;padding:0.3rem 1rem;margin:0 auto">CLOOMC++ Compiler<br><small>Resident Object Model</small></div>
<div class="sr-comp-arrow">&darr;</div>
<div class="sr-comp-output"><strong>Lump Library (GitHub)</strong><br><small>32-bit code words &rarr; lump.zip</small></div>
</div>
<p>This tutorial walks through the <strong>SlideRule</strong> mathematical abstraction implemented in all six front-ends. The same five operations (Add, Sub, Mul, Div, Sqrt) appear in every language &mdash; compiled to the same 20-instruction target, each with a different style, different algorithm choices, and different instruction counts.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">The Invariant</div>
<p>Every CLOOMC++ program that compiles successfully is <strong>architecturally correct</strong>: it cannot forge capabilities, it cannot access memory outside its lump, it cannot escape its c-list. The compiler may produce an incorrect algorithm &mdash; it cannot produce an insecure one. This invariant holds regardless of which front-end generated the code.</p>
</div>`
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
                title: "Symbolic Math SlideRule",
                type: "code",
                lang: "sym",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The Symbolic Math front-end uses Ada-inspired syntax with strong typing, explicit variable declarations, and formal <code>begin/end</code> blocks. Ada is the preferred language for safety-critical and defence software:</p>
<pre class="sr-code sr-code-sym">abstraction SlideRuleSM {
    capabilities { Constants }

    function Add(a, b : Integer)
                     return Integer is
    begin
        return a + b;
    end Add;

    function Sub(a, b : Integer)
                     return Integer is
    begin
        return a - b;
    end Sub;

    function Mul(a, b : Integer)
                     return Integer is
        result : Integer := 0;
        i      : Integer := b;
    begin
        while i &gt; 0 loop
            result := result + a;
            i := i - 1;
        end loop;
        return result;
    end Mul;

    function Div(a, b : Integer)
                     return Integer is
        quot : Integer := 0;
        rem  : Integer := a;
    begin
        if b = 0 then return 0; end if;
        while rem &gt;= b loop
            rem  := rem - b;
            quot := quot + 1;
        end loop;
        return quot;
    end Div;

    function Sqrt(n : Integer)
                     return Integer is
        r : Integer := 0;
    begin
        while (r + 1) * (r + 1) &lt;= n loop
            r := r + 1;
        end loop;
        return r;
    end Sqrt;
}</pre>
<p><strong>Key characteristics:</strong> All variables declared before <code>begin</code>. Assignment uses <code>:=</code>. Return type declared in the signature. Loop termination is proved by the compiler. The strongly-typed front-end makes it impossible to pass a capability where an integer is expected — type safety extends to the Church domain.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Ada &amp; Safety</div>
<p>Ada was designed by the US DoD for embedded and safety-critical software. Its formal <code>begin/end</code> structure, mandatory type declarations, and absence of implicit coercions make it the preferred language for avionics, defence, and railway control systems.</p>
<p>In CLOOMC++, the Symbolic Math front-end inherits Ada's discipline: every variable has an explicit type, every loop has a provable exit, and every function has a declared return type.</p>
<p>The compiler can prove that <code>Mul</code> terminates (the loop counter <code>i</code> strictly decreases) and that no integer overflow escapes into a capability slot. This adds a static-analysis layer on top of the Church Machine's runtime hardware enforcement.</p>
</div>
</div>
</div>`
            },
            {
                title: "Lambda Calculus SlideRule",
                type: "code",
                lang: "lc",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The Lambda Calculus front-end uses pure &lambda;-notation. Every definition is a combinator &mdash; a nameless function applied to its arguments. Recursion is expressed via self-application rather than named loops:</p>
<pre class="sr-code sr-code-lc">abstraction SlideRuleLC {
    capabilities { Constants }

    -- Simple combinators (direct expressions)
    Add &equiv; &lambda;a b &rarr; a + b

    Sub &equiv; &lambda;a b &rarr; a - b

    Abs &equiv; &lambda;n &rarr; if n &lt; 0 then (0 - n) else n

    Signum &equiv; &lambda;n &rarr;
        if n = 0 then 0
        else if n &gt; 0 then 1
        else (0 - 1)

    -- Recursion via fixed-point (self-application)
    Mul &equiv; &lambda;a b &rarr;
        let go = &lambda;self acc n &rarr;
            if n = 0 then acc
            else self self (acc + a) (n - 1)
        in go go 0 b

    Div &equiv; &lambda;a b &rarr;
        if b = 0 then 0
        else let go = &lambda;self q r &rarr;
            if r &lt; b then q
            else self self (q + 1) (r - b)
        in go go 0 a

    Sqrt &equiv; &lambda;n &rarr;
        let go = &lambda;self r &rarr;
            if (r + 1) * (r + 1) &gt; n then r
            else self self (r + 1)
        in go go 0
}</pre>
<p><strong>Key characteristics:</strong> Every definition is an anonymous function bound to a name for readability. No mutation, no loop counters. Recursion is encoded by passing <code>self</code> as a parameter &mdash; the standard lambda-calculus trick for fixed-point computation without a Y-combinator primitive.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Lambda &amp; the Church Machine</div>
<p>The Church Machine takes its name from <strong>Alonzo Church</strong>, who invented the lambda calculus in 1936. The lambda calculus front-end is therefore the most direct expression of the machine's mathematical foundation.</p>
<p>In lambda calculus, computation is the reduction of expressions &mdash; applying functions to arguments until no further reductions are possible. Every CLOOMC++ abstraction is, in mathematical terms, a Church encoding of a function that maps capability tokens to capability tokens.</p>
<p>The <code>self self</code> pattern encodes the <strong>Z-combinator</strong> &mdash; a call-by-value fixed point operator. The Church Machine compiler lowers each <code>self self</code> application to a LAMBDA instruction targeting the method's own entry point, producing a tight tail-recursive loop in the compiled output.</p>
</div>
</div>
</div>`
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
<p><strong>Six SlideRule implementations &mdash; same Add method across all front-ends:</strong></p>
<table class="sr-table sr-table-wide"><tr><th>Language</th><th>Instructions</th><th>Floating Point</th><th>Approach</th></tr>
<tr><td>English</td><td>3</td><td>&check;</td><td>Delegates to slide rule abstraction</td></tr>
<tr><td>JavaScript</td><td>5</td><td>&cross;</td><td>Explicit integer IADD</td></tr>
<tr><td>Haskell</td><td>4</td><td>&cross;</td><td>Expression: a + b</td></tr>
<tr><td>Symbolic Math</td><td>4</td><td>&cross;</td><td>Ada function: return a + b</td></tr>
<tr><td>Lambda Calculus</td><td>3</td><td>&cross;</td><td>Combinator: &lambda;a b &rarr; a + b</td></tr>
<tr><td>Machine code</td><td>2</td><td>&cross;</td><td>Hand-written IADD + RETURN</td></tr>
</table>
<p><strong>Mul &amp; Div &mdash; the critical difference:</strong></p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>EN</th><th>JS</th><th>HS</th><th>SM</th><th>LC</th><th>ASM</th></tr>
<tr><td>Mul</td><td>4</td><td>35</td><td>8</td><td>18</td><td>12</td><td>15</td></tr>
<tr><td>Div</td><td>5</td><td>28</td><td>&mdash;</td><td>16</td><td>14</td><td>&mdash;</td></tr>
<tr><td>Sqrt</td><td>6</td><td>38</td><td>27</td><td>10</td><td>10</td><td>&mdash;</td></tr>
</table>
<p><strong>Semantically different algorithms (same method name):</strong></p>
<table class="sr-table sr-table-wide"><tr><th>Method</th><th>JS</th><th>HS</th><th>SM (Ada)</th><th>LC</th></tr>
<tr><td>Mul</td><td>Shift-and-add O(log n)</td><td>Repeated add O(n)</td><td>Loop accumulate O(n)</td><td>Tail-recursive O(n)</td></tr>
<tr><td>Sqrt</td><td>Newton-Raphson iteration</td><td>Conditional lookup</td><td>Increment until overshoot</td><td>Fixed-point increment</td></tr>
</table>
<div class="sr-totals">
<div class="sr-total-item"><strong>English:</strong> 5 methods, 22 instructions, 88 bytes + slide rule delegation (float)</div>
<div class="sr-total-item"><strong>JavaScript:</strong> 8 methods, 153 instructions, 612 bytes (integer)</div>
<div class="sr-total-item"><strong>Haskell:</strong> 11 methods, 151 instructions, 604 bytes (integer)</div>
<div class="sr-total-item"><strong>Symbolic Math:</strong> 5 methods, ~68 instructions, ~272 bytes (integer, strongly typed)</div>
<div class="sr-total-item"><strong>Lambda Calculus:</strong> 7 methods, ~56 instructions, ~224 bytes (integer, combinator)</div>
<div class="sr-total-item"><strong>Machine code:</strong> 3 methods, 19 instructions, 76 bytes (hand-optimised integer)</div>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Abstraction = Performance</div>
<p>English achieves the <strong>fewest instructions</strong> for Mul and Div by delegating to the slide rule abstraction &mdash; a pre-existing, tested capability that performs floating-point arithmetic via logarithmic scales.</p>
<p>Instead of compiling 35 instructions of shift-and-add (JS) or 8 instructions of repeated addition (HS), English compiles to just <strong>4 instructions</strong>: load the capability, pass parameters, call, return.</p>
<p>Lambda Calculus produces the <strong>most compact integer implementation</strong> for Mul and Div: the self-application pattern compiles to tight tail-recursive loops with minimal register spill.</p>
<p>Symbolic Math (Ada) produces more verbose but <strong>statically verified</strong> code: the compiler proves termination and type safety before emitting a single instruction word.</p>
<p>Higher-level language &rarr; fewer instructions &rarr; smaller lumps &rarr; faster execution &mdash; <em>when abstraction is used</em>.</p>
</div>
</div>
</div>`
            },
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';

        html += '<div class="sr-header">';
        html += '<h2>CLOOMC++ Language Tutorial</h2>';
        html += '<p class="sr-tagline">Six Front-Ends &bull; One Back-End &bull; The SlideRule Abstraction</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="cloomcTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="cloomcTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-container sr-type-intro">';
            html += '<div class="sr-step-title">CLOOMC++ Language Tutorial</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial walks through the Church Machine SlideRule abstraction implemented in all six CLOOMC++ front-ends: English, JavaScript, Haskell, Symbolic Math (Ada), Lambda Calculus, and Machine Code.</p>';
            html += '<p>Each front-end produces the same 20-instruction target. The same five operations &mdash; Add, Sub, Mul, Div, Sqrt &mdash; are implemented in every language with different styles and algorithm choices.</p>';
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CLOOMCTutorial;
}
