class EnglishContactTutorial {
    constructor() {
        this.currentStep = -1;
        this.steps = this._buildSteps();
    }

    _buildSteps() {
        return [
            {
                title: "From Registers to Words &mdash; Three Stages",
                type: "concept",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Every CLOOMC namespace begins as a nearly empty space — a handful of hardware names that mean nothing beyond the chip itself. Through three stages it becomes something qualitatively different: a <strong>domain-specific language</strong> for the application it supports.</p>
<table class="sr-table">
<tr><th>Stage</th><th>Vocabulary Source</th><th>Naming Unit</th><th>Example Expression</th></tr>
<tr><td><strong>1</strong></td><td>Hardware registers</td><td>Register (DR3, CR6)</td><td><code>DREAD DR1, CR3, 0</code></td></tr>
<tr><td><strong>2</strong></td><td>Platform abstractions</td><td>Method (Identity.Lookup)</td><td><code>Identity.Lookup("myMother")</code></td></tr>
<tr><td><strong>3</strong></td><td>Domain abstractions</td><td>Concept (Contact.Connect)</td><td><code>Contact.Connect(me, myMother)</code></td></tr>
</table>
<p>The running example in this tutorial is a PP250 telecommunications system. The goal is to reach a point where connecting two people is expressed as a single line:</p>
<pre class="sr-code sr-code-en">Contact.Connect(me, myMother)</pre>
<p>This tutorial walks through each stage and shows <em>why</em> the final line is not merely convenient — it is <strong>hardware-enforced</strong>.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Seventh Principle</div>
<p>The CLOOMC Manifesto describes this moment:</p>
<p><em>&ldquo;A PP250 telecommunications system &hellip; The CLOOMC++ source written against that namespace eventually reads: <code>Contact.Connect(me, myMother)</code>. That single line is a direct translation into a CALL instruction plus Golden Token arguments.&rdquo;</em></p>
<p>That translation is four or five machine instructions. Everything else &mdash; identity resolution, medium selection, session negotiation &mdash; is inside the sealed lump, where it belongs.</p>
</div>
</div>
</div>`
            },
            {
                title: "Stage 1 &mdash; The Vocabulary of the Chip",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>At Stage 1, a fresh namespace contains only hardware-level names. Every register is a chip artefact:</p>
<pre class="sr-code sr-code-en">; Stage 1 — pure machine-level pet names
; No abstractions. No meaningful names. Just registers.

method run [pet name] {
    LOAD CR3, CR6, #2       ; load the contact GT from c-list slot 2
    DREAD DR1, CR3, 0       ; read field 0 of the contact object into DR1
    DREAD DR2, CR3, 1       ; read field 1 of the contact object into DR2
    DWRITE DR1, CR3, 4      ; write DR1 into device register 4
    DWRITE DR2, CR3, 5
    RETURN AL
}</pre>
<p>Every detail requires implicit knowledge the developer must hold in their head:</p>
<ul>
<li>Slot 2 is the contact token</li>
<li>Fields 0 and 1 are the address parts</li>
<li>Device registers 4 and 5 are the routing outputs</li>
</ul>
<p>None of that is in the code. The vocabulary is the vocabulary of the chip. <strong>The problem is invisible.</strong></p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">What is Missing</div>
<p>At Stage 1 there is no name for:</p>
<ul>
<li>The concept of a <em>contact</em> &mdash; it is just "slot 2"</li>
<li>The concept of an <em>address</em> &mdash; it is just "fields 0 and 1"</li>
<li>The concept of <em>routing</em> &mdash; it is just "device registers 4 and 5"</li>
</ul>
<p>Every developer who touches this code must re-learn the same implicit mapping. When the mapping changes, nothing in the code tells you — until something breaks.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Register Model</div>
<p><strong>DR0&ndash;DR15</strong>: data registers (DR0 is always zero)</p>
<p><strong>CR0&ndash;CR15</strong>: capability registers (CR6 holds the c-list base; CR14 holds the code object; CR12/13/15 are reserved)</p>
</div>
</div>
</div>`
            },
            {
                title: "Stage 2 &mdash; Platform Abstractions",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Stage 2 introduces sealed platform abstractions. Three are relevant for the telecommunications example:</p>
<table class="sr-table">
<tr><th>Abstraction</th><th>Public Methods</th><th>Role</th></tr>
<tr><td><strong>Mint</strong></td><td>Create, Transfer</td><td>Allocate capability tokens for new objects</td></tr>
<tr><td><strong>WordString</strong></td><td>GetCharCount, GetCharByte, &hellip;</td><td>Work with UTF-8 string data</td></tr>
<tr><td><strong>Identity</strong></td><td>Lookup, GetAddress</td><td>Resolve an identity token to a network address</td></tr>
</table>
<p>With these loaded, the same program becomes:</p>
<pre class="sr-code sr-code-en">method run [pet name] {
    LOAD Identity
    LOAD WordString

    addressToken = Identity.Lookup("myMother")
    charCount = WordString.GetCharCount(addressToken)

    LOAD Mint
    sessionToken = Mint.Create(128, 0x3)

    DWRITE sessionToken, CR3, 4
    RETURN AL
}</pre>
<p>The pet-name compiler resolves each <code>Abstraction.Method</code> call into the correct <code>LOAD CRn + CALL</code> sequence automatically.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">What Has Improved</div>
<p><code>Identity.Lookup("myMother")</code> is a meaningful name. The developer does not need to know which c-list slot holds the Identity GT, which DR carries the selector, or how the CALL is structured.</p>
<p><code>Mint.Create</code> replaces a hand-coded DREAD/DWRITE sequence against a memory manager whose internal logic is now hidden behind the lump seal.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">What is Still Missing</div>
<p>There is no name for <em>connecting</em> a contact. The developer still assembles the connection logic by hand: load an address, create a session, write to a device register.</p>
<p>The concept of a <em>medium</em> (voice, text, email) does not exist in the vocabulary at all. It is buried inside a DWRITE to a device register whose meaning is documented somewhere outside the code.</p>
</div>
</div>
</div>`
            },
            {
                title: "Public / Private &mdash; Why the Seal Matters",
                type: "concept",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Before reaching Stage 3, it is worth understanding the mechanism that makes the vocabulary <strong>trustworthy</strong>. Consider <code>Mint.Revoke</code> &mdash; the internal method that invalidates a capability token. Only <code>Mint.Create</code> should ever trigger it:</p>
<pre class="sr-code sr-code-en">abstraction Mint {
    capabilities { Memory }

    public method Create(size, perms) {
        result = call(Memory.Allocate(size))
        return(result)
    }

    private method Revoke(index) {
        var word2 = read(CR7, 2)
        var version = bfext(word2, 25, 7)
        var newVersion = version + 1
        bfins(word2, newVersion, 25, 7)
        write(CR7, 2, word2)
        return(newVersion)
    }

    public method Transfer(gt) {
        return(gt)
    }
}</pre>
<p>The compiled lump layout is:</p>
<table class="sr-table">
<tr><th>Slot</th><th>Content</th><th>Selector</th></tr>
<tr><td>M00</td><td>Dispatch table (auto-generated)</td><td>&mdash;</td></tr>
<tr><td>M01</td><td>Create &mdash; <strong>public</strong></td><td>1</td></tr>
<tr><td>M02</td><td>Revoke &mdash; <strong>private</strong>, no selector</td><td>&mdash;</td></tr>
<tr><td>M03</td><td>Transfer &mdash; <strong>public</strong></td><td>2</td></tr>
</table>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Structural Unreachability</div>
<p>No external selector reaches <code>Revoke</code>. The dispatch table does not route to it. The lump seal prevents any external code from modifying M00 to add such a route.</p>
<p><code>Revoke</code> exists in the binary, but it is <strong>unreachable from outside</strong> &mdash; not by convention, but because the hardware will not permit the path.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Why This Matters</div>
<p>When you call <code>Mint.Create</code>, you are not relying on <code>Revoke</code> being undocumented. You are relying on a <strong>mathematical property</strong> of the sealed lump: there is no path from any external call to <code>Revoke</code>.</p>
<p>Every public method name is a word with a hardware-enforced meaning. That is what makes the vocabulary grow in <em>value</em> as the namespace grows in <em>size</em>.</p>
</div>
</div>
</div>`
            },
            {
                title: "Stage 3 &mdash; The Contact Abstraction",
                type: "code",
                lang: "en",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Stage 3 adds domain abstractions whose names come from the application's problem domain:</p>
<table class="sr-table">
<tr><th>Abstraction</th><th>Public Methods</th><th>Role</th></tr>
<tr><td><strong>Contact</strong></td><td>Connect, Disconnect, GetStatus</td><td>Manage person-to-person connections</td></tr>
<tr><td><strong>Identity</strong></td><td>Lookup, Register, Verify</td><td>Resolve and authenticate identity tokens</td></tr>
<tr><td><em>Routing</em></td><td><em>(private)</em></td><td>Hidden inside Contact</td></tr>
<tr><td><em>Media</em></td><td><em>(private)</em></td><td>Hidden inside Contact</td></tr>
</table>
<p><code>Routing</code> and <code>Media</code> are not in the public vocabulary. They are private implementation details of <code>Contact</code> &mdash; the developer writing application code never sees them.</p>
<pre class="sr-code sr-code-en">abstraction Contact {
    capabilities { Identity, Routing, Media, Mint }

    public method Connect(callerToken, calleeToken) {
        callerAddress = Identity.Lookup(callerToken)
        calleeAddress = Identity.Lookup(calleeToken)
        medium = Routing.SelectMedium(callerAddress, calleeAddress)
        session = Media.Open(medium, callerAddress, calleeAddress)
        sessionToken = Mint.Create(64, 0x3)
        return(sessionToken)
    }

    public method Disconnect(sessionToken) {
        Media.Close(sessionToken)
        return(0)
    }

    public method GetStatus(sessionToken) {
        status = Media.QueryStatus(sessionToken)
        return(status)
    }

    private method ResolveLocation(addressToken) {
        raw = Identity.GetAddress(addressToken)
        return(raw)
    }
}</pre>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Three-Selector Dispatch Table</div>
<p>The compiled dispatch table for <code>Contact</code> exposes exactly <strong>three selectors</strong>:</p>
<table class="sr-table">
<tr><th>Selector</th><th>Method</th><th>Visibility</th></tr>
<tr><td>1</td><td>Connect</td><td>Public</td></tr>
<tr><td>2</td><td>Disconnect</td><td>Public</td></tr>
<tr><td>3</td><td>GetStatus</td><td>Public</td></tr>
</table>
<p>There is no selector for <code>ResolveLocation</code>, nor for any of the <code>Routing</code> and <code>Media</code> calls. They are structurally absent from the external interface.</p>
<div class="sr-comp-side-title" style="margin-top:0.75rem">What Routing.SelectMedium Does</div>
<p>Selects the best available communication medium (voice, text, email) based on the resolved network addresses of both parties. The caller never sees this logic &mdash; it is a private internal call, sealed away by the lump.</p>
</div>
</div>
</div>`
            },
            {
                title: "The Final Line",
                type: "comparison",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>With <code>Contact</code> sealed in the namespace, the complete program is:</p>
<pre class="sr-code sr-code-en">; Stage 3 — application-level vocabulary
; The namespace is now the language of the application.

method run [pet name] {
    LOAD Contact
    LOAD me
    LOAD myMother

    sessionToken = Contact.Connect(me, myMother)
    return(sessionToken)
}</pre>
<p>The pet-name compiler translates <code>Contact.Connect(me, myMother)</code> into five machine instructions:</p>
<ol>
<li>Load the <code>Contact</code> GT from the c-list into a capability register</li>
<li>Load the <code>me</code> GT into CR1</li>
<li>Load the <code>myMother</code> GT into CR2</li>
<li>Set DR0 to selector <strong>1</strong> (the Connect selector)</li>
<li>Emit a <strong>CALL</strong> to the Contact lump</li>
</ol>
<p>Everything else &mdash; identity resolution, medium selection, session negotiation &mdash; is inside the sealed lump.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">What the Developer Does Not Know</div>
<p>The developer does not know how location is resolved, which medium is selected, how the session is established, what network protocol is used, or which capability registers hold the Routing or Media GTs. <strong>None of that information is needed.</strong></p>
</div>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">The Full Transformation</div>
<table class="sr-table">
<tr><th></th><th>Stage 1</th><th>Stage 2</th><th>Stage 3</th></tr>
<tr><td>Naming unit</td><td>Register</td><td>Method</td><td>Concept</td></tr>
<tr><td>Mental model</td><td>Chip internals</td><td>Platform ops</td><td>App problem</td></tr>
<tr><td>Implicit knowledge</td><td>Everything</td><td>Platform conventions</td><td>Almost none</td></tr>
<tr><td>Security</td><td>None beyond HW</td><td>Seal per platform abstraction</td><td>Seal per domain abstraction</td></tr>
</table>
<div class="sr-comp-side-title" style="margin-top:0.75rem">Hardware-Enforced Meaning</div>
<p>In the implemented CLOOMC capability path, callers reach an abstraction
through capabilities exposed by its public API. This narrows the available
entry paths; it is not a formal proof that no bypass exists elsewhere in the
implementation.</p>
</div>
</div>
</div>`
            },
            {
                title: "Try It Yourself",
                type: "exercise",
                content: `<div class="sr-comp-layout">
<div class="sr-compiler-diagram" style="flex:2;min-width:0">
<p>Switch to the <strong>IDE</strong> view and click the <strong style="color:#4fc3f7">EN: Contact</strong> tab to load the full Contact abstraction in plain English. Then click <strong>Compile</strong> to see all methods assembled.</p>
<div class="sr-key-concept">
<div class="sr-concept-title">Exercises</div>
<ol>
<li><strong>Count the selectors:</strong> Compile the Contact abstraction and look at the dispatch table in the output. Verify that exactly three selectors appear: Connect (1), Disconnect (2), GetStatus (3).</li>
<li><strong>Find the private method:</strong> Locate <code>ResolveLocation</code> in the compiled output. It should appear in the binary but have no entry in the dispatch table &mdash; structurally unreachable from outside.</li>
<li><strong>Count the CALL instructions:</strong> How many CALL instructions does <code>Connect</code> emit? Each call to Identity.Lookup, Routing.SelectMedium, Media.Open, and Mint.Create is one CALL. Verify you get four.</li>
<li><strong>Trace the vocabulary growth:</strong> Find the single line that the Stage 3 run method uses. Compare it against the Stage 1 equivalent (six raw instructions with implicit register mappings).</li>
</ol>
</div>
<p style="margin-top:1rem"><strong>Key takeaway:</strong> The namespace is the language of the application. By sealing <code>Contact</code>, the developer adds a new word &mdash; <code>Connect</code> &mdash; whose meaning is hardware-enforced and permanent. Every subsequent use of that word carries the full, verified semantics of the abstraction, with no way to bypass or misuse them.</p>
</div>
<div class="sr-comp-side sr-comp-side-right">
<div class="sr-comp-side-panel open">
<div class="sr-comp-side-title">Contact&rsquo;s Public Interface</div>
<table class="sr-table">
<tr><th>Method</th><th>Arguments</th><th>Returns</th></tr>
<tr><td><strong>Connect</strong></td><td>callerToken, calleeToken</td><td>sessionToken</td></tr>
<tr><td><strong>Disconnect</strong></td><td>sessionToken</td><td>0</td></tr>
<tr><td><strong>GetStatus</strong></td><td>sessionToken</td><td>status</td></tr>
</table>
<div class="sr-comp-side-title" style="margin-top:0.75rem">What&rsquo;s Next</div>
<p>Read the <strong>Namespace</strong> tutorial to understand how the namespace grows and why sealing is cumulative: each new word inherits the hardware-verified meaning of every word it uses.</p>
<p>Read the <strong>Programmed Abstractions</strong> tutorial to see how the dispatch table is laid out in memory and how the capability gate is crossed on each CALL.</p>
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
        html += '<h2>English Contact Tutorial</h2>';
        html += '<p class="sr-tagline">Stage 3 Vocabulary &bull; Public / Private Methods &bull; Three-Selector Dispatch &bull; Hardware-Enforced Semantics</p>';
        html += '<div class="sr-controls">';
        html += `<button class="btn btn-tutorial" onclick="englishContactTutorial.stepBack()" ${this.currentStep <= 0 ? 'disabled' : ''}>&laquo; Back</button>`;
        html += `<span class="tutorial-progress">${Math.max(0, this.currentStep + 1)} / ${this.steps.length}</span>`;
        html += `<button class="btn btn-tutorial" onclick="englishContactTutorial.stepForward()">${this.currentStep >= this.steps.length - 1 ? 'Reset' : 'Next &raquo;'}</button>`;
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
            html += '<div class="sr-step-title">English Contact &mdash; Building Application-Level Vocabulary</div>';
            html += '<div class="sr-step-content">';
            html += '<p>This tutorial follows a PP250 telecommunications system from raw hardware registers to a single expressive line:</p>';
            html += '<pre class="sr-code sr-code-en">Contact.Connect(me, myMother)</pre>';
            html += '<p>Along the way you will learn:</p>';
            html += '<ul>';
            html += '<li><strong>Stage 1</strong> &mdash; the vocabulary of the chip (registers, raw ISA)</li>';
            html += '<li><strong>Stage 2</strong> &mdash; platform abstractions (Mint, WordString, Identity)</li>';
            html += '<li><strong>Public / private split</strong> &mdash; how the lump seal enforces vocabulary boundaries</li>';
            html += '<li><strong>Stage 3</strong> &mdash; the Contact abstraction and its three-selector dispatch table</li>';
            html += '<li><strong>The final line</strong> &mdash; five machine instructions that hide everything behind a hardware-enforced word</li>';
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
    module.exports = EnglishContactTutorial;
}
if (typeof window !== 'undefined') {
    window.EnglishContactTutorial = EnglishContactTutorial;
}
