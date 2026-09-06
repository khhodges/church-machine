/**
 * Regression tests for the Build Approval per-slot rule selector.
 *
 * Run: node simulator/test_build_approval_slot_rules.js
 *
 * Covers:
 *   - every editable Namespace row renders a select with all load policies
 *     plus the special LightningBolt boot-entry role;
 *   - architecture-fixed rows remain visibly fixed and disabled;
 *   - selecting LightningBolt persists only bootEntrySlot;
 *   - selecting a load policy persists step2 without creating an independent
 *     LightningBolt/load-policy conflict.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
    path.join(__dirname, 'app-build-approval.js'), 'utf8');

const context = {
    console,
    setInterval,
    clearInterval,
    document: {
        getElementById() { return null; },
    },
    sessionStorage: {
        getItem() { return ''; },
        setItem() {},
    },
    window: {},
    fetch: async () => { throw new Error('unexpected fetch'); },
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'app-build-approval.js' });
const view = vm.runInContext('BuildApprovalView', context);

const rows = [
    { slot: 0, name: 'Boot.NS', load_policy: 'Bootstrap', checks: [] },
    { slot: 2, name: 'UART_DEV', load_policy: 'Hardware', checks: [] },
    { slot: 6, name: 'SelfTest', load_policy: 'Lazy', checks: [] },
    {
        slot: 10,
        name: 'CapabilityTest',
        load_policy: 'Resident',
        location: '0x000003C0',
        size_budget: { total: { words: 64 } },
        checks: [],
    },
];
view._lastMap = { boot_entry_slot: 10, slot_rules: rows };

const editable = view._renderRow(rows[2]);
for (const value of ['Empty', 'Resident', 'Preload', 'Lazy', 'LightningBolt']) {
    assert(
        editable.includes(`value="${value}"`),
        `editable slot must offer ${value}`);
}
assert(editable.includes('aria-label="Slot rule for NS slot 6"'));

const activeBoot = view._renderRow(rows[3]);
assert(activeBoot.includes('value="LightningBolt" selected'));
assert(activeBoot.includes('LightningBolt (boot entry · Resident)'));

const fixedBootstrap = view._renderRow(rows[0]);
assert(fixedBootstrap.includes('value="Bootstrap"'));
assert(fixedBootstrap.includes('disabled'));
assert(!fixedBootstrap.includes('value="LightningBolt"'));

let posted = [];
context.fetch = async (url, options) => {
    if (url === '/api/boot-config' && !options) {
        return {
            ok: true,
            async json() {
                return {
                    config: {
                        targetBoard: 'wukong-xc7a100t',
                        bootEntrySlot: 6,
                        step1: {
                            totalNamespaceWords: 16384,
                            namespaceLumpWords: 64,
                            threadLumpWords: 256,
                        },
                        step2: { lumps: [] },
                        step3: { emptySlotCount: 0 },
                    },
                };
            },
        };
    }
    assert.strictEqual(url, '/api/boot-config');
    const body = JSON.parse(options.body);
    posted.push(body);
    return {
        ok: true,
        async json() { return { ok: true, config: body }; },
    };
};
view.refresh = async () => {};

(async () => {
    const select = { dataset: { previousValue: 'Lazy' }, value: 'LightningBolt', disabled: false };
    await view._changeSlotRule(10, 'LightningBolt', select);
    assert.strictEqual(posted[0].bootEntrySlot, 10);
    assert.deepStrictEqual(posted[0].step2.lumps, [],
        'LightningBolt must not be persisted as a load-policy row');

    const residentSelect = { dataset: { previousValue: 'LightningBolt' }, value: 'Resident', disabled: false };
    await view._changeSlotRule(10, 'Resident', residentSelect);
    const saved = posted[1].step2.lumps.find(row => row.nsSlot === 10);
    assert(saved, 'load-policy selection must create/update the slot row');
    assert.strictEqual(saved.loadPolicy, 'Resident');
    assert.strictEqual(posted[1].bootEntrySlot, 6,
        'changing a load policy must not silently change LightningBolt');
    assert.strictEqual(saved.physAddr, 0x3c0);
    assert.strictEqual(saved.lumpSize, 64);

    console.log('PASS build approval slot rule selector tests');
})().catch(error => {
    console.error('FAIL build approval slot rule selector tests:', error);
    process.exitCode = 1;
});