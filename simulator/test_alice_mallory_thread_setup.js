'use strict';

// Isolated setup-only fixture. No CHANGE, CALL, Step, or user workload runs.
// The two CHURCH root frames are retained from canonical boot: until separate
// driver code is installed, they still enter the default boot abstraction.
const inNode = typeof module !== 'undefined' && !!module.exports;
const assert = inNode ? require('assert') : (() => {
    const check = (condition, message) => {
        if (!condition) throw new Error(message || 'Fixture assertion failed');
    };
    check.strictEqual = (actual, expected, message) => check(actual === expected, message);
    check.notStrictEqual = (actual, expected, message) => check(actual !== expected, message);
    check.deepStrictEqual = (actual, expected, message) =>
        check(JSON.stringify(actual) === JSON.stringify(expected), message);
    return check;
})();
const fs = inNode ? require('fs') : null;
const path = inNode ? require('path') : null;
if (inNode) {
    global.window = { bootConfig: { step1: {
        totalNamespaceWords: 16384, namespaceLumpWords: 64,
        threadLumpWords: 512, threadCount: 3,
    } } };
}
const FixtureSimulator = inNode ? require('./simulator.js') : ChurchSimulator;
const FixtureThreadDesign = inNode ? require('./thread_design.js') : ThreadDesign;

const ROOT = inNode ? path.resolve(__dirname, '..') : null;
const manifest = inNode ? JSON.parse(fs.readFileSync(
    path.join(ROOT, 'server/lumps/manifest.json'), 'utf8')) : null;
const hex = word => `0x${(word >>> 0).toString(16).padStart(8, '0')}`;

// Fixture-only executable resident; the saved role LUMPs remain untouched.
function installThreadDriver(sim, slot, base, code, label, extraCapabilities = []) {
    assert(!sim.readNSEntry(slot), `${label} slot must be unused`);
    const cc = 1 + extraCapabilities.length;
    const words = Array(64).fill(0);
    words[0] = sim.packLumpHeader(0, code.length, cc, 0);
    code.forEach((word, i) => { words[1 + i] = word; });
    words[64 - cc] = FixtureSimulator.SELF_CAPABILITY_PLACEHOLDER;
    extraCapabilities.forEach((gt, i) => { words[65 - cc + i] = gt; });
    const header = sim.parseLumpHeader(words[0]);
    assert(header.valid && header.typ === 0 && header.cc === cc &&
        header.cw === code.length && header.lumpSize === words.length,
    `${label} executable header must be valid`);
    assert(base + words.length <= sim.NS_TABLE_BASE &&
        sim.memory.slice(base, base + words.length).every(word => word === 0),
    `${label} must occupy empty fixture-only RAM`);
    const free = sim.mintStep7Freespace(words, header);
    assert(free.ok, `${label} invalid freespace: ${free.code || free.detail}`);
    const minted = sim._mintOrdinaryLumpIdentity(words, slot, base,
        {compilerOwnedSelf: true});
    assert(minted.ok, `${label} identity: ${minted.message}`);
    sim.memory.set(minted.words, base);
    sim.withNamespaceWrite('isolated Thread driver fixture', () => {
        sim.writeNSEntry(slot, base, header.cw, 0, 0, 1,
            minted.entry.seq, header.cc, minted.entry.cacheToken);
    });
    assert.strictEqual(sim.memory[base + 64 - cc], minted.selfGT,
        `${label} c-list row 0 is minted SELF Enter GT`);
    extraCapabilities.forEach((gt, i) => {
        assert.strictEqual(sim.memory[base + 65 - cc + i], gt,
            `${label} c-list row ${i + 1} is the supplied authority`);
    });
    assert.strictEqual(sim.mLoad(minted.selfGT, 'E', 14).ok, true,
        `${label} Enter authority resolves`);
    return {slot, base, gt: minted.selfGT, header};
}

function binaryFor(name, binaries) {
    if (binaries) {
        const words = binaries[name];
        assert(Array.isArray(words) && words.length > 0,
            `${name} requires saved binary words`);
        return words.slice();
    }
    assert(inNode, `${name} requires saved binary words`);
    const records = manifest.filter(item => item.abstraction === name && !item.archived);
    assert.strictEqual(records.length, 1, `expected exactly one saved ${name} binary`);
    const raw = fs.readFileSync(path.join(ROOT, 'server/lumps', records[0].filename));
    assert.strictEqual(raw.length % 4, 0, `${name} must have complete words`);
    return Array.from({length: raw.length / 4}, (_, i) => raw.readUInt32BE(i * 4));
}

function createAliceMalloryThreadFixture(verbose = false, binaries = null) {
const roles = [
    { name: 'Alice', abstraction: 'ide.Alice', slot: 30, sentinel: 0xA11CE002 },
    { name: 'Mallory', abstraction: 'ide.Mallory', slot: 31, sentinel: 0x0BAD0003 },
];
const sim = new FixtureSimulator();
for (let safety = 0; !sim.bootComplete && !sim.halted && safety < 32; safety++) {
    sim._bootStep();
}
assert(sim.bootComplete && !sim.halted, 'canonical boot must finish without a fault');
const threadSlots = sim.configuredThreadSlots();
assert.deepStrictEqual(threadSlots, [1, 11, 12],
    'three Thread objects must exist in canonical Namespace order');
assert.strictEqual(sim._currentThreadSlot, threadSlots[0], 'Boot.Thread must own live banks');
assert.strictEqual(sim._liveThreadOwned, true, 'Boot.Thread must be the live owner');
const bootCR12 = {...sim.cr[12]};
const bootCR14 = {...sim.cr[14]};
const bootPC = sim.pc;
const bootSTO = sim.sto;
const bootDR = [...sim.dr];
const bootCR1 = {...sim.cr[1]};
const bodies = threadSlots.map(slot => {
    const entry = sim.readNSEntry(slot);
    assert(entry, `Thread Namespace slot ${slot} is absent`);
    const base = entry.word0_location >>> 0;
    const header = sim.parseLumpHeader(sim.memory[base] >>> 0);
    const layout = sim._threadLayoutAtBase(base);
    assert(header.valid && header.typ === FixtureThreadDesign.header.typ &&
        header.cc === FixtureThreadDesign.capabilityHomes.words && layout && layout.valid,
    `Thread slot ${slot} must have canonical geometry`);
    return { slot, base, layout };
});
for (const left of bodies) {
    for (const right of bodies) {
        if (left === right) continue;
        assert(left.base + left.layout.lumpSize <= right.base ||
            right.base + right.layout.lumpSize <= left.base,
        `Thread slots ${left.slot}/${right.slot} overlap`);
    }
}

// Allocate two private fixture residents outside all resident bodies. The
// identity minter binds each saved compiler-owned binary to its actual slot
// and resolves its declared private-data row without changing the saved file.
let nextBase = Math.max(...bodies.map(({base, layout}) => base + layout.lumpSize));
for (const role of roles) {
    const words = binaryFor(role.abstraction, binaries);
    const hdr = sim.parseLumpHeader(words[0]);
    assert(hdr.valid && hdr.typ === 0 && hdr.cw > 0 && hdr.cc >= 2 &&
        words.length === hdr.lumpSize, `${role.abstraction} saved executable is invalid`);
    const base = nextBase;
    nextBase += hdr.lumpSize;
    assert(nextBase <= sim.NS_TABLE_BASE, 'fixture resident allocation exceeds RAM');
    assert(!sim.readNSEntry(role.slot), `fixture slot ${role.slot} is already occupied`);
    assert(sim.memory.slice(base, nextBase).every(word => word === 0),
        `${role.abstraction} fixture allocation is not empty`);
    const free = sim.mintStep7Freespace(words, hdr);
    assert(free.ok, `${role.abstraction} freespace invalid: ${free.code || free.detail}`);
    const minted = sim._mintOrdinaryLumpIdentity(words, role.slot, base, {
        compilerOwnedSelf: true, privateDataRows: [1],
    });
    assert(minted.ok, `${role.abstraction} identity invalid: ${minted.message}`);
    sim.memory.set(minted.words, base);
    sim.withNamespaceWrite('isolated Alice/Mallory setup fixture', () => {
        sim.writeNSEntry(role.slot, base, hdr.cw, 0, 0, 1,
            minted.entry.seq, hdr.cc, minted.entry.cacheToken);
    });
    const entry = sim.readNSEntry(role.slot);
    assert.strictEqual(entry.word0_location, base, `${role.abstraction} resolved location`);
    assert.strictEqual(sim.memory[base + hdr.lumpSize - hdr.cc],
        minted.selfGT, `${role.abstraction} self capability`);
    role.base = base;
    role.gt = minted.selfGT;
}

for (const [index, role] of roles.entries()) {
    const {slot, base, layout} = bodies[index + 1];
    const cr1Home = base + layout.capsStart + 1;
    const dr1Home = base + layout.drStart + 1;
    assert(cr1Home <= base + layout.capsEnd && dr1Home <= base + layout.drEnd,
        `${role.name} homes must be inside its Thread body`);
    sim.memory[cr1Home] = role.gt;
    sim.memory[dr1Home] = role.sentinel;
    const cap = sim.parseGT(sim.memory[cr1Home] >>> 0);
    assert.strictEqual(cap.type, 1, `${role.name} CR1 must be Inform`);
    assert.strictEqual(cap.index, role.slot, `${role.name} CR1 must target its code slot`);
    assert.deepStrictEqual(
        [cap.permissions.R, cap.permissions.W, cap.permissions.X,
            cap.permissions.L, cap.permissions.S, cap.permissions.E],
        [0, 0, 0, 0, 0, 1], `${role.name} CR1 must carry only E`);
    const resolved = sim.mLoad(role.gt, 'E', 1);
    assert(resolved.ok && resolved.entry.word0_location === role.base,
        `${role.name} CR1 must resolve to saved ${role.abstraction} binary`);
    assert.strictEqual(sim.memory[dr1Home] >>> 0, role.sentinel,
        `${role.name} private DR1 must contain its sentinel`);
    const frame = sim._readThreadResumeFrame(base, layout, slot);
    assert(frame, `${role.name} must have a validated canonical CHURCH frame`);
    assert.strictEqual(frame.frame.returnPC, 0x7FFF,
        `${role.name} must retain the fresh root frame`);
    assert.strictEqual(frame.frame.savedSTO, layout.stackEnd,
        `${role.name} root frame must be at its stack end`);
    assert.notStrictEqual(frame.parsed.index, role.slot,
        `${role.name} root frame is not a dedicated test driver`);
    if (verbose) console.log(`[SETUP] Thread.${index + 2} (${role.name}) NS[${slot}] ` +
        `body=${hex(base)}..${hex(base + layout.lumpSize - 1)} ` +
        `CR1@${hex(cr1Home)}=${hex(role.gt)} -> ${role.abstraction} NS[${role.slot}] ` +
        `DR1@${hex(dr1Home)}=${hex(role.sentinel)} ` +
        `CHURCH=root/boot NS[${frame.parsed.index}]`);
}
assert.strictEqual(sim._currentThreadSlot, threadSlots[0], 'manager remains Boot.Thread');
assert.strictEqual(sim._liveThreadOwned, true, 'manager retains live ownership');
assert.deepStrictEqual(sim.cr[12], bootCR12, 'Boot.Thread identity unchanged');
assert.deepStrictEqual(sim.cr[14], bootCR14, 'Boot.Thread execution identity unchanged');
assert.deepStrictEqual(sim.cr[1], bootCR1, 'Boot.Thread live CR1 unchanged');
assert.deepStrictEqual(sim.dr, bootDR, 'Boot.Thread live data banks unchanged');
assert.strictEqual(sim.pc, bootPC, 'Boot.Thread PC unchanged');
assert.strictEqual(sim.sto, bootSTO, 'Boot.Thread STO unchanged');
assert.strictEqual(sim.faultLog.length, 0, 'fixture must not fault');
if (verbose) {
    console.log('[PASS] Boot.Thread remains manager; private Thread homes, ' +
        'nonoverlapping bodies, resolved E capabilities and root frames validated.');
    console.log('[NOT RUN] No CHANGE or method call. Dedicated Alice/Mallory drivers ' +
        'and manager return/report channels are not installed; root frames still enter boot code.');
}
return {sim, threadSlots, bodies, roles, nextBase};
}

if (inNode) {
    if (require.main === module) createAliceMalloryThreadFixture(true);
    module.exports = {createAliceMalloryThreadFixture, installThreadDriver};
} else {
    window.AliceMalloryThreadFixture = {createAliceMalloryThreadFixture, installThreadDriver};
}