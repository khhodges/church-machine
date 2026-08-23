'use strict';

// Exact regression for the retired church_namespace browser snapshot and the
// shared first-free allocation policy.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ChurchSimulator = require('./simulator.js');
const AbstractionRegistry = require('./abstractions.js');
const SystemAbstractions = require('./system_abstractions.js');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
    if (condition) {
        console.log(`PASS ${label}`);
        passed++;
    } else {
        console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
        failed++;
    }
}

function extractTopLevelFunction(source, name) {
    const marker = `function ${name}(`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`${marker} not found`);
    let depth = 0;
    let sawBrace = false;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') {
            depth++;
            sawBrace = true;
        } else if (source[i] === '}') {
            depth--;
            if (sawBrace && depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`unterminated ${name}`);
}

function makeStorage(initial) {
    const values = new Map(Object.entries(initial || {}));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

function roguePayload() {
    const entries = new Array(48).fill(null);
    entries[45] = {
        nsWords: [0x1200, 0x0000003F, 0x11111111],
        label: 'SlideRule',
        dataWords: [0xAAA00001, 0xAAA00002]
    };
    entries[46] = {
        nsWords: [0x1300, 0x0000003F, 0x22222222],
        label: 'Constants',
        dataWords: [0xBBB00001, 0xBBB00002]
    };
    entries[47] = {
        nsWords: [0x1400, 0x0000003F, 0x33333333],
        label: 'AdaExample1',
        dataWords: [0xCCC00001, 0xCCC00002]
    };
    return entries;
}

function occupiedSlots(sim, max = 64) {
    const result = [];
    for (let slot = 0; slot < max; slot++) {
        if (sim.isNSEntryValid(slot)) result.push(slot);
    }
    return result;
}

const appRunSource = fs.readFileSync(path.join(__dirname, 'app-run.js'), 'utf8');
const loadNamespaceStateSource = extractTopLevelFunction(appRunSource, 'loadNamespaceState');

// Legacy migration is deletion-only and cannot mutate simulator state.
{
    const sim = new ChurchSimulator();
    const beforeSlots = occupiedSlots(sim);
    const beforeCount = sim.nsCount;
    const beforeRogueWords = [45, 46, 47].map(slot => {
        const base = sim._nsSlotBase(slot);
        return Array.from(sim.memory.slice(base, base + 4));
    });
    const storage = makeStorage({
        church_namespace: JSON.stringify(roguePayload())
    });
    const context = vm.createContext({ localStorage: storage, console });
    vm.runInContext(loadNamespaceStateSource, context);
    vm.runInContext('loadNamespaceState()', context);

    check('legacy church_namespace key is removed',
        storage.getItem('church_namespace') === null);
    check('legacy payload cannot extend nsCount', sim.nsCount === beforeCount,
        `before=${beforeCount}, after=${sim.nsCount}`);
    check('legacy payload cannot add occupied slots',
        JSON.stringify(occupiedSlots(sim)) === JSON.stringify(beforeSlots));
    check('legacy payload cannot write slots 45–47',
        [45, 46, 47].every((slot, index) => {
            const base = sim._nsSlotBase(slot);
            return Array.from(sim.memory.slice(base, base + 4))
                .every((word, wordIndex) => word === beforeRogueWords[index][wordIndex]);
        }));
    check('legacy payload cannot label slots 45–47',
        [45, 46, 47].every(slot =>
            !sim.nsLabels[slot] ||
            sim.nsLabels[slot] === '(free)' ||
            sim.nsLabels[slot] === '(reserved)'));

    // Reproduce sustained execution and a hard reset after migration. Neither
    // operation may materialize any of the browser-only rows.
    sim.bootComplete = true;
    sim.halted = false;
    for (let i = 0; i < 500; i++) sim.step();
    check('500 post-boot steps do not create rogue rows',
        [45, 46, 47].every(slot => !sim.isNSEntryValid(slot)));
    sim.reset();
    check('hard reset does not create rogue rows',
        [45, 46, 47].every(slot => !sim.isNSEntryValid(slot)));

    storage.setItem('church_namespace', JSON.stringify(roguePayload()));
    vm.runInContext('loadNamespaceState()', context);
    check('simulated page reload deletes a reintroduced legacy payload',
        storage.getItem('church_namespace') === null);
    check('simulated page reload still leaves rogue rows absent',
        [45, 46, 47].every(slot => !sim.isNSEntryValid(slot)));
}

// Every dynamic path shares the first-free user policy and reuses holes.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const first = sim.allocOrFindNsSlot('program-a', 'ProgramA');
    sim.writeNsEntryForProgram(first, { words: [1], caps: [], label: 'ProgramA' });
    const second = sim.allocOrFindNsSlot('program-b', 'ProgramB');
    sim.writeNsEntryForProgram(second, { words: [2], caps: [], label: 'ProgramB' });
    check('sequential program allocation starts at slots 11 and 12',
        first === 11 && second === 12, `first=${first}, second=${second}`);

    const registry = new AbstractionRegistry();
    new SystemAbstractions(registry);
    sim.abstractionRegistry = registry;
    const removed = registry.dispatchMethod(5, 'REMOVE', sim, { index: first });
    check('Navana.Remove opens a scoped write and frees slot 11',
        removed && removed.ok && !sim.isNSEntryValid(first));
    check('Navana.Remove preserves the bumped generation for reissue',
        sim._nsFreeSequences[first] === 1,
        `remembered=${sim._nsFreeSequences[first]}`);

    const reused = sim.allocOrFindNsSlot('program-c', 'ProgramC');
    check('allocator reuses freed slot 11', reused === 11, `reused=${reused}`);

    const navana = registry.dispatchMethod(5, 'ADD', sim, {
        location: 0x2200,
        limit: 63,
        gtType: 1,
        label: 'Minted'
    });
    check('Navana.ADD uses the first free slot rather than slot 45',
        navana && navana.ok && navana.result.nsIndex === 11,
        navana && navana.result ? `slot=${navana.result.nsIndex}` : JSON.stringify(navana));
    check('Navana.ADD reissues the remembered generation',
        navana && navana.ok && navana.result.version === 1,
        navana && navana.result ? `version=${navana.result.version}` : JSON.stringify(navana));

    const builtinBefore = Array.from(sim.memory.slice(
        sim._nsSlotBase(10), sim._nsSlotBase(10) + sim.NS_ENTRY_WORDS));
    const rejectedRemove = registry.dispatchMethod(5, 'REMOVE', sim, { index: 10 });
    const builtinAfter = Array.from(sim.memory.slice(
        sim._nsSlotBase(10), sim._nsSlotBase(10) + sim.NS_ENTRY_WORDS));
    check('Navana.Remove rejects built-in slots 0–10',
        rejectedRemove && rejectedRemove.ok === false &&
        builtinAfter.every((word, index) => word === builtinBefore[index]));

    const revoked = registry.dispatchMethod(6, 'Revoke', sim, { nsIndex: 11 });
    const revokedSeq = sim.parseNSWord1(
        sim.memory[sim._nsSlotBase(11) + 1] >>> 0).gtSeq;
    check('Mint.Revoke uses the scoped writer and bumps W1 gt_seq',
        revoked && revoked.ok && revoked.result === 2 && revokedSeq === 2,
        `result=${revoked && revoked.result}, seq=${revokedSeq}`);

    const staleGenerationTwoGT = sim.createGT(
        2, 11, { R: 0, W: 0, X: 1, L: 0, S: 0, E: 0 }, 1);
    const removedAgain = registry.dispatchMethod(5, 'REMOVE', sim, { index: 11 });
    const savedSlot = sim.saveToNamespace('SavedAfterClear', [0x18000000], null, 1, []);
    const savedSeq = sim.parseNSWord1(
        sim.memory[sim._nsSlotBase(savedSlot) + 1] >>> 0).gtSeq;
    const staleCheck = sim.mLoad(staleGenerationTwoGT, 'X', 0);
    check('Save to Namespace consumes the retained generation after slot reuse',
        removedAgain && removedAgain.ok && savedSlot === 11 && savedSeq === 3,
        `slot=${savedSlot}, seq=${savedSeq}`);
    check('a capability from before clear remains stale after normal Save reuse',
        staleCheck && staleCheck.ok === false && staleCheck.fault === 'VERSION',
        JSON.stringify(staleCheck));

    registry.dispatchMethod(5, 'REMOVE', sim, { index: 11 });
    sim.writeNsEntryForProgram(11, { words: [0x18000000], caps: [], label: 'CompiledAfterClear' });
    const compiledSeq = sim.parseNSWord1(
        sim.memory[sim._nsSlotBase(11) + 1] >>> 0).gtSeq;
    check('compiled-program reuse also consumes the retained generation',
        compiledSeq === 4, `seq=${compiledSeq}`);

    // Dynamic self-data aliases must use that same issued generation in both
    // their Namespace authority and the c-list GT that consumers LOAD through.
    const dataAliasSlot = 13;
    sim._nsFreeSequences[dataAliasSlot] = 5;
    sim.withNamespaceWrite('test lazy parent setup', () => {
        sim.writeNSEntry(20, 0x1000, 63, 0, 0, 1, 0, 1, 0);
    });
    sim.lazyManifest[20] = {
        label: 'AliasParent',
        priority: 'warm',
        source: 'test',
        size: 64,
        allocBase: 0x1000,
        loaded: false,
        bootUpload: {
            methods: [{ code: [0x18000000] }],
            data_words: [0xA5A5A5A5],
            capabilities: [{ type: 'self-data-R' }],
        },
    };
    const aliasLoaded = sim.lazyLoad(20);
    const aliasEntry = sim.readNSEntry(dataAliasSlot);
    const aliasSeq = sim.parseNSWord1(aliasEntry.word1_limit).gtSeq;
    const aliasGT = sim.memory[0x1000 + 63] >>> 0;
    const aliasParsed = sim.parseGT(aliasGT);
    const aliasLoad = sim.mLoad(aliasGT, 'R', 0, aliasEntry.word0_location);
    check('dynamic data alias uses its retained generation in NS and c-list GT',
        aliasLoaded && aliasSeq === 5 && aliasParsed.gt_seq === 5 &&
            aliasParsed.index === dataAliasSlot,
        `loaded=${aliasLoaded}, NS=${aliasSeq}, GT=${aliasParsed.gt_seq}, slot=${aliasParsed.index}`);
    check('reissued dynamic data alias remains loadable through its c-list GT',
        aliasLoad && aliasLoad.ok === true,
        JSON.stringify(aliasLoad));
}

// Explicit static placement remains available, but built-in slots are protected.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const slot = sim.saveToNamespaceAt(15, 'StaticProgram', [0x12345678], null, 1, []);
    check('explicit programmer-selected static slot remains supported',
        slot === 15 && sim.isNSEntryValid(15) && sim.nsLabels[15] === 'StaticProgram');
    let rejected = false;
    try {
        sim.saveToNamespaceAt(10, 'BuiltInOverwrite', [1], null, 1, []);
    } catch (_error) {
        rejected = true;
    }
    check('explicit placement cannot overwrite built-in slots 0–10', rejected);
}

// The hardened gate blocks unauthorized runtime writes and preserves memory.
{
    const sim = new ChurchSimulator();
    sim.bootComplete = true;
    const base = sim._nsSlotBase(20);
    const before = Array.from(sim.memory.slice(base, base + 4));
    let threw = false;
    try {
        sim.writeNSEntry(20, 0x2400, 63, 0, 0, 1, 0, 0, 0);
    } catch (error) {
        threw = /outside an allowed write window/.test(error.message);
    }
    const after = Array.from(sim.memory.slice(base, base + 4));
    check('unauthorized runtime Namespace write throws observably', threw);
    check('rejected Namespace write leaves all four words unchanged',
        after.every((word, index) => word === before[index]));
    let clearThrew = false;
    try {
        sim.clearNSEntry(20);
    } catch (error) {
        clearThrew = /outside an allowed write window/.test(error.message);
    }
    check('unauthorized runtime Namespace clear throws observably', clearThrew);

    for (const protectedSlot of [0, 10]) {
        const protectedBase = sim._nsSlotBase(protectedSlot);
        const protectedBefore = Array.from(
            sim.memory.slice(protectedBase, protectedBase + sim.NS_ENTRY_WORDS),
            word => word >>> 0);
        let protectedThrew = false;
        try {
            sim.withNamespaceWrite('forged built-in write', () => {
                sim.writeNSEntry(protectedSlot, 0xDEAD, 1, 0, 0, 1, 0, 0, 0);
            });
        } catch (error) {
            protectedThrew = /immutable after boot/.test(error.message);
        }
        const protectedAfter = Array.from(
            sim.memory.slice(protectedBase, protectedBase + sim.NS_ENTRY_WORDS),
            word => word >>> 0);
        check(`scoped writes cannot overwrite built-in slot ${protectedSlot}`,
            protectedThrew &&
            protectedAfter.every((word, index) => word === protectedBefore[index]));
    }
}

// Custom labels survive through the canonical bootConfig + occupied boot-image
// path, without browser localStorage.
{
    const bootConfig = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'server', 'boot-config.json'), 'utf8'));
    bootConfig.slotLabels = Object.assign({}, bootConfig.slotLabels, {
        11: 'CanonicalCustomLabel'
    });
    global.window = { bootConfig };

    const raw = fs.readFileSync(
        path.join(__dirname, '..', 'server', 'lumps', 'boot-image.bin'));
    const imageBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const words = new Uint32Array(imageBuffer);
    const sim = new ChurchSimulator();
    const base = sim._nsSlotBase(11);
    const word1 = sim.packNSWord1(63, 0, 0, 0);
    words[base] = 0x0800;
    words[base + 1] = word1;
    words[base + 2] = sim._integrity32(words[base], word1);
    words[base + 3] = 0x1234ABCD;
    sim.reset();
    const loaded = sim.loadBootImage(imageBuffer);

    check('canonical occupied custom slot loads from boot image',
        loaded && sim.isNSEntryValid(11));
    check('canonical custom label loads from bootConfig.slotLabels',
        sim.nsLabels[11] === 'CanonicalCustomLabel',
        `label=${sim.nsLabels[11]}`);
    delete global.window;
}

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);