#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const assemblerPath = path.join(root, 'simulator', 'assembler.js');
const indexPath = path.join(root, 'simulator', 'index.html');
const assembler = fs.readFileSync(assemblerPath);
const index = fs.readFileSync(indexPath, 'utf8');
const expectedKey = crypto.createHash('sha256').update(assembler).digest('hex').slice(0, 12);
const match = index.match(/<script\s+src="assembler\.js\?v=sha256-([a-f0-9]{12})"><\/script>/);

if (!match) {
    console.error('assembler.js browser URL must use v=sha256-<first 12 source hash characters>');
    process.exit(1);
}

if (match[1] !== expectedKey) {
    console.error(
        `assembler.js browser cache key is stale: found ${match[1]}, expected ${expectedKey}`
    );
    process.exit(1);
}

console.log(`assembler.js browser cache key is fresh (${expectedKey})`);