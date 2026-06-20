'use strict';
// simulator/test_event_router.js — Smoke tests for EventRouter (NS slot 52)
//
// Verifies that:
//   ER01 — NS slot 52 is registered and labelled 'EventRouter'
//   ER02 — EventRouter.Add dispatches without fault; DR0=0 on success
//   ER03 — EventRouter.Resolve returns the handlerGT just registered
//   ER04 — EventRouter.List returns 1 after one Add
//   ER05 — EventRouter.Remove returns DR0=0 on success
//   ER06 — EventRouter.List returns 0 after Remove
//   ER07 — EventRouter.Resolve returns 0 for unregistered event
//   ER08 — EventRouter.Methods returns 5
//   ER09 — Add is idempotent (overwrite existing event GT)
//   ER10 — Add with NULL eventGT returns DR0=1 (rejected)
//
// Run:  node simulator/test_event_router.js

const ChurchSimulator    = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions  = require('./system_abstractions.js');

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

function makeTestSim() {
    const sim = new ChurchSimulator();
    const registry = new AbstractionRegistry();
    const sysAbs = new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    sim.bootComplete = true;
    return { sim, registry, sysAbs };
}

// ── ER01: NS slot 52 is registered ────────────────────────────────────────────
console.log('\n--- ER01: NS slot 52 registered ---');
{
    const { sim } = makeTestSim();
    const catalog = sim._getAbstractionCatalog();
    const entry = catalog[52];
    check('ER01a: catalog[52] is not null', entry != null);
    check('ER01b: label is EventRouter', entry && entry.label === 'EventRouter');
    check('ER01c: E permission granted', entry && entry.perms && entry.perms.E === 1);
}

// ── ER02: EventRouter.Add dispatches without fault ────────────────────────────
console.log('\n--- ER02: EventRouter.Add success ---');
{
    const { sim, registry } = makeTestSim();

    const EVENT_GT   = 0x48801234;  // synthetic event GT
    const HANDLER_GT = 0x48805678;  // synthetic handler GT

    const result = registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: HANDLER_GT });
    check('ER02a: result.ok is true', result && result.ok === true);
    check('ER02b: result.result === 0 (ok)',  result && result.result === 0);
    check('ER02c: message mentions "registered"', result && typeof result.message === 'string' && result.message.includes('registered'));
}

// ── ER03: EventRouter.Resolve returns registered handler ──────────────────────
console.log('\n--- ER03: EventRouter.Resolve ---');
{
    const { sim, registry } = makeTestSim();

    const EVENT_GT   = 0x48801111;
    const HANDLER_GT = 0x48802222;

    registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: HANDLER_GT });
    const result = registry.dispatchMethod(52, 'Resolve', sim, { dr0: EVENT_GT });
    check('ER03a: Resolve ok', result && result.ok === true);
    check('ER03b: Resolve returns HANDLER_GT', result && (result.result >>> 0) === HANDLER_GT);
}

// ── ER04: EventRouter.List returns 1 after one Add ────────────────────────────
console.log('\n--- ER04: EventRouter.List after one Add ---');
{
    const { sim, registry } = makeTestSim();

    registry.dispatchMethod(52, 'Add', sim, { dr0: 0x48801111, dr1: 0x48802222 });
    const result = registry.dispatchMethod(52, 'List', sim, {});
    check('ER04a: List ok', result && result.ok === true);
    check('ER04b: List === 1', result && result.result === 1);
}

// ── ER05: EventRouter.Remove returns 0 ────────────────────────────────────────
console.log('\n--- ER05: EventRouter.Remove ---');
{
    const { sim, registry } = makeTestSim();

    const EVENT_GT = 0x48803333;
    registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: 0x48804444 });
    const result = registry.dispatchMethod(52, 'Remove', sim, { dr0: EVENT_GT });
    check('ER05a: Remove ok', result && result.ok === true);
    check('ER05b: Remove returns 0 (success)', result && result.result === 0);
}

// ── ER06: EventRouter.List returns 0 after Remove ─────────────────────────────
console.log('\n--- ER06: EventRouter.List after Remove ---');
{
    const { sim, registry } = makeTestSim();

    const EVENT_GT = 0x48805555;
    registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: 0x48806666 });
    registry.dispatchMethod(52, 'Remove', sim, { dr0: EVENT_GT });
    const result = registry.dispatchMethod(52, 'List', sim, {});
    check('ER06a: List ok', result && result.ok === true);
    check('ER06b: List === 0 after Remove', result && result.result === 0);
}

// ── ER07: EventRouter.Resolve returns 0 for unregistered event ────────────────
console.log('\n--- ER07: Resolve unregistered event ---');
{
    const { sim, registry } = makeTestSim();

    const UNKNOWN_GT = 0x48809999;
    const result = registry.dispatchMethod(52, 'Resolve', sim, { dr0: UNKNOWN_GT });
    check('ER07a: Resolve ok', result && result.ok === true);
    check('ER07b: Resolve returns 0 for unknown event', result && result.result === 0);
}

// ── ER08: EventRouter.Methods returns 5 ───────────────────────────────────────
console.log('\n--- ER08: EventRouter.Methods ---');
{
    const { sim, registry } = makeTestSim();

    const result = registry.dispatchMethod(52, 'Methods', sim, {});
    check('ER08a: Methods ok', result && result.ok === true);
    check('ER08b: Methods returns 5', result && result.result === 5);
}

// ── ER09: Add is idempotent (update existing entry) ───────────────────────────
console.log('\n--- ER09: Add idempotent (overwrite) ---');
{
    const { sim, registry } = makeTestSim();

    const EVENT_GT    = 0x48807777;
    const HANDLER_GT1 = 0x48808888;
    const HANDLER_GT2 = 0x4880AAAA;

    registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: HANDLER_GT1 });
    const r2 = registry.dispatchMethod(52, 'Add', sim, { dr0: EVENT_GT, dr1: HANDLER_GT2 });
    check('ER09a: second Add ok', r2 && r2.ok === true);
    check('ER09b: second Add returns 0 (no error)', r2 && r2.result === 0);

    const r3 = registry.dispatchMethod(52, 'Resolve', sim, { dr0: EVENT_GT });
    check('ER09c: Resolve returns HANDLER_GT2 (updated)', r3 && (r3.result >>> 0) === HANDLER_GT2);

    const rList = registry.dispatchMethod(52, 'List', sim, {});
    check('ER09d: List still 1 after idempotent Add', rList && rList.result === 1);
}

// ── ER10: Add with NULL eventGT returns 1 (rejected) ─────────────────────────
console.log('\n--- ER10: Add NULL eventGT rejected ---');
{
    const { sim, registry } = makeTestSim();

    const result = registry.dispatchMethod(52, 'Add', sim, { dr0: 0, dr1: 0x48801234 });
    check('ER10a: Add ok=true (no crash)', result && result.ok === true);
    check('ER10b: Add returns 1 (rejected)', result && result.result === 1);

    const rList = registry.dispatchMethod(52, 'List', sim, {});
    check('ER10c: List still 0 after NULL rejection', rList && rList.result === 0);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`EventRouter smoke test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
