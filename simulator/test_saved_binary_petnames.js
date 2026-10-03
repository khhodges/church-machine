'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(__dirname + '/app-lumps.js', 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}
const context = vm.createContext({TextDecoder, Uint8Array,
    assembler: {disassemble: word => 'DECODED_' + word}});
vm.runInContext(['_isExactSavedLumpWordArray', '_formatLumpHeaderDisassembly',
    '_lumpDispatchAnnotation', '_formatCanonicalSavedLumpWords'].map(extract).join('\n'), context);
function fixture(api) {
    const words = Array(128).fill(0);
    words[0] = ((31 << 27) | (1 << 23) | (2 << 10) | 3) >>> 0;
    words[1] = 0xB8000001;
    words[2] = 0x18000000;
    const bytes = Buffer.from(JSON.stringify(api));
    words[3] = (0xAB000000 | bytes.length) >>> 0;
    for (let i = 0; i < bytes.length; i++) words[4 + (i >> 2)] =
        (words[4 + (i >> 2)] | (bytes[i] << (24 - (i % 4) * 8))) >>> 0;
    words[126] = 0x4A000006;
    return words;
}
const words = fixture({capabilities: [{name:'SELF'}, {name:'ExactTarget'}, {name:'<img src=x>'}],
    methods: [{name:'Run'}]});
const original = words.slice();
const details = {methodCount:99, capabilities:[{name:'WrongName'}], pet_names:{CR:{1:'WrongName'}}};
const render = words => context._formatCanonicalSavedLumpWords(words, details);
const text = render(words);
assert.match(text, /0x00000000\s+C-list\[0\] "SELF"/);
assert.match(text, /0x4A000006\s+C-list\[1\] "ExactTarget"/);
assert.match(text, /C-list\[2\] "<img src=x>"/);
assert.match(text, /DISPATCH #1/);
assert.doesNotMatch(text, /WrongName/);
assert.deepEqual(words, original);
const malformed = words.slice();
malformed[3] = 0xAB00FFFF;
assert.match(render(malformed), /Cannot decode embedded definition/);
assert.match(render(malformed), /C-list\[1\] \(PetName unavailable in saved bytes\)/);
assert.doesNotMatch(render(malformed), /ExactTarget|WrongName|DISPATCH #/);
const absent = words.slice();
absent[3] = 0;
assert.match(render(absent), /No embedded definition frame/);
const renamed = fixture({capabilities:['SELF','DifferentTarget']});
assert.match(render(renamed), /C-list\[1\] "DifferentTarget"/);
assert.doesNotMatch(render(renamed), /ExactTarget/);
assert.match(render(renamed), /C-list\[2\] \(PetName unavailable in saved bytes\)/);
console.log('Saved binary PetNames: exact bytes, missing/malformed metadata, no stale fallbacks PASS');