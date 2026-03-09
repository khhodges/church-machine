// Slides removed from the Church Machine Study for later rework
// To restore: copy the object back into the steps array in sliderule_tutorial.js

export const heldSlides = [
    {
        title: "Disassembly: Add (All Four Languages)",
        type: "disassembly",
        removedFrom: "slide 14",
        content: `<div class="sr-four-col">
<div class="sr-col">
<div class="sr-col-title">English &mdash; 2 instructions</div>
<pre class="sr-asm">0: CALL.AL [CL+0], #Add    ; call SlideRule.Add
1: IADD.AL DR0, DR0, DR1   ; a + b</pre>
</div>
<div class="sr-col">
<div class="sr-col-title">JavaScript &mdash; 4 instructions</div>
<pre class="sr-asm">0: IADD.AL DR12, DR0, #0   ; DR12 = a
1: IADD.AL DR12, DR12, #0  ; DR12 += b
2: IADD.AL DR4, DR12, #0   ; result = DR12
3: IADD.AL DR0, DR4, #0    ; DR0 = result</pre>
</div>
<div class="sr-col">
<div class="sr-col-title">Haskell &mdash; 3 instructions</div>
<pre class="sr-asm">0: IADD.AL DR12, DR0, #0   ; DR12 = a
1: IADD.AL DR12, DR0, #0   ; DR12 = a + b
2: IADD.AL DR0, DR12, #0   ; DR0 = result</pre>
</div>
<div class="sr-col">
<div class="sr-col-title">Machine code &mdash; 1 instruction</div>
<pre class="sr-asm">0: 0x7F600000              ; IADD DR0, DR0, DR1</pre>
</div>
</div>
<div class="sr-key-concept">
<div class="sr-concept-title">Four paths, one result</div>
<p><strong>Machine code</strong> is the most compact (1 instruction) &mdash; hand-written with zero overhead. <strong>English</strong> calls the slide rule abstraction directly (2 instructions), gaining floating-point access. <strong>Haskell</strong> avoids the explicit local variable (3 instructions). <strong>JavaScript</strong> is the most verbose (4 instructions) due to explicit temporaries. All four produce identical integer results for Add.</p>
</div>`
    },
    {
        title: "Disassembly: Clamp (Haskell's expressiveness)",
        type: "disassembly",
        removedFrom: "slide 16",
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
        title: "Disassembly: Mul (the dramatic difference)",
        type: "disassembly",
        removedFrom: "slide 14",
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
        title: "Performance: Static Code Size",
        type: "performance",
        removedFrom: "slide 15",
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
        removedFrom: "slide 16",
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
    }
];
