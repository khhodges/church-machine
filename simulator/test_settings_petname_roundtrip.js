'use strict';
// test_settings_petname_roundtrip.js — Round-trip tests for the
// IDE Settings → petname → Build LUMP identity line (Task #2581)
//
// Run:  node simulator/test_settings_petname_roundtrip.js
//
// Coverage:
//   SP-1  saveSettings path: non-empty petname → localStorage.setItem('church_petname', trimmedValue)
//   SP-2  saveSettings path: blank petname → localStorage.removeItem('church_petname')
//   SP-3  saveSettings path: whitespace-only petname trims to blank → key is removed
//   SP-4  saveSettings path: issue number is saved as a string integer
//   SP-5  compileAndBuild identity: petname in localStorage → listing contains 'Identity:  petname.AbstrName#1'
//   SP-6  compileAndBuild identity: no petname key → listing contains '⚠ No petname' warning
//   SP-7  compileAndBuild identity: custom issue number → listing reflects correct #n
//   SP-8  Full round-trip: set petname via settings save path → identity line is correct
//   SP-9  Full round-trip: clear petname via settings save path → warning line appears
//   SP-10 saveSettings path: petname key name is exactly 'church_petname' (no drift)
//   SP-11 compileAndBuild: payload metadata.petname equals the stored petname
//   SP-12 compileAndBuild: payload metadata.issue_number equals the stored issue number

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`);
        fail++;
    }
}

// ── Source extraction helpers ─────────────────────────────────────────────────

const APP_RUN_SRC    = fs.readFileSync(path.join(__dirname, 'app-run.js'),    'utf8');
const APP_COMPILE_SRC = fs.readFileSync(path.join(__dirname, 'app-compile.js'), 'utf8');

/**
 * Extract the petname+issueNumber save block from saveSettings() in app-run.js.
 * This is the exact production code that runs when the user clicks Save in Settings.
 */
function extractSaveSettingsPetnameBlock() {
    const startMarker = '// Save petname + issue number independently in their own localStorage keys';
    const endMarker   = '    if (_inEl !== null) {\n        const _inVal = parseInt(_inEl.value) || 1;\n        localStorage.setItem(\'church_issue_number\', String(_inVal));\n    }';

    const start = APP_RUN_SRC.indexOf(startMarker);
    if (start === -1) throw new Error('saveSettings petname start marker not found in app-run.js');
    const end = APP_RUN_SRC.indexOf(endMarker, start);
    if (end === -1) throw new Error('saveSettings petname end marker not found in app-run.js');

    return APP_RUN_SRC.slice(start, end + endMarker.length);
}

/**
 * Extract the identity-line generation block from compileAndBuild() in app-compile.js.
 * We pull exactly two pieces and stitch them together so the vm context only needs
 * `localStorage`, `listing`, and `absName` — none of the surrounding binary/payload vars.
 *
 * Piece 1: the two localStorage reads (_savePetname, _saveIssueNumber).
 * Piece 2: the identity if/else that appends to `listing`.
 */
function extractIdentityLineBlock() {
    // Piece 1: the two const reads
    const readStart = '    const _savePetname     = (() => {';
    const readEnd   = '    const _saveIssueNumber = (() => { try { return parseInt(localStorage.getItem(\'church_issue_number\') || \'1\') || 1; } catch (_e) { return 1; } })();';

    const rs = APP_COMPILE_SRC.indexOf(readStart);
    if (rs === -1) throw new Error('_savePetname read marker not found in app-compile.js');
    const re = APP_COMPILE_SRC.indexOf(readEnd, rs);
    if (re === -1) throw new Error('_saveIssueNumber read marker not found in app-compile.js');
    const piece1 = APP_COMPILE_SRC.slice(rs, re + readEnd.length);

    // Piece 2: the identity if/else (starts with the comment just before it)
    const ifStart  = '    // Identity line: show the full dot pet name stamped into this LUMP.';
    const ifEndStr = 'No petname \u2014 open IDE Settings to set one\\n`;\n    }';
    const is = APP_COMPILE_SRC.indexOf(ifStart);
    if (is === -1) throw new Error('Identity if/else start marker not found in app-compile.js');
    const ie = APP_COMPILE_SRC.indexOf(ifEndStr, is);
    if (ie === -1) throw new Error('Identity if/else end marker not found in app-compile.js');
    const piece2 = APP_COMPILE_SRC.slice(is, ie + ifEndStr.length);

    return piece1 + '\n' + piece2;
}

// Pre-extract blocks once; throw immediately if markers are missing.
const SAVE_SETTINGS_PETNAME_BLOCK = extractSaveSettingsPetnameBlock();
const IDENTITY_LINE_BLOCK          = extractIdentityLineBlock();

// ── Mock factories ────────────────────────────────────────────────────────────

/** Create a fresh in-memory localStorage mock. */
function makeLocalStorage(initial) {
    const store = Object.assign({}, initial || {});
    return {
        getItem:    (k)    => (k in store ? store[k] : null),
        setItem:    (k, v) => { store[k] = String(v); },
        removeItem: (k)    => { delete store[k]; },
        _store:     store,
    };
}

/**
 * Create a mock document.getElementById that returns a fake input element
 * with a given value for 'settingPetname' and 'settingIssueNumber'.
 */
function makeDocument(petnameValue, issueValue) {
    function el(value) { return { value: (value == null ? '' : String(value)) }; }
    return {
        getElementById: (id) => {
            if (id === 'settingPetname')    return el(petnameValue);
            if (id === 'settingIssueNumber') return el(issueValue == null ? '1' : issueValue);
            return null;
        }
    };
}

/**
 * Run the saveSettings petname block in a vm context.
 * Returns the localStorage mock so callers can inspect the stored value.
 */
function runSaveSettingsPetname(petnameInputValue, issueInputValue) {
    const ls  = makeLocalStorage();
    const doc = makeDocument(petnameInputValue, issueInputValue);
    const ctx = vm.createContext({ localStorage: ls, document: doc });
    vm.runInContext(SAVE_SETTINGS_PETNAME_BLOCK, ctx);
    return ls._store;
}

/**
 * Run the identity-line block in a vm context with a pre-populated localStorage.
 * Returns the listing string produced so far (only the identity portion).
 */
function runIdentityBlock(storedPetname, storedIssueNumber, absName) {
    const ls = makeLocalStorage({});
    if (storedPetname)    ls.setItem('church_petname',    storedPetname);
    if (storedIssueNumber) ls.setItem('church_issue_number', String(storedIssueNumber));

    // The block uses `listing`, `absName`, `_savePetname`, `_saveIssueNumber`
    // We inject the pieces the block expects.
    const ctx = vm.createContext({
        localStorage: ls,
        listing: '',
        absName: absName || 'TestAbstraction',
    });

    // The block writes into `listing` but actually builds it from scratch on each
    // line via +=. We only care about the identity line, so we capture listing after.
    vm.runInContext(IDENTITY_LINE_BLOCK, ctx);
    return ctx.listing;
}

// ── SP-1 through SP-4: saveSettings petname block ────────────────────────────
console.log('\n--- SP-1 through SP-4: saveSettings petname path ---');

{
    const store = runSaveSettingsPetname('testpetname', '1');
    check('SP-1: non-empty petname → localStorage["church_petname"] is set',
        store['church_petname'] === 'testpetname',
        `got: ${JSON.stringify(store['church_petname'])}`);
}

{
    const store = runSaveSettingsPetname('', '1');
    check('SP-2: blank petname value → key is absent from localStorage',
        !('church_petname' in store),
        `store keys: ${JSON.stringify(Object.keys(store))}`);
}

{
    const store = runSaveSettingsPetname('   ', '1');
    check('SP-3: whitespace-only petname trims to blank → key is removed',
        !('church_petname' in store),
        `store: ${JSON.stringify(store)}`);
}

{
    const store = runSaveSettingsPetname('testpetname', '5');
    check('SP-4: issue number is saved as string integer',
        store['church_issue_number'] === '5',
        `got: ${JSON.stringify(store['church_issue_number'])}`);
}

// ── SP-5 through SP-7: compileAndBuild identity line block ───────────────────
console.log('\n--- SP-5 through SP-7: compileAndBuild identity line ---');

{
    const listing = runIdentityBlock('testpetname', '1', 'MyAbstraction');
    const expected = '  Identity:  testpetname.MyAbstraction#1\n';
    check('SP-5: petname in localStorage → listing contains correct Identity line',
        listing.includes(expected),
        `listing: ${JSON.stringify(listing)}`);
}

{
    const listing = runIdentityBlock(null, null, 'MyAbstraction');
    check('SP-6: no petname → listing contains ⚠ No petname warning',
        listing.includes('\u26a0 No petname \u2014 open IDE Settings to set one'),
        `listing: ${JSON.stringify(listing)}`);
}

{
    const listing = runIdentityBlock('dev.org', '3', 'Counter');
    const expected = '  Identity:  dev.org.Counter#3\n';
    check('SP-7: custom issue number → identity line uses correct #n',
        listing.includes(expected),
        `listing: ${JSON.stringify(listing)}`);
}

// ── SP-8 through SP-9: full round-trips ──────────────────────────────────────
console.log('\n--- SP-8 through SP-9: full round-trips ---');

{
    // Simulate: user types "testpetname" in the settings input → Save → Build LUMP
    const store = runSaveSettingsPetname('testpetname', '1');
    // Now simulate: compileAndBuild reads from the same localStorage state
    const ls2 = makeLocalStorage(store);
    const ctx2 = vm.createContext({ localStorage: ls2, listing: '', absName: 'CapCounter' });
    vm.runInContext(IDENTITY_LINE_BLOCK, ctx2);
    const listing = ctx2.listing;
    const expected = '  Identity:  testpetname.CapCounter#1\n';
    check('SP-8: round-trip set petname → build → correct Identity line',
        listing.includes(expected),
        `listing: ${JSON.stringify(listing)}`);
}

{
    // Simulate: petname previously set, user clears it → Save → Build LUMP
    // First, pre-populate localStorage as if a prior save had set the key
    const priorStore = { church_petname: 'oldname', church_issue_number: '1' };
    // Simulate saveSettings with blank petname (user cleared the field)
    const ls1 = makeLocalStorage(priorStore);
    const doc = makeDocument('', '1');   // blank input value
    const ctx1 = vm.createContext({ localStorage: ls1, document: doc });
    vm.runInContext(SAVE_SETTINGS_PETNAME_BLOCK, ctx1);
    // Now simulate build
    const ls2 = makeLocalStorage(ls1._store);
    const ctx2 = vm.createContext({ localStorage: ls2, listing: '', absName: 'CapCounter' });
    vm.runInContext(IDENTITY_LINE_BLOCK, ctx2);
    const listing = ctx2.listing;
    check('SP-9: round-trip clear petname → build → ⚠ No petname warning',
        listing.includes('\u26a0 No petname \u2014 open IDE Settings to set one'),
        `listing: ${JSON.stringify(listing)}`);
    // Also confirm old key is gone
    check('SP-9b: prior church_petname key removed after clearing the field',
        !('church_petname' in ls1._store),
        `store: ${JSON.stringify(ls1._store)}`);
}

// ── SP-10: key name stability ─────────────────────────────────────────────────
console.log('\n--- SP-10: key name stability ---');

{
    // The save path and the compile path must agree on the exact key name.
    // Grep for the key name in both source files to verify they match.
    const saveKeyMatches    = (APP_RUN_SRC.match(/['"]church_petname['"]/g) || []);
    const compileKeyMatches = (APP_COMPILE_SRC.match(/['"]church_petname['"]/g) || []);
    check('SP-10: key "church_petname" appears in both app-run.js and app-compile.js',
        saveKeyMatches.length > 0 && compileKeyMatches.length > 0,
        `app-run: ${saveKeyMatches.length} hits, app-compile: ${compileKeyMatches.length} hits`);
}

// ── SP-11 through SP-12: payload metadata stamping ───────────────────────────
console.log('\n--- SP-11 through SP-12: payload metadata stamping ---');

{
    // Verify the save payload includes petname and issue_number at metadata level.
    // We check that the savePayload construction in compileAndBuild references
    // _savePetname and _saveIssueNumber (static source analysis).
    const payloadPetnameRef   = APP_COMPILE_SRC.includes('petname:        _savePetname,');
    const payloadIssueRef     = APP_COMPILE_SRC.includes('issue_number:   _saveIssueNumber,');
    check('SP-11: compileAndBuild payload metadata includes petname field from _savePetname',
        payloadPetnameRef);
    check('SP-12: compileAndBuild payload metadata includes issue_number field from _saveIssueNumber',
        payloadIssueRef);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
