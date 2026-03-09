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
    }
];
