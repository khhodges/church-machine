/**
 * Regression tests for the Build Approval per-slot rule selector.
 *
 * Run: node simulator/test_build_approval_slot_rules.js
 *
 * Covers:
 *   - every Namespace row renders a programmer-selectable rule
 *     plus the single Starter boot-entry role;
 *   - architecture rows are not disabled or silently forced by the IDE;
 *   - selecting Starter moves the one boot-entry role;
 *   - selecting a load policy persists step2 without creating an independent
 *     Starter/load-policy conflict.
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
        location: '0x000003C0',
        size_budget: { total: { words: 64 } },
        checks: [],
    },
];
view._lastMap = { boot_entry_slot: 10, slot_rules: rows };

const editable = view._renderRow(rows[2]);
for (const value of ['Bootstrap', 'Hardware', 'Empty', 'Resident', 'Preload', 'Lazy', 'Starter']) {
    assert(
        editable.includes(`value="${value}"`),
        `editable slot must offer ${value}`);
}
assert(editable.includes('aria-label="Slot rule for NS slot 6"'));

const activeBoot = view._renderRow(rows[3]);
assert(activeBoot.includes('value="Starter" selected'));
assert(!activeBoot.includes('LightningBolt'));
assert(!activeBoot.includes('⚡ boot entry'));

const explicitBootFallback = view._renderRow({
    ...rows[3],
    slot_rule: 'LightningBolt',
});
assert(explicitBootFallback.includes('value="Starter" selected'));
assert(!explicitBootFallback.includes('LightningBolt'));

const generatedThread = view._renderRow({
    slot: 11,
    name: 'Thread#2',
    token: null,
    header_word: '0xF900820C',
    cw: 32,
    cc: 12,
    location: '0x000005C0',
    perms: ['NONE'],
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
assert(generatedThread.includes('NONE'),
    'generated Thread permissions must be NONE');
assert(generatedThread.includes('Header 1w'));
assert(generatedThread.includes('Total 256w / alloc 256w'));

const mBit = view._renderRow({
    slot: 13,
    name: 'M_BIT_DEV',
    token: null,
    header_word: 'MMIO',
    cw: null,
    cc: null,
    location: '0xFFFFFF1C',
    perms: ['R', 'W'],
    source: 'hardware/namespace register',
    load_policy: 'Hardware',
    slot_rule: 'Hardware',
    runtime_m_bits: 0xFFFF,
    size_budget: {
        available: false,
        reason: 'N/A — hardware register (1 word)',
    },
    checks: [{ label: 'MMIO', ok: true, detail: 'MMIO at 0xFFFFFF1C' }],
});
assert(mBit.includes('M_BIT_DEV'));
assert(mBit.includes('R+W'));
assert(mBit.includes('>MMIO</code>'));
assert(mBit.includes('N/A — hardware register'));
assert(mBit.includes('value="Hardware" selected'));
assert(!mBit.includes('65535'),
    'Namespace approval must not display the current M-bit register value');

const normalizedMBit = view._normalizeRow({
    slot: 13,
    name: 'M_BIT_DEV',
    header_word: 'MMIO',
    location: '0xFFFFFF1C',
    perms: ['R', 'W'],
    source: 'boot ROM hardware register',
    load_policy: 'Hardware',
    checks: [],
});
for (const field of [
    'slot', 'name', 'token', 'header_word', 'cw', 'cc', 'location',
    'words', 'limit', 'load_policy', 'slot_rule', 'perms', 'source',
    'programmable', 'checks', 'size_budget',
]) {
    assert(Object.prototype.hasOwnProperty.call(normalizedMBit, field),
        `normalized approval row must include ${field}`);
}
assert.strictEqual(normalizedMBit.runtime_m_bits, undefined);

const columnCounts = [rows[0], rows[2], rows[3], { ...normalizedMBit }]
    .map(row => (view._renderRow(row).match(/<td\b/g) || []).length);
assert.deepStrictEqual(new Set(columnCounts), new Set([12]),
    'every Namespace approval row must render the same columns');

const fixedBootstrap = view._renderRow(rows[0]);
assert(fixedBootstrap.includes('value="Bootstrap"'));
assert(fixedBootstrap.includes('value="Starter"'));
assert(!fixedBootstrap.includes('<select disabled'));

const validApprovalPayload = {
    slot_rules: rows.map(row => ({
        slot: row.slot,
        name: row.name,
        token: null,
        header_word: null,
        cw: null,
        cc: null,
        location: null,
        words: null,
        limit: null,
        load_policy: row.load_policy,
        slot_rule: null,
        perms: [],
        source: 'test',
        programmable: false,
        size_budget: null,
        checks: [],
    })),
};
assert.strictEqual(
    view._validateApprovalPayload(validApprovalPayload),
    validApprovalPayload,
    'a payload matching the documented row contract must be accepted');

for (const [label, mutate, expected] of [
    [
        'missing field',
        payload => { delete payload.slot_rules[0].checks; },
        'missing checks',
    ],
    [
        'unexpected runtime field',
        payload => { payload.slot_rules[0].runtime_m_bits = 0xFFFF; },
        'unexpected runtime_m_bits',
    ],
    [
        'invalid checks collection',
        payload => { payload.slot_rules[0].checks = null; },
        'perms and checks arrays',
    ],
]) {
    const malformed = JSON.parse(JSON.stringify(validApprovalPayload));
    mutate(malformed);
    assert.throws(
        () => view._validateApprovalPayload(malformed),
        error => error.code === 'BUILD_APPROVAL_CONTRACT' &&
            error.message.includes(expected),
        `${label} approval payload must be rejected`);
}

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
const realRefresh = view.refresh;

(async () => {
    let mapBody = { innerHTML: '' };
    let approveButton = { disabled: false };
    context.document.getElementById = id => {
        if (id === 'baMapBody') return mapBody;
        if (id === 'baApproveBtn') return approveButton;
        return null;
    };
    view._lastMap = { slot_rules: rows };
    context.fetch = async url => {
        assert.strictEqual(url, '/api/build-approval/ns-map');
        return {
            ok: true,
            status: 200,
            async json() {
                const malformed = JSON.parse(JSON.stringify(validApprovalPayload));
                delete malformed.slot_rules[0].checks;
                return malformed;
            },
        };
    };
    await realRefresh.call(view, false);
    assert(mapBody.innerHTML.includes('Build Approval data is malformed'));
    assert(mapBody.innerHTML.includes('Refresh'));
    assert.strictEqual(view._lastMap, null,
        'malformed approval data must clear the stale actionable map');
    assert.strictEqual(approveButton.disabled, true,
        'malformed approval data must keep Build disabled');

    view._lastMap = { boot_entry_slot: 10, slot_rules: rows };
    view.refresh = async () => {};
    view._inFlight = false;
    mapBody = { innerHTML: '' };
    approveButton = { disabled: true };
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

    const select = { dataset: { previousValue: 'Lazy' }, value: 'Starter', disabled: false };
    await view._changeSlotRule(10, 'Starter', select);
    assert.strictEqual(posted[0].bootEntrySlot, 10);
    assert.strictEqual(posted[0].slotRules['10'], 'LightningBolt');
    assert.deepStrictEqual(posted[0].step2.lumps, [],
        'LightningBolt must not be persisted as a load-policy row');

    const moveSelect = { dataset: { previousValue: 'Lazy' }, value: 'Starter', disabled: false };
    await view._changeSlotRule(6, 'Starter', moveSelect);
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

    view._lastMap = {
        slot_rules: [{
            slot: 13,
            name: 'M_BIT_DEV',
            load_policy: 'Hardware',
            checks: [{ label: 'MMIO', ok: true }],
        }],
    };
    assert(view._allChecksPass(),
        'M_BIT_DEV must participate in the approval result');
    view._lastMap.slot_rules[0].checks[0].ok = false;
    assert(!view._allChecksPass(),
        'M_BIT_DEV approval failures must block the approval result');

    console.log('PASS build approval slot rule selector tests');
})().catch(error => {
    console.error('FAIL build approval slot rule selector tests:', error);
    process.exitCode = 1;
});