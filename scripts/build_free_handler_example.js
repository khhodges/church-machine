'use strict';
// Compile real CLOOMC++ and prepare data, not a software model of the methods.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Compiler = require('../simulator/cloomc_compiler');
const builder = require('../simulator/lump_builder');

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
        baseWord % 1024 || baseWord + 1024 > 16384)
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
    state[2] = 4; state[5] = 2; state[8] = 2;
    for (let i = 0; i < 8; i++) state[12 + i] = i;
    const offsets = [0, 64, 128, 192, 256, 384, 512, 768];
    const sizes = [64, 64, 64, 64, 128, 128, 256, 256];
    const objects = offsets.map((offset, i) => ({
        name: `ide.FreeObject${i}`, clistRow: i + 2,
        slot: firstSlot + i, sequence: 0, rights: ['R', 'W'],
        baseWord: baseWord + offset, words: sizes[i], limit: sizes[i] - 1,
    }));
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
        initialObjectBytes: 4096,
        freshOriginRequired: true, generation: 0,
        installationAllowed: false, activationAllowed: false,
        hardwareProgrammingAllowed: false,
        limitations: [
            'B/Y geometry is checked, not vacancy in a live Namespace.',
            'All C-list rows remain NULL until normal trusted destination binding.',
            'Raw state/object bodies are not executable LUMPs.',
            'Single caller; no refill or generation change.',
            'Release quarantines; it does not immediately revoke other GT copies.',
            'Compiler checks are not runtime or frozen-BIT acceptance.',
        ],
    };
    return {source, compiled, packed, api, words, binary, state, setup};
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
    fs.writeFileSync(path.join(directory, 'initial-objects-le.bin'), Buffer.alloc(4096));
    fs.writeFileSync(path.join(directory, 'setup.json'), JSON.stringify(result.setup, null, 2) + '\n');
    console.log(JSON.stringify({
        directory: path.relative(ROOT, directory), methods: Object.keys(result.api.methods),
        executableWords: result.packed.cw, apiLumpWords: result.words.length,
        clistRows: result.packed.cc, status: result.setup.status,
    }, null, 2));
}

if (require.main === module) main(process.argv.slice(2));
module.exports = {prepare, wordsToBytes};
