'use strict';
// test_floating_lump_source.js — Regression tests for Task #1441
// Confirms that _findSrcLump() correctly surfaces a Source button entry for
// both fixed-slot and floating (ns_slot: null) lumps in the namespace view.
//
// Background: Task #1440 wired the secondary _findSrcLump lookup so that
// floating lumps (manifest carries ns_slot: null) can still match a live NS
// slot by abstraction label — the Loader places them dynamically at runtime.
// Without this test a regression could silently break that path again.
//
// Run:  node simulator/test_floating_lump_source.js
//
// Coverage:
//   T01 — Fixed-slot lump: _findSrcLump(slotIdx, label) returns the cache
//           entry when the manifest carries a matching non-null ns_slot.
//   T02 — Floating lump (ns_slot: null): returns the entry when the lump's
//           abstraction field matches the live NS label.
//   T03 — No match: returns null when no cache entry matches by slot or label.
//   T04 — Fixed-slot takes priority over a floating lump with the same label.
//   T05 — Floating lump with ns_slot: undefined is also found by label.
//   T06 — _lumpsCache undefined → returns null without throwing.
//   T07 — Floating lump is not matched when slotLabel is null/undefined.

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

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

// ── Source extraction ─────────────────────────────────────────────────────────
// Reads _findSrcLump verbatim from app-memory.js so the test always exercises
// the production logic — any future change to the function is automatically
// picked up without needing to update a hand-written replica.

function extractTopLevelFn(sourceFile, fnName) {
    const src   = fs.readFileSync(path.join(__dirname, sourceFile), 'utf8');
    const lines = src.split('\n');
    const startPattern = `function ${fnName}(`;
    let collecting = false;
    let depth = 0;
    const buf = [];

    for (const line of lines) {
        if (!collecting && line.startsWith(startPattern)) {
            collecting = true;
        }
        if (!collecting) continue;

        buf.push(line);
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
        if (depth === 0 && buf.length > 1) break;
    }

    if (buf.length === 0) {
        throw new Error(`extractTopLevelFn: "${fnName}" not found in ${sourceFile}`);
    }
    return buf.join('\n');
}

const findSrcLumpSrc = extractTopLevelFn('app-memory.js', '_findSrcLump');
const appMemorySource = fs.readFileSync(path.join(__dirname, 'app-memory.js'), 'utf8');
const appLumpsSource = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');

// ── Sandbox factory ───────────────────────────────────────────────────────────
// Each test gets a fresh VM context with its own _lumpsCache so tests cannot
// bleed state into one another.

function makeSandbox(lumpsCache) {
    const sandbox = {
        _lumpsCache: lumpsCache,
        window: { _nsState: null },
        sim: { lumpTokenAtSlot() { return null; } },
        console,
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(findSrcLumpSrc, ctx, { filename: 'app-memory.js' });
    return ctx;
}

// ── T01: Fixed-slot lump ──────────────────────────────────────────────────────
// When a manifest entry has ns_slot === slotIdx the primary lookup fires.
// _findSrcLump must return that entry — the caller then emits a Source button.
console.log('\n--- T01: fixed-slot lump → Source button entry returned ---');
{
    const fixedEntry = { ns_slot: 5, abstraction: 'WordString', token: 'aabbccdd' };
    const ctx = makeSandbox([fixedEntry]);

    const result = vm.runInContext('_findSrcLump(5, "WordString")', ctx);

    check('T01a: returns non-null for fixed-slot match',  result !== null);
    check('T01b: returns the correct cache entry',        result === fixedEntry);
    check('T01c: returned entry carries a token field',   result && result.token === 'aabbccdd');
}

// ── T02: Floating lump (ns_slot: null) ───────────────────────────────────────
// When ns_slot is null the Loader places the lump dynamically.  The secondary
// lookup must match by abstraction label so a Source button is still rendered.
console.log('\n--- T02: floating lump (ns_slot: null) → Source button entry returned ---');
{
    const floatingEntry = { ns_slot: null, abstraction: 'WordString', token: 'deadbeef' };
    const ctx = makeSandbox([floatingEntry]);

    // Loader placed this lump at slot 7 at runtime; label is 'WordString'.
    const result = vm.runInContext('_findSrcLump(7, "WordString")', ctx);

    check('T02a: returns non-null for floating lump label match',  result !== null);
    check('T02b: returns the correct floating cache entry',        result === floatingEntry);
    check('T02c: returned floating entry carries correct token',   result && result.token === 'deadbeef');
}

// ── T03: No match ─────────────────────────────────────────────────────────────
// When no entry matches by slot index and no floating entry matches by label,
// _findSrcLump must return null — no Source button is emitted.
console.log('\n--- T03: no match → null (no Source button) ---');
{
    const cache = [
        { ns_slot: 2,   abstraction: 'Math',       token: 'aaaa0001' },
        { ns_slot: null, abstraction: 'WordString', token: 'aaaa0002' },
    ];
    const ctx = makeSandbox(cache);

    // Slot 9 has no fixed-slot entry, and its label does not match any floating lump.
    const result = vm.runInContext('_findSrcLump(9, "Scheduler")', ctx);

    check('T03a: returns null when slot index has no match',  result === null);
}

// ── T04: Fixed-slot takes priority ───────────────────────────────────────────
// If both a fixed-slot entry and a floating entry with the same label exist,
// the fixed-slot entry must win (it is more authoritative).
console.log('\n--- T04: fixed-slot entry takes priority over floating with same label ---');
{
    const floatingEntry = { ns_slot: null, abstraction: 'Sorter', token: 'float001' };
    const fixedEntry    = { ns_slot: 4,   abstraction: 'Sorter', token: 'fixed001' };
    const ctx = makeSandbox([floatingEntry, fixedEntry]);

    const result = vm.runInContext('_findSrcLump(4, "Sorter")', ctx);

    check('T04a: returns non-null',            result !== null);
    check('T04b: returns the fixed-slot entry', result === fixedEntry);
    check('T04c: floating entry not returned',  result !== floatingEntry);
}

// ── T05: Floating lump with ns_slot: undefined ────────────────────────────────
// The production guard treats undefined the same as null.  Both should allow
// the secondary label lookup to proceed.
console.log('\n--- T05: floating lump with ns_slot: undefined is found by label ---');
{
    const undefinedSlotEntry = { abstraction: 'Lambda', token: 'undef001' };
    // ns_slot is absent (undefined) — same as null for the guard
    const ctx = makeSandbox([undefinedSlotEntry]);

    const result = vm.runInContext('_findSrcLump(12, "Lambda")', ctx);

    check('T05a: returns non-null for undefined ns_slot with matching label', result !== null);
    check('T05b: returns the correct entry',                                  result === undefinedSlotEntry);
}

// ── T06: _lumpsCache undefined → null, no throw ───────────────────────────────
// If the cache has not been populated yet _findSrcLump must return null
// gracefully (no uncaught TypeError).
console.log('\n--- T06: _lumpsCache undefined → null without throwing ---');
{
    // Intentionally do NOT set _lumpsCache in the sandbox.
    const sandbox = {
        console,
        window: { _nsState: null },
        sim: { lumpTokenAtSlot() { return null; } },
    };
    const ctx = vm.createContext(sandbox);
    vm.runInContext(findSrcLumpSrc, ctx, { filename: 'app-memory.js' });

    let threw = false;
    let result;
    try {
        result = vm.runInContext('_findSrcLump(3, "Boot")', ctx);
    } catch (e) {
        threw = true;
    }

    check('T06a: _findSrcLump does not throw when _lumpsCache is undefined', !threw);
    check('T06b: returns null when _lumpsCache is undefined',                result === null);
}

// ── T08: newest compilation beats the committed slot token ───────────────────
console.log('\n--- T08: newest compilation beats committed slot token ---');
{
    const latest = {
        ns_slot: null, abstraction: 'CapabilityTest', token: 'dead0001',
        archived: true, lump_version: 24, compiled_at: '2026-09-09T12:00:00Z',
    };
    const committed = {
        ns_slot: null, abstraction: 'CapabilityTest', token: '4a00000a',
        lump_version: 99, compiled_at: '2026-09-08T12:00:00Z',
    };
    const ctx = makeSandbox([latest, committed]);
    ctx.window._nsState = {
        abstractions: [{ slot: 10, name: 'CapabilityTest', token: '4A00000A' }],
    };
    const result = vm.runInContext('_findSrcLump(10, "CapabilityTest")', ctx);
    check('T08a: most recently compiled artifact is returned', result === latest);
    check('T08b: higher version does not override compilation time', result !== committed);
    check('T08c: resident popup fetches the selected saved compilation',
        appMemorySource.includes('hdr && hdr.valid && !(_preferredSource && _preferredSource.token)') &&
        appMemorySource.includes('(latest compilation \\u2014 fetched from server)'));
}

// ── T10: invalid newest compilation remains visible as a programmer fault ─────
console.log('\n--- T10: newest invalid artifact is selected and surfaced as a fault ---');
{
    const invalidNewest = {
        ns_slot: null, abstraction: 'CapabilityTest', token: 'b6182a95',
        compiled_at: '2026-09-09T15:20:41Z', binary_valid: false,
        validation_errors: ['bootstrap SELF GT differs from owning Namespace descriptor'],
    };
    const validPrevious = {
        ns_slot: null, abstraction: 'CapabilityTest', token: 'c1972022',
        compiled_at: '2026-09-08T20:12:27Z', binary_valid: true,
    };
    const ctx = makeSandbox([invalidNewest, validPrevious]);
    ctx.window._nsState = {
        abstractions: [{ slot: 10, name: 'CapabilityTest', token: 'b6182a95' }],
    };
    const result = vm.runInContext('_findSrcLump(10, "CapabilityTest")', ctx);
    check('T10a: invalid newest artifact remains selected', result === invalidNewest);
    check('T10b: popup labels invalid saved artifact as an actionable FAULT',
        appMemorySource.includes('FAULT \\u2014 INVALID SAVED LUMP') &&
        appMemorySource.includes('Open code error in Editor') &&
        appMemorySource.includes('C-List row 0 contains a SELF authority') &&
        appLumpsSource.includes('/diagnostic-source'));
}

// ── T09: missing cache metadata still preserves committed token ──────────────
console.log('\n--- T09: committed token survives before cache warmup ---');
{
    const ctx = makeSandbox([]);
    ctx.window._nsState = {
        abstractions: [{ slot: 10, name: 'CapabilityTest', token: '4a00000a' }],
    };
    const result = vm.runInContext('_findSrcLump(10, "CapabilityTest")', ctx);
    check('T09a: returns a token-bearing binding before cache warmup',
        result && result.token === '4a00000a');
    check('T09b: preserves the committed abstraction name',
        result && result.abstraction === 'CapabilityTest');
}

// ── T07: Floating lump not matched when slotLabel is null ────────────────────
// The secondary lookup requires a truthy slotLabel.  If the caller passes null
// (slot has no label), the floating lump must NOT be returned — returning it
// would incorrectly show a Source button on every unlabelled slot.
console.log('\n--- T07: floating lump not matched when slotLabel is null ---');
{
    const floatingEntry = { ns_slot: null, abstraction: 'Math', token: 'float007' };
    const ctx = makeSandbox([floatingEntry]);

    const resultNull      = vm.runInContext('_findSrcLump(3, null)',      ctx);
    const resultUndefined = vm.runInContext('_findSrcLump(3, undefined)', ctx);
    const resultEmpty     = vm.runInContext('_findSrcLump(3, "")',        ctx);

    check('T07a: null slotLabel → no match',      resultNull      === null);
    check('T07b: undefined slotLabel → no match', resultUndefined === null);
    check('T07c: empty string slotLabel → no match', resultEmpty  === null);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`floating-lump-source results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
