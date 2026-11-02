'use strict';
// Compile real CLOOMC++ and prepare data, not a software model of the methods.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Compiler = require('../simulator/cloomc_compiler');
const builder = require('../simulator/lump_builder');
const ThreadDesign = require('../simulator/thread_design');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'simulator/examples/free_handler.cloomc');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function wordsToBytes(words, littleEndian = false) {
    const bytes = Buffer.alloc(words.length * 4);
    words.forEach((word, i) => {
        if (littleEndian) bytes.writeUInt32LE(word >>> 0, i * 4);
        else bytes.writeUInt32BE(word >>> 0, i * 4);
    });
    return bytes;
}

function prepare({baseWord = 7168, firstSlot = 32} = {}) {
    if (!Number.isSafeInteger(baseWord) || baseWord < 1024 ||
        baseWord % 1024 || baseWord + 1536 > 16384)
        throw Error('B must be a 1024-word-aligned resident base outside the table, within 16384 words.');
    if (!Number.isSafeInteger(firstSlot) || firstSlot < 3 || firstSlot + 7 >= 64)
        throw Error('FirstSlot must reserve eight slots within the 64-slot Namespace, excluding self/entry.');
    const source = fs.readFileSync(SOURCE, 'utf8');
    const compiled = new Compiler().compile(source, []);
    if (compiled.errors.length) throw Error(JSON.stringify(compiled.errors));
    if (compiled.warnings.length) throw Error(JSON.stringify(compiled.warnings));
    const packed = builder.buildLump(compiled);
    const api = builder.buildApiDefinition(compiled, packed.words);
    const words = builder.embedSelfDefinition(packed.words, api, source, 0);
    const binary = wordsToBytes(words);
    const state = Array(64).fill(0);
    state[2] = 3; state[5] = 2; state[8] = 1;
    state[12] = 0; state[13] = 1; state[14] = 2;
    state[16] = 3; state[17] = 4; state[18] = 5;
    const offsets = [0, 64, 128, 256, 384, 512, 768, 1024];
    const sizes = [64, 64, 64, 128, 128, 256, 128, 512];
    const objects = offsets.map((offset, i) => ({
        name: `ide.FreeObject${i}`, clistRow: i + 2,
        kind: i < 6 ? 'data' : i === 6 ? 'clist' : 'thread',
        slot: firstSlot + i, sequence: 0,
        rights: i < 6 ? ['R', 'W'] : i === 6 ? ['S'] : [],
        baseWord: baseWord + offset, words: sizes[i], limit: sizes[i] - 1,
    }));
    // A 64-entry C-list needs a header in addition to the 64 NULL GTs.
    // The 128-word body has cc=64 and no executable code.
    const clist = Array(128).fill(0);
    clist[0] = (0xF8000000 | (1 << 23) | 64) >>> 0;
    // Compile the actual startup implementation, keeping its public dispatch
    // table. No copied running Thread, live catalogue choice or fabricated GT.
    const amoebaSource = fs.readFileSync(path.join(ROOT, 'simulator/cloomc/amoeba_startup.cloomc'), 'utf8');
    const amoebaCompiled = new Compiler().compile(amoebaSource, []);
    if (amoebaCompiled.errors.length || amoebaCompiled.warnings.length)
        throw Error(JSON.stringify({errors: amoebaCompiled.errors, warnings: amoebaCompiled.warnings}));
    const amoebaPacked = builder.buildLump(amoebaCompiled);
    const amoebaApi = builder.buildApiDefinition(amoebaCompiled, amoebaPacked.words);
    const amoebaWords = builder.embedSelfDefinition(amoebaPacked.words, amoebaApi, amoebaSource, 0);
    const layout = ThreadDesign.layout(512, 32);
    if (!layout.valid) throw Error('Invalid 512-word Thread layout');
    const thread = Array(512).fill(0);
    thread[0] = (0xF8000000 | (3 << 23) | (32 << 10) | (2 << 8) | 12) >>> 0;
    const root = layout.stackEnd - 2, sto = root - 2;
    const frame = (nia, savedSTO) => ((nia << 13) | (1 << 12) | savedSTO) >>> 0;
    thread[layout.protectedStoOffset] = (1 << 12) | sto;
    thread[root + 2] = frame(0x7FFF, layout.stackEnd);
    thread[sto + 2] = frame(amoebaPacked.words[1] - 1, root);
    // These three cells must receive the SAME trusted, destination-local E GT.
    // Keep them NULL in the portable output; setup records the exact source.
    const threadRelocations = [root + 1, sto + 1, layout.capsStart].map(wordOffset => ({
        wordOffset, name: 'ide.AmoebaStartup', rights: ['E'],
        binarySha256: sha(wordsToBytes(amoebaWords)),
    }));
    const objectWords = Array(1536).fill(0);
    objectWords.splice(offsets[6], clist.length, ...clist);
    objectWords.splice(offsets[7], thread.length, ...thread);
    const setup = {
        status: 'compiled-unbound-example-not-installable',
        source: 'simulator/examples/free_handler.cloomc',
        sourceSha256: sha(source), binarySha256: sha(binary),
        baseWord, firstSlot, objects,
        state: {
            name: 'ide.FreeHandlerState', clistRow: 1, rights: ['R', 'W'],
            words: 64, initializedWords: state,
            placement: 'Choose a private nonoverlapping allocation and vacant slot; not inferred from B/Y.',
        },
        self: {clistRow: 0, name: 'ide.FreeHandler', rights: ['E'],
            placement: 'Choose a resident executable allocation and slot after checking the selected Namespace.'},
        executableWords: packed.cw, clistRows: packed.cc,
        apiLumpWords: words.length,
        initialObjectBytes: objectWords.length * 4,
        poolWords: objectWords.length,
        allocatedObjectWords: sizes.reduce((a, b) => a + b, 0),
        clist: {entries: 64, bodyWords: 128, entriesStart: 64,
            initialValue: 'NULL', rowZero: 'immutable NULL; ordinary SAVE targets rows 1 through 63'},
        thread: {
            bodyWords: 512, stackWords: 32, layout, relocations: threadRelocations,
            applicationHome: layout.capsStart + 1,
            applicationInput: 'FreeThread CR2; saved into new Thread CR1 by SAVE',
            initializationGrant: {name: 'ide.FreeObject7', clistRow: 10, rights: ['S'],
                slot: firstSlot + 7, private: true},
            activation: 'not performed',
            amoeba: {source: 'simulator/cloomc/amoeba_startup.cloomc',
                sourceSha256: sha(amoebaSource), binarySha256: sha(wordsToBytes(amoebaWords)),
                startPC: amoebaPacked.words[1] - 1,
                requiredBinding: 'Boot.Thread supervisor for Amoeba yield'},
        },
        freshOriginRequired: true, generation: 0,
        installationAllowed: false, activationAllowed: false,
        hardwareProgrammingAllowed: false,
        limitations: [
            'B/Y geometry is checked, not vacancy in a live Namespace.',
            'All C-list rows remain NULL until normal trusted destination binding.',
            'Thread skeleton is not runnable until all three Amoeba relocations and Amoeba supervisor binding are resolved.',
            'Raw state/data bodies are not executable LUMPs; C-list and Thread carry their own headers.',
            'Application E GT must pass normal SAVE transfer/B checks; no authority is added.',
            'Single caller; no refill or generation change.',
            'Release quarantines; it does not immediately revoke other GT copies.',
            'Compiler checks are not runtime or frozen-BIT acceptance.',
        ],
    };
    return {source, compiled, packed, api, words, binary, state, setup,
        objectWords, clist, thread, amoebaWords, amoebaApi};
}

function main(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
        const key = {'--base-word': 'baseWord', '--first-slot': 'firstSlot'}[argv[i]];
        if (!key || argv[i + 1] === undefined)
            throw Error('Usage: node scripts/build_free_handler_example.js [--base-word X] [--first-slot Y]');
        options[key] = Number(argv[i + 1]);
    }
    const result = prepare(options);
    const directory = path.join(ROOT, 'generated-artifacts',
        `free-handler-${result.setup.baseWord}-${result.setup.firstSlot}-${sha(result.source).slice(0, 12)}`);
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'FreeHandler-UNBOUND.lump'), result.binary);
    fs.writeFileSync(path.join(directory, 'FreeHandler.api.json'), JSON.stringify(result.api, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, 'initial-state-le.bin'), wordsToBytes(result.state, true));
    fs.writeFileSync(path.join(directory, 'initial-objects-le.bin'), wordsToBytes(result.objectWords, true));
    fs.writeFileSync(path.join(directory, 'empty-clist-le.bin'), wordsToBytes(result.clist, true));
    fs.writeFileSync(path.join(directory, 'thread-template-UNBOUND-le.bin'), wordsToBytes(result.thread, true));
    fs.writeFileSync(path.join(directory, 'AmoebaStartup-UNBOUND.lump'), wordsToBytes(result.amoebaWords));
    fs.writeFileSync(path.join(directory, 'AmoebaStartup.api.json'), JSON.stringify(result.amoebaApi, null, 2) + '\n');
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(result.setup, null, 2) + '\n');
    console.log(JSON.stringify({
        directory: path.relative(ROOT, directory), methods: Object.keys(result.api.methods),
        executableWords: result.packed.cw, apiLumpWords: result.words.length,
        clistRows: result.packed.cc, status: result.setup.status,
    }, null, 2));
}

if (require.main === module) main(process.argv.slice(2));
module.exports = {prepare, wordsToBytes};
