'use strict';
// test_clist_petname_highlight.js — regression tests: clist pet-name spans
// must survive _highlightCLOOMCSource / _hlCloomcLine processing.
//
// Background: _annotateRawClistSlot injects <span class="clist-petname-ref" …>
// into raw disassembly text BEFORE _highlightCLOOMCSource is called.
// If _hlCloomcLine escapes the '<' to '&lt;' the span renders as visible text
// instead of as HTML, and syntax colours are also broken.
//
// Run with: node simulator/test_clist_petname_highlight.js

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log('PASS ' + label);
        passed++;
    } else {
        console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
        failed++;
    }
}

// ── Extract the needed sections from the source files ─────────────────────
// Only pure-string-processing code is extracted; no browser DOM is referenced.

const lumpsPath = path.join(__dirname, 'app-lumps.js');
const crDetPath = path.join(__dirname, 'app-cr-detail.js');

const lumpsSrc = fs.readFileSync(lumpsPath, 'utf8');
const crDetSrc = fs.readFileSync(crDetPath, 'utf8');

function extractBetween(src, startRe, endRe) {
    const startIdx = src.search(startRe);
    if (startIdx === -1) throw new Error('start marker not found: ' + startRe);
    const endIdx = src.search(endRe);
    if (endIdx === -1) throw new Error('end marker not found: ' + endRe);
    if (endIdx <= startIdx) throw new Error('end marker before start: ' + endRe);
    return src.slice(startIdx, endIdx);
}

// From app-lumps.js: keyword/mnemonic sets, _hlEsc, _hlCloomcWordClass,
// _hlCloomcLine (with span passthrough fix), _highlightCLOOMCSource.
const hlSection = extractBetween(
    lumpsSrc,
    /\bconst _CLOOMC_HL_KEYWORDS\b/,
    /\nfunction _isRawISASource\b/
);

// From app-cr-detail.js: _transformTextNodes, _wrapCRHover, _wrapDRHover,
// _wrapRegHover, _wrapCListHover, _annotateRawClistSlot.
const crSection = extractBetween(
    crDetSrc,
    /\nfunction _transformTextNodes\b/,
    /\nfunction _crTag\b/
);

// ── Build a minimal vm context ────────────────────────────────────────────
// Stubs for the few external references inside the extracted sections.

const ctx = vm.createContext({
    // _annotateNsRefInCode adds NS-slot hover tooltips; a no-op is fine here.
    _annotateNsRefInCode: function(html) { return html; },
    // _resolveClistPetName reads sim memory at runtime.
    // Stub: return 'MyList' for slot 0x0001, null for everything else.
    _resolveClistPetName: function(clistBase, slotIdx) {
        if (slotIdx === 0x0001) return 'MyList';
        return null;
    },
    // sim is accessed only by the real _resolveClistPetName, not the stub.
    sim: null,
    console: console,
});

vm.runInContext(hlSection, ctx);
vm.runInContext(crSection, ctx);

const _annotateRawClistSlot  = ctx._annotateRawClistSlot;
const _highlightCLOOMCSource = ctx._highlightCLOOMCSource;
const _wrapRegHover          = ctx._wrapRegHover;

assert('functions loaded: _annotateRawClistSlot',
    typeof _annotateRawClistSlot === 'function');
assert('functions loaded: _highlightCLOOMCSource',
    typeof _highlightCLOOMCSource === 'function');
assert('functions loaded: _wrapRegHover',
    typeof _wrapRegHover === 'function');

// ── HL-1: _annotateRawClistSlot produces a literal <span> for a known slot ─
{
    const annotated = _annotateRawClistSlot('mLoad CR6[0x0001]', 0, 0);
    assert('HL-1: _annotateRawClistSlot emits <span class="clist-petname-ref"',
        annotated.includes('<span class="clist-petname-ref"'),
        'got: ' + annotated);
    assert('HL-1: annotated text contains the pet name (MyList)',
        annotated.includes('MyList'),
        'got: ' + annotated);
    assert('HL-1: annotated text is not HTML-escaped (&lt; absent)',
        !annotated.includes('&lt;'),
        'got: ' + annotated);
}

// ── HL-2: unknown slot leaves text unchanged ───────────────────────────────
{
    const plain = _annotateRawClistSlot('mLoad CR6[0x0002]', 0, 0);
    assert('HL-2: unknown slot leaves text as plain CR6[0x0002]',
        plain === 'mLoad CR6[0x0002]',
        'got: ' + plain);
}

// ── HL-3 through HL-7: full pipeline ─────────────────────────────────────
{
    const raw      = 'mLoad CR6[0x0001]';
    const annotated = _annotateRawClistSlot(raw, 0, 0);
    const highlighted = _highlightCLOOMCSource(annotated, 'assembly');

    // HL-3: pet-name span survives highlighting as real HTML (not escaped)
    assert('HL-3: <span class="clist-petname-ref" survives _highlightCLOOMCSource (not &lt;span)',
        highlighted.includes('<span class="clist-petname-ref"'),
        'got: ' + highlighted);

    // HL-4: CR6 syntax colour (lump-hl-register) is also present
    assert('HL-4: lump-hl-register class present in highlighted output',
        highlighted.includes('lump-hl-register'),
        'got: ' + highlighted);

    // HL-5: mLoad syntax colour (lump-hl-mnemonic) is also present
    assert('HL-5: lump-hl-mnemonic class present in highlighted output',
        highlighted.includes('lump-hl-mnemonic'),
        'got: ' + highlighted);

    // HL-6: after _wrapRegHover, CR6 is wrapped with cr-hover-target inside
    //       the lump-hl-register span (not outside it)
    const wrapped = _wrapRegHover(highlighted);

    assert('HL-6: cr-hover-target present after _wrapRegHover',
        wrapped.includes('cr-hover-target'),
        'got: ' + wrapped);

    // The lump-hl-register span must contain the cr-hover-target span.
    // Pattern: <span class="lump-hl-register"><span class="cr-hover-target"…>CR6</span></span>
    assert('HL-6: cr-hover-target is nested inside lump-hl-register',
        /lump-hl-register[^<]*>[\s\S]*?cr-hover-target/.test(wrapped),
        'got: ' + wrapped);

    // HL-7: clist-petname-ref span survives _wrapRegHover as real HTML
    assert('HL-7: clist-petname-ref span survives _wrapRegHover',
        wrapped.includes('<span class="clist-petname-ref"'),
        'got: ' + wrapped);

    assert('HL-7: no &lt;span (no escaped tags) in final output',
        !wrapped.includes('&lt;span'),
        'got: ' + wrapped);
}

// ── HL-8: plain text without pre-existing spans still escapes bare '<' ────
// Regression guard: the span passthrough must not let arbitrary '<' through.
{
    const plain = _highlightCLOOMCSource('mLoad CR6[0x0001] ; comment <bad>', 'assembly');
    assert('HL-8: bare < in comment is still escaped to &lt;',
        plain.includes('&lt;bad&gt;'),
        'got: ' + plain);
}

// ── HL-9: mSave variant also works (covers the mSave CR6[0x…] path) ───────
{
    const raw2       = 'mSave CR6[0x0001]';
    const annotated2 = _annotateRawClistSlot(raw2, 0, 0);
    const hl2        = _highlightCLOOMCSource(annotated2, 'assembly');
    assert('HL-9: mSave CR6[0x0001] — clist-petname-ref survives highlighting',
        hl2.includes('<span class="clist-petname-ref"'),
        'got: ' + hl2);
    assert('HL-9: mSave CR6[0x0001] — mSave gets lump-hl-mnemonic',
        hl2.includes('lump-hl-mnemonic'),
        'got: ' + hl2);
}

// ── HL-10: multiple spans across lines ───────────────────────────────────
// Two instructions on separate lines, each referencing CR6[0x0001].
// Both spans must survive _highlightCLOOMCSource since neither is in a comment.
// (Spans inside a '; …' comment are intentionally escaped by the comment
// handler, so we use two non-comment instruction lines here.)
{
    const rawMulti = 'mLoad CR6[0x0001]\nmSave CR6[0x0001]';
    const annotatedMulti = _annotateRawClistSlot(rawMulti, 0, 0);
    const spanCount = (annotatedMulti.match(/<span class="clist-petname-ref"/g) || []).length;
    assert('HL-10: two CR6[0x0001] references produce two clist-petname-ref spans',
        spanCount === 2,
        'got spanCount=' + spanCount + ' in: ' + annotatedMulti);
    const hlMulti = _highlightCLOOMCSource(annotatedMulti, 'assembly');
    const survivedCount = (hlMulti.match(/<span class="clist-petname-ref"/g) || []).length;
    assert('HL-10: both clist-petname-ref spans survive _highlightCLOOMCSource',
        survivedCount === 2,
        'got survivedCount=' + survivedCount + ' in: ' + hlMulti);
}

// ── HL-11: security — arbitrary user-authored <span> is still escaped ────
// The passthrough is a whitelist for 'clist-petname-ref' only.  A raw
// '<span onclick=…>' in source text must NOT survive highlighting and must
// NOT be injectable into innerHTML via this path.
{
    const xss1 = _highlightCLOOMCSource('<span onclick="alert(1)">evil</span>', 'assembly');
    assert('HL-11: <span onclick=…> is escaped — &lt;span present',
        xss1.includes('&lt;span'),
        'got: ' + xss1);
    assert('HL-11: <span onclick=…> is escaped — no literal <span in output',
        !xss1.includes('<span onclick'),
        'got: ' + xss1);

    // A span with a different class name is also escaped.
    const xss2 = _highlightCLOOMCSource('<span class="injected">x</span>', 'assembly');
    assert('HL-11: <span class="injected"> is escaped — &lt;span present',
        xss2.includes('&lt;span'),
        'got: ' + xss2);

    // Verify the known-safe class still passes through (sanity guard).
    const safe = 'CR6<span class="clist-petname-ref" onmouseenter="showPetNameTip(event,\'X\')" onmouseleave="hidePetNameTip()">[0x0001]</span>';
    const safeOut = _highlightCLOOMCSource(safe, 'assembly');
    assert('HL-11: clist-petname-ref class still passes through (whitelist sanity)',
        safeOut.includes('<span class="clist-petname-ref"'),
        'got: ' + safeOut);
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
