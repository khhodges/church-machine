'use strict';

// A raw assembly export must preserve the validated GT materialized into the
// candidate, then validate the final bytes that are handed to Blob/download.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CapabilityTokens = require('./capability_tokens.js');

const source = fs.readFileSync(path.join(__dirname, 'app-lump-editor.js'), 'utf8');
let downloaded = null;
let strictValidationCalls = 0;

class CapturedBlob {
    constructor(parts, options) {
        this.parts = parts;
        this.options = options;
        downloaded = this;
    }
}

const strictCapabilityTokens = Object.assign({}, CapabilityTokens, {
    validateClist(words, start, caps, context) {
        strictValidationCalls++;
        return CapabilityTokens.validateClist(words, start, caps, context);
    },
});

const context = {
    console,
    Uint8Array,
    Uint32Array,
    DataView,
    Math,
    Number,
    Array,
    Object,
    String,
    Blob: CapturedBlob,
    URL: {
        createObjectURL() { return 'blob:raw-export'; },
        revokeObjectURL() {},
    },
    CapabilityTokens: strictCapabilityTokens,
    window: {
        ThreadDesign: {
            normative: true,
            dataRegisters: { words: 16 },
            capabilityHomes: { words: 12 },
            supportedBodyWords: [64, 128],
        },
        addEventListener() {},
    },
    document: {
        body: { appendChild() {}, removeChild() {} },
        createElement() {
            return {
                click() {},
                href: '',
                download: '',
            };
        },
        getElementById() { return null; },
    },
    alert(message) {
        throw new Error(`unexpected export alert: ${message}`);
    },
};
context.window.CapabilityTokens = strictCapabilityTokens;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'app-lump-editor.js' });

// Inform E-only GT for NS[7]: E permission + Church domain + Inform type.
const serviceGT = 0x4A000007;
const candidate = {
    token: 'stale-metadata-token-must-not-name-download',
    words: [0x1F800000, 0x00000001],
    capabilities: [{
        name: 'Service',
        rights: ['E'],
        grants: ['E'],
        nsIndex: 7,
        token: serviceGT,
    }],
};
const result = context.window.buildLumpFromAssembly(candidate);
if (!result || !result.ok) throw new Error(`raw export failed: ${result && result.error}`);
if (!downloaded) throw new Error('raw export did not create a downloadable byte payload');

const bytes = downloaded.parts[0];
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const header = view.getUint32(0, false);
const cw = (header >>> 10) & 0x1FFF;
const cc = header & 0xFF;
if (cw !== candidate.words.length || cc !== 1) {
    throw new Error(`header cw/cc mismatch: cw=${cw}, cc=${cc}`);
}
const clistWord = view.getUint32((1 + cw) * 4, false);
if (clistWord !== serviceGT) {
    throw new Error(`C-list GT lost during export: got 0x${clistWord.toString(16)}`);
}
const strict = CapabilityTokens.validateClist(
    Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getUint32(index * 4, false)),
    1 + cw,
    candidate.capabilities,
    {}
);
if (!strict.ok || strictValidationCalls !== 1) {
    throw new Error(`final C-list was not strictly validated: ${JSON.stringify(strict.errors)}`);
}

function crc32(buf) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1)
            ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    let crc = 0xFFFFFFFF;
    for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}
if (result.token !== crc32(bytes)) {
    throw new Error(`export token ${result.token} does not fingerprint final bytes`);
}
if (result.token === candidate.token) {
    throw new Error('export reused stale candidate metadata token instead of final byte token');
}

console.log('raw LUMP export GT materialization regression: PASS');