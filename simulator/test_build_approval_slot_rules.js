/**
 * Regression tests for the Build Approval per-slot rule selector.
 *
 * Run: node simulator/test_build_approval_slot_rules.js
 *
 * Covers:
 *   - every Namespace row renders a programmer-selectable rule
 *     plus the single LightningBolt boot-entry role;
 *   - architecture rows are not disabled or silently forced by the IDE;
 *   - selecting LightningBolt moves the one boot-entry role;
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
    { slot: 6, name: 'SelfTest', load_policy: 'Lazy', slot_rule: 'Lazy', checks: [] },
    {
        slot: 10,
        name: 'CapabilityTest',
        load_policy: 'Resident',
        slot_rule: 'LightningBolt',
        location: '0x000003C0',
        size_budget: { total: { words: 64 } },
        checks: [],
    },
];
view._lastMap = { boot_entry_slot: 10, slot_rules: rows };

const editable = view._renderRow(rows[2]);
for (const value of ['Bootstrap', 'Hardware', 'Empty', 'Resident', 'Preload', 'Lazy', 'LightningBolt']) {
    assert(
        editable.includes(`value="${value}"`),
        `editable slot must offer ${value}`);
}
assert(editable.includes('aria-label="Slot rule for NS slot 6"'));

const activeBoot = view._renderRow(rows[3]);
assert(activeBoot.includes('value="LightningBolt" selected'));
assert(!activeBoot.includes('⚡ boot entry'));
assert(activeBoot.includes('value="LightningBolt"'));

const generatedThread = view._renderRow({
    slot: 11,
    name: 'Thread#2',
    token: null,
    header_word: '0xF900820C',
    cw: 32,
    cc: 12,
    location: '0x000005C0',
    perms: [],
    source: 'generated Thread body (boot image)',
    load_policy: 'Lazy',
    size_budget: {
        available: true,
        metadata: 'generated Thread body',
        sections: [
            { label: 'Header', words: 1 },
            { label: 'Heap', words: 194 },
            { label: 'Capability homes', words: 12 },
        ],
        total: { words: 256 },
        allocation: { words: 256 },
    },
    checks: [],
});
assert(generatedThread.includes('Thread#2'));
assert(generatedThread.includes('N/A'),
    'generated Thread must not invent a token or permissions');
assert(generatedThread.includes('Header 1w'));
assert(generatedThread.includes('Total 256w / alloc 256w'));

const mBit = view._renderRow({
    slot: 13,
    name: 'M_BIT_DEV',
    token: null,
    header_word: null,
    cw: null,
    cc: null,
    location: '0xFFFFFF1C',
    perms: ['R', 'W'],
    source: 'hardware/namespace register',
    load_policy: 'Hardware',
    size_budget: {
        available: false,
        reason: 'N/A — M-bit Namespace register (1 word)',
    },
    checks: [],
});
assert(mBit.includes('M_BIT_DEV'));
assert(mBit.includes('R+W'));
assert(mBit.includes('N/A — M-bit Namespace register'));

const fixedBootstrap = view._renderRow(rows[0]);
assert(fixedBootstrap.includes('value="Bootstrap"'));
assert(fixedBootstrap.includes('value="LightningBolt"'));
assert(!fixedBootstrap.includes('<select disabled'));

let posted = [];
let currentConfig = {
    targetBoard: 'wukong-xc7a100t',
    bootEntrySlot: 6,
    step1: {
        totalNamespaceWords: 16384,
        namespaceLumpWords: 64,
        threadLumpWords: 256,
    },
    step2: { lumps: [] },
    slotRules: {},
    step3: { emptySlotCount: 0 },
};
context.fetch = async (url, options) => {
    if (url === '/api/boot-config' && !options) {
        return {
            ok: true,
            async json() {
                return { config: JSON.parse(JSON.stringify(currentConfig)) };
            },
        };
    }
    assert.strictEqual(url, '/api/boot-config');
    const body = JSON.parse(options.body);
    posted.push(body);
    currentConfig = body;
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
    assert.strictEqual(posted[0].slotRules['10'], 'LightningBolt');
    assert.deepStrictEqual(posted[0].step2.lumps, [],
        'LightningBolt must not be persisted as a load-policy row');

    const moveSelect = { dataset: { previousValue: 'LightningBolt' }, value: 'LightningBolt', disabled: false };
    await view._changeSlotRule(6, 'LightningBolt', moveSelect);
    assert.strictEqual(posted[1].bootEntrySlot, 6);
    assert.strictEqual(posted[1].slotRules['6'], 'LightningBolt');
    assert.strictEqual(posted[1].slotRules['10'], 'Resident',
        'moving LightningBolt must restore the previous slot rule');

    const residentSelect = { dataset: { previousValue: 'LightningBolt' }, value: 'Resident', disabled: false };
    await view._changeSlotRule(10, 'Resident', residentSelect);
    const saved = posted[2].step2.lumps.find(row => row.nsSlot === 10);
    assert(saved, 'load-policy selection must create/update the slot row');
    assert.strictEqual(saved.loadPolicy, 'Resident');
    assert.strictEqual(posted[2].bootEntrySlot, 6,
        'changing a load policy must not silently change LightningBolt');
    assert.strictEqual(saved.physAddr, 0x3c0);
    assert.strictEqual(saved.lumpSize, 64);

    console.log('PASS build approval slot rule selector tests');
})().catch(error => {
    console.error('FAIL build approval slot rule selector tests:', error);
    process.exitCode = 1;
});