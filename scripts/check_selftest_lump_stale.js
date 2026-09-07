#!/usr/bin/env node
'use strict';

// Keep this guard deliberately thin: the builder owns the one canonical packer
// and validates the exact filename recorded in both manifest and ns-state.
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const builder = path.join(__dirname, 'build_selftest_lump.js');
const args = [builder, '--check'];
for (const name of ['--lumps-dir', '--out-dir', '--ns-slot', '--lump-words']) {
    const i = process.argv.indexOf(name);
    if (i !== -1) args.push(name, process.argv[i + 1]);
}
const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status === 0) console.log('OK: SelfTest stale guard passed (no legacy 00000600.lump compatibility artifact is consulted).');
process.exit(result.status === 0 ? 0 : 1);