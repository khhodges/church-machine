'use strict';
// test_ns_slot_dynamic.js — Regression tests for Task #2084
// Verifies that _applyPendingSimLoad() writes compiled programs to NS slot [7]
// (the boot-reserved programmable slot) and leaves SelfTest at slot [6] intact.
//
// Run:  node simulator/test_ns_slot_dynamic.js
//
// Coverage:
//   T301 — allocOrFindNsSlot: fresh sim → returns slot [7]
//   T302 — allocOrFindNsSlot: same token → reuses slot [7] (no re-allocation)
//   T303 — allocOrFindNsSlot: different token, slot [7] free → still returns [7]
//   T304 — writeNsEntryForProgram: writes valid lump header at 0x0400
//   T305 — writeNsEntryForProgram: NS entry for slot [7] points to 0x0400
//   T306 — writeNsEntryForProgram: nsLabels[7] equals the program name
//   T307 — writeNsEntryForProgram: slot [6] NS entry unchanged (SelfTest safe)
//   T308 — _applyPendingSimLoad: bootEntrySlot is set to 7 after apply
//   T309 — _applyPendingSimLoad: nsLabels[7] equals compiled program name
//   T310 — _applyPendingSimLoad: NS[6] SelfTest entry is unchanged
//   T311 — _applyPendingSimLoad: sim.cr[0] encodes NS slot [7]
//   T312 — _applyPendingSimLoad: sim.programBaseAddr is at EXTENDED_BASE + 1
//   T313 — allocOrFindNsSlot: slot [7] occupied → falls back to slot [8]
//   T314 — allocOrFindNsSlot: token reuse maps to existing non-[7] slot
//   T315 — allocOrFindNsSlot: all slots occupied → returns null

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ChurchSimulator     = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
    if (cond) {
        console.log(`PASS ${label}`);
        pass++;
    } else {
        console.log(`FAIL ${label}${detail ? ': ' + detail : ''}`);
        fail++;
    }
}

// ── Source extraction (same technique as test_boot_entry_sync.js) ─────────────
function extractTopLevelFn(sourceFile, fnName) {
    const src   = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    const lines = src.split('\n');
    const startPattern = `function ${fnName}(`;
    let collecting = false;
    let depth = 0;
    const buf = [];
    for (const line of lines) {
        if (!collecting && line.startsWith(startPattern)) collecting = true;
        if (!collecting) continue;
        buf.push(line);
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && buf.length > 1) break;
    }
    if (buf.length === 0) throw new Error(`"${fnName}" not found in ${sourceFile}`);
    return buf.join('\n');
}

// ── Minimal simulator factory ─────────────────────────────────────────────────
function makeBooted() {
    const reg = new AbstractionRegistry();
    const sim = new ChurchSimulator();
    sim.abstractionRegistry = reg;
    // Manually mark as booted — we only need the namespace table initialised,
    // not the full multi-step boot sequence.
    sim.bootComplete = true;
    // _initNamespaceTable() runs in constructor, so slot [6] already has an
    // NS entry (SelfTest/Boot.Abstr) that we can detect surviving unchanged.
    return sim;
}

// ── Unit tests: allocOrFindNsSlot ─────────────────────────────────────────────
{
    const sim = makeBooted();

    const slot1 = sim.allocOrFindNsSlot('tok_abc', 'MyProg');
    check('T301: allocOrFindNsSlot returns slot 7 for fresh sim', slot1 === 7);

    const slot2 = sim.allocOrFindNsSlot('tok_abc', 'MyProg');
    check('T302: allocOrFindNsSlot reuses slot 7 for same token', slot2 === 7);

    const slot3 = sim.allocOrFindNsSlot('tok_xyz', 'OtherProg');
    check('T303: allocOrFindNsSlot returns slot 7 for different token', slot3 === 7);
}

// ── Unit tests: writeNsEntryForProgram ────────────────────────────────────────
{
    const sim = makeBooted();
    const words = [0x12345678, 0xABCDEF00, 0x00000001];
    const caps  = [];

    // Capture slot [6] state before the call
    const e6before = sim.readNSEntry(6);
    const e6w0 = e6before ? e6before.word0_location : null;
    const e6w1 = e6before ? e6before.word1_limit : null;

    sim.writeNsEntryForProgram(7, { words, caps, label: 'HelloProg' });

    const EXTENDED_BASE = 0x0400;
    const hdrWord = sim.memory[EXTENDED_BASE] >>> 0;
    const hdr = sim.parseLumpHeader(hdrWord);
    check('T304: lump header at 0x0400 is valid after writeNsEntryForProgram',
        hdr.valid === true,
        `hdr.valid=${hdr.valid}, hdrWord=0x${hdrWord.toString(16)}`);

    const e7 = sim.readNSEntry(7);
    check('T305: NS entry for slot [7] points to 0x0400',
        e7 !== null && e7.word0_location === EXTENDED_BASE,
        `e7.word0_location=0x${e7 ? e7.word0_location.toString(16) : 'null'}`);

    check('T306: nsLabels[7] equals program name after writeNsEntryForProgram',
        sim.nsLabels[7] === 'HelloProg',
        `nsLabels[7]="${sim.nsLabels[7]}"`);

    const e6after = sim.readNSEntry(6);
    check('T307: slot [6] NS entry unchanged after writeNsEntryForProgram',
        e6after !== null &&
        e6after.word0_location === e6w0 &&
        e6after.word1_limit    === e6w1,
        `before:(0x${(e6w0 || 0).toString(16)},0x${(e6w1 || 0).toString(16)}) ` +
        `after:(0x${(e6after ? e6after.word0_location : 0).toString(16)},0x${(e6after ? e6after.word1_limit : 0).toString(16)})`);
}

// ── Integration tests: _applyPendingSimLoad with mocked LumpRegistry ──────────
{
    const applyFnSrc       = extractTopLevelFn('app-run.js', '_applyPendingSimLoad');
    const injectFnSrc      = extractTopLevelFn('app-run.js', '_injectClistNow');
    const syncBESrc        = extractTopLevelFn('app-abstractions.js', '_syncBootEntryFromSim');

    const sim = makeBooted();

    // Minimal 3-instruction program
    const PROG_WORDS = [0x11111111, 0x22222222, 0x33333333];
    const PROG_TOKEN = 'test_prog_token';
    const PROG_NAME  = 'TestProg';

    sim.programName = PROG_NAME;

    // Mock LumpRegistry: returns a memory source with our program words
    const mockRegistry = {
        _cur: PROG_TOKEN,
        getCurrent() { return this._cur; },
        resolve(tok) {
            if (tok !== PROG_TOKEN) return null;
            return { token: tok, sources: { memory: { words: PROG_WORDS, capabilities: [] } } };
        },
        isServerListFetched() { return true; },
        warmServerList()      { return Promise.resolve([]); },
    };

    // Minimal localStorage mock so _syncBootEntryFromSim doesn't throw
    const _localStorageMock = (() => {
        const store = {};
        return {
            getItem:    k      => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
            setItem:    (k, v) => { store[k] = String(v); },
            removeItem: k      => { delete store[k]; },
            clear:      ()     => { Object.keys(store).forEach(k => delete store[k]); },
        };
    })();

    // Build a sandbox that wires the production functions together
    const sandbox = vm.createContext({
        sim,
        window: {
            LumpRegistry: mockRegistry,
            lumpEditorRenderResidentPanel: null,
        },
        localStorage: _localStorageMock,
        console,
        lastMethodTableSize: 0,
        lastAssembledCapabilities: [],
        lastAssembledNamedSlots: [],
        pipelineViz: null,
        _pendingSimLoad: true,
        bootEntrySlot: 6,
        currentView: 'code',
        ChurchSimulator,
        _syncBootEntryFromSim: null,
        // Render stubs: these just need to exist, not do anything in Node.js
        renderAbstractions: () => {},
        updateNamespace:    () => {},
    });

    // Evaluate functions inside the sandbox so they share its globals
    vm.runInContext(syncBESrc,  sandbox);
    vm.runInContext(injectFnSrc, sandbox);
    vm.runInContext(applyFnSrc,  sandbox);

    // Capture slot [6] state before the call
    const e6before = sim.readNSEntry(6);
    const e6w0before = e6before ? e6before.word0_location : null;
    const e6w1before = e6before ? e6before.word1_limit    : null;

    // Run the production function
    try {
        vm.runInContext('_applyPendingSimLoad();', sandbox);
    } catch (err) {
        console.log(`[integration] _applyPendingSimLoad threw: ${err.message}`);
    }

    check('T308: bootEntrySlot is 7 after _applyPendingSimLoad',
        sim.bootEntrySlot === 7,
        `bootEntrySlot=${sim.bootEntrySlot}`);

    check('T309: nsLabels[7] equals compiled program name',
        sim.nsLabels[7] === PROG_NAME,
        `nsLabels[7]="${sim.nsLabels[7]}"`);

    const e6after = sim.readNSEntry(6);
    check('T310: NS[6] SelfTest entry unchanged after _applyPendingSimLoad',
        e6after !== null &&
        e6after.word0_location === e6w0before &&
        e6after.word1_limit    === e6w1before,
        `before:(0x${(e6w0before || 0).toString(16)},0x${(e6w1before || 0).toString(16)}) ` +
        `after:(0x${(e6after ? e6after.word0_location : 0).toString(16)},0x${(e6after ? e6after.word1_limit : 0).toString(16)})`);

    // CR0 word encodes: [31]=b_flag=0, perm bits, gt_type, gt_seq, slot_index
    // For E-GT at slot 7: perm=E=0b100 (Church), dom=1, type=1
    // createGT(0, 7, {E:1}, 1) — slot index is in bits [8:0] = 7
    const cr0Word = sim.cr[0] ? (sim.cr[0].word0 >>> 0) : 0;
    const cr0SlotIdx = cr0Word & 0x1FF;
    check('T311: sim.cr[0] encodes NS slot [7]',
        cr0SlotIdx === 7,
        `cr0.word0=0x${cr0Word.toString(16)}, slotIdx=${cr0SlotIdx}`);

    const EXTENDED_BASE = 0x0400;
    check('T312: sim.programBaseAddr is EXTENDED_BASE + 1 (code follows lump header)',
        sim.programBaseAddr === EXTENDED_BASE + 1,
        `programBaseAddr=0x${(sim.programBaseAddr || 0).toString(16)}`);
}

// ── Allocator fallback tests ──────────────────────────────────────────────────
// T313: slot [7] occupied → allocator falls back to slot [8]
{
    const sim = makeBooted();
    // Occupy slot [7] by writing a real NS entry for it
    sim.writeNsEntryForProgram(7, { words: [0xAAAAAAAA], caps: [], label: 'PriorProg' });
    // isNSEntryValid(7) should now be true
    const s13 = sim.allocOrFindNsSlot('tok_new', 'NewProg');
    check('T313: allocOrFindNsSlot falls back to slot [8] when slot [7] is occupied',
        s13 === 8,
        `returned slot=${s13}`);
}

// T314: token reuse honours cached slot even when it is not slot [7]
{
    const sim = makeBooted();
    // Occupy slot [7] so 'tok_first' gets mapped to slot [8]
    sim.writeNsEntryForProgram(7, { words: [0x11111111], caps: [], label: 'Occupied' });
    const s14a = sim.allocOrFindNsSlot('tok_first', 'FirstProg');  // → 8
    // Now call again with the same token — should reuse slot [8], NOT try slot [7]
    const s14b = sim.allocOrFindNsSlot('tok_first', 'FirstProg');
    check('T314: allocOrFindNsSlot reuses cached slot [8] for same token (non-7 reuse)',
        s14a === 8 && s14b === 8,
        `first=${s14a}, reuse=${s14b}`);
}

// T315: all allocatable slots occupied → returns null
{
    const sim = makeBooted();
    // Temporarily shrink the table to 9 slots (0–8) so we can exhaust it quickly.
    const origMax = sim.MAX_NS_ENTRIES;
    sim.MAX_NS_ENTRIES = 9;
    // Occupy the two allocatable slots: [7] and [8]
    sim.writeNsEntryForProgram(7, { words: [1], caps: [], label: 'Full7' });
    sim.writeNsEntryForProgram(8, { words: [2], caps: [], label: 'Full8' });
    const s15 = sim.allocOrFindNsSlot('tok_overflow', 'Overflow');
    check('T315: allocOrFindNsSlot returns null when namespace table is full',
        s15 === null,
        `returned=${s15}`);
    sim.MAX_NS_ENTRIES = origMax;   // restore
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
