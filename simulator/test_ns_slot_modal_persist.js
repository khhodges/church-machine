'use strict';
// test_ns_slot_modal_persist.js — Regression test for Task #2728
//
// Confirms that the ADD modal pre-populates #_nsSlotPolicy and #_nsSlotInput
// correctly after a LUMP is installed with a specific static slot choice,
// covering both the same-session cache path and the post-reload fresh-fetch path.
//
// Logic under test lives in simulator/app-memory.js:
//   _nsSlotPolicyResolve  — overlay + defaults block in _nsPopulateAddMeta
//   _nsSlotPersistRecord  — PATCH-body / cache-write block in _nsTableAddConfirm
//
// Both helpers are exported via the NS_SLOT_PERSIST_UNIT_TEST_EXPORT marker so
// the test exercises the real production logic without any DOM or fetch dependency.
//
// Run:  node simulator/test_ns_slot_modal_persist.js
//
// Coverage:
//   T01 — Export marker is present in app-memory.js (structural guard)
//   T02 — confirm: static/slot=9 writes patchedPolicy='static', patchedSlot=9
//   T03 — confirm: dynamic writes patchedPolicy='dynamic', patchedSlot=null
//   T04 — cache path: persisted {static, 9} overrides stale server sidecar
//   T05 — fresh-fetch path: server sidecar {static, 9} is used when cache is empty
//   T06 — cache path: persisted values override server's dynamic/null defaults
//   T07 — legacy high slot from server is ignored without a saved choice
//   T08 — fresh-fetch path: server sidecar {dynamic, null} yields policy=dynamic, nsSlotVal=''
//   T09 — cache path: after dynamic install the modal shows policy=dynamic, no slot
//   T10 — resolve: sidecar with ns_slot=0 yields nsSlotVal='0' (falsy-zero guard)
//   T11 — resolve: sidecar with no ns_slot_policy and no slot defaults to dynamic
//   T12 — resolve: sidecar with no ns_slot_policy but slot present infers static

const fs   = require('fs');
const path = require('path');

// ── Counters ──────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function check(label, cond, extra) {
    if (cond) {
        console.log('PASS ' + label);
        pass++;
    } else {
        const detail = extra !== undefined ? '  got: ' + JSON.stringify(extra) : '';
        console.log('FAIL ' + label + detail);
        fail++;
    }
}

// ── Extract the unit-test export block from app-memory.js ─────────────────────
const srcPath = path.join(__dirname, 'app-memory.js');
const src = fs.readFileSync(srcPath, 'utf8');

// T01 — structural guard: export markers must be present
const MARKER_START = 'NS_SLOT_PERSIST_UNIT_TEST_EXPORT_START';
const MARKER_END   = 'NS_SLOT_PERSIST_UNIT_TEST_EXPORT_END';
check('T01 export markers present in app-memory.js',
    src.includes(MARKER_START) && src.includes(MARKER_END));

// Extract the block between the markers.
const startIdx = src.indexOf('/* ---- ' + MARKER_START);
const endIdx   = src.indexOf(MARKER_END + ' ---- */');
if (startIdx === -1 || endIdx === -1) {
    console.error('FATAL: export marker block not found — cannot continue.');
    process.exit(1);
}
const block = src.slice(startIdx, endIdx + MARKER_END.length + ' ---- */'.length);

// Instantiate the two pure helpers.
let _nsSlotPolicyResolve, _nsSlotPersistRecord;
try {
    const mod = new Function(block + '\nreturn { _nsSlotPolicyResolve, _nsSlotPersistRecord };')();
    _nsSlotPolicyResolve = mod._nsSlotPolicyResolve;
    _nsSlotPersistRecord = mod._nsSlotPersistRecord;
} catch (e) {
    console.error('FATAL: failed to load helpers from marker block:', e.message);
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// _nsSlotPersistRecord — confirm side (PATCH body + cache write)
// ═══════════════════════════════════════════════════════════════════════════════

// T02 — static policy with slot 9 persists correctly
{
    const { patchedPolicy, patchedSlot } = _nsSlotPersistRecord('static', 9);
    check('T02 confirm static/9: patchedPolicy=static', patchedPolicy === 'static', patchedPolicy);
    check('T02 confirm static/9: patchedSlot=9',        patchedSlot   === 9,        patchedSlot);
}

// T03 — dynamic policy always writes null for the slot
{
    const { patchedPolicy, patchedSlot } = _nsSlotPersistRecord('dynamic', 9);
    check('T03 confirm dynamic: patchedPolicy=dynamic', patchedPolicy === 'dynamic', patchedPolicy);
    check('T03 confirm dynamic: patchedSlot=null',      patchedSlot   === null,      patchedSlot);
}

// ═══════════════════════════════════════════════════════════════════════════════
// _nsSlotPolicyResolve — cache path (same session)
// ═══════════════════════════════════════════════════════════════════════════════

// T04 — cache path: persisted {static, 9} overrides stale server sidecar
// Scenario: server still returns dynamic/null (not yet updated), but the browser
// cache has the fresh install record.  The modal must show static/9.
{
    const token = 'deadbeef';
    const serverSidecar = { token, ns_slot_policy: 'dynamic', ns_slot: null };
    const cache = { [token]: { ns_slot_policy: 'static', ns_slot: 9 } };
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T04 cache path: policy=static', policy    === 'static', policy);
    check('T04 cache path: nsSlotVal=9',  nsSlotVal === '9',      nsSlotVal);
}

// T05 — fresh-fetch path: server returns {static, 9}, cache is empty (page reload)
// Scenario: user reloaded the page, _nsPersistedSlotMeta is {}. The detail endpoint
// returns the sidecar updated by the previous PATCH.
{
    const token = 'deadbeef';
    const serverSidecar = { token, ns_slot_policy: 'static', ns_slot: 9 };
    const cache = {};
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T05 fresh-fetch path: policy=static', policy    === 'static', policy);
    check('T05 fresh-fetch path: nsSlotVal=9',   nsSlotVal === '9',      nsSlotVal);
}

// T06 — cache path overrides server dynamic/null with persisted static/9
{
    const token = 'aabbccdd';
    const serverSidecar = { token, ns_slot_policy: 'dynamic', ns_slot: null };
    const cache = { [token]: { ns_slot_policy: 'static', ns_slot: 9 } };
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T06 cache override policy=static', policy    === 'static', policy);
    check('T06 cache override nsSlotVal=9',  nsSlotVal === '9',      nsSlotVal);
}

// T07 — a legacy high slot must not become a modal default.
{
    const token = 'cafe1234';
    const serverSidecar = { token, ns_slot_policy: 'static', ns_slot: 15 };
    const cache = {};
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T07 legacy high slot: policy=dynamic', policy === 'dynamic', policy);
    check('T07 legacy high slot: nsSlotVal empty', nsSlotVal === '', nsSlotVal);
}

// ═══════════════════════════════════════════════════════════════════════════════
// _nsSlotPolicyResolve — fresh-fetch path (post-reload / no cache)
// ═══════════════════════════════════════════════════════════════════════════════

// T08 — server sidecar dynamic/null → policy=dynamic, nsSlotVal=''
{
    const token = 'deadbeef';
    const serverSidecar = { token, ns_slot_policy: 'dynamic', ns_slot: null };
    const cache = {};
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T08 server dynamic/null: policy=dynamic',  policy    === 'dynamic', policy);
    check('T08 server dynamic/null: nsSlotVal empty', nsSlotVal === '',         nsSlotVal);
}

// T09 — after a dynamic install, modal should show policy=dynamic, no slot
{
    const token = 'f00dface';
    // After dynamic install, _nsSlotPersistRecord returns { patchedPolicy:'dynamic', patchedSlot:null }
    const { patchedPolicy, patchedSlot } = _nsSlotPersistRecord('dynamic', 12);
    const cache = { [token]: { ns_slot_policy: patchedPolicy, ns_slot: patchedSlot } };
    const serverSidecar = { token };   // server not yet updated
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, cache);
    check('T09 dynamic install cache: policy=dynamic',  policy    === 'dynamic', policy);
    check('T09 dynamic install cache: nsSlotVal empty', nsSlotVal === '',         nsSlotVal);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

// T10 — ns_slot=0 must not be treated as falsy (falsy-zero guard)
{
    const token = 'zero0000';
    const serverSidecar = { token, ns_slot_policy: 'static', ns_slot: 0 };
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, {});
    check('T10 ns_slot=0 falsy guard: nsSlotVal=0',  nsSlotVal === '0',      nsSlotVal);
    check('T10 ns_slot=0 falsy guard: policy=static', policy    === 'static', policy);
}

// T11 — sidecar with no policy and no slot: defaults to dynamic
{
    const token = 'nochoice';
    const serverSidecar = { token };
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, {});
    check('T11 no policy/slot: policy=dynamic',  policy    === 'dynamic', policy);
    check('T11 no policy/slot: nsSlotVal empty', nsSlotVal === '',         nsSlotVal);
}

// T12 — sidecar has slot but no explicit policy: infer static from slot presence
{
    const token = 'slotonly';
    const serverSidecar = { token, ns_slot: 7 };  // no ns_slot_policy field
    const { nsSlotVal, policy } = _nsSlotPolicyResolve(serverSidecar, token, {});
    check('T12 slot only: nsSlotVal=7',       nsSlotVal === '7',      nsSlotVal);
    check('T12 slot only: policy inferred static', policy === 'static', policy);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + pass + ' passed, ' + fail + ' failed out of ' + (pass + fail) + ' checks');
process.exit(fail > 0 ? 1 : 0);
