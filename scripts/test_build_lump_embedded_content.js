#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync, spawnSync } = require('child_process');
const { historicalClassification, inspect } = require('./check-lump-embedded-content.js');
const ROOT = path.resolve(__dirname, '..');
const CANONICAL_LUMPS = path.join(ROOT, 'server', 'lumps');
const builds = [
    ['build_capability_test_lump.js', 'simulator/examples/capability_test.cloomc'],
    ['build_selftest_lump.js', 'simulator/examples/post_flash_selftest.cloomc'],
    ['build_wukong_callhome_lump.js', 'simulator/examples/wukong_callhome.cloomc'],
    ['build_event_router_lump.js', 'simulator/cloomc/EventRouter.cloomc'],
];

const canonicalManifest = JSON.parse(fs.readFileSync(
    path.join(CANONICAL_LUMPS, 'manifest.json'), 'utf8'));
const canonicalState = JSON.parse(fs.readFileSync(
    path.join(CANONICAL_LUMPS, 'ns-state.json'), 'utf8'));

function seedCanonicalState(dir, script) {
    const names = {
        'build_capability_test_lump.js': 'CapabilityTest',
        'build_selftest_lump.js': 'SelfTest',
        'build_wukong_callhome_lump.js': 'WukongCallHome',
        'build_event_router_lump.js': 'EventRouter',
    };
    const abstraction = names[script];
    const rows = (canonicalState.abstractions || []).filter(row =>
        row.name === abstraction && row.resident === true && row.boot_resident === true);
    const selected = new Set(rows.map(row => row.filename));
    const manifest = canonicalManifest.filter(entry =>
        entry.abstraction === abstraction && selected.has(entry.filename));
    if (rows.length && manifest.length !== rows.length) {
        throw new Error(`canonical ${abstraction} state has no matching manifest locator`);
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'ns-state.json'),
        JSON.stringify({ abstractions: rows }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'approvals.json'),
        JSON.stringify({ version: 1, algorithm: 'sha256', approvals: {} }, null, 2) + '\n');
}

function writeFixtureLump(file, source) {
    const size = 64;
    const raw = Buffer.alloc(size * 4);
    const api = Buffer.from(JSON.stringify({ methods: [] }), 'utf8');
    const sourceBytes = Buffer.from(source, 'utf8');
    raw.writeUInt32BE(0, 0);
    let offset = 4;
    raw[offset] = 0xab;
    raw[offset + 1] = 1;
    raw.writeUInt16BE(api.length, offset + 2);
    api.copy(raw, offset + 4);
    offset = (offset + 4 + api.length + 3) & ~3;
    raw.writeUInt32BE(sourceBytes.length, offset);
    sourceBytes.copy(raw, offset + 4);
    fs.writeFileSync(file, raw);
}
let failures = 0;

try {
    const missing = new Error('embedded content missing');
    const legacy = historicalClassification({ pre_embedded_content: true }, missing);
    const unmarked = historicalClassification({
        filename: 'Salvation.1.6be43a9d.lump',
    }, missing);
    if (legacy !== 'historical pre-embedded-content artifact') {
        throw new Error('manifest pre-embedded-content classification was not honored');
    }
    if (unmarked !== null) {
        throw new Error('unmarked current artifact did not fail closed');
    }
    console.log('PASS manifest legacy classification');
} catch (error) {
    console.error(`FAIL manifest legacy classification: ${error.message}`);
    failures++;
}

for (const [script, sourceName] of builds) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lump-content-'));
    try {
        seedCanonicalState(dir, script);
        execFileSync(process.execPath,
            [path.join(__dirname, script), '--out-dir', dir], { cwd: ROOT, stdio: 'pipe' });
        const files = fs.readdirSync(dir);
        const binaries = files.filter(name => name.endsWith('.lump'));
        const stateFiles = new Set(['manifest.json', 'ns-state.json', 'approvals.json']);
        const unexpectedJson = files.filter(name => name.endsWith('.json') && !stateFiles.has(name));
        if (binaries.length !== 1 || unexpectedJson.length) {
            throw new Error(`expected one binary and no per-LUMP JSON; got ${files.join(', ')}`);
        }
        const content = inspect(path.join(dir, binaries[0]));
        const expected = fs.readFileSync(path.join(ROOT, sourceName), 'utf8');
        if (!content.api || !Array.isArray(content.api.methods) || content.source !== expected) {
            throw new Error('embedded API/source mismatch');
        }
        console.log(`PASS ${script}`);
    } catch (error) {
        console.error(`FAIL ${script}: ${error.message}`);
        failures++;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
try {
    testHistoricalClassificationBoundary();
} catch (error) {
    console.error(`FAIL historical classification boundary: ${error.message}`);
    failures++;
}
if (failures) process.exit(1);

function writeMissingContentLump(file) {
    fs.writeFileSync(file, Buffer.alloc(64 * 4));
}

function writeMalformedApiLump(file, source) {
    writeFixtureLump(file, source);
    const raw = fs.readFileSync(file);
    raw.write('{not-json', 8, 'utf8');
    fs.writeFileSync(file, raw);
}

function writeInvalidSizeLump(file) {
    // A zero header declares 64 words, while this artifact contains only 63.
    fs.writeFileSync(file, Buffer.alloc(63 * 4));
}

function testHistoricalClassificationBoundary() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lump-content-check-'));
    const lumpsDir = path.join(dir, 'lumps');
    const examplesDir = path.join(dir, 'examples');
    fs.mkdirSync(lumpsDir);
    fs.mkdirSync(examplesDir);
    const source = 'abstraction Fixture {}\n';
    const manifest = [
        { abstraction: 'Fixture', filename: 'current-matching.lump' },
        { abstraction: 'Fixture', filename: 'current-missing.lump' },
        { abstraction: 'Fixture', filename: 'current-stale.lump' },
        { abstraction: 'Fixture', filename: 'archived-missing.lump', archived: true },
        { abstraction: 'Fixture', filename: 'archived-stale.lump', archived: true },
        { abstraction: 'Fixture', filename: 'archived-malformed-api.lump', archived: true },
        { abstraction: 'Fixture', filename: 'archived-invalid-size.lump', archived: true },
    ];
    try {
        fs.writeFileSync(path.join(examplesDir, 'fixture.cloomc'), source);
        fs.writeFileSync(path.join(lumpsDir, 'manifest.json'), JSON.stringify(manifest));
        writeFixtureLump(path.join(lumpsDir, 'current-matching.lump'), source);
        writeMissingContentLump(path.join(lumpsDir, 'current-missing.lump'));
        writeFixtureLump(path.join(lumpsDir, 'current-stale.lump'), 'stale source\n');
        writeMissingContentLump(path.join(lumpsDir, 'archived-missing.lump'));
        writeFixtureLump(path.join(lumpsDir, 'archived-stale.lump'), 'stale source\n');
        writeMalformedApiLump(path.join(lumpsDir, 'archived-malformed-api.lump'), source);
        writeInvalidSizeLump(path.join(lumpsDir, 'archived-invalid-size.lump'));

        const result = spawnSync(process.execPath, [
            path.join(__dirname, 'check-lump-embedded-content.js'),
            '--lumps-dir', lumpsDir,
            '--examples-dir', examplesDir,
        ], { cwd: ROOT, encoding: 'utf8' });
        const output = `${result.stdout}${result.stderr}`;
        const expected = [
            'ok current-matching.lump',
            'FAIL current-missing.lump: embedded content missing',
            'FAIL current-stale.lump: embedded API/source does not match canonical source',
            'historical archived-missing.lump: historical artifact intentionally lacks embedded content',
            'historical archived-stale.lump: historical artifact embeds an earlier canonical source',
            'FAIL archived-malformed-api.lump:',
            'FAIL archived-invalid-size.lump: header size mismatch',
            'check-lump-embedded-content: 1 checked, 4 failed',
        ];
        if (result.status === 0) throw new Error('broken current artifacts exited zero');
        for (const line of expected) {
            if (!output.includes(line)) throw new Error(`missing checker output: ${line}`);
        }
        if (/historical current-(missing|stale)\.lump/.test(output)) {
            throw new Error('current artifact was classified as historical');
        }
        if (/historical archived-(malformed-api|invalid-size)\.lump/.test(output)) {
            throw new Error('corrupted archived artifact was classified as historical');
        }
        console.log('PASS historical classification boundary');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
