'use strict';
// test_pet_name_memory.js — Unit tests for petNameMemory population (Task #1544)
// Run:  node simulator/test_pet_name_memory.js
//
// Coverage:
//   T001 — Assembler: no capabilities block → namedSlots is empty
//   T002 — Assembler: single capability → namedSlots has one entry (index 0)
//   T003 — Assembler: three capabilities → namedSlots has indices [0, 1, 2]
//   T004 — Assembler: namedSlots length equals number of capabilities declared
//   T005 — markNamedSlots() adds slots to petNameMemory
//   T006 — markNamedSlots() is additive; does not clear pre-existing slots
//   T007 — markNamedSlots(null) / markNamedSlots(undefined) are no-ops
//   T008 — markNamedSlots() rejects slot >= 64 (silently skipped)
//   T009 — markNamedSlots() rejects negative slot index (silently skipped)
//   T010 — isNamedSlot() returns true for named, false for unnamed
//   T011 — DWRITE to IO_PORT_PET_NAME_WR marks the correct slot
//   T012 — DWRITE to IO_PORT_PET_NAME_WR uses value & 0x3F (low-6-bit mask)
//   T013 — DWRITE to IO_PORT_PET_NAME_WR bypasses mLoad (no lump needed)
//   T014 — DWRITE produces a trace line describing the operation
//   T015 — Boot default petNameMemory contains the expected named slots
//   T016 — Slot 7 is present in boot defaults (WukongCallHome in BOOT_NAMED_SLOTS)
//   T017 — getState().petNameMemory returns an Array (not a Set)
//   T018 — getState().petNameMemory reflects additions from markNamedSlots()
//   T019 — getState().petNameMemory reflects additions from DWRITE intercept
//   T020 — Full round-trip: assemble → namedSlots → markNamedSlots → getState
//   T026 — _updatePetnamePreview: invalid petname → Save disabled, preview red
//   T027 — _updatePetnamePreview: valid petname → Save enabled, preview green + seal text
//   T028 — _updatePetnamePreview: empty petname → Save enabled, preview grey "No petname set"
//   T029 — _updatePetnamePreview: invalid → corrected to valid → Save re-enables

const ChurchSimulator  = require('./simulator.js');
const ChurchAssembler  = require('./assembler.js');

let pass = 0;
let fail = 0;

function check(label, cond) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}`);
        fail++;
    }
}

// Boot default named slots — mirrors the BOOT_NAMED_SLOTS constant in
// simulator.js (Object.freeze([0, 1, 2, 3, 4, 5, 6, 7])), which matches
// the 8-slot hardware boot catalog: Boot.NS (0), Boot.Thread (1),
// UART_DEV (2), LED_DEV (3), BTN_DEV (4), TIMER_DEV (5), SelfTest (6),
// WukongCallHome (7).  All 8 slots are named at cold boot.
const BOOT_NAMED_SLOTS = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
const IO_PORT_PET_NAME_WR = 0xFFFFFF38;

// Build a minimal simulator (no registry needed for these tests).
function makeSim() {
    return new ChurchSimulator();
}

// Assemble a snippet and return the full result object.
function assemble(src) {
    const asm = new ChurchAssembler();
    return asm.assemble(src);
}

// ── T001–T004: Assembler namedSlots ───────────────────────────────────────────
console.log('\n--- T001–T004: Assembler namedSlots output ---');
{
    // T001 — no capabilities block → namedSlots must be empty
    const result = assemble(`
HALT
`);
    check('T001: no capabilities block → namedSlots is []',
        Array.isArray(result.namedSlots) && result.namedSlots.length === 0);
}
{
    // T002 — single capability
    const result = assemble(`
capabilities { MyLib E }
HALT
`);
    check('T002: single capability → namedSlots = [0]',
        Array.isArray(result.namedSlots) &&
        result.namedSlots.length === 1 &&
        result.namedSlots[0] === 0);
}
{
    // T003 — three capabilities
    const result = assemble(`
capabilities {
  Alpha E
  Beta  E
  Gamma E
}
HALT
`);
    check('T003a: three capabilities → namedSlots has 3 entries',
        Array.isArray(result.namedSlots) && result.namedSlots.length === 3);
    check('T003b: namedSlots = [0, 1, 2]',
        result.namedSlots[0] === 0 &&
        result.namedSlots[1] === 1 &&
        result.namedSlots[2] === 2);
}
{
    // T004 — length equals declared capability count; also ensure no errors
    const result = assemble(`
capabilities { A E, B E, C E, D E }
HALT
`);
    check('T004a: namedSlots.length === capabilities.length',
        result.namedSlots.length === result.capabilities.length);
    check('T004b: no assembler errors',
        result.errors.length === 0);
}

// ── T005–T010: markNamedSlots() and isNamedSlot() ─────────────────────────────
console.log('\n--- T005–T010: markNamedSlots / isNamedSlot ---');
{
    // T005 — markNamedSlots adds slots
    const sim = makeSim();
    sim.markNamedSlots([20, 30, 40]);
    check('T005a: slot 20 added by markNamedSlots', sim.isNamedSlot(20));
    check('T005b: slot 30 added by markNamedSlots', sim.isNamedSlot(30));
    check('T005c: slot 40 added by markNamedSlots', sim.isNamedSlot(40));
}
{
    // T006 — markNamedSlots is additive; pre-existing boot slots survive
    const sim = makeSim();
    sim.markNamedSlots([25]);
    check('T006a: newly added slot 25 present',   sim.isNamedSlot(25));
    check('T006b: boot slot 0 still present',      sim.isNamedSlot(0));
    check('T006c: boot slot 6 still present',      sim.isNamedSlot(6));
}
{
    // T007 — markNamedSlots(null/undefined) must not throw or clear state
    const sim = makeSim();
    let threw = false;
    try {
        sim.markNamedSlots(null);
        sim.markNamedSlots(undefined);
    } catch (e) {
        threw = true;
    }
    check('T007a: markNamedSlots(null) does not throw', !threw);
    check('T007b: boot slots still intact after no-op call', sim.isNamedSlot(0));
}
{
    // T008 — slot >= 64 is silently rejected
    const sim = makeSim();
    sim.markNamedSlots([64, 100, 255]);
    check('T008a: slot 64 not added (out of range)',  !sim.isNamedSlot(64));
    check('T008b: slot 100 not added (out of range)', !sim.isNamedSlot(100));
}
{
    // T009 — negative slot index silently rejected
    const sim = makeSim();
    sim.markNamedSlots([-1, -10]);
    check('T009: negative slots not added', !sim.isNamedSlot(-1) && !sim.isNamedSlot(-10));
}
{
    // T010 — isNamedSlot true/false for known/unknown slots
    const sim = makeSim();
    sim.markNamedSlots([35]);
    check('T010a: isNamedSlot(35) true after markNamedSlots', sim.isNamedSlot(35));
    check('T010b: isNamedSlot(36) false (never added)',       !sim.isNamedSlot(36));
    check('T010c: isNamedSlot(7) true (WukongCallHome boot slot)',  sim.isNamedSlot(7));
}

// ── T011–T014: DWRITE to IO_PORT_PET_NAME_WR ──────────────────────────────────
console.log('\n--- T011–T014: DWRITE to IO_PORT_PET_NAME_WR ---');
{
    // T011 — basic DWRITE intercept marks the correct slot
    const sim = makeSim();
    // Set CR5.word0 = non-null, non-abstract GT; word1 = 0xFFFFFF38 so that
    // (loc + offset) >>> 0 = 0xFFFFFF38 with imm = 0x4000 (immediate mode, offset 0).
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 22; // slot index to register
    const beforePC = sim.pc;
    const result = sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0x4000 });
    check('T011a: _execDwrite returns a result (not null/undefined)', !!result);
    check('T011b: slot 22 now named after DWRITE intercept', sim.isNamedSlot(22));
    check('T011c: pc advanced by 1', sim.pc === beforePC + 1);
}
{
    // T012 — DR value masked to low 6 bits (value & 0x3F)
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    // DR value 0x80 | 15 = 143; 143 & 0x3F = 15
    sim.dr[1] = 0x8F; // 0x8F & 0x3F = 0x0F = 15
    sim._execDwrite({ crDst: 1, crSrc: 5, imm: 0x4000 });
    check('T012a: slot 15 marked (0x8F & 0x3F = 15)', sim.isNamedSlot(15));
    check('T012b: slot 0x8F (143) not marked (out of 6-bit range)',
        !sim.isNamedSlot(0x8F));
}
{
    // T013 — DWRITE intercept returns early (bypasses mLoad) even when no
    //         valid lump exists for the CR.  We set word2/word3 to 0 (no seal),
    //         which would normally cause an mLoad failure, but the intercept
    //         fires before that check and should still succeed.
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 45;
    let threw = false;
    let result = null;
    try {
        result = sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0x4000 });
    } catch (e) {
        threw = true;
    }
    check('T013a: no exception thrown (mLoad bypassed)', !threw);
    check('T013b: slot 45 registered despite missing lump', sim.isNamedSlot(45));
    check('T013c: machine not halted after intercept', !sim.halted);
}
{
    // T014 — DWRITE output contains a human-readable descriptor
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 33;
    sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0x4000 });
    check('T014a: output contains "IO_PORT_PET_NAME_WR"',
        sim.output.includes('IO_PORT_PET_NAME_WR'));
    check('T014b: output mentions the slot index (33)',
        sim.output.includes('33'));
}

// ── T015–T019: getState().petNameMemory ───────────────────────────────────────
console.log('\n--- T015–T019: getState().petNameMemory ---');
{
    // T015 — boot defaults are all present in getState()
    const sim = makeSim();
    const state = sim.getState();
    const arr = state.petNameMemory;
    check('T015a: getState().petNameMemory is an Array', Array.isArray(arr));
    const stateSet = new Set(arr);
    let allPresent = true;
    for (const s of BOOT_NAMED_SLOTS) {
        if (!stateSet.has(s)) { allPresent = false; break; }
    }
    check('T015b: all boot-default slots present in getState()', allPresent);
}
{
    // T016 — slot 7 (WukongCallHome) is present in boot defaults
    const sim = makeSim();
    const state = sim.getState();
    check('T016: slot 7 present in boot-default petNameMemory (WukongCallHome)',
        state.petNameMemory.includes(7));
}
{
    // T017 — getState() returns an Array, not a Set (JSON-serialisable)
    const sim = makeSim();
    const mem = sim.getState().petNameMemory;
    check('T017a: petNameMemory is an Array', Array.isArray(mem));
    check('T017b: petNameMemory is not a Set instance', !(mem instanceof Set));
}
{
    // T018 — additions via markNamedSlots() appear in subsequent getState() calls
    const sim = makeSim();
    sim.markNamedSlots([50, 55, 60]);
    const mem = sim.getState().petNameMemory;
    const s = new Set(mem);
    check('T018a: slot 50 reflected in getState() after markNamedSlots', s.has(50));
    check('T018b: slot 55 reflected in getState() after markNamedSlots', s.has(55));
    check('T018c: slot 60 reflected in getState() after markNamedSlots', s.has(60));
}
{
    // T019 — additions via DWRITE intercept appear in getState()
    const sim = makeSim();
    sim.cr[5] = { word0: 1, word1: IO_PORT_PET_NAME_WR, word2: 0, word3: 0, m: 0 };
    sim.dr[0] = 47;
    sim._execDwrite({ crDst: 0, crSrc: 5, imm: 0x4000 });
    const mem = sim.getState().petNameMemory;
    check('T019: slot 47 reflected in getState() after DWRITE intercept',
        new Set(mem).has(47));
}

// ── T020: Full round-trip ──────────────────────────────────────────────────────
console.log('\n--- T020: Full round-trip assemble → markNamedSlots → getState ---');
{
    // Assemble a program with a capabilities block, feed namedSlots into a fresh
    // sim via markNamedSlots(), then verify getState() contains those slots.
    const result = assemble(`
capabilities {
  WidgetA E
  WidgetB E
  WidgetC E
}
HALT
`);
    check('T020a: no assembler errors', result.errors.length === 0);
    check('T020b: namedSlots has 3 entries', result.namedSlots.length === 3);

    const sim = makeSim();
    sim.markNamedSlots(result.namedSlots);

    const mem = new Set(sim.getState().petNameMemory);
    check('T020c: slot 0 present after round-trip', mem.has(0));
    check('T020d: slot 1 present after round-trip', mem.has(1));
    check('T020e: slot 2 present after round-trip', mem.has(2));
    // Boot defaults should still be there too
    check('T020f: boot slot 5 still present after round-trip', mem.has(5));
}

// ── T021–T025: resetNamedSlots() and cross-program reload isolation ────────────
// These tests cover Task #1547: guard against lazy-resolve being skipped when
// petNameMemory is cleared on program reload.  A stale named-slot from program A
// must not survive into program B when B does not declare that slot.
console.log('\n--- T021–T025: resetNamedSlots() / cross-program reload isolation ---');
{
    // T021 — After reset, a slot that was added by markNamedSlots() is gone.
    // Simulates: program A marks slot 20, reload clears, program B does not mark it.
    const sim = makeSim();
    sim.markNamedSlots([20]);          // program A declares slot 20
    check('T021a: slot 20 present after program A markNamedSlots', sim.isNamedSlot(20));
    sim.resetNamedSlots();             // simulates reload (B has no capabilities block)
    check('T021b: slot 20 absent after resetNamedSlots (program B load)', !sim.isNamedSlot(20));
}
{
    // T022 — After reset, hardware boot slots are restored.
    // The reset must not leave petNameMemory completely empty; boot defaults must survive.
    const sim = makeSim();
    sim.markNamedSlots([20, 30, 40]);
    sim.resetNamedSlots();
    check('T022a: boot slot 0 present after reset',  sim.isNamedSlot(0));
    check('T022b: boot slot 1 present after reset',  sim.isNamedSlot(1));
    check('T022c: boot slot 6 present after reset',  sim.isNamedSlot(6));
    check('T022d: boot slot 7 present after reset (WukongCallHome in BOOT_NAMED_SLOTS)', sim.isNamedSlot(7));
    check('T022e: program-A slot 20 absent after reset', !sim.isNamedSlot(20));
    check('T022f: program-A slot 30 absent after reset', !sim.isNamedSlot(30));
}
{
    // T023 — Full reload sequence: program A → program B (with different named slot).
    // Slot from A must be gone; slot from B must be present after reload + markNamedSlots.
    const sim = makeSim();
    sim.markNamedSlots([20]);          // program A
    sim.resetNamedSlots();             // reload (program B starts)
    sim.markNamedSlots([30]);          // program B declares slot 30 only
    check('T023a: program-B slot 30 present', sim.isNamedSlot(30));
    check('T023b: program-A slot 20 absent (stale entry purged)', !sim.isNamedSlot(20));
    check('T023c: boot slot 5 still present across reload', sim.isNamedSlot(5));
}
{
    // T024 — Program A with 8 capabilities (slots 0–7) then program B with no
    //         capabilities block.  Slot 7 is the first gap in BOOT_NAMED_SLOTS so
    //         it is ONLY named while program A is loaded; it must disappear after
    //         reset + program B load.  Slots 0–6 survive because they are boot
    //         defaults, not because of stale program-A data.
    const resultA = assemble(`
capabilities {
  LibA E
  LibB E
  LibC E
  LibD E
  LibE E
  LibF E
  LibG E
  LibH E
}
HALT
`);
    check('T024a: program A assembles without errors', resultA.errors.length === 0);
    check('T024b: program A has 8 namedSlots', resultA.namedSlots.length === 8);

    const resultB = assemble(`
HALT
`);
    check('T024c: program B assembles without errors', resultB.errors.length === 0);
    check('T024d: program B has no namedSlots', resultB.namedSlots.length === 0);

    const sim = makeSim();
    // Load program A — slot 7 (WukongCallHome boot default) is already named
    sim.markNamedSlots(resultA.namedSlots);   // slots [0..7]
    check('T024e: slot 7 named after program A load (WukongCallHome boot default)', sim.isNamedSlot(7));

    // Load program B (no capabilities block → reset only, no markNamedSlots call)
    sim.resetNamedSlots();
    // Program B does NOT call markNamedSlots (no capabilities block).
    // Slot 7 survives because it is a boot default (WukongCallHome), not a stale program-A entry.
    check('T024f: slot 7 present after reload to program B (WukongCallHome boot default survives)', sim.isNamedSlot(7));
    // Slots 0–3 are boot defaults, so they survive via reset — NOT because of A's data
    check('T024g: slot 0 present after reload (boot default, not stale)', sim.isNamedSlot(0));
    check('T024h: slot 3 present after reload (boot default, not stale)', sim.isNamedSlot(3));
}
{
    // T025 — resetNamedSlots() does not throw; subsequent isNamedSlot() works correctly.
    const sim = makeSim();
    let threw = false;
    try {
        sim.resetNamedSlots();
    } catch (e) {
        threw = true;
    }
    check('T025a: resetNamedSlots() does not throw', !threw);
    check('T025b: isNamedSlot() works normally after reset', sim.isNamedSlot(0));
    check('T025c: isNamedSlot(7) true after reset (WukongCallHome boot default)', sim.isNamedSlot(7));
}

// ── T026–T029: _updatePetnamePreview validation via real production source ──────
//
// These tests load the REAL _updatePetnamePreview function from simulator/app-run.js
// using Node's `vm` module and a minimal mocked `document`. Any change to the
// production regex, preview text, colour constants, or save-button logic will
// immediately break these assertions — no manual sync required.
//
// CANONICAL VALIDATION RULE: the allowed character set is defined once in
// _isPetnameValid() in simulator/app-run.js, just above _updatePetnamePreview().
// _updatePetnamePreview and saveSettings both call _isPetnameValid — they do NOT
// contain their own inline regex.  If you change the allowed characters, change
// _isPetnameValid only; everything else (preview, save guard, openSettings sanitiser,
// and these tests) will follow automatically because they all run from the same source.
//
// WARNING: if the regex is ever duplicated outside _isPetnameValid, these tests
// will still pass (they drive _updatePetnamePreview directly) while the duplicated
// copy silently diverges — UI accepts characters the guard rejects, or vice versa.
//
// Only the four DOM elements the function actually calls getElementById() on are
// mocked: settingPetname, settingIssueNumber, settingPetnamePreview, settingsSaveBtn.
console.log('\n--- T026–T029: _updatePetnamePreview petname validation (real source) ---');
{
    const vm   = require('vm');
    const fs   = require('fs');
    const path = require('path');

    // ── Extract _isPetnameValid and _updatePetnamePreview from production source ─
    // _isPetnameValid is the single source-of-truth for the petname regex (see
    // app-run.js, just above _updatePetnamePreview).  Both functions are injected
    // into the vm context so that any change to the canonical helper is immediately
    // reflected here without any manual sync.
    // Brace-counting ensures we capture complete function bodies even when they
    // contain nested braces, without relying on fragile line-number offsets.
    const appRunSrc = fs.readFileSync(
        path.join(__dirname, 'app-run.js'), 'utf8'
    );
    function extractFn(src, marker) {
        const idx = src.indexOf(marker);
        if (idx === -1) throw new Error(marker + ' not found in app-run.js');
        let depth = 0, end = idx;
        for (let i = idx; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        return src.slice(idx, end + 1);
    }
    // Also extract _PETNAME_CHAR_CLASS — _isPetnameValid references it as a closure
    // variable, so the vm context must include it too.
    const charClassMarker = 'const _PETNAME_CHAR_CLASS = ';
    const charClassIdx = appRunSrc.indexOf(charClassMarker);
    if (charClassIdx === -1) throw new Error('_PETNAME_CHAR_CLASS not found in app-run.js');
    const charClassEnd = appRunSrc.indexOf('\n', charClassIdx);
    const charClassSource = appRunSrc.slice(charClassIdx, charClassEnd + 1);

    const validatorSource   = extractFn(appRunSrc, 'function _isPetnameValid(');
    const sanitiserSource   = extractFn(appRunSrc, 'function _sanitisePetname(');
    const fnSource          = extractFn(appRunSrc, 'function _updatePetnamePreview() {');
    // Combined preamble: canonical constant + both helpers + the function under test.
    const vmPreamble = charClassSource + '\n' + validatorSource + '\n' + sanitiserSource + '\n';

    // ── Helpers ───────────────────────────────────────────────────────────────
    // makeDOMContext builds one persistent mock DOM that survives across multiple
    // invocations of runInDOM — essential for testing state transitions (T029).
    // saveBtnDisabled lets callers pre-set the button state before the first call
    // so tests can prove the production branch actively changes it (T027, T028).
    function makeDOMContext(petnameVal, issueVal, saveBtnDisabled) {
        const previewEl = { textContent: '', style: { color: '' } };
        const saveBtn   = { disabled: saveBtnDisabled !== undefined ? saveBtnDisabled : false };
        const petnameEl = { value: String(petnameVal) };
        const issueEl   = { value: String(issueVal !== undefined ? issueVal : 1) };
        const elements  = {
            settingPetname:        petnameEl,
            settingIssueNumber:    issueEl,
            settingPetnamePreview: previewEl,
            settingsSaveBtn:       saveBtn
        };
        const ctx = vm.createContext({
            document: { getElementById: (id) => elements[id] || null }
        });
        // Run the preamble (constant + helpers + function body) ONCE on the context so
        // that `const _PETNAME_CHAR_CLASS` and the function definitions are declared
        // exactly once.  Subsequent invoke() calls only re-run the call site, avoiding
        // the "already been declared" error that arises when T029 invokes twice on the
        // same context.
        vm.runInContext(vmPreamble + fnSource, ctx);
        function invoke() { vm.runInContext('_updatePetnamePreview();', ctx); }
        return { previewEl, saveBtn, petnameEl, invoke };
    }

    // T026 — invalid petname (contains @) → Save disabled, preview red
    // saveBtn starts enabled to prove the function actively disables it.
    {
        const d = makeDOMContext('ken@work', 1, false);
        d.invoke();
        check('T026a: invalid petname → saveBtn.disabled === true',
            d.saveBtn.disabled === true);
        check('T026b: invalid petname → preview color is #ef4444',
            d.previewEl.style.color === '#ef4444');
        check('T026c: invalid petname → preview text starts with "Invalid characters"',
            d.previewEl.textContent.startsWith('Invalid characters'));
    }

    // T027 — valid petname ("ken") → Save enabled, preview green with correct seal text.
    // saveBtn starts disabled to prove the function actively enables it.
    {
        const d = makeDOMContext('ken', 3, true);
        d.invoke();
        check('T027a: valid petname → saveBtn.disabled === false',
            d.saveBtn.disabled === false);
        check('T027b: valid petname → preview color is #22c55e',
            d.previewEl.style.color === '#22c55e');
        check('T027c: valid petname → preview shows correct seal text',
            d.previewEl.textContent === 'Seal: ken.Abstraction#3');
    }

    // T028 — empty petname → Save enabled, preview grey "No petname set".
    // saveBtn starts disabled to prove the empty branch actively enables it.
    {
        const d = makeDOMContext('', 1, true);
        d.invoke();
        check('T028a: empty petname → saveBtn.disabled === false',
            d.saveBtn.disabled === false);
        check('T028b: empty petname → preview color is #6b7280',
            d.previewEl.style.color === '#6b7280');
        check('T028c: empty petname → preview starts with "No petname set"',
            d.previewEl.textContent.startsWith('No petname set'));
    }

    // T029 — type invalid, then correct to valid → Save re-enables on same DOM.
    // A single persistent DOM is reused so the same saveBtn object transitions
    // from disabled=false → true (invalid) → false (corrected), proving the
    // production re-enable branch is reached and not masked by a fresh default.
    {
        const d = makeDOMContext('bad!name', 1, false);
        d.invoke();
        check('T029a: after invalid input → saveBtn.disabled === true',
            d.saveBtn.disabled === true);
        // Simulate the user correcting the input (same DOM, same button object).
        d.petnameEl.value = 'goodname';
        d.invoke();
        check('T029b: after correcting to valid → saveBtn.disabled === false',
            d.saveBtn.disabled === false);
        check('T029c: after correcting to valid → preview color is #22c55e',
            d.previewEl.style.color === '#22c55e');
        check('T029d: after correcting to valid → preview shows correct seal',
            d.previewEl.textContent === 'Seal: goodname.Abstraction#1');
    }

    // T030 — whitespace-only petname ("   ") → trim() collapses it to empty →
    //         Save enabled, preview grey "No petname set" (not "Invalid characters").
    //         saveBtn starts disabled to prove the empty branch actively enables it.
    {
        const d = makeDOMContext('   ', 1, true);
        d.invoke();
        check('T030a: whitespace-only petname → saveBtn.disabled === false',
            d.saveBtn.disabled === false);
        check('T030b: whitespace-only petname → preview color is #6b7280',
            d.previewEl.style.color === '#6b7280');
        check('T030c: whitespace-only petname → preview starts with "No petname set"',
            d.previewEl.textContent.startsWith('No petname set'));
    }

    // T031 — leading/trailing whitespace around a valid name (" ken ") →
    //         trim() produces "ken" → Save enabled, preview green with correct seal.
    //         saveBtn starts disabled to prove the valid branch actively enables it.
    {
        const d = makeDOMContext(' ken ', 2, true);
        d.invoke();
        check('T031a: padded valid petname → saveBtn.disabled === false',
            d.saveBtn.disabled === false);
        check('T031b: padded valid petname → preview color is #22c55e',
            d.previewEl.style.color === '#22c55e');
        check('T031c: padded valid petname → preview shows trimmed seal text',
            d.previewEl.textContent === 'Seal: ken.Abstraction#2');
    }
}

// ── T030: Source-level regression — canonical petname rule not duplicated ───────
//
// This test reads simulator/app-run.js and asserts the structural contract:
//
//   1. The character-class literal 'a-z0-9._-' appears only inside the two
//      canonical helpers (_isPetnameValid / _sanitisePetname).  Any inline copy
//      of the regex elsewhere means a future character-set change can silently
//      diverge; this test catches that the moment it happens.
//
//   2. _updatePetnamePreview and saveSettings call _isPetnameValid() — they do
//      NOT contain their own inline regex.
//
//   3. The _sanitisePetname helper is present and is used by the openSettings
//      stored-value correction path (not an inline replace pattern).
//
// If this test fails after a regex change, the fix is to update _PETNAME_CHAR_CLASS
// in app-run.js only — not to adjust the expected string in this test.
console.log('\n--- T030: Source-level regression — petname rule not duplicated ---');
{
    const fs   = require('fs');
    const path = require('path');
    const src  = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');

    // Helper: extract a function body by name (brace-counting).
    function extractFnBody(source, marker) {
        const idx = source.indexOf(marker);
        if (idx === -1) return null;
        let depth = 0, end = idx;
        for (let i = idx; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        return source.slice(idx, end + 1);
    }

    // The canonical character-class literal.  If _PETNAME_CHAR_CLASS changes,
    // update this string to match — and only here.
    const CHAR_CLASS = 'a-z0-9._-';

    const validatorBody   = extractFnBody(src, 'function _isPetnameValid(');
    const sanitiserBody   = extractFnBody(src, 'function _sanitisePetname(');
    const previewBody     = extractFnBody(src, 'function _updatePetnamePreview() {');
    const saveBody        = extractFnBody(src, 'function saveSettings() {');

    check('T030a: _isPetnameValid helper exists in app-run.js',       validatorBody !== null);
    check('T030b: _sanitisePetname helper exists in app-run.js',      sanitiserBody !== null);
    check('T030c: _updatePetnamePreview body exists in app-run.js',   previewBody   !== null);
    check('T030d: saveSettings body exists in app-run.js',            saveBody      !== null);

    if (validatorBody && sanitiserBody && previewBody && saveBody) {
        // Strip the two canonical helpers (and the const declaration that defines
        // _PETNAME_CHAR_CLASS) from the source, then verify no functional inline
        // regex copies of the character class remain elsewhere.  We check for the
        // regex literal forms — /^[a-z0-9._-]+$/  and  /[^a-z0-9._-]/ — that an
        // inline copy would use.  The bare string in the const declaration and in
        // documentation comments is benign and intentionally excluded from this check.
        const constLinePattern = new RegExp('const _PETNAME_CHAR_CLASS = [^\\n]+\\n');
        const withoutCanonical = src
            .replace(constLinePattern, '')
            .replace(validatorBody, '')
            .replace(sanitiserBody, '');
        const INLINE_VALIDATOR_RE  = /\/\^?\[a-z0-9\._-\]/.source; // /^[a-z0-9._-] literal
        const INLINE_SANITISER_RE  = /\/\[\^a-z0-9\._-\]/.source; // /[^a-z0-9._-] literal
        const hasInlineCopy = withoutCanonical.includes('/^[' + CHAR_CLASS + ']+$/')
                           || withoutCanonical.includes('/[^' + CHAR_CLASS + ']/');
        check('T030e: no functional inline regex copies of the character class outside canonical helpers',
            !hasInlineCopy);

        // The preview and save functions must call _isPetnameValid, not inline regex.
        check('T030f: _updatePetnamePreview calls _isPetnameValid()',
            previewBody.includes('_isPetnameValid('));
        check('T030g: saveSettings calls _isPetnameValid()',
            saveBody.includes('_isPetnameValid('));

        // The preview and save functions must NOT contain the raw character class.
        check('T030h: _updatePetnamePreview contains no inline character-class copy',
            !previewBody.includes(CHAR_CLASS));
        check('T030i: saveSettings contains no inline character-class copy',
            !saveBody.includes(CHAR_CLASS));

        // _sanitisePetname must be used by the openSettings stored-value correction
        // path (not an inline replace pattern with the raw character class).
        // We verify by checking _sanitisePetname is referenced in the source outside
        // its own definition, and that the openSettings region contains _sanitisePetname
        // rather than the raw inverse class.
        const openSettingsBody = extractFnBody(src, 'function openSettings(');
        check('T030j: openSettings uses _sanitisePetname() not an inline replace pattern',
            openSettingsBody !== null &&
            openSettingsBody.includes('_sanitisePetname(') &&
            !openSettingsBody.includes(CHAR_CLASS));
    }
}

// ── Final summary ──────────────────────────────────────────────────────────────
console.log('');
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
if (fail === 0) {
    console.log(`  ALL ${pass} ASSERTIONS PASSED`);
} else {
    console.log(`  ${pass} passed, ${fail} FAILED`);
}
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
process.exit(fail > 0 ? 1 : 0);
