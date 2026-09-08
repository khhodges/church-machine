#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'simulator', 'index.html');
const index = fs.readFileSync(indexPath, 'utf8');
const scriptPattern = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
const pinnedLocalScripts = [];

for (const match of index.matchAll(scriptPattern)) {
    const url = match[1];
    if (/^(?:https?:)?\/\//.test(url) || !url.includes('?v=')) continue;
    pinnedLocalScripts.push(url);
}

if (pinnedLocalScripts.length === 0) {
    console.error('No pinned first-party browser scripts found in simulator/index.html');
    process.exit(1);
}

const failures = [];
for (const url of pinnedLocalScripts) {
    const match = url.match(/^([^?]+)\?v=sha256-([a-f0-9]{12})$/);
    if (!match) {
        failures.push(`${url}: browser URL must use v=sha256-<first 12 source hash characters>`);
        continue;
    }

    const [, sourceName, actualKey] = match;
    const sourcePath = path.join(root, 'simulator', sourceName);
    if (!fs.existsSync(sourcePath)) {
        failures.push(`${url}: source file does not exist`);
        continue;
    }

    const expectedKey = crypto
        .createHash('sha256')
        .update(fs.readFileSync(sourcePath))
        .digest('hex')
        .slice(0, 12);
    if (actualKey !== expectedKey) {
        failures.push(`${sourceName}: found ${actualKey}, expected ${expectedKey}`);
    }
}

if (failures.length > 0) {
    console.error('Pinned first-party browser script cache keys are stale or invalid:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`${pinnedLocalScripts.length} pinned first-party browser script cache keys are fresh`);