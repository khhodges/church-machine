'use strict';
// Offline build only: never imports the server, installs a LUMP, or binds GTs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Compiler = require('../simulator/cloomc_compiler');
const builder = require('../simulator/lump_builder');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'simulator/cloomc/security_regulator.cloomc'), 'utf8');
const compiled = new Compiler().compile(source, []);
if (compiled.errors.length) throw new Error(JSON.stringify(compiled.errors));
const lump = builder.buildLump(compiled);
const bytes = Buffer.alloc(lump.words.length * 4);
lump.words.forEach((word, index) => bytes.writeUInt32LE(word >>> 0, index * 4));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = {
    status: 'offline-incomplete-candidate-not-installed',
    sourceSha256: hash(source),
    binarySha256: hash(bytes),
    words: lump.words.length,
    bytes: bytes.length,
    methods: compiled.methods.filter(m => m.visibility !== 'private').map(m => m.name),
    missingMethods: ['MakeOutformM', 'MakeInformM'],
    limitations: [
        'MintM and indexed object operations currently accept Inform only',
        'SWITCHM two-Namespace round trip is not yet qualified',
        'Private context-local scratch and production bindings are not provisioned',
        'No physical hardware acceptance or ISA/RTL changes',
    ],
};
const out = path.join(root, 'generated-artifacts/security-regulator');
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'SecurityRegulator.candidate.bin'), bytes);
fs.writeFileSync(path.join(out, 'api.json'),
    JSON.stringify(builder.buildApiDefinition(compiled, lump.words), null, 2) + '\n');
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
