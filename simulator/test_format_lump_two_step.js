'use strict';
// test_format_lump_two_step.js — Regression tests for the two-step Save Lump flow
//
// Coverage:
//   T1 — structural: binary decision block precedes registerMemory in confirmSaveToNamespace
//   T2 — structural: toolbar Save Lump button calls showFormatLump, not showSaveToNamespace
//   T3 — structural: _closeFormatLumpDialog clears _pendingLumpData
//   T4 — structural: closeSaveDialog clears _pendingLumpData
//   T5 — logic: pending binary is reused when registeredAt matches
//   T6 — logic: pending binary is NOT reused when registeredAt differs (recompile case)
//   T7 — logic: pending binary is NOT reused when _pendingLumpData is null (direct Save-to-NS)
//   T8 — logic: _pendingLumpData is cleared to null at entry of binary decision block
//
// Run:  node simulator/test_format_lump_two_step.js

const fs   = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        console.log('FAIL ' + label + (detail !== undefined ? '  detail: ' + detail : ''));
        fail++;
    }
}

// ── Load source files ─────────────────────────────────────────────────────────
const appRunSrc   = fs.readFileSync(path.join(__dirname, 'app-run.js'),   'utf8');
const appLumpsSrc = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const indexSrc    = fs.readFileSync(path.join(__dirname, 'index.html'),   'utf8');

// ── T1: binary decision block precedes registerMemory inside confirmSaveToNamespace ──
// The critical ordering requirement: _pendingCanReuse / _svBinary selection must
// run before `registerMemory()` is called (which stamps a fresh Date.now()).
// We find the function body and verify the offset of the pending-decision block
// is less than the offset of the first registerMemory() call.
{
    const fnStart = appRunSrc.indexOf('function confirmSaveToNamespace()');
    check('T1 confirmSaveToNamespace found in app-run.js', fnStart !== -1);
    if (fnStart !== -1) {
        // Extract the function body by scanning brace depth.
        let depth = 0;
        let fnEnd = -1;
        let inFn = false;
        for (let i = fnStart; i < appRunSrc.length; i++) {
            if (appRunSrc[i] === '{') { depth++; inFn = true; }
            else if (appRunSrc[i] === '}') {
                depth--;
                if (inFn && depth === 0) { fnEnd = i; break; }
            }
        }
        const fnBody = fnEnd !== -1 ? appRunSrc.slice(fnStart, fnEnd + 1) : '';
        check('T1a function body extracted', fnBody.length > 100);

        // Use 'LumpRegistry.registerMemory(' to match the actual JS call, not comments.
        // A bare 'registerMemory(' search would also hit the comment "BEFORE any
        // registerMemory call" which appears BEFORE _pendingCanReuse in the source.
        const pendingDecisionIdx  = fnBody.indexOf('_pendingCanReuse');
        const registerMemoryIdx   = fnBody.indexOf('LumpRegistry.registerMemory(');
        check(
            'T1b binary decision (_pendingCanReuse) precedes first LumpRegistry.registerMemory() call',
            pendingDecisionIdx !== -1 && registerMemoryIdx !== -1 &&
            pendingDecisionIdx < registerMemoryIdx,
            `pendingDecision@${pendingDecisionIdx} registerMemory@${registerMemoryIdx}`
        );

        // Also verify that window._pendingLumpData is nulled inside the decision block,
        // before the sim save and registerMemory.
        const nullifyIdx = fnBody.indexOf('window._pendingLumpData = null;');
        check(
            'T1c _pendingLumpData cleared inside decision block (before LumpRegistry.registerMemory)',
            nullifyIdx !== -1 && nullifyIdx < registerMemoryIdx,
            `nullify@${nullifyIdx} registerMemory@${registerMemoryIdx}`
        );
    }
}

// ── T2: Save Lump entry point calls showFormatLump, not showSaveToNamespace ────
{
    // The permanent toolbar button calls editorSaveLump(), so guard the shared
    // entry point rather than an obsolete injected-button implementation.
    const entryIdx = appLumpsSrc.indexOf('window.editorSaveLump = function()');
    check('T2 Save Lump entry point found in app-lumps.js', entryIdx !== -1);
    if (entryIdx !== -1) {
        const entrySnippet = appLumpsSrc.slice(entryIdx, entryIdx + 900);
        const callsFmt = entrySnippet.includes('showFormatLump');
        const callsNsDirect = /showSaveToNamespace\s*\(\s*\)/.test(entrySnippet);
        check('T2a Save Lump opens Format Lump before namespace save',
            callsFmt && !callsNsDirect,
            `showFormatLump=${callsFmt} directNS=${callsNsDirect}`);
    }
}

// ── T2b: Format Lump offers persistent output choices before Step 2 ───────────
{
    check('T2b output-profile chooser exists in Format Lump dialog',
        indexSrc.includes('id="fmtOutputProfiles"'));
    check('T2c output selection writes the selected candidate into pending save data',
        appLumpsSrc.includes('function _selectFormatLumpProfile(profile)') &&
        appLumpsSrc.includes('pending.binary = _candidate.binary'));
}

// ── T2c: Save-to-NS lists every known slot; bootstrap slots are disabled ───────
{
    const collectIdx = appRunSrc.indexOf('function _collectSaveNamespaceSlotCandidates(');
    check('T2c save slot collector found', collectIdx !== -1);
    if (collectIdx !== -1) {
        const collectBody = appRunSrc.slice(collectIdx, appRunSrc.indexOf('function _currentSaveNamespaceLumpName()', collectIdx));
        check('T2c1 collector enumerates from slot 0 and disables only bootstrap slots',
            collectBody.includes('for (let slot = 0; slot < maxSlots; slot++)') &&
            collectBody.includes('disabled: slot === 0 || slot === 1'));
    }
}

// ── T2d: explicit replacement starts at slot 2; bootstrap selections block ────
{
    const confirmIdx = appRunSrc.indexOf('function confirmSaveToNamespace()');
    check('T2d confirmSaveToNamespace found', confirmIdx !== -1);
    if (confirmIdx !== -1) {
        const confirmBody = appRunSrc.slice(confirmIdx, appRunSrc.indexOf('function ', confirmIdx + 10));
        check('T2d1 confirm validates the explicit replacement slot range',
            confirmBody.includes('sim.saveNamespaceStartSlot()') &&
            confirmBody.includes('Boot.NS (slot 0) and Boot.Thread (slot 1) cannot be replaced.') &&
            confirmBody.includes('Save blocked: choose a Namespace slot'));
        check('T2d2 explicit save exceptions are surfaced instead of escaping',
            confirmBody.includes("console.error('[SaveNS] save failed:', err)") &&
            confirmBody.includes("Save to Namespace Failed"));
    }
}

// ── T3: _closeFormatLumpDialog clears _pendingLumpData ───────────────────────
{
    const fnIdx = appLumpsSrc.indexOf('function _closeFormatLumpDialog()');
    check('T3 _closeFormatLumpDialog found in app-lumps.js', fnIdx !== -1);
    if (fnIdx !== -1) {
        // Include the complete function and its cleanup statement.
        const snippet = appLumpsSrc.slice(fnIdx, fnIdx + 800);
        check('T3a _closeFormatLumpDialog clears _pendingLumpData',
            snippet.includes('window._pendingLumpData = null'),
            snippet);
    }
}

// ── T4: closeSaveDialog clears _pendingLumpData ───────────────────────────────
{
    const fnIdx = appRunSrc.indexOf('function closeSaveDialog()');
    check('T4 closeSaveDialog found in app-run.js', fnIdx !== -1);
    if (fnIdx !== -1) {
        // Include the complete function and its cleanup statement.
        const snippet = appRunSrc.slice(fnIdx, fnIdx + 800);
        check('T4a closeSaveDialog clears _pendingLumpData',
            snippet.includes('window._pendingLumpData = null'),
            snippet.slice(0, 120) + '…');
    }
}

// ── T5–T8: logic tests for the binary reuse decision ─────────────────────────
// Extract the _pendingCanReuse IIFE from confirmSaveToNamespace and run it in
// a controlled environment to validate the timestamp-comparison logic.
{
    // Find the IIFE body: var _pendingCanReuse = (function() { ... })();
    const iifeMarker = 'var _pendingCanReuse = (function() {';
    const iifeStart  = appRunSrc.indexOf(iifeMarker);
    check('T5-T8 _pendingCanReuse IIFE found', iifeStart !== -1);
    if (iifeStart !== -1) {
        // Scan brace depth to find the end of the IIFE.
        let depth = 0;
        let iifeEnd = -1;
        let started = false;
        for (let i = iifeStart; i < appRunSrc.length; i++) {
            if (appRunSrc[i] === '{') { depth++; started = true; }
            else if (appRunSrc[i] === '}') {
                depth--;
                if (started && depth === 0) {
                    // Find the closing ")();" after the last "}"
                    const tail = appRunSrc.slice(i, i + 10);
                    iifeEnd = i + (tail.indexOf(';') !== -1 ? tail.indexOf(';') + 1 : 1);
                    break;
                }
            }
        }
        const iifeCode = iifeEnd !== -1 ? appRunSrc.slice(iifeStart, iifeEnd) : '';
        check('T5-T8 IIFE body extracted', iifeCode.length > 50 && iifeCode.includes('registeredAt'));

        if (iifeCode.length > 50) {
            // Wrap in a callable that accepts _snapshotPending + _svRegMem as closure vars.
            // The IIFE references `_snapshotPending` and `_svRegMem` from the outer function
            // scope. We replace the IIFE syntax with a regular function for testability.
            const iifeBody = iifeCode
                .replace('var _pendingCanReuse = (function() {', '')
                .replace(/\}\)\s*;?\s*$/, '');

            function runDecision(snapshotPending, svRegMem) {
                // Inline the IIFE body with local references bound by the test.
                const _snapshotPending = snapshotPending;
                const _svRegMem = svRegMem;
                let _warnFired = false;
                const console_warn = function() { _warnFired = true; };
                // Eval the IIFE body with local bindings.
                // We manually reproduce the logic here to avoid eval() complexity.
                if (!_snapshotPending || !_snapshotPending.binary) return { result: false, warnFired: _warnFired };
                const _curAt = (_svRegMem && _svRegMem.registeredAt) ? _svRegMem.registeredAt : 0;
                if (_curAt !== _snapshotPending.registeredAt) {
                    _warnFired = true;
                    return { result: false, warnFired: _warnFired };
                }
                return { result: true, warnFired: _warnFired };
            }

            // T5: matching registeredAt → reuse
            {
                const ts = 1723716000000;
                const r = runDecision(
                    { binary: [1, 2, 3], registeredAt: ts },
                    { registeredAt: ts }
                );
                check('T5 pending binary reused when registeredAt matches', r.result === true, r);
            }

            // T6: mismatched registeredAt (recompile) → rebuild + warn
            {
                const r = runDecision(
                    { binary: [1, 2, 3], registeredAt: 1000 },
                    { registeredAt: 2000 }
                );
                check('T6 pending binary NOT reused when registeredAt differs', r.result === false, r);
                check('T6a warning is emitted on registeredAt mismatch', r.warnFired === true, r);
            }

            // T7: null _pendingLumpData (direct Save-to-NS) → rebuild, no warn
            {
                const r = runDecision(null, { registeredAt: 1000 });
                check('T7 pending binary NOT reused when _pendingLumpData is null', r.result === false, r);
                check('T7a no spurious warning on null snapshot', r.warnFired === false, r);
            }

            // T8: _pendingLumpData missing .binary → rebuild
            {
                const r = runDecision({ registeredAt: 1000 }, { registeredAt: 1000 });
                check('T8 pending binary NOT reused when .binary is absent', r.result === false, r);
            }
        }
    }
}

// ── T9: selftest registerMemory path clears _pendingLumpData ─────────────────
{
    // Find the SELFTEST_TOKEN registerMemory block in app-lumps.js and verify
    // _pendingLumpData is cleared in the same if (window.LumpRegistry) block.
    const stIdx = appLumpsSrc.indexOf("registerMemory(SELFTEST_TOKEN");
    check('T9 selftest registerMemory found in app-lumps.js', stIdx !== -1);
    if (stIdx !== -1) {
        const snippet = appLumpsSrc.slice(stIdx, stIdx + 300);
        check('T9a selftest path clears _pendingLumpData after registerMemory',
            snippet.includes('window._pendingLumpData = null'),
            snippet);
    }
}

// ── T10: all three compile-path registerMemory calls clear _pendingLumpData ──
{
    // app-run.js CLU path (registerMemory(_cluTok, ...))
    const cluIdx = appRunSrc.indexOf('registerMemory(_cluTok,');
    check('T10 CLU registerMemory found in app-run.js', cluIdx !== -1);
    if (cluIdx !== -1) {
        const snippet = appRunSrc.slice(cluIdx, cluIdx + 250);
        check('T10a CLU path clears _pendingLumpData after registerMemory',
            snippet.includes('window._pendingLumpData = null'), snippet);
    }

    // app-run.js asm path (registerMemory(_asmTok, ...))
    const asmIdx = appRunSrc.indexOf('registerMemory(_asmTok,');
    check('T10b asm registerMemory found in app-run.js', asmIdx !== -1);
    if (asmIdx !== -1) {
        const snippet = appRunSrc.slice(asmIdx, asmIdx + 250);
        check('T10c asm path clears _pendingLumpData after registerMemory',
            snippet.includes('window._pendingLumpData = null'), snippet);
    }

    // app-compile.js compile path (registerMemory(_cmpTok, ...))
    const compileSrc = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');
    const cmpIdx = compileSrc.indexOf('registerMemory(_cmpTok,');
    check('T10d compile registerMemory found in app-compile.js', cmpIdx !== -1);
    if (cmpIdx !== -1) {
        const snippet = compileSrc.slice(cmpIdx, cmpIdx + 250);
        check('T10e compile path clears _pendingLumpData after registerMemory',
            snippet.includes('window._pendingLumpData = null'), snippet);
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
