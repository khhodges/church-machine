class EnglishLoopsTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "Why Two Loop Styles?",
                type: "concept",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Traditional computers have <strong>one</strong> way to loop: compare a value, then <em>branch</em> back to the top. The Church Machine gives you <strong>two</strong>:</p>
<table class="sr-table">
<tr><th>Style</th><th>English Syntax</th><th>Hardware Mechanism</th></tr>
<tr><td><strong>While Loop</strong></td><td><code>While x is greater than 0</code><br><code>&hellip;</code><br><code>End while</code></td><td>MCMP + BRANCH</td></tr>
<tr><td><strong>Recursive Repeat</strong></td><td><code>Repeat with x, y</code></td><td>CALL CR6 (self-invocation)</td></tr>
</table>
<p>Both produce the same result. The difference is <em>how</em> the hardware executes them &mdash; and that difference matters for security, timing, and pipeline behaviour.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Why It Matters</div>
<p>A <strong>BRANCH</strong> instruction tells the processor to jump to a different address. Modern pipelines guess which way a branch will go (branch prediction). When they guess wrong, the pipeline stalls.</p>
<p>A <strong>CALL</strong> instruction invokes an abstraction through the capability system. There is no guessing &mdash; the target is always CR6 (the current method). The pipeline never stalls on a misprediction because there is no prediction to make.</p>
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
                title: "Recursive Repeat &mdash; The Church Way",
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
<p>CR6 always points to the currently executing abstraction. So <code>CALL CR6</code> means &ldquo;call myself again.&rdquo;</p>
<p>Result: <strong>10 instructions</strong>, with <strong>1 CALL</strong> per iteration (plus 1 BRANCH for the base-case guard).</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Repeat Synonyms</div>
<p>The English compiler accepts several ways to express self-invocation:</p>
<ul>
<li><code>Repeat with x, y</code></li>
<li><code>Recurse with x minus 1</code></li>
<li><code>Call self with a plus b</code></li>
<li><code>Call again with n, total</code></li>
</ul>
<p>All of these compile to <code>recall(args)</code>, which emits a <strong>CALL CR6</strong> instruction &mdash; the capability-based self-invocation primitive.</p>
</div>
</div>
</div>`
            },
            {
                title: "The Instructions Side by Side",
                type: "comparison",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Here is what the compiler actually produces for each method:</p>
<table class="sr-table sr-table-wide">
<tr><th>Method</th><th>Instructions</th><th>BRANCH</th><th>CALL</th><th>MCMP</th><th>Loop Mechanism</th></tr>
<tr><td><strong>WhileSum</strong></td><td>12</td><td>2</td><td>0</td><td>1</td><td>MCMP + BRANCH (traditional)</td></tr>
<tr><td><strong>RecurseSum</strong></td><td>10</td><td>1</td><td>1</td><td>1</td><td>CALL CR6 (self-invocation)</td></tr>
</table>
<p><strong>Key observation:</strong> WhileSum needs <strong>2 branches per iteration</strong> (one to check the condition, one to jump back). RecurseSum needs <strong>0 branches per iteration</strong> &mdash; its single BRANCH is only for the base-case exit, not for looping.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">The Tradeoff</div>
<p><strong>While loops</strong> are compact and familiar. They work well for tight inner loops where branch prediction is reliable. But each iteration involves a branch instruction that <em>can</em> stall the pipeline if mispredicted.</p>
<p><strong>Recursive repeat</strong> replaces the branch with a CALL. Every CALL goes through the capability system &mdash; it checks permissions, validates the Golden Token, and dispatches through CR6. This is slightly more work per iteration, but the timing is <em>perfectly predictable</em>. There is no branch to mispredict.</p>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">When to Use Which</div>
<p><strong>Use While</strong> when you want the most compact loop and branch prediction will be reliable (e.g., simple counted loops).</p>
<p><strong>Use Repeat</strong> when you want predictable, constant-time control flow &mdash; especially in security-critical code where timing side-channels matter.</p>
<p>The Church Machine is unique in offering both options in the same language. You choose the control-flow tradeoff in plain English.</p>
</div>
</div>
</div>`
            },
            {
                title: "Try It Yourself",
                type: "exercise",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Switch to the <strong>IDE</strong> view and click the <strong style="color:#4fc3f7">EN: Loops</strong> tab to load the full example. Then click <strong>Compile</strong> to see both methods assembled.</p>
<p>The console will show a <strong>LOOP STYLE COMPARISON</strong> at the bottom of the assembly listing, breaking down exactly how many BRANCH and CALL instructions each method uses.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Exercises</div>
<ol>
<li><strong>Add a third method</strong> called <code>WhileProduct</code> that multiplies numbers from 1 to n using a While loop. Compare its instruction count to the existing methods.</li>
<li><strong>Convert WhileSum to recursive</strong> &mdash; rewrite it using <code>Repeat with</code> instead of <code>While</code>. Does the instruction count change?</li>
<li><strong>Remove the base case</strong> from RecurseSum (delete the <code>If n is equal to 0</code> / <code>End if</code> block). What happens when you run it? (Hint: it will run forever &mdash; the capability system does not prevent infinite recursion, only unauthorised access.)</li>
</ol>
</div>
<p style="margin-top:1rem"><strong>Key takeaway:</strong> The Church Machine does not force you into one control-flow paradigm. You write in plain English, and you choose between branch-based loops and capability-based recursion depending on what matters most &mdash; compactness or predictability.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Bigger Picture</div>
<p>This tutorial covered just the <strong>English</strong> front-end. The same two styles exist in all five CLOOMC++ languages:</p>
<ul>
<li><strong>JavaScript:</strong> <code>while(n &gt; 0)</code> vs <code>recall(n, total)</code></li>
<li><strong>Haskell:</strong> guards vs recursive method calls</li>
<li><strong>Lambda Calculus:</strong> fixed-point combinators for recursion</li>
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
        html += '<p class="sr-tagline">While Loops &bull; Recursive Repeat &bull; Two Ways to Iterate</p>';
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
            html += '<div class="sr-step-title">English Loops &mdash; Two Ways to Iterate</div>';
            html += '<div class="sr-step-content">';
            html += '<p>The Church Machine offers two fundamentally different loop styles, both written in plain English:</p>';
            html += '<ul>';
            html += '<li><strong>While loops</strong> &mdash; traditional compare-and-branch iteration (MCMP + BRANCH)</li>';
            html += '<li><strong>Recursive repeat</strong> &mdash; self-invocation through the capability system (CALL CR6)</li>';
            html += '</ul>';
            html += '<p>This tutorial explains both styles, compares their compiled output, and shows you when to use each one.</p>';
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
