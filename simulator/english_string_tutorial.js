class EnglishStringTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "Strings on Integer-Only Hardware",
                type: "concept",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>The Church Machine has <strong>no string type</strong>. Every register holds a 32-bit integer. To work with text, we <strong>pack four ASCII characters</strong> into one word:</p>
<table class="sr-table">
<tr><th>Bits</th><th>Position</th><th>Meaning</th></tr>
<tr><td>[31:24]</td><td>0</td><td>Leftmost character</td></tr>
<tr><td>[23:16]</td><td>1</td><td>Second character</td></tr>
<tr><td>[15:8]</td><td>2</td><td>Third character</td></tr>
<tr><td>[7:0]</td><td>3</td><td>Rightmost character</td></tr>
</table>
<p>For example, <code>"HELL"</code> is stored as:<br>
<code>H(72)&lt;&lt;24 + E(69)&lt;&lt;16 + L(76)&lt;&lt;8 + L(76) = 1,214,606,412</code></p>
<p>The <strong>StringOps</strong> abstraction provides 14 methods for packing, unpacking, classifying, converting, and comparing characters &mdash; all written in plain English.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">ASCII Reference</div>
<p><code>Space = 32</code></p>
<p><code>0&ndash;9 = 48&ndash;57</code></p>
<p><code>A&ndash;Z = 65&ndash;90</code></p>
<p><code>a&ndash;z = 97&ndash;122</code></p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Why Pack?</div>
<p>Without packing, each character would consume an entire 32-bit register &mdash; wasting 24 bits per character. By packing four characters per word, we use <strong>all 32 bits</strong> and can process four characters in a single operation.</p>
</div>
</div>
</div>`
            },
            {
                title: "Pack4 &mdash; Assembling a Word",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p><strong>Pack4</strong> takes four ASCII codes and combines them into a single 32-bit word using shift-and-add:</p>
<pre class="sr-code sr-code-en">Add a method called Pack4 that takes ch0 and ch1 and ch2 and ch3
Set a to ch0 shifted left by 24
Set b to ch1 shifted left by 16
Set c to ch2 shifted left by 8
Set word to a plus b
Set word to word plus c
Set word to word plus ch3
Return word</pre>
<p>Each character is shifted into its position and summed:</p>
<ol>
<li><code>ch0 &lt;&lt; 24</code> &mdash; place in bits [31:24]</li>
<li><code>ch1 &lt;&lt; 16</code> &mdash; place in bits [23:16]</li>
<li><code>ch2 &lt;&lt; 8</code> &mdash; place in bits [15:8]</li>
<li><code>ch3</code> &mdash; stays in bits [7:0]</li>
</ol>
<p>Example: <code>Pack4(72, 69, 76, 76)</code> produces the packed word for <code>"HELL"</code>.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Hardware View</div>
<p>This compiles to 3 <strong>ISHIFT</strong> instructions (left shifts) and 3 <strong>IADD</strong> instructions. No bitwise OR is needed &mdash; since each shifted value occupies non-overlapping bit positions, addition is equivalent to OR.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Why Not OR?</div>
<p>The English translator does not yet support bitwise OR. Fortunately, when bit fields do not overlap, <code>a + b</code> gives the same result as <code>a | b</code>. Pack4 exploits this property.</p>
</div>
</div>
</div>`
            },
            {
                title: "Unpack &mdash; Extracting a Character",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p><strong>Unpack</strong> extracts a single character from a packed word by position (0&ndash;3). The technique is <em>shift-and-subtract</em>:</p>
<pre class="sr-code sr-code-en">Add a method called Unpack that takes word and pos
If pos is equal to 0
    Set ch to word shifted right by 24
    Return ch
End if
If pos is equal to 1
    Set hi to word shifted right by 24
    Set top to hi shifted left by 8
    Set raw to word shifted right by 16
    Set ch to raw minus top
    Return ch
End if
...</pre>
<div class="sr-key-concept">
<div class="sr-concept-title">The Shift-and-Subtract Trick</div>
<p>Without bitwise AND, we cannot mask off unwanted bits directly. Instead:</p>
<ol>
<li><strong>Shift right</strong> to bring the target byte plus higher bytes to the bottom.</li>
<li><strong>Shift right further</strong> to isolate just the higher bytes, then <strong>shift left</strong> to align them.</li>
<li><strong>Subtract</strong> the higher bytes &mdash; what remains is the target byte alone.</li>
</ol>
<p>For position 1: <code>(word &gt;&gt; 16) &minus; ((word &gt;&gt; 24) &lt;&lt; 8)</code> cancels the char-0 contribution, leaving only char-1.</p>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Position Map</div>
<table class="sr-table">
<tr><th>pos</th><th>Extraction</th></tr>
<tr><td>0</td><td><code>word &gt;&gt; 24</code> (simple shift)</td></tr>
<tr><td>1</td><td><code>(word &gt;&gt; 16) &minus; ((word &gt;&gt; 24) &lt;&lt; 8)</code></td></tr>
<tr><td>2</td><td><code>(word &gt;&gt; 8) &minus; ((word &gt;&gt; 16) &lt;&lt; 8)</code></td></tr>
<tr><td>3</td><td><code>word &minus; ((word &gt;&gt; 8) &lt;&lt; 8)</code></td></tr>
</table>
<p>Each extraction uses at most 4 instructions: two shifts, one shift-back, and one subtract.</p>
</div>
</div>
</div>`
            },
            {
                title: "Character Classification",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Five classification methods test a character&rsquo;s ASCII range. Each returns <strong>1</strong> (true) or <strong>0</strong> (false):</p>
<pre class="sr-code sr-code-en">Add a method called IsLetter that takes ch
If ch is greater than 64
    If ch is less than 91
        Return 1
    End if
End if
If ch is greater than 96
    If ch is less than 123
        Return 1
    End if
End if
Return 0</pre>
<p>The pattern is the same for all classifiers &mdash; nested <code>If</code> blocks that check whether the character falls within a range:</p>
<table class="sr-table">
<tr><th>Method</th><th>Range Check</th><th>ASCII</th></tr>
<tr><td><strong>IsLetter</strong></td><td>A&ndash;Z or a&ndash;z</td><td>65&ndash;90 or 97&ndash;122</td></tr>
<tr><td><strong>IsDigit</strong></td><td>0&ndash;9</td><td>48&ndash;57</td></tr>
<tr><td><strong>IsUpper</strong></td><td>A&ndash;Z</td><td>65&ndash;90</td></tr>
<tr><td><strong>IsLower</strong></td><td>a&ndash;z</td><td>97&ndash;122</td></tr>
<tr><td><strong>IsSpace</strong></td><td>space only</td><td>32</td></tr>
</table>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Why &ldquo;Greater Than 64&rdquo;?</div>
<p>ASCII <code>A</code> is 65. The English compiler uses <code>is greater than</code> (strict), so we test <code>&gt; 64</code> and <code>&lt; 91</code> to match 65&ndash;90 inclusive.</p>
<p>This two-comparison pattern is the standard way to test a closed range when you only have strict inequality: <code>x &gt; (low&minus;1)</code> and <code>x &lt; (high+1)</code>.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Hardware Cost</div>
<p>Each range check compiles to 2 <strong>MCMP</strong> + 2 <strong>BRANCH</strong> instructions. IsLetter checks two ranges, so it needs 4 MCMP + 4 BRANCH total.</p>
</div>
</div>
</div>`
            },
            {
                title: "Case Conversion &amp; Character Arithmetic",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Case conversion exploits the ASCII layout: uppercase and lowercase letters differ by exactly <strong>32</strong>.</p>
<pre class="sr-code sr-code-en">Add a method called ToUpper that takes ch
If ch is greater than 96
    If ch is less than 123
        Set result to ch minus 32
        Return result
    End if
End if
Return ch

Add a method called ToLower that takes ch
If ch is greater than 64
    If ch is less than 91
        Set result to ch plus 32
        Return result
    End if
End if
Return ch</pre>
<p><strong>Character arithmetic</strong> converts between ASCII digits and integer values:</p>
<pre class="sr-code sr-code-en">Add a method called CharToDigit that takes ch
If ch is greater than 47
    If ch is less than 58
        Set result to ch minus 48
        Return result
    End if
End if
Return 0

Add a method called DigitToChar that takes digit
Set result to digit plus 48
Return result</pre>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Magic Number 32</div>
<p>In ASCII, <code>'a' &minus; 'A' = 97 &minus; 65 = 32</code>. This is not a coincidence &mdash; ASCII was designed so that case conversion is a single bit flip (bit 5). On hardware with bitwise ops, ToUpper is just <code>ch &amp; ~0x20</code>. On the Church Machine&rsquo;s English front-end, we use subtraction instead.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Safe Passthrough</div>
<p>Both ToUpper and ToLower check the range <em>before</em> modifying. If the character is already the correct case (or is not a letter at all), it passes through unchanged. This makes them safe to call on any character.</p>
</div>
</div>
</div>`
            },
            {
                title: "Word-Level Operations",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Three methods operate on entire packed words rather than individual characters:</p>
<div class="sr-key-concept">
<div class="sr-concept-title">ReverseWord</div>
<p>Extracts all four characters using the shift-and-subtract technique, then repacks them in reverse order. <code>"ABCD"</code> becomes <code>"DCBA"</code>.</p>
<pre class="sr-code sr-code-en">Add a method called ReverseWord that takes word
Set ch0 to word shifted right by 24
-- extract ch1, ch2, ch3 via shift-and-subtract ...
Set a to ch3 shifted left by 24
Set b to ch2 shifted left by 16
Set c to ch1 shifted left by 8
Set result to a plus b
Set result to result plus c
Set result to result plus ch0
Return result</pre>
</div>
<div class="sr-key-concept" style="margin-top:0.75rem">
<div class="sr-concept-title">CompareWords</div>
<p>Compares two packed words numerically. Returns 0 if equal, 1 if <code>a &gt; b</code>, or the difference <code>a &minus; b</code> otherwise. Because characters are packed big-endian (leftmost character in the highest bits), numeric comparison gives <strong>lexicographic order</strong>.</p>
</div>
<div class="sr-key-concept" style="margin-top:0.75rem">
<div class="sr-concept-title">CountLetters</div>
<p>Extracts each of the four bytes and checks if it falls in the A&ndash;Z or a&ndash;z range. Returns a count from 0 to 4. This method inlines the IsLetter logic rather than calling it, avoiding four CALL instructions.</p>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Big-Endian = Lexicographic</div>
<p>Because char 0 occupies bits [31:24], a simple integer comparison of two packed words gives the same result as comparing the strings character by character. <code>"ABCD" &lt; "ABCE"</code> because the packed integer for &ldquo;ABCD&rdquo; is smaller.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Instruction Cost</div>
<p><strong>ReverseWord:</strong> 4 unpack sequences + 1 repack = ~18 instructions</p>
<p><strong>CompareWords:</strong> 2 MCMP + 2 BRANCH + 1 ISUB = ~5 instructions</p>
<p><strong>CountLetters:</strong> 4&times;(unpack + 2 range checks) = ~40+ instructions &mdash; the most expensive method in StringOps</p>
</div>
</div>
</div>`
            },
            {
                title: "Try It Yourself",
                type: "exercise",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Switch to the <strong>IDE</strong> view and click the <strong style="color:#4fc3f7">EN: String</strong> tab to load the full StringOps abstraction. Then click <strong>Compile</strong> to see all 14 methods assembled.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Exercises</div>
<ol>
<li><strong>Pack and Unpack:</strong> Use Pack4 to encode <code>"COOL"</code> (67, 79, 79, 76). Then Unpack position 2 &mdash; you should get 79 (<code>'O'</code>).</li>
<li><strong>Case flip:</strong> Take the ASCII code for <code>'h'</code> (104) and pass it to ToUpper. Verify you get 72 (<code>'H'</code>). Then pass 72 to ToLower &mdash; you should get 104 back.</li>
<li><strong>Reverse a word:</strong> Pack <code>"STOP"</code> (83, 84, 79, 80), then call ReverseWord. Unpack the result to confirm it reads <code>"POTS"</code>.</li>
<li><strong>Count letters:</strong> Pack a word with a digit in it, like <code>"A1BC"</code> (65, 49, 66, 67). CountLetters should return 3.</li>
<li><strong>Lexicographic compare:</strong> Pack <code>"AABB"</code> and <code>"AABC"</code>. CompareWords should show the first is less than the second (returns a negative difference).</li>
</ol>
</div>
<p style="margin-top:1rem"><strong>Key takeaway:</strong> On integer-only hardware, strings are just numbers with structure. By choosing a consistent packing convention and building operations from shifts, adds, and subtracts, the English front-end provides a full string toolkit &mdash; no hardware string support required.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The 14 Methods</div>
<table class="sr-table">
<tr><th>Category</th><th>Methods</th></tr>
<tr><td>Pack/Unpack</td><td>Pack4, Unpack</td></tr>
<tr><td>Classify</td><td>IsLetter, IsDigit, IsUpper, IsLower, IsSpace</td></tr>
<tr><td>Convert</td><td>ToUpper, ToLower</td></tr>
<tr><td>Arithmetic</td><td>CharToDigit, DigitToChar</td></tr>
<tr><td>Word Ops</td><td>ReverseWord, CompareWords, CountLetters</td></tr>
</table>
<div class="sr-comp-side-title" style="margin-top:0.75rem">What&rsquo;s Next?</div>
<p><strong>ReplaceChar</strong> (the 15th method) is planned but deferred &mdash; it requires bitwise AND/OR masking not yet supported by the English translator. Once <code>bfext</code> support arrives, ReplaceChar will complete the set.</p>
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
        html += '<h2>English String Operations Tutorial</h2>';
        html += '<p class="sr-tagline">Packed Strings &bull; Pack4 / Unpack &bull; Classification &bull; Case Conversion &bull; Word Operations</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="englishStringTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="englishStringTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-title">English String Operations &mdash; Text on Integer Hardware</div>';
            html += '<div class="sr-step-content">';
            html += '<p>The Church Machine has no string type &mdash; every register is a 32-bit integer. This tutorial walks you through the <strong>StringOps</strong> abstraction, which provides a complete string toolkit built entirely from shifts, adds, and subtracts:</p>';
            html += '<ul>';
            html += '<li><strong>Pack4 / Unpack</strong> &mdash; assemble and extract characters from packed words</li>';
            html += '<li><strong>Character classification</strong> &mdash; IsLetter, IsDigit, IsUpper, IsLower, IsSpace</li>';
            html += '<li><strong>Case conversion</strong> &mdash; ToUpper, ToLower using the ASCII &plusmn;32 trick</li>';
            html += '<li><strong>Character arithmetic</strong> &mdash; CharToDigit, DigitToChar for ASCII &harr; integer</li>';
            html += '<li><strong>Word operations</strong> &mdash; ReverseWord, CompareWords, CountLetters</li>';
            html += '</ul>';
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
    module.exports = EnglishStringTutorial;
}
if (typeof window !== 'undefined') {
    window.EnglishStringTutorial = EnglishStringTutorial;
}
