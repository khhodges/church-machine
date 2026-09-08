#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'simulator', 'index.html');
const scriptPattern = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;

function sourceHash(sourcePath) {
    return crypto
        .createHash('sha256')
        .update(fs.readFileSync(sourcePath))
        .digest('hex')
        .slice(0, 12);
}

function pinnedLocalScripts(index) {
    return Array.from(index.matchAll(scriptPattern), match => match[1])
        .filter(url => !/^(?:https?:)?\/\//.test(url) && url.includes('?v='));
}

function printHelp() {
    console.log(`Check or update browser cache keys for local scripts in simulator/index.html.

Usage:
  node scripts/check_assembler_browser_freshness.js
      Check that every pinned local script uses its current SHA-256 cache key.

  node scripts/check_assembler_browser_freshness.js --update
      Recalculate cache keys for already-pinned local scripts. Unpinned local
      scripts and external URLs are left unchanged.

  node scripts/check_assembler_browser_freshness.js --help
      Show this help.`);
}

function updateCacheKeys(index, projectRoot = root) {
    let updatedCount = 0;
    const updatedIndex = index.replace(scriptPattern, (scriptTag, url) => {
        if (/^(?:https?:)?\/\//.test(url)) return scriptTag;

        const match = url.match(/^([^?]+)\?v=sha256-[a-f0-9]{12}$/);
        if (!match) return scriptTag;

        const sourceName = match[1];
        const sourcePath = path.join(projectRoot, 'simulator', sourceName);
        if (!fs.existsSync(sourcePath)) return scriptTag;

        const updatedUrl = `${sourceName}?v=sha256-${sourceHash(sourcePath)}`;
        if (updatedUrl === url) return scriptTag;
        updatedCount++;
        return scriptTag.replace(`src="${url}"`, `src="${updatedUrl}"`);
    });
    return { updatedIndex, updatedCount };
}

function checkCacheKeys(index, projectRoot = root) {
    const pinnedScripts = pinnedLocalScripts(index);
    if (pinnedScripts.length === 0) {
        return {
            count: 0,
            failures: ['No pinned first-party browser scripts found in simulator/index.html'],
        };
    }

    const failures = [];
    for (const url of pinnedScripts) {
        const match = url.match(/^([^?]+)\?v=sha256-([a-f0-9]{12})$/);
        if (!match) {
            failures.push(`${url}: browser URL must use v=sha256-<first 12 source hash characters>`);
            continue;
        }

        const [, sourceName, actualKey] = match;
        const sourcePath = path.join(projectRoot, 'simulator', sourceName);
        if (!fs.existsSync(sourcePath)) {
            failures.push(`${url}: source file does not exist`);
            continue;
        }

        const expectedKey = sourceHash(sourcePath);
        if (actualKey !== expectedKey) {
            failures.push(`${sourceName}: found ${actualKey}, expected ${expectedKey}`);
        }
    }
    return { count: pinnedScripts.length, failures };
}

function main(args = process.argv.slice(2)) {
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }
    if (args.some(arg => arg !== '--update')) {
        console.error(`Unknown argument: ${args.find(arg => arg !== '--update')}`);
        printHelp();
        process.exitCode = 1;
        return;
    }

    const index = fs.readFileSync(indexPath, 'utf8');
    if (args.includes('--update')) {
        const { updatedIndex, updatedCount } = updateCacheKeys(index);
        if (updatedIndex !== index) fs.writeFileSync(indexPath, updatedIndex);
        console.log(`${updatedCount} pinned first-party browser script cache keys updated`);
        return;
    }

    const { count, failures } = checkCacheKeys(index);
    if (failures.length > 0) {
        console.error('Pinned first-party browser script cache keys are stale or invalid:');
        for (const failure of failures) console.error(`- ${failure}`);
        process.exitCode = 1;
        return;
    }
    console.log(`${count} pinned first-party browser script cache keys are fresh`);
}

if (require.main === module) main();

module.exports = { checkCacheKeys, pinnedLocalScripts, updateCacheKeys };