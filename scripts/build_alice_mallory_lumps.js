'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

global.window = {};
const ChurchAssembler = require('../simulator/assembler.js');

const ROOT = path.resolve(__dirname, '..');
const LUMPS = path.join(ROOT, 'server', 'lumps');
const MANIFEST = path.join(LUMPS, 'manifest.json');
const SELF_PLACEHOLDER = 0xFEED5E1F;
const PRIVATE_DATA_PLACEHOLDER = 0xFEEDDA7A;

const SPECS = [
  {
    dotName: 'ide.Alice',
    sourceFile: 'simulator/examples/alice.cloomc',
    expectedCode: [
      0xBF000002, 0xBF000004, 0x070B0001, 0x8F08C009, 0x1F000000,
      0x070B0001, 0x8708C009, 0x1F000000, 0xF0000000,
    ],
    methods: [
      { petName: 'Stash', branchOffset: 2,
        in: [{ name: 'value', reg: 'DR1' }], out: [{ name: 'ok', reg: 'DR1' }] },
      { petName: 'Reveal', branchOffset: 5,
        in: [], out: [{ name: 'secret', reg: 'DR1' }] },
    ],
    capabilities: [
      { row: 0, name: 'SELF', rights: ['E'], role: 'identity' },
      { row: 1, name: 'SECRET_DATA', rights: ['R', 'W'], role: 'private_data' },
    ],
    description: 'Stores and reveals one private word through an RW capability that never leaves Alice.',
  },
  {
    dotName: 'ide.Mallory',
    sourceFile: 'simulator/examples/mallory.cloomc',
    expectedCode: [0xBF000001, 0x070B0002, 0x8708C000, 0x1F000000, 0xF0000000],
    methods: [
      { petName: 'Steal', branchOffset: 1,
        in: [], out: [{ name: 'stolen', reg: 'DR1' }],
        failure: 'NO_CAPABILITY' },
    ],
    capabilities: [
      { row: 0, name: 'SELF', rights: ['E'], role: 'identity' },
      { row: 1, name: 'SCRATCH', rights: ['R', 'W'], role: 'private_data' },
    ],
    description: 'Deterministically faults NO_CAPABILITY because Alice has no row in Mallory’s c-list.',
  },
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function packWords(words) {
  const out = Buffer.alloc(words.length * 4);
  words.forEach((word, i) => out.writeUInt32BE(word >>> 0, i * 4));
  return out;
}

function packBytes(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) word |= (bytes[i + j] || 0) << (24 - 8 * j);
    words.push(word >>> 0);
  }
  return words;
}

function buildFrame(api, source) {
  const apiBytes = Buffer.from(JSON.stringify(api), 'utf8');
  const sourceBytes = Buffer.from(source, 'utf8');
  if (apiBytes.length > 0xFFFF) throw new Error('API JSON is too large');
  return [
    ((0xAB << 24) | (0x03 << 16) | apiBytes.length) >>> 0,
    ...packBytes(apiBytes),
    sourceBytes.length >>> 0,
    ...packBytes(sourceBytes),
  ];
}

function buildOne(spec) {
  const source = fs.readFileSync(path.join(ROOT, spec.sourceFile), 'utf8');
  const assembled = new ChurchAssembler().assemble(source);
  if (assembled.errors.length) {
    throw new Error(`${spec.dotName} assembly failed: ${JSON.stringify(assembled.errors)}`);
  }
  if (JSON.stringify(assembled.words) !== JSON.stringify(spec.expectedCode)) {
    throw new Error(`${spec.dotName} source drifted from the reviewed executable words`);
  }

  const api = { name: spec.dotName, methods: spec.methods };
  const frame = buildFrame(api, source);
  const cList = [SELF_PLACEHOLDER, PRIVATE_DATA_PLACEHOLDER];
  const needed = 1 + assembled.words.length + frame.length + cList.length;
  let n = 6;
  while ((1 << n) < needed) n++;
  if (n > 15) throw new Error(`${spec.dotName} does not fit in a LUMP`);
  const size = 1 << n;
  const header = ((0x1F << 27) | ((n - 6) << 23) |
    (assembled.words.length << 10) | cList.length) >>> 0;
  const words = [header, ...assembled.words, ...frame];
  while (words.length < size - cList.length) words.push(0);
  words.push(...cList);

  const binary = packWords(words);
  const token = sha256(Buffer.concat([Buffer.from(spec.dotName, 'utf8'), binary])).slice(0, 8);
  const filename = `${spec.dotName}.1.${token}.lump`;
  const binaryHash = sha256(binary);
  const identityString = `${spec.dotName}#1`;
  const identityHash = sha256(Buffer.from(identityString, 'utf8'));
  const manifestEntry = {
    token, abstraction: spec.dotName, dot_name: spec.dotName, issue_n: 1,
    ns_slot: null, ns_slot_policy: 'dynamic', boot_resident: false,
    lump_size: size, cw: assembled.words.length, cc: cList.length,
    status: 'released', language: 'Church Machine ISA', author: 'Church Machine',
    filename, binary_hash: binaryHash,
    identity_hash: identityHash,
  };
  return { spec, binary, manifestEntry };
}

function writeAtomic(filename, data) {
  const tmp = `${filename}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filename);
}

function stringifyAsciiJson(value) {
  return JSON.stringify(value, null, 2).replace(
    /[\u007f-\uffff]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function main() {
  const built = SPECS.map(buildOne);
  const oldManifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const replacedNames = new Set(SPECS.flatMap(s => [s.dotName, s.dotName.split('.').pop()]));
  const manifest = oldManifest.filter(entry =>
    !replacedNames.has(entry.abstraction) && !replacedNames.has(entry.dot_name));

  for (const item of built) {
    for (const old of fs.readdirSync(LUMPS)) {
      if (old.startsWith(`${item.spec.dotName}.1.`) &&
          old.endsWith('.lump')) {
        fs.unlinkSync(path.join(LUMPS, old));
      }
    }
    writeAtomic(path.join(LUMPS, item.manifestEntry.filename), item.binary);
    manifest.push(item.manifestEntry);
  }
  // Keep the repository manifest's established ASCII-escaped encoding so a
  // deterministic rebuild changes only the Alice/Mallory records.
  writeAtomic(MANIFEST, `${stringifyAsciiJson(manifest)}\n`);
  for (const item of built) {
    console.log(`${item.spec.dotName}: ${item.manifestEntry.filename}`);
  }
}

main();