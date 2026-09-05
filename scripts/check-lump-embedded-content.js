#!/usr/bin/env node
'use strict';

// Validate source/API content embedded in self-defining LUMP binaries.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? fallback : path.resolve(process.argv[i + 1]);
}
const LUMPS = arg('lumps-dir', path.join(ROOT, 'server', 'lumps'));
const EXAMPLES = arg('examples-dir', path.join(ROOT, 'simulator', 'examples'));

function snake(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

function inspect(file) {
    const raw = fs.readFileSync(file);
    if (raw.length < 4 || raw.length % 4) throw new Error('invalid word length');
    const header = raw.readUInt32BE(0);
    const size = 1 << (((header >>> 23) & 15) + 6);
    const cw = (header >>> 10) & 0x1fff;
    const cc = header & 0xff;
    if (raw.length !== size * 4) throw new Error('header size mismatch');
    const start = (1 + cw) * 4;
    const end = (size - cc) * 4;
    if (end - start < 8 || raw[start] !== 0xab) throw new Error('embedded content missing');
    const flags = raw[start + 1];
    const apiLength = raw.readUInt16BE(start + 2);
    const apiEnd = start + 4 + apiLength;
    const sourceLengthAt = (apiEnd + 3) & ~3;
    if (sourceLengthAt + 4 > end) throw new Error('embedded API exceeds freespace');
    const api = JSON.parse(raw.subarray(start + 4, apiEnd).toString('utf8'));
    let source = null;
    if (flags & 1) {
        const n = raw.readUInt32BE(sourceLengthAt);
        if (sourceLengthAt + 4 + n > end) throw new Error('embedded source exceeds freespace');
        source = raw.subarray(sourceLengthAt + 4, sourceLengthAt + 4 + n).toString('utf8');
    }
    return { api, source };
}

function main() {
    const manifestValue = JSON.parse(fs.readFileSync(path.join(LUMPS, 'manifest.json'), 'utf8'));
    const manifest = Array.isArray(manifestValue) ? manifestValue : Object.values(manifestValue);
    let checked = 0;
    let failed = 0;
    for (const entry of manifest) {
        if (!entry || typeof entry !== 'object' || !entry.filename) continue;
        const sourceFile = path.join(EXAMPLES, `${snake(entry.abstraction || entry.dot_name || '')}.cloomc`);
        if (!fs.existsSync(sourceFile)) continue;
        try {
            const content = inspect(path.join(LUMPS, entry.filename));
            if (!content.api || !Array.isArray(content.api.methods) ||
                content.source !== fs.readFileSync(sourceFile, 'utf8')) {
                throw new Error('embedded API/source does not match canonical source');
            }
            console.log(`ok ${entry.filename}`);
            checked++;
        } catch (error) {
            console.error(`FAIL ${entry.filename}: ${error.message}`);
            failed++;
        }
    }
    console.log(`check-lump-embedded-content: ${checked} checked, ${failed} failed`);
    if (failed) process.exit(1);
}

if (require.main === module) main();
module.exports = { inspect };