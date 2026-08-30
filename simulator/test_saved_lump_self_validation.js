'use strict';

// Focused browser-loader regression for Task 2879.  Extract the saved-LUMP
// c-list gate from app-lumps.js so it is exercised with the same code the UI
// uses, without requiring a browser DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ChurchSimulator = require('./simulator.js');
const CapabilityTokens = require('./capability_tokens.js');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
    if (ok) { pass++; console.log(`PASS ${label}`); }
    else { fail++; console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

const appLumps = fs.readFileSync(path.join(__dirname, 'app-lumps.js'), 'utf8');
const start = appLumps.indexOf('function _validateSavedLumpClist(');
const end = appLumps.indexOf('\n// ── Load a saved LUMP binary', start);
if (start < 0 || end < 0) throw new Error('could not extract saved-LUMP c-list validator');
const sandbox = {
    ChurchSimulator,
    CapabilityTokens,
    _lumpsCache: [],
};
vm.createContext(sandbox);
vm.runInContext(appLumps.slice(start, end), sandbox);
const validateSavedLumpClist = sandbox._validateSavedLumpClist;
const validateLinkedPortableClist = sandbox._validateLinkedPortableClist;

function header(cw = 4, cc = 1) {
    return (((0x1F << 27) | ((cw & 0x1FFF) << 10) | (cc & 0xFF)) >>> 0);
}
function compilerSelfMeta(overrides = {}, metadata = {}) {
    return {
        capabilities: [{
            name: '__SELF__',
            slot: 0,
            compiler_owned_self: true,
            ...overrides,
        }],
        ...metadata,
    };
}
function compilerPrivateMeta(metadata = {}) {
    return {
        capabilities: [
            { name: '__SELF__', slot: 0, compiler_owned_self: true },
            { name: 'PRIVATE', slot: 1, role: 'private_data' },
        ],
        ...metadata,
    };
}

console.log('\n--- saved LUMP compiler self validation ---');
{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header();
    words[63] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    let caps;
    try {
        caps = validateSavedLumpClist(words, sim.parseLumpHeader(words[0]), compilerSelfMeta(), sim);
    } catch (err) {
        caps = err;
    }
    check('SLV-1: compiler placeholder self row bypasses dependency resolution',
        Array.isArray(caps) && caps.length === 1, String(caps));

    const targetSlot = 9;
    const loaded = sim.loadLumpBinary(words, targetSlot, {
        compilerOwnedSelf: true,
        remintCompilerOwnedSelf: true,
    });
    const nsBase = sim._nsSlotBase(targetSlot);
    const seq = sim.parseNSWord1(sim.memory[nsBase + 1] >>> 0).gtSeq;
    const expected = sim.createGT(seq, targetSlot, { E: 1 }, 1) >>> 0;
    check('SLV-2: validated saved compiler LUMP reaches loader and remints row 0',
        loaded === true && sim.memory[0x400 + 63] === expected,
        `loaded=${loaded} row0=0x${(sim.memory[0x400 + 63] >>> 0).toString(16)}`);
}

console.log('\n--- portable UI save/load ordering ---');
{
    const Binding = require('./portable_lump_binding.js');
    const sim = new ChurchSimulator();
    const H = 'a'.repeat(64);
    const I = 'b'.repeat(64);
    const words = new Array(64).fill(0);
    words[0] = header(1, 2);
    words[62] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    words[63] = 0; // canonical unresolved portable dependency row
    const contract = Binding.createContract('alice.Bank#7', [
        { name: '__SELF__', compiler_owned_self: true, rights: 'E', type: 'Inform' },
        { N: 'church.Buffer#2', T: '1234abcd', binary_hash: H,
            identity_hash: I, rights: 'RW', type: 'Outform', relocation_row: 1 },
    ]);
    const metadata = {
        capabilities: contract.dependencies,
        portableBinding: contract,
    };
    let preflight;
    try {
        preflight = validateSavedLumpClist(
            words, sim.parseLumpHeader(words[0]), metadata, sim);
    } catch (err) { preflight = err; }
    check('SLV-P1: UI preflight accepts unresolved zero portable row before binding',
        Array.isArray(preflight), String(preflight));
    const nonPlaceholder = words.slice();
    nonPlaceholder[63] = 0x1800002a;
    let placeholderError = '';
    try {
        validateSavedLumpClist(
            nonPlaceholder, sim.parseLumpHeader(nonPlaceholder[0]), metadata, sim);
    } catch (err) { placeholderError = String(err.message || err); }
    check('SLV-P1b: UI preflight rejects a supplied GT in a portable dependency row',
        /zero placeholder/.test(placeholderError), placeholderError);

    sim.registerSlotIdentity(42, {
        cacheToken: 0x1234abcd, dotName: 'church.Buffer', issueN: 2,
        identityHash: I, binaryHash: H, grants: ['R', 'W'], capabilityType: 2,
        authorized: true,
    }, { secure: true });
    sim.withNamespaceWrite('portable UI fixture', () => {
        sim.writeNSEntry(42, 0x200, 4, 0, 0, 2, 5, 0, 0x1234abcd);
    });
    let postLinkCalled = false;
    const loaded = sim.loadLumpBinary(words, 43, {
        portableBinding: contract,
        portableOwnerCandidate: {
            N: 'alice.Bank#7', binary_hash: 'c'.repeat(64),
            identity_hash: 'd'.repeat(64), verified: true,
        },
        validateLinkedWords(linkedWords, linkedHeader, bindings) {
            postLinkCalled = true;
            return validateLinkedPortableClist(
                linkedWords, linkedHeader, bindings, sim);
        },
    });
    const linked = sim.parseGT(sim.memory[0x400 + 63] >>> 0);
    check('SLV-P2: UI validates linked copy and preserves Turing RW/type',
        loaded && postLinkCalled && linked.index === 42 && linked.type === 2 &&
        linked.permissions.R === 1 && linked.permissions.W === 1 &&
        !linked.permissions.L && !linked.permissions.S && !linked.permissions.E,
        JSON.stringify(linked));
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header();
    words[63] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    let message = '';
    try {
        validateSavedLumpClist(words, sim.parseLumpHeader(words[0]),
            compilerSelfMeta({ name: 'NotSelf' }), sim);
    } catch (err) { message = String(err.message || err); }
    check('SLV-3: malformed compiler self metadata is rejected clearly',
        /exact __SELF__ c-list row 0/i.test(message), message);
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header();
    words[63] = 0x4A000077;
    let message = '';
    try {
        validateSavedLumpClist(words, sim.parseLumpHeader(words[0]), compilerSelfMeta(), sim);
    } catch (err) { message = String(err.message || err); }
    check('SLV-4: altered compiler self row is rejected before loading',
        /self row 0 must be/i.test(message), message);
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header();
    sim.writeNSEntry(6, 0x80, 4, 0, 0, 1, 4, 1, 0);
    words[63] = sim.createGT(4, 6, { E: 1 }, 1);
    let result;
    try {
        result = validateSavedLumpClist(
            words, sim.parseLumpHeader(words[0]),
            compilerSelfMeta({}, { sourceNsSlot: 6 }), sim
        );
    } catch (err) { result = err; }
    check('SLV-5: recorded source-slot self E-GT is accepted for trusted remint',
        Array.isArray(result) && result.length === 1, String(result));
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header();
    sim.writeNSEntry(6, 0x80, 4, 0, 0, 1, 4, 1, 0);
    words[63] = sim.createGT(3, 6, { E: 1 }, 1);
    let message = '';
    try {
        validateSavedLumpClist(
            words, sim.parseLumpHeader(words[0]),
            compilerSelfMeta({}, { sourceNsSlot: 6 }), sim
        );
    } catch (err) { message = String(err.message || err); }
    check('SLV-6: stale-sequence source self E-GT is rejected before remint',
        /self row 0 must be/i.test(message), message);
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header(4, 2);
    words[62] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    words[63] = ChurchSimulator.PRIVATE_DATA_CAPABILITY_PLACEHOLDER;
    let caps;
    try {
        caps = validateSavedLumpClist(
            words, sim.parseLumpHeader(words[0]), compilerPrivateMeta(), sim);
    } catch (err) { caps = err; }
    const loaded = Array.isArray(caps) && sim.loadLumpBinary(words, 9, {
        compilerOwnedSelf: true,
        privateDataRows: [1],
    });
    const nsBase = sim._nsSlotBase(9);
    const seq = sim.parseNSWord1(sim.memory[nsBase + 1] >>> 0).gtSeq;
    const expectedPrivate = sim.createGT(seq, 9, { R: 1, W: 1 }, 1) >>> 0;
    check('SLV-7: declared private row 1 validates and remints to destination RW GT',
        loaded === true && sim.memory[0x400 + 63] === expectedPrivate,
        String(caps));
}

{
    const sim = new ChurchSimulator();
    const words = new Array(64).fill(0);
    words[0] = header(4, 3);
    words[61] = ChurchSimulator.SELF_CAPABILITY_PLACEHOLDER;
    words[63] = ChurchSimulator.PRIVATE_DATA_CAPABILITY_PLACEHOLDER;
    const metadata = compilerPrivateMeta();
    metadata.capabilities.splice(1, 0, { name: 'OTHER', slot: 1, token: 0 });
    metadata.capabilities[2].slot = 2;
    let message = '';
    try {
        validateSavedLumpClist(words, sim.parseLumpHeader(words[0]), metadata, sim);
    } catch (err) { message = String(err.message || err); }
    check('SLV-8: browser loader rejects private-data declarations outside row 1',
        /exact compiler-owned c-list row 1/i.test(message), message);
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);