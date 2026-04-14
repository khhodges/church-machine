class EnglishLoopsTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "Why Three Loop Styles?",
                type: "concept",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Traditional computers have <strong>one</strong> way to loop: compare a value, then <em>branch</em> back to the top. The Church Machine gives you <strong>three</strong>:</p>
<table class="sr-table">
<tr><th>Style</th><th>English Syntax</th><th>Hardware Mechanism</th><th>Frame</th></tr>
<tr><td><strong>While Loop</strong></td><td><code>While x is greater than 0</code><br><code>&hellip;</code><br><code>End while</code></td><td>MCMP + BRANCH</td><td>&mdash;</td></tr>
<tr><td><strong>Recursive Repeat</strong></td><td><code>Repeat with x, y</code></td><td>CALL CR6</td><td>2 words (SZ=1)</td></tr>
<tr><td><strong>Lambda Recursion</strong></td><td><code>Apply lambda with x, y</code></td><td>LAMBDA CR6</td><td>1 word (SZ=0)</td></tr>
</table>
<p>All three produce the same result. The difference is <em>how</em> the hardware executes them &mdash; and that difference matters for security, timing, and overhead.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Spectrum</div>
<p><strong>BRANCH</strong> is familiar but unpredictable (pipeline stalls on misprediction).</p>
<p><strong>CALL</strong> is predictable and secure (full capability check, namespace gate swap) but pushes a 2-word frame.</p>
<p><strong>LAMBDA</strong> is the lightest &mdash; only a 1-word frame, no namespace swap, no gate overhead. It is the fastest recursion primitive on the Church Machine.</p>
</div>
</div>
</div>`
            },
            {
                title: "While Loop &mdash; The Familiar Way",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The <strong>While loop</strong> works exactly as you would expect from any programming language, but written in plain English:</p>
<pre class="sr-code sr-code-en">Add a method called WhileSum that takes n
Set total to 0
While n is greater than 0
    Set total to total plus n
    Set n to n minus 1
End while
Return total</pre>
<p>This compiles to a <strong>compare-and-branch loop</strong>:</p>
<ol>
<li><strong>MCMP</strong> &mdash; compare <code>n</code> to <code>0</code></li>
<li><strong>BRANCH</strong> &mdash; if not greater, skip past <code>End while</code></li>
<li>Execute the loop body (IADD, ISUB)</li>
<li><strong>BRANCH</strong> &mdash; jump back to step 1</li>
</ol>
<p>Result: <strong>12 instructions</strong>, with <strong>2 BRANCH</strong> and <strong>1 MCMP</strong> per iteration.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Supported Conditions</div>
<p>The English compiler understands these comparison phrases:</p>
<ul>
<li><code>is greater than</code></li>
<li><code>is less than</code></li>
<li><code>is equal to</code> / <code>equals</code></li>
<li><code>is not equal to</code></li>
<li><code>is greater than or equal to</code></li>
<li><code>is less than or equal to</code></li>
</ul>
<p>You can also write <code>Loop while &hellip;</code> and <code>End loop</code> as alternatives to <code>While &hellip;</code> and <code>End while</code>.</p>
</div>
</div>
</div>`
            },
            {
                title: "Recursive Repeat &mdash; CALL CR6",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The <strong>Recursive Repeat</strong> does the same computation without any loop structure. Instead, the method calls <em>itself</em> with updated values:</p>
<pre class="sr-code sr-code-en">Add a method called RecurseSum that takes n and total
If n is equal to 0
    Return total
End if
Set total to total plus n
Set n to n minus 1
Repeat with n, total</pre>
<p>The <code>Repeat with n, total</code> line compiles to:</p>
<ol>
<li><strong>LOAD</strong> the updated arguments into data registers</li>
<li><strong>CALL CR6</strong> &mdash; re-invoke the current method</li>
</ol>
<p>CALL CR6 pushes a <strong>2-word stack frame</strong> (SZ=1) and performs a full namespace gate swap. This means every iteration goes through the capability validation pipeline.</p>
<p>Result: <strong>10 instructions</strong>, with <strong>1 CALL</strong> per iteration (plus 1 BRANCH for the base-case guard).</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Repeat Synonyms</div>
<p>The English compiler accepts several ways to express CALL-based self-invocation:</p>
<ul>
<li><code>Repeat with x, y</code></li>
<li><code>Recurse with x minus 1</code></li>
<li><code>Call self with a plus b</code></li>
<li><code>Call again with n, total</code></li>
</ul>
<p>All of these compile to <code>recall(args)</code>, which emits a <strong>CALL CR6</strong> instruction.</p>
</div>
</div>
</div>`
            },
            {
                title: "Lambda Recursion &mdash; LAMBDA CR6",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p><strong>Lambda recursion</strong> is the lightest self-invocation on the Church Machine. It uses the LAMBDA opcode instead of CALL:</p>
<pre class="sr-code sr-code-en">Add a method called LambdaSum that takes n and total
If n is equal to 0
    Return total
End if
Set total to total plus n
Set n to n minus 1
Apply lambda with n, total</pre>
<p>The <code>Apply lambda with n, total</code> line compiles to:</p>
<ol>
<li><strong>LOAD</strong> the updated arguments into data registers</li>
<li><strong>LAMBDA CR6</strong> &mdash; lightweight self-invocation</li>
</ol>
<div class="sr-key-concept">
<div class="sr-concept-title">Why LAMBDA is Faster</div>
<p><strong>CALL</strong> pushes a 2-word frame (SZ=1) and performs a namespace gate swap &mdash; it re-validates capabilities and switches the execution context. This is secure but heavyweight.</p>
<p><strong>LAMBDA</strong> pushes only a 1-word frame (SZ=0) and skips the namespace gate entirely. No capability re-validation, no context switch overhead. It is a pure functional reduction &mdash; the lightest way to re-enter your own code.</p>
</div>
<p>Result: <strong>10 instructions</strong>, with <strong>1 LAMBDA</strong> per iteration &mdash; same count as RecurseSum but with half the stack overhead.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Lambda Synonyms</div>
<p>The English compiler accepts several ways to express LAMBDA-based self-invocation:</p>
<ul>
<li><code>Apply lambda with x, y</code></li>
<li><code>Lambda repeat with x minus 1</code></li>
<li><code>Lambda recurse with a, b</code></li>
<li><code>Lambda self with count</code></li>
</ul>
<p>All of these compile to <code>relambda(args)</code>, which emits a <strong>LAMBDA CR6</strong> instruction.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Stack Cost Per Iteration</div>
<p><strong>CALL:</strong> 2 words per frame &times; N iterations<br>
<strong>LAMBDA:</strong> 1 word per frame &times; N iterations</p>
<p>For deep recursion (large N), LAMBDA uses half the stack space.</p>
</div>
</div>
</div>`
            },
            {
                title: "All Three Side by Side",
                type: "comparison",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Here is what the compiler actually produces for each method:</p>
<table class="sr-table sr-table-wide">
<tr><th>Method</th><th>Instructions</th><th>BRANCH</th><th>CALL</th><th>LAMBDA</th><th>Loop Mechanism</th></tr>
<tr><td><strong>WhileSum</strong></td><td>12</td><td>2</td><td>0</td><td>0</td><td>MCMP + BRANCH</td></tr>
<tr><td><strong>RecurseSum</strong></td><td>10</td><td>1</td><td>1</td><td>0</td><td>CALL CR6 (SZ=1, 2-word frame)</td></tr>
<tr><td><strong>LambdaSum</strong></td><td>10</td><td>1</td><td>0</td><td>1</td><td>LAMBDA CR6 (SZ=0, 1-word frame)</td></tr>
</table>
<p><strong>Key observations:</strong></p>
<ul>
<li>WhileSum needs <strong>2 branches per iteration</strong>. RecurseSum and LambdaSum need <strong>0</strong> (the single BRANCH is the base-case exit).</li>
<li>RecurseSum and LambdaSum have the <strong>same instruction count</strong> (10), but LambdaSum uses half the stack per iteration.</li>
<li>LambdaSum is the <strong>lightest recursion</strong> available &mdash; no branches for looping, no namespace gate overhead.</li>
</ul>
<div class="sr-key-concept">
<div class="sr-concept-title">The Full Spectrum</div>
<p><strong>While</strong> &rarr; Most compact code, but 2 branches per iteration (pipeline risk).<br>
<strong>CALL</strong> &rarr; Predictable timing, full capability check, but 2 words of stack per iteration.<br>
<strong>LAMBDA</strong> &rarr; Fastest and lightest &mdash; 1 word of stack, no namespace swap, no branch.</p>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">When to Use Each</div>
<p><strong>While:</strong> Simple counted loops where branch prediction is reliable.</p>
<p><strong>CALL (Repeat):</strong> Security-critical recursion where you need capability re-validation on every iteration.</p>
<p><strong>LAMBDA (Apply lambda):</strong> Performance-critical recursion where you trust the current context and want minimum overhead. This is the Church Machine&rsquo;s fastest iteration primitive.</p>
</div>
</div>
</div>`
            },
            {
                title: "Try It Yourself",
                type: "exercise",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Switch to the <strong>IDE</strong> view and click the <strong style="color:#4fc3f7">EN: Loops</strong> tab to load the full example. Then click <strong>Compile</strong> to see all three methods assembled.</p>
<p>The console will show a <strong>LOOP STYLE COMPARISON</strong> at the bottom of the assembly listing, breaking down exactly how many BRANCH, CALL, and LAMBDA instructions each method uses.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Exercises</div>
<ol>
<li><strong>Compare stack depth:</strong> Run each method with n=5. RecurseSum uses 2&times;5 = 10 stack words. LambdaSum uses 1&times;5 = 5. Check the stack top offset (STO) in the CRs panel to verify.</li>
<li><strong>Convert WhileSum to lambda:</strong> Rewrite it using <code>Apply lambda with</code> instead of <code>While</code>. Does the instruction count match LambdaSum?</li>
<li><strong>Security experiment:</strong> Try changing <code>Repeat with</code> to <code>Apply lambda with</code> in RecurseSum. The result is the same, but the security properties change &mdash; LAMBDA skips the capability gate.</li>
</ol>
</div>
<p style="margin-top:1rem"><strong>Key takeaway:</strong> The Church Machine gives you a spectrum from heavyweight (CALL) to lightweight (LAMBDA) to branchless iteration (While), all expressible in plain English. You choose the tradeoff.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Bigger Picture</div>
<p>This tutorial covered the <strong>English</strong> front-end. The same three styles exist across CLOOMC++ languages:</p>
<ul>
<li><strong>JavaScript:</strong> <code>while()</code> / <code>recall()</code> / <code>relambda()</code></li>
<li><strong>Haskell:</strong> guards / recursive calls / lambda application</li>
<li><strong>Lambda Calculus:</strong> fixed-point combinators use LAMBDA natively</li>
</ul>
<p>Every language compiles to the same 20-instruction ISA. The <em>style</em> changes; the <em>target</em> never does.</p>
</div>
</div>
</div>`
            }
        ];
    }

    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '<div class="sr-wrapper">';

        html += '<div class="sr-header">';
        html += '<h2>English Loops Tutorial</h2>';
        html += '<p class="sr-tagline">While Loops &bull; CALL Recursion &bull; LAMBDA Recursion &bull; Three Ways to Iterate</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="englishLoopsTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="englishLoopsTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-title">English Loops &mdash; Three Ways to Iterate</div>';
            html += '<div class="sr-step-content">';
            html += '<p>The Church Machine offers three fundamentally different loop styles, all written in plain English:</p>';
            html += '<ul>';
            html += '<li><strong>While loops</strong> &mdash; traditional compare-and-branch iteration (MCMP + BRANCH)</li>';
            html += '<li><strong>Recursive repeat</strong> &mdash; self-invocation via CALL CR6 (2-word frame, capability-checked)</li>';
            html += '<li><strong>Lambda recursion</strong> &mdash; lightweight self-invocation via LAMBDA CR6 (1-word frame, fastest)</li>';
            html += '</ul>';
            html += '<p>This tutorial explains all three styles, compares their compiled output, and shows you when to use each one.</p>';
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
    module.exports = EnglishLoopsTutorial;
}
if (typeof window !== 'undefined') {
    window.EnglishLoopsTutorial = EnglishLoopsTutorial;
}
