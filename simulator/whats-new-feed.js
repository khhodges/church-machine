// Generated from CHANGELOG.md by scripts/sync-whats-new.js. Do not edit directly.
// Run: node scripts/sync-whats-new.js --write
window.CHURCH_WHATS_NEW_RELEASE = Object.freeze({
    version: "2026-07-10",
    features: Object.freeze([
    {
        "title": "Fix: `Salvation` dot-name CALL/ELOADCALL failed with \"No method conventions registered\"",
        "html": "<div style=\"font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;\">Fix: <code>Salvation</code> dot-name CALL/ELOADCALL failed with &quot;No method conventions registered&quot;</div><p style=\"font-size:0.9rem;line-height:1.65;margin:0;\"><code>simulator/examples/capability_test.cloomc</code> TEST 7/8 (<code>CALL Salvation.main</code> and <code>ELOADCALL CR0, Salvation, main</code>) failed to compile because <code>Salvation</code> had no entry in <code>simulator/app-absdetail.js</code>&#39;s <code>_ABSTRACTION_CONVENTIONS</code> table — the runtime method-name registry the assembler consults for dot-name <code>CALL</code> / <code>ELOADCALL</code> resolution. Every other boot abstraction (<code>Scheduler</code>, <code>LED</code>, <code>Memory</code>, <code>Mint</code>, <code>Tunnel</code>, etc.) had a registered entry; <code>Salvation</code> did not, so both instructions hit the &quot;No method conventions registered&quot; guard even though the abstraction, its NS binding, and its compiled method table (<code>simulator/abstractions.js</code>) were all otherwise correct.</p>"
    },
    {
        "title": "Fix: NS slot 6 boot lump named \"Boot.Abstr\" server-side but \"SelfTest\" client-side",
        "html": "<div style=\"font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;\">Fix: NS slot 6 boot lump named &quot;Boot.Abstr&quot; server-side but &quot;SelfTest&quot; client-side</div><p style=\"font-size:0.9rem;line-height:1.65;margin:0;\">Discovered while inspecting Boot: the Lump Repository / detail view showed a different name for the NS slot 6 boot lump than the CR14/NS6 live-lump popup, even though both are looking at the exact same lump (token <code>00000600</code>).</p>"
    },
    {
        "title": "Fix: POLA cleanup falling through to the wrong C-List view when it empties the block",
        "html": "<div style=\"font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;\">Fix: POLA cleanup falling through to the wrong C-List view when it empties the block</div><p style=\"font-size:0.9rem;line-height:1.65;margin:0;\">Bug reported right after the POLA button shipped: clicking &quot;⚖ POLA&quot; in the C-List popup appeared to *add* Golden Tokens (Boot.NS, Boot.Thread, UART_DEV, LED_DEV, BTN_DEV, TIMER_DEV, SelfTest) instead of removing unused ones.</p>"
    },
    {
        "title": "Feature: POLA cleanup button in the C-List viewer",
        "html": "<div style=\"font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;\">Feature: POLA cleanup button in the C-List viewer</div><p style=\"font-size:0.9rem;line-height:1.65;margin:0;\">Added a &quot;⚖ POLA&quot; (Principle of Least Authority) button to the C-List viewer popup header in the Code Editor, alongside the existing &quot;+ Add&quot; button. Clicking it strips capabilities-block entries whose declared name is never referenced anywhere else in the editor source — the same idea as an unused- import cleanup, applied to Golden Token capabilities.</p>"
    },
    {
        "title": "Fix: stale BFEXT/BFINS `pos=N, w=N` syntax re-surfacing via main editor's own localStorage snapshot",
        "html": "<div style=\"font-weight:700;color:var(--church-gold);font-size:1.05rem;margin-bottom:0.75rem;\">Fix: stale BFEXT/BFINS <code>pos=N, w=N</code> syntax re-surfacing via main editor&#39;s own localStorage snapshot</div><p style=\"font-size:0.9rem;line-height:1.65;margin:0;\">The earlier BFEXT/BFINS operand-syntax migration (<code>_migrateBfextBfinsSyntax</code> in <code>simulator/app-lumps.js</code>) only covered the lump-editor draft (<code>cm_lump_draft_*</code>) and custom user-tab (<code>church_user_tabs</code>) persistence paths. It missed a third, independent persistence path: the main code editor&#39;s own generic session snapshot, <code>church_editor_code</code>, saved by <code>saveEditorState()</code> and restored by <code>loadEditorState()</code> in <code>simulator/app-run.js</code> on every page load — regardless of which tab (built-in example or custom) is active. Any browser holding a stale snapshot written back when the disassembler still emitted the old, never-valid <code>pos=&lt;N&gt;, w=&lt;N&gt;</code> syntax kept restoring that broken text on every reload, indistinguishable from the original &quot;COMPILE FAILED&quot; bug reappearing, even though the disassembler and the other two migration call sites had already been fixed.</p>"
    }
])
});
