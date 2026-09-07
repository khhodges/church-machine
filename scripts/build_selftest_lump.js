#!/usr/bin/env node
'use strict';

// Build the canonical, named SelfTest artifact.  The protected identity token
// is intentionally independent of the content-addressed filename; ns-state is
// the authoritative slot binding.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const arg = name => {
    const i = process.argv.indexOf(name);
    return i === -1 ? null : process.argv[i + 1] || null;
};
const LUMPS_DIR = path.resolve(arg('--out-dir') || arg('--lumps-dir') ||
    path.join(ROOT, 'server', 'lumps'));
const MANIFEST = path.join(LUMPS_DIR, 'manifest.json');
const NS_STATE = path.join(LUMPS_DIR, 'ns-state.json');
const APPROVALS = path.join(LUMPS_DIR, 'approvals.json');
const CHECK_ONLY = process.argv.includes('--check');
const DOT_NAME = 'SelfTest';

function json(value) {
    return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/g,
        c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function die(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}
function powerOfTwo(n) { return n >= 64 && (n & (n - 1)) === 0; }
function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function frame(text) {
    const api = Buffer.from(JSON.stringify({ name: DOT_NAME, methods: [] }));
    const src = Buffer.from(text);
    const data = Buffer.concat([
        Buffer.from([0xAB, 0x03, api.length >>> 8, api.length & 0xFF]), api,
        Buffer.alloc((4 - api.length % 4) % 4),
        Buffer.from([src.length >>> 24, src.length >>> 16 & 0xFF, src.length >>> 8 & 0xFF, src.length & 0xFF]), src,
        Buffer.alloc((4 - src.length % 4) % 4),
    ]);
    const words = [];
    for (let i = 0; i < data.length; i += 4) words.push(data.readUInt32BE(i));
    return words;
}

if (!fs.existsSync(MANIFEST)) die(`missing manifest: ${MANIFEST}`);
if (!fs.existsSync(NS_STATE)) die(`missing ns-state: ${NS_STATE}`);
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const nsState = JSON.parse(fs.readFileSync(NS_STATE, 'utf8'));
const stateRows = (nsState.abstractions || []).filter(row => row.name === DOT_NAME);
if (stateRows.length !== 1) die('ns-state must contain exactly one SelfTest row');
const stateRow = stateRows[0];
const requestedSlot = arg('--ns-slot');
const nsSlot = requestedSlot === null ? stateRow.slot : Number(requestedSlot);
if (!Number.isInteger(nsSlot) || nsSlot < 0 || nsSlot > 0xFFFF) die('--ns-slot must be a valid unsigned 16-bit slot');
const seq = Number(stateRow.seq);
if (!Number.isInteger(seq) || seq < 0 || seq > 0x1FF) die('SelfTest ns-state seq must be a valid 9-bit sequence');

global.localStorage = { _store: {}, getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = String(v); }, removeItem(k) { delete this._store[k]; } };
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'simulator', 'assembler.js'), 'utf8'),
    { filename: 'assembler.js' });
const source = fs.readFileSync(path.join(ROOT, 'simulator', 'examples', 'post_flash_selftest.cloomc'), 'utf8');
const result = new ChurchAssembler().assemble(source);
if (result.errors.length) die(result.errors.map(e => `line ${e.line}: ${e.message}`).join('\n'));

const cw = result.words.length;
const cc = 2;
const content = frame(source);
const needed = 1 + cw + content.length + cc;
let lumpSize = 64;
while (lumpSize < needed) lumpSize *= 2;
const requestedWords = arg('--lump-words');
if (requestedWords !== null) {
    lumpSize = Number(requestedWords);
    if (!Number.isSafeInteger(lumpSize) || !powerOfTwo(lumpSize) || lumpSize < needed)
        die(`--lump-words must be a power of two >= ${needed}`);
}
if (lumpSize > 64 * 2 ** 15) die('lump allocation exceeds LUMP header capacity');
const nMinus6 = Math.log2(lumpSize) - 6;
if (cw > 0x1FFF) die('instruction count exceeds LUMP header capacity');
const header = ((0x1F << 27) | (nMinus6 << 23) | (cw << 10) | cc) >>> 0;
const words = new Uint32Array(lumpSize);
words[0] = header;
result.words.forEach((word, i) => { words[1 + i] = word >>> 0; });
content.forEach((word, i) => { words[1 + cw + i] = word >>> 0; });
const selfGT = ((4 << 28) | (1 << 27) | (1 << 25) | (seq << 16) | nsSlot) >>> 0;
words[lumpSize - 2] = selfGT;
words[lumpSize - 1] = selfGT;
const bytes = Buffer.alloc(lumpSize * 4);
words.forEach((word, i) => bytes.writeUInt32BE(word, i * 4));
const binaryHash = crypto.createHash('sha256').update(bytes).digest('hex');
const token = crc32(bytes).toString(16).toLowerCase().padStart(8, '0');
const oldSelfTests = manifest.filter(e => e.abstraction === DOT_NAME);
const manifestLocatorFields = new Set([
    'token', 'filename', 'abstraction', 'version', 'lump_version', 'compiled_at',
    'archived', 'forked', 'variant_group',
]);
function stripToManifestLocator(row) {
    for (const key of Object.keys(row)) {
        if (!manifestLocatorFields.has(key)) delete row[key];
    }
}
const existingExact = oldSelfTests.find(e => e.filename === stateRow.filename && !e.archived);
const priorIssue = oldSelfTests.reduce((max, row) => Math.max(max,
    Number.isInteger(row.issue_n) ? row.issue_n : 0,
    Number.isInteger(row.lump_version) ? row.lump_version : 0), 0);
const issueN = existingExact && stateRow.binary_hash === binaryHash
    ? (existingExact.issue_n || existingExact.lump_version || 1)
    : priorIssue + 1;
const identityHash = crypto.createHash('sha256').update(`${DOT_NAME}#${issueN}`).digest('hex');
const identityString = `${DOT_NAME}#${issueN}`;
const filename = `${DOT_NAME}.${issueN}.${crypto.createHash('sha256').update(DOT_NAME).update(bytes).digest('hex').slice(0, 8)}.lump`;
const entry = {
    // manifest.json is a locator/history index only.  Identity, placement,
    // and intrinsic binary facts are fail-closed in approval + ns-state.
    token, abstraction: DOT_NAME, filename, lump_version: issueN,
    variant_group: 'selftest-history',
};
console.log(`SelfTest artifact: ${filename}`);
console.log(`Content token (CRC-32): ${token}`);
console.log(`slot=${nsSlot} seq=${seq} cw=${cw} cc=${cc} lump_size=${lumpSize} binary_sha256=${binaryHash}`);

const active = manifest.filter(e => e.token === token && e.abstraction === DOT_NAME && !e.archived);
const artifactPath = path.join(LUMPS_DIR, filename);
const approvalRecord = {
    binary_hash: binaryHash, filename, dot_name: DOT_NAME, issue_n: issueN,
    identity_string: identityString, identity_hash: identityHash,
    identity_seal_location: 'approval',
    token, abstraction: DOT_NAME, grants: ['E'],
    capability_type: 'inform',
};
if (CHECK_ONLY) {
    const failures = [];
    if (!fs.existsSync(artifactPath) || !fs.readFileSync(artifactPath).equals(bytes)) failures.push(`binary missing or stale: ${filename}`);
    if (active.length !== 1 || active[0].filename !== filename ||
        active[0].token !== token || active[0].lump_version !== issueN) {
        failures.push('manifest canonical SelfTest locator is stale');
    }
    if (stateRow.token !== token || stateRow.filename !== filename ||
        stateRow.slot !== nsSlot || stateRow.seq !== seq ||
        stateRow.identity_hash !== identityHash || stateRow.binary_hash !== binaryHash ||
        stateRow.ns_slot_policy !== 'static' || stateRow.load_policy !== 'Resident' ||
        stateRow.resident !== true || stateRow.boot_resident !== true ||
        stateRow.issue_n !== issueN || stateRow.lump_version !== issueN ||
        stateRow.limit !== `0x${(lumpSize - cc - 1).toString(16).toUpperCase().padStart(5, '0')}`) {
        failures.push('ns-state canonical SelfTest binding is stale');
    }
    let approvals;
    try { approvals = JSON.parse(fs.readFileSync(APPROVALS, 'utf8')).approvals; } catch (_) { approvals = null; }
    if (!approvals || !approvals[binaryHash] ||
        JSON.stringify(Object.keys(approvals[binaryHash]).sort()) !== JSON.stringify(Object.keys(approvalRecord).sort()) ||
        Object.entries(approvalRecord).some(([key, value]) => JSON.stringify(approvals[binaryHash][key]) !== JSON.stringify(value))) {
        failures.push('SelfTest hash-bound approval is missing or stale');
    }
    if (failures.length) die(failures.join('\nFAIL: '));
    console.log('OK: canonical SelfTest source, manifest, ns-state, and named artifact are fresh.');
    process.exit(0);
}
fs.mkdirSync(LUMPS_DIR, { recursive: true });
fs.writeFileSync(artifactPath, bytes);
// Preserve every old file and manifest history record.  An unchanged rebuild
// updates the active record in place; changed bytes archive prior records.
if (existingExact && stateRow.binary_hash === binaryHash) {
    for (const old of oldSelfTests) {
        if (old !== existingExact) old.archived = true;
        stripToManifestLocator(old);
    }
    Object.assign(existingExact, entry);
    delete existingExact.archived;
} else {
    for (const old of oldSelfTests) {
        old.archived = true;
        stripToManifestLocator(old);
    }
    manifest.push(entry);
}
stateRow.slot = nsSlot; // migrate this exact, single row; never add another.
stateRow.token = token;
stateRow.filename = filename;
stateRow.lump_version = issueN;
stateRow.issue_n = issueN;
stateRow.identity_hash = identityHash;
stateRow.binary_hash = binaryHash;
stateRow.ns_slot_policy = 'static';
stateRow.load_policy = 'Resident';
stateRow.resident = true;
stateRow.boot_resident = true;
stateRow.limit = `0x${(lumpSize - cc - 1).toString(16).toUpperCase().padStart(5, '0')}`;
fs.writeFileSync(MANIFEST, json(manifest));
fs.writeFileSync(NS_STATE, json(nsState));
const approvalWriter = [
    'import json, sys',
    'from server.lump_approvals import read_approvals, write_approvals',
    'records = read_approvals(sys.argv[1])',
    'records[sys.argv[2]] = json.loads(sys.argv[3])',
    'write_approvals(sys.argv[1], records)',
].join('; ');
const approvalWrite = spawnSync(process.env.PYTHON || 'python3',
    ['-c', approvalWriter, APPROVALS, binaryHash, JSON.stringify(approvalRecord)],
    { cwd: ROOT, encoding: 'utf8' });
if (approvalWrite.status !== 0) die(`approval update failed: ${approvalWrite.stderr || approvalWrite.error}`);
console.log(`Written: ${artifactPath}`);
console.log('Updated manifest, ns-state, and hash-bound approval; prior artifacts were retained as archived history.');