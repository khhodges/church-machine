#!/usr/bin/env node
'use strict';

/**
 * scripts/remap_stale_isa_opcodes.js
 *
 * Direct binary-level repair for hand-authored / binary-only LUMPs whose code
 * words were assembled under the pre-v2.0 Turing opcode numbering (old
 * opcodes 10-19) and never recompiled after the v2.0 renumbering shifted the
 * Turing block to opcodes 16-25 (see CHANGELOG.md "LUMP viewer shows ??? on
 * every other line..." entry and docs/instruction-set.md, which still
 * documents the OLD numbering verbatim).
 *
 * These lumps have no discoverable .cloomc source (they were hand-assembled
 * directly into hex, e.g. from simulator/cloomc/<Name>.json spec files or
 * hardware/boot_rom.py literal hex arrays), so `update-lump.js`'s
 * source-recompile path does not apply. The fix here is a pure bit-level
 * remap: every code word (word[1..cw]) whose top-5-bit opcode field falls in
 * the old Turing range [10,19] gets +6 added to that field (old op N -> new
 * op N+6), leaving cond/register/immediate bits untouched. This exactly
 * undoes the ISA renumbering with no semantic change.
 *
 * Usage:
 *   node scripts/remap_stale_isa_opcodes.js --token <hex>            # apply
 *   node scripts/remap_stale_isa_opcodes.js --token <hex> --check    # dry-run
 */

const fs = require('path') && require('fs');
const path = require('path');

const LUMPS_DIR = path.join(__dirname, '..', 'server', 'lumps');

function parseArgs(argv) {
    const out = { check: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--token') out.token = argv[++i];
        else if (argv[i] === '--check') out.check = true;
    }
    return out;
}

function remapWord(w) {
    const op = (w >>> 27) & 0x1F;
    if (op >= 10 && op <= 19) {
        const newOp = op + 6;
        return ((newOp & 0x1F) << 27) | (w & 0x07FFFFFF);
    }
    return w;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.token) {
        console.error('Usage: node scripts/remap_stale_isa_opcodes.js --token <hex> [--check]');
        process.exit(1);
    }
    const token = args.token.toLowerCase();
    const lumpPath = path.join(LUMPS_DIR, `${token}.lump`);
    if (!fs.existsSync(lumpPath)) {
        console.error(`No such lump: ${lumpPath}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(lumpPath);
    const nWords = raw.length / 4;
    const words = [];
    for (let i = 0; i < nWords; i++) words.push(raw.readUInt32BE(i * 4));

    const header = words[0];
    const cw = (header >>> 10) & 0x1FFF;

    let changed = 0;
    const outWords = words.slice();
    for (let i = 1; i <= cw && i < outWords.length; i++) {
        const before = outWords[i];
        const after = remapWord(before);
        if (after !== before) {
            changed++;
            outWords[i] = after;
        }
    }

    console.log(`${token}: cw=${cw} words_remapped=${changed}`);

    if (changed === 0) {
        console.log(`${token}: nothing to remap (no stale opcodes found)`);
        return;
    }

    if (args.check) {
        console.log(`${token}: --check mode, no write performed (DRIFT: ${changed} words would change)`);
        return;
    }

    const outBuf = Buffer.alloc(raw.length);
    for (let i = 0; i < outWords.length; i++) outBuf.writeUInt32BE(outWords[i] >>> 0, i * 4);
    fs.writeFileSync(lumpPath, outBuf);
    console.log(`${token}: wrote ${lumpPath} (${changed} words remapped, lump_size unchanged)`);
}

main();
