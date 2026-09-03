#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const build = path.join(__dirname, 'build_capability_test_lump.js');
const result = spawnSync(process.execPath, [build, '--check', ...process.argv.slice(2)], {
    stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);